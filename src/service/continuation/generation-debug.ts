import { logAgentSession_ACU, updateAgentSession_ACU } from './agent/agent-session-log';

const stages_ACU = {
  page_ready: '页面收到写作指导', page_discarded: '页面未交接指导',
  page_handoff: '页面调用发送入口', send_returned: '发送入口返回',
  bridge_entered: '生成桥收到指导', host_turn_recording: '登记等待轮',
  host_turn_recorded: '等待轮已登记', input_writing: '写入宿主输入框',
  input_written: '完整指导已写入', host_call: '调用宿主生成',
  host_dispatched: '宿主调用已发出（尚不代表生成成功）',
  host_resolved: '宿主生成 Promise 已结束', host_rejected: '宿主生成调用失败',
  generation_started: '收到并认领 GENERATION_STARTED',
  generation_ignored: '生成事件未被本轮认领', after_commands: '到达 GENERATION_AFTER_COMMANDS',
  plot_start: '开始剧情发送前处理', plot_result: '剧情处理返回',
  plot_skip: '剧情处理已跳过', plot_blocked: '剧情处理阻断发送',
  ended_signal: '收到 GENERATION_ENDED', body_resolved: '已定位对应正文楼层',
  confirm_start: '开始确认正文', confirmed: '正文确认完成',
  result_rejected: '正文未通过确认', binding_failed: '生成序列绑定失败',
  stopped: '本轮生成停止', failed: '交接异常',
  logical_entered: '零层发送入口收到指导', logical_loading: '装配零层运行时',
  logical_preparing: '准备零层剧情与正文', logical_recorded: '逻辑等待轮已登记',
  logical_published: '逻辑正文已发布',
} as const;
export type ContinuationDebugStage_ACU = keyof typeof stages_ACU;
export interface ContinuationDebugFields_ACU {
  mode?: 'host' | 'logical'; reason?: string; errorType?: string;
  chars?: number; seq?: number; messageIndex?: number; elapsedMs?: number;
  phase?: string; access?: string;
  expectedLength?: number; assignedLength?: number; actualLength?: number;
  sent?: boolean; claimed?: boolean; quietLike?: boolean; dryRun?: boolean;
  automatic?: boolean; plan?: boolean; recall?: boolean; freshIntent?: boolean;
}
const reasons_ACU = new Set([
  'page_unmounted', 'page_scope_changed', 'action_replaced', 'user_stopped',
  'chat_mismatch', 'snapshot_missing', 'input_unavailable', 'empty_instruction',
  'control_unavailable', 'assignment_mismatch', 'input_changed_value', 'control_replaced', 'exception',
  'host_unavailable', 'api', 'window', 'none', 'event_filtered', 'sequence_conflict',
  'no_reply', 'unsafe', 'not_tail', 'empty_body', 'missing_tags', 'short_body',
  'disabled_or_ineligible', 'already_processed', 'busy', 'planned', 'failed', 'skipped',
  'aborted', 'loop_retry', 'no_match', 'no_input', 'vector_only', 'pending_snapshot',
]);
const errorTypes_ACU = new Set(['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'AbortError', 'unknown']);
export const CONTINUATION_DEBUG_WAIT_MS_ACU = 15_000;
let nextTrace_ACU = 1;
/** 仅输出白名单错误类别，不读取第三方异常的 message、stack 或载荷。 */
export function continuationDebugErrorType_ACU(error: unknown): string {
  try {
    const name = error instanceof Error ? error.name : '';
    return errorTypes_ACU.has(name) ? name : 'unknown';
  } catch { return 'unknown'; }
}

function safeFields_ACU(fields: ContinuationDebugFields_ACU): string {
  const output: Record<string, string | number | boolean> = {};
  if (fields.mode === 'host' || fields.mode === 'logical') output.mode = fields.mode;
  if (fields.reason !== undefined) output.reason = reasons_ACU.has(fields.reason) ? fields.reason : 'unknown';
  if (fields.errorType !== undefined) output.errorType = errorTypes_ACU.has(fields.errorType) ? fields.errorType : 'unknown';
  if (['lookup', 'assign', 'notify', 'restore', 'verify'].includes(fields.phase ?? '')) output.phase = fields.phase!;
  if (fields.access === 'native' || fields.access === 'jquery') output.access = fields.access;
  for (const key of ['chars', 'seq', 'messageIndex', 'elapsedMs', 'expectedLength', 'assignedLength', 'actualLength'] as const) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) output[key] = Math.floor(value);
  }
  for (const key of ['sent', 'claimed', 'quietLike', 'dryRun', 'automatic', 'plan', 'recall', 'freshIntent'] as const) {
    if (typeof fields[key] === 'boolean') output[key] = fields[key]!;
  }
  return Object.keys(output).length ? ` ${JSON.stringify(output)}` : '';
}

