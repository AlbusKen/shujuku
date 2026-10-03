// data/gateways/pristine-fetch.ts — 仅绕过 Kemini 登记的 fetch 包装
//
// Kemini 伴生面板会 patch `window.parent ?? window` 的 fetch，
// 命中 /api/backends/*/generate 后改写请求体并重写响应流（注入自己的"传输函数"工具与控制提示词）。
// 本插件的内部请求打同一个端点且自带原生工具协议，被改写后会与脚本注入的工具互相污染。
//
// 仅沿两种明确标记的 original 引用剥离；遇到未知包装立即停止。
// TT 等宿主的非原生 fetch 可能承担必需的后端桥接，必须保留，不能按函数源码猜测并绕过。
// 不修改全局 fetch；只为本插件内部请求选择发送函数。
// 宿主正文生成不经过本模块，脚本对聊天正文的效果不受影响。

import { getHostWindow } from '../../shared/runtime-env';

/** Kemini 两层拦截器登记原函数的标记键，形如 wrapper[MARKER] = { original }。 */
const KNOWN_FETCH_PATCH_MARKERS_ACU = [
  '__keminiAntiTruncation__',
  '__keminiFetchInterceptor__',
] as const;

/** 包装链深度上限，防御环形引用与异常长的链条。 */
const MAX_UNWRAP_DEPTH_ACU = 16;

type FetchLike_ACU = (this: unknown, input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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
 * 检查宿主与当前窗口的 fetch，仅剥离明确登记的 Kemini 包装。
 * iframe 的 fetch 可能只是转发到父窗口，标记实际登记在宿主 fetch 上。
 * 仅当宿主命中已知包装时直接调用其原函数；否则保留当前窗口的发送链。
 * 每次调用都重新解析：脚本可能在本模块加载之后才安装，缓存会让屏蔽静默失效。
 * @returns 保留宿主桥接的发送函数；宿主原函数绑定到所属窗口
 */
export function resolvePristineFetch_ACU(): typeof fetch {
  const current = globalThis.fetch;
  try {
    const host = getHostWindow();
    const hostFetch = host.fetch;
    const unwrappedHost = unwrapKnownPatches_ACU(hostFetch);
    if (typeof unwrappedHost === 'function' && unwrappedHost !== hostFetch) {
      // 原函数可能仍是 TT 的发送桥接，必须绑定宿主窗口，不替换为原生 fetch。
      return unwrappedHost.bind(host) as typeof fetch;
    }
  } catch {
    // 跨域或宿主属性不可访问时，仍沿当前窗口的已知标记解析，不猜测未知包装。
  }
  return unwrapKnownPatches_ACU(current) as typeof fetch;
}

/**
 * 通过保留宿主桥接的发送函数发起请求，仅绕过已识别的 Kemini 包装。
 * 宿主原函数已绑定所属窗口，其余发送函数沿用 globalThis；不改写地址或请求参数。
 * @param input 请求地址或 Request
 * @param init 请求参数
 * @returns 宿主返回的原始响应
 */
export function pristineFetch_ACU(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const send = resolvePristineFetch_ACU() as FetchLike_ACU;
  return send.call(globalThis, input, init);
}
