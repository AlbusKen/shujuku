import { describe, expect, it } from 'vitest';

import { renderWorldSimulationRequirementsRetryHint_ACU } from '../../../src/service/simulation/simulation-requirements-replacement';

const source = 'world-simulation-user:1:message-key:0:chat-a';

describe('世界推演 requirements rejection 提示', () => {
  it('唯一候选的回灌提示逐字给出可复制的权威 id', () => {
    expect(renderWorldSimulationRequirementsRetryHint_ACU([source])).toContain(JSON.stringify(source));
    expect(renderWorldSimulationRequirementsRetryHint_ACU([source, 'other'])).toContain('仍待吸收');
  });
});