/** 单轮旁路诊断：一个会话卡片，计时仅提示等待，绝不取消、重发或写任务状态。 */
export class ContinuationGenerationDebug_ACU {
  private readonly number = nextTrace_ACU++;
  private readonly startedAt = Date.now();
  private entryId: number | undefined;
  private lines: string[] = [];
  private lastStage: ContinuationDebugStage_ACU = 'page_ready';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private isCurrent: () => boolean = () => true;

  setScope(isCurrent: () => boolean): void { this.isCurrent = isCurrent; }

  step(stage: ContinuationDebugStage_ACU, fields: ContinuationDebugFields_ACU = {}): void {
    if (this.closed) return;
    try {
      if (!this.isCurrent()) { this.cancel(); return; }
      this.lastStage = stage;
      this.lines.push(`+${Math.max(0, Date.now() - this.startedAt)}ms ${stage}：${stages_ACU[stage]}${safeFields_ACU(fields)}`);
      while (this.lines.join('\n').length > 1500 && this.lines.length > 1) this.lines.shift();
      const patch = { title: `[续写 DEBUG #${this.number}] ${stages_ACU[stage]}`, detail: this.lines.join('\n'), status: 'running' as const };
      if (this.entryId === undefined) this.entryId = logAgentSession_ACU({ kind: 'handoff', ...patch });
      else updateAgentSession_ACU(this.entryId, patch);
    } catch { /* 诊断不可影响生成 */ }
  }

  watch(isCurrent: () => boolean): void {
    this.clearTimer();
    if (this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      try {
        if (this.closed || !this.isCurrent() || !isCurrent() || this.entryId === undefined) return;
        updateAgentSession_ACU(this.entryId, {
          title: `[续写 DEBUG #${this.number}] 仍在等待：${stages_ACU[this.lastStage]}`,
          detail: `${this.lines.join('\n')}\n已等待至少 ${CONTINUATION_DEBUG_WAIT_MS_ACU / 1000} 秒；尚未观察到下一阶段，不等于生成失败。此提示不会暂停或重发。`,
        });
      } catch { /* 作用域失效或观察失败时保持静默 */ }
    }, CONTINUATION_DEBUG_WAIT_MS_ACU);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  finish(stage: ContinuationDebugStage_ACU, fields: ContinuationDebugFields_ACU = {}, ok = true): void {
    if (this.closed) return;
    this.step(stage, fields);
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    try { if (this.entryId !== undefined) updateAgentSession_ACU(this.entryId, { ok, status: ok ? 'done' : 'failed' }); }
    catch { /* 诊断不可影响结算 */ }
  }

  cancel(): void { this.closed = true; this.clearTimer(); }
  private clearTimer(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
}

const traces_ACU = new WeakMap<object, ContinuationGenerationDebug_ACU>();
/** prepared 对象只作内存关联；日志中不输出聊天名、任务 ID 或指导正文。 */
export function getContinuationGenerationDebug_ACU(prepared: object): ContinuationGenerationDebug_ACU {
  let trace = traces_ACU.get(prepared);
  if (!trace) { trace = new ContinuationGenerationDebug_ACU(); traces_ACU.set(prepared, trace); }
  return trace;
}
