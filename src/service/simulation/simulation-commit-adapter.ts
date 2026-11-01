import {
  assertCollisionFulfillment_ACU,
  repairCollisionSignals_ACU,
  filterUnreachableRumorSignals_ACU,
  maintainWorldPlayer_ACU,
  refreshWorldRumors_ACU,
  sweepWorldLedger_ACU,
} from './world-dynamics';

import { getChatArray_ACU, HostChatSaveNotStartedError_ACU, refreshMessageBlock_ACU, saveChatToHostStrict_ACU } from '../../data/gateways/chat-gateway';
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
import { applyWorldSimulationProjection_ACU, buildWorldFactBodyProjection_ACU, buildWorldSimulationProjection_ACU, readWorldSimulationMessageContent_ACU, writeWorldSimulationActiveSwipeContent_ACU } from './simulation-projection';
import { applyWorldSimulationCandidatesDetailedViaSql_ACU } from './simulation-transaction';
import { claimWorldBodyProjection_ACU, type WorldBodyProjectionProof_ACU, type WorldFactRevealProof_ACU } from './agent/world-projection-stage';
import { materializeReviewedWorldRoundCandidate_ACU, materializeWorldRoundCandidate_ACU, materializeWorldRoundPreview_ACU, type WorldRoundCandidate_ACU } from './world-candidate';
import { appendWorldSimulationCommitChain_ACU, ensureWorldSimulationBaselineFloor_ACU, extractWorldSimulationPartialFields_ACU, foldWorldSimulationArchive_ACU, foldWorldSimulationLedger_ACU, seedLedgerFieldView_ACU } from './simulation-ledger-fold';
import { removeWorldActor_ACU } from './world-actor-removal';
import { removeWorldEvent_ACU } from './world-event-removal';
import { removeWorldHistoryMilestone_ACU } from './world-history-removal';
import { appendWorldActors_ACU } from './world-actor-import';
import { buildDefaultWorldSimulationEnvelope_ACU } from './defaults';
import type { WorldActor_ACU } from './model';
import { commitWorldSimulationFieldWritesWithinQueue_ACU, type WorldSimulationFieldCommitInput_ACU, type WorldSimulationFieldCommitReceipt_ACU } from './simulation-field-commit-adapter';
import { hasPartialWorldSimulationRunWrites_ACU, readWorldSimulationRunWriteProof_ACU, rebaseWorldSimulationRunWriteProof_ACU, stageWorldSimulationRunWriteProof_ACU, type WorldSimulationRunWriteState_ACU } from './simulation-run-write-state';
import { WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU, buildWorldSimulationBucketEntries_ACU, isWorldSimulationBucketKey_ACU, resolveWorldSimulationBucketEntry_ACU, resolveCurrentWorldSimulationAnchor_ACU, resolveWorldSimulationAnchor_ACU, validateWorldSimulationEnvelope_ACU } from './simulation-store';
import { assertWorldSimulationHostEnvelope_ACU, assertWorldSimulationHostRun_ACU, requireWorldSimulationHostAnchor_ACU } from './simulation-identity';
import { planWorldLegacyBackfill_ACU, legacyBackfillFingerprint_ACU } from './world-legacy-backfill';

interface CommitInput_ACU {
  identity: WorldSimulationRunIdentity_ACU;
  anchor: WorldSimulationAnchorIdentity_ACU;
  commitCandidate: WorldSimulationCommitCandidate_ACU;
  completedAt: number;
  timelineId: string;
  runWrites?: WorldSimulationRunWriteState_ACU;
  roundCandidate?: WorldRoundCandidate_ACU;
  bodyProjection?: { proof: WorldBodyProjectionProof_ACU };
  /** 仅由显式受审入口以私有授权标记注入，不能由普通导出伪造启用。 */
  reviewedReveal?: {
    proof: WorldFactRevealProof_ACU;
    factIds: readonly string[];
    identity: WorldSimulationRunIdentity_ACU;
    targetAnchor: WorldSimulationAnchorIdentity_ACU;
  };
}

type Record_ACU = Record<string, unknown>;
const tailsByChat_ACU = new Map<string, Promise<unknown>>();
/** 授权资格只存在模块私有 WeakSet，任何公开函数输入的同名字段均无权开启 reveal。 */
const reviewedRevealInputs_ACU = new WeakSet<object>();
const isRecord_ACU = (value: unknown): value is Record_ACU => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasAuthorizedReviewedReveal_ACU = (input: CommitInput_ACU): input is CommitInput_ACU & { reviewedReveal: NonNullable<CommitInput_ACU['reviewedReveal']> } =>
  reviewedRevealInputs_ACU.has(input) && input.reviewedReveal !== undefined;
const hasUntrustedReviewedRevealFields_ACU = (input: object): boolean =>
  Object.prototype.hasOwnProperty.call(input, 'reviewedReveal')
  || Object.prototype.hasOwnProperty.call(input, 'proof')
  || Object.prototype.hasOwnProperty.call(input, 'factIds');
const clone_ACU = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** 宿主会重建消息对象并调整 JSON 键序；私有字段按值比较，数组顺序仍有意义。 */
function canonical_ACU(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (Array.isArray(entry) && entry.every(item => isRecord_ACU(item) && typeof item.id === 'string')
      && new Set(entry.map(item => (item as Record_ACU).id)).size === entry.length) {
      return [...entry].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    }
    return isRecord_ACU(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry;
  });
}

function hostFloorIdentity_ACU(message: Record_ACU): string {
  const rawId = message.message_id;
  // 与 simulation-store 的默认身份一致：缺 message_id 回退到楼层序号，由调用者提供。
  return JSON.stringify([rawId === undefined ? null : String(rawId),
    typeof message.swipe_id === 'number' && Number.isInteger(message.swipe_id) && message.swipe_id >= 0 ? message.swipe_id : 0,
    message.is_user === true, message.is_system === true]);
}

