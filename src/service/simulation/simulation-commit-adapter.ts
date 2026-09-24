import {
  assertCollisionFulfillment_ACU,
  filterUnreachableRumorSignals_ACU,
  maintainWorldPlayer_ACU,
  refreshWorldRumors_ACU,
  sweepWorldLedger_ACU,
} from './world-dynamics';

import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import {
  migrateLegacyWorldSimulationConversationBucket_ACU,
  validateWorldSimulationConversationFloorRecord_ACU,
} from './agent/agent-conversation-store';
import {
  WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU,
  WORLD_SIMULATION_RUN_WRITE_FIELD_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU,
  type WorldChronicleArchiveDetail_ACU,
  type WorldChronicleArchiveSnapshot_ACU,
  type WorldSimulationAnchorIdentity_ACU,
  type WorldSimulationBucket_ACU,
  type WorldSimulationCommitCandidate_ACU,
  type WorldSimulationConversationFloorRecord_ACU,
} from './agent/agent-model';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldSimulationEnvelope_ACU, type WorldSimulationRunIdentity_ACU, type WorldSimulationTimelineEntry_ACU } from './model';
import { sweepWorldLifecycle_ACU } from './lifecycle-sweeper';
import { progressionPlan_ACU } from './progression-plan';
import { relevanceGate_ACU } from './relevance-gate';
import { applyWorldSimulationProjection_ACU, buildWorldSimulationProjection_ACU, readWorldSimulationMessageContent_ACU, writeWorldSimulationActiveSwipeContent_ACU } from './simulation-projection';
import { applyWorldSimulationCandidatesDetailedViaSql_ACU } from './simulation-transaction';
import { appendWorldSimulationCommitChain_ACU, extractWorldSimulationPartialFields_ACU, foldWorldSimulationArchive_ACU, foldWorldSimulationLedger_ACU } from './simulation-ledger-fold';
import { commitWorldSimulationFieldWritesWithinQueue_ACU, type WorldSimulationFieldCommitInput_ACU, type WorldSimulationFieldCommitReceipt_ACU } from './simulation-field-commit-adapter';
import { hasPartialWorldSimulationRunWrites_ACU, readWorldSimulationRunWriteProof_ACU, rebaseWorldSimulationRunWriteProof_ACU, stageWorldSimulationRunWriteProof_ACU, type WorldSimulationRunWriteState_ACU } from './simulation-run-write-state';
import { WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU, buildWorldSimulationBucketKey_ACU, resolveCurrentWorldSimulationAnchor_ACU, validateWorldSimulationEnvelope_ACU } from './simulation-store';

interface CommitInput_ACU {
  identity: WorldSimulationRunIdentity_ACU;
  anchor: WorldSimulationAnchorIdentity_ACU;
  commitCandidate: WorldSimulationCommitCandidate_ACU;
  completedAt: number;
  timelineId: string;
  runWrites?: WorldSimulationRunWriteState_ACU;
}

type Record_ACU = Record<string, unknown>;
const tailsByChat_ACU = new Map<string, Promise<unknown>>();
const isRecord_ACU = (value: unknown): value is Record_ACU => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone_ACU = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function reject_ACU(code: 'WORLD_SIMULATION_REVISION_CONFLICT' | 'WORLD_SIMULATION_PERSIST_FAILED' | 'WORLD_SIMULATION_SNAPSHOT_INVALID', message: string, details?: Record_ACU): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(code, 'persist', message, false, details));
}

function lastCatalyzedAtDayBySeed_ACU(timeline: readonly WorldSimulationTimelineEntry_ACU[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const entry of timeline) {
    if (entry.kind !== 'progressed' || !entry.message) continue;
    try {
      const parsed = JSON.parse(entry.message) as { seedId?: unknown; advance?: unknown; day?: unknown };
      if (typeof parsed.seedId !== 'string' || parsed.advance !== 'catalyze' || typeof parsed.day !== 'number' || !Number.isInteger(parsed.day)) continue;
      map[parsed.seedId] = parsed.day;
    } catch {
      continue;
    }
  }
  return map;
}

