import { describe, expect, it } from 'vitest';
import { buildWorldRunMaterials_ACU, sameWorldRunMaterials_ACU } from '../../../src/service/simulation/world-run-materials';
import type { AgentWorldbookSnapshot_ACU } from '../../../src/service/continuation/agent/agent-worldbook-read';

function snapshot(entries: AgentWorldbookSnapshot_ACU['entries'] = []): AgentWorldbookSnapshot_ACU {
  return { available: true, entries };
}
function entry(uid: string, changes: Partial<AgentWorldbookSnapshot_ACU['entries'][number]> = {}): AgentWorldbookSnapshot_ACU['entries'][number] {
  return { bookName: '设定集', uid, title: `标题-${uid}`, keys: [`关键词-${uid}`], constant: false,
    content: `机密正文-${uid}`, tokens: 7, ...changes };
}
function input(changes: Record<string, unknown> = {}) {
  return { instruction: '第一次指令：寻找线索', userRequirements: { schemaVersion: 1 as const, requirements: ['保持第一人称'], updatedAt: 5 },
    worldbookSnapshot: snapshot([entry('2'), entry('1')]), ...changes };
}

describe('世界推演运行资料指纹', () => {
  it('世界书输入顺序无关，返回哈希且不泄露正文', () => {
    const first = buildWorldRunMaterials_ACU(input());
    const reversed = buildWorldRunMaterials_ACU(input({ worldbookSnapshot: snapshot([entry('1'), entry('2')]) }));
    expect(first).toEqual(reversed);
    expect(first).toMatchObject({ schemaVersion: 1, instructionHash: expect.stringMatching(/^[0-9a-f]{64}$/), requirementsHash: expect.stringMatching(/^[0-9a-f]{64}$/), worldbookHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(Object.keys(first).sort()).toEqual(['instructionHash', 'promptsHash', 'requirementsHash', 'schemaVersion', 'worldbookHash']);
    expect(JSON.stringify(first)).not.toContain('机密正文');
    expect(JSON.stringify(first)).not.toContain('保持第一人称');
  });

  it('正文同长度改动、增删和启用可见规则变化都会改变世界书指纹', () => {
    const base = buildWorldRunMaterials_ACU(input());
    expect(buildWorldRunMaterials_ACU(input({ worldbookSnapshot: snapshot([entry('2', { content: '机密正又-2' }), entry('1')]) })).worldbookHash).not.toBe(base.worldbookHash);
    expect(buildWorldRunMaterials_ACU(input({ worldbookSnapshot: snapshot([entry('1')]) })).worldbookHash).not.toBe(base.worldbookHash);
    expect(buildWorldRunMaterials_ACU(input({ worldbookSnapshot: snapshot([entry('2'), entry('1', { constant: true })]) })).worldbookHash).not.toBe(base.worldbookHash);
    expect(buildWorldRunMaterials_ACU(input({ worldbookSnapshot: snapshot([entry('2'), entry('1', { keys: ['不同关键词'] })]) })).worldbookHash).not.toBe(base.worldbookHash);
    expect(buildWorldRunMaterials_ACU(input({ worldbookSnapshot: snapshot([entry('2'), entry('1', { preventRecursion: true })]) })).worldbookHash).not.toBe(base.worldbookHash);
  });

  it('要求、更新时间和首次即时指令变化都会改变对应指纹', () => {
    const base = buildWorldRunMaterials_ACU(input());
    expect(buildWorldRunMaterials_ACU(input({ userRequirements: { schemaVersion: 1, requirements: ['改要求'], updatedAt: 5 } })).requirementsHash).not.toBe(base.requirementsHash);
    expect(buildWorldRunMaterials_ACU(input({ userRequirements: { schemaVersion: 1, requirements: ['保持第一人称'], updatedAt: 6 } })).requirementsHash).not.toBe(base.requirementsHash);
    expect(buildWorldRunMaterials_ACU(input({ instruction: '继续' })).instructionHash).not.toBe(base.instructionHash);
    expect(buildWorldRunMaterials_ACU({ instruction: '第一次指令：寻找线索', worldbookSnapshot: snapshot() }).requirementsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(buildWorldRunMaterials_ACU(input()).worldbookHash).toBe(buildWorldRunMaterials_ACU(input({ worldbookSnapshot: snapshot([entry('2', { tokens: 0 }), entry('1')]) })).worldbookHash);
  });

  it('不可用、重复、未知坏结构与无效要求一律拒绝', () => {
    expect(() => buildWorldRunMaterials_ACU(input({ worldbookSnapshot: { available: false, entries: [] } }))).toThrow();
    expect(() => buildWorldRunMaterials_ACU(input({ worldbookSnapshot: snapshot([entry('1'), entry('1')]) }))).toThrow();
    expect(() => buildWorldRunMaterials_ACU(input({ worldbookSnapshot: { available: true, entries: [entry('1')], injected: true } }))).toThrow();
    expect(() => buildWorldRunMaterials_ACU(input({ worldbookSnapshot: snapshot([{ ...entry('1'), unknown: true } as never]) }))).toThrow();
    expect(() => buildWorldRunMaterials_ACU(input({ userRequirements: { schemaVersion: 1, requirements: [''], updatedAt: 1 } }))).toThrow();
  });

  it('实际启用提示词（含派生默认）、模式和投送目标纳入资料指纹；显式关闭不同于缺失', () => {
    const segment = { role: 'system', content: '用户尚在逐个编写的时钟业务要求', enabled: true, deletable: true, pinned: false };
    const first = buildWorldRunMaterials_ACU(input({ worldRoundPrompts: { 'clock-recaller': [segment] }, workflowMode: 'layered', deliveryTarget: 'body' }));
    expect(first.promptsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toContain(segment.content);
    const changed = buildWorldRunMaterials_ACU(input({ worldRoundPrompts: { 'clock-recaller': [{ ...segment, content: '另一份业务要求' }] }, workflowMode: 'layered', deliveryTarget: 'body' }));
    expect(sameWorldRunMaterials_ACU(first, changed)).toBe(false);
    expect(sameWorldRunMaterials_ACU(first, buildWorldRunMaterials_ACU(input({ workflowMode: 'layered', deliveryTarget: 'body' })))).toBe(false);
    const missing = buildWorldRunMaterials_ACU(input({ workflowMode: 'layered', deliveryTarget: 'body' }));
    const explicitEmpty = buildWorldRunMaterials_ACU(input({ worldRoundPrompts: { 'clock-recaller': [] }, workflowMode: 'layered', deliveryTarget: 'body' }));
    expect(sameWorldRunMaterials_ACU(missing, explicitEmpty)).toBe(false);
    expect(sameWorldRunMaterials_ACU(missing, buildWorldRunMaterials_ACU(input({ workflowMode: 'single', deliveryTarget: 'body' })))).toBe(false);
    expect(sameWorldRunMaterials_ACU(missing, buildWorldRunMaterials_ACU(input({ workflowMode: 'layered', deliveryTarget: 'plot' })))).toBe(false);
    const legacySegment = { role: 'system', content: '旧场景审查', enabled: true, deletable: true, pinned: false };
    const legacyReview = buildWorldRunMaterials_ACU(input({
      workflowMode: 'layered', deliveryTarget: 'body',
      worldRoundPrompts: { 'scene-review': [legacySegment], 'adoption-review': [{ ...legacySegment, content: '旧正文采用' }] },
    }));
    expect(sameWorldRunMaterials_ACU(missing, legacyReview)).toBe(true);
    expect(() => buildWorldRunMaterials_ACU(input({ worldRoundPrompts: { unknown: [segment] } }))).toThrow();
  });

  it('比较要求完整 v1 结构与合法哈希，不默许额外字段或坏哈希', () => {
    const value = buildWorldRunMaterials_ACU(input());
    expect(sameWorldRunMaterials_ACU(value, { ...value })).toBe(true);
    expect(sameWorldRunMaterials_ACU(value, { ...value, instructionHash: 'f'.repeat(63) } as never)).toBe(false);
    expect(sameWorldRunMaterials_ACU(value, { ...value, extra: true } as never)).toBe(false);
    expect(sameWorldRunMaterials_ACU(value, { ...value, schemaVersion: 2 } as never)).toBe(false);
  });
});
