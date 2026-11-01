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

// 计划仅保存协议元数据，业务范围由召回清单和候选校验决定。
export function buildWorldRoundStageRevision_ACU(input: { revision?: number; now?: number; workflowMode: 'single' | 'layered' }): WorldSimulationStageRevision_ACU {
  return {
    revision: input.revision ?? 1,
    createdAt: input.now ?? Date.now(),
    reason: 'initial',
    replanInstruction: '',
    frozen: false,
    plan: {
      schemaVersion: WORLD_SIMULATION_SCHEMA_VERSION_ACU,
      title: '受限整轮世界推演',
      objective: '生成经召回和本地校验的整轮账本候选',
      impactScope: ['世界账本'],
      factsToVerify: ['冻结锚点正文', '召回清单与实体修订'],
      plannedTools: [],
      plannedSpecialists: input.workflowMode === 'single'
        ? ['clock-recaller', 'world-simulator']
        : ['clock-recaller', 'world-event-analyst', 'actor-simulator'],
      expectedLedgerChanges: ['clock', 'actors'],
      convergenceConditions: ['整轮候选通过本地物化校验'],
      blockingConditions: ['锚点、运行租约或账本修订变化'],
      completedSteps: [],
      nextStep: '执行受限整轮候选',
    },
  };
}

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
