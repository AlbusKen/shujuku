import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginWorldSimulationInternalAiMainApiInvocation_ACU,
  beginWorldSimulationInternalAiRequest_ACU,
  bindWorldSimulationInternalAiGenerationStarted_ACU,
  cancelWorldSimulationInternalAiRequest_ACU,
  consumeWorldSimulationInternalAiGenerationEnded_ACU,
  consumeUnattributedWorldSimulationInternalAiEnded_ACU,
  discardUnattributedWorldSimulationInternalAiRequests_ACU,
  endWorldSimulationInternalAiMainApiInvocation_ACU,
  hasActiveWorldSimulationInternalAiMainApiInvocation_ACU,
  resetWorldSimulationInternalAiEventRegistryForTests_ACU,
  settleWorldSimulationInternalAiRequest_ACU,
} from '../../../src/service/simulation/simulation-internal-ai-events';

function identity(requestId: string, source = 'world-sim-gate') {
  return { requestId, chatIdentity: 'chat-a', source };
}

function open(requestId: string, source?: string): void {
  beginWorldSimulationInternalAiRequest_ACU(identity(requestId, source));
  beginWorldSimulationInternalAiMainApiInvocation_ACU(requestId);
}

describe('world simulation internal AI event registry', () => {
  beforeEach(() => {
    resetWorldSimulationInternalAiEventRegistryForTests_ACU();
    vi.useRealTimers();
  });

  it('rejects a malformed identity and a duplicate request id', () => {
    expect(() => beginWorldSimulationInternalAiRequest_ACU(identity('  '))).toThrow();
    expect(() => beginWorldSimulationInternalAiRequest_ACU({ requestId: 'r1', chatIdentity: '', source: 's' })).toThrow();
    open('r1');
    expect(() => beginWorldSimulationInternalAiRequest_ACU(identity('r1'))).toThrow();
  });

  it('binds one host start only inside the synchronous main-API window', () => {
    beginWorldSimulationInternalAiRequest_ACU(identity('r1'));
    // Not yet inside the transport: a start event must stay unattributed.
    expect(bindWorldSimulationInternalAiGenerationStarted_ACU(1)).toBeNull();
    beginWorldSimulationInternalAiMainApiInvocation_ACU('r1');
    expect(bindWorldSimulationInternalAiGenerationStarted_ACU(1)).toMatchObject({ requestId: 'r1' });
    // A bound request is never re-bound to a later sequence.
    expect(bindWorldSimulationInternalAiGenerationStarted_ACU(2)).toBeNull();
    endWorldSimulationInternalAiMainApiInvocation_ACU('r1');
    expect(consumeWorldSimulationInternalAiGenerationEnded_ACU(1)).toMatchObject({ requestId: 'r1' });
  });

  it('refuses to attribute when two requests are open at the same time', () => {
    open('r1');
    open('r2', 'world-sim-rebase');
    // The host omits request ids, so nested invocations stay ambiguous and unclaimed.
    expect(bindWorldSimulationInternalAiGenerationStarted_ACU(7)).toBeNull();
    expect(consumeWorldSimulationInternalAiGenerationEnded_ACU(7)).toBeNull();
  });

  it('consumes the bound identity by generation sequence exactly once', () => {
    open('r1');
    bindWorldSimulationInternalAiGenerationStarted_ACU(9);
    // An attributed result survives settle so a late GENERATION_ENDED can still match it.
    settleWorldSimulationInternalAiRequest_ACU('r1');
    expect(consumeWorldSimulationInternalAiGenerationEnded_ACU(9)).toMatchObject({ requestId: 'r1' });
    expect(consumeWorldSimulationInternalAiGenerationEnded_ACU(9)).toBeNull();
    expect(bindWorldSimulationInternalAiGenerationStarted_ACU(10)).toBeNull();
  });

  it('drops an unattributed result instead of keeping it for late-event guessing', () => {
    open('r1');
    settleWorldSimulationInternalAiRequest_ACU('r1');
    expect(bindWorldSimulationInternalAiGenerationStarted_ACU(3)).toBeNull();
    expect(consumeWorldSimulationInternalAiGenerationEnded_ACU(3)).toBeNull();
  });

  it('purges an expired request before it can claim a start', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    open('r1');
    vi.setSystemTime(1_000 + 60_001);
    expect(bindWorldSimulationInternalAiGenerationStarted_ACU(5)).toBeNull();
    vi.useRealTimers();
  });

  it('cancels a request so a later start cannot claim it', () => {
    open('r1');
    cancelWorldSimulationInternalAiRequest_ACU('r1');
    expect(bindWorldSimulationInternalAiGenerationStarted_ACU(4)).toBeNull();
  });

  it('reports an open main-API window so unattributable ends can fail closed', () => {
    expect(hasActiveWorldSimulationInternalAiMainApiInvocation_ACU()).toBe(false);
    beginWorldSimulationInternalAiRequest_ACU(identity('r1'));
    // Not yet inside the transport: a stray end cannot have come from this request.
    expect(hasActiveWorldSimulationInternalAiMainApiInvocation_ACU()).toBe(false);
    beginWorldSimulationInternalAiMainApiInvocation_ACU('r1');
    expect(hasActiveWorldSimulationInternalAiMainApiInvocation_ACU()).toBe(true);
    endWorldSimulationInternalAiMainApiInvocation_ACU('r1');
    expect(hasActiveWorldSimulationInternalAiMainApiInvocation_ACU()).toBe(false);
  });

  it('keeps one entered-but-unbound request claimable so a late end still fails closed', () => {
    open('r1');
    // afterMainApiCall closes the synchronous window before the response resolves.
    endWorldSimulationInternalAiMainApiInvocation_ACU('r1');
    settleWorldSimulationInternalAiRequest_ACU('r1');
    expect(hasActiveWorldSimulationInternalAiMainApiInvocation_ACU()).toBe(false);
    // The residual record is consumed exactly once by the fail-closed backstop.
    expect(consumeUnattributedWorldSimulationInternalAiEnded_ACU()).toMatchObject({ requestId: 'r1' });
    expect(consumeUnattributedWorldSimulationInternalAiEnded_ACU()).toBeNull();
  });

  it('never keeps a request that never entered the transport', () => {
    beginWorldSimulationInternalAiRequest_ACU(identity('r1'));
    settleWorldSimulationInternalAiRequest_ACU('r1');
    expect(consumeUnattributedWorldSimulationInternalAiEnded_ACU()).toBeNull();
  });

  it('prefers sequence attribution over the unattributed backstop', () => {
    open('r1');
    bindWorldSimulationInternalAiGenerationStarted_ACU(11);
    endWorldSimulationInternalAiMainApiInvocation_ACU('r1');
    settleWorldSimulationInternalAiRequest_ACU('r1');
    // A bound request is consumed by seq; it must not be double-consumed by the backstop.
    expect(consumeWorldSimulationInternalAiGenerationEnded_ACU(11)).toMatchObject({ requestId: 'r1' });
    expect(consumeUnattributedWorldSimulationInternalAiEnded_ACU()).toBeNull();
  });

  it('drops entered-but-unbound claims once the host generation was stopped', () => {
    open('r1');
    endWorldSimulationInternalAiMainApiInvocation_ACU('r1');
    settleWorldSimulationInternalAiRequest_ACU('r1');
    // A stopped generation never delivers GENERATION_ENDED, so the residual claim must be dropped
    // now instead of lingering for one TTL and swallowing an unrelated user floor.
    expect(discardUnattributedWorldSimulationInternalAiRequests_ACU()).toBe(1);
    expect(consumeUnattributedWorldSimulationInternalAiEnded_ACU()).toBeNull();

    // A seq-bound request is owned by the exact-attribution path and must survive the sweep.
    open('r2');
    bindWorldSimulationInternalAiGenerationStarted_ACU(21);
    endWorldSimulationInternalAiMainApiInvocation_ACU('r2');
    settleWorldSimulationInternalAiRequest_ACU('r2');
    expect(discardUnattributedWorldSimulationInternalAiRequests_ACU()).toBe(0);
    expect(consumeWorldSimulationInternalAiGenerationEnded_ACU(21)).toMatchObject({ requestId: 'r2' });
  });
});