function assertRun_ACU(envelope: WorldSimulationEnvelope_ACU, input: CommitInput_ACU): void {
  const run = envelope.task?.activeRun;
  const candidate = input.commitCandidate;
  if (!run || envelope.task?.taskId !== input.identity.taskId || run.runId !== input.identity.runId) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交租约已失效');
  if (envelope.activeStageId !== input.identity.stageId || run.stageRevision !== input.identity.stageRevision) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交阶段已失效');
  if (!input.runWrites?.hasConfirmedWrites && envelope.ledger.revision !== input.identity.baseLedgerRevision) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交基础账本 revision 已变化');
  if (candidate.runId !== input.identity.runId || candidate.taskId !== input.identity.taskId || candidate.stageId !== input.identity.stageId || candidate.stageRevision !== input.identity.stageRevision || candidate.baseLedgerRevision !== input.identity.baseLedgerRevision) {
    reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', 'commit candidate 身份与运行租约不一致');
  }
}

function exactKeys_ACU(raw: Record_ACU, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${path}.${key} 是未知字段`);
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${path}.${key} 缺失`);
  }
}

function validateConversationAnchor_ACU(raw: unknown, path: string): WorldSimulationAnchorIdentity_ACU {
  if (!isRecord_ACU(raw)) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${path} 必须是对象`);
  exactKeys_ACU(raw, ['chatIdentity', 'messageIndex', 'messageId', 'messageKey', 'swipeId', 'contentDigest'], path);
  const messageId = raw.messageId;
  if ((typeof messageId !== 'string' || !messageId.trim())
    && (typeof messageId !== 'number' || !Number.isInteger(messageId))) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${path}.messageId 非法`);
  }
  if (typeof raw.chatIdentity !== 'string' || !raw.chatIdentity.trim()
    || typeof raw.messageKey !== 'string' || !raw.messageKey.trim()
    || typeof raw.swipeId !== 'string' || !raw.swipeId.trim()
    || typeof raw.contentDigest !== 'string' || !raw.contentDigest.trim()
    || typeof raw.messageIndex !== 'number' || !Number.isInteger(raw.messageIndex) || raw.messageIndex < 0) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${path} 身份字段非法`);
  }
  return {
    chatIdentity: raw.chatIdentity,
    messageIndex: raw.messageIndex,
    messageId,
    messageKey: raw.messageKey,
    swipeId: raw.swipeId,
    contentDigest: raw.contentDigest,
  };
}

function conversationBucketWithMigratedEntry_ACU(
  raw: unknown,
  message: Record_ACU,
  sourceAnchor: WorldSimulationAnchorIdentity_ACU,
  persistedAnchor: WorldSimulationAnchorIdentity_ACU,
  updatedAt: number,
): WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU> | undefined {
  if (raw === undefined) return undefined;
  const legacy = migrateLegacyWorldSimulationConversationBucket_ACU(
    raw,
    message,
    sourceAnchor.chatIdentity,
    sourceAnchor.messageIndex,
  );
  const normalized = legacy ?? raw;
  if (!isRecord_ACU(normalized) || normalized.schemaVersion !== 1 || !isRecord_ACU(normalized.entries)) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${WORLD_SIMULATION_CONVERSATION_FIELD_ACU} 分桶结构损坏`);
  }
  exactKeys_ACU(normalized, ['schemaVersion', 'entries'], WORLD_SIMULATION_CONVERSATION_FIELD_ACU);
  const entries: WorldSimulationBucket_ACU<WorldSimulationConversationFloorRecord_ACU>['entries'] = {};
  for (const [key, candidate] of Object.entries(normalized.entries)) {
    const path = `${WORLD_SIMULATION_CONVERSATION_FIELD_ACU}.entries.${key}`;
    if (!isRecord_ACU(candidate)) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${path} 必须是对象`);
    exactKeys_ACU(candidate, ['anchor', 'value', 'updatedAt'], path);
    const anchor = validateConversationAnchor_ACU(candidate.anchor, `${path}.anchor`);
    if (buildWorldSimulationBucketKey_ACU(anchor) !== key) {
      reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${path} 的 key 与 anchor 不一致`);
    }
    if (typeof candidate.updatedAt !== 'number' || !Number.isInteger(candidate.updatedAt) || candidate.updatedAt < 0) {
      reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${path}.updatedAt 必须是非负整数`);
    }
    entries[key] = {
      anchor,
      value: validateWorldSimulationConversationFloorRecord_ACU(candidate.value),
      updatedAt: candidate.updatedAt,
    };
  }
  const source = entries[buildWorldSimulationBucketKey_ACU(sourceAnchor)];
  if (source === undefined) return { schemaVersion: 1, entries };
  const storedAnchor = source.anchor;
  if (storedAnchor.chatIdentity !== sourceAnchor.chatIdentity
    || storedAnchor.messageId !== sourceAnchor.messageId
    || storedAnchor.messageKey !== sourceAnchor.messageKey
    || storedAnchor.swipeId !== sourceAnchor.swipeId
    || storedAnchor.contentDigest !== sourceAnchor.contentDigest) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${WORLD_SIMULATION_CONVERSATION_FIELD_ACU} 当前锚点身份不一致`);
  }
  return {
    schemaVersion: 1,
    entries: {
      ...entries,
      [buildWorldSimulationBucketKey_ACU(persistedAnchor)]: { anchor: { ...persistedAnchor }, value: source.value, updatedAt },
    },
  };
}

