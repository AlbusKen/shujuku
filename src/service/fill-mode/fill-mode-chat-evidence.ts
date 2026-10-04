/** 当前会话的模式兼容证据；只读，不修改历史表格或向量数据。 */
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU } from '../../shared/models/flight-mode-model';
import { isSummaryOrOutlineTable_ACU } from '../../shared/utils';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';

/** 未加载的表格属于未知状态，不能当成空的新会话。 */
export function hasExistingTableDataForCurrentChat_ACU(tableData: any = currentJsonTableData_ACU): boolean {
  if (!tableData || typeof tableData !== 'object') return true;
  return Object.entries(tableData).some(([key, sheet]: [string, any]) =>
    key.startsWith('sheet_') && Array.isArray(sheet?.content) && sheet.content.length > 1);
}

/** 只有已加载、有数据且没有大总结表的会话才属于旧模式兼容范围。 */
export function hasLegacyFillModeTableData_ACU(): boolean {
  const data = currentJsonTableData_ACU;
  if (!data || typeof data !== 'object' || !hasExistingTableDataForCurrentChat_ACU(data)) return false;
  return !Object.entries(data).some(([key, sheet]: [string, any]) =>
    key.startsWith('sheet_') && sheet?.name === FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU);
}

/** 只取当前 isolation 的最新旧索引；历史正计数不代表当前仍有向量。 */
function readLatestLegacyVectorState_ACU(): any | null {
  const chat = getChatArray_ACU();
  const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    const message: any = chat[index];
    if (!message || message.is_user) continue;
    const tag = readIsolatedTagData_ACU(message, isolationKey);
    if (tag?.storageFrame?.summaryVectorIndexFrame) return null;
    if (tag?.summaryVectorIndexState || tag?.summaryVectorIndexManifest) {
      return { ...tag.summaryVectorIndexState, manifest: tag.summaryVectorIndexManifest || tag.summaryVectorIndexState?.manifest };
    }
  }
  return null;
}

function hasFiniteVector_ACU(vector: ArrayLike<number> | undefined): boolean {
  return !!vector?.length && Array.from(vector).every(value => Number.isFinite(value));
}

/** 同步读取只承认最新旧快照中的实际内置向量；外置引用交给异步补记入口核验。 */
export function hasSummaryVectorDataForCurrentChat_ACU(): boolean {
  const state = readLatestLegacyVectorState_ACU();
  if (!state || state.manifest) return false;
  const table = currentJsonTableData_ACU?.[state.sourceTableKey];
  if (!table || !isSummaryOrOutlineTable_ACU(String(table.name || '')) || !Array.isArray(table.content)) return false;
  const liveIds = new Set(table.content.slice(1).filter(Array.isArray).map((row: any[]) => String(row[0] ?? '').trim()));
  const activeKeys = new Set((Array.isArray(state.rows) ? state.rows : [])
    .filter((row: any) => row?.status !== 'removed' && liveIds.has(String(row?.rowId ?? '')))
    .map((row: any) => row.rowKey));
  return Array.isArray(state.chunks) && state.chunks.some((chunk: any) => activeKeys.has(chunk.rowKey) && hasFiniteVector_ACU(chunk.vector));
}

/** 索引历史仅证明需要旧数据兼容核验，不证明当前存在有效向量。 */
export function hasLegacyVectorHistoryForCurrentChat_ACU(): boolean {
  const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
  return getChatArray_ACU().some((message: any) => {
    if (!message || message.is_user) return false;
    const tag = readIsolatedTagData_ACU(message, isolationKey);
    return !!(tag?.storageFrame?.summaryVectorIndexFrame || tag?.summaryVectorIndexState || tag?.summaryVectorIndexManifest);
  });
}

export type SummaryVectorEvidence_ACU =
  | { status: 'present' | 'absent' }
  | { status: 'unknown'; error: string };

