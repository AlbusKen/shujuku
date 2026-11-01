import { gateWorldSimulationReadBatch_ACU, type WorldSimulationReadGateConfig_ACU,
  type WorldSimulationReadGateState_ACU, type WorldSimulationReadRejectReason_ACU } from './agent/agent-read-gate';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent/agent-token-budget';
import { buildWorldRecallIndex_ACU, queryWorldRecallManifestPage_ACU, type WorldRecallIndex_ACU } from './world-recall-index';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import type { WorldRecallLimits_ACU, WorldRecallManifestPage_ACU } from './world-recall-manifest';
import type { WorldActor_ACU, WorldClock_ACU, WorldLocationRef_ACU, WorldSimulationLedger_ACU } from './model';

export type WorldRecallGatedPage_ACU =
  | { allowed: true; manifest: WorldRecallManifestPage_ACU; nextCursor: string | null; tokens: number }
  | { allowed: false; reason: WorldSimulationReadRejectReason_ACU; report: string; tokens: number };

/** 先用 read gate 检查完整页；拒绝时不返回目录、ID 或 cursor，也不消耗读取额度。 */
export async function queryGatedWorldRecallPage_ACU(
  index: WorldRecallIndex_ACU, actors: readonly WorldActor_ACU[], clock: WorldClock_ACU,
  location: WorldLocationRef_ACU | null, limits: WorldRecallLimits_ACU, cursor: string | null,
  state: WorldSimulationReadGateState_ACU, config: WorldSimulationReadGateConfig_ACU,
  contextTokens: number, count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU,
): Promise<WorldRecallGatedPage_ACU> {
  const page = queryWorldRecallManifestPage_ACU(index, actors, clock, location, limits, cursor);
  const text = JSON.stringify(page.manifest);
  const decision = await gateWorldSimulationReadBatch_ACU([{ label: 'recall-page', text }], state, config, contextTokens, count);
  if (!decision.allowed) return {
    allowed: false, reason: decision.reason!, report: decision.report, tokens: decision.batchTokens,
  };
  state.grantedTokens += decision.batchTokens;
  return { allowed: true, manifest: page.manifest, nextCursor: page.nextCursor, tokens: decision.batchTokens };
}

const grantBrand_ACU: unique symbol = Symbol('WorldRecallGrant');
export type WorldRecallGrant_ACU = { readonly [grantBrand_ACU]: true };
const grants_ACU = new WeakMap<WorldRecallGrant_ACU, { fingerprint: string; scope: string; state: WorldSimulationReadGateState_ACU; manifests: WorldRecallManifestPage_ACU[] }>();
const scopeKey_ACU = (clock: WorldClock_ACU, location: WorldLocationRef_ACU | null): string => JSON.stringify([clock.day, clock.slot, location]);

/** 只接受本轮整轮门禁颁发的对象，不接受调用方自造清单。 */
export function verifiedWorldRecallManifests_ACU(
  grant: WorldRecallGrant_ACU, ledger: WorldSimulationLedger_ACU,
  clock: WorldClock_ACU, location: WorldLocationRef_ACU | null, state: WorldSimulationReadGateState_ACU,
): readonly WorldRecallManifestPage_ACU[] | null {
  const saved = grant && typeof grant === 'object' ? grants_ACU.get(grant) : undefined;
  return saved && saved.state === state && saved.scope === scopeKey_ACU(clock, location)
    && saved.fingerprint === sha256HexSync_ACU(JSON.stringify(ledger)) ? structuredClone(saved.manifests) : null;
}

export type WorldRecallGatedRound_ACU =
  | { allowed: true; manifests: WorldRecallManifestPage_ACU[]; grant: WorldRecallGrant_ACU; tokens: number }
  | { allowed: false; reason: WorldSimulationReadRejectReason_ACU | 'snapshot-changed'; report: string; tokens: number };

/** 页全部批准后才公开整轮 manifest；失败丢弃内存页且不占用调用方额度。 */
export async function queryGatedWorldRecallRound_ACU(
  ledger: WorldSimulationLedger_ACU, clock: WorldClock_ACU,
  location: WorldLocationRef_ACU | null, limits: WorldRecallLimits_ACU,
  state: WorldSimulationReadGateState_ACU, config: WorldSimulationReadGateConfig_ACU,
  contextTokens: number, count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU,
): Promise<WorldRecallGatedRound_ACU> {
  const fingerprint = sha256HexSync_ACU(JSON.stringify(ledger));
  const index = buildWorldRecallIndex_ACU(ledger);
  const actors = ledger.actors;
  const startingTokens = state.grantedTokens;
  const pending: WorldSimulationReadGateState_ACU = { grantedTokens: startingTokens };
  const manifests: WorldRecallManifestPage_ACU[] = [];
  let cursor: string | null = null;
  do {
    const page = await queryGatedWorldRecallPage_ACU(index, actors, clock, location, limits, cursor,
      pending, config, contextTokens, count);
    if (page.allowed === false) return { allowed: false, reason: page.reason, report: page.report, tokens: page.tokens };
    manifests.push(page.manifest);
    cursor = page.nextCursor;
  } while (cursor !== null);
  if (sha256HexSync_ACU(JSON.stringify(ledger)) !== fingerprint) {
    return { allowed: false, reason: 'snapshot-changed', report: '召回期间账本已变化，请重新开始整轮召回', tokens: 0 };
  }
  const grant = { [grantBrand_ACU]: true as const };
  grants_ACU.set(grant, { fingerprint, scope: scopeKey_ACU(clock, location), state, manifests: structuredClone(manifests) });
  state.grantedTokens = pending.grantedTokens;
  return { allowed: true, manifests, grant, tokens: pending.grantedTokens - startingTokens };
}
