import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { ZERO_LAYER_CARRIER_FIELD_ACU } from './model';
import { AGENT_MODULE_FIELD_ACU, AGENT_CONVERSATION_FIELD_ACU, AGENT_WRITABLE_MODULES_ACU, type AgentModuleFloorDelta_ACU, type ContinuationAgentTurnPlanRequest_ACU } from '../continuation/agent/agent-model';
import { agentModuleFrameDeps_ACU, buildEmptyAgentModuleSnapshot_ACU, readAgentModuleFoldState_ACU } from '../continuation/agent/agent-module-store';
import { planAgentModuleCommitDelta_ACU, planAgentModuleSnapshotWrite_ACU, readMessageSwipeId_ACU, type AgentModuleWritePlan_ACU } from '../continuation/agent/agent-module-frame';
import { readAgentConversation_ACU, readActiveAgentConversationCompactionMark_ACU, fingerprintAgentConversationSource_ACU, validateAgentConversationFloorRecord_ACU } from '../continuation/agent/agent-conversation-store';
import type { AgentModuleCommitStorage_ACU } from '../continuation/agent/agent-module-field-commit';
import { ZeroLayerError_ACU } from './model';
import { ZeroLayerContinuationStore_ACU } from './continuation-store';
import { buildZeroLayerTimeline_ACU } from './timeline';
import { ZeroLayerStore_ACU } from './store';
import { readZeroLayerPublishedMaterials_ACU } from './published-materials';
import { emptyZeroLayerContinuation_ACU } from './continuation-store';
import { projectWorkingContinuation_ACU } from './checkpoint-projection';
import { checkpointFingerprint_ACU, continuationCheckpointPayload_ACU } from './checkpoint-payload';
import type { ZeroLayerContinuationState_ACU } from './model';

type Storage_ACU = NonNullable<ContinuationAgentTurnPlanRequest_ACU['storage']>;

/** 普通聊天不要求 carrier 能力；存在零层字段时严格读取，异常不得回落物理写口。 */
export function getZeroLayerContinuationAgentStorage_ACU(): Storage_ACU | null {
  if (!getChatArray_ACU().some(message => message
    && Object.prototype.hasOwnProperty.call(message, ZERO_LAYER_CARRIER_FIELD_ACU))) return null;
  const store = new ZeroLayerStore_ACU();
  if (!store.readSnapshot()?.enabled) return null;
  const continuation = new ZeroLayerContinuationStore_ACU(store);
  continuation.assertCanContinue();
  return createZeroLayerContinuationAgentStorage_ACU(continuation);
}

/** 页面只读资料不持有工作状态的写权限；在途时从已保存基底折叠。 */
export function readZeroLayerPublishedContinuationFold_ACU(): ReturnType<typeof readAgentModuleFoldState_ACU> | null {
  if (!getChatArray_ACU().some(message => message
    && Object.prototype.hasOwnProperty.call(message, ZERO_LAYER_CARRIER_FIELD_ACU))) return null;
  const store = new ZeroLayerStore_ACU();
  const source = store.readSnapshot();
  if (!source?.enabled) return null;
  const continuation = new ZeroLayerContinuationStore_ACU(store);
  const timeline = buildZeroLayerTimeline_ACU(source, continuation.context.chat as Record<string, unknown>[]);
  const state = readZeroLayerPublishedMaterials_ACU(source).continuation ?? emptyZeroLayerContinuation_ACU();
  const chat = projectWorkingContinuation_ACU(source, timeline, state);
  const folded = readAgentModuleFoldState_ACU(chat);
  if (folded.salvaged || folded.candidates.some(item => !item.valid)) {
    throw new ZeroLayerError_ACU('corrupt-data', '已发布资料帧损坏，禁止以抢救快照展示。');
  }
  return folded;
}

