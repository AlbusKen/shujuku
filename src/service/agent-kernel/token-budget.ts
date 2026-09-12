export type AgentKernelTokenCounter_ACU = (text: string) => Promise<number>;

/** Shared token-counter wrapper. The caller owns its tokenizer and fallback policy. */
export async function countAgentKernelTokens_ACU(
  text: string,
  count: AgentKernelTokenCounter_ACU,
): Promise<number> {
  return count(String(text ?? ''));
}

/** Memoizes token measurements inside one logical run without retaining conversation state. */
export function createAgentKernelTokenCounter_ACU(
  count: AgentKernelTokenCounter_ACU,
): AgentKernelTokenCounter_ACU {
  const cache = new Map<string, number>();
  return async (text: string) => {
    const key = String(text ?? '');
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const measured = await count(key);
    cache.set(key, measured);
    return measured;
  };
}

/** Measures message content only; transport framing remains the caller's responsibility. */
export async function measureAgentKernelTextItems_ACU(
  items: readonly { content: string }[],
  count: AgentKernelTokenCounter_ACU,
): Promise<number> {
  let total = 0;
  for (const item of items) total += await count(String(item.content ?? ''));
  return total;
}