function reject_ACU(code: 'WORLD_SIMULATION_REVISION_CONFLICT' | 'WORLD_SIMULATION_PERSIST_FAILED' | 'WORLD_SIMULATION_SNAPSHOT_INVALID' | 'WORLD_SIMULATION_CONFIG_INVALID', message: string, details?: Record_ACU): never {
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
  if (input.roundCandidate ? input.identity.workflowProtocol !== run?.workflowProtocol
    : input.identity.workflowProtocol === 'world-round-v1' || run?.workflowProtocol === 'world-round-v1') {
    reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交协议与冻结运行身份不一致');
  }
  if (!run || envelope.task?.taskId !== input.identity.taskId || run.runId !== input.identity.runId) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交租约已失效');
  if (input.roundCandidate && (envelope.task?.status !== 'running' || run.chatIdentity !== input.identity.chatIdentity
    || run.baseLedgerRevision !== input.identity.baseLedgerRevision || run.deliveryTarget !== input.identity.deliveryTarget
    || run.workflowMode !== input.identity.workflowMode || run.workflowProtocol !== input.identity.workflowProtocol
    || run.kind === 'logical' || run.anchorMessageKey !== input.anchor.messageKey || run.anchorSwipeId !== input.anchor.swipeId)) {
    reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '新候选提交身份与冻结运行不一致');
  }
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
    if (!isWorldSimulationBucketKey_ACU(key, anchor)) {
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
  const source = resolveWorldSimulationBucketEntry_ACU<WorldSimulationConversationFloorRecord_ACU>(entries, sourceAnchor, WORLD_SIMULATION_CONVERSATION_FIELD_ACU);
  if (source === undefined) return { schemaVersion: 1, entries };
  return {
    schemaVersion: 1,
    entries: buildWorldSimulationBucketEntries_ACU(entries, persistedAnchor, source.value, updatedAt),
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
      ...(input.roundCandidate ? { completedRun: { ...structuredClone(input.identity), anchorContentDigest: persistedAnchor.contentDigest } } : {}),
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
  assertWorldSimulationHostRun_ACU(input.identity);
  requireWorldSimulationHostAnchor_ACU(input.anchor);
  const chat = getChatArray_ACU();
  const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
  if (chatIdentity !== input.identity.chatIdentity || chatIdentity !== input.anchor.chatIdentity) {
    reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交目标聊天已变化');
  }
  const currentAnchor = resolveCurrentWorldSimulationAnchor_ACU(input.anchor, chat);
  let firstMessage = isRecord_ACU(chat[0]) ? chat[0] : null;
  let anchorMessage = isRecord_ACU(chat[currentAnchor.messageIndex]) ? chat[currentAnchor.messageIndex] : null;
  if (!firstMessage || !anchorMessage) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '提交目标楼层不可用');

  const rawEnvelope = firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
  const validatedEnvelope = validateWorldSimulationEnvelope_ACU(rawEnvelope, 'persist');
  assertWorldSimulationHostEnvelope_ACU(validatedEnvelope);
  const foldedBefore = foldWorldSimulationLedger_ACU(chat, currentAnchor.messageIndex);
  const envelope = foldedBefore ? { ...validatedEnvelope, ledger: foldedBefore.ledger } : validatedEnvelope;
  // 首楼仅有 envelope 时也须在写正文/首楼缓存之前冻结完整栏目基底。
  const commitFields = foldedBefore?.fields ?? seedLedgerFieldView_ACU(envelope.ledger, input.completedAt);
  const commitPartials = extractWorldSimulationPartialFields_ACU(commitFields);
  if (!input.roundCandidate && (envelope.task?.activeRun?.deliveryTarget === 'plot'
    || (envelope.task?.activeRun?.deliveryTarget === undefined && envelope.settings.deliveryTarget === 'plot'))) {
    reject_ACU('WORLD_SIMULATION_CONFIG_INVALID', '剧情推进投送尚未接通，禁止通过旧正文提交路径写入');
  }
  if (!input.roundCandidate && envelope.task?.activeRun?.workflowProtocol === 'world-round-v1') {
    reject_ACU('WORLD_SIMULATION_CONFIG_INVALID', '新协议运行不得通过旧正文/SQL 提交路径写入');
  }
  if (!input.roundCandidate && (envelope.task?.activeRun?.workflowMode === 'single'
    || (envelope.task?.activeRun?.workflowMode === undefined && envelope.settings.workflowMode === 'single'))) {
    reject_ACU('WORLD_SIMULATION_CONFIG_INVALID', '单 Agent 新工作流尚未接通，拒绝旧导演提交');
  }
  if (input.bodyProjection && (!input.roundCandidate || input.identity.deliveryTarget !== 'body')) {
    reject_ACU('WORLD_SIMULATION_CONFIG_INVALID', '正文投影授权仅适用于 body 新整轮提交');
  }
  assertRun_ACU(envelope, input);
  const storyText = readWorldSimulationMessageContent_ACU(anchorMessage);
  const archiveBefore = foldWorldSimulationArchive_ACU(chat, currentAnchor.messageIndex).snapshot;
  const runWriteView = { ledger: envelope.ledger, fields: foldedBefore?.fields, archive: archiveBefore };
  input.runWrites?.assertCurrent(runWriteView);
  const runWriteProof = readWorldSimulationRunWriteProof_ACU(currentAnchor, chat);
  if (input.roundCandidate && (runWriteProof?.runId === input.identity.runId
    || hasPartialWorldSimulationRunWrites_ACU(runWriteView)
    || envelope.ledger.revision !== input.identity.baseLedgerRevision)) {
    reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '本轮已有逐栏写入或账本 revision 漂移，新候选不能混合提交');
  }
  input.runWrites?.assertPersistedProof(input.identity, runWriteProof);
  input.runWrites?.assertCandidatesDisjoint(input.commitCandidate.acceptedCandidates);
  if (!input.roundCandidate && !input.commitCandidate.acceptedCandidates.length && !input.runWrites?.hasConfirmedWrites) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '提交缺少已确认写入和候选');
  }
  // SQL 规划会等待；只冻结楼层身份和私有字段，正文及消息对象可由第三方重建。
  const planningFields = [
    { index: 0, keys: [WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] },
    { index: currentAnchor.messageIndex, keys: [WORLD_SIMULATION_STATE_FIELD_ACU,
      WORLD_SIMULATION_MATERIALS_FIELD_ACU, WORLD_SIMULATION_CONVERSATION_FIELD_ACU,
      WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU, WORLD_SIMULATION_RUN_WRITE_FIELD_ACU] },
    ...chat.flatMap((message, index) => isRecord_ACU(message) && index !== currentAnchor.messageIndex
      && [WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU]
        .some(key => Object.prototype.hasOwnProperty.call(message, key))
      ? [{ index, keys: [WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU] }] : []),
  ].map(({ index, keys }) => {
    const message = chat[index] as Record_ACU;
    return { index, identity: hostFloorIdentity_ACU(message), fields: keys.map(key => ({
      key, existed: Object.prototype.hasOwnProperty.call(message, key), content: canonical_ACU(message[key]),
    })) };
  });
  if (input.roundCandidate && (input.commitCandidate.acceptedCandidates.length || input.runWrites)) {
    reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '新旧候选与逐栏预写不能混合提交');
  }
  // 候选投送状态在 materializeWorldRoundCandidate 中须等于基线；既有投送回执可合法延续。
  // 正文许可绑定的是尚未解锁的候选账本；领取后才允许本轮已有的受审 reveal 更新事实。
  const bodyFactIds = input.roundCandidate && input.bodyProjection
    ? claimWorldBodyProjection_ACU(input.bodyProjection.proof,
      materializeWorldRoundPreview_ACU(envelope.ledger, input.roundCandidate), input.identity, input.anchor)
    : null;
  const { ledger, extraTimeline, archiveSnapshot } = input.roundCandidate
    ? { ledger: hasAuthorizedReviewedReveal_ACU(input)
      ? materializeReviewedWorldRoundCandidate_ACU(envelope.ledger, input.roundCandidate, input.reviewedReveal)
      : materializeWorldRoundCandidate_ACU(envelope.ledger, input.roundCandidate),
      extraTimeline: [] as WorldSimulationTimelineEntry_ACU[], archiveSnapshot: archiveBefore }
    : await planWorldSimulationFinalCommit_ACU(envelope, input, storyText, archiveBefore);
  if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== input.identity.chatIdentity
    || !planningFields.every(snapshot => {
      const message = chat[snapshot.index];
      return isRecord_ACU(message) && hostFloorIdentity_ACU(message) === snapshot.identity
        && snapshot.fields.every(field => Object.prototype.hasOwnProperty.call(message, field.key) === field.existed
          && canonical_ACU(message[field.key]) === field.content);
    })) {
    reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '规划期间聊天、楼层身份或私有字段已变化');
  }
  const latestAnchor = resolveCurrentWorldSimulationAnchor_ACU(currentAnchor, chat);
  if (latestAnchor.messageIndex !== currentAnchor.messageIndex) {
    reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '规划期间目标楼层或冻结正文已变化');
  }
  firstMessage = isRecord_ACU(chat[0]) ? chat[0] : null;
  anchorMessage = isRecord_ACU(chat[latestAnchor.messageIndex]) ? chat[latestAnchor.messageIndex] : null;
  if (!firstMessage || !anchorMessage) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '提交目标楼层不可用');
  const oldContent = readWorldSimulationMessageContent_ACU(anchorMessage);
  const bodyProjection = bodyFactIds !== null
    ? buildWorldFactBodyProjection_ACU(ledger, bodyFactIds, envelope.settings.projection.template) : null;
  const newContent = bodyFactIds !== null
    ? applyWorldSimulationProjection_ACU(oldContent, bodyProjection)
    : input.roundCandidate ? oldContent : applyWorldSimulationProjection_ACU(oldContent,
      buildWorldSimulationProjection_ACU(ledger, envelope.settings.projection.template));
  const persistedAnchor: WorldSimulationAnchorIdentity_ACU = { ...latestAnchor, contentDigest: sha256HexSync_ACU(newContent) };
  const nextEnvelope = completedEnvelope_ACU(envelope, input, ledger, extraTimeline, persistedAnchor);
  return await persistHostFinalCommit_ACU(input, chat, currentAnchor, firstMessage, anchorMessage,
    rawEnvelope, foldedBefore, commitFields, commitPartials, runWriteView, runWriteProof, ledger, newContent, bodyProjection,
    persistedAnchor, nextEnvelope, archiveBefore, archiveSnapshot);
}

