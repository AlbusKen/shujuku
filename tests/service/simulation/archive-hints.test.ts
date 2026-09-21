import { describe, expect, it } from 'vitest';
import { buildArchiveHints_ACU } from '../../../src/service/simulation/archive-hints';
import { eventFingerprint_ACU } from '../../../src/service/simulation/event-similarity';

const overview = [
  {
    fingerprint: eventFingerprint_ACU('北岭矿洞塌方', '第三日', ['seed-mine']),
    day: 3,
    oneLine: '北岭矿洞塌方压伤三人',
    archiveRef: 'arc-mine',
  },
];

describe('archive hints advisory-only', () => {
  it('哈希精确命中产出 exact，不因相似再双报', () => {
    const hints = buildArchiveHints_ACU(
      [{ summary: '北岭矿洞塌方', at: '第三日', relatedIds: ['seed-mine'] }],
      overview,
    );
    expect(hints).toEqual([{
      candidateIndex: 0,
      level: 'exact',
      matchedDay: 3,
      matchedOneLine: '北岭矿洞塌方压伤三人',
      matchedArchiveRef: 'arc-mine',
    }]);
  });

  it('同义不同措辞达到 Jaccard 阈值时产出 similar', () => {
    const hints = buildArchiveHints_ACU(
      [{ summary: '北岭矿洞今夜塌方压伤了三人', at: '第四日', relatedIds: ['seed-other'] }],
      overview,
    );
    expect(hints).toEqual([{
      candidateIndex: 0,
      level: 'similar',
      matchedDay: 3,
      matchedOneLine: '北岭矿洞塌方压伤三人',
      matchedArchiveRef: 'arc-mine',
    }]);
  });

  it('无命中返回空数组，不拦截候选', () => {
    expect(buildArchiveHints_ACU(
      [{ summary: '青阳税银被劫', at: '第五日', relatedIds: ['seed-tax'] }],
      overview,
    )).toEqual([]);
  });
});
