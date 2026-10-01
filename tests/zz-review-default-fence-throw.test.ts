import { describe, expect, it } from 'vitest';
import { allocateAgentDefaultReadFences_ACU } from '../src/service/continuation/agent/agent-default-fence';

describe('scratch: bad count callback escapes as unstructured throw', () => {
  it('throws raw Error instead of structured failed result when count returns -1 (pre-try full measurement)', async () => {
    const candidates = [
      { key: 'addr-1', title: 't1', text: 'hello world' },
    ];
    const call = allocateAgentDefaultReadFences_ACU({
      candidates,
      budgetTokens: 100,
      reservedTokens: 0,
      axis: () => null,
      resolve: () => ({ title: 't1', text: 'hello world' }),
      count: async () => -1,
    });
    await expect(call).rejects.toThrow('READ_FENCE_CAPACITY_INVALID');
  });

  it('throws raw Error (not AgentDefaultFenceProofError_ACU) from narrowed() measure() inside try, not converted to structured failure', async () => {
    // Force the narrowing path: full text exceeds budget so we go into try block and call narrowed().
    const candidates = [
      { key: 'addr-1', title: 't1', text: 'x'.repeat(1000) },
    ];
    let callCount = 0;
    const call = allocateAgentDefaultReadFences_ACU({
      candidates,
      budgetTokens: 50,
      reservedTokens: 0,
      axis: (key) => (key === 'addr-1' ? { length: 10, addressAt: (upper: number) => `addr-1@${upper}`, remainderAfter: () => null } : null),
      resolve: () => ({ title: 't1', text: 'y', proof: { stableAddress: 'addr-1@0', completeWithinFence: true, resolvedFence: {}, revision: 1 } as any }),
      count: async (text: string) => {
        callCount += 1;
        // First call measures full text (>budget) at top-level pre-try; subsequent calls are inside narrowed().
        if (callCount === 1) return 2000; // full text way over budget -> forces try block
        return -5; // bad value on the narrowed-path measurement -> should surface as structured failure, not raw throw
      },
    });
    await expect(call).rejects.toThrow('READ_FENCE_CAPACITY_INVALID');
  });
});