/** 载体无关的终局领域处理；不读写宿主聊天，不改变正文。 */
export async function planWorldSimulationFinalCommit_ACU(
  envelope: WorldSimulationEnvelope_ACU, input: Omit<CommitInput_ACU, 'anchor'>,
  storyText: string, archiveBefore: WorldChronicleArchiveSnapshot_ACU,
) {
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
    // strict 只决定是否兜底补齐，不再因个别信号缺口拒绝整轮提交（批次一、二的成果会一起作废）。
    if (envelope.settings.dynamics.collisionEnforcement === 'strict' && assertCollisionFulfillment_ACU(collisionReport, ledger.guidance, ledger).length) {
      const repair = repairCollisionSignals_ACU(collisionReport, ledger.guidance, ledger);
      ledger = { ...ledger, guidance: repair.guidance };
      extraTimeline.push({
        id: `${input.timelineId}:collision-repair`, at: input.completedAt, kind: 'swept',
        taskId: input.identity.taskId, stageId: input.identity.stageId, revision: input.identity.stageRevision, runId: input.identity.runId,
        message: JSON.stringify({ collisionFilledSeeds: repair.filledSeedIds, removedLeakingSignals: repair.removedSignals }),
      });
    }
    const violations = assertCollisionFulfillment_ACU(collisionReport, ledger.guidance, ledger);
    if (violations.length) extraTimeline.push({
      id: `${input.timelineId}:collision`, at: input.completedAt, kind: 'failed',
      taskId: input.identity.taskId, stageId: input.identity.stageId, revision: input.identity.stageRevision, runId: input.identity.runId,
      message: violations.join('；'), errorCode: 'WORLD_SIMULATION_SNAPSHOT_INVALID',
    });
  }
  const archiveSnapshot: WorldChronicleArchiveSnapshot_ACU = {
    schemaVersion: archiveBefore.schemaVersion,
    records: { ...archiveBefore.records },
  };
  for (const write of applied.chronicleArchiveWrites) archiveSnapshot.records[write.archiveRef] = write;
  return { ledger, extraTimeline, archiveSnapshot };
}

