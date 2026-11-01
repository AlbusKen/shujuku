import { verifiedWorldRecallManifests_ACU, type WorldRecallGrant_ACU } from './world-recall-gate';
import type { WorldRecallManifestPage_ACU } from './world-recall-manifest';
import { gateWorldSimulationReadBatch_ACU, type WorldSimulationReadGateConfig_ACU,
  type WorldSimulationReadGateState_ACU } from './agent/agent-read-gate';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent/agent-token-budget';
import type { WorldClock_ACU, WorldFact_ACU, WorldLocationRef_ACU, WorldSimulationLedger_ACU } from './model';
import { allWorldFacts_ACU } from './fact-archive';

export type WorldRecallScope_ACU = 'world' | 'actor' | 'projection-check';
export type WorldRecallAddress_ACU = `worldEvents:${string}` | `actors:${string}`
  | `historyMilestones:${string}` | `facts:${string}`;

export interface WorldRecallReadPermit_ACU {
  scope: WorldRecallScope_ACU;
  address: WorldRecallAddress_ACU;
  actorId?: string;
}

export type WorldRecallReadResult_ACU = { status: 'ok'; value: unknown }
  | { status: 'safe-directory'; value: { id: string; locked: true } }
  | { status: 'denied'; reason: string };

function allowed_ACU(manifests: readonly WorldRecallManifestPage_ACU[], address: WorldRecallAddress_ACU): boolean {
  return manifests.some(page => page.actorIds.some(id => address === `actors:${id}`)
    || page.actors.some(actor => [...actor.recentHistoryIds, ...actor.relatedHistoryIds]
      .some(id => address === `historyMilestones:${id}`))
    || page.dueEventIds.some(id => address === `worldEvents:${id}`)
    || [...page.dueFactIds, ...page.sceneFactIds, ...page.projectionCheckIds]
      .some(id => address === `facts:${id}`));
}

/** 不改变事实揭示状态；投影阶段只能取得 locked 的安全目录，不能以自报证据读取全文。 */
function readWorldRecallAddress_ACU(
  ledger: WorldSimulationLedger_ACU, grant: WorldRecallGrant_ACU, permit: WorldRecallReadPermit_ACU,
  clock: WorldClock_ACU, location: WorldLocationRef_ACU | null, state: WorldSimulationReadGateState_ACU,
): WorldRecallReadResult_ACU {
  const manifests = verifiedWorldRecallManifests_ACU(grant, ledger, clock, location, state);
  if (!manifests) return { status: 'denied', reason: '整轮召回许可未批准或账本已变化' };
  if (!allowed_ACU(manifests, permit.address)) return { status: 'denied', reason: '地址未进入本轮召回清单' };
  if (permit.scope === 'actor') {
    if (!permit.actorId) return { status: 'denied', reason: '人物阶段缺少绑定的 actorId' };
    const actorPage = manifests.find(page => page.actorIds.includes(permit.actorId!));
    if (!actorPage) return { status: 'denied', reason: '人物未进入本轮处理页' };
    if (permit.address.startsWith('actors:') && permit.address !== `actors:${permit.actorId}`) {
      return { status: 'denied', reason: '人物阶段不能读取其他人物完整状态' };
    }
    if (permit.address.startsWith('historyMilestones:') && !actorPage.actors.some(actor =>
      actor.actorId === permit.actorId && [...actor.recentHistoryIds, ...actor.relatedHistoryIds]
        .some(id => permit.address === `historyMilestones:${id}`))) {
      return { status: 'denied', reason: '人物阶段只能读取本人被召回的历史' };
    }
  }
  const separator = permit.address.indexOf(':');
  const module = permit.address.slice(0, separator);
  const id = permit.address.slice(separator + 1);
  const rows = module === 'worldEvents' ? ledger.worldEvents : module === 'actors' ? ledger.actors
    : module === 'historyMilestones' ? [...ledger.historyMilestones, ...(ledger.historyArchive ?? [])] : module === 'facts' ? allWorldFacts_ACU(ledger) : [];
  const row = rows.find(item => item.id === id);
  if (!row) return { status: 'denied', reason: '召回对象不存在或已变化' };
  if (module === 'actors' && permit.scope !== 'actor') return { status: 'denied', reason: '人物只供人物阶段读取' };
  if (module === 'worldEvents' && permit.scope !== 'world') return { status: 'denied', reason: '世界事件只供世界阶段读取' };
  if (module === 'historyMilestones' && permit.scope !== 'actor') return { status: 'denied', reason: '人物历史只供人物阶段读取' };
  if (module === 'facts') {
    const fact = row as WorldFact_ACU;
    if (permit.scope === 'actor') return { status: 'denied', reason: '人物阶段无权精读事实' };
    if (permit.scope === 'world' && !manifests.some(page => page.dueFactIds.includes(fact.id))) {
      return { status: 'denied', reason: '世界阶段仅可读取到期事实' };
    }
    if (permit.scope === 'projection-check') {
      if (!manifests.some(page => [...page.sceneFactIds, ...page.projectionCheckIds].includes(fact.id))) {
        return { status: 'denied', reason: '事实未进入投影候选' };
      }
      if (fact.revealState === 'locked') return { status: 'safe-directory', value: { id: fact.id, locked: true } };
    }
  }
  return { status: 'ok', value: structuredClone(row) };
}

/** 实际精读的全文也必须经过独立 read gate；不通过时仅返回拒绝原因。 */
export async function readGatedWorldRecallAddress_ACU(
  ledger: WorldSimulationLedger_ACU, grant: WorldRecallGrant_ACU, permit: WorldRecallReadPermit_ACU,
  state: WorldSimulationReadGateState_ACU, config: WorldSimulationReadGateConfig_ACU,
  contextTokens: number, clock: WorldClock_ACU, location: WorldLocationRef_ACU | null, count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU,
): Promise<WorldRecallReadResult_ACU> {
  const selected = readWorldRecallAddress_ACU(ledger, grant, permit, clock, location, state);
  if (selected.status !== 'ok') return selected;
  const text = JSON.stringify(selected.value);
  const decision = await gateWorldSimulationReadBatch_ACU([{ label: permit.address, text }], state, config, contextTokens, count);
  if (!decision.allowed) return { status: 'denied', reason: decision.report };
  state.grantedTokens += decision.batchTokens;
  return selected;
}
