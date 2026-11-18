import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU, peekChatScopedConfigContainer_ACU, peekChatSheetGuideContainer_ACU, setChatScopedConfigContainer_ACU, setChatSheetGuideContainer_ACU } from '../../data/storage/chat-history';
import { getCurrentIsolationKey_ACU, settings_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { assertNoPhysicalTableNameCollision_ACU, prepareStableSheetIdentities_ACU } from '../../shared/sheet-identity';
import { normalizeCanonicalTableRows_ACU } from '../../shared/canonical-row-normalizer';
import { buildSheetTableAliasMap_ACU } from '../../shared/sql-read-resolver';
import { buildCanonicalFullCheckpoint_ACU } from './canonical-checkpoint-builder';
import { writeInitFullCheckpointFrameV2_ACU } from './storage-frame-v2-persist';
import { hydrateTableDataStrict_ACU } from './sqlite-template-validation';
import { getCurrentStorageMode } from './storage-mode';
import { runTableWriteTransaction_ACU } from './table-write-transaction';
import { buildChatSheetGuideDataFromTemplateObj_ACU, clearCurrentChatTemplateSnapshots_ACU, ensureStableRowIdsForSheetContent_ACU, setChatSheetGuideDataForIsolationKey_ACU } from '../template/chat-scope';
import { normalizeTemplateRowIds_ACU, type TemplateRowIdNormalizationAudit_ACU } from '../template/template-row-id-normalizer';
import { logWarn_ACU } from '../../shared/utils';

type ResetResult = {
  saved: boolean; messageIndex?: number; runtimeReady?: boolean; postCommitWarning?: string; error?: string;
  normalizedTemplateData?: Record<string, any>; normalizationAudit?: TemplateRowIdNormalizationAudit_ACU[];
};
type PreparedTemplate = {
  templateData: Record<string, any>;
  normalizationAudit: TemplateRowIdNormalizationAudit_ACU[];
};
// Chat metadata stores scope/guide outside message fields, so both containers are snapshotted explicitly below.
const MESSAGE_FIELDS = ['TavernDB_ACU_IsolatedData', 'TavernDB_ACU_Data', 'TavernDB_ACU_SummaryData', 'TavernDB_ACU_IndependentData', 'TavernDB_ACU_Identity', 'TavernDB_ACU_ModifiedKeys', 'TavernDB_ACU_UpdateGroupKeys', 'TavernDB_ACU_TableHeaderGuide', '_acu_local_template_base_state_seeded'];

function clone<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)); }

function prepareTemplate(templateData: Record<string, any>): PreparedTemplate {
  if (!templateData || typeof templateData !== 'object' || Array.isArray(templateData)) throw new Error('初始化模板必须是对象。');
  const normalization = normalizeTemplateRowIds_ACU(templateData, {
    syncDdl: getCurrentStorageMode() === 'sqlite',
  });
  if (normalization.blockers.length > 0) {
    throw new Error(`初始化模板 row_id 规范化失败：${normalization.blockers.map(item => item.message).join('；')}`);
  }
  const normalizedTemplateData = normalization.templateData;
  const entries = Object.entries(normalizedTemplateData).filter(([key]) => key.startsWith('sheet_'));
  if (entries.length === 0) throw new Error('初始化模板不包含任何 Sheet。');
  const malformedKey = entries.find(([, source]) => !source || typeof source !== 'object' || Array.isArray(source))?.[0];
  if (malformedKey) throw new Error(`初始化模板 Sheet 无效：${malformedKey}`);
  // Stable keys replace transport/random keys; the shared preparation keeps displaced key/uid as
  // tableAliases so later SQL/Strict-JSON requests still resolve the same logical sheet.
  const identity = prepareStableSheetIdentities_ACU(normalizedTemplateData);
  if (identity.diagnostics.length || identity.keyMap.size !== entries.length) throw new Error(`初始化模板无法分配稳定 Sheet key：${identity.diagnostics.map(item => item.code).join('；')}`);
  const result = identity.data;
  entries.forEach(([oldKey]) => {
    const sheet = result[identity.keyMap.get(oldKey)!];
    if (!Array.isArray(sheet.content) || !Array.isArray(sheet.content[0]) || sheet.content[0][0] !== 'row_id') throw new Error(`初始化模板 Sheet 缺少 row_id 表头：${oldKey}`);
    if (sheet.content.slice(1).some((row: unknown) => !Array.isArray(row))) throw new Error(`初始化模板 Sheet 包含非法数据行：${oldKey}`);
    if (!sheet.sourceData || typeof sheet.sourceData !== 'object' || Array.isArray(sheet.sourceData)) sheet.sourceData = {};
    if (!Array.isArray(sheet.sourceData.tableAliases)) sheet.sourceData.tableAliases = [];
    sheet.content = ensureStableRowIdsForSheetContent_ACU(sheet.content);
  });
  const normalized = normalizeCanonicalTableRows_ACU(result);
  if (normalized.errors.length) throw new Error('初始化模板包含重复或非法 row_id。');
  assertNoPhysicalTableNameCollision_ACU(result);
  const aliasRegistry = buildSheetTableAliasMap_ACU([result], { includeExtendedAliases: true });
  if (aliasRegistry.conflicts.size > 0) {
    throw new Error(`初始化模板存在歧义表别名：${[...aliasRegistry.conflicts].join('、')}。`);
  }
  return { templateData: result, normalizationAudit: normalization.audits };
}

