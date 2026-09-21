import { describe, expect, it } from 'vitest';
import { formatWorldSimulationAnchorStaleDiff_ACU } from '../../../src/presentation-v2/simulation/world-simulation-anchor-diff';
import type { WorldSimulationError_ACU } from '../../../src/service/simulation/model';

function staleError(details?: Record<string, unknown>): WorldSimulationError_ACU {
  return {
    code: 'WORLD_SIMULATION_ANCHOR_STALE',
    phase: 'anchor',
    message: '世界推演冻结锚点已变化，拒绝继续写入',
    retryable: false,
    ...(details ? { details } : {}),
  };
}

describe('formatWorldSimulationAnchorStaleDiff_ACU', () => {
  it('只列出四元组中不一致的字段，digest 截断前 12 位', () => {
    const text = formatWorldSimulationAnchorStaleDiff_ACU(staleError({
      expected: {
        chatIdentity: 'chat-a',
        messageKey: 'number:7',
        swipeId: '0',
        contentDigest: 'aaaaaaaaaaaabbbbbbbbbbbb',
      },
      actual: {
        chatIdentity: 'chat-a',
        messageKey: 'number:7',
        swipeId: '1',
        contentDigest: 'ccccccccccccdddddddddddd',
      },
    }));
    expect(text).toBe('锚点差异：swipeId expected=0 actual=1；contentDigest expected=aaaaaaaaaaaa actual=cccccccccccc');
    expect(text).not.toContain('bbbbbbbbbbbb');
    expect(text).not.toContain('chatIdentity');
    expect(text).not.toContain('messageKey');
  });

  it('无 details、缺 actual、或非锚点错误时返回空串', () => {
    expect(formatWorldSimulationAnchorStaleDiff_ACU(null)).toBe('');
    expect(formatWorldSimulationAnchorStaleDiff_ACU(staleError())).toBe('');
    expect(formatWorldSimulationAnchorStaleDiff_ACU(staleError({ expected: { swipeId: '0' } }))).toBe('');
    expect(formatWorldSimulationAnchorStaleDiff_ACU({
      code: 'WORLD_SIMULATION_CHAT_CHANGED',
      phase: 'anchor',
      message: '聊天已切换',
      retryable: false,
      details: {
        expected: { swipeId: '0' },
        actual: { swipeId: '1' },
      },
    })).toBe('');
  });

  it('四元组完全一致时不输出差异行', () => {
    const anchor = { chatIdentity: 'chat-a', messageKey: 'number:7', swipeId: '0', contentDigest: 'abc' };
    expect(formatWorldSimulationAnchorStaleDiff_ACU(staleError({ expected: anchor, actual: { ...anchor } }))).toBe('');
  });
});
