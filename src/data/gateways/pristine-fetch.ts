// data/gateways/pristine-fetch.ts — 绕过宿主页面第三方脚本对 fetch 的包装
//
// 酒馆预设脚本（例如 Kemini 伴生面板）会 patch `window.parent ?? window` 的 fetch，
// 命中 /api/backends/*/generate 后改写请求体并重写响应流（注入自己的"传输函数"工具与控制提示词）。
// 本插件的内部请求打同一个端点且自带原生工具协议，被改写后会与脚本注入的工具互相污染。
//
// 解析顺序：
// 1. 按已知拦截器登记的原始实现逐层剥离包装链；
// 2. 剥离结果仍不是原生 fetch（外层还有未登记标记的包装）时，改用本模块专用隐藏同源 iframe
//    的原生 fetch——第三方脚本只包装已有窗口的 fetch，碰不到这里新建的浏览上下文；
// 3. 两者都拿不到时回退当前全局 fetch 并告警，不阻断请求。
// 宿主正文生成不经过本模块，脚本对聊天正文的效果不受影响。

import { logWarn_ACU } from '../../shared/utils';

/** 已知拦截器在 wrapper 上登记原函数的标记键，形如 wrapper[MARKER] = { original }。 */
const KNOWN_FETCH_PATCH_MARKERS_ACU = [
  '__keminiAntiTruncation__',
  '__keminiFetchInterceptor__',
] as const;

/** 包装链深度上限，防御环形引用与异常长的链条。 */
const MAX_UNWRAP_DEPTH_ACU = 16;

/** 专用隐藏 iframe 的元素 id。 */
const PRISTINE_FRAME_ID_ACU = 'acu-pristine-fetch-frame';

type FetchLike_ACU = (this: unknown, input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let warnedFallback_ACU = false;

/** 读取 wrapper 登记的原始实现；不是已知包装时返回 null。 */
function readRegisteredOriginal_ACU(candidate: unknown): unknown {
  if (typeof candidate !== 'function') return null;
  for (const marker of KNOWN_FETCH_PATCH_MARKERS_ACU) {
    // 收窄后的 Function 没有字符串索引签名，按 TS 要求经 unknown 中转再读标记槽。
    const slot = (candidate as unknown as Record<string, unknown>)[marker];
    if (!slot || typeof slot !== 'object') continue;
    const original = (slot as { original?: unknown }).original;
    if (typeof original === 'function') return original;
  }
  return null;
}

/**
 * 判断是否为浏览器原生 fetch：源码为 [native code] 且函数名为 fetch。
 * bind 出来的函数名是 "bound fetch"，JS 包装函数源码不是 native code，二者都不算原生。
 */
function isNativeFetch_ACU(candidate: unknown): candidate is FetchLike_ACU {
  if (typeof candidate !== 'function') return false;
  try {
    return candidate.name === 'fetch'
      && /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(candidate));
  } catch {
    return false;
  }
}

/** 按已知标记逐层剥离包装链。 */
function unwrapKnownPatches_ACU(start: unknown): unknown {
  let current: unknown = start;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH_ACU; depth += 1) {
    const original = readRegisteredOriginal_ACU(current);
    if (!original || original === current) break;
    current = original;
  }
  return current;
}

/**
 * 取专用隐藏同源 iframe 的原生 fetch，并绑定到该 iframe 窗口。
 * iframe 常驻复用：请求进行中移除浏览上下文会中断请求。
 * @returns 原生 fetch；无 DOM、创建失败或该窗口 fetch 也非原生时返回 null
 */
function resolveFrameFetch_ACU(): FetchLike_ACU | null {
  const doc: Document | undefined = (globalThis as { document?: Document }).document;
  if (!doc || typeof doc.createElement !== 'function') return null;
  try {
    let frame = doc.getElementById(PRISTINE_FRAME_ID_ACU) as HTMLIFrameElement | null;
    if (!frame || !frame.isConnected || !frame.contentWindow) {
      frame?.remove();
      frame = doc.createElement('iframe');
      frame.id = PRISTINE_FRAME_ID_ACU;
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'display:none !important;width:0;height:0;border:0;position:absolute;';
      (doc.body || doc.documentElement).appendChild(frame);
    }
    const frameWindow = frame.contentWindow as (Window & typeof globalThis) | null;
    const frameFetch = frameWindow?.fetch;
    if (!frameWindow || !isNativeFetch_ACU(frameFetch)) return null;
    return function frameBoundFetch(input: RequestInfo | URL, init?: RequestInit) {
      // 隐藏 iframe 的基址不一定与宿主页面一致，相对地址先按宿主文档解析为绝对地址。
      return frameFetch.call(frameWindow, toAbsoluteInput_ACU(input), init);
    };
  } catch {
    return null;
  }
}

/**
 * 解析当前未被第三方脚本包装的 fetch。
 * 每次调用都重新解析：脚本可能在本模块加载之后才安装，缓存会让屏蔽静默失效。
 * @returns 原生 fetch；无法获得时返回当前全局 fetch，不阻断请求
 */
export function resolvePristineFetch_ACU(): typeof fetch {
  const current = globalThis.fetch;
  const unwrapped = unwrapKnownPatches_ACU(current);
  if (isNativeFetch_ACU(unwrapped)) {
    return function unwrappedFetch(input: RequestInfo | URL, init?: RequestInit) {
      return unwrapped.call(globalThis, input, init);
    } as typeof fetch;
  }
  const frameFetch = resolveFrameFetch_ACU();
  if (frameFetch) return frameFetch as typeof fetch;
  if (!warnedFallback_ACU) {
    warnedFallback_ACU = true;
    logWarn_ACU('[pristineFetch] 未能取得原生 fetch，内部 AI 请求可能仍被第三方脚本改写。');
  }
  return current;
}

/** 相对地址按当前文档解析为绝对地址：隐藏 iframe 的基址与宿主页面不一定一致。 */
function toAbsoluteInput_ACU(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input !== 'string') return input;
  try {
    const base = (globalThis as { document?: Document }).document?.baseURI
      || (globalThis as { location?: Location }).location?.href;
    return base ? new URL(input, base).href : input;
  } catch {
    return input;
  }
}

/**
 * 以原生 fetch 发起请求，绕过第三方脚本对生成端点的改写。
 * @param input 请求地址或 Request
 * @param init 请求参数
 * @returns 宿主返回的原始响应
 */
export function pristineFetch_ACU(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const send = resolvePristineFetch_ACU() as FetchLike_ACU;
  return send.call(globalThis, input, init);
}