async function persistHostFinalCommit_ACU(
  input: CommitInput_ACU, chat: any[], currentAnchor: WorldSimulationAnchorIdentity_ACU,
  firstMessage: Record_ACU, anchorMessage: Record_ACU, rawEnvelope: unknown,
  foldedBefore: ReturnType<typeof foldWorldSimulationLedger_ACU>,
  commitFields: ReturnType<typeof seedLedgerFieldView_ACU>,
  commitPartials: ReturnType<typeof extractWorldSimulationPartialFields_ACU>,
  runWriteView: import('./simulation-run-write-state').WorldSimulationRunWriteView_ACU,
  runWriteProof: ReturnType<typeof readWorldSimulationRunWriteProof_ACU>,
  ledger: WorldSimulationEnvelope_ACU['ledger'], newContent: string, bodyProjection: string | null,
  persistedAnchor: WorldSimulationAnchorIdentity_ACU, nextEnvelope: WorldSimulationEnvelope_ACU,
  archiveBefore: WorldChronicleArchiveSnapshot_ACU, archiveSnapshot: WorldChronicleArchiveSnapshot_ACU,
): Promise<WorldSimulationAnchorIdentity_ACU> {
  const envelope = { ...validateWorldSimulationEnvelope_ACU(rawEnvelope, 'persist'), ledger: runWriteView.ledger };
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
  ];
  // 正文不属于推演私有数据；仅保留条件恢复快照，不参与提交冲突判断。
  const bodySnapshots = [
    { target: anchorMessage, key: 'mes', existed: Object.prototype.hasOwnProperty.call(anchorMessage, 'mes'), value: anchorMessage.mes },
    { target: anchorMessage, key: 'message', existed: Object.prototype.hasOwnProperty.call(anchorMessage, 'message'), value: anchorMessage.message },
    { target: anchorMessage, key: 'swipes', existed: Object.prototype.hasOwnProperty.call(anchorMessage, 'swipes'), value: Array.isArray(anchorMessage.swipes) ? [...anchorMessage.swipes] : anchorMessage.swipes },
  ];
  // 基线重建可向旧 checkpoint 新增归档字段；该楼层两项都需保留存在性快照。
  for (const message of chat) {
    if (!isRecord_ACU(message) || message === anchorMessage) continue;
    const keys = [WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU];
    if (!keys.some(key => Object.prototype.hasOwnProperty.call(message, key))) continue;
    for (const key of keys) snapshots.push({ target: message, key,
      existed: Object.prototype.hasOwnProperty.call(message, key), value: message[key] });
  }
  const originalFields = snapshots.map(({ target, key, existed, value }) => ({ target, key, existed, value,
    index: chat.indexOf(target), identity: hostFloorIdentity_ACU(target), content: canonical_ACU(value) }));
  const anchorIdentity = hostFloorIdentity_ACU(anchorMessage);
  const originalsUnchanged = (): boolean => originalFields.every(field => canonical_ACU(field.value) === field.content);
  const writesBody = !input.roundCandidate || input.bodyProjection !== undefined
    && newContent !== readWorldSimulationMessageContent_ACU(anchorMessage);
  // 旧路径保留后处理宽容；新整轮在宿主第一次 save 后按最新楼层内容核对/补写。
  let expectedBodyDigest = persistedAnchor.contentDigest;
  const frozenBodyIntact = (): boolean => !input.roundCandidate || (() => {
    const message = chat[currentAnchor.messageIndex];
    return isRecord_ACU(message) && hostFloorIdentity_ACU(message) === anchorIdentity
      && sha256HexSync_ACU(readWorldSimulationMessageContent_ACU(message)) === expectedBodyDigest;
  })();
  const fieldsIntact = (fields: Array<Omit<(typeof originalFields)[number], 'value'>>): boolean => fields.every(field =>
    isRecord_ACU(chat[field.index]) && hostFloorIdentity_ACU(chat[field.index]) === field.identity
    && Object.prototype.hasOwnProperty.call(chat[field.index], field.key) === field.existed
    && canonical_ACU(chat[field.index][field.key]) === field.content);
  let saveAttempted = false;
  let refreshIndex: number | null = null;
  let stagedFields: Array<Omit<(typeof originalFields)[number], 'value'>> | null = null;
  const currentFieldsIntact = (): boolean => stagedFields !== null && fieldsIntact(stagedFields);
  let stagedBody: Array<{ key: string; existed: boolean; content: string | undefined }> = [];
  const stagedBodyIntact = (): boolean => !input.bodyProjection || !writesBody || (() => {
    const message = chat[currentAnchor.messageIndex];
    return isRecord_ACU(message) && hostFloorIdentity_ACU(message) === anchorIdentity
      && stagedBody.every(field => Object.prototype.hasOwnProperty.call(message, field.key) === field.existed
        && canonical_ACU(message[field.key]) === field.content);
  })();
  try {
    firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = nextEnvelope;
    if (nextConversationBucket) anchorMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = nextConversationBucket;
    if (writesBody) {
      writeWorldSimulationActiveSwipeContent_ACU(anchorMessage, newContent);
      if (input.bodyProjection && Object.prototype.hasOwnProperty.call(anchorMessage, 'message')) anchorMessage.message = newContent;
    }
    stagedBody = writesBody ? bodySnapshots.map(({ key }) => ({ key, existed: Object.prototype.hasOwnProperty.call(anchorMessage, key), content: canonical_ACU(anchorMessage[key]) })) : [];
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
      // 提交前的分栏与草稿必须沿用同一账本基线，不在提交期间重新猜测。
      beforeFields: commitFields,
      beforePartials: commitPartials,
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
      || (input.roundCandidate && !frozenBodyIntact()) || !stagedBodyIntact() || !originalsUnchanged() || !originalFields.every(field =>
        isRecord_ACU(chat[field.index]) && hostFloorIdentity_ACU(chat[field.index]) === field.identity)) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '提交前聊天或旧字段已变化');
    }
    stagedFields = snapshots.map(({ target, key }) => ({ target, key,
      index: chat.indexOf(target), identity: hostFloorIdentity_ACU(target), content: canonical_ACU(target[key]), existed: Object.prototype.hasOwnProperty.call(target, key) }));
    saveAttempted = true;
    await saveChatToHostStrict_ACU();
    if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== input.identity.chatIdentity) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '宿主保存后聊天已变化');
    }
    let savedAnchor = resolveCurrentWorldSimulationAnchor_ACU(persistedAnchor, chat);
    if (!currentFieldsIntact()) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '宿主保存期间提交字段已变化');
    if (input.roundCandidate && savedAnchor.contentDigest !== expectedBodyDigest) {
      const currentMessage = chat[savedAnchor.messageIndex] as Record_ACU;
      const latestText = readWorldSimulationMessageContent_ACU(currentMessage);
      const rebasedText = input.bodyProjection
        ? applyWorldSimulationProjection_ACU(latestText, bodyProjection) : latestText;
      if (input.bodyProjection && rebasedText !== latestText) {
        writeWorldSimulationActiveSwipeContent_ACU(currentMessage, rebasedText);
        if (Object.prototype.hasOwnProperty.call(currentMessage, 'message')) currentMessage.message = rebasedText;
        stagedBody = bodySnapshots.map(({ key }) => ({ key,
          existed: Object.prototype.hasOwnProperty.call(currentMessage, key), content: canonical_ACU(currentMessage[key]) }));
      }
      savedAnchor = resolveCurrentWorldSimulationAnchor_ACU(persistedAnchor, chat);
      persistedAnchor.contentDigest = savedAnchor.contentDigest;
      expectedBodyDigest = savedAnchor.contentDigest;
      if (nextEnvelope.task?.completedRun) nextEnvelope.task.completedRun.anchorContentDigest = savedAnchor.contentDigest;
      if (nextEnvelope.task?.completedAutoAnchor) nextEnvelope.task.completedAutoAnchor.contentDigest = savedAnchor.contentDigest;
      firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = nextEnvelope;
      const conversation = currentMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
      if (isRecord_ACU(conversation) && isRecord_ACU(conversation.entries)) {
        const entry = resolveWorldSimulationBucketEntry_ACU<WorldSimulationConversationFloorRecord_ACU>(
          conversation.entries, persistedAnchor, WORLD_SIMULATION_CONVERSATION_FIELD_ACU);
        if (entry) currentMessage[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = {
          ...conversation, entries: buildWorldSimulationBucketEntries_ACU(conversation.entries, persistedAnchor, entry.value, input.completedAt),
        };
      }
      stagedFields = snapshots.map(({ target, key }) => ({ target, key,
        index: chat.indexOf(target), identity: hostFloorIdentity_ACU(target), content: canonical_ACU(chat[chat.indexOf(target)]?.[key]),
        existed: Object.prototype.hasOwnProperty.call(chat[chat.indexOf(target)], key) }));
      await saveChatToHostStrict_ACU();
      if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== input.identity.chatIdentity) {
        reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '宿主补存后聊天已变化');
      }
      savedAnchor = resolveCurrentWorldSimulationAnchor_ACU(persistedAnchor, chat);
      if (savedAnchor.contentDigest !== persistedAnchor.contentDigest) {
        persistedAnchor.contentDigest = savedAnchor.contentDigest;
        if (nextEnvelope.task?.completedRun) nextEnvelope.task.completedRun.anchorContentDigest = savedAnchor.contentDigest;
        if (nextEnvelope.task?.completedAutoAnchor) nextEnvelope.task.completedAutoAnchor.contentDigest = savedAnchor.contentDigest;
        firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = nextEnvelope;
        const latestConversation = (chat[savedAnchor.messageIndex] as Record_ACU)[WORLD_SIMULATION_CONVERSATION_FIELD_ACU];
        if (isRecord_ACU(latestConversation) && isRecord_ACU(latestConversation.entries)) {
          const entry = resolveWorldSimulationBucketEntry_ACU<WorldSimulationConversationFloorRecord_ACU>(
            latestConversation.entries, persistedAnchor, WORLD_SIMULATION_CONVERSATION_FIELD_ACU);
          if (entry) (chat[savedAnchor.messageIndex] as Record_ACU)[WORLD_SIMULATION_CONVERSATION_FIELD_ACU] = {
            ...latestConversation,
            entries: buildWorldSimulationBucketEntries_ACU(latestConversation.entries, persistedAnchor, entry.value, input.completedAt),
          };
        }
        stagedFields = snapshots.map(({ target, key }) => ({ target, key,
          index: chat.indexOf(target), identity: hostFloorIdentity_ACU(target), content: canonical_ACU(chat[chat.indexOf(target)]?.[key]),
          existed: Object.prototype.hasOwnProperty.call(chat[chat.indexOf(target)], key) }));
      }
    }
    refreshIndex = savedAnchor.messageIndex;
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
    if (error instanceof HostChatSaveNotStartedError_ACU) saveAttempted = false;
    const stillActive = getChatArray_ACU() === chat && getActiveChatStorageIdentity_ACU(chat) === input.identity.chatIdentity;
    // 宿主监听器若原地改写已保存对象，不能把自己的旧快照覆盖其新状态并声称补偿成功。
    if (saveAttempted && (!stillActive || (input.roundCandidate && !frozenBodyIntact())
      || !currentFieldsIntact() || !originalsUnchanged())) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '格林推演保存期间状态已变化，无法安全补偿', {
        message: error instanceof Error ? error.message : String(error), recovery: 'unavailable',
      });
    }
    for (const snapshot of originalFields) restoreField_ACU(chat[snapshot.index], snapshot.key, snapshot.existed, snapshot.value);
    // 保存监听器改过的正文归第三方所有，不用启动快照覆盖它。
    const currentMessage = chat[currentAnchor.messageIndex];
    for (const snapshot of bodySnapshots) {
      if (isRecord_ACU(currentMessage) && stagedBody.some(field => field.key === snapshot.key
        && Object.prototype.hasOwnProperty.call(currentMessage, field.key) === field.existed
        && canonical_ACU(currentMessage[field.key]) === field.content)) {
        restoreField_ACU(currentMessage, snapshot.key, snapshot.existed, snapshot.value);
      }
    }
    if (saveAttempted && stillActive) {
      try {
        await saveChatToHostStrict_ACU();
      } catch (rollbackError) {
        reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '格林推演联合提交与补偿保存均失败', {
          primaryMessage: error instanceof Error ? error.message : String(error),
          rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError), recovery: 'failed',
        });
      }
      if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== input.identity.chatIdentity
        || !fieldsIntact(originalFields)) {
        reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '格林推演补偿保存后状态已变化，无法确认恢复', {
          message: error instanceof Error ? error.message : String(error), recovery: 'unavailable',
        });
      }
    }
    if (error instanceof WorldSimulationValidationError_ACU) throw error;
    reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '格林推演联合提交失败，内存快照已恢复', {
      message: error instanceof Error ? error.message : String(error),
      ...(saveAttempted ? { recovery: 'saved' } : {}),
    });
  }
  // 联合保存已成功：短暂等待宿主更新后，仅重渲染仍匹配的触发楼层一次。
  if (refreshIndex !== null) {
    setTimeout(() => {
      if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== input.identity.chatIdentity) return;
      let currentRefreshIndex: number;
      try {
        currentRefreshIndex = resolveCurrentWorldSimulationAnchor_ACU(persistedAnchor, chat).messageIndex;
      } catch {
        // 延时期间楼层身份或 swipe 已变化，放弃旧锚点的刷新。
        return;
      }
      void refreshMessageBlock_ACU(currentRefreshIndex, { notify: false });
    }, 100);
  }
  return persistedAnchor;
}

