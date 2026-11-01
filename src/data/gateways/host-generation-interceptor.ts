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
  /** 未接管请求的发送前保存钩子，不代表后端收到或正文采用；失败即阻断。 */
  beforeDispatchObserver?(request: InterceptedHostRequest_ACU): Promise<void>;
  /** 未认领的活动请求可在唯一真实发送前异步改写 JSON payload；forward 只能调用一次。 */
  aroundDispatch?(request: InterceptedHostRequest_ACU, forward: (payload: Record<string, unknown>) => Promise<Response>): Promise<Response>;
  /** 是否在未认领请求上启用发送环绕。 */
  aroundDispatchActive?(): boolean;
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
    const active = options.isActive();
    const aroundActive = options.aroundDispatchActive?.() === true;
    // 同步认领再读 body；处理期间模式关闭也不能把已经认领的请求发回宿主。
    try {
      options.beforeForward?.({ bodyText: typeof init?.body === 'string' ? init.body : null, signal });
      if (!active && !aroundActive) return forward();
      const intercepted: InterceptedHostRequest_ACU = {
        url: url.href,
        signal,
        bodyText: typeof init?.body === 'string' ? init.body : null,
        readPayload: createPayloadReader_ACU(request, init),
      };
      const run = options.claim(intercepted);
      if (run) return cancelHostRequest_ACU(run, signal);
      if (options.rejectUnclaimed) throw new Error('零层正文请求未绑定当前回合，原发送已阻断。');
      if (!options.beforeDispatchObserver && !options.aroundDispatch) return forward();
      const frozen = freezeObservedForward_ACU(input, init, request, url.href);
      if (options.aroundDispatch && aroundActive) return runAroundDispatch_ACU(options.aroundDispatch, frozen, () => disposed,
        options.aroundDispatchActive ?? options.isActive, original, receiver);
      if (!options.beforeDispatchObserver) return forward();
      return runBeforeDispatchObserver_ACU(options.beforeDispatchObserver, frozen, () => disposed,
        options.isActive, original, receiver);
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

interface FrozenObservedForward_ACU {
  readonly request: Request;
  readonly intercepted: InterceptedHostRequest_ACU;
  /** 冻结的副本不能掩盖调用方在 await 期间改写原 init；变化必须拒绝。 */
  sourceUnchanged(): boolean;
}

function headersFingerprint_ACU(headers: HeadersInit | undefined): string {
  return JSON.stringify([...new Headers(headers).entries()].sort(([left], [right]) => left.localeCompare(right)));
}

// 冻结 observer 路径的请求副本，防止 await 期间原参数被改写。
function freezeObservedForward_ACU(
  input: RequestInfo | URL, init: RequestInit | undefined, request: Request | null, url: string,
): FrozenObservedForward_ACU {
  const initBody = init?.body;
  const sourceMethod = init?.method;
  const sourceSignal = init?.signal;
  const sourceHeaders = headersFingerprint_ACU(init?.headers);
  const sourceUnchanged = () => init?.body === initBody && init?.method === sourceMethod
    && init?.signal === sourceSignal && headersFingerprint_ACU(init?.headers) === sourceHeaders;
  let frozenRequest: Request;
  let bodyText: string | null;
  if (initBody !== undefined) {
    if (typeof initBody !== 'string') throw new Error('发送前观察器仅支持可确认的 JSON 字符串请求体。');
    const headers = new Headers(init?.headers ?? request?.headers);
    frozenRequest = new Request(request ?? url, { ...init, headers, body: initBody });
    bodyText = initBody;
  } else {
    if (!request) throw new Error('发送前观察器缺少可克隆的请求体。');
    // Request 输入仍须应用 init 覆盖；冻结副本同时供 reader 与唯一原发送使用。
    frozenRequest = new Request(request.clone(), { ...init, headers: new Headers(init?.headers ?? request.headers) });
    bodyText = null;
  }
  const intercepted: InterceptedHostRequest_ACU = {
    url,
    signal: frozenRequest.signal,
    bodyText,
    readPayload: createPayloadReader_ACU(frozenRequest),
  };
  return { request: frozenRequest, intercepted, sourceUnchanged };
}

async function runAroundDispatch_ACU(
  around: NonNullable<HostRequestInterceptorOptions_ACU['aroundDispatch']>,
  frozen: FrozenObservedForward_ACU, isDisposed: () => boolean, isActive: () => boolean,
  original: typeof fetch, receiver: unknown,
): Promise<Response> {
  let forwarded = false;
  try {
    const originalPayload = await frozen.intercepted.readPayload();
    assertForwardAvailable_ACU(frozen, isDisposed, isActive, '解析期间');
    const forward = async (payload: Record<string, unknown>): Promise<Response> => {
      if (forwarded) throw new Error('生成请求只能发送一次。');
      forwarded = true;
      assertForwardAvailable_ACU(frozen, isDisposed, isActive, '发送前');
      const next = new Request(frozen.request, { body: JSON.stringify(payload) });
      return original.call(receiver, next);
    };
    return await around(frozen.intercepted, async payload => forward(payload ?? originalPayload));
  } catch (error) {
    // forward 一旦开始，真实网络失败必须保持原异常；只包装审查、保存或发送前阻断失败。
    if (forwarded) throw error;
    throw new HostGenerationInterceptedError_ACU(error);
  }
}

function assertForwardAvailable_ACU(
  frozen: FrozenObservedForward_ACU, isDisposed: () => boolean, isActive: () => boolean, phase: string,
): void {
  if (!frozen.sourceUnchanged()) throw new Error(`发送环绕器${phase}原请求参数已变化。`);
  if (isDisposed()) throw new Error(`发送环绕器${phase}已撤销。`);
  if (frozen.intercepted.signal?.aborted) throw new Error(`发送环绕器${phase}请求已中止。`);
  if (!isActive()) throw new Error(`发送环绕器${phase}请求已失效。`);
}

async function runBeforeDispatchObserver_ACU(
  observer: NonNullable<HostRequestInterceptorOptions_ACU['beforeDispatchObserver']>,
  frozen: FrozenObservedForward_ACU, isDisposed: () => boolean, isActive: () => boolean,
  original: typeof fetch, receiver: unknown,
): Promise<Response> {
  try {
    // 先确认冻结副本是 JSON；解析等待亦不得越过撤销、失活、取消或原参数变化。
    await frozen.intercepted.readPayload();
    if (!frozen.sourceUnchanged()) throw new Error('发送前观察器解析期间原请求参数已变化。');
    if (isDisposed()) throw new Error('发送前观察器解析期间已撤销。');
    if (frozen.intercepted.signal?.aborted) throw new Error('发送前观察器执行前请求已中止。');
    if (!isActive()) throw new Error('发送前观察器解析期间请求已失效。');
    await observer(frozen.intercepted);
    if (!frozen.sourceUnchanged()) throw new Error('发送前观察器等待期间原请求参数已变化。');
    if (isDisposed()) throw new Error('发送前观察器等待期间已撤销。');
    if (frozen.intercepted.signal?.aborted) throw new Error('发送前观察器等待期间请求已中止。');
    if (!isActive()) throw new Error('发送前观察器等待期间请求已失效。');
  } catch (error) {
    throw new HostGenerationInterceptedError_ACU(error);
  }
  // observer 已完成后只用冻结副本发一次；原传输错误与 Response 原样透传，不重试也不包装。
  return original.call(receiver, frozen.request);
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