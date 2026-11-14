/**
 * 聊天表格帧的外部改动代次（仅内存）。
 *
 * 宿主保存入口、楼层删除/滑动调度与聊天切换都会递增代次；最新回放快照只在代次未变时复用。
 * 表格写入、纪要向量镜像写入在自身保存成功后调用 absorbOwnTableSave_ACU：保存期间若只有
 * 这一次递增，快照模块把保存前截取的快照改记到新代次（帧对象与内容指纹仍逐帧校验）。
 */
let tableReplayGeneration_ACU = 0;
const ownSaveListeners_ACU: Array<(before: number, after: number) => void> = [];

export function bumpTableReplayGeneration_ACU(): void {
  tableReplayGeneration_ACU += 1;
}

export function getTableReplayGeneration_ACU(): number {
  return tableReplayGeneration_ACU;
}

export function registerOwnTableSaveListener_ACU(listener: (before: number, after: number) => void): void {
  ownSaveListeners_ACU.push(listener);
}

export function absorbOwnTableSave_ACU(generationBeforeSave: number): void {
  const current = tableReplayGeneration_ACU;
  if (current !== generationBeforeSave + 1) return;
  for (const listener of ownSaveListeners_ACU) {
    try {
      listener(generationBeforeSave, current);
    } catch (_) {
      // 快照改记是纯优化，失败只意味着下一次回放走冷路径。
    }
  }
}
