import { callAIChatTurn_ACU, callAIWithResolvedPreset_ACU, type AiUsageMetadata_ACU } from '../ai/api-call';
import type { AiChatTurn_ACU, AiNativeToolDefinition_ACU } from '../ai/native-tool';
import type { ContinuationResolvedApiPreset_ACU } from './api-preset';
import { buildOpenAiPromptCacheKey_ACU, supportsExplicitOpenAiCacheKey_ACU } from '../ai/prompt-cache';
import { ContinuationValidationError_ACU, type ContinuationAgentApiPresetRole_ACU, type ContinuationInternalAiRequestIdentity_ACU } from './model';
import {
  beginContinuationInternalAiMainApiInvocation_ACU,
  beginContinuationInternalAiRequest_ACU,
  endContinuationInternalAiMainApiInvocation_ACU,
  settleContinuationInternalAiRequest_ACU,
} from './internal-ai-events';

export type { AiUsageMetadata_ACU };

/** 内部 AI 调用的缓存与用量选项。全部可选：不传时行为与历史版本完全一致。 */
export interface ContinuationInternalAiCallOptions_ACU {
  /** 在已验证可控且供应商支持的请求体上使用稳定缓存命名空间；未知路由不注入。 */
  promptCacheEnabled?: boolean;
  /** 当前角色的稳定命名空间（不得包含迭代号或本次工具结果）。 */
  cacheScope?: string;
  /** 角色实际可用的文本工具协议集合；变化时必须隔离缓存路由。 */
  cacheTools?: readonly string[];
  /** 已提交主会话总结边界；总结改变时隔离缓存路由，不跟随每轮消息增长。 */
  cacheBoundary?: string;
  /** 响应带回 token 用量时回调。并发调用各自持有闭包，互不干扰。 */
  onUsage?: (usage: AiUsageMetadata_ACU) => void;
  /** 本次调用的最大输出 token 下限；预设值更大时沿用预设。缺省不抬。 */
  minOutputTokens?: number;
  /** 传入后，本次请求使用原生 tools，返回值改为带 toolCalls 的对象。 */
  tools?: readonly AiNativeToolDefinition_ACU[];
}

/**
 * 各角色单次输出的 token 下限。总纲一次要写十几卷的完整契约、大纲一次要写整阶段的逐轮标记、
 * 维护代理一次要结算多楼正文的三本账，这三类输出随任务体量增长，4096 的通用默认经常在
 * JSON/标签中间被切断。策划与审查输出短，保持通用默认即可。
 * 取 8192 而不是更高：它是当前主流模型普遍接受的输出上限，再往上部分渠道会直接拒绝请求。
 */
export const CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU: Readonly<Record<ContinuationAgentApiPresetRole_ACU, number>> = {
  main: 4096,
  outline: 8192,
  arcArchitect: 8192,
  maintainer: 8192,
  mainlinePlanner: 4096,
  beatPlanner: 4096,
  reviewer: 4096,
  finalReviewer: 4096,
  webResearcher: 8192,
  instructionComposer: 4096,
};

/**
 * 把一次调用的用量渲染成会话流条目里的紧凑标签。
 * 输入与输出恒常显示；缓存读取和缓存写入仅在厂商报告时追加。
 * 明确报告 0 与字段缺失保持不同语义。
 */
export function formatAgentUsageLabel_ACU(usage: AiUsageMetadata_ACU): string {
  const compact = (value: number | undefined): string => (
    value === undefined ? '未报告' : value < 1000 ? String(value) : `${(value / 1000).toFixed(1)}k`
  );
  const parts = [
    `输入 ${compact(usage.promptTokens)}`,
    `输出 ${compact(usage.completionTokens)}`,
  ];
  if (usage.cachedTokens !== undefined) parts.splice(1, 0, `缓存读取 ${compact(usage.cachedTokens)}`);
  if (usage.cacheWriteTokens !== undefined) parts.push(`缓存写入 ${compact(usage.cacheWriteTokens)}`);
  return parts.join(' · ');
}

/**
 * Executes one continuation-owned internal request with explicit provenance.
 * It never writes host input or continuation state; callers must gate returned
 * text again before scheduling a later side effect.
 */
