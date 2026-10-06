import { WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU, WORLD_SIMULATION_SINGLETON_ID_ACU,
  WorldSimulationValidationError_ACU, createWorldSimulationError_ACU,
  type WorldSimulationLedgerFieldSnapshot_ACU } from './model';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function requireValue(value: unknown): asserts value {
  if (!value) throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', '推演完整分栏基线结构无效', false));
}
function exact(value: Record<string, unknown>, keys: string[]) {
  requireValue(keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every(key => keys.includes(key)));
}

/** 分栏修订、完整状态和草稿一同保留；读取不重新分配修订。 */
export function validateWorldSimulationFieldSnapshot_ACU(raw: unknown): WorldSimulationLedgerFieldSnapshot_ACU {
  requireValue(record(raw) && record(raw.records));
  exact(raw, ['records']);
  for (const [module, rows] of Object.entries(raw.records)) {
    requireValue(Object.prototype.hasOwnProperty.call(WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU, module) && record(rows));
    const matrix = WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU[module as keyof typeof WORLD_SIMULATION_LEDGER_FIELD_MATRIX_ACU];
    for (const [id, row] of Object.entries(rows)) {
      requireValue(!['clock', 'player', 'guidance'].includes(module) || id === WORLD_SIMULATION_SINGLETON_ID_ACU);
      requireValue(record(row) && row.module === module && row.id === id && id.trim()
        && ['complete', 'partial', 'legacy_unknown'].includes(String(row.status))
        && record(row.fields) && Array.isArray(row.missingFields) && integer(row.updatedAt));
      exact(row, ['module', 'id', 'status', 'fields', 'missingFields', 'updatedAt']);
      const fields = row.fields;
      for (const [field, entry] of Object.entries(fields)) {
        requireValue(matrix.fields.includes(field) && record(entry) && integer(entry.revision) && integer(entry.updatedAt));
        exact(entry, ['value', 'revision', 'updatedAt']);
      }
      const missing = row.status === 'partial' ? matrix.required.filter(field => !(field in fields)) : [];
      requireValue(JSON.stringify(missing) === JSON.stringify(row.missingFields));
    }
  }
  return structuredClone(raw) as unknown as WorldSimulationLedgerFieldSnapshot_ACU;
}
