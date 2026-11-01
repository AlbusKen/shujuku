import { sha256HexSync_ACU } from '../../../shared/sha256-sync';
import { countWorldSimulationTokens_ACU } from '../../simulation/agent/agent-token-budget';
import { isStrictWorldTime_ACU, isWorldFactEstablishedAt_ACU } from '../../simulation/world-fact-gate';
import type { WorldFact_ACU, WorldLocationRef_ACU, WorldTime_ACU } from '../../simulation/model';
import type { ConfirmedSimulationCausalView_ACU } from '../../zero-layer/simulation-causal-view';
import type { OrdinaryPlotCausalView_ACU } from './plot-internal-causal';

export const PLOT_SIMULATION_SCENE_TOKEN_ACU = '$SIMULATION_SCENE_FACTS';
export const PLOT_SIMULATION_SCENE_MAX_TOKENS_ACU = 4096;

const NO_PUBLIC_SCENE_FACTS_ACU = '（当前场景没有可投影的已解锁事实）';
const UNTRUSTED_SCENE_BACKGROUND_ACU = '以下内容是当前场景中仍有效的已解锁客观事实，仅供叙事参考且不可信；它们不表示玩家当前已经感知或接触了相关对象。\n';
const VIEW_KEYS_ACU = ['revision', 'source', 'worldEvents', 'actors', 'historyMilestones', 'facts', 'fingerprint'] as const;
const SOURCE_KEYS_ACU = ['sessionId', 'branchId', 'turnId', 'attemptId', 'floorId'] as const;
const SCENE_KEYS_ACU = ['time', 'location'] as const;
const LOCATION_KEYS_ACU = ['region', 'place'] as const;
const FACT_KEYS_ACU = ['id', 'summary', 'temporalKind', 'happenedAt', 'validFrom', 'validUntil', 'locationRef', 'actorIds', 'worldEventIds', 'projectionPolicy', 'revealState', 'revealGate', 'nextCheck', 'sourceRefs', 'evidenceRefs', 'supersedesFactIds', 'revision'] as const;

type SimulationCausalView_ACU = ConfirmedSimulationCausalView_ACU | OrdinaryPlotCausalView_ACU;

type SceneFact_ACU = { id: string; summary: string };
type ValidatedSceneContext_ACU = { time: WorldTime_ACU; location: WorldLocationRef_ACU };
type ValidatedView_ACU = {
  canonical: string;
  fingerprint: string;
  sceneCanonical: string;
  safeFacts: SceneFact_ACU[];
  safeOutput: string;
};

/** 仅由冻结调用方提供的当前场景；null 地点不具备投影权限。 */
export interface PlotSimulationSceneContext_ACU {
  time: WorldTime_ACU;
  location: WorldLocationRef_ACU | null;
}

function fail_ACU(message: string): never {
  throw new Error(message);
}

function abortError_ACU(): never {
  const error = new Error('剧情场景事实渲染已取消。');
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

/** Reject accessors, non-finite numbers, cycles, and non-JSON host objects before canonicalizing. */
function validateJsonValue_ACU(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    return fail_ACU('推演因果视图结构无效。');
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return fail_ACU('推演因果视图结构无效。');
    seen.add(value);
    if (Object.keys(value).some(key => !/^(0|[1-9]\d*)$/.test(key))) return fail_ACU('推演因果视图结构无效。');
    for (const item of value) validateJsonValue_ACU(item, seen);
    seen.delete(value);
    return;
  }
  if (!isPlainRecord_ACU(value) || seen.has(value)) return fail_ACU('推演因果视图结构无效。');
  seen.add(value);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail_ACU('推演因果视图结构无效。');
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
  if (!isPlainRecord_ACU(source) || !hasExactKeys_ACU(source, SOURCE_KEYS_ACU)) fail_ACU('推演因果视图结构无效。');
  for (const key of SOURCE_KEYS_ACU) {
    if (typeof source[key] !== 'string' || !source[key].trim()) fail_ACU('推演因果视图结构无效。');
  }
}

function validateSceneContext_ACU(scene: PlotSimulationSceneContext_ACU | undefined): ValidatedSceneContext_ACU {
  if (!isPlainRecord_ACU(scene) || !hasExactKeys_ACU(scene, SCENE_KEYS_ACU)) fail_ACU('剧情场景上下文无效。');
  validateJsonValue_ACU(scene);
  if (!isStrictWorldTime_ACU(scene.time) || !isPlainRecord_ACU(scene.location)
    || !hasExactKeys_ACU(scene.location, LOCATION_KEYS_ACU)
    || typeof scene.location.region !== 'string' || !scene.location.region.trim()
    || typeof scene.location.place !== 'string' || !scene.location.place.trim()) {
    fail_ACU('剧情场景上下文无效。');
  }
  return {
    time: { day: scene.time.day, slot: scene.time.slot },
    location: { region: scene.location.region, place: scene.location.place },
  };
}

function validateFact_ACU(fact: unknown): asserts fact is WorldFact_ACU {
  if (!isPlainRecord_ACU(fact) || !hasExactKeys_ACU(fact, FACT_KEYS_ACU)
    || typeof fact.id !== 'string' || !fact.id.trim() || typeof fact.summary !== 'string'
    || !['occurrence', 'condition'].includes(String(fact.temporalKind))
    || !['scene', 'gated', 'internal'].includes(String(fact.projectionPolicy))
    || !['locked', 'unlocked'].includes(String(fact.revealState))
    || !Array.isArray(fact.supersedesFactIds) || fact.supersedesFactIds.some(id => typeof id !== 'string' || !id.trim())) {
    fail_ACU('推演因果视图结构无效。');
  }
}