/** 只读正文投影与稳定引用分开；局部序号只供纯折叠/证据算法，永不传给宿主写口。 */
export function createZeroLayerContinuationAgentStorage_ACU(
  store: ZeroLayerContinuationStore_ACU, signal?: AbortSignal | null,
): Storage_ACU {
  const source = store.readSource();
  const timeline = buildZeroLayerTimeline_ACU(source, store.context.chat as Record<string, unknown>[]);
  const anchor = timeline.floors[timeline.floors.length - 1]?.ref;
  const chat = timeline.floors.map(floor => ({ ...floor.data, mes: floor.body,
    is_user: floor.role === 'user', is_system: floor.role === 'system' })) as any[];
  const assertCurrent = () => {
    if (signal?.aborted) throw new ZeroLayerError_ACU('scope-changed', '逻辑续写规划已中止。');
    const live = store.readSource();
    const branch = live.branches.find(item => item.branchId === store.branchId)!;
    if (branch.headTurnId !== timeline.headTurnId) throw new ZeroLayerError_ACU('revision-conflict', '规划期间逻辑历史前沿已变化。');
  };
  const refresh = () => {
    assertCurrent();
    const projection = projectWorkingContinuation_ACU(store.readSource(), timeline, store.readState());
    chat.forEach((message, index) => {
      delete message[AGENT_MODULE_FIELD_ACU];
      message.swipe_id = projection[index].swipe_id;
      if (Object.prototype.hasOwnProperty.call(projection[index], AGENT_MODULE_FIELD_ACU)) {
        message[AGENT_MODULE_FIELD_ACU] = structuredClone(projection[index][AGENT_MODULE_FIELD_ACU]);
      }
    });
  };
  const conversationChat = () => {
    assertCurrent();
    return [{ [AGENT_CONVERSATION_FIELD_ACU]: store.readState().conversation }];
  };

  const stateFingerprint = (state: ZeroLayerContinuationState_ACU) =>
    checkpointFingerprint_ACU([state.moduleFrames, state.workingFrame ?? null]);
  const frameFingerprint = () => stateFingerprint(store.readState());
  const persistPlan = async (plan: AgentModuleWritePlan_ACU, expected: string): Promise<void> => {
    assertCurrent();
    if (!plan.changed) return;
    const scratch = chat.map(message => structuredClone(message));
    const assigned = new Set<number>();
    for (const assignment of plan.assignments) {
      if (!Number.isSafeInteger(assignment.index) || !timeline.floors[assignment.index]
        || assigned.has(assignment.index)
        || checkpointFingerprint_ACU(assignment.previous)
          !== checkpointFingerprint_ACU(chat[assignment.index][AGENT_MODULE_FIELD_ACU])) {
        throw new ZeroLayerError_ACU('revision-conflict', '资料候选不属于已捕获的只读投影。');
      }
      assigned.add(assignment.index);
      if (assignment.value === undefined) delete scratch[assignment.index][AGENT_MODULE_FIELD_ACU];
      else scratch[assignment.index][AGENT_MODULE_FIELD_ACU] = structuredClone(assignment.value);
    }
    const payload = continuationCheckpointPayload_ACU(scratch.map(message => ({
      payload: message[AGENT_MODULE_FIELD_ACU], swipeId: readMessageSwipeId_ACU(message),
    })));
    await store.updateState((state, live) => {
      assertCurrent();
      if (!anchor || live.activeBranchId !== store.branchId || stateFingerprint(state) !== expected) {
        throw new ZeroLayerError_ACU('revision-conflict', '规划期间续写资料帧已变化。');
      }
      // assignments 仅供纯折叠；来源 FloorRef 不授予历史帧或共享前缀写权限。
      state.workingFrame = { branchId: store.branchId, anchor: structuredClone(anchor), payload };
    });
    refresh();
  };
  const baselines = new WeakMap<object, string>();
  const moduleCommitStorage: AgentModuleCommitStorage_ACU = {
    isActive: candidate => { assertCurrent(); return candidate === chat; },
    readFold: candidate => {
      if (candidate !== chat) throw new ZeroLayerError_ACU('scope-changed', '资料读取不属于本请求。');
      refresh();
      const folded = readAgentModuleFoldState_ACU(chat);
      if (folded.salvaged || folded.candidates.some(item => !item.valid)) {
        throw new ZeroLayerError_ACU('corrupt-data', '逻辑资料帧损坏，禁止使用抢救快照。');
      }
      return folded;
    },
    captureBaseline: candidate => {
      if (candidate !== chat) throw new ZeroLayerError_ACU('scope-changed', '资料基线不属于本请求。');
      refresh();
      const baseline = { identity: store.getChatIdentity(), floors: chat.map(message => ({ message,
        swipeId: readMessageSwipeId_ACU(message), existed: Object.prototype.hasOwnProperty.call(message, AGENT_MODULE_FIELD_ACU),
        content: JSON.stringify(message[AGENT_MODULE_FIELD_ACU]) })) };
      baselines.set(baseline, frameFingerprint());
      return baseline;
    },
    writeDelta: async (candidate, targetIndex, delta, at, verify, baseline, isCurrent) => {
      assertCurrent();
      const expected = baselines.get(baseline);
      if (candidate !== chat || targetIndex !== chat.length - 1 || !expected
        || expected !== frameFingerprint() || isCurrent?.() === false) {
        throw new ZeroLayerError_ACU('revision-conflict', '逻辑资料基线或派工租约已变化。');
      }
      refresh();
      const plan = planAgentModuleCommitDelta_ACU(chat, targetIndex, delta, agentModuleFrameDeps_ACU(), null, at);
      const scratch = chat.map(message => ({ ...message }));
      for (const item of plan.assignments) scratch[item.index][AGENT_MODULE_FIELD_ACU] = item.value;
      if (!plan.changed || !verify(readAgentModuleFoldState_ACU(scratch))) {
        throw new ZeroLayerError_ACU('corrupt-data', '逻辑资料候选未通过折叠验证。');
      }
      await persistPlan(plan, expected);
      if (!verify(moduleCommitStorage.readFold(chat))) throw new ZeroLayerError_ACU('corrupt-data', '逻辑资料保存回读不一致。');
      return { status: 'committed' };
    },
  };

  const readConversation = () => readAgentConversation_ACU(conversationChat());
  const readCompactionMark = () => readActiveAgentConversationCompactionMark_ACU(conversationChat());
  return {
    storageLabel: '零层 carrier 续写状态',
    readChat: () => { refresh(); return chat; },
    readModuleSnapshot: candidate => moduleCommitStorage.readFold(candidate).snapshot,
    writeModuleSnapshot: async (candidate, targetIndex, snapshot) => {
      if (candidate !== chat || targetIndex !== chat.length - 1) {
        throw new ZeroLayerError_ACU('scope-changed', '资料快照目标不属于本请求。');
      }
      refresh();
      const expected = frameFingerprint();
      const plan = planAgentModuleSnapshotWrite_ACU(chat, targetIndex, snapshot, agentModuleFrameDeps_ACU(), null);
      await persistPlan(plan, expected);
      moduleCommitStorage.readFold(chat);
    },
    moduleCommitStorage,
    readConversation,
    readCompactionMark,
    appendConversationMessages: async (candidate, prepared) => {
      if (candidate !== chat) throw new ZeroLayerError_ACU('scope-changed', '会话追加不属于本请求。');
      if (!prepared.length) return false;
      await store.updateState(state => {
        assertCurrent();
        const existing = new Map(state.conversation.segment.map(message => [message.id, message]));
        for (const message of prepared) {
          if (existing.has(message.id) && JSON.stringify(existing.get(message.id)) !== JSON.stringify(message)) {
            throw new ZeroLayerError_ACU('revision-conflict', '会话消息 ID 与已保存内容冲突。');
          }
        }
        const fresh = prepared.filter(message => !existing.has(message.id));
        const nextId = readAgentConversation_ACU([{ [AGENT_CONVERSATION_FIELD_ACU]: state.conversation }]).nextId;
        if (fresh.some((message, index) => message.id !== nextId + index)) {
          throw new ZeroLayerError_ACU('revision-conflict', '会话追加序号不连续。');
        }
        state.conversation.segment.push(...structuredClone(fresh));
        state.conversation.updatedAt = Date.now();
        if (!validateAgentConversationFloorRecord_ACU(state.conversation)) {
          throw new ZeroLayerError_ACU('corrupt-data', '待保存会话记录无效。');
        }
      });
      return true;
    },
    captureCompactionCommit: candidate => {
      if (candidate !== chat) throw new ZeroLayerError_ACU('scope-changed', '压缩不属于本请求。');
      const expected = fingerprintAgentConversationSource_ACU(readConversation(), readCompactionMark());
      return async mark => {
        await store.updateState(state => {
          assertCurrent();
          const messages = [{ [AGENT_CONVERSATION_FIELD_ACU]: state.conversation }];
          const fingerprint = fingerprintAgentConversationSource_ACU(readAgentConversation_ACU(messages), readActiveAgentConversationCompactionMark_ACU(messages));
          if (fingerprint !== expected) throw new ZeroLayerError_ACU('revision-conflict', '压缩源会话已变化。');
          state.conversation.compaction = structuredClone(mark);
          state.conversation.updatedAt = Date.now();
          validateAgentConversationFloorRecord_ACU(state.conversation);
        });
        return JSON.stringify(readCompactionMark()) === JSON.stringify(mark);
      };
    },
  };
}

