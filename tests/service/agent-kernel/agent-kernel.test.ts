import { describe, expect, it, vi } from 'vitest';
import { buildAgentKernelPromptCacheKey_ACU, executeAgentKernelRequest_ACU, retryAgentKernelRequest_ACU } from '../../../src/service/agent-kernel/internal-ai-call';
import { extractAgentKernelJsonObjects_ACU, selectAgentKernelJsonPayload_ACU } from '../../../src/service/agent-kernel/json-payload';
import { decideAgentKernelReadBatch_ACU, resolveAgentKernelReadBudget_ACU } from '../../../src/service/agent-kernel/read-gate';
import { createAgentKernelTokenCounter_ACU, measureAgentKernelTextItems_ACU } from '../../../src/service/agent-kernel/token-budget';

const count = async (text: string) => text.length;
const config = { historyTokenBudget: 100, readTokenBudget: '50%', fallbackTokens: 20, defaultHistoryTokenBudget: 200, defaultFallbackTokens: 30 };

describe('agent kernel primitives', () => {
  it('isolates cache routes without exposing inputs and settles lifecycle callbacks', async () => {
    const identity = { requestId: 'r1', chatIdentity: 'chat/secret', source: 'main' };
    const route = { namespace: 'acu-agent-v1', apiMode: 'custom', model: 'model-a', url: 'https://example.invalid' };
    const first = buildAgentKernelPromptCacheKey_ACU(identity, route);
    expect(first).toMatch(/^acu-agent-v1-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);
    expect(first).not.toContain(identity.chatIdentity);
    expect(first).not.toContain(route.url);
    expect(buildAgentKernelPromptCacheKey_ACU(identity, { ...route, model: 'model-b' })).not.toBe(first);
    const calls: string[] = [];
    await expect(executeAgentKernelRequest_ACU({ before: () => calls.push('before'), invoke: async () => 'ok', after: () => calls.push('after'), settle: () => calls.push('settle') })).resolves.toBe('ok');
    expect(calls).toEqual(['before', 'after', 'settle']);
  });

  it('retries only eligible failures and checks freshness after waiting', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('ok');
    await expect(retryAgentKernelRequest_ACU(invoke, { retries: 1, delayMs: 0, wait: async () => {}, shouldRetry: () => true })).resolves.toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(2);
    const stale = vi.fn().mockRejectedValue(new Error('network'));
    await expect(retryAgentKernelRequest_ACU(stale, { retries: 1, delayMs: 0, wait: async () => {}, shouldRetry: () => true, isCurrent: () => false })).rejects.toThrow('network');
    expect(stale).toHaveBeenCalledOnce();
  });

  it('preserves token, read-gate, and JSON framing behavior', async () => {
    const raw = vi.fn(count);
    const memo = createAgentKernelTokenCounter_ACU(raw);
    expect(await memo('same')).toBe(4);
    expect(await memo('same')).toBe(4);
    expect(raw).toHaveBeenCalledOnce();
    expect(await measureAgentKernelTextItems_ACU([{ content: 'ab' }, { content: 'c' }], count)).toBe(3);
    expect(resolveAgentKernelReadBudget_ACU(config)).toMatchObject({ effectiveMaxReadTokens: 50, effectiveFallbackTokens: 20 });
    await expect(decideAgentKernelReadBatch_ACU(['x'.repeat(51)], config, 0, count)).resolves.toMatchObject({ allowed: false, reason: 'read-batch-too-large' });
    await expect(decideAgentKernelReadBatch_ACU(['x'.repeat(21)], config, 90, count)).resolves.toMatchObject({ allowed: false, reason: 'near-compaction-overflow' });
    const objects = extractAgentKernelJsonObjects_ACU('note {"x":"{safe}"} {"action":"go"}');
    expect(objects).toHaveLength(2);
    expect(selectAgentKernelJsonPayload_ACU('"action":"go"}', '{"thought":"x",', ['action'], JSON.parse)).toMatchObject({ action: 'go' });
  });
});