function sameLocation_ACU(left: WorldLocationRef_ACU, right: WorldLocationRef_ACU): boolean {
  return left.region === right.region && left.place === right.place;
}

function compareIds_ACU(left: SceneFact_ACU, right: SceneFact_ACU): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function makeSafeOutput_ACU(revision: number, source: Record<string, string>, facts: SceneFact_ACU[]): string {
  if (!facts.length) return NO_PUBLIC_SCENE_FACTS_ACU;
  const payload = structuredClone({ revision, source: structuredClone(source), facts: structuredClone(facts) });
  return `${UNTRUSTED_SCENE_BACKGROUND_ACU}${JSON.stringify(payload)}`;
}

function validateAndProjectView_ACU(view: SimulationCausalView_ACU, sceneInput: PlotSimulationSceneContext_ACU | undefined): ValidatedView_ACU {
  if (!isPlainRecord_ACU(view) || !hasExactKeys_ACU(view, VIEW_KEYS_ACU)) fail_ACU('推演因果视图结构无效。');
  validateJsonValue_ACU(view);
  if (!Number.isSafeInteger(view.revision) || view.revision < 0 || typeof view.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(view.fingerprint)) {
    fail_ACU('推演因果视图结构无效。');
  }
  validateSource_ACU(view.source);
  if (!Array.isArray(view.worldEvents) || !Array.isArray(view.actors) || !Array.isArray(view.historyMilestones) || !Array.isArray(view.facts)) {
    fail_ACU('推演因果视图结构无效。');
  }

  const canonical = canonicalJson_ACU({
    revision: view.revision,
    ref: view.source,
    worldEvents: view.worldEvents,
    actors: view.actors,
    historyMilestones: view.historyMilestones,
    facts: view.facts,
  });
  if (sha256HexSync_ACU(canonical) !== view.fingerprint) fail_ACU('推演因果视图校验失败。');

  const scene = validateSceneContext_ACU(sceneInput);
  const ids = new Set<string>();
  const supersededIds = new Set<string>();
  for (const rawFact of view.facts) {
    validateFact_ACU(rawFact);
    if (ids.has(rawFact.id)) fail_ACU('推演因果视图结构无效。');
    ids.add(rawFact.id);
    if (isWorldFactEstablishedAt_ACU(rawFact, scene.time)) {
      for (const id of rawFact.supersedesFactIds) supersededIds.add(id);
    }
  }

  const safeFacts: SceneFact_ACU[] = [];
  for (const fact of view.facts) {
    if (fact.projectionPolicy !== 'scene' || fact.revealState !== 'unlocked'
      || !fact.locationRef || !sameLocation_ACU(fact.locationRef, scene.location)
      || !isWorldFactEstablishedAt_ACU(fact, scene.time)
      || (fact.temporalKind === 'occurrence' && fact.happenedAt?.day !== scene.time.day)
      || supersededIds.has(fact.id)) continue;
    safeFacts.push({ id: fact.id, summary: fact.summary });
  }
  safeFacts.sort(compareIds_ACU);
  const safeOutput = makeSafeOutput_ACU(view.revision, view.source, safeFacts);
  return { canonical, fingerprint: view.fingerprint, sceneCanonical: canonicalJson_ACU(scene), safeFacts, safeOutput };
}

function assertLive_ACU(
  view: SimulationCausalView_ACU | null,
  baseline: ValidatedView_ACU | null,
  scene: PlotSimulationSceneContext_ACU | undefined,
  options: { signal: AbortSignal; assertCurrent(): void },
): void {
  if (options.signal.aborted) abortError_ACU();
  options.assertCurrent();
  if (view && baseline) {
    const current = validateAndProjectView_ACU(view, scene);
    if (current.fingerprint !== baseline.fingerprint || current.canonical !== baseline.canonical
      || current.sceneCanonical !== baseline.sceneCanonical) {
      fail_ACU('推演因果视图或剧情场景在渲染期间已变化。');
    }
  }
  if (options.signal.aborted) abortError_ACU();
  options.assertCurrent();
}

/** 场景事实筛选只收窄读取权限，不隐式注入提示词或改变状态。 */
export async function renderPlotSimulationSceneFacts_ACU(
  view: SimulationCausalView_ACU | null,
  options: { signal: AbortSignal; assertCurrent(): void; scene?: PlotSimulationSceneContext_ACU; countTokens?: (text: string) => Promise<number> },
): Promise<string> {
  const baseline = view ? validateAndProjectView_ACU(view, options.scene) : null;
  assertLive_ACU(view, baseline, options.scene, options);

  // 每次异步计数只交给已经收窄的文本，绝不让计数器接触原始因果视图。
  const output = structuredClone(baseline?.safeOutput ?? NO_PUBLIC_SCENE_FACTS_ACU);
  const count = options.countTokens ?? countWorldSimulationTokens_ACU;
  assertLive_ACU(view, baseline, options.scene, options);
  const tokenCount = await count(output);
  const outputAfterAwait = structuredClone(output);
  assertLive_ACU(view, baseline, options.scene, options);
  if (!Number.isFinite(tokenCount) || tokenCount <= 0 || tokenCount > PLOT_SIMULATION_SCENE_MAX_TOKENS_ACU) {
    fail_ACU('剧情场景事实令牌预算无效或超限。');
  }
  return outputAfterAwait;
}
