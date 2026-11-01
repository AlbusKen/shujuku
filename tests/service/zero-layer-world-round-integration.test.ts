import { afterEach, describe, expect, it, vi } from 'vitest';
// 上游已停用零层；这里打开功能开关，以继续验证零层存储逻辑。
vi.mock('../../src/service/zero-layer/feature-policy', () => ({
  isZeroLayerFeatureEnabled_ACU: () => true,
  assertZeroLayerFeatureEnabled_ACU: () => undefined,
}));

const { productionModel, productionWorldbook, confirmRegistration, sceneTokenCounter, sceneTokenCounterEnabled } = vi.hoisted(() => ({
  productionModel: vi.fn(), productionWorldbook: vi.fn(), confirmRegistration: vi.fn(async () => true),
  sceneTokenCounter: vi.fn<(text: string) => Promise<number>>(), sceneTokenCounterEnabled: { value: false },
}));
vi.mock('../../src/service/simulation/agent/agent-token-budget', async original => {
  const module = await original<typeof import('../../src/service/simulation/agent/agent-token-budget')>();
  return { ...module, countWorldSimulationTokens_ACU: (text: string) => sceneTokenCounterEnabled.value
    ? sceneTokenCounter(text) : module.countWorldSimulationTokens_ACU(text) };
});
vi.mock('../../src/presentation/theme/confirm-actor-registration', () => ({
  confirmWorldActorRegistration_ACU: confirmRegistration,
}));
vi.mock('../../src/service/ai/api-call', async original => ({
  ...await original<typeof import('../../src/service/ai/api-call')>(),
  callAIChatTurn_ACU: productionModel,
}));
vi.mock('../../src/service/continuation/agent/agent-worldbook-read', async original => ({
  ...await original<typeof import('../../src/service/continuation/agent/agent-worldbook-read')>(),
  loadAgentWorldbookSnapshot_ACU: productionWorldbook,
}));
import { buildDefaultWorldSimulationEnvelope_ACU } from '../../src/service/simulation/defaults';
import { runWorldRound_ACU } from '../../src/service/simulation/agent/world-round-runner';
import { prepareWorldRoundRun_ACU } from '../../src/service/simulation/agent/world-round-prepare';
import { WorldSimulationOrchestrator_ACU, resetWorldSimulationOrchestratorStateForTests_ACU } from '../../src/service/simulation/simulation-orchestrator';
import { WorldSimulationRuntime_ACU } from '../../src/service/simulation/simulation-runtime';
import { resetWorldSimulationSessionLogForTests_ACU } from '../../src/service/simulation/agent/agent-session-log';
import { settings_ACU } from '../../src/service/runtime/state-manager';
import { seedLedgerFieldView_ACU } from '../../src/service/simulation/simulation-ledger-fold';
import { commitZeroLayerSimulationFinal_ACU, commitZeroLayerSimulationRound_ACU } from '../../src/service/zero-layer/simulation-commit';
import { buildWorldFactBodyProjection_ACU } from '../../src/service/simulation/simulation-projection';
import { emptyZeroLayerSimulation_ACU, ZeroLayerSimulationStore_ACU } from '../../src/service/zero-layer/simulation-store';
import { emptyZeroLayerContinuation_ACU } from '../../src/service/zero-layer/continuation-store';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { ZERO_LAYER_CARRIER_FIELD_ACU, type ZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/model';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldSimulationRunIdentity_ACU } from '../../src/service/simulation/model';
import { buildWorldRunMaterials_ACU, sameWorldRunMaterials_ACU } from '../../src/service/simulation/world-run-materials';
import { getTableDataFingerprint_ACU } from '../../src/service/table/table-data-upgrade-audit';
import type { ZeroLayerTableInput_ACU, ZeroLayerTableResult_ACU } from '../../src/service/zero-layer/model';
import type { TableDataObject_ACU } from '../../src/shared/models/table-data';
import type { AgentWorldbookSnapshot_ACU } from '../../src/service/continuation/agent/agent-worldbook-read';
import { readWorldRoundPayload_ACU } from '../helpers/world-round-payload';

const logicalBody = '逻辑正文：角色在广场等待，正文不得被推演信号改写。';
const propagationBody = '主角在远方休息';
const originInstruction = '根据已保存逻辑正文推进世界';
const propagationLocation = { region: '城区', place: '钟楼' };
const propagationKnowledge = '北门关闭';
const propagationChannel = '当面告知';
const propagationSourceActorId = 'messenger';
const propagationReceiverActorId = 'guard';
const propagationSourceFactId = 'fact-messenger-guard-north-gate';
const propagationSourceFactSummary = '信使通过当面告知向守卫说明北门关闭。';

function worldbookSnapshot(content = '小世界书正文：广场守卫只记录已发生的行动。'): AgentWorldbookSnapshot_ACU {
  return {
    available: true,
    entries: [{
      bookName: '零层测试设定集', uid: 'fixture-entry', title: '广场守卫', keys: ['广场', '守卫'],
      constant: false, preventRecursion: false, excludeRecursion: false, content, tokens: 12,
    }],
  };
}

type Mode = 'single' | 'layered';
type Fixture = Awaited<ReturnType<typeof createFixture>>;

function actor(id: string) {
  return {
    id, name: id, interests: [], location: '', locationRef: null, life: 'alive' as const,
    diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [],
    informationSources: [], knownFacts: [], visibility: 'hidden' as const, currentAction: null,
    shortTermAction: null, longTermAction: null, loreRefs: [], experiences: [],
    simulationStatus: 'active' as const, revision: 1,
  };
}

function identityFor(store: ZeroLayerSimulationStore_ACU, mode: Mode): WorldSimulationRunIdentity_ACU {
  return {
    runId: `run-${mode}`, chatIdentity: store.getChatIdentity(), triggerKind: 'assistant_completed',
    triggerConversationMessageId: null, kind: 'logical',
    logicalRef: { sessionId: 'session-1', branchId: 'branch-1', turnId: 'turn-1', attemptId: 'attempt-1', floorId: 'floor-1' },
    anchorContentDigest: '', baseLedgerRevision: 0, taskId: `task-${mode}`, stageId: `stage-${mode}`,
    stageRevision: 1, deliveryTarget: 'body', workflowMode: mode, workflowProtocol: 'world-round-v1',
  };
}

function reservedStage(identity: WorldSimulationRunIdentity_ACU) {
  return {
    task: {
      taskId: identity.taskId, originInstruction, status: 'running' as const,
      createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null,
    },
    activeStageId: identity.stageId,
    stages: [{
      stageId: identity.stageId, stageNumber: 1, status: 'running' as const, activeRevision: identity.stageRevision,
      revisions: [{
        revision: identity.stageRevision, createdAt: 1, reason: 'initial' as const, replanInstruction: '', frozen: true,
        plan: {
          schemaVersion: 1, title: '预留的新整轮', objective: '仅结算真实整轮候选', impactScope: [],
          factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: [],
          convergenceConditions: [], blockingConditions: [], completedSteps: [], nextStep: '',
        },
      }],
    }],
  };
}

function historicalMilestone(id: string, day: number, actorId = 'actor-00') {
  return {
    id, summary: `既有重要历史 ${id}`, happenedAt: { day, slot: '' }, actorIds: [actorId], worldEventIds: [],
    locationRef: null, sourceFactIds: [], importance: 1, category: '既有行动', visibility: 'internal' as const,
    revision: 1, legacyRefs: [],
  };
}

async function createFixture(options: {
  actors?: number; mode?: Mode; signal?: boolean; reserve?: boolean; knowledgeActor?: boolean; propagation?: boolean; historyMilestones?: number; expiredFact?: boolean; agedColdFact?: boolean; prunable?: boolean; prunableEvents?: boolean;
  recording?: { delivered: boolean; written: boolean; failSave?: boolean }; longAnchor?: string;
  tables?: { input?: TableDataObject_ACU; durable?: TableDataObject_ACU; candidate?: TableDataObject_ACU };
} = {}) {
  const carrier: Record<string, unknown> = { is_user: false, mes: '物理正文：不得改写', swipe_id: 0 };
  const chat = [carrier];
  const envelope = buildDefaultWorldSimulationEnvelope_ACU();
  const mode = options.mode ?? 'layered';
  envelope.settings.workflowMode = mode;
  const simulation = emptyZeroLayerSimulation_ACU();
  envelope.ledger.actors = Array.from({ length: options.actors ?? 1 }, (_, index) => actor(`actor-${String(index).padStart(2, '0')}`));
  if (options.knowledgeActor) {
    envelope.ledger.actors[0] = {
      ...envelope.ledger.actors[0], name: '角色', informationSources: ['亲耳听闻'], knownFacts: ['广场按时开放'],
      location: '广场', locationRef: { region: '城区', place: '广场' },
    };
  }
  if (options.propagation) {
    envelope.ledger.actors = [
      { ...actor(propagationSourceActorId), name: '信使', informationSources: [], knownFacts: [propagationKnowledge], location: '钟楼', locationRef: { ...propagationLocation } },
      { ...actor(propagationReceiverActorId), name: '守卫', informationSources: [propagationChannel], knownFacts: [], location: '钟楼', locationRef: { ...propagationLocation } },
      ...Array.from({ length: Math.max(0, (options.actors ?? 2) - 2) }, (_, index) => actor(`actor-${String(index).padStart(2, '0')}`)),
    ];
    envelope.ledger.facts = [{
      id: propagationSourceFactId, summary: propagationSourceFactSummary, temporalKind: 'occurrence',
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: { ...propagationLocation },
      actorIds: [propagationSourceActorId, propagationReceiverActorId], worldEventIds: [], projectionPolicy: 'internal',
      revealState: 'locked', revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1,
    }];
  }
  if (options.historyMilestones) {
    envelope.ledger.historyMilestones = Array.from({ length: options.historyMilestones }, (_, index) =>
      historicalMilestone(`history-seed-${String(index + 1).padStart(2, '0')}`, index + 1));
  }
  if (options.recording) envelope.ledger.historyMilestones = [{ ...historicalMilestone('delivered-history', 1),
    summary: '守卫曾在暴雨夜关闭北门' }];
  if (options.expiredFact) envelope.ledger.facts = [{ id: 'expired', summary: '昨日封路', temporalKind: 'condition', happenedAt: null,
    validFrom: { day: 1, slot: '' }, validUntil: { day: 1, slot: '' }, locationRef: null, actorIds: [], worldEventIds: [],
    projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null, sourceRefs: ['旧封路来源'], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
  if (options.agedColdFact) {
    envelope.ledger.factArchive = [{ id: 'old-cold', summary: '已冷藏的旧封路', temporalKind: 'condition', happenedAt: null,
      validFrom: { day: 1, slot: '' }, validUntil: { day: 1, slot: '' }, locationRef: null, actorIds: [], worldEventIds: [],
      projectionPolicy: 'internal', revealState: 'locked', revealGate: null, nextCheck: null, sourceRefs: ['旧封路来源'], evidenceRefs: [], supersedesFactIds: [], revision: 1 }];
    envelope.ledger.factArchiveRetention = { completedRounds: 10, enteredAtRound: { 'old-cold': 0 } };
    envelope.ledger.facts = [{ ...envelope.ledger.factArchive[0], id: 'current-secret', temporalKind: 'occurrence',
      happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, projectionPolicy: 'gated', supersedesFactIds: ['old-cold'] }];
    envelope.ledger.historyMilestones = [
      { ...historicalMilestone('referencing-history', 1), sourceFactIds: ['old-cold'] },
    ];
  }
  if (options.prunable) {
    const base = { temporalKind: 'occurrence' as const, happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [], worldEventIds: [], revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
    envelope.ledger.facts = [
      { ...base, id: 'stale-internal', summary: '过时的内部过程记录', projectionPolicy: 'internal', revealState: 'locked' },
      { ...base, id: 'live-secret', summary: '仍在等待揭示的秘密', projectionPolicy: 'gated', revealState: 'locked', revealGate: { semanticCondition: '主角询问' } },
      { ...base, id: 'scene-open', summary: '已公开的场景事实', projectionPolicy: 'scene', revealState: 'unlocked' },
    ];
    envelope.ledger.historyMilestones = [{ ...historicalMilestone('prune-history', 1), sourceFactIds: ['stale-internal', 'live-secret'] }];
  }
  if (options.prunableEvents) {
    const event = (id: string, status: 'active' | 'resolved' | 'cancelled', extra: Record<string, unknown> = {}) => ({
      id, title: `事件 ${id}`, state: `状态 ${id}`, status, actorIds: [], organizationIds: [], locationRefs: [], startedAt: { day: 1, slot: '' },
      deadline: null, nextCheck: null, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 2, legacy: null, ...extra });
    const base = { temporalKind: 'occurrence' as const, happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
      actorIds: [], revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 };
    envelope.ledger.worldEvents = [event('ended-gone', 'resolved'), event('ended-held', 'cancelled'), event('still-active', 'active', { relatedEventIds: ['ended-gone'] })];
    envelope.ledger.facts = [
      { ...base, id: 'gone-result', summary: '事件的结果事实', worldEventIds: ['ended-gone'], projectionPolicy: 'scene', revealState: 'unlocked' },
      { ...base, id: 'held-secret', summary: '仍在等待揭示的秘密', worldEventIds: [], projectionPolicy: 'gated', revealState: 'locked',
        revealGate: { requiredEventIds: ['ended-held'], semanticCondition: '主角询问' } },
    ];
    envelope.ledger.historyMilestones = [{ ...historicalMilestone('event-history', 1), worldEventIds: ['ended-gone', 'still-active'] }];
  }
  if (options.signal) envelope.ledger.guidance.signals = [{ voice: 'ambient', text: '旧世界信号不得投送进正文', sourceId: 'fixture' }];
  simulation.envelope = envelope;
  simulation.fields = seedLedgerFieldView_ACU(envelope.ledger, 1);
  const plotCandidate = options.recording?.delivered ? { floorId: 'user-1', presetName: '旧事投送', outcome: 'generated' as const,
    finalMessage: '人物旧事：暴雨夜关闭北门。', content: '人物旧事：暴雨夜关闭北门。', taskContents: {},
    finalPrompts: [], filterEntries: [], agentActive: false } : undefined;
  const tableInput: ZeroLayerTableInput_ACU | undefined = options.tables?.input ? {
    chatKey: 'chat-1', isolationKey: '', storageMode: 'native', tableData: structuredClone(options.tables.input),
    templateData: structuredClone(options.tables.input), completedAiFloorBySheetKey: {}, autoUpdateEnabled: false,
  } : undefined;
  const durableTable: ZeroLayerTableResult_ACU | undefined = options.tables?.durable ? {
    floorId: 'floor-1', tableData: structuredClone(options.tables.durable), completedAiFloorBySheetKey: {}, filledSheetKeys: [],
  } : undefined;
  const source: ZeroLayerEnvelope_ACU = {
    schemaVersion: 1, sessionId: 'session-1', scope: { chatId: 'chat-1', characterKey: 'char:card.png' },
    carrierId: 'carrier-1', carrierSwipeId: 0, seedBody: '物理正文：不得改写',
    activationFingerprint: await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(chat)),
    activationMessageCount: 1, enabled: true, apiPresetName: '', revision: 1, activeBranchId: 'branch-1',
    branches: [{ branchId: 'branch-1', headTurnId: null, simulation, continuation: emptyZeroLayerContinuation_ACU() }],
    turns: [{
      turnId: 'turn-1', branchId: 'branch-1', parentTurnId: null, attemptId: 'attempt-1', input: '继续',
      body: options.longAnchor ?? (options.propagation ? propagationBody : options.recording?.written
        ? `${logicalBody}守卫记起暴雨夜关闭北门。` : logicalBody), phase: 'response-durable', createdAt: 1, updatedAt: 1,
      materialBaseline: { continuation: null, simulation: structuredClone(simulation) },
      userFloor: { floorId: 'user-1', role: 'user', data: {} },
      assistantFloor: { floorId: 'floor-1', role: 'assistant', data: durableTable ? { table: durableTable } : {} },
      ...(tableInput ? { tableInput } : {}),
      ...(options.tables?.candidate ? { tableCandidate: { floorId: 'floor-1', tableData: structuredClone(options.tables.candidate),
        completedAiFloorBySheetKey: {}, filledSheetKeys: [], completedBucketIds: [] } } : {}),
      ...(plotCandidate ? { plotCandidate } : {}),
      simulationDeliveryTarget: 'body', requiredEffects: ['simulation'], effectReceipts: [
        ...(durableTable ? [{ kind: 'table' as const, status: 'durable' as const,
          effectId: JSON.stringify(['session-1', 'turn-1', 'attempt-1', 'table']), fingerprint: getTableDataFingerprint_ACU(durableTable) }] : []),
        ...(plotCandidate ? [{ kind: 'plot' as const, status: 'durable' as const,
          effectId: 'turn-1:attempt-1:plot', fingerprint: getTableDataFingerprint_ACU(plotCandidate) }] : []),
      ], errorCode: null,
    }],
  };
  carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = validateZeroLayerEnvelope_ACU(source);

  let remote = structuredClone(chat);
  const saveChat = vi.fn(async () => {
    if (options.recording?.failSave && (carrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU).branches[0]
      .simulation?.envelope?.ledger.historyArchive?.some(item => item.id === 'delivered-history')) throw new Error('归档保存失败');
    remote = structuredClone(chat);
  });
  _set_SillyTavern_API_ACU({
    chat, chatId: 'chat-1', characterId: 0, this_chid: 0,
    characters: [{ avatar: 'card.png', name: '测试角色' }], getCurrentChatId: () => 'chat-1', saveChat,
  } as any);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{}, ...structuredClone(remote)] })));

  const store = new ZeroLayerSimulationStore_ACU();
  const identity = identityFor(store, mode);
  const anchor = store.anchorForTurn('turn-1');
  identity.anchorContentDigest = anchor.contentDigest;
  if (options.reserve !== false) {
    // 此次真实 carrier 保存只预留元数据；候选业务账本在后续独立保存，不能据此宣称跨宿主原子事务。
    await store.updateState(state => {
      state.envelope!.task = reservedStage(identity).task;
      state.envelope!.activeStageId = identity.stageId;
      state.envelope!.stages = reservedStage(identity).stages;
      state.envelope!.updatedAt = 2;
    });
  }
  return { carrier, chat, store, identity, anchor, saveChat, getRemote: () => remote };
}