export function commitWorldSimulationProjection_ACU(input: CommitInput_ACU): Promise<WorldSimulationAnchorIdentity_ACU> {
  if (hasUntrustedReviewedRevealFields_ACU(input)) {
    return Promise.reject(new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_CONFIG_INVALID', 'persist', '受审事实揭示只能通过显式提交入口领取', false,
    )));
  }
  return enqueueWorldSimulationCommit_ACU(input);
}

function enqueueWorldSimulationCommitOperation_ACU<T>(chatIdentity: string, operation: () => Promise<T>): Promise<T> {
  const previous = tailsByChat_ACU.get(chatIdentity) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then((): void => undefined, (): void => undefined);
  tailsByChat_ACU.set(chatIdentity, settled);
  void settled.finally(() => {
    if (tailsByChat_ACU.get(chatIdentity) === settled) tailsByChat_ACU.delete(chatIdentity);
  });
  return result;
}

function enqueueWorldSimulationCommit_ACU(input: CommitInput_ACU): Promise<WorldSimulationAnchorIdentity_ACU> {
  return enqueueWorldSimulationCommitOperation_ACU(input.identity.chatIdentity, () => commitWithinQueue_ACU(input));
}

/** 新协议只接收已完成的整轮候选；暂不启用正文投送或旧 SQL 写集。 */
export function commitWorldSimulationRound_ACU(input: Omit<CommitInput_ACU, 'roundCandidate' | 'runWrites' | 'reviewedReveal'> & { roundCandidate: WorldRoundCandidate_ACU }): Promise<WorldSimulationAnchorIdentity_ACU> {
  if (hasUntrustedReviewedRevealFields_ACU(input)) {
    return Promise.reject(new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_CONFIG_INVALID', 'persist', '受审事实揭示只能通过显式提交入口领取', false,
    )));
  }
  return enqueueWorldSimulationCommit_ACU({ ...input, roundCandidate: input.roundCandidate });
}

/**
 * 领取阶段签发的一次性受审事实揭示授权，并与整轮候选在同一聊天队列中提交。
 * 任何失败（包括宿主保存结果未知）均不回滚 proof；调用方不得盲重试。
 */
export function commitReviewedWorldSimulationRound_ACU(
  input: Omit<CommitInput_ACU, 'roundCandidate' | 'runWrites' | 'reviewedReveal'> & {
    roundCandidate: WorldRoundCandidate_ACU;
    proof: WorldFactRevealProof_ACU;
    factIds: readonly string[];
  },
): Promise<WorldSimulationAnchorIdentity_ACU> {
  const { proof, factIds, ...commit } = input;
  const authorizedInput: CommitInput_ACU = {
    ...commit,
    roundCandidate: input.roundCandidate,
    reviewedReveal: { proof, factIds, identity: input.identity, targetAnchor: input.anchor },
  };
  reviewedRevealInputs_ACU.add(authorizedInput);
  return enqueueWorldSimulationCommit_ACU(authorizedInput);
}

export type WorldSimulationCommitInput_ACU = CommitInput_ACU;
export type WorldLegacyBackfillPlan_ACU = ReturnType<typeof planWorldLegacyBackfill_ACU>;

