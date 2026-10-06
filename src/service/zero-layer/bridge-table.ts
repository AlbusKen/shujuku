import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import { isSummaryOrOutlineTable_ACU } from '../../shared/utils';
import { materializeDataFromSheetGuide_ACU } from '../template/chat-scope';
import { resolveTableStorageStrategy_ACU } from '../table/storage-strategy-resolver';
import { loadTableStateFromFramesV2Detailed_ACU } from '../table/storage-frame-v2-replay';
import { mergeAllIndependentTablesLegacyV1_ACU } from '../runtime/helpers-data-merge';
import { resolveTableHistoryStateFromChat_ACU } from '../table/table-history';
import { buildCanonicalFullCheckpoint_ACU } from '../table/canonical-checkpoint-builder';
import { validateZeroLayerTableData_ACU } from './validation';
import { ZeroLayerError_ACU, type ZeroLayerTableInput_ACU } from './model';
import type { ZeroLayerBridgeCandidate_ACU, ZeroLayerBridgeConfig_ACU } from './bridge-model';

/** 仅消费 Inventory 冻结配置；异步回放不读取普通 provider 或全局模板。 */
export async function buildBridgeTable_ACU(chat: any[], createdAt: number, config: ZeroLayerBridgeConfig_ACU): Promise<{
  table: ZeroLayerBridgeCandidate_ACU['table']; availability: 'persisted' | 'pristine';
}> {
  const { isolationKey, chatKey, storageMode } = config;
  if (!chatKey || chatKey === 'unknown_chat_init') throw new ZeroLayerError_ACU('chat-unavailable', '桥接表格聊天身份尚未就绪。');
  const settings = structuredClone(config.settings);
  const isolationConfig = { enabled: settings.dataIsolationEnabled, code: settings.dataIsolationCode };
  const guide = structuredClone(config.guideData);
  const templateData = structuredClone(config.templateData);
  validateZeroLayerTableData_ACU(templateData);
  const strategy = resolveTableStorageStrategy_ACU(chat, isolationKey, isolationConfig);
  let tableData: TableDataObject_ACU;

  if (strategy.mode === 'v2') {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
      updateRuntimeState: false, throwOnRecoveryRequired: true,
      compatibilityMode: 'disabled', backgroundFixation: 'skip',
    });
    if (!replay || replay.requiresCheckpointConvergence) {
      throw new ZeroLayerError_ACU('migration-conflict', '旧表格缺少严格回放基底，不能建立桥接。');
    }
    tableData = replay.data;
  } else if (strategy.mode === 'legacy-v1') {
    const legacy = await mergeAllIndependentTablesLegacyV1_ACU({ chat, isolationKey,
      sheetGuideData: guide, templateSheetKeys: Object.keys(templateData).filter(key => key.startsWith('sheet_')),
      isolationConfig, templateData });
    if (!legacy) throw new ZeroLayerError_ACU('migration-conflict', '旧表格源存在但无法回放，禁止空基线。');
    tableData = legacy as TableDataObject_ACU;
  } else {
    // 仅无持久历史证据时使用模板结构；seedRows 不冒充已有聊天的真实数据行。
    tableData = materializeDataFromSheetGuide_ACU(guide, { includeSeedRows: false }) as TableDataObject_ACU;
  }
  validateZeroLayerTableData_ACU(tableData);
  const completedAiFloorBySheetKey: Record<string, number> = {};
  for (const sheetKey of Object.keys(tableData).filter(key => key.startsWith('sheet_'))) {
    completedAiFloorBySheetKey[sheetKey] = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey, isSummaryTable: isSummaryOrOutlineTable_ACU((tableData[sheetKey] as Sheet_ACU).name),
      isolationKey, settings,
    }).lastCompletedAiFloor;
  }
  const input: ZeroLayerTableInput_ACU = { chatKey, isolationKey, storageMode, tableData,
    templateData, completedAiFloorBySheetKey, autoUpdateEnabled: settings.autoUpdateEnabled === true,
    scheduling: { autoUpdateFrequency: settings.autoUpdateFrequency ?? 1,
      skipUpdateFloors: settings.skipUpdateFloors ?? 0, autoUpdateThreshold: settings.autoUpdateThreshold ?? 3,
      updateBatchSize: settings.updateBatchSize ?? 3 } };
  const built = buildCanonicalFullCheckpoint_ACU({ createdAt, reason: 'migration', data: tableData });
  if (!built.checkpoint) throw new ZeroLayerError_ACU('migration-conflict', '桥接表格 canonical 基线校验失败。');
  return { table: { input: JSON.parse(JSON.stringify(input)), payload: built.checkpoint },
    availability: strategy.mode === 'empty' ? 'pristine' : 'persisted' };
}
