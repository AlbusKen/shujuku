import type { TableStorageFrameV2_ACU } from './storage-frame-v2-types';

function validBaselineFloor_ACU(value: unknown, messageAiFloor: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= messageAiFloor ? value : 0;
}

/** 导入基线不是填表完成事件；旧恢复帧仅凭明确的 checkpoint_fallback 记录识别。 */
export function getV2ImportBaselineAiFloor_ACU(
  frame: TableStorageFrameV2_ACU | undefined,
  sheetKey: string,
  messageAiFloor: number,
): number {
  if (!frame || !sheetKey.startsWith('sheet_')) return 0;
  const checkpoint = frame.checkpoint;
  const sheetCheckpoint = frame.perSheetCheckpoints?.[sheetKey];
  const persistedFloor = Math.max(
    validBaselineFloor_ACU(checkpoint?.scheduleSummary?.[sheetKey]?.lastImportBaselineAiFloor, messageAiFloor),
    validBaselineFloor_ACU(sheetCheckpoint?.scheduleSummary?.lastImportBaselineAiFloor, messageAiFloor),
  );
  const isLegacyRestore = checkpoint?.kind === 'full' && checkpoint.reason === 'import'
    && Boolean(checkpoint.data?.[sheetKey])
    && (frame.logEntries || []).some(entry => entry.source === 'import'
      && entry.operations?.some(operation => operation.kind === 'data_replace'
        && operation.reason === 'checkpoint_fallback' && Boolean(operation.data?.[sheetKey])));
  return Math.max(persistedFloor, isLegacyRestore ? messageAiFloor : 0);
}
