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
  WORLD_SIMULATION_MATERIALS_SCHEMA_VERSION_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU,
  type WorldChronicleArchiveSnapshot_ACU,
  type WorldSimulationAnchorIdentity_ACU,
  type WorldSimulationBucket_ACU,
  type WorldSimulationCommitCandidate_ACU,
  type WorldSimulationConversationFloorRecord_ACU,
  type WorldSimulationMaterialsSnapshot_ACU,
} from './agent/agent-model';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldSimulationEnvelope_ACU, type WorldSimulationRunIdentity_ACU, type WorldSimulationTimelineEntry_ACU } from './model';
import { sweepWorldLifecycle_ACU } from './lifecycle-sweeper';
import { progressionPlan_ACU } from './progression-plan';
import { relevanceGate_ACU } from './relevance-gate';
import { applyWorldSimulationProjection_ACU, buildWorldSimulationProjection_ACU, readWorldSimulationMessageContent_ACU, writeWorldSimulationActiveSwipeContent_ACU } from './simulation-projection';
import { applyWorldSimulationCandidatesDetailed_ACU } from './simulation-transaction';
import { WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU, buildEmptyWorldChronicleArchiveSnapshot_ACU, buildWorldSimulationBucketKey_ACU, resolveCurrentWorldSimulationAnchor_ACU, validateWorldSimulationChronicleArchiveSnapshot_ACU, validateWorldSimulationEnvelope_ACU, validateWorldSimulationLedger_ACU } from './simulation-store';

interface CommitInput_ACU {
  identity: WorldSimulationRunIdentity_ACU;
  anchor: WorldSimulationAnchorIdentity_ACU;
  commitCandidate: WorldSimulationCommitCandidate_ACU;
  completedAt: number;
  timelineId: string;
}

type Record_ACU = Record<string, unknown>;
const tailsByChat_ACU = new Map<string, Promise<void>>();
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

function readArchiveSnapshot_ACU(raw: unknown, anchor: WorldSimulationAnchorIdentity_ACU): WorldChronicleArchiveSnapshot_ACU {
  if (raw === undefined) return buildEmptyWorldChronicleArchiveSnapshot_ACU();
  if (!isRecord_ACU(raw) || raw.schemaVersion !== 1 || !isRecord_ACU(raw.entries)) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU} 分桶结构损坏`);
  }
  const entry = (raw.entries as Record<string, unknown>)[buildWorldSimulationBucketKey_ACU(anchor)];
  if (entry === undefined) return buildEmptyWorldChronicleArchiveSnapshot_ACU();
  if (!isRecord_ACU(entry) || !Object.prototype.hasOwnProperty.call(entry, 'value')) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU} 当前 swipe 条目损坏`);
  }
  return validateWorldSimulationChronicleArchiveSnapshot_ACU(entry.value, 'persist');
}

function assertRun_ACU(envelope: WorldSimulationEnvelope_ACU, input: CommitInput_ACU): void {
  const run = envelope.task?.activeRun;
  const candidate = input.commitCandidate;
  if (!run || envelope.task?.taskId !== input.identity.taskId || run.runId !== input.identity.runId) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交租约已失效');
  if (envelope.activeStageId !== input.identity.stageId || run.stageRevision !== input.identity.stageRevision) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交阶段已失效');
  if (envelope.ledger.revision !== input.identity.baseLedgerRevision) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交基础账本 revision 已变化');
  if (candidate.runId !== input.identity.runId || candidate.taskId !== input.identity.taskId || candidate.stageId !== input.identity.stageId || candidate.stageRevision !== input.identity.stageRevision || candidate.baseLedgerRevision !== input.identity.baseLedgerRevision) {
    reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', 'commit candidate 身份与运行租约不一致');
  }
}

function bucketWithEntry_ACU<T>(raw: unknown, anchor: WorldSimulationAnchorIdentity_ACU, value: T, updatedAt: number, field: string): WorldSimulationBucket_ACU<T> {
  if (raw !== undefined && (!isRecord_ACU(raw) || raw.schemaVersion !== 1 || !isRecord_ACU(raw.entries))) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `${field} 分桶结构损坏`);
  const entries = raw === undefined ? {} : ((raw as Record_ACU).entries as Record<string, any>);
  return { schemaVersion: 1, entries: { ...entries, [buildWorldSimulationBucketKey_ACU(anchor)]: { anchor: { ...anchor }, value, updatedAt } } };
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

