import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  eventFingerprint_ACU,
  fuzzySimilarity_ACU,
  JACCARD_SIMILAR_THRESHOLD_ACU,
  normalizeEventText_ACU,
  sha1Hex_ACU,
} from '../../../src/service/simulation/event-similarity';

describe('event similarity fingerprints', () => {
  it('sha1 与 Node crypto 对齐', () => {
    const samples = ['', '北岭塌方', 'The quick brown fox jumps over the lazy dog'];
    for (const sample of samples) {
      expect(sha1Hex_ACU(sample)).toBe(createHash('sha1').update(sample, 'utf8').digest('hex'));
    }
  });

  it('normalize 口径：大小写、空白、标点变体哈希相同', () => {
    expect(normalizeEventText_ACU('北岭塌了！')).toBe(normalizeEventText_ACU('  北岭  塌了  '));
    expect(normalizeEventText_ACU('Tax Raid')).toBe(normalizeEventText_ACU('tax-raid'));
    const a = eventFingerprint_ACU('北岭塌了！', '第三日黄昏', ['seed-1', 'actor-2']);
    const b = eventFingerprint_ACU('  北岭  塌了  ', '第三日黄昏', ['actor-2', 'seed-1']);
    const c = eventFingerprint_ACU('北岭塌了', '第三日黄昏', ['seed-1', 'actor-2']);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toHaveLength(40);
  });

  it('relatedIds 顺序不影响指纹，at 不同则指纹不同', () => {
    const left = eventFingerprint_ACU('北岭塌了', 'd3', ['b', 'a']);
    const right = eventFingerprint_ACU('北岭塌了', 'd3', ['a', 'b']);
    expect(left).toBe(right);
    expect(eventFingerprint_ACU('北岭塌了', 'd4', ['a', 'b'])).not.toBe(left);
  });

  it('Jaccard：完全相同为 1，无交集为 0，阈值常量锁定 0.7', () => {
    expect(JACCARD_SIMILAR_THRESHOLD_ACU).toBe(0.7);
    expect(fuzzySimilarity_ACU('北岭 矿洞 塌方', '北岭 矿洞 塌方')).toBe(1);
    expect(fuzzySimilarity_ACU('北岭 塌方', '青阳 税案')).toBe(0);
    expect(fuzzySimilarity_ACU('', '北岭')).toBe(0);
    const similar = fuzzySimilarity_ACU('北岭矿洞今夜塌方伤了三人', '北岭矿洞今夜塌方压伤三人');
    expect(similar).toBeGreaterThanOrEqual(0.7);
  });
});