function completedEnvelope_ACU(
  envelope: WorldSimulationEnvelope_ACU,
  input: CommitInput_ACU,
  ledger: WorldSimulationEnvelope_ACU['ledger'],
  extraTimeline: WorldSimulationTimelineEntry_ACU[] = [],
  persistedAnchor: WorldSimulationAnchorIdentity_ACU,
): WorldSimulationEnvelope_ACU {
  const next: WorldSimulationEnvelope_ACU = {
    ...envelope,
    ledger,
    task: envelope.task ? {
      ...envelope.task,
      status: 'completed' as const,
      updatedAt: input.completedAt,
      activeRun: null,
      stopReason: null,
      ...(input.identity.triggerKind === 'assistant_completed' ? { completedAutoAnchor: {
        chatIdentity: persistedAnchor.chatIdentity, messageKey: persistedAnchor.messageKey,
        swipeId: persistedAnchor.swipeId, contentDigest: persistedAnchor.contentDigest,
      } } : {}),
    } : null,
    stages: envelope.stages.map(stage => stage.stageId === input.identity.stageId
      ? { ...stage, status: 'completed' as const }
      : stage),
    timeline: [...envelope.timeline, ...extraTimeline, {
      id: input.timelineId,
      at: input.completedAt,
      kind: 'committed' as const,
      taskId: input.identity.taskId,
      stageId: input.identity.stageId,
      revision: input.identity.stageRevision,
      runId: input.identity.runId,
      message: input.commitCandidate.summary,
    }],
    lastError: null,
    updatedAt: input.completedAt,
  };
  return validateWorldSimulationEnvelope_ACU(next, 'persist');
}

function restoreField_ACU(target: Record_ACU, key: string, existed: boolean, value: unknown): void {
  if (existed) target[key] = value;
  else delete target[key];
}