// 用户补迁复用正式提交队列，但不创建模型完成或投送回执。
export function applyWorldLegacyBackfillHost_ACU(expectedFingerprint: string, expectedAnchor?: WorldSimulationAnchorIdentity_ACU): Promise<WorldLegacyBackfillPlan_ACU> {
  const chat = getChatArray_ACU();
  const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
  if (!chatIdentity) {
    return Promise.reject(new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_CHAT_UNAVAILABLE', 'persist', '当前聊天不可用，无法补迁旧账本', false,
    )));
  }
  return enqueueWorldSimulationCommitOperation_ACU(chatIdentity, async () => {
    const liveChat = getChatArray_ACU();
    if (liveChat !== chat || getActiveChatStorageIdentity_ACU(liveChat) !== chatIdentity) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '补迁前当前聊天已变化，请重新预览');
    }
    const firstMessage = isRecord_ACU(liveChat[0]) ? liveChat[0] : null;
    if (!firstMessage) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '首楼不存在，无法补迁旧账本');
    const rawEnvelope = firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
    const persistedEnvelope = validateWorldSimulationEnvelope_ACU(rawEnvelope, 'persist');
    assertWorldSimulationHostEnvelope_ACU(persistedEnvelope);
    if (persistedEnvelope.task?.activeRun || persistedEnvelope.task?.status === 'paused') {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '存在未结算或暂停的推演运行，拒绝补迁旧账本');
    }
    const foldedBefore = foldWorldSimulationLedger_ACU(liveChat);
    const beforeLedger = foldedBefore?.ledger ?? persistedEnvelope.ledger;
    const backfillFields = foldedBefore?.fields ?? seedLedgerFieldView_ACU(beforeLedger, persistedEnvelope.updatedAt);
    const backfillPartials = extractWorldSimulationPartialFields_ACU(backfillFields);
    const archiveBefore = foldWorldSimulationArchive_ACU(liveChat).snapshot;
    if (legacyBackfillFingerprint_ACU(beforeLedger, archiveBefore) !== expectedFingerprint) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '旧账本或归档已变化，请重新预览后再补迁');
    }
    let anchor: WorldSimulationAnchorIdentity_ACU | null = null;
    for (let index = liveChat.length - 1; index >= 0; index -= 1) {
      const message = liveChat[index];
      if (!isRecord_ACU(message) || message.is_user === true || message.is_system === true) continue;
      anchor = resolveWorldSimulationAnchor_ACU(index, liveChat);
      break;
    }
    if (!anchor) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '没有 assistant 楼层，无法补迁旧账本');
    if (expectedAnchor && JSON.stringify(anchor) !== JSON.stringify(expectedAnchor)) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '补迁预览的正文楼层已变化，请重新预览');
    }
    const anchorMessage = liveChat[anchor.messageIndex] as Record_ACU;
    const plan = planWorldLegacyBackfill_ACU(beforeLedger, archiveBefore);
    if (!plan.changed) return plan;

    const updatedAt = Date.now();
    const nextEnvelope = validateWorldSimulationEnvelope_ACU({
      ...persistedEnvelope,
      ledger: plan.ledger,
      task: persistedEnvelope.task ? (() => {
        const { completedRun: _completedRun, completedAutoAnchor: _completedAutoAnchor, ...task } = persistedEnvelope.task;
        return { ...task, updatedAt };
      })() : null,
      updatedAt,
    }, 'persist');
    const messageObjects = [...liveChat];
    const messageIdentities = liveChat.map(message => isRecord_ACU(message)
      ? JSON.stringify([message.message_id, message.swipe_id, message.is_user, message.is_system]) : null);
    const snapshots: Array<{ target: Record_ACU; key: string; existed: boolean; value: unknown }> = [];
    const snapshot = (target: Record_ACU, key: string) => snapshots.push({ target, key,
      existed: Object.prototype.hasOwnProperty.call(target, key), value: target[key] });
    snapshot(firstMessage, WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU);
    for (const message of liveChat) {
      if (!isRecord_ACU(message)) continue;
      snapshot(message, WORLD_SIMULATION_STATE_FIELD_ACU);
      snapshot(message, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU);
    }
    const messagesIntact = () => liveChat.length === messageObjects.length && messageIdentities.every((identity, index) => {
      const message = liveChat[index];
      if (message !== messageObjects[index]) return false;
      return identity === null ? !isRecord_ACU(message) : isRecord_ACU(message)
        && JSON.stringify([message.message_id, message.swipe_id, message.is_user, message.is_system]) === identity;
    }) && JSON.stringify(resolveCurrentWorldSimulationAnchor_ACU(anchor!, liveChat)) === JSON.stringify(anchor);
    const originalFieldsIntact = () => snapshots.every(item => Object.prototype.hasOwnProperty.call(item.target, item.key) === item.existed
      && JSON.stringify(item.target[item.key]) === JSON.stringify(item.value));
    let stagedFields: Array<{ target: Record_ACU; key: string; existed: boolean; content: string | undefined }> | null = null;
    const stagedFieldsIntact = () => stagedFields !== null && stagedFields.every(item =>
      Object.prototype.hasOwnProperty.call(item.target, item.key) === item.existed
      && JSON.stringify(item.target[item.key]) === item.content);
    let saveAttempted = false;
    try {
      firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = nextEnvelope;
      appendWorldSimulationCommitChain_ACU({
        chat: liveChat, messageIndex: anchor.messageIndex, anchor,
        beforeLedger, nextLedger: plan.ledger, evidenceRefs: foldedBefore?.evidenceRefs ?? [],
        updatedAt, checkpointIndex: foldedBefore?.checkpointIndex ?? null, beforeArchive: archiveBefore, nextArchive: archiveBefore,
        beforeFields: backfillFields, beforePartials: backfillPartials,
      });
      if (!messagesIntact()) reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '补迁准备期间聊天或锚点已变化');
      stagedFields = snapshots.map(item => ({ target: item.target, key: item.key,
        existed: Object.prototype.hasOwnProperty.call(item.target, item.key), content: JSON.stringify(item.target[item.key]) }));
      saveAttempted = true;
      await saveChatToHostStrict_ACU();
      if (getChatArray_ACU() !== liveChat || getActiveChatStorageIdentity_ACU(liveChat) !== chatIdentity
        || !messagesIntact() || !stagedFieldsIntact()) {
        reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '补迁保存期间聊天、锚点或私有字段已变化，无法确认');
      }
      return plan;
    } catch (error) {
      if (error instanceof HostChatSaveNotStartedError_ACU) saveAttempted = false;
      const stillActive = getChatArray_ACU() === liveChat && getActiveChatStorageIdentity_ACU(liveChat) === chatIdentity;
      if (saveAttempted && (!stillActive || !messagesIntact() || !stagedFieldsIntact())) {
        reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '补迁保存期间状态已变化，无法安全补偿', {
          message: error instanceof Error ? error.message : String(error), recovery: 'unavailable',
        });
      }
      for (const item of snapshots) restoreField_ACU(item.target, item.key, item.existed, item.value);
      if (saveAttempted && stillActive) {
        try {
          await saveChatToHostStrict_ACU();
        } catch (rollbackError) {
          reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '旧账本补迁与补偿保存均失败', {
            primaryMessage: error instanceof Error ? error.message : String(error),
            rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError), recovery: 'failed',
          });
        }
        if (!messagesIntact() || !originalFieldsIntact()) {
          reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '旧账本补迁补偿保存后状态已变化，无法确认恢复', {
            message: error instanceof Error ? error.message : String(error), recovery: 'unavailable',
          });
        }
      }
      if (error instanceof WorldSimulationValidationError_ACU) throw error;
      reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '旧账本补迁保存失败，内存快照已恢复', {
        message: error instanceof Error ? error.message : String(error), ...(saveAttempted ? { recovery: 'saved' } : {}),
      });
    }
  });
}

