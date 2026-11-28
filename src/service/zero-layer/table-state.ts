import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../runtime/state-manager';
import { getCurrentStorageMode } from '../table/storage-mode';
import { captureSqlTableApplyScope_ACU } from '../table/sql-table-service';
import { captureZeroLayerCarrier_ACU, hasZeroLayerCarrierField_ACU, readZeroLayerCarrier_ACU } from './carrier-context';
import { isZeroLayerFeatureEnabled_ACU } from './feature-policy';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerTableInput_ACU } from './model';
import { getPublishedZeroLayerPath_ACU } from './timeline';
import { validateZeroLayerTableData_ACU, validateZeroLayerTableResult_ACU } from './validation';
import { readCheckpointMaterials_ACU } from './checkpoint-materials';

/** 只读读取当前活动分支 head 的已发布逻辑表（尚无已发布回合时读已确认桥接基线）；返回深拷贝。 */
export function readZeroLayerBranchTableData_ACU(envelope: ZeroLayerEnvelope_ACU): TableDataObject_ACU {
  const bridge = envelope.branches.find(branch => branch.branchId === envelope.activeBranchId)?.bridge;
  if (bridge?.phase !== 'reconciled' || !bridge.candidate) {
    throw new ZeroLayerError_ACU('effects-pending', '表格首基线尚未确认，禁止回退普通存储。');
  }
  const path = getPublishedZeroLayerPath_ACU(envelope);
  const head = path[path.length - 1];
  if (head) {
    const result = readCheckpointMaterials_ACU(envelope, head.turnId).table;
    validateZeroLayerTableResult_ACU(result, head.assistantFloor.floorId);
    return structuredClone(result.tableData);
  }
  const baseline = bridge.candidate.table.input.tableData;
  validateZeroLayerTableData_ACU(baseline);
  return structuredClone(baseline);
}

/** 同步只读入口：仅在零层已启用且未退出普通模式时返回当前活动分支的逻辑表副本；损坏数据直接抛错。 */
export function readCurrentZeroLayerTableDataSync_ACU():
  | { readonly active: false }
  | { readonly active: true; readonly tableData: TableDataObject_ACU } {
  if (!isZeroLayerFeatureEnabled_ACU() || !hasZeroLayerCarrierField_ACU()) {
    return { active: false };
  }
  const context = captureZeroLayerCarrier_ACU();
  const envelope = readZeroLayerCarrier_ACU(context);
  if (!envelope || !envelope.enabled || envelope.exitManifest?.phase === 'committed') {
    return { active: false };
  }
  return { active: true, tableData: readZeroLayerBranchTableData_ACU(envelope) };
}

/** 首轮读已确认桥接基线；后续只沿已发布父链读取，不回退普通 provider。 */
export function captureZeroLayerTableInput_ACU(envelope: ZeroLayerEnvelope_ACU, chat: unknown[]): ZeroLayerTableInput_ACU {
  const chatKey = String(currentChatFileIdentifier_ACU || '');
  const isolationKey = getCurrentIsolationKey_ACU();
  const storageMode = getCurrentStorageMode();
  if (!chatKey || chatKey === 'unknown_chat_init') throw new ZeroLayerError_ACU('chat-unavailable', '表格聊天身份尚未就绪。');
  const bridge = envelope.branches.find(branch => branch.branchId === envelope.activeBranchId)?.bridge;
  if (!envelope.enabled || bridge?.phase !== 'reconciled' || !bridge.candidate) {
    throw new ZeroLayerError_ACU('effects-pending', '表格首基线尚未确认，禁止回退普通存储。');
  }
  const baseline = bridge.candidate.table.input;
  if (baseline.chatKey !== chatKey || baseline.isolationKey !== isolationKey || baseline.storageMode !== storageMode) {
    throw new ZeroLayerError_ACU('scope-changed', '表格作用域与已确认桥接基线不一致。');
  }
  const path = getPublishedZeroLayerPath_ACU(envelope);
  const parent = path[path.length - 1];
  let tableData: TableDataObject_ACU;
  let completedAiFloorBySheetKey: Record<string, number> = {};
  if (parent) {
    const result = readCheckpointMaterials_ACU(envelope, parent.turnId).table;
    validateZeroLayerTableResult_ACU(result, parent.assistantFloor.floorId);
    tableData = result.tableData;
    completedAiFloorBySheetKey = result.completedAiFloorBySheetKey;
  } else {
    tableData = baseline.tableData;
    completedAiFloorBySheetKey = baseline.completedAiFloorBySheetKey;
  }
  const templateData = parent ? captureSqlTableApplyScope_ACU({ chat, isolationKey }).templateDataWithRows
    : baseline.templateData;
  validateZeroLayerTableData_ACU(templateData);
  return JSON.parse(JSON.stringify({ chatKey, isolationKey, storageMode, tableData, templateData,
    completedAiFloorBySheetKey, autoUpdateEnabled: settings_ACU.autoUpdateEnabled === true,
    scheduling: {
      autoUpdateFrequency: settings_ACU.autoUpdateFrequency ?? 1,
      skipUpdateFloors: settings_ACU.skipUpdateFloors ?? 0,
      autoUpdateThreshold: settings_ACU.autoUpdateThreshold ?? 3,
      updateBatchSize: settings_ACU.updateBatchSize ?? 3,
    } })) as ZeroLayerTableInput_ACU;
}
