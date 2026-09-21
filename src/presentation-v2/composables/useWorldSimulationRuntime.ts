import { computed, getCurrentScope, onScopeDispose, ref } from 'vue';
import { buildDefaultWorldSimulationSettings_ACU } from '../../service/simulation/defaults';
import type { WorldSimulationAgentName_ACU } from '../../service/simulation/agent/agent-catalog';
import type { WorldSimulationAgentPrompts_ACU } from '../../service/simulation/agent/agent-defaults';
import { restoreWorldSimulationPromptDefault_ACU, validateWorldSimulationAgentPrompts_ACU } from '../../service/simulation/agent/prompt-template';
import {
  WORLD_SIMULATION_SESSION_EVENT_KINDS_ACU,
  clearWorldSimulationSessionLog_ACU,
  hydrateWorldSimulationSessionLog_ACU,
  isWorldSimulationSessionRunning_ACU,
  logWorldSimulationSession_ACU,
  readWorldSimulationSessionLog_ACU,
  subscribeWorldSimulationSessionLog_ACU,
  type WorldSimulationSessionInput_ACU,
} from '../../service/simulation/agent/agent-session-log';
import { WORLD_SIMULATION_STOP_REASON_LABELS_ACU, getWorldSimulationRuntime_ACU, type WorldSimulationUiSnapshot_ACU } from '../../service/simulation/simulation-runtime';
import type { WorldSimulationOrchestratorResult_ACU } from '../../service/simulation/simulation-orchestrator';
import { WorldSimulationValidationError_ACU, type WorldSimulationSettings_ACU, type WorldSimulationTaskStatus_ACU } from '../../service/simulation/model';
import { useToastStore } from '../stores/toast-store';

const TASK_STATUS_LABELS_ACU: Record<WorldSimulationTaskStatus_ACU, string> = {
  drafting: '运行中',
  running: '运行中',
  stopping_after_inflight: '正在停止',
  paused: '已暂停',
  completed: '已完成',
  failed: '已失败',
  abandoned: '已中止',
};

function errorMessage_ACU(error: unknown): string {
  if (error instanceof WorldSimulationValidationError_ACU) return error.error.message;
  return error instanceof Error ? error.message : '世界推演操作失败';
}

/** 严格读取失败时给 UI 的结构化文案：保留错误码，用户能据此判断是数据损坏还是聊天不可用。 */
function structuredErrorMessage_ACU(error: unknown): string {
  if (error instanceof WorldSimulationValidationError_ACU) return `${error.error.code}: ${error.error.message}`;
  return errorMessage_ACU(error);
}

/**
 * 把楼层锚定的持久会话消息投影为会话流条目。
 *
 * 会话流是展示通道，持久会话是模型通道，两者字段不同源：这里只做单向投影，
 * 让页面重载后仍能看到既往对话，而不是把持久会话当成 UI 状态直接渲染。
 */
export function projectWorldSimulationSessionFromConversation_ACU(
  messages: WorldSimulationUiSnapshot_ACU['conversation']['messages'],
): WorldSimulationSessionInput_ACU[] {
  return messages
    .filter(message => message.kind !== 'handoff')
    .map(message => {
      const persistedKind = typeof message.eventKind === 'string'
        && (WORLD_SIMULATION_SESSION_EVENT_KINDS_ACU as readonly string[]).includes(message.eventKind)
        ? message.eventKind as WorldSimulationSessionInput_ACU['kind']
        : null;
      const fallbackKind: WorldSimulationSessionInput_ACU['kind'] = message.kind === 'user'
        ? 'user_message'
        : message.kind === 'turn'
          ? 'run_started'
          : message.kind === 'agent'
            ? 'main_action'
            : message.kind === 'runtime'
              ? 'thought'
              : 'tool_read';
      return {
        kind: persistedKind ?? fallbackKind,
        title: message.title || message.digest || (message.kind === 'user' ? '你的消息' : '历史会话'),
        detail: message.text,
        agentName: message.agentName,
        ok: message.ok,
        status: message.status,
        at: message.at,
      } satisfies WorldSimulationSessionInput_ACU;
    });
}

