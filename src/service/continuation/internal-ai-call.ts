import { callAIWithResolvedPreset_ACU, type AiUsageMetadata_ACU } from '../ai/api-call';
import type { ContinuationResolvedApiPreset_ACU } from './api-preset';
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
  /**
   * 是否注入 prompt_cache_key。生产调用方恒传 false：该字段会干扰部分渠道的前缀缓存。
   * 仅 custom（chat-completions）路径生效；tavern / 主 API 路径不受影响。
   * 用量回调 onUsage 与此开关无关，关闭注入后仍统计缓存命中。
   */
  promptCacheEnabled?: boolean;
  /**
   * 缓存命名空间的调用方标识（如 'agent-main'、'sub-mainline-planner'、'outline'）。
   * 不同调用方的提示词前缀不同，分开命名空间可避免互相挤占缓存路由。缺省用 identity.source。
   */
  cacheScope?: string;
  /** 响应带回 token 用量时回调。并发调用各自持有闭包，互不干扰。 */
  onUsage?: (usage: AiUsageMetadata_ACU) => void;
  /** 本次调用的最大输出 token 下限；预设值更大时沿用预设。缺省不抬。 */
  minOutputTokens?: number;
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
};

/**
 * fnv-1a 32 位哈希（十六进制）。缓存 key 只需要稳定与低碰撞，不需要密码学强度；
 * 输入可能含中文与路径分隔符，哈希后得到纯 [0-9a-f] 串，满足请求体注入通道的字符白名单。
 */
function fnv1aHex_ACU(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const PROMPT_CACHE_KEY_NAMESPACE_ACU = 'acu-cont-v2';
const PROMPT_CACHE_KEY_MAX_LENGTH_ACU = 64;

/**
 * 组装本次调用的 prompt_cache_key。只含版本、聊天身份、调用 scope 与模型路由四类稳定因子；
 * 不含任何随请求、迭代或轮次变化的内容，也不暴露原始聊天身份、scope、模型或 URL。
 */
function buildPromptCacheKey_ACU(
  identity: ContinuationInternalAiRequestIdentity_ACU,
  scope: string,
  preset: ContinuationResolvedApiPreset_ACU,
): string {
  const chatHash = fnv1aHex_ACU(identity.chatIdentity);
  const scopeHash = fnv1aHex_ACU(scope);
  const routeHash = fnv1aHex_ACU(JSON.stringify([
    preset.apiMode,
    preset.apiConfig.model,
    preset.apiConfig.url,
  ]));
  const key = `${PROMPT_CACHE_KEY_NAMESPACE_ACU}-${chatHash}-${scopeHash}-${routeHash}`;
  if (key.length > PROMPT_CACHE_KEY_MAX_LENGTH_ACU || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('内部 AI 缓存路由键不符合长度或字符约束。');
  }
  return key;
}

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
): Promise<string | null> {
  beginContinuationInternalAiRequest_ACU(identity);
  const cacheEnabled = options?.promptCacheEnabled === true;
  const extras = {
    ...(cacheEnabled ? { promptCacheKey: buildPromptCacheKey_ACU(identity, options?.cacheScope || identity.source, preset) } : {}),
    ...(options?.minOutputTokens ? { minOutputTokens: options.minOutputTokens } : {}),
  };
  try {
    return await callAIWithResolvedPreset_ACU(
      messages,
      preset,
      signal,
      {
        beforeMainApiCall: () => beginContinuationInternalAiMainApiInvocation_ACU(identity.requestId),
        afterMainApiCall: () => endContinuationInternalAiMainApiInvocation_ACU(identity.requestId),
        ...(options?.onUsage ? { onUsage: options.onUsage } : {}),
      },
      Object.keys(extras).length ? extras : undefined,
    );
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
