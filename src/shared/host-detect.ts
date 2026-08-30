/**
 * shared/host-detect.ts — 宿主后端形态检测
 *
 * 区分 TauriTavern（Rust 后端，支持 custom_api_format 契约）与原版 SillyTavern
 * （Node 后端，按 chat_completion_source 内置原生协议转换）。
 * 每次调用时判定（不缓存），与 TT ABI 检测惯例一致（window.__TAURITAVERN__，
 * 兼容脚本沙箱中宿主 API 挂在顶层窗口的场景）。
 */

export function isTauriTavernHost_ACU(): boolean {
  try {
    return Boolean((globalThis as any).__TAURITAVERN__ || (globalThis as any).window?.__TAURITAVERN__);
  } catch {
    return false;
  }
}