export function useWorldSimulationRuntime() {
  const toast = useToastStore();
  const runtime = getWorldSimulationRuntime_ACU();
  const snapshot = ref<WorldSimulationUiSnapshot_ACU | null>(null);
  const ready = ref(false);
  const busy = ref(false);
  /** 仅表示"快照严格读取失败"；动作失败走吐司，不遮蔽会话区。 */
  const error = ref('');
  // 无信封聊天的展示兜底：用户还没保存过任何设置时，页面显示内置默认值。
  const fallbackSettings = buildDefaultWorldSimulationSettings_ACU();
  let subscribedChatIdentity: string | null = null;
  let unsubscribeSession: (() => void) | null = null;
  let activeAction: Promise<boolean> | null = null;

  /**
   * 从持久会话回灌会话流历史（与 useContinuationSession.hydrate 同语义）：
   * 会话流是内存态，脚本重载后为空；持久会话锚定在楼层上，是权威历史。
   * 只在会话流为空且 Agent 未在运行时回灌，避免覆盖实时通道与运行标记。
   */
  function hydrateSessionFromConversation(next: WorldSimulationUiSnapshot_ACU): void {
    const chatIdentity = next.session.chatIdentity;
    if (!chatIdentity || next.session.entries.length || isWorldSimulationSessionRunning_ACU(chatIdentity)) return;
    const projected = projectWorldSimulationSessionFromConversation_ACU(next.conversation.messages);
    if (projected.length) hydrateWorldSimulationSessionLog_ACU(chatIdentity, projected);
  }

  function refresh(): boolean {
    try {
      const next = runtime.readUiSnapshot();
      snapshot.value = next;
      error.value = '';
      ready.value = true;
      hydrateSessionFromConversation(next);
      if (next.session.chatIdentity !== subscribedChatIdentity) {
        unsubscribeSession?.();
        subscribedChatIdentity = next.session.chatIdentity;
        unsubscribeSession = subscribedChatIdentity
          ? subscribeWorldSimulationSessionLog_ACU(subscribedChatIdentity, () => { if (ready.value) refresh(); })
          : null;
      }
      // 回灌会追加条目，重读一次让 entries 与内存日志一致。
      if (next.session.chatIdentity && !next.session.entries.length) {
        const entries = readWorldSimulationSessionLog_ACU(next.session.chatIdentity);
        if (entries.length) snapshot.value = { ...next, session: { ...next.session, entries } };
      }
      return true;
    } catch (cause) {
      snapshot.value = null;
      error.value = structuredErrorMessage_ACU(cause);
      ready.value = false;
      return false;
    }
  }

  /**
   * 执行一次动作并刷新快照。允许后来的动作顶替在途动作（发送即打断），
   * 只有仍是当前动作的那次结算才把 busy 复位。
   */
  function run_ACU(action: () => Promise<boolean>): Promise<boolean> {
    busy.value = true;
    const completion = Promise.resolve()
      .then(action)
      .catch(cause => {
        toast.error(errorMessage_ACU(cause), { muteable: false });
        return false;
      })
      .finally(() => {
        refresh();
        if (activeAction === completion) {
          busy.value = false;
          activeAction = null;
        }
      });
    activeAction = completion;
    return completion;
  }

  const envelope = computed(() => snapshot.value?.envelope ?? null);
  const task = computed(() => envelope.value?.task ?? null);
  const settings = computed(() => envelope.value?.settings ?? fallbackSettings);
  const activeStage = computed(() => {
    const current = envelope.value;
    return current?.stages.find(stage => stage.stageId === current.activeStageId) ?? null;
  });
  const activeRevision = computed(() => activeStage.value?.revisions.find(item => item.revision === activeStage.value?.activeRevision) ?? null);
  const anchor = computed(() => snapshot.value?.anchor ?? null);
  const entries = computed(() => snapshot.value?.session.entries ?? []);
  const running = computed(() => snapshot.value?.session.running ?? false);

  // 停止原因与最近错误直接并入状态文案，用户不用再翻别处找原因（与智能续写 statusText 同构）。
  const statusText = computed(() => {
    const current = task.value;
    if (!current) return '尚未创建任务';
    const parts: string[] = [TASK_STATUS_LABELS_ACU[current.status] ?? current.status];
    if (current.stopReason && ['paused', 'completed', 'failed', 'abandoned'].includes(current.status)) {
      parts.push(WORLD_SIMULATION_STOP_REASON_LABELS_ACU[current.stopReason] ?? current.stopReason);
    }
    const lastError = envelope.value?.lastError;
    if (lastError && ['paused', 'failed'].includes(current.status)) parts.push(`最近错误：${lastError.message}`);
    return parts.join(' · ');
  });
  const stageText = computed(() => {
    if (!task.value) return '尚未创建任务';
    return activeStage.value ? `第 ${activeStage.value.stageNumber} 阶段` : '计划待创建';
  });
  const revisionText = computed(() => (activeRevision.value ? `revision ${activeRevision.value.revision}` : ''));
  const anchorText = computed(() => {
    const current = anchor.value;
    return current ? `第 ${current.messageIndex + 1} 楼 · swipe ${Number(current.swipeId) + 1}` : '';
  });

  /**
   * 把编排器结果翻译成用户反馈。
   * @returns 用户消息是否已被接收（决定页面是否清空草稿）
   */
  function reportSendOutcome_ACU(result: WorldSimulationOrchestratorResult_ACU | null): boolean {
    if (!result) {
      toast.error('当前聊天没有 assistant 楼层，世界推演无法确定写入锚点。', { muteable: false });
      return false;
    }
    if (result.status === 'skipped') {
      if (result.reason === 'duplicate') toast.info('该楼层已有一次推演在处理这条指令。');
      else if (result.reason === 'busy') toast.error('世界推演正在运行，请先停止再发送。', { muteable: false });
      else if (result.reason === 'disabled') toast.info('自动触发已关闭。');
      else toast.info('推演已排队，将在当前运行结束后开始。');
      return false;
    }
    if (result.status === 'cancelled') {
      toast.info('本次世界推演已停止，发送新指令即可从中断处继续。');
      return true;
    }
    if (result.status === 'failed') {
      toast.error(result.error.message, { muteable: false });
      return false;
    }
    return true;
  }

  /**
   * 在 Agent 会话里以用户身份发言。运行中会先打断当前 run；暂停中的同锚点 run 会带着这句话恢复；
   * 锚点已是新楼层时新建运行。分派逻辑在 runtime.sendAgentMessage，这里只负责反馈。
   */
  function send(text: string): Promise<boolean> {
    if (!text.trim()) return Promise.resolve(false);
    return run_ACU(async () => reportSendOutcome_ACU(await runtime.sendAgentMessage(text)));
  }

  /**
   * 停止在途运行。刻意不经 busy 闸：busy 恰好在运行期间为 true，走闸会把停止吞掉。
   * 先在会话流留痕并清掉 running 标记（按钮立刻切回发送），再等待编排器把任务落为 paused/manual。
   */
  async function stop(): Promise<void> {
    const chatIdentity = snapshot.value?.session.chatIdentity ?? null;
    if (chatIdentity && isWorldSimulationSessionRunning_ACU(chatIdentity)) {
      logWorldSimulationSession_ACU(chatIdentity, { kind: 'run_failed', title: '已停止', detail: '用户停止', ok: false });
    }
    try {
      await runtime.stop();
    } catch (cause) {
      toast.error(errorMessage_ACU(cause), { muteable: false });
    } finally {
      refresh();
    }
  }

  function resume(): Promise<boolean> {
    return run_ACU(async () => reportSendOutcome_ACU(await runtime.resume()));
  }

  /**
   * 保存世界推演设置。
   * 运行中编排器以 retryable 的 REVISION_CONFLICT 拒绝写入——这不是错误而是时机问题，
   * 返回 'busy' 让页面静默排队重试，而不是弹错误吐司把用户的改动丢掉。
   * @returns 'saved' 已落盘；'busy' 暂时写不进（稍后重试）；'failed' 校验或持久化失败（已吐司）
   */
  async function saveSettings(next: WorldSimulationSettings_ACU): Promise<'saved' | 'busy' | 'failed'> {
    if (runtime.isInFlight()) return 'busy';
    try {
      await runtime.saveSettings(JSON.parse(JSON.stringify(next)) as WorldSimulationSettings_ACU);
      refresh();
      return 'saved';
    } catch (cause) {
      if (cause instanceof WorldSimulationValidationError_ACU && cause.error.code === 'WORLD_SIMULATION_REVISION_CONFLICT' && cause.error.retryable) return 'busy';
      toast.error(errorMessage_ACU(cause), { muteable: false });
      refresh();
      return 'failed';
    }
  }

  /**
   * 一键清空：丢弃任务、账本、会话记录与各楼层资料快照，正文与已写入正文的 <与此同时> 段不动。
   * @returns 是否清空成功
   */
  async function clearData(): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    try {
      const outcome = await runtime.clearData();
      refresh();
      toast.success(`已清空世界推演任务、账本、会话记录与 ${outcome.clearedFloors} 个楼层的资料快照，正文未改动。`);
      return true;
    } catch (cause) {
      toast.error(errorMessage_ACU(cause), { muteable: false });
      refresh();
      return false;
    } finally {
      busy.value = false;
    }
  }

  /**
   * 把某个角色的提示词恢复成内置默认值。恢复本身不落盘，由设置面板既有的保存链路决定何时写入。
   */
  function restorePromptDefault(current: WorldSimulationSettings_ACU, agentName: WorldSimulationAgentName_ACU): WorldSimulationSettings_ACU {
    return restoreWorldSimulationPromptDefault_ACU(current, agentName);
  }

  /**
   * 解析并校验导入的提示词 JSON 包。结构：{ agentPrompts: { 各角色: 段数组 } }。
   * 任何一组校验失败（角色缺失、seam 缺失、未知占位符）即整体拒绝，绝不产生半套导入。
   */
  function parsePromptBundle(text: string): WorldSimulationAgentPrompts_ACU {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('导入文件不是合法的 JSON。');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('提示词 JSON 必须是对象（含 agentPrompts）。');
    const agentRaw = (raw as Record<string, unknown>).agentPrompts;
    if (!agentRaw || typeof agentRaw !== 'object' || Array.isArray(agentRaw)) throw new Error('提示词 JSON 缺少 agentPrompts 对象。');
    try {
      return validateWorldSimulationAgentPrompts_ACU(agentRaw, 'load');
    } catch (cause) {
      throw new Error(`提示词校验失败：${errorMessage_ACU(cause)}`);
    }
  }

  /**
   * 当前聊天内楼层被删除 / swipe 后调用。持久会话按楼层分段存储，删楼即回退；
   * 但会话流是内存日志，不重灌就会一直显示已被删掉那几楼上的记录。
   * 运行标记保留——楼层变动时 Agent 循环可能仍在跑，不能把「停止」切回「发送」。
   */
  function resyncAfterChatMutation(): void {
    if (subscribedChatIdentity) clearWorldSimulationSessionLog_ACU(subscribedChatIdentity, { keepRunning: true });
    refresh();
    const chatIdentity = snapshot.value?.session.chatIdentity ?? null;
    if (chatIdentity && readWorldSimulationSessionLog_ACU(chatIdentity).length) {
      logWorldSimulationSession_ACU(chatIdentity, {
        kind: 'thought',
        title: '楼层已变化，会话已按现存楼层重新加载',
        detail: '被删除或重新生成的楼层上的推演记录已随楼层一起回退；账本与锚点也按仍存在的正文楼层重算。',
      });
    }
  }

  if (getCurrentScope()) onScopeDispose(() => unsubscribeSession?.());

  return {
    snapshot,
    ready,
    busy,
    error,
    envelope,
    task,
    settings,
    activeStage,
    activeRevision,
    anchor,
    anchorText,
    entries,
    running,
    statusText,
    stageText,
    revisionText,
    refresh,
    send,
    stop,
    resume,
    saveSettings,
    clearData,
    restorePromptDefault,
    parsePromptBundle,
    resyncAfterChatMutation,
  };
}
