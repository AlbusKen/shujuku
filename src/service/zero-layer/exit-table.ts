import { clearTableFieldsForIsolation_ACU } from '../../data/repositories/chat-message-data-repo';
import { buildCanonicalFullCheckpoint_ACU } from '../table/canonical-checkpoint-builder';
import { loadTableStateFromFramesV2Detailed_ACU } from '../table/storage-frame-v2-replay';
import { assertSingleActiveFullCheckpointV2_ACU } from '../table/storage-frame-v2-persist';
import { checkpointFingerprint_ACU as fingerprint } from './checkpoint-payload';
import { requireExit_ACU, type captureExitSource_ACU } from './exit-source';

type Source_ACU = ReturnType<typeof captureExitSource_ACU>;

/** 导入已完全覆盖的状态；物理水位仅表示接入前缀，不转换逻辑身份或未填缺口。 */
export async function stageExitTable_ACU(chat: Record<string, unknown>[], input: Source_ACU): Promise<void> {
  const { config, table, timeline, target } = input;
  const keys = Object.keys(table.tableData).filter(key => key.startsWith('sheet_'));
  requireExit_ACU(keys.every(key => table.completedAiFloorBySheetKey[key] === timeline.completedAiCount),
    '表格仍有逻辑历史未覆盖，普通水位不能无损表达该缺口。');
  const physicalCount = chat.filter(message => message.is_user !== true).length;
  const built = buildCanonicalFullCheckpoint_ACU({ createdAt: Date.now(), reason: 'import',
    data: table.tableData, scheduleSummary: Object.fromEntries(keys.map(key =>
      [key, { lastImportBaselineAiFloor: physicalCount }])),
    context: { messageIndex: target.messageIndex, isolationKey: config.isolationKey } });
  requireExit_ACU(built.checkpoint, '退出表格未通过 canonical 校验。');
  const isolation = { enabled: config.settings.dataIsolationEnabled, code: config.settings.dataIsolationCode };
  for (const message of chat) clearTableFieldsForIsolation_ACU(message, config.isolationKey, isolation);
  chat[target.messageIndex].TavernDB_ACU_IsolatedData = {
    ...(chat[target.messageIndex].TavernDB_ACU_IsolatedData as Record<string, unknown> ?? {}),
    [config.isolationKey]: { _acu_storage_version: 2,
      storageFrame: { version: 2, checkpoint: built.checkpoint, logEntries: [] } },
  };
  requireExit_ACU(!assertSingleActiveFullCheckpointV2_ACU(chat, config.isolationKey, 'zero_layer_exit'),
    '退出表格存在多个活动基线。');
  const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, config.isolationKey, {
    updateRuntimeState: false, throwOnRecoveryRequired: true, compatibilityMode: 'disabled', backgroundFixation: 'skip',
  });
  requireExit_ACU(replay && !replay.requiresCheckpointConvergence
    && fingerprint(replay.data) === fingerprint(table.tableData), '退出表格严格回放不等价。');
}