function stagePayload(messages: readonly { content: string | null | undefined }[]): Record<string, any> {
  return readWorldRoundPayload_ACU(messages);
}

function receivedTables(messages: readonly { content: string | null | undefined }[]): unknown {
  for (const message of messages) {
    try {
      const parsed = JSON.parse(message.content ?? '') as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(parsed, 'WORLD_TABLES')) return parsed.WORLD_TABLES;
    } catch { /* 普通提示词文本不是资料块。 */ }
  }
  return undefined;
}

function zeroLayerTables(label: string): TableDataObject_ACU {
  const sheet = (uid: string, name: string, content: string[][], orderNo: number) => ({ uid, name, content,
    sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo });
  return {
    mate: { type: 'acu', version: 1 },
    sheet_0: sheet('global', '全局表', [['row_id', '日历'], ['1', `${label}：第一日`]], 0),
    sheet_1: sheet('people', '人物表', [['row_id', '人物'], ['1', `${label}：守卫`]], 1),
    sheet_2: sheet('chronicle', '纪要表', [['row_id', '事件'], ['1', `${label}：{{danger}}/$WORLD_TASK`]], 2),
  } as TableDataObject_ACU;
}

function tableRows(data: TableDataObject_ACU) {
  return Object.entries(data).filter(([key]) => key.startsWith('sheet_')).map(([sheetKey, value]) => ({
    sheetKey, name: value.name, content: value.content,
  }));
}

function registeredActor() {
  return {
    id: 'new-actor', name: '角色', interests: ['在广场等待'], location: '广场', locationRef: null,
    life: 'alive' as const, diedAtDay: null, deathSummary: null, resources: [], goals: ['等待下一步'],
    constraints: [], informationSources: [], knownFacts: [], visibility: 'hidden' as const,
    // 模型故意伪造起点，只有 candidateClock 可作为登记动作的时间来源。
    currentAction: { text: '等待巡逻结果', expectedDuration: '一刻钟', startedAtDay: 999, startedAt: '伪造起点' },
    shortTermAction: null, longTermAction: null, loreRefs: [], experiences: [], simulationStatus: 'active' as const, revision: 1,
  };
}

function actorFact(actorId: string) {
  return {
    id: `fact-${actorId}`, summary: `${actorId} 完成本轮行动`, temporalKind: 'occurrence' as const,
    happenedAt: { day: 2, slot: '' }, validFrom: null, validUntil: null, locationRef: null,
    actorIds: [actorId], worldEventIds: [], projectionPolicy: 'internal' as const,
    revealState: 'locked' as const, revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [],
    supersedesFactIds: [], revision: 1,
  };
}

function modeledWorldWrites() {
  return {
    worldEventWrites: [{ expectedRevision: 0, value: {
      id: 'bell-notice', title: '钟楼告示', state: '守卫筹备告示', status: 'active', actorIds: [],
      organizationIds: null, locationRefs: ['钟楼'], startedAt: '2025-04-11T09:00:00+08:00',
      deadline: '2025-04-13T09:00:00+08:00', nextCheck: { day: 7, slot: '' }, relatedEventIds: null,
      loreRefs: null, evidenceRefs: null, tags: null, revision: 0, legacy: false,
    } }],
    factWrites: [{ expectedRevision: 0, value: {
      id: 'notice-ready', summary: '钟楼告示已备妥', temporalKind: 'condition',
      happenedAt: '2025-04-11T09:00:00+08:00', validFrom: '2025-04-11T09:00:00+08:00',
      validUntil: '2025-04-13T09:00:00+08:00', locationRef: '钟楼', actorIds: null,
      worldEventIds: ['bell-notice'], projectionPolicy: 'internal', revealState: 'locked',
      revealGate: null, nextCheck: { day: 7, slot: '' }, sourceRefs: null, evidenceRefs: null,
      supersedesFactIds: null, revision: 0,
    } }],
  };
}

function runnerInput(fixture: Fixture, options: {
  changeFirstActor?: boolean; registerActor?: boolean; knowledgeAcquisition?: boolean; propagation?: boolean; failSecondActorBatch?: boolean; throwSecondActorBatch?: boolean;
  recording?: boolean; pruneFactIds?: unknown; pruneEventIds?: unknown; reviewHistory?: Record<string, unknown>;
} = {}) {
  const ledger = fixture.store.read()!.ledger;
  let actorBatch = 0;
  const invoke = vi.fn(async (_role: string, messages: readonly { content: string }[]) => {
    const data = stagePayload(messages);
    if (data.stage === 'world-review-maintenance-v1') return JSON.stringify({ pruneFactIds: options.pruneFactIds ?? [], pruneEventIds: options.pruneEventIds ?? [], ...(options.reviewHistory ?? {}) });
    if (data.stage === 'world-narrative-review-v1') {
      return JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
    }
    if (data.stage === 'clock-candidate') {
      return JSON.stringify({ candidateClock: { ...ledger.clock, day: ledger.clock.day + 1 } });
    }
    if (data.stage === 'recall-selection') {
      const selectedFactIds = options.propagation ? [propagationSourceFactId] : [];
      return JSON.stringify({
        selections: data.directory.actorIds.map((actorId: string) => ({
          actorId, historyMilestoneIds: options.recording ? ['delivered-history'] : [], worldEventIds: [], factIds: actorId === propagationReceiverActorId ? selectedFactIds : [],
          reason: options.propagation ? '守卫须回忆信使已提交的来源事实' : '本轮无额外资料', priority: 5, scope: 'actor',
        })),
        worldSelection: { worldEventIds: [], factIds: selectedFactIds, reason: options.propagation ? '已提交的传播来源事实' : '本轮无到期世界资料', priority: 5, scope: 'world' },
      });
    }
    if (data.stage === 'worldbook-selection') {
      return JSON.stringify({ refs: (data.directory as Array<{ bookName: string; uid: string }>).map(item => ({ bookName: item.bookName, uid: item.uid })) });
    }
    if (data.stage === 'world-page') return JSON.stringify({ worldEventWrites: [], factWrites: [] });
    actorBatch += 1;
    if (actorBatch === 2 && options.throwSecondActorBatch) throw new Error('network');
    if (actorBatch === 2 && options.failSecondActorBatch) return '不是 JSON';
    const ids = data.actorIds as string[];
    const first = ids[0];
    if (options.propagation && ids.includes(propagationReceiverActorId)) {
      expect(data.worldOverlay).toMatchObject({ facts: [{
        id: propagationSourceFactId, summary: propagationSourceFactSummary, actorIds: [propagationSourceActorId, propagationReceiverActorId],
        locationRef: propagationLocation, happenedAt: { day: 1 }, revealState: 'locked',
      }] });
      expect(data.knowledgeSources).toEqual([{
        actorId: propagationReceiverActorId, sourceActorId: propagationSourceActorId, sourceFactId: propagationSourceFactId,
        knowledge: propagationKnowledge, channel: propagationChannel, locationRef: propagationLocation,
      }]);
    }
    const sourceActor = (data.actorMaterials.actors as Array<{ id: string }>).find(item => item.id === first)!;
    const changed = options.changeFirstActor === true && actorBatch === 1;
    const knowledgeAcquisition = options.knowledgeAcquisition === true && actorBatch === 1;
    const propagation = options.propagation === true && ids.includes(propagationReceiverActorId);
    const propagationReceiver = (data.actorMaterials.actors as Array<{ id: string; knownFacts: string[] }>).find(item => item.id === propagationReceiverActorId);
    const registration = options.registerActor === true && actorBatch === 1 ? registeredActor() : null;
    const fact = actorFact(first);
    const actorWrite = changed || knowledgeAcquisition || propagation
      ? propagation
        ? { ...propagationReceiver, knownFacts: [...propagationReceiver!.knownFacts, propagationKnowledge], revision: 2 }
        : { ...sourceActor, ...(changed ? { goals: ['完成真实整轮测试'] } : {}),
          ...(knowledgeAcquisition ? { knownFacts: [...sourceActor.knownFacts, '角色已得知广场守卫巡逻'] } : {}), revision: 2 }
      : null;
    return JSON.stringify({
      actorWrites: actorWrite ? [{ value: actorWrite, expectedRevision: 1 }] : [],
      ...(registration ? { actorRegistrations: [{ value: registration, expectedRevision: 0, evidenceQuote: '角色在广场等待' }] } : {}),
      ...(knowledgeAcquisition || propagation ? { knowledgeAcquisitions: propagation
        ? [{ actorId: propagationReceiverActorId, sourceActorId: propagationSourceActorId, sourceFactId: propagationSourceFactId,
          knowledge: propagationKnowledge, channel: propagationChannel, evidenceQuote: propagationSourceFactSummary,
          acquiredAt: { day: ledger.clock.day + 1, slot: ledger.clock.slot }, locationRef: { ...propagationLocation } }]
        : [{ actorId: first, knowledge: '角色已得知广场守卫巡逻',
          channel: '亲耳听闻', evidenceQuote: '角色在广场等待', acquiredAt: { day: ledger.clock.day + 1, slot: ledger.clock.slot },
          locationRef: { region: '城区', place: '广场' } }] } : {}),
      actorCompletions: ids.map(actorId => ({ actorId, completion: (changed || knowledgeAcquisition || (propagation && actorId === propagationReceiverActorId)) && actorId === (propagation ? propagationReceiverActorId : first) ? 'changed' : 'no_change', expectedRevision: 1 })),
      factWrites: changed ? [{ value: fact, expectedRevision: 0 }] : [],
      historyMilestoneWrites: changed ? [{
        value: { id: `history-${first}`, summary: '真实整轮候选形成纪要', happenedAt: { day: 2, slot: '' }, actorIds: [first],
          worldEventIds: [], locationRef: null, sourceFactIds: [fact.id], importance: 1, category: '行动',
          visibility: 'internal', revision: 1, legacyRefs: [] }, expectedRevision: 0,
      }] : [],
    });
  });
  return {
    identity: fixture.identity, settings: fixture.store.read()!.settings, ledger, anchorText: logicalBody,
    signal: new AbortController().signal, invoke, countTokens: async () => 1, isCurrent: () => true,
    confirmActorRegistration: confirmRegistration,
    actorPageSize: 24,
  };
}

