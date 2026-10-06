import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../runtime/state-manager';
import { getCurrentStorageMode } from '../table/storage-mode';
import { getChatSheetGuideDataForIsolationKey_ACU, materializeDataFromSheetGuide_ACU } from '../template/chat-scope';
import { captureSqlTableApplyScope_ACU } from '../table/sql-table-service';
import type { TableDataObject_ACU } from '../../shared/models/table-data';
import type { ZeroLayerBridgeConfig_ACU } from './bridge-model';
import { validateZeroLayerTableData_ACU } from './validation';
import { checkpointFingerprint_ACU } from './checkpoint-payload';
import { ZeroLayerError_ACU } from './model';

/** 同步冻结回放配置，不保存 API 配置、凭据或普通 provider 的工作缓存。 */
export function captureBridgeConfig_ACU(chat: any[]): ZeroLayerBridgeConfig_ACU {
  const chatKey = String(currentChatFileIdentifier_ACU || '');
  if (!chatKey || chatKey === 'unknown_chat_init') {
    throw new ZeroLayerError_ACU('chat-unavailable', '桥接表格聊天身份尚未就绪。');
  }
  const isolationKey = getCurrentIsolationKey_ACU();
  const storageMode = getCurrentStorageMode();
  const guideData = getChatSheetGuideDataForIsolationKey_ACU(isolationKey, { chat });
  if (!guideData) throw new ZeroLayerError_ACU('migration-conflict', '桥接模板来源不可用，禁止伪造空基线。');
  let templateData = materializeDataFromSheetGuide_ACU(guideData, { includeSeedRows: true }) as TableDataObject_ACU;
  validateZeroLayerTableData_ACU(templateData);
  if (storageMode === 'sqlite') templateData = captureSqlTableApplyScope_ACU({ chat: [], isolationKey, templateData }).templateDataWithRows;
  const settings = {
    dataIsolationEnabled: settings_ACU.dataIsolationEnabled === true,
    dataIsolationCode: String(settings_ACU.dataIsolationCode ?? ''),
    autoUpdateEnabled: settings_ACU.autoUpdateEnabled === true,
    autoUpdateFrequency: settings_ACU.autoUpdateFrequency ?? 1,
    skipUpdateFloors: settings_ACU.skipUpdateFloors ?? 0,
    autoUpdateThreshold: settings_ACU.autoUpdateThreshold ?? 3,
    updateBatchSize: settings_ACU.updateBatchSize ?? 3,
  };
  return JSON.parse(JSON.stringify({ schemaVersion: 1, chatKey, isolationKey, storageMode, guideData, templateData, settings }));
}

export function assertBridgeConfig_ACU(chat: any[], expected: string): void {
  if (checkpointFingerprint_ACU(captureBridgeConfig_ACU(chat)) !== expected) {
    throw new ZeroLayerError_ACU('migration-conflict', '桥接模板或配置已变化，保留旧读取路径。');
  }
}