/** 结构化实体删除共用正式提交聊天队列与失败恢复；不触碰人物私有持久字段。 */
async function deleteWorldSimulationEntityHost_ACU(id: string, kind: 'actor' | 'event' | 'history'): Promise<void> {
  const label = kind === 'actor' ? '人物' : kind === 'event' ? '事件' : '重要历史';
  const chat = getChatArray_ACU();
  const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
  if (!chatIdentity) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', `当前聊天不可用，无法删除${label}`);
  await enqueueWorldSimulationCommitOperation_ACU(chatIdentity, async () => {
    const liveChat = getChatArray_ACU();
    if (liveChat !== chat || getActiveChatStorageIdentity_ACU(liveChat) !== chatIdentity) {
      reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', `删除前聊天已切换`);
    }
    const firstMessage = isRecord_ACU(chat[0]) ? chat[0] : null;
    if (!firstMessage) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '当前聊天首楼不可用');
    const rawEnvelope = firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
    const persisted = validateWorldSimulationEnvelope_ACU(rawEnvelope, 'persist');
    assertWorldSimulationHostEnvelope_ACU(persisted);
    let messageIndex = -1;
    for (let index = chat.length - 1; index >= 0; index -= 1) {
      const message = chat[index];
      if (isRecord_ACU(message) && message.is_user !== true && message.is_system !== true) {
        messageIndex = index;
        break;
      }
    }
    if (messageIndex < 0) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '没有可提交的 assistant 楼层');
    const anchor = resolveWorldSimulationAnchor_ACU(messageIndex, chat);
    const folded = foldWorldSimulationLedger_ACU(chat, messageIndex);
    const beforeLedger = folded?.ledger ?? persisted.ledger;
    const nextLedger = kind === 'actor' ? removeWorldActor_ACU(beforeLedger, id)
      : kind === 'event' ? removeWorldEvent_ACU(beforeLedger, id) : removeWorldHistoryMilestone_ACU(beforeLedger, id);
    if (nextLedger === beforeLedger) return;
    const beforeFields = folded?.fields ?? seedLedgerFieldView_ACU(beforeLedger, persisted.updatedAt);
    const beforePartials = extractWorldSimulationPartialFields_ACU(beforeFields);
    if (kind === 'event') {
      // 旧式纪要草稿的 relatedIds 可同时含人物及事件；只移除目标事件 ID。
      for (const row of Object.values(beforePartials.chronicle ?? {})) {
        const related = row.relatedIds;
        if (related && 'value' in related && Array.isArray(related.value)) {
          related.value = related.value.filter(value => value !== id);
        }
      }
    }
    const beforeArchive = foldWorldSimulationArchive_ACU(chat, messageIndex).snapshot;
    const updatedAt = Date.now();
    const nextTask = persisted.task ? (() => {
      const { completedRun: _completedRun, completedAutoAnchor: _completedAutoAnchor,
        runMaterials: _runMaterials, ...task } = persisted.task;
      return {
        ...task, updatedAt,
        ...(task.status === 'paused' || task.status === 'running' || task.status === 'stopping_after_inflight'
          ? { status: 'abandoned' as const, activeRun: null } : { ...(persisted.task!.runMaterials === undefined ? {} : { runMaterials: persisted.task!.runMaterials }) }),
      };
    })() : null;
    const nextEnvelope = validateWorldSimulationEnvelope_ACU({ ...persisted, ledger: nextLedger,
      task: nextTask, updatedAt }, 'persist');
    const baselineIndex = folded?.checkpointIndex ?? ensureWorldSimulationBaselineFloor_ACU(chat, messageIndex);
    const touched = [
      { index: 0, key: WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU },
      { index: messageIndex, key: WORLD_SIMULATION_STATE_FIELD_ACU },
      { index: messageIndex, key: WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU },
      ...(baselineIndex !== null && baselineIndex !== messageIndex
        ? [{ index: baselineIndex, key: WORLD_SIMULATION_STATE_FIELD_ACU },
          { index: baselineIndex, key: WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU }] : []),
    ].map(({ index, key }) => {
      const target = chat[index] as Record_ACU;
      return { index, key, identity: hostFloorIdentity_ACU(target),
        existed: Object.prototype.hasOwnProperty.call(target, key), value: target[key] };
    });
    const fieldsIntact = (expected: Array<{ index: number; key: string; identity: string; existed: boolean; content: string | undefined }>) =>
      expected.every(item => isRecord_ACU(chat[item.index])
        && hostFloorIdentity_ACU(chat[item.index]) === item.identity
        && Object.prototype.hasOwnProperty.call(chat[item.index], item.key) === item.existed
        && canonical_ACU(chat[item.index][item.key]) === item.content);
    let staged: Array<{ index: number; key: string; identity: string; existed: boolean; content: string | undefined }> = [];
    let attempted = false;
    try {
      firstMessage[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = nextEnvelope;
      appendWorldSimulationCommitChain_ACU({ chat, messageIndex, anchor, beforeLedger, nextLedger,
        evidenceRefs: folded?.evidenceRefs ?? [], updatedAt, checkpointIndex: folded?.checkpointIndex ?? null,
        beforeArchive, nextArchive: beforeArchive, beforeFields,
        beforePartials });
      if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== chatIdentity
        || resolveCurrentWorldSimulationAnchor_ACU(anchor, chat).messageIndex !== messageIndex
        || touched.some(item => !isRecord_ACU(chat[item.index])
          || hostFloorIdentity_ACU(chat[item.index]) !== item.identity)) {
        reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '删除提交前聊天或楼层已变化');
      }
      staged = touched.map(item => ({ index: item.index, key: item.key, identity: item.identity,
        existed: Object.prototype.hasOwnProperty.call(chat[item.index], item.key),
        content: canonical_ACU(chat[item.index][item.key]) }));
      attempted = true;
      await saveChatToHostStrict_ACU();
      if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== chatIdentity
        || resolveCurrentWorldSimulationAnchor_ACU(anchor, chat).messageIndex !== messageIndex
        || !fieldsIntact(staged)) {
        reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', `${label}删除保存期间聊天或推演字段已变化`);
      }
    } catch (error) {
      if (error instanceof HostChatSaveNotStartedError_ACU) attempted = false;
      const stillActive = getChatArray_ACU() === chat && getActiveChatStorageIdentity_ACU(chat) === chatIdentity;
      if (!stillActive || touched.some(item => !isRecord_ACU(chat[item.index])
        || hostFloorIdentity_ACU(chat[item.index]) !== item.identity)
        || (attempted && !fieldsIntact(staged))) {
        reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', `${label}删除期间状态已变化，无法安全恢复`, {
          message: error instanceof Error ? error.message : String(error), recovery: 'unavailable' });
      }
      for (const item of touched) restoreField_ACU(chat[item.index], item.key, item.existed, item.value);
      if (attempted) {
        try {
          await saveChatToHostStrict_ACU();
        } catch (rollbackError) {
          reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', `${label}删除与补偿保存均失败`, {
            primaryMessage: error instanceof Error ? error.message : String(error),
            rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError), recovery: 'failed' });
        }
        if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== chatIdentity
          || !fieldsIntact(touched.map(item => ({ ...item, content: canonical_ACU(item.value) })))) {
          reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', `${label}删除补偿后无法确认恢复`, { recovery: 'unavailable' });
        }
      }
      if (error instanceof WorldSimulationValidationError_ACU) throw error;
      reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', `${label}删除保存失败，已恢复推演字段`, {
        message: error instanceof Error ? error.message : String(error), ...(attempted ? { recovery: 'saved' } : {}) });
    }
  });
}

export const deleteWorldSimulationActorHost_ACU = (actorId: string): Promise<void> =>
  deleteWorldSimulationEntityHost_ACU(actorId, 'actor');
export const deleteWorldSimulationEventHost_ACU = (eventId: string): Promise<void> =>
  deleteWorldSimulationEntityHost_ACU(eventId, 'event');
export const deleteWorldSimulationHistoryHost_ACU = (historyId: string): Promise<void> =>
  deleteWorldSimulationEntityHost_ACU(historyId, 'history');

