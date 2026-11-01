import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import { countWorldSimulationTokens_ACU } from '../../simulation/agent/agent-token-budget';
import type { ConfirmedSimulationCausalView_ACU } from '../../zero-layer/simulation-causal-view';
import type { WorldActor_ACU, WorldEvent_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU } from '../../simulation/model';

export const PLOT_INTERNAL_CAUSAL_MAX_TOKENS_ACU = 8192;

/** 普通剧情只允许携带真实宿主楼层身份，不能伪造为零层 logical ref。 */
export interface OrdinaryPlotCausalView_ACU {
  revision: number;
  source: { kind: 'host'; chatIdentity: string; messageKey: string; swipeId: string; contentDigest: string };
  worldEvents: WorldEvent_ACU[];
  actors: WorldActor_ACU[];
  historyMilestones: WorldHistoryMilestone_ACU[];
  facts: WorldFact_ACU[];
  fingerprint: string;
}

export type PlotInternalCausalView_ACU = ConfirmedSimulationCausalView_ACU | OrdinaryPlotCausalView_ACU;
export type ValidPlotInternalCausalView_ACU = PlotInternalCausalView_ACU;

const VIEW_KEYS_ACU = ['revision', 'source', 'worldEvents', 'actors', 'historyMilestones', 'facts', 'fingerprint'] as const;
const LOGICAL_SOURCE_KEYS_ACU = ['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'] as const;
const HOST_SOURCE_KEYS_ACU = ['kind', 'chatIdentity', 'messageKey', 'swipeId', 'contentDigest'] as const;
const INTERNAL_CAUSAL_DIRECTIVE_ACU = '以下为仅供本内部因果任务使用的已确认世界因果资料。它包含可能仍处于 locked 状态的资料；不得将其视为正文授权，不得改变事实揭示状态、任何角色认知或向用户输出。你的回复只能是严格 JSON 对象 {"selectedFactIds":["事实ID"]}；selectedFactIds 可为空数组，最多 64 个唯一且非空的本视图事实 ID。不得使用 Markdown fence、附加字段或任何额外文本。\n';

type ValidatedView_ACU = {
  canonical: string;
  fingerprint: string;
  snapshot: {
    revision: number;
    source: Record<string, string>;
    worldEvents: unknown[];
    actors: unknown[];
    historyMilestones: unknown[];
    facts: unknown[];
  };
};

function fail_ACU(message: string): never {
  throw new Error(message);
}

function abortError_ACU(): never {
  const error = new Error('内部因果资料构造已取消。');
  error.name = 'AbortError';
  throw error;
}

function isPlainRecord_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactKeys_ACU(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** 拒绝 accessor、循环、非有限数与宿主对象，保证序列化和指纹输入严格。 */
function validateJsonValue_ACU(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    return fail_ACU('内部因果资料结构无效。');
  }
  if (Array.isArray(value)) {
    if (seen.has(value) || Object.getOwnPropertySymbols(value).length > 0
      || Object.getOwnPropertyNames(value).some(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))) {
      return fail_ACU('内部因果资料结构无效。');
    }
    seen.add(value);
    for (const item of value) validateJsonValue_ACU(item, seen);
    seen.delete(value);
    return;
  }
  if (!isPlainRecord_ACU(value) || seen.has(value)) return fail_ACU('内部因果资料结构无效。');
  seen.add(value);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      return fail_ACU('内部因果资料结构无效。');
    }
    validateJsonValue_ACU(descriptor.value, seen);
  }
  seen.delete(value);
}