/** 只读核验，不重建索引、不请求 embedding；读取失败不等价于空索引。 */
export async function inspectSummaryVectorDataForCurrentChat_ACU(): Promise<SummaryVectorEvidence_ACU> {
  try {
    const chat = getChatArray_ACU();
    const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
    if (!hasLegacyVectorHistoryForCurrentChat_ACU()) return { status: 'absent' };
    const sourceTableKey = Object.keys(currentJsonTableData_ACU || {}).find(key =>
      isSummaryOrOutlineTable_ACU(String(currentJsonTableData_ACU[key]?.name || '')));
    if (!sourceTableKey) return { status: 'absent' };
    const { buildPreparedRows_ACU } = await import('../vector/summary-vector-index-archive-service');
    const prepared = buildPreparedRows_ACU(currentJsonTableData_ACU[sourceTableKey], sourceTableKey);
    if (prepared.error) return { status: 'unknown', error: prepared.error };
    const liveRows = new Map(prepared.rows.map(row => [row.rowId, row]));
    if (liveRows.size === 0) return { status: 'absent' };

    const hasMirror = chat.some((message: any) => !message?.is_user
      && !!readIsolatedTagData_ACU(message, isolationKey)?.storageFrame?.summaryVectorIndexFrame);
    if (hasMirror) {
      const { resolveSummaryVectorMirrorHead_ACU } = await import('../vector/summary-vector-mirror-resolver');
      const { loadSummaryVectorMirrorManifest_ACU, loadSummaryVectorMirrorPack_ACU, decodeSummaryVectorMirrorVector_ACU }
        = await import('../vector/summary-vector-mirror-storage');
      const head = await resolveSummaryVectorMirrorHead_ACU({
        chat, isolationKey, sourceTableKey, loadManifest: ref => loadSummaryVectorMirrorManifest_ACU(ref),
      });
      if (head.status === 'no_mirror' || head.status === 'source_table_changed') return { status: 'absent' };
      if (head.status !== 'ok' || head.stale || head.chainConflict) {
        return { status: 'unknown', error: `当前向量镜像无法可靠回放（${head.status}${head.stale ? '/stale' : ''}）。` };
      }
      const packs = new Map<string, Awaited<ReturnType<typeof loadSummaryVectorMirrorPack_ACU>>>();
      for (const [rowId, refs] of head.head) {
        if (!liveRows.has(rowId)) continue;
        for (const ref of refs) {
          if (!packs.has(ref.packHash)) {
            const packRef = head.packRefs.find(pack => pack.packHash === ref.packHash);
            packs.set(ref.packHash, packRef ? await loadSummaryVectorMirrorPack_ACU(packRef) : null);
          }
          const chunk = packs.get(ref.packHash)?.chunks?.[ref.chunkIndex];
          if (!chunk) return { status: 'unknown', error: '当前向量镜像引用的数据块不可读。' };
          const vector = decodeSummaryVectorMirrorVector_ACU(String(chunk.vector || ''));
          if (hasFiniteVector_ACU(vector) && vector.length === head.checkpoint?.embedding.dimension) {
            return { status: 'present' };
          }
        }
      }
      return { status: 'absent' };
    }

    const state = readLatestLegacyVectorState_ACU();
    if (!state || (state.manifest?.sourceTableKey || state.sourceTableKey) !== sourceTableKey) return { status: 'absent' };
    let chunks = Array.isArray(state.chunks) ? state.chunks : [];
    if (state.manifest) {
      const { loadSummaryVectorIndexChunksFromManifest_ACU } = await import('../vector/summary-vector-index-storage-service');
      chunks = await loadSummaryVectorIndexChunksFromManifest_ACU(state.manifest, { preferExternalFiles: true });
      if (chunks.length === 0 && Number(state.manifest.chunkCount) > 0) {
        return { status: 'unknown', error: '旧向量索引声明含数据，但实际数据块不可读。' };
      }
    }
    const removedKeys = new Set(state.manifest?.snapshot?.removedRowKeys || []);
    const activeKeys = state.manifest?.snapshot?.activeRowKeys;
    const activeChunkIds = state.manifest?.snapshot?.activeChunkIds;
    const rows = Array.isArray(state.rows) ? state.rows : [];
    const rowKeys = new Set(prepared.rows.map(row => row.rowKey));
    rows.forEach((row: any) => {
      if (row?.status === 'removed') removedKeys.add(row.rowKey);
      else if (liveRows.has(String(row?.rowId ?? ''))) rowKeys.add(row.rowKey);
    });
    return { status: chunks.some((chunk: any) => rowKeys.has(chunk.rowKey) && !removedKeys.has(chunk.rowKey)
      && (!Array.isArray(activeKeys) || activeKeys.includes(chunk.rowKey))
      && (!Array.isArray(activeChunkIds) || activeChunkIds.includes(chunk.chunkId))
      && hasFiniteVector_ACU(chunk.vector)) ? 'present' : 'absent' };
  } catch (error: any) {
    return { status: 'unknown', error: String(error?.message || error || '向量数据核验失败') };
  }
}
