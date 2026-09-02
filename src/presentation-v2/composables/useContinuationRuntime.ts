import { computed, getCurrentScope, onScopeDispose, ref } from 'vue';
import { isAgentSessionRunning_ACU, logAgentSession_ACU } from '../../service/continuation/agent/agent-session-log';
import { buildInitialContinuationSettings_ACU, getContinuationRuntime_ACU } from '../../service/continuation/continuation-runtime';
import { CONTINUATION_AGENT_PROMPT_KEYS_ACU, CONTINUATION_RECOVERABLE_STOP_REASONS_ACU, ContinuationValidationError_ACU, type ContinuationEnvelope_ACU, type ContinuationPromptSegment_ACU, type ContinuationSettings_ACU, type ContinuationTask_ACU, type StageOutline_ACU } from '../../service/continuation/model';
import type { ContinuationOrchestratorResult_ACU } from '../../service/continuation/continuation-orchestrator';
import type { ContinuationPreparedTurnInstruction_ACU } from '../../service/continuation/stage-execution-engine';
import { restoreContinuationPromptDefault_ACU, validateContinuationPromptSegments_ACU, type ContinuationPromptKind_ACU } from '../../service/continuation/prompt-template';
import { CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_ACU } from '../../service/continuation/defaults';
import { useToastStore } from '../stores/toast-store';

/** 连续高压轮上限的可配置上界。页面是 .vue，不能直接 import 服务层常量，由本组合式函数中转。 */
export const CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_UI_ACU = CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_ACU;

/** 停止原因的中文文案，随状态文案一起展示（时间线 tab 已移除，这里是唯一出口）。 */
const CONTINUATION_STOP_REASON_LABELS_ACU: Record<string, string> = {
  manual: '用户手动停止',
  duration_reached: '总时长已用完',
  stage_limit_reached: '自动阶段数已达上限',
  outline_validation_failed: '大纲校验失败',
  internal_ai_retry_exhausted: '内部 AI 重试次数用尽',
  generation_retry_exhausted: '正文生成重试次数用尽',
  host_input_unavailable: '酒馆输入框不可用',
  api_preset_missing: 'API 预设缺失',
  state_invalid: '正文归属失败或状态异常',
  chat_changed: '聊天已切换',
  completed: '任务完成',
};

/** 提示词导入导出的文件结构：大纲组 + 六组 Agent 提示词，一次打包全部。 */
export interface ContinuationPromptBundle_ACU {
  outlinePrompt: ContinuationPromptSegment_ACU[];
  agentPrompts: ContinuationSettings_ACU['agentPrompts'];
}

type ContinuationActionResult_ACU = ContinuationOrchestratorResult_ACU & { preparedTurn?: ContinuationPreparedTurnInstruction_ACU; retryHostGeneration?: boolean };
type ContinuationRuntimeActionResult_ACU = ContinuationActionResult_ACU | ContinuationEnvelope_ACU;

function errorMessage_ACU(error: unknown): string {
  if (error instanceof ContinuationValidationError_ACU) return error.error.message;
  return error instanceof Error ? error.message : '智能续写操作失败';
}