async function commitWithinQueue_ACU(input: CommitInput_ACU): Promise<void> {
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
  const envelope = validateWorldSimulationEnvelope_ACU(rawEnvelope, 'persist');
  assertRun_ACU(envelope, input);
  const applied = applyWorldSimulationCandidatesDetailed_ACU(
    envelope.ledger,
    input.commitCandidate.acceptedCandidates,
    new Set(input.commitCandidate.evidenceRefs),
    envelope.settings,
  );
  let ledger = applied.ledger;
  ledger = maintainWorldPlayer_ACU(ledger, envelope.ledger.player);
  const extraTimeline: WorldSimulationTimelineEntry_ACU[] = [];
  const daysAdvanced = Math.max(0, ledger.clock.day - envelope.ledger.clock.day);
  const storyText = readWorldSimulationMessageContent_ACU(anchorMessage);
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
  const nextEnvelope = completedEnvelope_ACU(envelope, input, ledger, extraTimeline);
  const materials: WorldSimulationMaterialsSnapshot_ACU = {
    schemaVersion: WORLD_SIMULATION_MATERIALS_SCHEMA_VERSION_ACU,
    ledgerRevision: ledger.revision,
    ledger: validateWorldSimulationLedger_ACU(ledger, 'agent_persist'),
    evidenceRefs: [...input.commitCandidate.evidenceRefs],
    updatedAt: input.completedAt,
  };
  const nextStateBucket = bucketWithEntry_ACU(
    anchorMessage[WORLD_SIMULATION_STATE_FIELD_ACU], persistedAnchor, ledger, input.completedAt,
    WORLD_SIMULATION_STATE_FIELD_ACU,
  );
  const nextMaterialsBucket = bucketWithEntry_ACU(
    anchorMessage[WORLD_SIMULATION_MATERIALS_FIELD_ACU], persistedAnchor, materials, input.completedAt,
    WORLD_SIMULATION_MATERIALS_FIELD_ACU,
  );
  const archiveSnapshot = readArchiveSnapshot_ACU(anchorMessage[WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU], currentAnchor);
  for (const write of applied.chronicleArchiveWrites) archiveSnapshot.records[write.archiveRef] = write;
  const nextArchiveBucket = bucketWithEntry_ACU(
    anchorMessage[WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU], persistedAnchor, archiveSnapshot, input.completedAt,
    WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  );
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
    { target: anchorMessage, key: 'mes', existed: Object.prototype.hasOwnProperty.call(anchorMessage, 'mes'), value: anchorMessage.mes },
    { target: anchorMessage, key: 'message', existed: Object.prototype.hasOwnProperty.call(anchorMessage, 'message'), value: anchorMessage.message },
    { target: anchorMessage, key: 'swipes', existed: Object.prototype.hasOwnProperty.call(anchorMessage, 'swipes'), value: Array.isArray(anchorMessage.swipes) ? [...anchorMessage.swipes] : anchorMessage.swipes },
  ];
  let saveAttempted = false;
  try {
    firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = nextEnvelope;
    anchorMessage[WORLD_SIMULATION_STATE_FIELD_ACU] = nextStateBucket;
    anchorMessage[WORLD_SIMULATION_MATERIALS_FIELD_ACU] = nextMaterialsBucket;
    if (nextConversationBucket) anchorMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = nextConversationBucket;
    anchorMessage[WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU] = nextArchiveBucket;
    writeWorldSimulationActiveSwipeContent_ACU(anchorMessage, newContent);
    if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== input.identity.chatIdentity) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交前聊天上下文已变化');
    }
    saveAttempted = true;
    await saveChatToHostStrict_ACU();
    if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== input.identity.chatIdentity) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '宿主保存后聊天上下文已变化');
    }
    resolveCurrentWorldSimulationAnchor_ACU(persistedAnchor, chat);
  } catch (error) {
    for (const snapshot of snapshots) restoreField_ACU(snapshot.target, snapshot.key, snapshot.existed, snapshot.value);
    const stillActive = getChatArray_ACU() === chat && getActiveChatStorageIdentity_ACU(chat) === input.identity.chatIdentity;
    if (saveAttempted && stillActive) {
      try {
        await saveChatToHostStrict_ACU();
      } catch (rollbackError) {
        reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '世界推演联合提交与补偿保存均失败', {
          primaryMessage: error instanceof Error ? error.message : String(error),
          rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
    }
    if (error instanceof WorldSimulationValidationError_ACU) throw error;
    reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '世界推演联合提交失败，内存快照已恢复', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function commitWorldSimulationProjection_ACU(input: CommitInput_ACU): Promise<void> {
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
