// data/gateways/pristine-fetch.ts — 内部请求绕过本插件的生成请求包装
//
// 内部请求与宿主正文共用生成端点，需避免被本插件的正文拦截器重复认领。
//
// 仅沿本插件包装登记的 original 引用剥离；遇到其他包装立即停止。
// TT 等宿主的非原生 fetch 可能承担必需的后端桥接，必须保留，不能按函数源码猜测并绕过。
// 不修改全局 fetch；只为本插件内部请求选择发送函数。
// 宿主正文生成不经过本模块，脚本对聊天正文的效果不受影响。

import { getHostWindow } from '../../shared/runtime-env';
import { HOST_GENERATION_INTERCEPTOR_MARKER_ACU, markInternalGenerationFetch_ACU } from './host-generation-interceptor';

/** 已知包装登记原函数的标记键，形如 wrapper[MARKER] = { original }。 */
const KNOWN_FETCH_PATCH_MARKERS_ACU = [
  HOST_GENERATION_INTERCEPTOR_MARKER_ACU,
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
 * 检查宿主与当前窗口的 fetch，仅剥离本插件的生成请求包装。
 * 优先使用宿主当前的发送链，保留第三方包装与必需的后端桥接。
 * 宿主不可访问或没有 fetch 时，才沿当前窗口的发送链回退。
 * 每次调用都重新解析，以适应拦截器在本模块加载之后安装或释放的情况。
 * @returns 保留宿主桥接的发送函数；宿主原函数绑定到所属窗口
 */
export function resolvePristineFetch_ACU(): typeof fetch {
  const current = globalThis.fetch;
  try {
    const host = getHostWindow();
    const hostFetch = host.fetch;
    const unwrappedHost = unwrapKnownPatches_ACU(hostFetch);
    if (typeof unwrappedHost === 'function') {
      // 原函数可能仍是 TT 的发送桥接，必须绑定宿主窗口，不替换为原生 fetch。
      return unwrappedHost.bind(host) as typeof fetch;
    }
  } catch {
    // 跨域或宿主属性不可访问时，仍沿当前窗口的已知标记解析，不猜测未知包装。
  }
  return unwrapKnownPatches_ACU(current) as typeof fetch;
}

/**
 * 通过保留宿主桥接的发送函数发起内部请求，仅绕过本插件的生成请求包装。
 * 宿主原函数已绑定所属窗口，其余发送函数沿用 globalThis；不改写地址或请求参数。
 * @param input 请求地址或 Request
 * @param init 请求参数
 * @returns 宿主返回的原始响应
 */
export function pristineFetch_ACU(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const send = resolvePristineFetch_ACU() as FetchLike_ACU;
  return send.call(globalThis, input, markInternalGenerationFetch_ACU(init));
}
