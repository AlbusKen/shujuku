import {
  createLorebookEntries_ACU, deleteLorebookEntries_ACU, getLorebookEntries_ACU, setLorebookEntries_ACU,
} from '../../data/gateways/worldbook-gateway';

/** The existing table export can write to the host book or to a single request's entries. */
export interface TableWorldbookEntryStore_ACU {
  get: typeof getLorebookEntries_ACU;
  set: typeof setLorebookEntries_ACU;
  create: typeof createLorebookEntries_ACU;
  remove: typeof deleteLorebookEntries_ACU;
}

export const liveTableWorldbookEntryStore_ACU: TableWorldbookEntryStore_ACU = {
  get: (...args) => getLorebookEntries_ACU(...args),
  set: (...args) => setLorebookEntries_ACU(...args),
  create: (...args) => createLorebookEntries_ACU(...args),
  remove: (...args) => deleteLorebookEntries_ACU(...args),
};