async function commitWithinQueue_ACU(input: CommitInput_ACU): Promise<WorldSimulationAnchorIdentity_ACU> {
  const chat = getChatArray_ACU();
  const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
  if (chatIdentity !== input.identity.chatIdentity || chatIdentity !== input.anchor.chatIdentity) {
    reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交目标聊天已变化');
  }
  const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(input.anchor, chat);
  const firstMessage = isRecord_ACU(chat[0]) ? chat[0] : null;
  const anchorMessage = isRecord_ACU(chat[currentAnchor.messageIndex]) ? chat[currentAnchor.messageIndex] : null;
  if (!firstMessage || !anchorMessage) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '提交目标楼层不可用');

  const rawEnvelope = firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
  const validatedEnvelope = validateWorldSimulationEnvelope_ACU(rawEnvelope, 'persist');
  const foldedBefore = foldWorldSimulationLedger_ACU(chat, currentAnchor.messageIndex);
  const envelope = foldedBefore ? { ...validatedEnvelope, ledger: foldedBefore.ledger } : validatedEnvelope;
  assertRun_ACU(envelope, input);
  const storyText = readWorldSimulationMessageContent_ACU(anchorMessage);
  const archiveBefore = foldWorldSimulationArchive_ACU(chat, currentAnchor.messageIndex).snapshot;
  const runWriteView = { ledger: envelope.ledger, fields: foldedBefore?.fields, archive: archiveBefore };
  input.runWrites?.assertCurrent(runWriteView);
  const runWriteProof = readWorldSimulationRunWriteProof_ACU(currentAnchor, chat);
  input.runWrites?.assertPersistedProof(input.identity, runWriteProof);
  input.runWrites?.assertCandidatesDisjoint(input.commitCandidate.acceptedCandidates);
  if (!input.commitCandidate.acceptedCandidates.length && !input.runWrites?.hasConfirmedWrites) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '提交缺少已确认写入和候选');
  }
  const applied = input.commitCandidate.acceptedCandidates.length
    ? await applyWorldSimulationCandidatesDetailedViaSql_ACU(
      envelope.ledger, input.commitCandidate.acceptedCandidates, new Set(input.commitCandidate.evidenceRefs),
      envelope.settings, { anchorMessage: storyText, chronicleArchive: archiveBefore },
    )
    : { ledger: envelope.ledger, chronicleArchiveWrites: [] as WorldChronicleArchiveDetail_ACU[] };
  let ledger = {
    ...applied.ledger,
    ...(input.commitCandidate.pendingFixes
      ? { pendingFixes: clone_ACU(input.commitCandidate.pendingFixes) }
      : {}),
    ...(input.commitCandidate.materialCompletion
      ? { materialCompletion: clone_ACU(input.commitCandidate.materialCompletion) }
      : {}),
  };
  ledger = maintainWorldPlayer_ACU(ledger, envelope.ledger.player);
  const extraTimeline: WorldSimulationTimelineEntry_ACU[] = [];
  const daysAdvanced = Math.max(0, ledger.clock.day - envelope.ledger.clock.day);
  const relevance = relevanceGate_ACU(ledger, storyText);
  const directives = progressionPlan_ACU({
    ledger,
    daysAdvanced,
    relevance,
    lastCatalyzedAtDayBySeed: lastCatalyzedAtDayBySeed_ACU(envelope.timeline),
  });
  for (const directive of directives) {
    extraTimeline.push({
      id: `${input.timelineId}:progressed:${directive.seedId}`,
      at: input.completedAt,
      kind: 'progressed',
      taskId: input.identity.taskId,
      stageId: input.identity.stageId,
      revision: input.identity.stageRevision,
      runId: input.identity.runId,
      message: JSON.stringify({ seedId: directive.seedId, advance: directive.advance, reason: directive.reason, day: ledger.clock.day, circle: directive.circle }),
    });
  }
  const sweep = sweepWorldLedger_ACU(ledger, envelope.settings);
  ledger = sweep.ledger;
  if (sweep.sweptSeedIds.length) extraTimeline.push({
    id: `${input.timelineId}:swept`, at: input.completedAt, kind: 'swept',
    taskId: input.identity.taskId, stageId: input.identity.stageId, revision: input.identity.stageRevision, runId: input.identity.runId,
    message: sweep.sweptSeedIds.join(','),
  });
  const life = sweepWorldLifecycle_ACU(ledger, envelope.settings);
  ledger = life.ledger;
  if (life.droppedRumorIds.length || life.droppedSeedIds.length || life.droppedActorIds.length || life.compressedRegionVisits) {
    extraTimeline.push({
      id: `${input.timelineId}:lifecycle`, at: input.completedAt, kind: 'swept',
      taskId: input.identity.taskId, stageId: input.identity.stageId, revision: input.identity.stageRevision, runId: input.identity.runId,
      message: JSON.stringify({
        droppedRumorIds: life.droppedRumorIds,
        droppedSeedIds: life.droppedSeedIds,
        droppedActorIds: life.droppedActorIds,
        compressedRegionVisits: life.compressedRegionVisits,
      }),
    });
  }
  if (life.skipped.length) {
    extraTimeline.push({
      id: `${input.timelineId}:lifecycle-skip`, at: input.completedAt, kind: 'swept',
      taskId: input.identity.taskId, stageId: input.identity.stageId, revision: input.identity.stageRevision, runId: input.identity.runId,
      message: JSON.stringify({ skipped: life.skipped }),
    });
  }
  const filtered = filterUnreachableRumorSignals_ACU(ledger.guidance, ledger);
  ledger = { ...ledger, guidance: filtered.guidance };
  ledger = refreshWorldRumors_ACU(ledger, ledger.guidance.signals.flatMap(signal => signal.voice === 'rumor' && signal.sourceId ? [signal.sourceId] : []), envelope.settings);
  const collisionReport = input.commitCandidate.collisionReport;
  if (collisionReport) {
    const violations = assertCollisionFulfillment_ACU(collisionReport, ledger.guidance, ledger);
    if (violations.length && envelope.settings.dynamics.collisionEnforcement === 'strict') {
      reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `碰撞后验失败：${violations.join('；')}`, { violations });
    }
    if (violations.length) extraTimeline.push({
      id: `${input.timelineId}:collision`, at: input.completedAt, kind: 'failed',
      taskId: input.identity.taskId, stageId: input.identity.stageId, revision: input.identity.stageRevision, runId: input.identity.runId,
      message: violations.join('；'), errorCode: 'WORLD_SIMULATION_SNAPSHOT_INVALID',
    });
  }
  const projection = buildWorldSimulationProjection_ACU(ledger);
  const oldContent = readWorldSimulationMessageContent_ACU(anchorMessage);
  const newContent = applyWorldSimulationProjection_ACU(oldContent, projection);
  const persistedAnchor: WorldSimulationAnchorIdentity_ACU = {
    ...currentAnchor,
    contentDigest: sha256HexSync_ACU(newContent),
  };
  const nextEnvelope = completedEnvelope_ACU(envelope, input, ledger, extraTimeline, persistedAnchor);
  const archiveSnapshot: WorldChronicleArchiveSnapshot_ACU = {
    schemaVersion: archiveBefore.schemaVersion,
    records: { ...archiveBefore.records },
  };
  for (const write of applied.chronicleArchiveWrites) archiveSnapshot.records[write.archiveRef] = write;
  const nextConversationBucket = conversationBucketWithMigratedEntry_ACU(
    anchorMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU],
    anchorMessage,
    currentAnchor,
    persistedAnchor,
    input.completedAt,
  );

  const snapshots = [
    { target: firstMessage, key: WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU, existed: Object.prototype.hasOwnProperty.call(firstMessage, WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU), value: rawEnvelope },
    { target: anchorMessage, key: WORLD_SIMULATION_STATE_FIELD_ACU, existed: Object.prototype.hasOwnProperty.call(anchorMessage, WORLD_SIMULATION_STATE_FIELD_ACU), value: anchorMessage[WORLD_SIMULATION_STATE_FIELD_ACU] },
    { target: anchorMessage, key: WORLD_SIMULATION_MATERIALS_FIELD_ACU, existed: Object.prototype.hasOwnProperty.call(anchorMessage, WORLD_SIMULATION_MATERIALS_FIELD_ACU), value: anchorMessage[WORLD_SIMULATION_MATERIALS_FIELD_ACU] },
    { target: anchorMessage, key: WORLD_SIMULATION_CONVERSATION_FIELD_ACU, existed: Object.prototype.hasOwnProperty.call(anchorMessage, WORLD_SIMULATION_CONVERSATION_FIELD_ACU), value: anchorMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] },
    { target: anchorMessage, key: WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, existed: Object.prototype.hasOwnProperty.call(anchorMessage, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU), value: anchorMessage[WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU] },
    { target: anchorMessage, key: WORLD_SIMULATION_RUN_WRITE_FIELD_ACU, existed: Object.prototype.hasOwnProperty.call(anchorMessage, WORLD_SIMULATION_RUN_WRITE_FIELD_ACU), value: anchorMessage[WORLD_SIMULATION_RUN_WRITE_FIELD_ACU] },
    { target: anchorMessage, key: 'mes', existed: Object.prototype.hasOwnProperty.call(anchorMessage, 'mes'), value: anchorMessage.mes },
    { target: anchorMessage, key: 'message', existed: Object.prototype.hasOwnProperty.call(anchorMessage, 'message'), value: anchorMessage.message },
    { target: anchorMessage, key: 'swipes', existed: Object.prototype.hasOwnProperty.call(anchorMessage, 'swipes'), value: Array.isArray(anchorMessage.swipes) ? [...anchorMessage.swipes] : anchorMessage.swipes },
  ];
  // 基线重建可能改写早于当前锚点的 checkpoint 与归档；补偿必须覆盖那些楼层。
  for (const message of chat) {
    if (!isRecord_ACU(message) || message === anchorMessage) continue;
    for (const key of [WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU]) {
      snapshots.push({ target: message, key, existed: Object.prototype.hasOwnProperty.call(message, key), value: message[key] });
    }
  }
  const messages = [...chat];
  const originalFields = snapshots.map(({ target, key, existed, value }) => ({ target, key, existed, value,
    content: JSON.stringify(value) }));
  const messagesIntact = (): boolean => chat.length === messages.length && messages.every((message, index) => chat[index] === message);
  const fieldsIntact = (fields: Array<Omit<(typeof originalFields)[number], 'value'>>): boolean => messagesIntact() && fields.every(field =>
    Object.prototype.hasOwnProperty.call(field.target, field.key) === field.existed
    && JSON.stringify(field.target[field.key]) === field.content);
  let saveAttempted = false;
  let stagedFields: Array<Omit<(typeof originalFields)[number], 'value'>> | null = null;
  const currentFieldsIntact = (): boolean => stagedFields !== null && fieldsIntact(stagedFields);
  try {
    firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = nextEnvelope;
    if (nextConversationBucket) anchorMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = nextConversationBucket;
    writeWorldSimulationActiveSwipeContent_ACU(anchorMessage, newContent);
    appendWorldSimulationCommitChain_ACU({
      chat,
      messageIndex: currentAnchor.messageIndex,
      anchor: persistedAnchor,
      beforeLedger: envelope.ledger,
      nextLedger: ledger,
      evidenceRefs: input.commitCandidate.evidenceRefs,
      updatedAt: input.completedAt,
      checkpointIndex: foldedBefore?.checkpointIndex ?? null,
      beforeArchive: archiveBefore,
      nextArchive: archiveSnapshot,
      // 必须取改写锚点正文前的折叠：分桶键含正文摘要，改写后旧键下的逐栏草稿不可再读。
      beforePartials: foldedBefore ? extractWorldSimulationPartialFields_ACU(foldedBefore.fields) : {},
    });
    const projectedFold = foldWorldSimulationLedger_ACU(chat, persistedAnchor.messageIndex);
    const projectedView = { ledger: projectedFold?.ledger ?? nextEnvelope.ledger, fields: projectedFold?.fields,
      archive: foldWorldSimulationArchive_ACU(chat, persistedAnchor.messageIndex).snapshot };
    if (hasPartialWorldSimulationRunWrites_ACU(projectedView)) {
      if (!runWriteProof) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
      stageWorldSimulationRunWriteProof_ACU(chat, persistedAnchor,
        rebaseWorldSimulationRunWriteProof_ACU(runWriteProof, runWriteView, projectedView), input.completedAt);
    }
    if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== input.identity.chatIdentity
      || !messagesIntact() || !originalFields.every(field => JSON.stringify(field.value) === field.content)) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交前聊天或旧字段已变化');
    }
    stagedFields = snapshots.map(({ target, key }) => ({ target, key,
      content: JSON.stringify(target[key]), existed: Object.prototype.hasOwnProperty.call(target, key) }));
    saveAttempted = true;
    await saveChatToHostStrict_ACU();
    if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== input.identity.chatIdentity) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '宿主保存后聊天上下文已变化');
    }
    resolveCurrentWorldSimulationAnchor_ACU(persistedAnchor, chat);
    if (!currentFieldsIntact()) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '宿主保存期间提交字段已变化');
    if (hasPartialWorldSimulationRunWrites_ACU(projectedView)) {
      const persistedProof = readWorldSimulationRunWriteProof_ACU(persistedAnchor, chat);
      const expectedProof = rebaseWorldSimulationRunWriteProof_ACU(runWriteProof!, runWriteView, projectedView);
      const verifiedFold = foldWorldSimulationLedger_ACU(chat, persistedAnchor.messageIndex);
      const verifiedView = { ledger: verifiedFold?.ledger ?? nextEnvelope.ledger, fields: verifiedFold?.fields,
        archive: foldWorldSimulationArchive_ACU(chat, persistedAnchor.messageIndex).snapshot };
      const verifiedProof = rebaseWorldSimulationRunWriteProof_ACU(runWriteProof!, runWriteView, verifiedView);
      if (!persistedProof || persistedProof.stateDigest !== expectedProof.stateDigest
        || verifiedProof.fingerprint !== expectedProof.fingerprint) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
    }
  } catch (error) {
    const stillActive = getChatArray_ACU() === chat && getActiveChatStorageIdentity_ACU(chat) === input.identity.chatIdentity;
    // 宿主监听器若原地改写已保存对象，不能把自己的旧快照覆盖其新状态并声称补偿成功。
    if (saveAttempted && (!stillActive || !currentFieldsIntact() || !originalFields.every(field =>
      JSON.stringify(field.value) === field.content))) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '世界推演保存期间状态已变化，无法安全补偿', {
        message: error instanceof Error ? error.message : String(error), recovery: 'unavailable',
      });
    }
    for (const snapshot of snapshots) restoreField_ACU(snapshot.target, snapshot.key, snapshot.existed, snapshot.value);
    if (saveAttempted && stillActive) {
      try {
        await saveChatToHostStrict_ACU();
      } catch (rollbackError) {
        reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '世界推演联合提交与补偿保存均失败', {
          primaryMessage: error instanceof Error ? error.message : String(error),
          rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError), recovery: 'failed',
        });
      }
      if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== input.identity.chatIdentity
        || !fieldsIntact(originalFields)) {
        reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '世界推演补偿保存后状态已变化，无法确认恢复', {
          message: error instanceof Error ? error.message : String(error), recovery: 'unavailable',
        });
      }
    }
    if (error instanceof WorldSimulationValidationError_ACU) throw error;
    reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '世界推演联合提交失败，内存快照已恢复', {
      message: error instanceof Error ? error.message : String(error),
      ...(saveAttempted ? { recovery: 'saved' } : {}),
    });
  }
  return persistedAnchor;
}