export function useContinuationRuntime() {
  const toast = useToastStore();
  const runtime = getContinuationRuntime_ACU();
  const envelope = ref<ContinuationEnvelope_ACU | null>(null);
  // 无信封聊天的展示兜底：全局设置副本优先，用户在新聊天里看到的就是自己保存过的偏好。
  const fallbackSettings = buildInitialContinuationSettings_ACU();
  const busy = ref(false);
  const originInstruction = ref('');
  let initialization: Promise<void> | null = null;
  let activeAction: Promise<boolean> | null = null;
  // 用户点停止后递增：挡住「发送已落盘、continueTask 尚未启动」这一空档把停止吞掉再开跑。
  let stopEpoch = 0;

  // 正文确认与自动续写由宿主事件异步触发，不会经过页面动作。订阅桥的状态提交通知，
  // 使「等待宿主正文」在 confirmCurrentTurn 后立即从权威快照刷新。
  const subscribeStateChanges = (runtime.bridge as { subscribeStateChanges?: (listener: () => void) => () => void }).subscribeStateChanges;
  const unsubscribeStateChanges = typeof subscribeStateChanges === 'function'
    ? subscribeStateChanges.call(runtime.bridge, () => refresh())
    : null;
  if (unsubscribeStateChanges && getCurrentScope()) {
    onScopeDispose(unsubscribeStateChanges);
  }

  function refresh(): void {
    try {
      envelope.value = runtime.read();
    } catch (error) {
      envelope.value = null;
      toast.error(errorMessage_ACU(error), { muteable: false });
    }
  }

  async function initialize(): Promise<void> {
    if (initialization) return initialization;
    busy.value = true;
    const currentInitialization = runtime.initialize()
      .then(() => refresh())
      .catch(error => {
        toast.error(errorMessage_ACU(error), { muteable: false });
        refresh();
      })
      .finally(() => {
        busy.value = false;
        if (initialization === currentInitialization) initialization = null;
      });
    initialization = currentInitialization;
    return initialization;
  }

  /**
   * 执行一次续写动作并把结果同步到信封。
   * @param action 编排器动作
   * @param replaceActive 为 true 时允许顶替正在执行的动作（用户插话打断）
   * @param suppressErrorToast 为 true 时失败不弹吐司，由调用方决定如何呈现
   * @param onError 失败回调，把原始异常交给调用方（用于拼出更具体的提示）
   */
  function run_ACU(action: () => Promise<ContinuationRuntimeActionResult_ACU>, replaceActive = false, suppressErrorToast = false, onError?: (error: unknown) => void): Promise<boolean> {
    if (busy.value && !replaceActive) return Promise.resolve(false);
    busy.value = true;
    const completion = Promise.resolve()
      .then(action)
      .then(async result => {
      if ('retryHostGeneration' in result && result.retryHostGeneration) {
        // 上一轮正文中断/失败后的恢复走酒馆自己的重发，不经过 Agent。此分支只由用户
        // 动作到达（自动重试链走桥内部，不经 run_ACU），必须留痕并解释消息去向——
        // 否则用户看到的是「在 Agent 输入框发消息却直接触发了主对话生成」。
        logAgentSession_ACU({ kind: 'protocol_retry', title: '重发上一轮正文', detail: '上一轮酒馆正文未正常完成，先让酒馆直接重新生成；本次发送的消息会在正文完成后的下一轮由主 Agent 读取。' });
        toast.info('上一轮正文未完成，已让酒馆直接重新生成；你的消息会在下一轮被主 Agent 读取。');
        const sent = await runtime.bridge.retryHostGeneration();
        if (!sent) toast.error('宿主重新生成不可用，智能续写已暂停。', { muteable: false });
      } else if ('preparedTurn' in result && result.preparedTurn) {
        const sent = await runtime.bridge.send(result.preparedTurn);
        if (!sent) toast.error('宿主输入不可用，智能续写已暂停。', { muteable: false });
      }
      envelope.value = 'envelope' in result ? result.envelope : result;
      refresh();
      return true;
      })
      .catch(error => {
      onError?.(error);
      if (suppressErrorToast) {
        refresh();
        return false;
      }
      // STALE 意味着本次操作被更新的意图作废（用户点停止、插话打断、切换聊天）——
      // 这是预期内的中断而不是故障，弹中性提示；其余错误仍按故障弹红。
      if (error instanceof ContinuationValidationError_ACU && error.error.code === 'CONTINUATION_INTERNAL_REQUEST_STALE') {
        toast.info(error.error.message);
      } else {
        toast.error(errorMessage_ACU(error), { muteable: false });
      }
      refresh();
      return false;
      })
      .finally(() => {
        if (activeAction === completion) {
          busy.value = false;
          activeAction = null;
        }
      });
    activeAction = completion;
    return completion;
  }

  const task = computed(() => envelope.value?.activeTask ?? null);
  const settings = computed(() => envelope.value?.settings ?? fallbackSettings);
  const activeStage = computed(() => task.value?.activeStageId
    ? task.value.stages.find(stage => stage.stageId === task.value?.activeStageId) ?? null
    : null);
  const activeRevision = computed(() => activeStage.value
    ? activeStage.value.revisions.find(revision => revision.revision === activeStage.value?.activeRevision) ?? null
    : null);
  const activeNode = computed(() => activeRevision.value?.outline.nodes[activeStage.value?.activeNodeIndex ?? -1] ?? null);
  const activeTurn = computed(() => activeNode.value?.turns[activeStage.value?.activeTurnIndex ?? -1] ?? null);
  // 无阶段（大纲待创建）与已完成阶段（下一阶段待继续）也可继续：由主 Agent 派工大纲子代理处理。
  // 可恢复的停止（手停、正文归属失败、输入不可用、重试耗尽）允许从当前进度恢复；
  // 终局停止（时长/阶段上限、completed）不可恢复。集合与 continueTask 的闸共用同一常量。
  const canContinue = computed(() => !!task.value
    && task.value.status === 'paused'
    && (task.value.stopReason === null || CONTINUATION_RECOVERABLE_STOP_REASONS_ACU.includes(task.value.stopReason))
    && (!activeStage.value || ['running', 'completed'].includes(activeStage.value.status)));
  const isAwaitingHostResult = computed(() => task.value?.status === 'running' && task.value.pendingHostTurn?.status === 'awaiting_generation');
  // 事件时间线 tab 已移除，暂停/失败原因与最近错误直接并入状态文案，用户不用再翻别处找原因。
  const statusText = computed(() => {
    const current = task.value;
    if (!current) return '尚未创建任务';
    if (isAwaitingHostResult.value) return '等待宿主正文';
    const parts: string[] = [current.status];
    if (current.stopReason && ['paused', 'completed', 'failed', 'abandoned'].includes(current.status)) {
      parts.push(CONTINUATION_STOP_REASON_LABELS_ACU[current.stopReason] ?? current.stopReason);
    }
    if (current.lastError && ['paused', 'failed'].includes(current.status)) {
      parts.push(`最近错误：${current.lastError.message}`);
    }
    return parts.join(' · ');
  });

  async function createTask(): Promise<void> {
    const created = await run_ACU(() => runtime.orchestrator.createTask({ originInstruction: originInstruction.value }));
    if (task.value) originInstruction.value = '';
    // 创建即时完成后直接开始第一轮：主 Agent 会先派工大纲子代理创建大纲，不需要用户再点一次继续。
    if (created && canContinue.value) await continueTask();
  }

  /**
   * 在 Agent 会话里以用户身份发言。没有任务时等价于创建任务，运行中会先打断当前循环。
   * @param text 用户输入
   * @returns 是否成功发出
   */
  async function sendAgentMessage(text: string): Promise<boolean> {
    if (!text.trim()) return false;
    const actionBeforeMessage = activeAction;
    const epochAtStart = stopEpoch;
    try {
      const result = await runtime.orchestrator.sendAgentMessage({ text });
      envelope.value = result.envelope;
      refresh();
      if (result.disposition === 'queued_after_host') {
        toast.info('消息已排队，会在当前正文完成后生效。');
        return true;
      }
      if (result.disposition === 'accepted_without_resume') {
        toast.info(result.detail ?? '消息已接收，当前状态暂不能恢复。');
        return true;
      }
      if (result.disposition !== 'continue_now') {
        toast.error('消息已保存，但返回了无法执行的后续动作。', { muteable: false });
        return false;
      }
      if (stopEpoch !== epochAtStart) return true;
      let startFailure = '';
      const started = await run_ACU(() => runtime.orchestrator.continueTask(), actionBeforeMessage !== null, true, error => { startFailure = errorMessage_ACU(error); });
      if (!started) {
        // 启动失败的原因已由编排器落成 lastError（或就是被拒的异常本身）；只说「失败」用户没法判断下一步。
        const reason = startFailure || task.value?.lastError?.message || (busy.value ? '另一项续写操作正在执行' : '');
        toast.error(reason ? `消息已保存，但启动续写失败：${reason}` : '消息已保存，但启动续写失败。', { muteable: false });
      }
      return true;
    } catch (error) {
      toast.error(errorMessage_ACU(error), { muteable: false });
      refresh();
      return false;
    }
  }

  function continueTask(): Promise<boolean> {
    return run_ACU(() => runtime.orchestrator.continueTask());
  }

  /**
   * 停止 Agent 循环与酒馆正文。刻意不经 run_ACU：busy 恰好在循环运行期间为 true，
   * 走 busy 闸会把停止请求静默吞掉——而那正是用户最需要停止的时刻。
   * 先递增 stopEpoch、落盘手动停止（清掉 awaiting pending），再打断酒馆生成：
   * GENERATION_STOPPED 随后的 failHostTurn 会因状态已不是 running 而 STALE 忽略，
   * 避免把手动停止改写成 retry_ready。会话 running 标记也立刻清掉，按钮才能切回发送。
   */
  async function stopTask(): Promise<void> {
    stopEpoch += 1;
    if (isAgentSessionRunning_ACU()) {
      logAgentSession_ACU({ kind: 'run_failed', title: '已停止', detail: '用户停止', ok: false });
    }
    try {
      const result = await runtime.orchestrator.stopTask();
      envelope.value = result.envelope;
    } catch (error) {
      toast.error(errorMessage_ACU(error), { muteable: false });
    } finally {
      try {
        runtime.bridge.stopHostGeneration();
      } catch {
        // 宿主 API 不可用时仍保留已落盘的停止态，避免按钮停了任务没停。
      }
      refresh();
    }
  }

  async function replanRemaining(): Promise<void> {
    await run_ACU(() => runtime.orchestrator.replanRemaining());
  }

  async function replanRemainingWithInstruction(instruction: string): Promise<boolean> {
    return run_ACU(() => runtime.orchestrator.replanRemaining({ instruction }));
  }

  async function retryCurrentTurn(): Promise<void> {
    await run_ACU(() => runtime.orchestrator.retryCurrentTurn());
  }

  async function acceptOutline(outline: StageOutline_ACU): Promise<boolean> {
    return run_ACU(() => runtime.orchestrator.acceptOutline({ outline }));
  }

  async function abandonAndCreate(newOriginInstruction: string): Promise<boolean> {
    const succeeded = await run_ACU(() => runtime.orchestrator.abandonAndCreate({ originInstruction: newOriginInstruction, confirmAbandon: true }));
    if (succeeded) originInstruction.value = '';
    return succeeded;
  }

  /**
   * 保存续写设置。
   *
   * Agent 正在规划时编排器以 CONTINUATION_OPERATION_BUSY 拒绝写入——这不是错误而是时机问题，
   * 返回 'busy' 让页面静默排队重试，而不是弹错误吐司把用户的改动丢掉。
   * @param settings 规范化后的完整设置
   * @returns 'saved' 已落盘；'busy' 暂时写不进（稍后重试）；'failed' 校验或持久化失败（已吐司）
   */
  async function saveSettings(settings: ContinuationSettings_ACU): Promise<'saved' | 'busy' | 'failed'> {
    if (busy.value) return 'busy';
    busy.value = true;
    try {
      envelope.value = await runtime.orchestrator.replaceSettings({ settings });
      refresh();
      return 'saved';
    } catch (error) {
      if (error instanceof ContinuationValidationError_ACU && error.error.code === 'CONTINUATION_OPERATION_BUSY') return 'busy';
      toast.error(errorMessage_ACU(error), { muteable: false });
      refresh();
      return 'failed';
    } finally {
      busy.value = false;
    }
  }

  /**
   * 保存用户手动编辑的当前阶段大纲。
   * @param outline 编辑后的完整大纲
   * @returns 是否保存成功
   */
  /**
   * 把某一类提示词恢复成内置默认值。
   *
   * 默认值属于领域知识，页面只负责把结果放回草稿：恢复动作本身不落盘，
   * 由设置面板既有的保存链路决定何时写入，避免绕过设置校验。
   * @param settings 当前设置草稿
   * @param kind 提示词种类
   * @returns 恢复默认值后的设置草稿
   */
  function restorePromptDefault(settings: ContinuationSettings_ACU, kind: ContinuationPromptKind_ACU): ContinuationSettings_ACU {
    return restoreContinuationPromptDefault_ACU(settings, kind);
  }

  /**
   * 解析并校验导入的提示词 JSON 包。
   * 结构：{ outlinePrompt: 段数组, agentPrompts: { main/maintainer/mainlinePlanner/beatPlanner/reviewer: 段数组 } }。
   * 任何一组校验失败即整体拒绝，绝不产生半套导入。
   * @param text 导入文件的原始文本
   * @returns 校验通过的完整提示词包
   */
  function parsePromptBundle(text: string): ContinuationPromptBundle_ACU {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('导入文件不是合法的 JSON。');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('提示词 JSON 必须是对象（含 outlinePrompt 与 agentPrompts）。');
    const record = raw as Record<string, unknown>;
    const agentRaw = record.agentPrompts;
    if (!agentRaw || typeof agentRaw !== 'object' || Array.isArray(agentRaw)) throw new Error('提示词 JSON 缺少 agentPrompts 对象。');
    try {
      const outlinePrompt = validateContinuationPromptSegments_ACU(record.outlinePrompt, 'load');
      const agentRecord = agentRaw as Record<string, unknown>;
      const agentPrompts = {} as ContinuationSettings_ACU['agentPrompts'];
      for (const key of CONTINUATION_AGENT_PROMPT_KEYS_ACU) {
        agentPrompts[key] = validateContinuationPromptSegments_ACU(agentRecord[key], 'load');
      }
      return { outlinePrompt, agentPrompts };
    } catch (error) {
      throw new Error(`提示词校验失败：${errorMessage_ACU(error)}`);
    }
  }

  async function saveActiveOutline(outline: StageOutline_ACU): Promise<boolean> {
    return run_ACU(() => runtime.orchestrator.replaceActiveOutline({ outline }));
  }

  /**
   * 一键清空：丢弃任务、Agent 会话记录与本地资料快照，正文楼层不动。
   * @returns 是否清空成功
   */
  async function clearData(): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    try {
      const result = await runtime.orchestrator.clearContinuationData();
      envelope.value = result.envelope;
      refresh();
      toast.success('已清空续写任务、会话记录与本地资料，正文未改动。');
      return true;
    } catch (error) {
      toast.error(errorMessage_ACU(error), { muteable: false });
      refresh();
      return false;
    } finally {
      busy.value = false;
    }
  }

  return {
    clearData,
    parsePromptBundle,
    restorePromptDefault,
    saveActiveOutline,
    sendAgentMessage,
    activeStage,
    activeNode,
    activeRevision,
    activeTurn,
    abandonAndCreate,
    acceptOutline,
    busy,
    canContinue,
    createTask,
    continueTask,
    initialize,
    isAwaitingHostResult,
    originInstruction,
    refresh,
    replanRemaining,
    replanRemainingWithInstruction,
    retryCurrentTurn,
    saveSettings,
    statusText,
    settings,
    stopTask,
    task,
  };
}
