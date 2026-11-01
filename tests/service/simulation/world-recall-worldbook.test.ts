import { describe, expect, it } from 'vitest';
import { selectWorldRecallWorldbookRefs_ACU } from '../../../src/service/simulation/world-recall-worldbook';
import type { AgentWorldbookEntryView_ACU } from '../../../src/service/continuation/agent/agent-worldbook-read';

function entry(uid: string, constant: boolean, keys: string[], content: string): AgentWorldbookEntryView_ACU {
  return { uid, bookName: '设定书', title: `条目${uid}`, keys, constant, content, tokens: content.length };
}

describe('格林召回的世界书触发地址', () => {
  it('复用常开、关键词和允许递归的触发规则，但只返回条目身份', () => {
    const entries = [entry('always', true, [], '赤塔'), entry('child', false, ['赤塔'], '城门公告'),
      entry('deep', false, ['城门公告'], '不应出现在目录里的秘密正文'), entry('unrelated', false, ['别处'], '不相关')];
    const snapshot = { available: true, entries };
    const refs = selectWorldRecallWorldbookRefs_ACU(snapshot, '主角在街道', 2);
    expect(refs.triggered).toEqual([{ bookName: '设定书', uid: 'always' }, { bookName: '设定书', uid: 'child' }]);
    expect(refs.deferred).toEqual([{ bookName: '设定书', uid: 'deep', reason: 'budget' }]);
    expect(JSON.stringify(refs)).not.toContain('秘密正文');
    expect(JSON.stringify(refs)).not.toContain('unrelated');
    expect(snapshot.entries).toEqual(entries);
  });

  it('快照不可用时不伪称未命中；容量设置非法拒绝', () => {
    expect(selectWorldRecallWorldbookRefs_ACU({ available: false, entries: [] }, '赤塔', 3))
      .toEqual({ available: false, triggered: [], deferred: [] });
    expect(() => selectWorldRecallWorldbookRefs_ACU({ available: true, entries: [] }, '', 0)).toThrow(/1..64/);
  });
});
