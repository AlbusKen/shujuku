import { describe, expect, it } from 'vitest';
import {
  normalizeSummaryVectorIndexScope_ACU,
  normalizeSummaryVectorIsolationKey_ACU,
  serializeSummaryVectorIndexScope_ACU,
  toChatIsolationSlotKey_ACU,
} from '../../src/shared/summary-vector-index-scope';

describe('summary vector index canonical scope', () => {
  it.each([undefined, null, '', '   ', '\t\n'])('将默认隔离域输入规范为 default: %j', (value) => {
    expect(normalizeSummaryVectorIsolationKey_ACU(value)).toBe('default');
  });

  it('清理非空 identity 的首尾空白，但保持大小写敏感', () => {
    expect(normalizeSummaryVectorIsolationKey_ACU('  Profile-A  ')).toBe('Profile-A');
    expect(normalizeSummaryVectorIsolationKey_ACU('Default')).toBe('Default');
    expect(normalizeSummaryVectorIsolationKey_ACU('Default')).not.toBe('default');
  });

  it('scope tuple 对空值使用稳定 fallback 且没有分隔符歧义', () => {
    expect(normalizeSummaryVectorIndexScope_ACU({ chatKey: ' ', isolationKey: '', sourceTableKey: '' }))
      .toEqual({ chatKey: 'current-chat', isolationKey: 'default', sourceTableKey: 'summary' });
    expect(serializeSummaryVectorIndexScope_ACU({ chatKey: 'a::b', isolationKey: 'c', sourceTableKey: 'd' }))
      .not.toBe(serializeSummaryVectorIndexScope_ACU({ chatKey: 'a', isolationKey: 'b::c', sourceTableKey: 'd' }));
  });

  it('未开隔离时把 scope token default 映射回空槽键', () => {
    expect(toChatIsolationSlotKey_ACU('default', '')).toBe('');
    expect(toChatIsolationSlotKey_ACU('', '')).toBe('');
    expect(toChatIsolationSlotKey_ACU(undefined, '')).toBe('');
  });

  it('真隔离码与 scope token 一致时保持运行时槽键', () => {
    expect(toChatIsolationSlotKey_ACU('abc', 'abc')).toBe('abc');
    expect(toChatIsolationSlotKey_ACU('default', 'default')).toBe('default');
  });

  it('scope 与运行时槽不一致时不擅自改槽，交给上层 mismatch 处理', () => {
    expect(toChatIsolationSlotKey_ACU('default', 'abc')).toBe('default');
  });
});
