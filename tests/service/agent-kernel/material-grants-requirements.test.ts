import { describe, expect, it } from 'vitest';
import { parseAgentMaterialGrantTable_ACU, resolveAgentMaterialGrants_ACU } from '../../../src/service/agent-kernel/material-grants';
import { parseAgentRequirementSnapshot_ACU, parseAgentRequirementsReplacement_ACU } from '../../../src/service/agent-kernel/requirements';

const grant = { grantId: 'W1', source: { address: '$WORLDBOOK:main:1', revision: 'r1', digest: 'd1' }, content: '正文' };
const requirement = { id: 'R1', category: 'goal', priority: 'hard', text: '保持一致', sourceRefs: ['u1'] };

describe('agent kernel material grants and requirements', () => {
  it('strictly parses namespaced grants and rejects duplicate or unknown grants', () => {
    const table = parseAgentMaterialGrantTable_ACU({ feature: 'continuation', runId: 'run-a', grants: [grant] });
    expect(resolveAgentMaterialGrants_ACU(table, 'continuation', 'run-a', ['W1'])).toMatchObject({ kind: 'accepted', grants: [grant] });
    expect(resolveAgentMaterialGrants_ACU(table, 'world-simulation', 'run-a', ['W1'])).toMatchObject({ kind: 'rejected', reason: 'scope-mismatch' });
    expect(resolveAgentMaterialGrants_ACU(table, 'continuation', 'run-a', ['W1', 'W1'])).toMatchObject({ kind: 'rejected', reason: 'unknown-grant' });
    expect(() => parseAgentMaterialGrantTable_ACU({ feature: 'continuation', runId: 'run-a', grants: [grant, grant] })).toThrow('重复 grantId');
    expect(() => parseAgentMaterialGrantTable_ACU({ feature: 'other', runId: 'run-a', grants: [grant] })).toThrow('feature 非法');
    expect(() => parseAgentMaterialGrantTable_ACU({ feature: 'continuation', runId: 'run-a', grants: [{ ...grant, source: { ...grant.source, digest: '' } }] })).toThrow('非空字符串');
    expect(() => parseAgentMaterialGrantTable_ACU({ feature: 'continuation', runId: 'run-a', grants: [], extra: true })).toThrow('未知或缺失字段');
  });

  it('preserves an empty current requirement set but rejects forged source references and mixed shapes', () => {
    expect(parseAgentRequirementSnapshot_ACU({ feature: 'world-simulation', revision: 0, lastAppliedUserMessageId: null, requirements: [] })).toMatchObject({ requirements: [] });
    expect(parseAgentRequirementsReplacement_ACU({ action: 'maintain_requirements', thought: '更新', expectedRevision: 0, appliedUserMessageId: 'u1', requirements: [requirement], summary: 'ok' }, ['u1'])).toMatchObject({ requirements: [requirement] });
    expect(() => parseAgentRequirementsReplacement_ACU({ action: 'maintain_requirements', thought: '更新', expectedRevision: 0, appliedUserMessageId: 'u2', requirements: [requirement], summary: 'ok' }, ['u1'])).toThrow('不存在的用户输入');
    expect(() => parseAgentRequirementsReplacement_ACU({ action: 'maintain_requirements', thought: 1, expectedRevision: 0, appliedUserMessageId: 'u1', requirements: [requirement], summary: 'ok' }, ['u1'])).toThrow('thought 必须是非空字符串');
    expect(() => parseAgentRequirementsReplacement_ACU({ action: 'maintain_requirements', thought: '更新', expectedRevision: 0, appliedUserMessageId: 'u1', requirements: [{ ...requirement, sourceRefs: ['u1', 'u1'] }], summary: 'ok' }, ['u1'])).toThrow('不允许重复');
    expect(() => parseAgentRequirementsReplacement_ACU({ action: 'maintain_requirements', thought: '更新', expectedRevision: 0, appliedUserMessageId: 'u1', requirements: [{ ...requirement, sourceRefs: [{ messageId: 'u1' }] }], summary: 'ok' }, ['u1'])).toThrow('必须是非空字符串');
    expect(() => parseAgentRequirementSnapshot_ACU({ feature: 'world-simulation', revision: 0, lastAppliedUserMessageId: null, requirements: [requirement], historical: [] })).toThrow('未知或缺失字段');
  });

  it('reads only the known legacy source-ref object shape into string refs without changing its input', () => {
    const legacy: any = {
      feature: 'continuation', revision: 0, lastAppliedUserMessageId: 'u1',
      requirements: [{ ...requirement, sourceRefs: [{ kind: 'user_message', messageId: 'u1' }] }],
    };
    expect(parseAgentRequirementSnapshot_ACU(legacy)).toMatchObject({ requirements: [{ sourceRefs: ['u1'] }] });
    expect(legacy.requirements[0].sourceRefs).toEqual([{ kind: 'user_message', messageId: 'u1' }]);
    expect(parseAgentRequirementSnapshot_ACU({ ...legacy, requirements: [{ ...legacy.requirements[0], sourceRefs: [{ kind: 'system', messageId: 'u1', future: true }] }] })).toMatchObject({ requirements: [{ sourceRefs: ['u1'] }] });
    expect(() => parseAgentRequirementSnapshot_ACU({ ...legacy, requirements: [{ ...legacy.requirements[0], sourceRefs: [{ kind: 'system' }] }] })).toThrow('必须是非空字符串');
  });
});