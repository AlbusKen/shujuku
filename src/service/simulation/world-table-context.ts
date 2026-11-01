import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import { getChatSheetGuideDataForIsolationKey_ACU, getCurrentChatTemplateScopeState_ACU,
  getGlobalTemplateSnapshotForCurrentProfile_ACU } from '../template/chat-scope';
import { getCurrentIsolationKey_ACU, settings_ACU } from '../runtime/state-manager';
import { mergeAllIndependentTablesLegacyV1_ACU } from '../runtime/helpers-data-merge';
import { loadTableStateFromFramesV2Detailed_ACU } from '../table/storage-frame-v2-replay';
import { resolveTableStorageStrategy_ACU } from '../table/storage-strategy-resolver';
import { validateZeroLayerTableResult_ACU } from '../zero-layer/validation';
import { ZeroLayerError_ACU, type ZeroLayerTurn_ACU } from '../zero-layer/model';

/** 只读回放至当前 assistant 楼层；不触发 legacy 迁移或 provider 写入。 */
export async function readHostWorldTableSnapshot_ACU(chat: any[], anchorIndex: number): Promise<TableDataObject_ACU> {
  const boundedChat = chat.slice(0, anchorIndex + 1);
  const isolationKey = getCurrentIsolationKey_ACU();
  const isolationConfig = { enabled: settings_ACU.dataIsolationEnabled, code: settings_ACU.dataIsolationCode };
  const strategy = resolveTableStorageStrategy_ACU(boundedChat, isolationKey, isolationConfig);
  if (strategy.mode === 'empty') return {} as TableDataObject_ACU;
  if (strategy.mode === 'v2') {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(boundedChat, isolationKey, {
      maxMessageIndex: anchorIndex, updateRuntimeState: false, backgroundFixation: 'skip',
      allowTemporaryTemplateBaseline: true,
    });
    if (!replay) throw new Error('WORLD_SIMULATION_TABLE_REPLAY_UNAVAILABLE:V2 表格历史无法回放');
    return structuredClone(replay.data);
  }
  const guide = getChatSheetGuideDataForIsolationKey_ACU(isolationKey, { chat: boundedChat });
  const scoped = getCurrentChatTemplateScopeState_ACU({ chat: boundedChat, isolationKey, readOnly: true });
  const templateData = scoped?.templateObj ?? (guide ? guide : getGlobalTemplateSnapshotForCurrentProfile_ACU({ readOnly: true })?.templateObj) ?? {};
  const legacy = await mergeAllIndependentTablesLegacyV1_ACU({ chat: boundedChat, isolationKey,
    sheetGuideData: guide, templateSheetKeys: Object.keys(guide ?? templateData).filter(key => key.startsWith('sheet_')),
    isolationConfig, templateData });
  if (!legacy) throw new Error('WORLD_SIMULATION_TABLE_REPLAY_UNAVAILABLE:legacy 表格历史无法回放');
  return structuredClone(legacy as TableDataObject_ACU);
}

/** 精确尝试上的已确认表优先；候选表与其他分支绝不参与。 */
export function readLogicalWorldTableSnapshot_ACU(turn: ZeroLayerTurn_ACU, sessionId?: string): TableDataObject_ACU {
  const stored = turn.assistantFloor.data.table;
  if (stored !== undefined) {
    validateZeroLayerTableResult_ACU(stored, turn.assistantFloor.floorId);
    const receipt = turn.effectReceipts.find(item => item.kind === 'table');
    if (!receipt || receipt.status !== 'durable'
      || sessionId !== undefined && receipt.effectId !== JSON.stringify([sessionId, turn.turnId, turn.attemptId, 'table'])
      || receipt.fingerprint !== getTableDataFingerprint_ACU(stored)) {
      throw new ZeroLayerError_ACU('corrupt-data', '逻辑表格结果缺少匹配的持久回执。');
    }
    return structuredClone(stored.tableData);
  }
  return turn.tableInput ? structuredClone(turn.tableInput.tableData) : {} as TableDataObject_ACU;
}