export async function callContinuationInternalAi_ACU(
  messages: Array<{ role: string; content: string }>,
  preset: ContinuationResolvedApiPreset_ACU,
  identity: ContinuationInternalAiRequestIdentity_ACU,
  signal?: AbortSignal | null,
  options?: ContinuationInternalAiCallOptions_ACU,
): Promise<string | AiChatTurn_ACU | null> {
  beginContinuationInternalAiRequest_ACU(identity);
  const cacheEnabled = options?.promptCacheEnabled === true && supportsExplicitOpenAiCacheKey_ACU(preset);
  const extras = {
    ...(cacheEnabled ? { promptCacheKey: buildOpenAiPromptCacheKey_ACU({
      chatIdentity: identity.chatIdentity, role: options?.cacheScope || identity.source,
      tools: options?.cacheTools ?? [], boundary: options?.cacheBoundary, preset,
    }) } : {}),
    ...(options?.minOutputTokens ? { minOutputTokens: options.minOutputTokens } : {}),
    ...(options?.tools?.length ? { tools: options.tools } : {}),
  };
  try {
    const lifecycle = {
      beforeMainApiCall: () => beginContinuationInternalAiMainApiInvocation_ACU(identity.requestId),
      afterMainApiCall: () => endContinuationInternalAiMainApiInvocation_ACU(identity.requestId),
      ...(options?.onUsage ? { onUsage: options.onUsage } : {}),
    };
    const extra = Object.keys(extras).length ? extras : undefined;
    if (options?.tools?.length) return await callAIChatTurn_ACU(messages, preset, signal, lifecycle, extra);
    return await callAIWithResolvedPreset_ACU(messages, preset, signal, lifecycle, extra);
  } finally {
    // A bound host lifecycle remains registered until its matching ended event.
    // An unbound request is removed, so later unrelated events are never claimed.
    settleContinuationInternalAiRequest_ACU(identity.requestId);
  }
}

/** 传输错误延时重试的配置。wait 可注入：生产用 setTimeout，测试用假计时器。 */
export interface ContinuationInternalAiRetryOptions_ACU {
  /** 传输错误（HTTP 非 2xx、网络异常）的额外重试次数。0 表示失败即抛。 */
  transportRetries: number;
  /** 每次重试前的延时秒数。0 表示重试但不等待（仍会调用 wait(0)）。 */
  retryDelaySeconds: number;
  /** 延时实现。缺省 setTimeout。 */
  wait?: (ms: number) => Promise<void>;
  /** 等待结束后的存活检查：返回 false 表示任务已被停止/换轮，立即抛出原错误不再重试。 */
  isCurrent?: () => boolean;
}

function defaultWait_ACU(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 判定一次内部 AI 调用错误是否值得延时重试。
 * 可重试：HTTP 非 2xx（502 等网关波动）、网络异常等传输层错误。
 * 不可重试：用户中断（AbortError）、续写自身的校验/状态错误（ContinuationValidationError，
 * 含 INTERNAL_REQUEST_STALE——重打同一个已失效请求毫无意义）。
 */
export function isRetryableContinuationTransportError_ACU(error: unknown): boolean {
  if (error instanceof ContinuationValidationError_ACU) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof Error && error.name === 'AbortError') return false;
  return true;
}

/**
 * 带传输错误延时重试的内部 AI 调用。
 *
 * 502/网络抖动这类传输错误此前零重试直接停整条自动链；现在按 retryDelaySeconds 延时后
 * 重打，至多 transportRetries 次。协议解析失败的对话级重试（回灌修正）不走这里——
 * 那是模型输出问题而非网络问题，立即重试更合适。
 * @param invoke 执行一次真实调用的闭包（调用方自行组装 messages/preset/identity）
 * @param options 重试配置
 * @returns 调用结果；重试耗尽后抛出最后一次的原始错误
 */
export async function callContinuationInternalAiWithRetry_ACU<T>(
  invoke: () => Promise<T>,
  options: ContinuationInternalAiRetryOptions_ACU,
): Promise<T> {
  const wait = options.wait ?? defaultWait_ACU;
  const retries = Math.max(0, Math.floor(options.transportRetries));
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await invoke();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableContinuationTransportError_ACU(error)) throw error;
      await wait(Math.max(0, options.retryDelaySeconds) * 1000);
      // 等待期间任务可能已被停止/换轮：先查存活再决定是否重打，不做无谓请求。
      if (options.isCurrent && !options.isCurrent()) throw error;
    }
  }
  throw lastError;
}
