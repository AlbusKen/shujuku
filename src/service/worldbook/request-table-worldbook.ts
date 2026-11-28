import type { FlightModeState_ACU } from '../../shared/models/flight-mode-model';
import {
  buildNativeEntryDefaults_ACU, nativeToOldEntry_ACU, oldPatchToNativePatch_ACU,
} from '../../shared/host-compat/entry-format';
import { getInjectionTargetLorebook_ACU } from './injection-engine';
import { renderTableWorldbookEntriesForRequest_ACU } from './pipeline';
import type { TableWorldbookEntryStore_ACU } from './table-worldbook-entry-store';

type NativeEntry = Record<string, any>;
export type TableWorldbookRequestPayload_ACU =
  | Record<string, any>
  | { data: Record<string, any>; flightModeOverride?: FlightModeState_ACU };

function unwrapRequestPayload_ACU(
  payload: TableWorldbookRequestPayload_ACU,
): { data: Record<string, any>; flightModeOverride?: FlightModeState_ACU } {
  if (payload && typeof payload === 'object' && 'data' in payload && payload.data && typeof payload.data === 'object'
    && ('flightModeOverride' in payload || Object.keys(payload).every(key => key === 'data' || key === 'flightModeOverride'))) {
    return { data: payload.data, flightModeOverride: payload.flightModeOverride };
  }
  return { data: payload };
}

/** Export the requested table view into the host's already-loaded World Info arrays for this call. */
export async function projectTableWorldbookForRequest_ACU(
  loaded: Record<string, NativeEntry[]>,
  readTableData: () => Promise<TableWorldbookRequestPayload_ACU>,
  assertCurrent: () => void,
): Promise<void> {
  const book = await getInjectionTargetLorebook_ACU();
  assertCurrent();
  if (!book) return;
  const lists = Object.values(loaded || {}).filter(list =>
    Array.isArray(list) && list.some(entry => entry?.world === book));
  if (!lists.length) return;

  const original = lists[0].filter(entry => entry?.world === book);
  const draft = new Map(original.map(entry => [Number(entry.uid), entry]));
  const originalIds = new Set(draft.keys());
  let nextUid = original.reduce((max, entry) => Math.max(max, Number(entry.uid)), -1) + 1;
  if (!Number.isSafeInteger(nextUid) || draft.size !== original.length) {
    throw new Error('无法识别当前请求中的数据库世界书条目。');
  }
  const assertBook = (name: string) => {
    if (name !== book) throw new Error('数据库世界书的导出目标已改变。');
  };
  const entries: TableWorldbookEntryStore_ACU = {
    async get(name) {
      assertBook(name);
      return [...draft.values()].map(nativeToOldEntry_ACU);
    },
    async create(name, created) {
      assertBook(name);
      for (const entry of created) {
        const uid = nextUid++;
        draft.set(uid, { ...buildNativeEntryDefaults_ACU(), ...oldPatchToNativePatch_ACU(entry), uid, displayIndex: uid, world: book });
      }
    },
    async set(name, patches) {
      assertBook(name);
      for (const patch of patches) {
        const uid = Number(patch.uid);
        const current = draft.get(uid);
        if (!current) throw new Error('待更新的世界书条目在当前请求中不存在。');
        draft.set(uid, { ...current, ...oldPatchToNativePatch_ACU(patch) });
      }
    },
    async remove(name, uids) {
      assertBook(name);
      for (const uid of uids) draft.delete(Number(uid));
    },
  };

  const { data, flightModeOverride } = unwrapRequestPayload_ACU(await readTableData());
  assertCurrent();
  await renderTableWorldbookEntriesForRequest_ACU(data, book, entries, flightModeOverride);
  assertCurrent();
  const additions = [...draft].filter(([uid]) => !originalIds.has(uid)).map(([, entry]) => entry);
  for (const list of lists) {
    const next = list.flatMap(entry => {
      if (entry?.world !== book) return [entry];
      const replacement = draft.get(Number(entry.uid));
      return replacement ? [replacement] : [];
    });
    list.length = 0;
    for (const entry of next) list.push(entry);
    for (const entry of additions) list.push(entry);
  }
}
