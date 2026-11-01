import type { PlotInternalCausalView_ACU } from './plot-internal-causal';
import { validatePlotInternalCausalView_ACU } from './plot-internal-causal';

export type PlotInternalCausalResult_ACU = {
  schemaVersion: 1;
  viewFingerprint: string;
  selectedFactIds: string[];
};

const MAX_RAW_LENGTH_ACU = 32768;
const MAX_SELECTED_FACT_IDS_ACU = 64;

function fail_ACU(): never {
  throw new Error('内部因果任务回复格式无效。');
}

function isPlainRecord_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** 只接受冻结视图中存在的事实 ID，防止内部选择跨请求漂移。 */
export function parsePlotInternalCausalResult_ACU(
  raw: string,
  view: PlotInternalCausalView_ACU | null,
): PlotInternalCausalResult_ACU {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_LENGTH_ACU) fail_ACU();
  const validatedView = validatePlotInternalCausalView_ACU(view);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail_ACU();
  }
  if (!isPlainRecord_ACU(parsed) || Object.keys(parsed).length !== 1 || !Object.prototype.hasOwnProperty.call(parsed, 'selectedFactIds')
    || !Array.isArray(parsed.selectedFactIds) || parsed.selectedFactIds.length > MAX_SELECTED_FACT_IDS_ACU) {
    fail_ACU();
  }
  const selectedFactIds = parsed.selectedFactIds;
  const availableIds = new Set(validatedView.snapshot.facts.map((fact: any) => String(fact?.id ?? '')));
  const seen = new Set<string>();
  for (const factId of selectedFactIds) {
    if (typeof factId !== 'string' || !factId.trim() || seen.has(factId) || !availableIds.has(factId)) fail_ACU();
    seen.add(factId);
  }
  return {
    schemaVersion: 1,
    viewFingerprint: validatedView.fingerprint,
    selectedFactIds: structuredClone(selectedFactIds),
  };
}
