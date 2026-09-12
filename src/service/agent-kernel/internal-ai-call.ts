export interface AgentKernelRequestIdentity_ACU {
  requestId: string;
  chatIdentity: string;
  source: string;
}

export interface AgentKernelCacheRoute_ACU {
  namespace: string;
  scope?: string;
  apiMode: string;
  model: string;
  url: string;
}

function fnv1aHex_ACU(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildAgentKernelPromptCacheKey_ACU(identity: AgentKernelRequestIdentity_ACU, route: AgentKernelCacheRoute_ACU): string {
  const key = `${route.namespace}-${fnv1aHex_ACU(identity.chatIdentity)}-${fnv1aHex_ACU(route.scope || identity.source)}-${fnv1aHex_ACU(JSON.stringify([route.apiMode, route.model, route.url]))}`;
  if (key.length > 64 || !/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('内部 AI 缓存路由键不符合长度或字符约束。');
  return key;
}

export async function executeAgentKernelRequest_ACU<T>(input: {
  invoke: () => Promise<T>;
  before?: () => void;
  after?: () => void;
  settle?: () => void;
}): Promise<T> {
  input.before?.();
  try {
    return await input.invoke();
  } finally {
    input.after?.();
    input.settle?.();
  }
}

export async function retryAgentKernelRequest_ACU<T>(
  invoke: () => Promise<T>,
  options: { retries: number; delayMs: number; wait: (ms: number) => Promise<void>; shouldRetry: (error: unknown) => boolean; isCurrent?: () => boolean },
): Promise<T> {
  const retries = Math.max(0, Math.floor(options.retries));
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await invoke(); } catch (error) {
      lastError = error;
      if (attempt >= retries || !options.shouldRetry(error)) throw error;
      await options.wait(Math.max(0, options.delayMs));
      if (options.isCurrent && !options.isCurrent()) throw error;
    }
  }
  throw lastError;
}
