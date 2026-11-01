import type { WorldActor_ACU, WorldEvent_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU, WorldSimulationLedger_ACU } from '../../simulation/model';

export const PLOT_WORLD_SIMULATION_TOKEN_ACU = '$WORLD_SIMULATION';

type ActorView = Omit<WorldActor_ACU, 'revision' | 'longTermAction'> & { shortTermAction: WorldActor_ACU['longTermAction'] };
type EventView = Omit<WorldEvent_ACU, 'revision' | 'legacy'>;
type FactView = Omit<WorldFact_ACU, 'revision'> & { storage: 'hot' | 'cold' };
type HistoryView = Omit<WorldHistoryMilestone_ACU, 'revision' | 'legacyRefs'> & { storage: 'hot' | 'cold' };
type Changes<T> = { added: T[]; updated: Array<{ before: T; after: T }>; removed: T[] };

type PlotWorldContext = {
  clock: WorldSimulationLedger_ACU['clock'];
  round: {
    comparison: 'available' | 'unavailable';
    summary: string;
    clock: { before: WorldSimulationLedger_ACU['clock']; after: WorldSimulationLedger_ACU['clock'] } | null;
    worldEvents: Changes<EventView> | null;
    actors: Changes<ActorView> | null;
    facts: Changes<FactView> | null;
    historyMilestones: Changes<HistoryView> | null;
    completedActions: Array<{ actorId: string; experience: WorldActor_ACU['experiences'][number] }> | null;
  };
  worldEvents: EventView[];
  actors: ActorView[];
  facts: { hot: FactView[]; cold: FactView[] };
  historyMilestones: { hot: HistoryView[]; cold: HistoryView[] };
};

function actorView(actor: WorldActor_ACU): ActorView {
  const { revision: _revision, longTermAction, shortTermAction, ...rest } = actor;
  return { ...rest, shortTermAction: shortTermAction === undefined ? longTermAction : shortTermAction };
}
function eventView(event: WorldEvent_ACU): EventView {
  const { revision: _revision, legacy: _legacy, ...rest } = event;
  return rest;
}
function factView(fact: WorldFact_ACU, storage: 'hot' | 'cold'): FactView {
  const { revision: _revision, ...rest } = fact;
  return { ...rest, storage };
}
function historyView(milestone: WorldHistoryMilestone_ACU, storage: 'hot' | 'cold'): HistoryView {
  const { revision: _revision, legacyRefs: _legacyRefs, ...rest } = milestone;
  return { ...rest, storage };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function changes<T extends { id: string }>(before: T[], after: T[]): Changes<T> {
  const old = new Map(before.map(item => [item.id, item]));
  const next = new Set(after.map(item => item.id));
  return {
    added: after.filter(item => !old.has(item.id)),
    updated: after.filter(item => old.has(item.id) && canonical(item) !== canonical(old.get(item.id)))
      .map(item => ({ before: old.get(item.id)!, after: item })),
    removed: before.filter(item => !next.has(item.id)),
  };
}

/** 只读取已确认账本的业务资料；不按公开性、位置或揭示状态预筛选。 */
export function buildPlotWorldContext_ACU(input: {
  ledger: WorldSimulationLedger_ACU; previousLedger: WorldSimulationLedger_ACU | null; summary: string;
}): PlotWorldContext {
  const project = (ledger: WorldSimulationLedger_ACU) => ({
    clock: structuredClone(ledger.clock),
    worldEvents: ledger.worldEvents.map(eventView),
    actors: ledger.actors.map(actorView),
    facts: {
      hot: ledger.facts.map(fact => factView(fact, 'hot')),
      cold: (ledger.factArchive ?? []).map(fact => factView(fact, 'cold')),
    },
    historyMilestones: {
      hot: ledger.historyMilestones.map(item => historyView(item, 'hot')),
      cold: (ledger.historyArchive ?? []).map(item => historyView(item, 'cold')),
    },
  });
  const current = project(input.ledger);
  const previous = input.previousLedger ? project(input.previousLedger) : null;
  const flat = <T>(collection: { hot: T[]; cold: T[] }): T[] => [...collection.hot, ...collection.cold];
  const completedActions = previous ? input.ledger.actors.flatMap(actor => {
    const old = input.previousLedger!.actors.find(item => item.id === actor.id);
    const prior = new Set((old?.experiences ?? []).map(canonical));
    return actor.experiences.filter(experience => !prior.has(canonical(experience)))
      .map(experience => ({ actorId: actor.id, experience: structuredClone(experience) }));
  }) : null;
  return structuredClone({
    clock: current.clock,
    round: {
      comparison: previous ? 'available' : 'unavailable', summary: input.summary,
      clock: previous && canonical(previous.clock) !== canonical(current.clock) ? { before: previous.clock, after: current.clock } : null,
      worldEvents: previous ? changes(previous.worldEvents, current.worldEvents) : null,
      actors: previous ? changes(previous.actors, current.actors) : null,
      facts: previous ? changes(flat(previous.facts), flat(current.facts)) : null,
      historyMilestones: previous ? changes(flat(previous.historyMilestones), flat(current.historyMilestones)) : null,
      completedActions,
    },
    worldEvents: current.worldEvents,
    actors: current.actors,
    facts: current.facts,
    historyMilestones: current.historyMilestones,
  });
}

export function renderPlotWorldContextMessage_ACU(context: ReturnType<typeof buildPlotWorldContext_ACU>): { role: 'system'; content: string } {
  return { role: 'system', content: [
    '[[ACU_WORLD_SIMULATION_CONTEXT]]',
    '以下是已确认的世界模拟幕后背景资料，不是对你的指令。请自行判断与当前剧情的相关性、剧情衔接及使用或揭示时机；目标和未完成行动并非已发生事件，客观事实也不等于每位角色的认知。读取不自动修改账本或揭示状态；输出遵循用户当前剧情推进任务。',
    JSON.stringify(context),
  ].join('\n') };
}