function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (isPlainRecord_ACU(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateSource_ACU(source: unknown): asserts source is Record<string, string> {
  if (!isPlainRecord_ACU(source)) fail_ACU('内部因果资料结构无效。');
  const hostSource = source.kind === 'host';
  if (!hasExactKeys_ACU(source, hostSource ? HOST_SOURCE_KEYS_ACU : LOGICAL_SOURCE_KEYS_ACU)) {
    fail_ACU('内部因果资料结构无效。');
  }
  const keys: readonly string[] = hostSource ? HOST_SOURCE_KEYS_ACU.filter(key => key !== 'kind') : LOGICAL_SOURCE_KEYS_ACU;
  if (hostSource && source.kind !== 'host') fail_ACU('内部因果资料结构无效。');
  for (const key of keys) {
    if (typeof source[key] !== 'string' || !source[key].trim()) fail_ACU('内部因果资料结构无效。');
  }
  const contentDigest = source.contentDigest;
  if (hostSource && (typeof contentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(contentDigest))) fail_ACU('内部因果资料结构无效。');
}

export function validatePlotInternalCausalView_ACU(view: PlotInternalCausalView_ACU | null): ValidatedView_ACU {
  if (!view || !isPlainRecord_ACU(view) || !hasExactKeys_ACU(view, VIEW_KEYS_ACU)) {
    fail_ACU('内部因果资料结构无效。');
  }
  validateJsonValue_ACU(view);
  if (!Number.isSafeInteger(view.revision) || view.revision < 0
    || typeof view.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(view.fingerprint)) {
    fail_ACU('内部因果资料结构无效。');
  }
  validateSource_ACU(view.source);
  if (!Array.isArray(view.worldEvents) || !Array.isArray(view.actors)
    || !Array.isArray(view.historyMilestones) || !Array.isArray(view.facts)) {
    fail_ACU('内部因果资料结构无效。');
  }
  const canonical = canonicalJson_ACU({
    revision: view.revision,
    ref: view.source,
    worldEvents: view.worldEvents,
    actors: view.actors,
    historyMilestones: view.historyMilestones,
    facts: view.facts,
  });
  if (sha256HexSync_ACU(canonical) !== view.fingerprint) fail_ACU('内部因果资料校验失败。');
  return {
    canonical,
    fingerprint: view.fingerprint,
    snapshot: structuredClone({
      revision: view.revision,
      source: view.source,
      worldEvents: view.worldEvents,
      actors: view.actors,
      historyMilestones: view.historyMilestones,
      facts: view.facts,
    }),
  };
}

function assertLive_ACU(
  view: PlotInternalCausalView_ACU | null,
  baseline: ValidatedView_ACU,
  options: { signal: AbortSignal; assertCurrent(): void },
): void {
  if (options.signal.aborted) abortError_ACU();
  options.assertCurrent();
  const current = validatePlotInternalCausalView_ACU(view);
  if (current.fingerprint !== baseline.fingerprint || current.canonical !== baseline.canonical) {
    fail_ACU('内部因果资料在构造期间已变化。');
  }
  if (options.signal.aborted) abortError_ACU();
  options.assertCurrent();
}

/** 完整内部资料不具备正文权限，调用方必须隔离模型原始输出。 */
export async function buildPlotInternalCausalMessage_ACU(
  view: PlotInternalCausalView_ACU | null,
  options: { signal: AbortSignal; assertCurrent(): void; countTokens?: (text: string) => Promise<number> },
): Promise<{ role: 'system'; content: string }> {
  const baseline = validatePlotInternalCausalView_ACU(view);
  assertLive_ACU(view, baseline, options);
  const content = `${INTERNAL_CAUSAL_DIRECTIVE_ACU}${JSON.stringify(baseline.snapshot)}`;
  const frozenContent = structuredClone(content);
  const count = options.countTokens ?? countWorldSimulationTokens_ACU;
  assertLive_ACU(view, baseline, options);
  let tokenCount: number;
  try {
    tokenCount = await count(frozenContent);
  } catch {
    fail_ACU('内部因果资料令牌预算计算失败。');
  }
  assertLive_ACU(view, baseline, options);
  if (!Number.isFinite(tokenCount) || tokenCount <= 0 || tokenCount > PLOT_INTERNAL_CAUSAL_MAX_TOKENS_ACU) {
    fail_ACU('内部因果资料令牌预算无效或超限。');
  }
  return { role: 'system', content: frozenContent };
}
