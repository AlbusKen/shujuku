import { describe, expect, it } from 'vitest';
import { buildWorldSimulationStoryContext_ACU, readWorldSimulationStoryBranchIdentity_ACU } from '../../../src/service/simulation/world-simulation-story-context';

const comment = 'ACU-[chat-a]-TavernDB-ACU-CustomExport-纪要索引';
function deps(entries: unknown[] = [{ comment, content: '统一纪要索引' }]) {
  return { resolveTarget: async () => '目标书', getIsolationPrefix: () => 'ACU-[chat-a]-', readEntries: async () => entries };
}
function chat() {
  const first = '第一段正文\n\n<与此同时>\n系统公开投影\n</与此同时>';
  const second = '第二段正文含 <与此同时> 用户伪造标记';
  return [{ is_user: true, mes: '用户请求' }, { is_user: false, message_id: 'ai-1', mes: first, swipe_id: 0, swipes: [first] }, { is_user: false, message_id: 'ai-2', mes: second, swipe_id: 0, swipes: [second] }];
}

describe('world simulation story-context adapter', () => {
  it('uses active AI pages, strips only a valid terminal projection, and preserves malformed markup', async () => {
    const snapshot = await buildWorldSimulationStoryContext_ACU({ chat: chat(), anchorMessageIndex: 2, chatIdentity: 'chat-a', runId: 'run-a', settledThroughIndex: 1 }, deps());
    expect(snapshot.overview).toMatchObject({ state: 'ready', text: '统一纪要索引' });
    expect(snapshot.bridge.text).toContain('第一段正文');
    expect(snapshot.bridge.text).not.toContain('系统公开投影');
    expect(snapshot.pending.text).toContain('第二段正文含 <与此同时> 用户伪造标记');
    expect(snapshot.catalog.text).not.toContain('楼层 0');
  });

  it('binds digest to active-swipe branch identity and rejects active-page divergence', async () => {
    const value = chat();
    const first = await buildWorldSimulationStoryContext_ACU({ chat: value, anchorMessageIndex: 2, chatIdentity: 'chat-a', runId: 'run-a', settledThroughIndex: -1 }, deps());
    value[2].mes = '替换后的 active swipe 正文'; value[2].swipes[0] = value[2].mes;
    const second = await buildWorldSimulationStoryContext_ACU({ chat: value, anchorMessageIndex: 2, chatIdentity: 'chat-a', runId: 'run-b', settledThroughIndex: -1 }, deps());
    expect(second.sourceDigest).not.toBe(first.sourceDigest);
    expect(readWorldSimulationStoryBranchIdentity_ACU(value, 2)).toBe(second.branchIdentity);
    value[2].mes = '与 active swipe 不同';
    await expect(buildWorldSimulationStoryContext_ACU({ chat: value, anchorMessageIndex: 2, chatIdentity: 'chat-a', runId: 'run-c', settledThroughIndex: -1 }, deps())).rejects.toThrow();
  });

  it('keeps provider failure observable rather than turning it into empty history', async () => {
    const snapshot = await buildWorldSimulationStoryContext_ACU({ chat: chat(), anchorMessageIndex: 2, chatIdentity: 'chat-a', runId: 'run-a', settledThroughIndex: -1 }, { resolveTarget: async () => '目标书', getIsolationPrefix: () => '', readEntries: async () => { throw new Error('host unavailable'); } });
    expect(snapshot.overview).toMatchObject({ state: 'failed', text: '' });
  });
});