/** 清空是确认后的删除操作；不删除基线、回放档案或历史正文。 */
export async function clearZeroLayerContinuationModules_ACU(store: ZeroLayerContinuationStore_ACU): Promise<boolean> {
  store.assertCanContinue();
  const adapter = createZeroLayerContinuationAgentStorage_ACU(store);
  const chat = adapter.readChat();
  const port = adapter.moduleCommitStorage!;
  const before = port.readFold(chat);
  const modules = AGENT_WRITABLE_MODULES_ACU;
  const hasRows = modules.some(module => before.snapshot[module].length > 0);
  const hasDrafts = modules.some(module => Object.values(before.fields.records[module] ?? {})
    .some(row => row.status === 'partial' && Object.keys(row.fields).length > 0));
  if (!hasRows && !hasDrafts && before.snapshot.pendingFixes.length === 0) return false;
  const baseline = port.captureBaseline(chat);
  const removedIds: NonNullable<AgentModuleFloorDelta_ACU['removedIds']> = {};
  const fieldUpserts: NonNullable<AgentModuleFloorDelta_ACU['fieldUpserts']> = {};
  const revisions: AgentModuleFloorDelta_ACU['revisions'] = {};
  for (const module of modules) {
    revisions[module] = before.snapshot.revisions[module] + 1;
    if (module !== 'userRequirements') removedIds[module] = before.snapshot[module].map(row => row.id);
    const rows = before.fields.records[module];
    if (rows) fieldUpserts[module] = Object.fromEntries(Object.entries(rows).map(([id, row]) =>
      [id, Object.fromEntries(Object.keys(row.fields).map(field => [field, { unset: true }]))]));
  }
  const empty = buildEmptyAgentModuleSnapshot_ACU();
  const result = await port.writeDelta(chat, chat.length - 1, {
    writes: { userRequirements: [] }, removedIds, fieldUpserts, revisions, pendingFixes: [],
    materialCompletion: empty.materialCompletion,
  }, Date.now(), folded => modules.every(module => folded.snapshot[module].length === 0)
    && folded.snapshot.pendingFixes.length === 0
    && modules.every(module => Object.values(folded.fields.records[module] ?? {})
      .every(row => row.status !== 'partial'))
    && checkpointFingerprint_ACU(folded.snapshot.revisions) === checkpointFingerprint_ACU(revisions),
  baseline, () => { store.assertCanContinue(); return true; });
  if (result.status !== 'committed') throw new ZeroLayerError_ACU('effects-pending', '资料删除尚未取得保存确认。');
  return true;
}