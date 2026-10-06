import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogDebug, mockLogWarn } = vi.hoisted(() => ({
  mockLogDebug: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logWarn_ACU: mockLogWarn,
}));

import { logAutoFillSkip_ACU } from '../../src/shared/trigger-diagnostics';
import { _resetForTesting, getAllLogs, setDebugLogEnabled, subscribe } from '../../src/shared/log-buffer';

describe('logAutoFillSkip_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
  });

  it('Debug 关闭时不采集，开启后记录拒绝原因且不记录正文', () => {
    const received = vi.fn();
    subscribe(received);
    logAutoFillSkip_ACU('ambiguous_generated_ai_message', {
      eventType: 'GENERATION_ENDED',
      messageId: 42,
      chatKey: 'chat-1',
      messageText: 'must never be logged',
    });

    expect(getAllLogs()).toEqual([]);
    expect(received).not.toHaveBeenCalled();
    setDebugLogEnabled(true);
    logAutoFillSkip_ACU('ambiguous_generated_ai_message', {
      eventType: 'GENERATION_ENDED',
      messageId: 42,
      chatKey: 'chat-1',
      messageText: 'must never be logged',
    });
    expect(getAllLogs()).toHaveLength(1);
    expect(getAllLogs()[0].tag).toBe('AutoFill');
    expect(getAllLogs()[0].message).toContain('ambiguous_generated_ai_message');
    expect(getAllLogs()[0].message).toContain('GENERATION_ENDED');
    expect(getAllLogs()[0].message).not.toContain('must never be logged');
    expect(received).toHaveBeenCalledOnce();
  });

  it('常规跳过遵从 Debug 开关，关闭后不再新增记录', () => {
    logAutoFillSkip_ACU('quiet_or_background_generation', {
      eventType: 'GENERATION_ENDED',
      lastGenerationType: 'quiet',
    });

    expect(mockLogWarn).not.toHaveBeenCalled();
    expect(mockLogDebug).not.toHaveBeenCalled();
    expect(getAllLogs()).toHaveLength(0);
    setDebugLogEnabled(true);
    logAutoFillSkip_ACU('quiet_or_background_generation', {
      eventType: 'GENERATION_ENDED', lastGenerationType: 'quiet',
    });
    expect(getAllLogs()).toHaveLength(1);
    expect(getAllLogs()[0].message).toContain('quiet_or_background_generation');
    setDebugLogEnabled(false);
    logAutoFillSkip_ACU('no_tables_due');
    expect(getAllLogs()).toHaveLength(1);
  });
});
