// service/ai/request-max-tokens.ts — 请求 max_tokens 的唯一解析点
// 发送路径使用此值设置输出 token 上限；max_tokens 不是模型完整上下文窗口容量。

/** 预设 max_tokens（兼容历史 maxTokens，缺省 4096）与调用方输出下限取大。 */
export function resolveRequestMaxTokens_ACU(
    apiConfig: { max_tokens?: number; maxTokens?: number },
    minOutputTokens?: number,
): number {
    const presetMaxTokens = apiConfig.max_tokens ?? apiConfig.maxTokens ?? 4096;
    const floor = Number.isFinite(minOutputTokens) ? Math.max(0, Math.trunc(minOutputTokens!)) : 0;
    return Math.max(presetMaxTokens, floor);
}