async function executeCandidate(fixture: Fixture, options: {
  changeFirstActor?: boolean; registerActor?: boolean; knowledgeAcquisition?: boolean; propagation?: boolean; failSecondActorBatch?: boolean; throwSecondActorBatch?: boolean;
  recording?: boolean; pruneFactIds?: unknown; pruneEventIds?: unknown; reviewHistory?: Record<string, unknown>;
} = {}) {
  const input = runnerInput(fixture, options);
  const result = await runWorldRound_ACU(input);
  return { input, result, commit: () => commitZeroLayerSimulationRound_ACU(fixture.store, {
    identity: fixture.identity, anchor: fixture.anchor, roundCandidate: result.roundCandidate,
    completedAt: 10, timelineId: 'timeline-1', summary: result.summary,
  }) };
}

async function createOrchestratedFixture(options: {
  actors?: number;
  mode?: Mode;
  agedColdFact?: boolean;
  tables?: { input?: TableDataObject_ACU; durable?: TableDataObject_ACU; candidate?: TableDataObject_ACU };
  invokeFactory?: (fixture: Fixture) => ReturnType<typeof runnerInput>['invoke'];
} = {}) {
  const fixture = await createFixture({ actors: options.actors, mode: options.mode, agedColdFact: options.agedColdFact,
    tables: options.tables, reserve: false });
  let currentWorldbookSnapshot = worldbookSnapshot();
  const readWorldbookSnapshot = vi.fn(async () => structuredClone(currentWorldbookSnapshot));
  const buildRunMaterials = (instruction: string, snapshot: AgentWorldbookSnapshot_ACU) => {
    try {
      return buildWorldRunMaterials_ACU({
        instruction,
        userRequirements: fixture.store.readState().userRequirements,
        worldbookSnapshot: snapshot,
        worldRoundPrompts: fixture.store.read()!.settings.worldRoundPrompts,
        workflowMode: fixture.identity.workflowMode,
        deliveryTarget: fixture.identity.deliveryTarget,
      });
    } catch (error) {
      throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
        'WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', '世界书资料不可用或格式无效，拒绝整轮推演', false,
        { cause: error instanceof Error ? error.message : String(error) },
      ));
    }
  };
  const invoke = options.invokeFactory?.(fixture) ?? runnerInput(fixture, { changeFirstActor: true }).invoke;
  let sequence = 0;
  const orchestrator = new WorldSimulationOrchestrator_ACU({
    store: fixture.store,
    now: () => ++sequence,
    allocateId: kind => `${kind}-${++sequence}`,
    workflowProtocol: 'world-round-v1',
    assertAnchorCurrent: anchor => { fixture.store.assertAnchor(anchor); },
    // 新协议只读取权威 ledger revision，不恢复旧逐栏 proof。
    readResumeLedgerRevision: () => fixture.store.read()!.ledger.revision,
    checkResumeMaterials: async (_identity, _anchor, envelope, signal) => {
      const snapshot = await readWorldbookSnapshot();
      fixture.store.assertAnchor(_anchor);
      const current = fixture.store.read();
      if (signal.aborted || !current?.task || current.task.taskId !== envelope.task?.taskId
        || current.task.status !== 'paused' || current.task.activeRun?.runId !== _identity.runId
        || !current.task.runMaterials || !envelope.task!.runMaterials
        || !sameWorldRunMaterials_ACU(current.task.runMaterials, envelope.task!.runMaterials)) {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_REVISION_CONFLICT', 'persist', '恢复资料核验期间任务已变化', true,
        ));
      }
      const actual = buildRunMaterials(current.task.originInstruction, snapshot);
      if (!sameWorldRunMaterials_ACU(current.task.runMaterials!, actual)) {
        throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
          'WORLD_SIMULATION_REVISION_CONFLICT', 'load', '世界书、长期要求或原始意图已变化，拒绝恢复整轮推演', false,
        ));
      }
    },
    prepare: async input => {
      fixture.store.assertAnchor(input.anchor);
      const body = fixture.store.readSource().turns.find(turn => turn.turnId === input.anchor.logicalRef.turnId)!.body!;
      const snapshot = await readWorldbookSnapshot();
      const runMaterials = buildRunMaterials(input.envelope.task!.originInstruction, snapshot);
      if (input.envelope.task!.status === 'paused') {
        if (!input.envelope.task!.runMaterials || !sameWorldRunMaterials_ACU(input.envelope.task!.runMaterials, runMaterials)) {
          throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
            'WORLD_SIMULATION_REVISION_CONFLICT', 'load', '恢复资料与冻结资料不一致，拒绝继续整轮推演', false,
          ));
        }
      } else {
        await fixture.store.updateAtomically(current => ({
          ...current!, task: { ...current!.task!, runMaterials }, updatedAt: current!.updatedAt + 1,
        }), { chatIdentity: input.identity.chatIdentity, taskId: input.identity.taskId, stageId: input.identity.stageId, revision: input.identity.stageRevision });
      }
      return prepareWorldRoundRun_ACU({
        identity: input.identity,
        envelope: fixture.store.read()!,
        anchor: input.anchor,
        anchorBody: body,
        signal: input.signal,
        invoke,
        // 继续等机械文本不可覆盖首次任务意图，runner 也只看持久化原文。
        instruction: fixture.store.read()!.task!.originInstruction,
        userRequirements: fixture.store.readState().userRequirements,
        worldbookSnapshot: snapshot,
        runMaterials,
        readCurrent: () => fixture.store.read(),
        assertAnchorCurrent: () => { fixture.store.assertAnchor(input.anchor); },
        hasLegacyWrites: false,
        countTokens: async () => 1,
        now: 1,
      });
    },
    commitRound: input => commitZeroLayerSimulationRound_ACU(fixture.store, input),
    commitProjection: input => commitZeroLayerSimulationFinal_ACU(fixture.store, input),
  });
  return {
    ...fixture,
    invoke,
    readWorldbookSnapshot,
    setWorldbookSnapshot: (next: AgentWorldbookSnapshot_ACU) => { currentWorldbookSnapshot = structuredClone(next); },
    orchestrator,
    start: () => orchestrator.start({ triggerKind: 'assistant_completed', anchor: fixture.anchor, instruction: originInstruction }),
    resume: (instruction?: string) => orchestrator.resume({ anchor: fixture.anchor, ...(instruction === undefined ? {} : { instruction }) }),
  };
}

const originalApiPresets = settings_ACU.apiPresets;
const originalWorldSimulationPageEnabled = settings_ACU.worldSimulationPageEnabled;

async function createProductionProgressFixture(secondBatch: 'none' | 'bad-json' | 'network' = 'none',
  recording?: { delivered: boolean; written: boolean }, longAnchor?: string) {
  const f = await createFixture({ actors: secondBatch === 'none' ? 1 : 25, mode: 'layered', reserve: false, recording, longAnchor });
  settings_ACU.worldSimulationPageEnabled = true;
  settings_ACU.apiPresets = [{ name: 'zero-layer-progress-test', apiMode: 'custom', tavernProfile: '', apiConfig: {
    url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test', apiKey: 'test', useMainApi: false,
    sendViaTavern: false, max_tokens: 128, temperature: 0.1, customApiFormat: 'openai_compat',
  } }];
  await f.store.updateState(state => {
    state.envelope!.settings.apiPresetMode = 'fixed';
    state.envelope!.settings.fixedApiPresetName = 'zero-layer-progress-test';
  });
  productionWorldbook.mockResolvedValue(worldbookSnapshot());
  const ordinary = runnerInput(f, { failSecondActorBatch: secondBatch === 'bad-json', throwSecondActorBatch: secondBatch === 'network',
    changeFirstActor: !recording, recording: !!recording }).invoke;
  const observedRecordingMaterials: Record<string, any>[] = [];
  let clockReached!: () => void;
  let releaseClock!: () => void;
  const clockStarted = new Promise<void>(resolve => { clockReached = resolve; });
  const clockEntered = new Promise<void>(resolve => { releaseClock = resolve; });
  productionModel.mockImplementation(async (messages: readonly { content: string }[]) => {
    const payload = stagePayload(messages);
    if (payload.stage === 'clock-candidate') { clockReached(); await clockEntered; }
    if (payload.stage === 'actor-batch' && recording) {
      // 历史标记已移交联合审查专员：人物批拿不到标记资料，即便返回候选也被静默忽略。
      expect(payload.historyRecordingMaterials).toBeUndefined();
      const original = JSON.parse(await ordinary('production-test', messages));
      original.historyRecordingCandidates = [{ historyId: 'delivered-history', deliveryQuote: '暴雨夜关闭北门',
        evidenceQuote: '守卫记起暴雨夜关闭北门' }];
      return { content: JSON.stringify(original), toolCalls: [] };
    }
    if (payload.stage === 'world-narrative-review-v1' && recording) {
      observedRecordingMaterials.push(payload);
      const original = JSON.parse(await ordinary('production-test', messages));
      original.historyRecordingCandidates = [{ historyId: 'delivered-history', deliveryQuote: '暴雨夜关闭北门',
        evidenceQuote: '守卫记起暴雨夜关闭北门' }];
      return { content: JSON.stringify(original), toolCalls: [] };
    }
    if (secondBatch === 'network' && payload.stage === 'actor-batch' && (payload.actorIds as string[]).includes('actor-24')) throw new Error('network');
    return { content: await ordinary('production-test', messages), toolCalls: [] };
  });
  return { ...f, runtime: new WorldSimulationRuntime_ACU(undefined, () => f.chat, f.store), clockStarted, releaseClock,
    observedRecordingMaterials };
}

