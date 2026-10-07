import {
  WORLD_SIMULATION_SCHEMA_VERSION_ACU,
  type WorldCollisionReport_ACU,
  type WorldSimulationEnvelope_ACU,
  type WorldSimulationLedgerModule_ACU,
  type WorldSimulationStagePlan_ACU,
  type WorldSimulationStageRevision_ACU,
  type WorldSimulationSettings_ACU,
} from './model';

const DIRECTOR_OWNED_SPECIALISTS_ACU = ['timekeeper', 'undercurrent-analyst', 'dramatis-keeper'] as const;
const DIRECTOR_OWNED_LEDGER_CHANGES_ACU: WorldSimulationLedgerModule_ACU[] = ['clock', 'dimensions', 'seeds', 'actors', 'rumors', 'player'];

/**
 * 新建 run 不再单独调用 planner LLM。阶段计划由确定性模板填入，
 * director 首轮把「锁定焦点」与取证/派工写进同一次决策。
 * chronicler 不进入常规 plannedSpecialists。
 */
export function buildDirectorOwnedStageRevision_ACU(input: {
  instruction: string;
  collisions: WorldCollisionReport_ACU;
  now?: number;
}): WorldSimulationStageRevision_ACU {
  const factsToVerify = [
    ...(input.collisions.collidedSeeds.length ? [`碰撞暗流：${input.collisions.collidedSeeds.join('、')}`] : []),
    ...(input.collisions.ripeRumors.length ? [`成熟传闻：${input.collisions.ripeRumors.join('、')}`] : []),
    '正文时间跨度',
    '维度压力与暗流生命周期',
    '行动者信息边界',
  ];
  const objective = input.instruction.trim() || '根据最新剧情推算幕后世界动态';
  return {
    revision: 1,
    createdAt: input.now ?? Date.now(),
    reason: 'initial',
    replanInstruction: '',
    frozen: false,
    plan: {
      schemaVersion: WORLD_SIMULATION_SCHEMA_VERSION_ACU,
      title: '本轮幕后推演',
      objective,
      impactScope: ['当前世界状态'],
      factsToVerify,
      plannedTools: ['read'],
      plannedSpecialists: [...DIRECTOR_OWNED_SPECIALISTS_ACU],
      expectedLedgerChanges: [...DIRECTOR_OWNED_LEDGER_CHANGES_ACU],
      convergenceConditions: ['证据与候选闭合'],
      blockingConditions: ['缺少锚点或关键证据'],
      completedSteps: [],
      nextStep: '取证后同批派工',
    },
  };
}


export function confirmWorldSimulationStageRevision_ACU(revision: WorldSimulationStageRevision_ACU): WorldSimulationStageRevision_ACU {
  if (revision.frozen) return { ...revision, plan: { ...revision.plan } };
  return { ...revision, frozen: true, plan: { ...revision.plan } };
}

export function replaceWorldSimulationStagePlan_ACU(revision: WorldSimulationStageRevision_ACU, plan: WorldSimulationStagePlan_ACU): WorldSimulationStageRevision_ACU {
  if (revision.frozen) throw new Error('WORLD_SIMULATION_STAGE_REVISION_FROZEN');
  if (plan.schemaVersion !== WORLD_SIMULATION_SCHEMA_VERSION_ACU) throw new Error('WORLD_SIMULATION_STAGE_PLAN_SCHEMA_INVALID');
  return { ...revision, plan: { ...plan } };
}

export function activeWorldSimulationStageRevision_ACU(envelope: WorldSimulationEnvelope_ACU): WorldSimulationStageRevision_ACU | null {
  const stage = envelope.stages.find(item => item.stageId === envelope.activeStageId);
  return stage?.revisions.find(item => item.revision === stage.activeRevision) ?? null;
}
