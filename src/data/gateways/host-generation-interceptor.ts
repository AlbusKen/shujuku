import { getHostWindow } from '../../shared/runtime-env';

/** 标记只在本地调用链传播，不进入 HTTP headers/body。 */
export const INTERNAL_GENERATION_FETCH_ACU = Symbol.for('acu.internal-generation-fetch');
export const HOST_GENERATION_INTERCEPTOR_MARKER_ACU = '__acuHostGenerationInterceptor__';

type InternalRequestInit_ACU = RequestInit & { [INTERNAL_GENERATION_FETCH_ACU]?: boolean };
export interface InterceptedHostRequest_ACU {
  readonly url: string;
  readonly signal: AbortSignal | null;
  /** 宿主 JSON 字符串的同步身份锚；非字符串请求不做猜测认领。 */
  readonly bodyText: string | null;
  /** 延迟读取副本；认领必须在读取前同步完成，避免串入下一轮。 */
  readPayload(): Promise<Record<string, unknown>>;
}
export interface HostRequestInterceptorOptions_ACU {
  /** 无活动零层回合时不读取请求体，也不改变宿主请求行为。 */
  isActive(): boolean;
  /** 生成端点的同步放行门；只核对现有 JSON 字符串，不重写请求或接管传输。 */
  beforeForward?(request: Pick<InterceptedHostRequest_ACU, 'bodyText' | 'signal'>): void;
  /** 独占装配期间未知正文请求必须阻断；普通调用默认仍可放行。 */
  rejectUnclaimed?: boolean;
  /** 同步认领；返回 null 的请求沿原链发送，认领后绝不回退原发送。 */
  claim(request: InterceptedHostRequest_ACU): (() => Promise<void>) | null;
}

export function markInternalGenerationFetch_ACU(init?: RequestInit): RequestInit {
  return { ...init, [INTERNAL_GENERATION_FETCH_ACU]: true } as InternalRequestInit_ACU;
}

/** 本轮响应由插件保存/发布；宿主只能获得取消，不得获得可入楼的正文。 */
export class HostGenerationInterceptedError_ACU extends Error {
  readonly code = 'ACU_HOST_GENERATION_INTERCEPTED';
  readonly cause: unknown;
  constructor(cause?: unknown) {
    super('酒馆原发送已取消，本轮由数据库处理。');
    this.name = 'AbortError';
    this.cause = cause;
  }
}

function asRequest_ACU(input: RequestInfo | URL): Request | null {
  // Request 可能来自父窗口，不能仅用当前 realm 的 instanceof。
  return typeof input === 'object' && input !== null
    && 'clone' in input && typeof input.clone === 'function'
    && 'url' in input && typeof input.url === 'string'
    ? input as Request : null;
}

export function installHostGenerationInterceptor_ACU(
  options: HostRequestInterceptorOptions_ACU,
  host: Pick<Window, 'fetch' | 'location'> = getHostWindow(),
): () => void {
  const original = host.fetch;
  if (typeof original !== 'function') throw new Error('宿主 fetch 不可用。');
  let disposed = false;
  const wrapper: typeof fetch = function (this: unknown, input, init) {
    const receiver = this || host;
    const forward = () => original.call(receiver, input, init);
    if (disposed || (init as InternalRequestInit_ACU | undefined)?.[INTERNAL_GENERATION_FETCH_ACU]) return forward();
    const request = asRequest_ACU(input);
    const url = new URL(request?.url ?? String(input), host.location.href);
    const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (url.origin !== host.location.origin || method !== 'POST'
      || url.pathname !== '/api/backends/chat-completions/generate') return forward();
    const signal = init?.signal !== undefined ? init.signal : request?.signal ?? null;
    // 同步认领再读 body；处理期间模式关闭也不能把已经认领的请求发回宿主。
    try {
      options.beforeForward?.({ bodyText: typeof init?.body === 'string' ? init.body : null, signal });
      if (!options.isActive()) return forward();
      const run = options.claim({
        url: url.href,
        signal,
        bodyText: typeof init?.body === 'string' ? init.body : null,
        readPayload: createPayloadReader_ACU(request, init),
      });
      if (run) return cancelHostRequest_ACU(run, signal);
      if (options.rejectUnclaimed) throw new Error('零层正文请求未绑定当前回合，原发送已阻断。');
      return forward();
    } catch (error) {
      return Promise.reject(new HostGenerationInterceptedError_ACU(error));
    }
  };
  Object.defineProperty(wrapper, HOST_GENERATION_INTERCEPTOR_MARKER_ACU, { value: { original } });
  host.fetch = wrapper;
  return () => {
    disposed = true;
    if (host.fetch === wrapper) host.fetch = original;
  };
}

function createPayloadReader_ACU(request: Request | null, init?: RequestInit): InterceptedHostRequest_ACU['readPayload'] {
  const body = init?.body;
  const copy = body === undefined ? request?.clone() : null;
  let result: Promise<Record<string, unknown>> | undefined;
  return () => {
    if (!result) {
      result = (async () => {
        const text = body === undefined
          ? await copy?.text()
          : typeof body === 'string' ? body : await new Response(body).text();
        if (!text) throw new Error('酒馆生成请求缺少 JSON 请求体。');
        let payload: unknown;
        try { payload = JSON.parse(text); }
        catch { throw new Error('酒馆生成请求体不是合法 JSON。'); }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new Error('酒馆生成请求体必须为对象。');
        }
        return payload as Record<string, unknown>;
      })();
    }
    return result;
  };
}

async function cancelHostRequest_ACU(run: () => Promise<void>, signal: AbortSignal | null): Promise<Response> {
  try {
    if (signal?.aborted) throw new Error('本轮在数据库发送前已中止。');
    await run();
    if (signal?.aborted) throw new Error('本轮已中止。');
  } catch (error) {
    // 无论解析、转发还是保存失败，都不能重新发送酒馆原请求。
    throw new HostGenerationInterceptedError_ACU(error);
  }
  throw new HostGenerationInterceptedError_ACU();
}