export function commitWorldSimulationProjection_ACU(input: CommitInput_ACU): Promise<WorldSimulationAnchorIdentity_ACU> {
  const previous = tailsByChat_ACU.get(input.identity.chatIdentity) ?? Promise.resolve();
  const result = previous.then(() => commitWithinQueue_ACU(input), () => commitWithinQueue_ACU(input));
  const settled = result.catch((): void => undefined);
  tailsByChat_ACU.set(input.identity.chatIdentity, settled);
  void settled.finally(() => {
    if (tailsByChat_ACU.get(input.identity.chatIdentity) === settled) tailsByChat_ACU.delete(input.identity.chatIdentity);
  });
  return result;
}

export type WorldSimulationCommitInput_ACU = CommitInput_ACU;

/** 世界推演逐栏写入和最终投影提交共享队列，防止旧账本覆盖即时写入。 */
export function commitWorldSimulationFieldWrites_ACU(input: WorldSimulationFieldCommitInput_ACU): Promise<WorldSimulationFieldCommitReceipt_ACU> {
  const key = input.identity.chatIdentity;
  const previous = tailsByChat_ACU.get(key) ?? Promise.resolve();
  const result = previous.then(() => commitWorldSimulationFieldWritesWithinQueue_ACU(input), () => commitWorldSimulationFieldWritesWithinQueue_ACU(input));
  const settled: Promise<void> = result.then((): void => undefined, (): void => undefined);
  tailsByChat_ACU.set(key, settled);
  void settled.finally(() => { if (tailsByChat_ACU.get(key) === settled) tailsByChat_ACU.delete(key); });
  return result;
}