function snapshotMessages(chat: any[]) {
  return chat.filter(message => message && typeof message === 'object').map(message => ({ message, fields: MESSAGE_FIELDS.map(field => ({ field, had: Object.prototype.hasOwnProperty.call(message, field), value: clone(message[field]) })) }));
}
function restoreMessages(snapshots: ReturnType<typeof snapshotMessages>) {
  for (const snapshot of snapshots) for (const field of snapshot.fields) field.had ? snapshot.message[field.field] = field.value : delete snapshot.message[field.field];
}


export async function resetCurrentChatTableStateFromTemplate_ACU(
  templateData: Record<string, any>,
  options: { presetName?: string; source?: string; reason?: string; resetExistingTableData?: boolean } = {},
): Promise<ResetResult> {
  let prepared: Record<string, any>;
  let guideData: Record<string, any>;
  let normalizationAudit: TemplateRowIdNormalizationAudit_ACU[];
  try {
    const preparedResult = prepareTemplate(templateData);
    prepared = preparedResult.templateData;
    normalizationAudit = preparedResult.normalizationAudit;
    guideData = buildChatSheetGuideDataFromTemplateObj_ACU(prepared, { stripSeedRows: false });
    if (!guideData) throw new Error('无法从初始化模板生成聊天指导表。');
    if (getCurrentStorageMode() === 'sqlite') {
      // 运行时模板注入路径（initGameSession/模板面板）与 table-import-service.ts:132 语义一致：
      // 非法显式 DDL 允许降级为 fallback schema，避免「导入面板能过、API 注入被硬拦」的不一致。
      // 持久化契约校验（storage-frame-v2-persist.ts:3190）保持严格，不在此处放宽。
      await hydrateTableDataStrict_ACU(prepared, { allowRuntimeDdlFallback: true });
    }
  } catch (error: any) {
    return { saved: false, error: error?.message || String(error) };
  }

  const isolationKey = getCurrentIsolationKey_ACU();
  try {
    return await runTableWriteTransaction_ACU({
      source: 'template_assistant', reason: options.reason || 'resetCurrentChatTableStateFromTemplate', isolationKey,
      writeSet: [{ kind: 'all' }], maintenanceMode: 'exclusive',
    }, async (transactionContext) => transactionContext.runCommit(async () => {
      const chat = getChatArray_ACU();
      if (!Array.isArray(chat)) throw new Error('当前聊天记录不可用，已取消初始化提交。');
      const targetIndex = chat.findIndex(message => message && !message.is_user);
      if (targetIndex < 0) throw new Error('当前聊天不存在可写入初始化 checkpoint 的 AI 楼层。');
      const firstMessage = chat[0];
      const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
      const messageSnapshots = snapshotMessages(chat);
      const previousScope = clone(peekChatScopedConfigContainer_ACU(chat));
      const previousGuide = clone(peekChatSheetGuideContainer_ACU(chat));
      let primarySaveAttempted = false;
      try {
        for (const message of chat) {
          if (!message || message.is_user) continue;
          const isolated = message.TavernDB_ACU_IsolatedData;
          if (isolated && typeof isolated === 'object' && !Array.isArray(isolated)) {
            delete isolated[isolationKey];
            if (Object.keys(isolated).length === 0) delete message.TavernDB_ACU_IsolatedData;
          }
          const ownsLegacyData = !settings_ACU.dataIsolationEnabled || message.TavernDB_ACU_Identity === settings_ACU.dataIsolationCode;
          if (ownsLegacyData) {
            delete message.TavernDB_ACU_Data;
            delete message.TavernDB_ACU_SummaryData;
            delete message.TavernDB_ACU_IndependentData;
            delete message.TavernDB_ACU_ModifiedKeys;
            delete message.TavernDB_ACU_UpdateGroupKeys;
            delete message.TavernDB_ACU_Identity;
          }
        }
        await clearCurrentChatTemplateSnapshots_ACU({ chat, isolationKey, clearCurrentOverride: true, clearArchives: true, clearGuide: true, clearLegacyGuide: true, save: false });
        const checkpoint = buildCanonicalFullCheckpoint_ACU({
          createdAt: Date.now(), reason: 'init', data: prepared as any,
          event: { filledSheetKeys: [], changedSheetKeys: Object.keys(prepared).filter(key => key.startsWith('sheet_')).sort(), groupKeys: [] },
          context: { messageIndex: targetIndex, aiFloor: chat.slice(0, targetIndex + 1).filter(message => message && !message.is_user).length, isolationKey },
        });
        if (!checkpoint.checkpoint) throw new Error(checkpoint.error);
        // S2-4：frame 拼装 + 单根断言收敛到 persist 层统一入口，违例抛错走下方快照回滚
        writeInitFullCheckpointFrameV2_ACU({ chat, targetIndex, isolationKey, checkpoint: checkpoint.checkpoint });
        const target = chat[targetIndex];
        if (settings_ACU.dataIsolationEnabled) target.TavernDB_ACU_Identity = settings_ACU.dataIsolationCode;
        const guideUpdated = setChatSheetGuideDataForIsolationKey_ACU(isolationKey, guideData, {
          reason: options.reason || 'game_init', syncTemplateScope: true, templateSource: prepared,
          presetName: options.presetName || '', source: options.source || 'game_init',
        });
        if (!guideUpdated) throw new Error('初始化模板无法原子写入 guide 与 template scope。');
        if (getChatArray_ACU() !== chat || chat[0] !== firstMessage || getActiveChatStorageIdentity_ACU(chat) !== chatIdentity) throw new Error('目标聊天已切换，已取消初始化提交。');
        primarySaveAttempted = true;
        await saveChatToHostStrict_ACU();
        _set_currentJsonTableData_ACU(clone(prepared));
        return { saved: true, messageIndex: targetIndex, runtimeReady: true, normalizedTemplateData: clone(prepared), normalizationAudit };
      } catch (error: any) {
        restoreMessages(messageSnapshots);
        setChatScopedConfigContainer_ACU(chat, previousScope);
        setChatSheetGuideContainer_ACU(chat, previousGuide);
        if (primarySaveAttempted) {
          try { await saveChatToHostStrict_ACU(); }
          catch (rollbackError: any) { throw new Error(`${error?.message || String(error)}；回滚保存也失败：${rollbackError?.message || String(rollbackError)}`); }
        }
        throw error;
      }
    }, [{ kind: 'all' }]));
  } catch (error: any) {
    logWarn_ACU('[游戏初始化] 原子模板重置失败:', error);
    return { saved: false, error: error?.message || String(error) };
  }
}
