// data/gateways/pristine-fetch.ts — 绕过宿主页面第三方脚本对 fetch 的包装
//
// 酒馆预设脚本（例如 Kemini 伴生面板）会 patch `window.parent ?? window` 的 fetch，
// 命中 /api/backends/*/generate 后改写请求体并重写响应流（注入自己的"传输函数"工具）。
// 智能续写与格林推演的内部请求打同一个端点且自带原生工具协议，被改写后会与脚本
// 注入的工具互相污染。这里按拦截器自己登记的原始实现剥离包装链，让这两条链路拿到
// 未被改写的 fetch；宿主正文生成不经过本模块，脚本对聊天的效果不受影响。

/** 已知拦截器在 wrapper 上登记原函数的标记键，形如 wrapper[MARKER] = { original }。 */
const KNOWN_FETCH_PATCH_MARKERS_ACU = [
  '__keminiAntiTruncation__',
  '__keminiFetchInterceptor__',
] as const;

/** 包装链深度上限，防御环形引用与异常长的链条。 */
const MAX_UNWRAP_DEPTH_ACU = 16;

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
 * 解析当前未被已知拦截器包装的 fetch。
 * 每次调用都重新剥离：脚本可能在本模块加载之后才安装，缓存会让屏蔽静默失效。
 * @returns 剥离后的 fetch；无法识别包装时返回当前全局 fetch，不阻断请求
 */
export function resolvePristineFetch_ACU(): typeof fetch {
  let current: unknown = globalThis.fetch;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH_ACU; depth += 1) {
    const original = readRegisteredOriginal_ACU(current);
    if (!original || original === current) break;
    current = original;
  }
  return (typeof current === 'function' ? current : globalThis.fetch) as typeof fetch;
}

/**
 * 以剥离后的 fetch 发起请求，绕过第三方脚本对生成端点的改写。
 * 显式绑定 globalThis：拦截器调用原函数时也传 `this ?? target`，裸调在部分宿主下
 * 会丢失 realm 绑定。
 * @param input 请求地址或 Request
 * @param init 请求参数
 * @returns 宿主返回的原始响应
 */
export function pristineFetch_ACU(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const send = resolvePristineFetch_ACU() as (this: unknown, input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  return send.call(globalThis, input, init);
}
