import { describe, expect, it } from 'vitest';
import { createEmptyAgentRequirementSnapshot_ACU, replaceAgentRequirementsSnapshot_ACU } from '../../../src/service/agent-kernel/requirements-store';

const replacement = (patch: Record<string, unknown> = {}) => ({
  action: 'maintain_requirements', thought: '同步最新要求', expectedRevision: 0, appliedUserMessageId: 'continuation-user:1',
  requirements: [{ id: 'R1', category: 'goal', priority: 'hard', text: '保持第一人称', sourceRefs: ['continuation-user:1'] }], summary: '已同步',
  ...patch,
});

describe('agent requirements replacement state machine', () => {
  it('replaces the complete current set and advances only after matching revision', () => {
    const first = replaceAgentRequirementsSnapshot_ACU(null, 'continuation', replacement(), ['continuation-user:1']);
    expect(first).toMatchObject({ feature: 'continuation', revision: 1, lastAppliedUserMessageId: 'continuation-user:1', requirements: [{ id: 'R1' }] });
    const second = replaceAgentRequirementsSnapshot_ACU(first, 'continuation', replacement({ expectedRevision: 1, requirements: [] }), ['continuation-user:1']);
    expect(second).toMatchObject({ revision: 2, requirements: [] });
  });

  it('uses a legacy object-ref snapshot only as an in-memory base and writes the next replacement as string refs', () => {
    const legacy: any = {
      feature: 'continuation', revision: 0, lastAppliedUserMessageId: 'continuation-user:1',
      requirements: [{ id: 'R0', category: 'goal', priority: 'hard', text: '旧要求', sourceRefs: [{ kind: 'user_message', messageId: 'continuation-user:1' }] }],
    };

    const next = replaceAgentRequirementsSnapshot_ACU(legacy, 'continuation', replacement(), ['continuation-user:1']);

    expect(next).toMatchObject({ revision: 1, requirements: [{ id: 'R1', sourceRefs: ['continuation-user:1'] }] });
    expect(legacy.requirements[0].sourceRefs).toEqual([{ kind: 'user_message', messageId: 'continuation-user:1' }]);
  });

  it('fails closed for stale revisions, forged sources, and feature mismatch', () => {
    const current = createEmptyAgentRequirementSnapshot_ACU('world-simulation');
    expect(() => replaceAgentRequirementsSnapshot_ACU(current, 'world-simulation', replacement(), ['world-simulation-user:1'])).toThrow('不存在的用户输入');
    expect(() => replaceAgentRequirementsSnapshot_ACU({ ...current, revision: 1 }, 'world-simulation', replacement({ expectedRevision: 0, appliedUserMessageId: 'world-simulation-user:1', requirements: [] }), ['world-simulation-user:1'])).toThrow('revision 已变化');
    expect(() => replaceAgentRequirementsSnapshot_ACU(current, 'continuation', replacement({ requirements: [] }), ['continuation-user:1'])).toThrow('feature 不匹配');
  });
});