afterEach(() => {
  settings_ACU.apiPresets = originalApiPresets;
  settings_ACU.worldSimulationPageEnabled = originalWorldSimulationPageEnabled;
  resetWorldSimulationOrchestratorStateForTests_ACU();
  resetWorldSimulationSessionLogForTests_ACU();
  productionModel.mockReset();
  productionWorldbook.mockReset();
  sceneTokenCounter.mockReset();
  sceneTokenCounterEnabled.value = false;
  confirmRegistration.mockReset();
  confirmRegistration.mockResolvedValue(true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _set_SillyTavern_API_ACU(undefined);
});

describe('零层真实整轮执行器与 carrier 联合集成', () => {
  it('正式零层 runtime 长冻结正文联合审查按自定义输入预算调用，carrier 远端保存世界事实', async () => {
    const anchorMarker = 'ZERO_LONG_ANCHOR_BOUNDARY';
    const promptMarker = 'ZERO_CUSTOM_JOINT_BOUNDARY';
    const body = `${anchorMarker}守卫在钟楼记录。${'夜间巡查仍在继续。'.repeat(1500)}`;
    const f = await createProductionProgressFixture('none', undefined, body);
    await f.store.updateState(state => {
      state.envelope!.settings.agentHistoryTokenBudget = 42000;
      state.envelope!.settings.agentReadTokenBudget = 20000;
      state.envelope!.settings.worldRoundPrompts = { 'joint-reviewer': [{ role: 'system',
        content: `${promptMarker}仅据冻结正文审查。${'逐条核对正文证据。'.repeat(900)} $ANCHOR_MESSAGE $READ_BUDGET`,
        enabled: true, deletable: true, pinned: false }] };
    });
    sceneTokenCounterEnabled.value = true;
    const validSceneReply = JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
    sceneTokenCounter.mockImplementation(async text => text.includes(anchorMarker) && text.includes(promptMarker)
      ? 9000 : text === validSceneReply ? 41000 : 1);
    const running = f.runtime.handleLogicalCompletion(f.store.readSource(), 'turn-1', 'attempt-1', new AbortController().signal);
    try { await f.clockStarted; } finally { f.releaseClock(); }
    await expect(running).resolves.toBeUndefined();
    const sceneRequests = productionModel.mock.calls.map(([messages]) => messages as Array<{ content: string }>)
      .filter(messages => stagePayload(messages).stage === 'world-narrative-review-v1');
    expect(sceneRequests).toHaveLength(1);
    for (const messages of sceneRequests) {
      const payloadText = JSON.stringify(messages);
      expect(payloadText).toContain(anchorMarker);
      expect(payloadText).toContain(promptMarker);
      expect(payloadText.length).toBeGreaterThan(8192);
      const budgetBlock = messages.map(message => {
        try { return JSON.parse(message.content).READ_BUDGET; } catch { return undefined; }
      }).find(Boolean);
      expect(budgetBlock).toMatchObject({ inputTokenBudget: 42000 });
    }
    expect(sceneTokenCounter.mock.calls.filter(([text]) => text.includes(anchorMarker) && text.includes(promptMarker))).not.toHaveLength(0);
    const local = f.store.readState();
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(local.envelope!.ledger);
    expect(remote.branches[0].simulation!.envelope!.ledger.facts).toContainEqual(expect.objectContaining({ id: 'fact-actor-00' }));
    expect(remote.branches[0].simulation!.envelope!.settings.agentHistoryTokenBudget).toBe(42000);
    expect(remote.turns[0].body).toBe(body);
    expect(remote.turns[0].effectReceipts).toContainEqual(expect.objectContaining({ kind: 'simulation', status: 'durable' }));
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    expect(f.saveChat).toHaveBeenCalled();
  });

  it('零层正式 runtime 拒绝新增人物仍保存既有人物及事实，确认 wrapper 确实调用', async () => {
    const f = await createProductionProgressFixture();
    const ordinary = runnerInput(f, { registerActor: true, changeFirstActor: true }).invoke;
    productionModel.mockImplementation(async (messages: readonly { content: string }[]) => {
      const data = stagePayload(messages);
      if (data.stage === 'clock-candidate') { f.releaseClock(); }
      return { content: await ordinary('zero-layer-registration-test', messages), toolCalls: [] };
    });
    confirmRegistration.mockResolvedValue(false);
    const running = f.runtime.handleLogicalCompletion(f.store.readSource(), 'turn-1', 'attempt-1', new AbortController().signal);
    await expect(running).resolves.toBeUndefined();
    expect(confirmRegistration).toHaveBeenCalledOnce();
    expect(confirmRegistration.mock.calls[0][0]).toMatchObject({ id: 'new-actor', name: '角色' });
    expect(confirmRegistration.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    const state = f.store.readState();
    expect(state.envelope!.ledger.actors.map(item => item.id)).toEqual(['actor-00']);
    expect(state.envelope!.ledger.actors[0].goals).toEqual(['完成真实整轮测试']);
    expect(state.envelope!.ledger.facts).toContainEqual(expect.objectContaining({ id: 'fact-actor-00' }));
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(state.envelope!.ledger);
    expect(remote.turns[0].effectReceipts).toHaveLength(1);
  });

  it('零层正式 runtime 登记确认中 signal 取消不保存候选', async () => {
    const f = await createProductionProgressFixture();
    const ordinary = runnerInput(f, { registerActor: true, changeFirstActor: true }).invoke;
    productionModel.mockImplementation(async (messages: readonly { content: string }[]) => {
      if (stagePayload(messages).stage === 'clock-candidate') f.releaseClock();
      return { content: await ordinary('zero-layer-registration-test', messages), toolCalls: [] };
    });
    let release!: (approved: boolean) => void;
    const pending = new Promise<boolean>(resolve => { release = resolve; });
    confirmRegistration.mockImplementation(async () => pending);
    const controller = new AbortController();
    const before = structuredClone(f.store.read()!.ledger);
    const running = f.runtime.handleLogicalCompletion(f.store.readSource(), 'turn-1', 'attempt-1', controller.signal);
    await vi.waitFor(() => expect(confirmRegistration).toHaveBeenCalledOnce());
    expect(confirmRegistration.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    controller.abort();
    release(true);
    await expect(running).rejects.toBeTruthy();
    expect(f.store.read()!.ledger).toEqual(before);
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(before);
    expect(remote.turns[0].effectReceipts).toEqual([]);
  });

  it.each([false, true])('正式零层 runtime.deleteActor 已发布人物，保存失败=%s 时权威回读恢复', async failSave => {
    const f = await createFixture({ mode: 'layered', actors: 2, historyMilestones: 1, tables: {
      durable: zeroLayerTables('已确认'),
    } });
    await f.store.updateState(state => {
      state.envelope!.ledger.facts = [{ ...actorFact('actor-00'), happenedAt: { day: 1, slot: '' },
        actorIds: ['actor-00', 'actor-01'] }];
      state.fields = seedLedgerFieldView_ACU(state.envelope!.ledger, 1);
    });
    await (await executeCandidate(f)).commit();
    const baseline = structuredClone(f.store.read()!.ledger);
    const zeroStore = f.store.store;
    const settled = await zeroStore.commit({ type: 'transition-turn', turnId: 'turn-1', attemptId: 'attempt-1',
      phase: 'effects-durable' }, f.store.readSource().revision);
    await zeroStore.commit({ type: 'transition-turn', turnId: 'turn-1', attemptId: 'attempt-1',
      phase: 'published' }, settled.revision);
    if (failSave) f.saveChat.mockImplementationOnce(async () => { throw new Error('delete save failed'); });
    const runtime = new WorldSimulationRuntime_ACU(undefined, () => f.chat, f.store);
    const before = structuredClone(runtime.readUiSnapshot());
    if (failSave) await expect(runtime.deleteActor('actor-00')).rejects.toThrow();
    else await runtime.deleteActor('actor-00');
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    if (failSave) {
      expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(baseline);
      expect(() => runtime.readUiSnapshot()).toThrow(/保存结果未知/);
      const recovered = await f.store.store.recover();
      expect(recovered?.branches[0].simulation!.envelope!.ledger).toEqual(baseline);
      expect(runtime.readUiSnapshot().publishedLedger).toEqual(before.publishedLedger);
    } else {
      const state = f.store.readState();
      expect(state.envelope!.ledger.actors.map(item => item.id)).toEqual(['actor-01']);
      expect(state.fields.records.actors?.['actor-00']).toBeUndefined();
      expect(state.fields.records.actors?.['actor-01']).toBeDefined();
      expect(state.envelope!.ledger.facts).toMatchObject([{ id: 'fact-actor-00', actorIds: ['actor-01'] }]);
      expect(state.envelope!.ledger.historyMilestones).toMatchObject([{ id: 'history-seed-01', actorIds: [] }]);
      expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(state.envelope!.ledger);
      expect(runtime.readUiSnapshot().publishedLedger!.actors.map(item => item.id)).toEqual(['actor-01']);
      expect(remote.turns[0].body).toBe(logicalBody);
    }
    expect(confirmRegistration).not.toHaveBeenCalled();
  });

  it.each<Mode>(['single', 'layered'])('%s 正式零层以当前锚点已确认表优先，否则使用冻结输入，不读取在途候选', async mode => {
    const saveCounts: number[] = [];
    for (const variant of ['durable', 'input', 'empty'] as const) {
      const input = zeroLayerTables('冻结输入');
      const durable = zeroLayerTables('已确认');
      const candidate = zeroLayerTables('在途候选禁止读取');
      const expected = variant === 'durable' ? tableRows(durable) : variant === 'input' ? tableRows(input) : [];
      const f = await createFixture({ mode, reserve: false, tables: variant === 'empty'
        ? { candidate } : variant === 'input' ? { input, candidate } : { input, durable, candidate } });
      const originalTable = f.store.readSource().turns[0].assistantFloor.data.table === undefined ? undefined
        : structuredClone(f.store.readSource().turns[0].assistantFloor.data.table);
      const originalInput = f.store.readSource().turns[0].tableInput === undefined ? undefined
        : structuredClone(f.store.readSource().turns[0].tableInput);
      const originalCandidate = structuredClone(f.store.readSource().turns[0].tableCandidate);
      const ordinary = runnerInput(f, { changeFirstActor: true }).invoke;
      productionWorldbook.mockResolvedValueOnce(worldbookSnapshot());
      const seen = new Set<string>();
      productionModel.mockImplementation(async (messages: readonly { content: string }[]) => {
        const data = stagePayload(messages);
        seen.add(data.stage);
        if (data.stage !== 'world-narrative-review-v1') {
          expect(receivedTables(messages)).toEqual(expected);
          expect(JSON.stringify(messages)).not.toContain('在途候选禁止读取');
        }
        return { content: await ordinary('zero-layer-table-test', messages), toolCalls: [] };
      });
      settings_ACU.worldSimulationPageEnabled = true;
      settings_ACU.apiPresets = [{ name: 'zero-table-test', apiMode: 'custom', tavernProfile: '', apiConfig: {
        url: 'http://127.0.0.1:43111/v1/chat/completions', model: 'test', apiKey: '', useMainApi: false,
        sendViaTavern: false, max_tokens: 128, temperature: 0.1, customApiFormat: 'openai_compat',
      } }];
      await f.store.updateState(state => {
        state.envelope!.settings.apiPresetMode = 'fixed';
        state.envelope!.settings.fixedApiPresetName = 'zero-table-test';
      });
      const savesBefore = f.saveChat.mock.calls.length;
      const runtime = new WorldSimulationRuntime_ACU(undefined, () => f.chat, f.store);
      if (variant === 'durable') {
        const fromStore = f.store.readSource().turns[0];
        expect(fromStore.effectReceipts.find(item => item.kind === 'table')?.fingerprint)
          .toBe(getTableDataFingerprint_ACU(fromStore.assistantFloor.data.table));
      }
      const result = runtime.handleLogicalCompletion(f.store.readSource(), 'turn-1', 'attempt-1', new AbortController().signal);
      await expect(result).resolves.toBeUndefined();
      expect(seen).toEqual(new Set(['world-narrative-review-v1', 'clock-candidate', 'worldbook-selection',
        'recall-selection', 'world-page', 'actor-batch']));
      const current = f.store.readSource().turns[0];
      expect(current.assistantFloor.data.table).toEqual(originalTable);
      expect(current.tableInput).toEqual(originalInput);
      expect(current.tableCandidate).toEqual(originalCandidate);
      expect(f.store.read()!.ledger).toMatchObject({ clock: { day: 2 }, actors: [{ goals: ['完成真实整轮测试'] }] });
      saveCounts.push(f.saveChat.mock.calls.length - savesBefore);
      productionModel.mockReset();
    }
    expect(saveCounts).toEqual([saveCounts[0], saveCounts[0], saveCounts[0]]);
  });

  it.each([
    ['recorded', true, true], ['not-delivered', false, true], ['not-written', true, false],
  ] as const)('正式 runtime %s：仅投送与冻结正文同时有引文才归档，远端载体保留正文', async (scenario, delivered, written) => {
    const f = await createProductionProgressFixture('none', { delivered, written });
    const originalBody = f.store.readSource().turns[0].body;
    const running = f.runtime.handleLogicalCompletion(f.store.readSource(), 'turn-1', 'attempt-1', new AbortController().signal);
    await f.clockStarted;
    f.releaseClock();
    await expect(running).resolves.toBeUndefined();
    expect(f.observedRecordingMaterials).toHaveLength(1);
    if (delivered) {
      expect(f.observedRecordingMaterials[0]).toMatchObject({ historyDeliveryText: expect.stringContaining('暴雨夜关闭北门'),
        historyRecordingMaterials: [{ id: 'delivered-history' }] });
    } else {
      expect(f.observedRecordingMaterials[0].historyRecordingMaterials).toBeUndefined();
    }
    const ledger = f.store.read()!.ledger;
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    const remoteLedger = remote.branches[0].simulation!.envelope!.ledger;
    if (delivered && written) {
      expect(ledger.historyMilestones).toEqual([]);
      expect(ledger.historyArchive).toMatchObject([{ id: 'delivered-history', summary: '守卫曾在暴雨夜关闭北门', revision: 2,
        narrativeRecord: { status: 'recorded', recordedAt: { day: 2 }, anchorDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          deliveryQuote: '暴雨夜关闭北门', evidenceQuote: '守卫记起暴雨夜关闭北门' } }]);
      const { buildPlotWorldContext_ACU, renderPlotWorldContextMessage_ACU } = await import('../../src/service/runtime/plot-runtime/plot-world-context');
      const nextPlotContext = renderPlotWorldContextMessage_ACU(buildPlotWorldContext_ACU({ ledger, previousLedger: null, summary: '' }));
      expect(nextPlotContext.content).toContain('"cold"');
      expect(nextPlotContext.content).toContain('"narrativeRecord"');
      expect(nextPlotContext.content).toContain('守卫曾在暴雨夜关闭北门');
    } else {
      expect(ledger.historyMilestones).toMatchObject([{ id: 'delivered-history', revision: 1 }]);
      expect(ledger.historyMilestones[0].narrativeRecord).toBeUndefined();
      expect(ledger.historyArchive ?? []).toEqual([]);
    }
    expect(remoteLedger).toEqual(ledger);
    expect(f.store.readSource().turns[0].body).toBe(originalBody);
    expect(remote.turns[0].body).toBe(originalBody);
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    expect(f.getRemote()).toEqual(f.chat);
  });

  it('正式 runner 的空 body proof 允许空事实，不把旧信号或全部账本事实投射到正文', async () => {
    const f = await createOrchestratedFixture({ mode: 'single', agedColdFact: true });
    const outcome = await f.start();
    expect(outcome).toMatchObject({ status: 'completed' });
    const source = f.store.readSource();
    const result = source.turns[0].assistantFloor.data.simulation as { delivery: string; bodyFactIds: string[]; projection: string | null };
    expect(result).toMatchObject({ delivery: 'body', bodyFactIds: [], projection: null });
    expect(source.turns[0].body).toBe(logicalBody);
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    expect(buildWorldFactBodyProjection_ACU(f.store.read()!.ledger, result.bodyFactIds)).toBeNull();
  });

  it('正式零层保存失败时历史仍在旧 hot，无已记载标记及确认回执', async () => {
    const f = await createProductionProgressFixture('none', { delivered: true, written: true, failSave: true });
    const before = structuredClone(f.store.read()!.ledger);
    const body = f.store.readSource().turns[0].body;
    const running = f.runtime.handleLogicalCompletion(f.store.readSource(), 'turn-1', 'attempt-1', new AbortController().signal);
    const rejected = expect(running).rejects.toMatchObject({ code: 'persist-unknown' });
    try { await f.clockStarted; } finally { f.releaseClock(); }
    await rejected;
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(before);
    expect(remote.branches[0].simulation!.envelope!.ledger.historyMilestones[0].narrativeRecord).toBeUndefined();
    expect(remote.branches[0].simulation!.envelope!.ledger.historyArchive ?? []).toEqual([]);
    expect(remote.turns[0].body).toBe(body);
    expect(remote.turns[0].assistantFloor.data.simulation).toBeUndefined();
    expect(remote.turns[0].effectReceipts.some(item => item.kind === 'simulation')).toBe(false);
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    const recovered = await f.store.store.recover();
    expect(recovered?.branches[0].simulation?.envelope?.ledger).toEqual(before);
    expect(f.store.readState().confirmed).toEqual([]);
    expect(f.store.readSource().turns[0].body).toBe(body);
  });

  it.each([
    ['成功', 'none'], ['后批非 JSON', 'bad-json'], ['后批网络失败', 'network'],
  ] as const)('正式 runtime factory %s：阶段进度实时可见，终态持久化且不污染正文或账本', async (_outcome, secondBatch) => {
    const f = await createProductionProgressFixture(secondBatch);
    const beforeLedger = structuredClone(f.store.read()!.ledger);
    const running = f.runtime.handleLogicalCompletion(f.store.readSource(), 'turn-1', 'attempt-1', new AbortController().signal);
    try {
      await Promise.race([f.clockStarted, running.then(() => { throw new Error('模型前已结束'); }, error => { throw error; })]);
      const during = f.runtime.readUiSnapshot();
      expect(during.session.running).toBe(true);
      expect(during.session.entries).toContainEqual(expect.objectContaining({
        kind: 'delegation', agentName: 'timekeeper', status: 'running',
      }));
      expect(during.conversation.messages.filter(message => message.eventKind === 'delegation')
        .every(message => message.status !== 'running')).toBe(true);
    } finally {
      f.releaseClock();
    }
    if (secondBatch === 'network') await expect(running).rejects.toMatchObject({ code: 'effects-pending' });
    else await expect(running).resolves.toBeUndefined();
    const final = f.runtime.readUiSnapshot();
    const progress = final.session.entries.filter(entry => entry.kind === 'delegation');
    expect(final.session.running).toBe(false);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every(entry => entry.status !== 'running')).toBe(true);
    expect(progress).toContainEqual(expect.objectContaining({
      kind: 'delegation', agentName: 'timekeeper', status: 'done',
    }));
    if (secondBatch === 'network') {
      expect(progress).toContainEqual(expect.objectContaining({
        kind: 'delegation', agentName: 'dramatis-keeper', status: 'failed', ok: false,
      }));
      expect(final.envelope!.ledger).toEqual(beforeLedger);
      expect(f.store.readState().confirmed).toEqual([]);
      expect(f.store.readSource().turns[0].effectReceipts).toEqual([]);
    } else {
      expect(final.envelope!.ledger.revision).toBe(1);
      expect(final.envelope!.ledger.actors[0].goals).toEqual(['完成真实整轮测试']);
      expect(final.envelope!.ledger.facts).toContainEqual(expect.objectContaining({ id: 'fact-actor-00' }));
      if (secondBatch === 'bad-json') expect(final.envelope!.ledger.actors[24]).toEqual(beforeLedger.actors[24]);
      expect(f.store.readState().confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    }
    const persisted = f.store.readState().conversation.segments.flatMap(segment => segment.messages)
      .filter(message => message.eventKind === 'delegation');
    expect(persisted).toContainEqual(expect.objectContaining({
      eventKind: 'delegation', agentName: 'timekeeper', status: 'done',
    }));
    expect(persisted.every(message => message.status !== 'running')).toBe(true);
    if (secondBatch === 'network') expect(persisted).toContainEqual(expect.objectContaining({
      eventKind: 'delegation', agentName: 'dramatis-keeper', status: 'failed',
    }));
    if (secondBatch === 'bad-json') expect(final.session.entries).toContainEqual(expect.objectContaining({
      kind: 'thought', agentName: 'dramatis-keeper', status: 'failed', detail: expect.stringContaining('本页保留原状态'),
    }));
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    const remoteEvents = remote.branches[0].simulation!.conversation.segments.flatMap(segment => segment.messages)
      .filter(message => message.eventKind === 'delegation');
    expect(remoteEvents).toEqual(persisted);
    expect(remote.turns[0].body).toBe(logicalBody);
    expect(f.store.readSource().turns[0].body).toBe(logicalBody);
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    expect(JSON.stringify(final.envelope!.ledger)).not.toContain('正在执行阶段校验');
  });

  it.each<Mode>(['single', 'layered'])('%s 自定义业务提示词从设置保存后进入真实零层 runner 请求', async mode => {
    const f = await createOrchestratedFixture({ mode, invokeFactory: fixture => {
      const ordinary = runnerInput(fixture, { changeFirstActor: true }).invoke;
      return vi.fn(async (role, messages) => {
        const data = stagePayload(messages);
        const text = JSON.stringify(messages);
        if (data.stage === 'clock-candidate') expect(text).toContain('ZERO_CUSTOM_CLOCK');
        if (data.stage === 'actor-batch') expect(text).toContain(mode === 'single' ? 'ZERO_CUSTOM_SINGLE' : 'ZERO_CUSTOM_ACTOR');
        return ordinary(role, messages);
      });
    } });
    const settings = structuredClone(f.store.read()!.settings);
    const segment = (content: string) => [{ role: 'system', content, enabled: true, deletable: true, pinned: false }];
    settings.worldRoundPrompts = { 'clock-recaller': segment('ZERO_CUSTOM_CLOCK'), 'world-simulator': segment('ZERO_CUSTOM_SINGLE'), 'actor-simulator': segment('ZERO_CUSTOM_ACTOR') };
    await f.store.updateAtomically(current => ({ ...current!, settings }));
    expect(await f.start()).toMatchObject({ status: 'completed' });
    const state = f.store.readState();
    expect(state.envelope!.task!.runMaterials!.promptsHash).toMatch(/^[a-f0-9]{64}$/);
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.settings.worldRoundPrompts).toEqual(settings.worldRoundPrompts);
    expect(f.store.readSource().turns[0].body).toBe(logicalBody);
  });

  it.each<Mode>(['single', 'layered'])('%s 真实零层将世界日期归一与正文新增人物在同一远端账本提交', async mode => {
    const f = await createFixture({ mode, actors: 25 });
    await f.store.updateState(state => {
      state.envelope!.ledger.clock = { ...state.envelope!.ledger.clock, day: 5, storyTime: '2025-04-10', precision: 'exact' };
      state.envelope!.ledger.actors[24] = { ...state.envelope!.ledger.actors[24], name: '既有巡灯人', simulationStatus: 'archived' };
      state.envelope!.ledger.actors[0] = { ...state.envelope!.ledger.actors[0], name: '守卫' };
      state.fields = seedLedgerFieldView_ACU(state.envelope!.ledger, state.envelope!.updatedAt);
    });
    const baselineBody = f.store.readSource().turns[0].body;
    const base = runnerInput(f);
    const invoke = vi.fn(async (role: string, messages: readonly { content: string }[]) => {
      const data = stagePayload(messages);
      if (data.stage === 'clock-candidate') return JSON.stringify({ candidateClock: {
        ...f.store.read()!.ledger.clock, day: 6, storyTime: '2025-04-11',
      } });
      if (data.stage === 'world-page') return JSON.stringify(modeledWorldWrites());
      if (data.stage === 'actor-batch' && data.allowActorRegistrations) {
        expect(data.actorIds).not.toContain('actor-24');
        expect(data.registrationRoster).toHaveLength(25);
        expect(data.registrationRoster).toContainEqual({ id: 'actor-24', name: '既有巡灯人', simulationStatus: 'archived' });
        expect(data.worldOverlay).toMatchObject({
          worldEvents: [{ id: 'bell-notice', startedAt: { day: 6, slot: '09:00:00' },
            deadline: { day: 8 }, nextCheck: { day: 7, reason: expect.any(String) },
            locationRefs: [{ region: '钟楼' }], legacy: null }],
          facts: [{ id: 'notice-ready', temporalKind: 'condition', happenedAt: null,
            validFrom: { day: 6, slot: '09:00:00' }, validUntil: { day: 8 },
            locationRef: { region: '钟楼' }, nextCheck: { day: 7, reason: expect.any(String) } }],
        });
        const ordinary = JSON.parse(await base.invoke(role, messages));
        ordinary.actorRegistrations = [{ expectedRevision: 0, evidenceQuote: '角色在广场等待',
          value: { ...registeredActor(), id: 'fresh-actor' } }];
        return JSON.stringify(ordinary);
      }
      return base.invoke(role, messages);
    });
    const result = await runWorldRound_ACU({ ...base, ledger: f.store.read()!.ledger, invoke });
    expect(result.roundCandidate.worldEventWrites).toHaveLength(1);
    expect(result.roundCandidate.factWrites).toContainEqual({ value: expect.objectContaining({ id: 'notice-ready' }), expectedRevision: 0 });
    expect(result.roundCandidate.actorWrites).toContainEqual({ value: expect.objectContaining({ id: 'fresh-actor' }), expectedRevision: 0 });
    expect(confirmRegistration).toHaveBeenCalledOnce();
    expect(confirmRegistration.mock.calls[0][0]).toMatchObject({ id: 'fresh-actor', name: '角色' });
    expect(confirmRegistration.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    await commitZeroLayerSimulationRound_ACU(f.store, {
      identity: f.identity, anchor: f.anchor, roundCandidate: result.roundCandidate,
      completedAt: 10, timelineId: 'timeline-1', summary: result.summary,
    });
    const ledger = f.store.read()!.ledger;
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(ledger);
    expect(ledger.worldEvents).toMatchObject([{ id: 'bell-notice', revision: 1, legacy: null, startedAt: { day: 6 } }]);
    expect(ledger.facts).toMatchObject([{ id: 'notice-ready', revision: 1, validFrom: { day: 6 }, worldEventIds: ['bell-notice'] }]);
    expect(ledger.actors).toContainEqual(expect.objectContaining({ id: 'fresh-actor', name: '角色', revision: 1 }));
    expect(ledger.actors.find(item => item.id === 'actor-24')).toMatchObject({ name: '既有巡灯人', simulationStatus: 'archived' });
    expect(remote.turns[0].body).toBe(baselineBody);
    expect(f.store.readSource().turns[0].body).toBe(baselineBody);
  });

  it.each<Mode>(['single', 'layered'])('%s 真实 runner 候选经 carrier 队列严格回读后才同时确认账本、栏目与回执', async mode => {
    const f = await createFixture({ mode, signal: true });
    expect(f.saveChat).toHaveBeenCalledTimes(1); // 元数据预留保存，不是候选业务保存。
    const execution = await executeCandidate(f, { changeFirstActor: true });
    expect(execution.result.roundCandidate.completion).toBe('changed');
    expect(execution.result.roundCandidate.candidateClock.day).toBe(2);
    expect(execution.result.roundCandidate.actorWrites).toHaveLength(1);
    expect(execution.result.roundCandidate.factWrites).toHaveLength(1);
    await execution.commit();

    const current = f.store.readSource();
    const state = current.branches[0].simulation!;
    expect(f.saveChat).toHaveBeenCalledTimes(2);
    expect(state.envelope!.ledger.clock.day).toBe(2);
    expect(state.envelope!.ledger.actors[0].goals).toEqual(['完成真实整轮测试']);
    expect(state.envelope!.ledger.facts.map(item => item.id)).toEqual(['fact-actor-00']);
    expect(state.fields.records.actors?.['actor-00']).toBeDefined();
    // 新整轮候选中的 facts/history 并未列入当前逐栏视图矩阵；账本本体才是其权威回读。
    expect(state.fields.records.facts).toBeUndefined();
    expect(state.confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    expect(current.turns[0].assistantFloor.data.simulation).toMatchObject({ delivery: 'ledger-only', projection: null });
    expect(current.turns[0].effectReceipts).toHaveLength(1);
    expect(current.turns[0].body).toBe(logicalBody);
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    expect((current.turns[0].assistantFloor.data.simulation as { projection: unknown }).projection).toBeNull();
    expect(execution.result.calls.some(call => call.role === (mode === 'single' ? 'world-simulator' : 'world-event-analyst'))).toBe(true);
  });

  it.each<Mode>(['single', 'layered'])('%s 空 roster 首人物批登记角色后，经真实 carrier 严格回读确认账本、栏目、远端与回执一致', async mode => {
    const f = await createFixture({ actors: 0, mode });
    const execution = await executeCandidate(f, { registerActor: true });

    expect(execution.result.roundCandidate.actorWrites).toContainEqual({ value: expect.objectContaining({ id: 'new-actor', name: '角色' }), expectedRevision: 0 });
    expect(execution.result.roundCandidate.actorCompletions).toContainEqual({ actorId: 'new-actor', completion: 'changed', expectedRevision: 0 });
    expect(execution.result.roundCandidate.candidateClock.day).toBe(2);
    await execution.commit();

    const source = f.store.readSource();
    const state = f.store.readState();
    const registered = state.envelope!.ledger.actors.find(item => item.id === 'new-actor')!;
    const remoteCarrier = f.getRemote()[0] as Record<string, unknown>;
    const remote = validateZeroLayerEnvelope_ACU(remoteCarrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU);
    const remoteState = remote.branches.find(branch => branch.branchId === 'branch-1')!.simulation!;
    const field = state.fields.records.actors?.['new-actor'];

    expect(registered).toMatchObject({
      id: 'new-actor', name: '角色', knownFacts: [], experiences: [], revision: 1,
      currentAction: { text: '等待巡逻结果', startedAtDay: execution.result.roundCandidate.candidateClock.day,
        startedAt: execution.result.roundCandidate.candidateClock.storyTime },
    });
    expect(field).toMatchObject({ status: 'legacy_unknown', fields: {
      name: { value: registered.name }, knownFacts: { value: [] }, currentAction: { value: registered.currentAction },
    } });
    expect(remoteState.envelope!.ledger.actors.find(item => item.id === 'new-actor')).toEqual(registered);
    expect(remoteState.fields.records.actors?.['new-actor']).toEqual(field);
    expect(remote.turns[0].body).toBe(logicalBody);
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    expect(source.turns[0].body).toBe(logicalBody);
    expect(state.confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    expect(source.turns[0].effectReceipts).toHaveLength(1);
    expect(f.getRemote()).toEqual(f.chat);
  });

  it.each<Mode>(['single', 'layered'])('%s 真实 runner 经严格 carrier 回读，以既有渠道和冻结正文原子保存人物认知', async mode => {
    const f = await createFixture({ mode, knowledgeActor: true });
    const execution = await executeCandidate(f, { knowledgeAcquisition: true });
    expect(execution.result.roundCandidate.completion).toBe('changed');
    expect(execution.result.roundCandidate.actorWrites[0].value.knownFacts).toEqual(['广场按时开放', '角色已得知广场守卫巡逻']);
    await execution.commit();

    const source = f.store.readSource();
    const state = f.store.readState();
    const registered = state.envelope!.ledger.actors[0];
    const remoteCarrier = f.getRemote()[0] as Record<string, unknown>;
    const remote = validateZeroLayerEnvelope_ACU(remoteCarrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU);
    const remoteState = remote.branches.find(branch => branch.branchId === 'branch-1')!.simulation!;
    const field = state.fields.records.actors?.['actor-00'];

    expect(registered.knownFacts).toEqual(['广场按时开放', '角色已得知广场守卫巡逻']);
    expect(state.envelope!.ledger.historyArchive).toBeUndefined();
    expect(field?.fields.knownFacts).toMatchObject({ value: registered.knownFacts });
    expect(remoteState.envelope!.ledger.actors[0].knownFacts).toEqual(registered.knownFacts);
    expect(remoteState.fields.records.actors?.['actor-00']?.fields.knownFacts).toEqual(field?.fields.knownFacts);
    expect(state.confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    expect(remote.turns[0].body).toBe(logicalBody);
    expect(source.turns[0].body).toBe(logicalBody);
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    expect(f.getRemote()).toEqual(f.chat);
  });

  it.each<Mode>(['single', 'layered'])('%s 真实 runner→commit 经严格 carrier 将已提交来源事实的同地认知传播给接收者', async mode => {
    const f = await createFixture({ mode, propagation: true });
    const execution = await executeCandidate(f, { propagation: true });

    expect(execution.result.roundCandidate.candidateClock.day).toBe(2);
    expect(execution.result.roundCandidate.actorWrites).toContainEqual({ value: expect.objectContaining({
      id: propagationReceiverActorId, knownFacts: [propagationKnowledge],
    }), expectedRevision: 1 });
    await execution.commit();

    const source = f.store.readSource();
    const state = f.store.readState();
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU);
    const remoteState = remote.branches.find(branch => branch.branchId === 'branch-1')!.simulation!;
    const sender = state.envelope!.ledger.actors.find(item => item.id === propagationSourceActorId)!;
    const receiver = state.envelope!.ledger.actors.find(item => item.id === propagationReceiverActorId)!;
    const sourceFact = state.envelope!.ledger.facts.find(item => item.id === propagationSourceFactId)!;

    expect(sender.knownFacts).toEqual([propagationKnowledge]);
    expect(receiver.knownFacts).toEqual([propagationKnowledge]);
    expect(sourceFact).toMatchObject({
      summary: propagationSourceFactSummary, actorIds: [propagationSourceActorId, propagationReceiverActorId],
      locationRef: propagationLocation, happenedAt: { day: 1 }, revealState: 'locked',
    });
    expect(state.fields.records.actors?.[propagationReceiverActorId]?.fields.knownFacts.value).toEqual([propagationKnowledge]);
    expect(remoteState.envelope!.ledger.actors.find(item => item.id === propagationReceiverActorId)?.knownFacts).toEqual([propagationKnowledge]);
    expect(remoteState.envelope!.ledger.facts.find(item => item.id === propagationSourceFactId)).toEqual(sourceFact);
    expect(source.turns[0].body).toBe(propagationBody);
    expect(remote.turns[0].body).toBe(propagationBody);
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    expect(f.getRemote()).toEqual(f.chat);
  });

  it.each<Mode>(['single', 'layered'])('%s 事实冷归档与本轮账本同 carrier 保存，来源和旧正文不丢失', async mode => {
    const f = await createFixture({ mode, expiredFact: true });
    const execution = await executeCandidate(f);
    await execution.commit();
    const ledger = f.store.read()!.ledger;
    expect(ledger.facts).toEqual([]);
    expect(ledger.factArchive).toMatchObject([{ id: 'expired', summary: '昨日封路', sourceRefs: ['旧封路来源'], revealState: 'locked' }]);
    expect(ledger.factArchiveRetention).toEqual({ completedRounds: 1, enteredAtRound: { expired: 1 } });
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(ledger);
    expect(f.store.readState().confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    expect(f.store.readSource().turns[0].body).toBe(logicalBody);
  });

  it('33 条既有重要历史经真实候选跨界保存时，同一 carrier 保存把最新 32 条留在 hot、最旧一条完整移入 cold', async () => {
    const f = await createFixture({ mode: 'layered', historyMilestones: 33 });
    const execution = await executeCandidate(f);
    expect(execution.result.roundCandidate.completion).toBe('changed');
    await execution.commit();

    const source = f.store.readSource();
    const state = f.store.readState();
    const ledger = state.envelope!.ledger;
    const remoteCarrier = f.getRemote()[0] as Record<string, unknown>;
    const remote = validateZeroLayerEnvelope_ACU(remoteCarrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU);
    const remoteLedger = remote.branches.find(branch => branch.branchId === 'branch-1')!.simulation!.envelope!.ledger;

    expect(ledger.historyMilestones).toHaveLength(32);
    expect(ledger.historyArchive).toEqual([historicalMilestone('history-seed-01', 1)]);
    expect(ledger.historyMilestones.map(item => item.id)).not.toContain('history-seed-01');
    expect(remoteLedger.historyMilestones).toEqual(ledger.historyMilestones);
    expect(remoteLedger.historyArchive).toEqual(ledger.historyArchive);
    expect(state.confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    expect(source.turns[0].body).toBe(logicalBody);
    expect(remote.turns[0].body).toBe(logicalBody);
    expect(f.getRemote()).toEqual(f.chat);
  });

  it('零层提交路径：联合审查清理的内部管理事实随候选真正删除并持久化，下一轮读取与目录都不再含它', async () => {
    const f = await createFixture({ mode: 'layered', prunable: true });
    const execution = await executeCandidate(f, { pruneFactIds: ['stale-internal', 'scene-open', 'ghost'] });
    expect(execution.result.roundCandidate).toMatchObject({ factRemovals: ['stale-internal'], completion: 'changed' });
    const pruneRequests = execution.input.invoke.mock.calls.filter(([, messages]) => stagePayload(messages as never).stage === 'world-review-maintenance-v1');
    expect(pruneRequests).toHaveLength(1);
    expect((stagePayload(pruneRequests[0][1] as never).pruneCandidates as Array<{ id: string }>).map(item => item.id)).toEqual(['live-secret', 'stale-internal']);
    await execution.commit();

    const ledger = f.store.readState().envelope!.ledger;
    expect(ledger.facts.map(item => item.id)).toEqual(['live-secret', 'scene-open']);
    expect(ledger.historyMilestones.find(item => item.id === 'prune-history')).toMatchObject({ sourceFactIds: ['live-secret'], summary: '既有重要历史 prune-history' });
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(ledger);
    expect(f.store.read()!.ledger.facts.map(item => item.id)).toEqual(['live-secret', 'scene-open']);
    expect(f.store.readSource().turns[0].body).toBe(logicalBody);
    // 下一轮的可清理目录直接来自已持久化账本，已删事实不会再出现。
    const next = runnerInput(f, { pruneFactIds: [] });
    await runWorldRound_ACU(next);
    const nextPrune = next.invoke.mock.calls.filter(([, messages]) => stagePayload(messages as never).stage === 'world-review-maintenance-v1');
    expect((stagePayload(nextPrune[0][1] as never).pruneCandidates as Array<{ id: string }>).map(item => item.id)).toEqual(['live-secret']);
  });

  it('零层提交路径：联合审查新建的重要历史随候选真正保存并持久化；人物批写的历史被忽略，引用不存在的事实跳过，下一轮目录含它', async () => {
    const f = await createFixture({ mode: 'layered' });
    const execution = await executeCandidate(f, { changeFirstActor: true, reviewHistory: { historyMilestoneWrites: [
      { value: { id: 'reviewed-history', summary: '守卫完成本轮行动', happenedAt: { day: 2, slot: '' }, actorIds: ['actor-00'], worldEventIds: [],
        locationRef: null, sourceFactIds: ['fact-actor-00'], importance: 2, category: '行动' }, expectedRevision: 0 },
      { value: { id: 'ghost-history', summary: '不存在的来源', actorIds: ['actor-00'], sourceFactIds: ['no-such-fact'] }, expectedRevision: 0 },
    ] } });
    expect(execution.result.roundCandidate.historyMilestoneWrites.map(item => item.value.id)).toEqual(['reviewed-history']);
    const requests = execution.input.invoke.mock.calls.filter(([, messages]) => stagePayload(messages as never).stage === 'world-review-maintenance-v1');
    expect(requests).toHaveLength(1);
    const request = stagePayload(requests[0][1] as never);
    expect((request.historyChanges as { facts: Array<{ id: string }> }).facts.map(item => item.id)).toEqual(['fact-actor-00']);
    await execution.commit();

    const ledger = f.store.readState().envelope!.ledger;
    expect(ledger.historyMilestones.map(item => item.id)).toEqual(['reviewed-history']);
    expect(ledger.historyMilestones[0]).toMatchObject({ sourceFactIds: ['fact-actor-00'], visibility: 'internal', revision: 1 });
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(ledger);
    expect(f.store.readSource().turns[0].body).toBe(logicalBody);
    // 下一轮读到的账本直接来自已持久化账本，已含这条历史。
    expect(runnerInput(f).ledger.historyMilestones.map(item => item.id)).toEqual(['reviewed-history']);
  });

  it('零层提交路径：联合审查清理的已结束事件随候选真正删除并持久化，下一轮读取与目录都不再含它', async () => {
    const f = await createFixture({ mode: 'layered', prunableEvents: true });
    const execution = await executeCandidate(f, { pruneEventIds: ['ended-gone', 'ended-held', 'still-active', 'ghost'] });
    expect(execution.result.roundCandidate).toMatchObject({ eventRemovals: ['ended-gone'], completion: 'changed' });
    expect(execution.result.roundCandidate.factRemovals).toBeUndefined();
    const pruneRequests = execution.input.invoke.mock.calls.filter(([, messages]) => stagePayload(messages as never).stage === 'world-review-maintenance-v1');
    expect(pruneRequests).toHaveLength(1);
    expect((stagePayload(pruneRequests[0][1] as never).pruneEventCandidates as Array<{ id: string }>).map(item => item.id)).toEqual(['ended-gone']);
    await execution.commit();

    const ledger = f.store.readState().envelope!.ledger;
    expect(ledger.worldEvents.map(item => item.id)).toEqual(['ended-held', 'still-active']);
    expect(ledger.worldEvents.find(item => item.id === 'still-active')).toMatchObject({ relatedEventIds: [], state: '状态 still-active', revision: 3 });
    expect(ledger.facts.map(item => item.id)).toEqual(['gone-result', 'held-secret']);
    expect(ledger.facts[0]).toMatchObject({ summary: '事件的结果事实', worldEventIds: [], revision: 2 });
    expect(ledger.facts[1].revealGate).toEqual({ requiredEventIds: ['ended-held'], semanticCondition: '主角询问' });
    expect(ledger.historyMilestones.find(item => item.id === 'event-history')).toMatchObject({ worldEventIds: ['still-active'], summary: '既有重要历史 event-history' });
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(ledger);
    expect(f.store.read()!.ledger.worldEvents.map(item => item.id)).toEqual(['ended-held', 'still-active']);
    expect(f.store.readSource().turns[0].body).toBe(logicalBody);
    // 下一轮的事件目录直接来自已持久化账本：已删事件不再出现，被未解锁秘密引用的事件依旧不进目录。
    const next = runnerInput(f, { pruneEventIds: [] });
    await runWorldRound_ACU(next);
    const nextPrune = next.invoke.mock.calls.filter(([, messages]) => stagePayload(messages as never).stage === 'world-review-maintenance-v1');
    expect(nextPrune).toHaveLength(1);
    const nextPayload = stagePayload(nextPrune[0][1] as never);
    expect((nextPayload.pruneCandidates as Array<{ id: string }>).map(item => item.id)).toEqual(['held-secret']);
    expect(nextPayload.pruneEventCandidates).toBeUndefined();
    expect(JSON.stringify(nextPrune[0][1])).not.toContain('ended-gone');
  });

  it('零层提交路径：事件清理建议全部不合格时不删除任何事件，整轮仍按原候选提交', async () => {
    const f = await createFixture({ mode: 'layered', prunableEvents: true });
    const execution = await executeCandidate(f, { pruneEventIds: ['ended-held', 'still-active', 'ghost'] });
    expect(execution.result.roundCandidate.eventRemovals).toBeUndefined();
    await execution.commit();
    expect(f.store.readState().envelope!.ledger.worldEvents.map(item => item.id)).toEqual(['ended-gone', 'ended-held', 'still-active']);
  });

  it('零层提交路径：清理建议全部不合格时不删除任何事实，整轮仍按原候选提交', async () => {
    const f = await createFixture({ mode: 'layered', prunable: true });
    const execution = await executeCandidate(f, { pruneFactIds: ['scene-open', 'ghost'] });
    expect(execution.result.roundCandidate.factRemovals).toBeUndefined();
    await execution.commit();
    expect(f.store.readState().envelope!.ledger.facts.map(item => item.id)).toEqual(['stale-internal', 'live-secret', 'scene-open']);
  });

  it('25 人后批非 JSON 时，前批传播认知可提交，既有来源事实保持锁定且后批人物不串知情', async () => {
    const f = await createFixture({ actors: 25, mode: 'layered', propagation: true });
    const before = structuredClone(f.store.read()!.ledger);
    const execution = await executeCandidate(f, { propagation: true, failSecondActorBatch: true });
    expect(execution.result.roundCandidate.actorWrites).toContainEqual({ value: expect.objectContaining({
      id: propagationReceiverActorId, knownFacts: [propagationKnowledge],
    }), expectedRevision: 1 });
    expect(execution.result.roundCandidate.actorCompletions).toContainEqual({ actorId: 'actor-22', completion: 'no_change', expectedRevision: 1 });
    await execution.commit();

    const ledger = f.store.read()!.ledger;
    expect(ledger.actors.find(item => item.id === propagationReceiverActorId)?.knownFacts).toEqual([propagationKnowledge]);
    expect(ledger.actors.find(item => item.id === 'actor-22')).toEqual(before.actors.find(item => item.id === 'actor-22'));
    expect(ledger.actors.find(item => item.id === 'actor-22')?.knownFacts).toEqual([]);
    expect(ledger.actors.find(item => item.id === propagationSourceActorId)?.knownFacts).toEqual([propagationKnowledge]);
    expect(ledger.facts).toEqual([expect.objectContaining({ id: propagationSourceFactId, revealState: 'locked' })]);
    expect(f.store.readState().fields.records.actors?.[propagationReceiverActorId]?.fields.knownFacts.value).toEqual([propagationKnowledge]);
    expect(f.store.readState().confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    expect(f.store.readSource().turns[0]).toMatchObject({ body: propagationBody, effectReceipts: [expect.any(Object)] });
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(ledger);
  });

  it('25 人后批非 JSON 时，首批认知与既有历史归档随整轮保存，后批保留原状', async () => {
    const f = await createFixture({ actors: 25, mode: 'layered', historyMilestones: 33, knowledgeActor: true });
    const before = structuredClone(f.store.read()!.ledger);
    const execution = await executeCandidate(f, { knowledgeAcquisition: true, failSecondActorBatch: true });
    expect(execution.result.roundCandidate.actorWrites[0].value.knownFacts).toEqual(['广场按时开放', '角色已得知广场守卫巡逻']);
    await execution.commit();

    const ledger = f.store.read()!.ledger;
    expect(ledger.actors[0].knownFacts).toEqual(['广场按时开放', '角色已得知广场守卫巡逻']);
    expect(ledger.actors[24]).toEqual(before.actors[24]);
    expect(ledger.historyMilestones).toHaveLength(32);
    expect(ledger.historyArchive).toEqual([historicalMilestone('history-seed-01', 1)]);
    expect(f.store.readState().fields.records.actors?.['actor-00']?.fields.knownFacts.value).toEqual(ledger.actors[0].knownFacts);
    expect(f.store.readState().confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    expect(f.store.readSource().turns[0].effectReceipts).toHaveLength(1);
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(ledger);
  });

  it('25 人后批非 JSON 时，首批新人物登记仍保存到 carrier、账本、栏目和回执', async () => {
    const f = await createFixture({ actors: 25, mode: 'layered' });
    const before = structuredClone(f.store.read()!.ledger);
    const execution = await executeCandidate(f, { registerActor: true, failSecondActorBatch: true });
    expect(execution.result.roundCandidate.actorWrites).toContainEqual({ value: expect.objectContaining({ id: 'new-actor' }), expectedRevision: 0 });
    await execution.commit();

    const ledger = f.store.read()!.ledger;
    expect(ledger.actors.find(item => item.id === 'new-actor')).toMatchObject({ name: '角色', knownFacts: [], revision: 1 });
    expect(ledger.actors[24]).toEqual(before.actors[24]);
    expect(f.store.readState().fields.records.actors?.['new-actor']).toBeDefined();
    expect(f.store.readState().confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    expect(f.store.readSource().turns[0].effectReceipts).toHaveLength(1);
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(ledger);
  });

  it('25 人后批 API 网络失败时 runner 不产生候选，carrier 账本、确认与回执都不落部分结果', async () => {
    const f = await createFixture({ actors: 25, mode: 'layered', agedColdFact: true });
    const before = structuredClone(f.store.readSource());
    const input = runnerInput(f, { changeFirstActor: true, throwSecondActorBatch: true });
    await expect(runWorldRound_ACU(input)).rejects.toThrow('network');
    expect(f.saveChat).toHaveBeenCalledTimes(1); // 只有预留元数据保存。
    expect(f.store.readSource()).toEqual(before);
    expect(f.store.readState().envelope!.ledger.factArchiveRetention).toEqual({ completedRounds: 10, enteredAtRound: { 'old-cold': 0 } });
    expect(f.store.readState().envelope!.ledger.factArchive).toMatchObject([{ id: 'old-cold' }]);
    expect(f.store.readState().envelope!.ledger.clock.day).toBe(1);
    expect(f.store.readState().confirmed).toEqual([]);
    expect(f.store.readSource().turns[0].effectReceipts).toEqual([]);
  });

  it('候选保存结果未知时 carrier 队列阻止盲重试；显式回读旧快照后才允许复用已完成候选提交', async () => {
    const f = await createFixture({ mode: 'layered' });
    const execution = await executeCandidate(f, { changeFirstActor: true });
    f.saveChat.mockImplementationOnce(async () => { throw new Error('保存后网络中断'); });
    await expect(execution.commit()).rejects.toMatchObject({ code: 'persist-unknown' });
    await expect(execution.commit()).rejects.toMatchObject({ code: 'persist-unknown' });
    expect(f.saveChat).toHaveBeenCalledTimes(2); // 第二次未重发保存。
    const recovered = await f.store.store.recover();
    expect(recovered?.branches[0].simulation?.envelope?.ledger.clock.day).toBe(1);
    await execution.commit();
    expect(f.saveChat).toHaveBeenCalledTimes(3);
    expect(f.store.readState().envelope!.ledger.clock.day).toBe(2);
    expect(f.store.readState().confirmed).toMatchObject([{ ledgerRevision: 1 }]);
  });

  it('carrier active swipe 在候选提交前改变时拒绝，不追加保存或回执', async () => {
    const f = await createFixture({ mode: 'single' });
    const execution = await executeCandidate(f, { changeFirstActor: true });
    f.carrier.swipe_id = 1;
    await expect(execution.commit()).rejects.toMatchObject({ code: 'scope-changed' });
    expect(f.saveChat).toHaveBeenCalledTimes(1);
    expect(() => f.store.readSource()).toThrow(/active swipe 已变化/);
  });

  it.each<Mode>(['single', 'layered'])('%s 从真实 start 经 prepare、runner 和 carrier 提交完成；权威回读后重复 start 不重跑', async mode => {
    const f = await createOrchestratedFixture({ mode, agedColdFact: true });
    const baseline = structuredClone(f.store.read()!.ledger);
    expect(baseline.factArchiveRetention).toEqual({ completedRounds: 10, enteredAtRound: { 'old-cold': 0 } });

    const result = await f.start();
    expect(result).toMatchObject({ status: 'completed', identity: {
      workflowProtocol: 'world-round-v1', workflowMode: mode, deliveryTarget: 'body',
    }, result: { outcome: 'world_round', finalProjection: { deliverable: false, content: null } } });
    const authoritative = f.store.readSource();
    const state = f.store.readState();
    expect(f.getRemote()).toEqual(f.chat);
    expect(state.envelope!.task).toMatchObject({ status: 'completed', activeRun: null, completedRun: {
      runId: result.identity.runId, workflowProtocol: 'world-round-v1', workflowMode: mode, deliveryTarget: 'body',
    } });
    expect(state.envelope!.ledger).toMatchObject({ revision: 1, clock: { day: 2 }, actors: [{ goals: ['完成真实整轮测试'] }] });
    expect(state.envelope!.ledger.factArchive).toEqual([]);
    expect(state.envelope!.ledger.factArchiveRetention).toEqual({ completedRounds: 11, enteredAtRound: {} });
    expect(state.envelope!.ledger.facts).toContainEqual(expect.objectContaining({ id: 'current-secret', revealState: 'locked', supersedesFactIds: [] }));
    expect(state.envelope!.ledger.historyMilestones).toContainEqual(expect.objectContaining({ id: 'referencing-history', sourceFactIds: [] }));
    const remoteLedger = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU])
      .branches[0].simulation!.envelope!.ledger;
    expect(remoteLedger).toEqual(state.envelope!.ledger);
    expect(state.confirmed).toMatchObject([{ ledgerRevision: 1 }]);
    expect(authoritative.turns[0].assistantFloor.data.simulation).toMatchObject({ delivery: 'body', bodyFactIds: [], projection: null });
    expect(authoritative.turns[0].effectReceipts).toHaveLength(1);
    expect(f.saveChat).toHaveBeenCalledTimes(4); // 预留、资料冻结、计划冻结、业务 carrier 保存；元数据与业务保存分别计数。
    const calls = f.invoke.mock.calls.length;
    await expect(f.start()).resolves.toEqual({ status: 'skipped', reason: 'duplicate' });
    expect(f.invoke).toHaveBeenCalledTimes(calls);
  });

  it('取消后落为 paused，资料哈希不变时长期 workflow 偏好变化不改冻结身份且可恢复', async () => {
    let releaseClock!: () => void;
    let clockReached!: () => void;
    const clockEntered = new Promise<void>(resolve => { releaseClock = resolve; });
    const clockStarted = new Promise<void>(resolve => { clockReached = resolve; });
    const f = await createOrchestratedFixture({
      mode: 'layered',
      invokeFactory: fixture => vi.fn(async (role, messages) => {
        const data = stagePayload(messages);
        if (data.stage === 'clock-candidate') {
          clockReached();
          await clockEntered;
        }
        return runnerInput(fixture, { changeFirstActor: true }).invoke(role, messages);
      }),
    });
    const running = f.start();
    await clockStarted;
    expect(f.invoke).toHaveBeenCalledTimes(2);
    expect(f.orchestrator.cancel(f.anchor.chatIdentity)).toBe(true);
    releaseClock();

    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    const paused = f.store.read()!;
    const frozenMaterials = paused.task!.runMaterials;
    expect(paused.task).toMatchObject({ status: 'paused', stopReason: 'manual', activeRun: {
      workflowMode: 'layered', workflowProtocol: 'world-round-v1', deliveryTarget: 'body',
    } });
    expect(frozenMaterials).toBeDefined();
    await f.store.updateState(state => { state.envelope!.settings.workflowMode = 'single'; });
    const resumed = await f.resume('继续');
    expect(resumed).toMatchObject({ status: 'completed', identity: {
      workflowMode: 'layered', workflowProtocol: 'world-round-v1', deliveryTarget: 'body',
    } });
    expect(f.store.read()!.task!.runMaterials).toEqual(frozenMaterials);
    expect(f.store.read()!.ledger.revision).toBe(1);
  });

  it.each([
    ['世界书正文', 'WORLD_SIMULATION_REVISION_CONFLICT', (f: Awaited<ReturnType<typeof createOrchestratedFixture>>) => f.setWorldbookSnapshot(worldbookSnapshot('小世界书正文：守卫改记了另一套规则。'))],
    ['世界书条目增删', 'WORLD_SIMULATION_REVISION_CONFLICT', (f: Awaited<ReturnType<typeof createOrchestratedFixture>>) => f.setWorldbookSnapshot({ ...worldbookSnapshot(), entries: [] })],
    ['长期要求', 'WORLD_SIMULATION_REVISION_CONFLICT', async (f: Awaited<ReturnType<typeof createOrchestratedFixture>>) => {
      await f.store.updateState(state => { state.userRequirements = { schemaVersion: 1, requirements: ['改用第三人称'], updatedAt: 2 }; });
    }],
    ['非机械即时 instruction', 'WORLD_SIMULATION_CONFIG_INVALID', (_f: Awaited<ReturnType<typeof createOrchestratedFixture>>) => undefined],
  ] as const)('%s 改变后 resume 在 prepare/invoke 前结构化拒绝，并保留 paused carrier 事实', async (_kind, errorCode, mutate) => {
    let releaseClock!: () => void;
    let clockReached!: () => void;
    const clockEntered = new Promise<void>(resolve => { releaseClock = resolve; });
    const clockStarted = new Promise<void>(resolve => { clockReached = resolve; });
    const f = await createOrchestratedFixture({
      mode: 'layered',
      invokeFactory: fixture => vi.fn(async (role, messages) => {
        const data = stagePayload(messages);
        if (data.stage === 'clock-candidate') { clockReached(); await clockEntered; }
        return runnerInput(fixture, { changeFirstActor: true }).invoke(role, messages);
      }),
    });
    const running = f.start();
    await clockStarted;
    expect(f.orchestrator.cancel(f.anchor.chatIdentity)).toBe(true);
    releaseClock();
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    const pausedSource = structuredClone(f.store.readSource());
    const callsBeforeResume = f.invoke.mock.calls.length;
    await mutate(f);

    const resumed = f.resume(_kind === '非机械即时 instruction' ? '改成围绕钟楼推进' : '继续');
    await expect(resumed).rejects.toMatchObject({ error: { code: errorCode } });

    expect(f.invoke).toHaveBeenCalledTimes(callsBeforeResume);
    expect(f.store.read()!.task).toMatchObject({ status: 'paused', activeRun: pausedSource.branches[0].simulation!.envelope!.task!.activeRun });
    expect(f.store.readState().confirmed).toEqual(pausedSource.branches[0].simulation!.confirmed);
    expect(f.store.readSource().turns[0].body).toBe(logicalBody);
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    expect(f.store.readSource().turns[0].effectReceipts).toEqual([]);
  });

  it('世界书 snapshot unavailable 时 resume 在 prepare/invoke 前结构化拒绝，并保留 paused 事实', async () => {
    let releaseClock!: () => void;
    let clockReached!: () => void;
    const clockEntered = new Promise<void>(resolve => { releaseClock = resolve; });
    const clockStarted = new Promise<void>(resolve => { clockReached = resolve; });
    const f = await createOrchestratedFixture({
      invokeFactory: fixture => vi.fn(async (role, messages) => {
        if (stagePayload(messages).stage === 'clock-candidate') { clockReached(); await clockEntered; }
        return runnerInput(fixture, { changeFirstActor: true }).invoke(role, messages);
      }),
    });
    const running = f.start();
    await clockStarted;
    f.orchestrator.cancel(f.anchor.chatIdentity);
    releaseClock();
    await running;
    const callsBeforeResume = f.invoke.mock.calls.length;
    f.setWorldbookSnapshot({ available: false, entries: [] });

    const resumed = f.resume('继续');

    await expect(resumed).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' } });
    expect(f.invoke).toHaveBeenCalledTimes(callsBeforeResume);
    expect(f.store.read()!.task).toMatchObject({ status: 'paused', activeRun: expect.any(Object) });
    expect(f.store.readState().confirmed).toEqual([]);
    expect(f.store.readSource().turns[0]).toMatchObject({ body: logicalBody, effectReceipts: [] });
    expect(f.carrier.mes).toBe('物理正文：不得改写');
  });

  it.each(['resume', 'same-anchor start'] as const)('新协议 paused 缺少 manifest 时 %s 放弃旧进度重新整轮，保留旧账本并只提交一次', async action => {
    const f = await createOrchestratedFixture({ mode: 'layered' });
    const oldRunId = 'paused-no-manifest';
    await f.store.updateState(state => {
      const identity = { ...f.identity, runId: oldRunId, baseLedgerRevision: 1 };
      state.envelope!.task = { ...reservedStage(identity).task, status: 'paused', stopReason: 'manual' };
      state.envelope!.activeStageId = identity.stageId;
      state.envelope!.stages = reservedStage(identity).stages;
      state.envelope!.ledger.revision = 1;
      state.envelope!.ledger.historyMilestones = [historicalMilestone('old-committed-history', 1)];
      state.userRequirements = { schemaVersion: 1, requirements: ['保留原有世界设定'], updatedAt: 2 };
    });
    const before = f.store.readState();
    expect(before.envelope!.task!.runMaterials).toBeUndefined();
    expect(before.confirmed).toEqual([]);
    expect(f.store.readSource().turns[0].effectReceipts).toEqual([]);

    const result = action === 'resume' ? await f.resume('继续') : await f.start();

    expect(result).toMatchObject({ status: 'completed', identity: {
      workflowProtocol: 'world-round-v1', baseLedgerRevision: 1,
    } });
    if (result.status !== 'completed') throw new Error('缺 manifest 应重新完成整轮');
    expect(result.identity.runId).not.toBe(oldRunId);
    expect(result.identity.taskId).not.toBe(before.envelope!.task!.taskId);
    const state = f.store.readState();
    const source = f.store.readSource();
    const remote = validateZeroLayerEnvelope_ACU((f.getRemote()[0] as Record<string, unknown>)[ZERO_LAYER_CARRIER_FIELD_ACU]);
    expect(state.envelope!.task).toMatchObject({ status: 'completed', activeRun: null, completedRun: { runId: result.identity.runId } });
    expect(state.envelope!.activeStageId).not.toBe(before.envelope!.activeStageId);
    expect(state.envelope!.stages.some(stage => stage.stageId === before.envelope!.activeStageId)).toBe(false);
    expect(state.envelope!.task!.runMaterials).toBeDefined();
    expect(state.envelope!.ledger.revision).toBe(before.envelope!.ledger.revision + 1);
    expect(state.envelope!.ledger.historyMilestones).toContainEqual(historicalMilestone('old-committed-history', 1));
    expect(state.envelope!.ledger.actors[0].goals).toEqual(['完成真实整轮测试']);
    expect(state.envelope!.settings).toEqual(before.envelope!.settings);
    expect(state.userRequirements).toEqual(before.userRequirements);
    expect(state.confirmed).toEqual([{ ref: f.anchor.logicalRef, ledgerRevision: 2 }]);
    expect(source.turns[0].effectReceipts).toHaveLength(1);
    expect(source.turns[0].effectReceipts[0]).toMatchObject({ kind: 'simulation' });
    expect(source.turns[0].body).toBe(logicalBody);
    expect(remote.turns[0].body).toBe(logicalBody);
    expect(remote.branches[0].simulation!.envelope!.ledger).toEqual(state.envelope!.ledger);
    expect(remote.branches[0].simulation!.confirmed).toEqual(state.confirmed);
    expect(remote.turns[0].effectReceipts).toEqual(source.turns[0].effectReceipts);
    expect(f.carrier.mes).toBe('物理正文：不得改写');
    expect(f.getRemote()).toEqual(f.chat);
  });

  it.each([
    ['后批非 JSON', false], ['后批 API 网络失败', true],
  ] as const)('25 人%s时，orchestrator 只在可提交候选存在时增加 ledger revision 与回执', async (_outcome, networkFailure) => {
    const f = await createOrchestratedFixture({
      actors: 25,
      mode: 'layered',
      invokeFactory: fixture => runnerInput(fixture, { changeFirstActor: true, failSecondActorBatch: !networkFailure, throwSecondActorBatch: networkFailure }).invoke,
    });

    const result = await f.start();

    if (networkFailure) {
      expect(result).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('network') } });
      expect(f.store.read()!.ledger).toMatchObject({ revision: 0, clock: { day: 1 }, facts: [] });
      expect(f.store.readState().confirmed).toEqual([]);
      expect(f.store.readSource().turns[0].effectReceipts).toEqual([]);
    } else {
      expect(result).toMatchObject({ status: 'completed' });
      expect(f.store.read()!.ledger.revision).toBe(1);
      expect(f.store.read()!.ledger.clock.day).toBe(2);
      expect(f.store.read()!.ledger.actors.find(item => item.id === 'actor-00')?.goals).toEqual(['完成真实整轮测试']);
      expect(f.store.read()!.ledger.actors[24]).toEqual(actor('actor-24'));
      expect(f.store.read()!.ledger.facts).toContainEqual(expect.objectContaining({ id: 'fact-actor-00' }));
      expect(f.store.readState().confirmed).toMatchObject([{ ledgerRevision: 1 }]);
      expect(f.store.readSource().turns[0].effectReceipts).toHaveLength(1);
    }
  });

  it('resume 时权威 ledger revision 漂移，在模型调用前拒绝', async () => {
    const f = await createOrchestratedFixture({ mode: 'single' });
    await f.store.updateState(state => {
      const identity = { ...f.identity, runId: 'paused-run', baseLedgerRevision: 0 };
      state.envelope!.task = { ...reservedStage(identity).task, status: 'paused', stopReason: 'manual' };
      state.envelope!.activeStageId = identity.stageId;
      state.envelope!.stages = reservedStage(identity).stages;
      state.envelope!.task!.runMaterials = buildWorldRunMaterials_ACU({
        instruction: originInstruction, userRequirements: state.userRequirements, worldbookSnapshot: worldbookSnapshot(),
      });
      // 模拟恢复前已由其他权威写入推进的 ledger；必须经真实 carrier 保存，不能改 readState 的 clone。
      state.envelope!.ledger.revision = 1;
    });
    expect(f.store.read()!.ledger.revision).toBe(1);

    await expect(f.resume()).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_REVISION_CONFLICT' } });
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it.each(['active branch', 'swipe'] as const)('%s 在整轮提交前变化时阻断，账本与 receipt 不落盘', async kind => {
    let actorReached!: () => void;
    const actorStarted = new Promise<void>(resolve => { actorReached = resolve; });
    const f = await createOrchestratedFixture({
      mode: 'single',
      invokeFactory: fixture => vi.fn(async (role, messages) => {
        const data = stagePayload(messages);
        if (data.stage === 'actor-batch') {
          actorReached();
          if (kind === 'swipe') fixture.carrier.swipe_id = 1;
          else (fixture.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU).activeBranchId = 'other-branch';
        }
        return runnerInput(fixture, { changeFirstActor: true }).invoke(role, messages);
      }),
    });
    const carrierBaseline = structuredClone(f.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU);
    const running = f.start();
    await actorStarted;
    expect(f.invoke.mock.calls.some(([, messages]) => stagePayload(messages).stage === 'actor-batch')).toBe(true);

    await expect(running).resolves.toMatchObject({ status: 'failed' });
    // scope 已变化时 store 权威读取必须拒绝；直接检查 carrier 原始字段，不能借 clone/readState 伪装未提交。
    expect(() => f.store.read()).toThrow();
    const carrierSource = f.carrier[ZERO_LAYER_CARRIER_FIELD_ACU] as ZeroLayerEnvelope_ACU;
    const branch = carrierSource.branches.find(item => item.branchId === 'branch-1')!;
    const baselineBranch = carrierBaseline.branches.find(item => item.branchId === 'branch-1')!;
    expect(branch.simulation!.envelope!.ledger).toEqual(baselineBranch.simulation!.envelope!.ledger);
    expect(carrierSource.turns[0].effectReceipts).toEqual([]);
  });
});
