import { describe, expect, it } from 'vitest';
import { buildAgentStoryContextSnapshot_ACU } from '../../../src/service/agent-kernel/story-context';

const input = (patch: Record<string, unknown> = {}) => ({
  feature: 'continuation' as const, runId: 'run-1', chatIdentity: 'chat-1', branchIdentity: 'branch-1', sourceRevision: 'rev-1', profile: 'main' as const,
  overview: { state: 'ready' as const, text: '纪要索引', digest: 'overview-1', diagnostic: '' },
  settledThroughIndex: 3, bridgeFloorCount: 2,
  floors: [{ index: 1, text: '已结算一' }, { index: 3, text: '已结算三' }, { index: 5, text: '待结算五' }, { index: 8, text: '待结算八' }],
  ...patch,
});

describe('shared agent story-context builder', () => {
  it('keeps every unsettled AI floor, excludes it from bridge, and binds all materials to one digest', () => {
    const snapshot = buildAgentStoryContextSnapshot_ACU(input());
    expect(snapshot.pending.text).toContain('【楼层 5】\n待结算五');
    expect(snapshot.pending.text).toContain('【楼层 8】\n待结算八');
    expect(snapshot.bridge.text).toContain('【楼层 1】');
    expect(snapshot.bridge.text).toContain('【楼层 3】');
    expect(snapshot.bridge.text).not.toContain('待结算五');
    expect(snapshot.catalog.text).toContain('楼层 8');
    expect(snapshot.sourceDigest).toMatch(/^fnv1a-[0-9a-f]{8}$/);
  });

  it('changes the source digest when branch facts or overview revision change', () => {
    const base = buildAgentStoryContextSnapshot_ACU(input());
    expect(buildAgentStoryContextSnapshot_ACU(input({ floors: [{ index: 1, text: '已结算一' }, { index: 3, text: '已结算三' }, { index: 5, text: '用户编辑后正文' }] })).sourceDigest).not.toBe(base.sourceDigest);
    expect(buildAgentStoryContextSnapshot_ACU(input({ overview: { state: 'ready', text: '交火覆盖索引', digest: 'overview-2', diagnostic: '' } })).sourceDigest).not.toBe(base.sourceDigest);
  });

  it('fails closed for unordered, duplicate, empty, or malformed source floors', () => {
    expect(() => buildAgentStoryContextSnapshot_ACU(input({ floors: [{ index: 3, text: 'x' }, { index: 2, text: 'y' }] }))).toThrow('唯一递增');
    expect(() => buildAgentStoryContextSnapshot_ACU(input({ floors: [{ index: 1, text: 'x' }, { index: 1, text: 'y' }] }))).toThrow('唯一递增');
    expect(() => buildAgentStoryContextSnapshot_ACU(input({ floors: [{ index: 1, text: '  ' }] }))).toThrow('唯一递增');
    expect(() => buildAgentStoryContextSnapshot_ACU(input({ settledThroughIndex: -2 }))).toThrow('结算水位');
  });
});