/** 仅将人工批准的世界书人物追加到当前分支的账本，不投送正文或启动推演。 */
export function appendWorldSimulationActorsHost_ACU(
  actors: readonly WorldActor_ACU[], options: { signal?: AbortSignal; isCurrent?: () => boolean } = {},
): Promise<number> {
  const chat = getChatArray_ACU();
  const chatIdentity = getActiveChatStorageIdentity_ACU(chat);
  if (!chatIdentity) return Promise.reject(new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_SNAPSHOT_INVALID', 'persist', '当前聊天不可用，无法导入人物', false)));
  return enqueueWorldSimulationCommitOperation_ACU(chatIdentity, async () => {
    const assertCurrent = () => {
      if (options.signal?.aborted || options.isCurrent?.() === false || getChatArray_ACU() !== chat
        || getActiveChatStorageIdentity_ACU(chat) !== chatIdentity) {
        reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '导入期间当前聊天或任务已变化');
      }
    };
    assertCurrent();
    const first = isRecord_ACU(chat[0]) ? chat[0] : null;
    if (!first) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '当前聊天首楼不可用');
    const rawEnvelope = first[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU];
    const persisted = rawEnvelope === undefined
      ? buildDefaultWorldSimulationEnvelope_ACU() : validateWorldSimulationEnvelope_ACU(rawEnvelope, 'persist');
    if (rawEnvelope !== undefined) assertWorldSimulationHostEnvelope_ACU(persisted);
    let index = -1;
    for (let i = chat.length - 1; i >= 0; i -= 1) {
      if (isRecord_ACU(chat[i]) && chat[i].is_user !== true && chat[i].is_system !== true) { index = i; break; }
    }
    if (index < 0) reject_ACU('WORLD_SIMULATION_SNAPSHOT_INVALID', '没有可提交的 assistant 楼层');
    const anchor = resolveWorldSimulationAnchor_ACU(index, chat);
    const folded = foldWorldSimulationLedger_ACU(chat, index);
    const beforeLedger = folded?.ledger ?? persisted.ledger;
    const nextLedger = appendWorldActors_ACU(beforeLedger, actors);
    if (nextLedger === beforeLedger) return 0;
    const beforeFields = folded?.fields ?? seedLedgerFieldView_ACU(beforeLedger, persisted.updatedAt);
    const beforeArchive = foldWorldSimulationArchive_ACU(chat, index).snapshot;
    const updatedAt = Date.now();
    const nextTask = persisted.task ? (() => {
      const { completedRun: _completedRun, completedAutoAnchor: _completedAutoAnchor,
        runMaterials: _runMaterials, ...task } = persisted.task!;
      return {
        ...task, updatedAt,
        ...(task.status === 'paused' || task.status === 'running' || task.status === 'stopping_after_inflight'
          ? { status: 'abandoned' as const, activeRun: null }
          : { ...(persisted.task!.runMaterials === undefined ? {} : { runMaterials: persisted.task!.runMaterials }) }),
      };
    })() : null;
    const nextEnvelope = validateWorldSimulationEnvelope_ACU({ ...persisted, ledger: nextLedger,
      task: nextTask, updatedAt }, 'persist');
    const snapshots: Array<{ index: number; key: string; identity: string; existed: boolean; value: unknown }> = [];
    const capture = (floorIndex: number, key: string) => {
      const target = chat[floorIndex] as Record_ACU;
      snapshots.push({ index: floorIndex, key, identity: hostFloorIdentity_ACU(target),
        existed: Object.prototype.hasOwnProperty.call(target, key), value: target[key] });
    };
    capture(0, WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU);
    for (let i = 0; i <= index; i += 1) {
      if (!isRecord_ACU(chat[i])) continue;
      capture(i, WORLD_SIMULATION_STATE_FIELD_ACU);
      capture(i, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU);
    }
    type Field = { index: number; key: string; identity: string; existed: boolean; content: string | undefined };
    const intact = (fields: Field[]) => fields.every(item => isRecord_ACU(chat[item.index])
      && hostFloorIdentity_ACU(chat[item.index]) === item.identity
      && Object.prototype.hasOwnProperty.call(chat[item.index], item.key) === item.existed
      && canonical_ACU(chat[item.index][item.key]) === item.content);
    let staged: Field[] = [];
    let attempted = false;
    try {
      assertCurrent();
      first[WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU] = nextEnvelope;
      appendWorldSimulationCommitChain_ACU({ chat, messageIndex: index, anchor, beforeLedger, nextLedger,
        evidenceRefs: folded?.evidenceRefs ?? [], updatedAt, checkpointIndex: folded?.checkpointIndex ?? null,
        beforeArchive, nextArchive: beforeArchive, beforeFields,
        beforePartials: extractWorldSimulationPartialFields_ACU(beforeFields) });
      assertCurrent();
      if (resolveCurrentWorldSimulationAnchor_ACU(anchor, chat).messageIndex !== index
        || snapshots.some(item => !isRecord_ACU(chat[item.index])
          || hostFloorIdentity_ACU(chat[item.index]) !== item.identity)) {
        reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '导入提交前楼层已变化');
      }
      staged = snapshots.map(item => ({ index: item.index, key: item.key, identity: item.identity,
        existed: Object.prototype.hasOwnProperty.call(chat[item.index], item.key),
        content: canonical_ACU(chat[item.index][item.key]) }));
      attempted = true;
      await saveChatToHostStrict_ACU();
      assertCurrent();
      if (resolveCurrentWorldSimulationAnchor_ACU(anchor, chat).messageIndex !== index || !intact(staged)) {
        reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '人物导入保存期间聊天或推演字段已变化');
      }
      return nextLedger.actors.length - beforeLedger.actors.length;
    } catch (error) {
      if (error instanceof HostChatSaveNotStartedError_ACU) attempted = false;
      const active = getChatArray_ACU() === chat && getActiveChatStorageIdentity_ACU(chat) === chatIdentity;
      if (!active || snapshots.some(item => !isRecord_ACU(chat[item.index])
        || hostFloorIdentity_ACU(chat[item.index]) !== item.identity) || (attempted && !intact(staged))) {
        reject_ACU('WORLD_SIMULATION_REVISION_CONFLICT', '人物导入期间状态已变化，无法安全恢复', {
          message: error instanceof Error ? error.message : String(error), recovery: 'unavailable' });
      }
      for (const item of snapshots) restoreField_ACU(chat[item.index], item.key, item.existed, item.value);
      if (attempted) {
        try {
          await saveChatToHostStrict_ACU();
        } catch (rollbackError) {
          reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '人物导入与补偿保存均失败', {
            primaryMessage: error instanceof Error ? error.message : String(error),
            rollbackMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError), recovery: 'failed' });
        }
        if (getChatArray_ACU() !== chat || getActiveChatStorageIdentity_ACU(chat) !== chatIdentity
          || !intact(snapshots.map(item => ({ ...item, content: canonical_ACU(item.value) })))) {
          reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '人物导入补偿后无法确认恢复', { recovery: 'unavailable' });
        }
      }
      if (error instanceof WorldSimulationValidationError_ACU) throw error;
      reject_ACU('WORLD_SIMULATION_PERSIST_FAILED', '人物导入保存失败，已恢复推演字段', {
        message: error instanceof Error ? error.message : String(error), ...(attempted ? { recovery: 'saved' } : {}) });
    }
  });
}

/** 格林推演逐栏写入和最终投影提交共享队列，防止旧账本覆盖即时写入。 */
export function commitWorldSimulationFieldWrites_ACU(input: WorldSimulationFieldCommitInput_ACU): Promise<WorldSimulationFieldCommitReceipt_ACU> {
  if (input.identity.workflowProtocol === 'world-round-v1') {
    return Promise.reject(new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
      'WORLD_SIMULATION_CONFIG_INVALID', 'persist', '新协议运行不得通过旧逐栏 SQL 提交路径写入', false,
    )));
  }
  const key = input.identity.chatIdentity;
  const previous = tailsByChat_ACU.get(key) ?? Promise.resolve();
  const result = previous.then(() => commitWorldSimulationFieldWritesWithinQueue_ACU(input), () => commitWorldSimulationFieldWritesWithinQueue_ACU(input));
  const settled: Promise<void> = result.then((): void => undefined, (): void => undefined);
  tailsByChat_ACU.set(key, settled);
  void settled.finally(() => { if (tailsByChat_ACU.get(key) === settled) tailsByChat_ACU.delete(key); });
  return result;
}
