/**
 * tests/data/gateways/chat-gateway.test.ts
 * 聊天数组访问网关 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSillyTavern, mockLogDebug, mockLogWarn } = vi.hoisted(() => ({
  mockSillyTavern: {} as any,
  mockLogDebug: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logWarn_ACU: mockLogWarn,
}));

import {
  getChatArray_ACU,
  getChatLength_ACU,
  getLastMessageIndex_ACU,
  saveChatToHost_ACU,
  saveChatToHostStrict_ACU,
  stopGeneration_ACU,
  deleteLastMessage_ACU,
  setChatMessages_ACU,
  emitMessageUpdated_ACU,
} from '../../../src/data/gateways/chat-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
});

describe('getChatArray_ACU', () => {
  it('无 chat 时返回空数组', () => {
    expect(getChatArray_ACU()).toEqual([]);
  });

  it('有 chat 时返回引用', () => {
    const chat = [{ mes: '消息1' }, { mes: '消息2' }];
    mockSillyTavern.chat = chat;
    expect(getChatArray_ACU()).toBe(chat);
  });
});

describe('getChatLength_ACU', () => {
  it('无 chat 时返回 0', () => {
    expect(getChatLength_ACU()).toBe(0);
  });

  it('有 chat 时返回长度', () => {
    mockSillyTavern.chat = [{ mes: '1' }, { mes: '2' }, { mes: '3' }];
    expect(getChatLength_ACU()).toBe(3);
  });
});

describe('getLastMessageIndex_ACU', () => {
  it('空聊天返回 0', () => {
    expect(getLastMessageIndex_ACU()).toBe(0);
  });

  it('有消息时返回最后索引', () => {
    mockSillyTavern.chat = [{ mes: '1' }, { mes: '2' }];
    expect(getLastMessageIndex_ACU()).toBe(1);
  });
});

describe('saveChatToHost_ACU', () => {
  it('saveChat 不可用时静默跳过', async () => {
    await saveChatToHost_ACU();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('saveChat 可用时调用', async () => {
    mockSillyTavern.saveChat = vi.fn().mockResolvedValue(undefined);
    await saveChatToHost_ACU();
    expect(mockSillyTavern.saveChat).toHaveBeenCalled();
  });
});

describe('saveChatToHostStrict_ACU', () => {
  it('saveChat 不可用时抛错，不把未提交误认为保存成功', async () => {
    await expect(saveChatToHostStrict_ACU()).rejects.toThrow('宿主 saveChat 不可用');
  });

  it('saveChat 可用时执行真实保存', async () => {
    mockSillyTavern.saveChat = vi.fn().mockResolvedValue(undefined);

    await saveChatToHostStrict_ACU();

    expect(mockSillyTavern.saveChat).toHaveBeenCalledTimes(1);
  });
});

describe('stopGeneration_ACU', () => {
  it('不可用时静默跳过', () => {
    stopGeneration_ACU();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('可用时调用', () => {
    mockSillyTavern.stopGeneration = vi.fn();
    stopGeneration_ACU();
    expect(mockSillyTavern.stopGeneration).toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalled();
  });
});

describe('deleteLastMessage_ACU', () => {
  it('不可用时静默跳过', async () => {
    await deleteLastMessage_ACU();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('可用时调用', async () => {
    mockSillyTavern.deleteLastMessage = vi.fn().mockResolvedValue(undefined);
    await deleteLastMessage_ACU();
    expect(mockSillyTavern.deleteLastMessage).toHaveBeenCalled();
  });
});

describe('setChatMessages_ACU', () => {
  it('不可用时返回 false', async () => {
    expect(await setChatMessages_ACU([{ message_id: 0, mes: '新内容' }])).toBe(false);
  });

  it('可用时调用并返回 true', async () => {
    mockSillyTavern.setChatMessages = vi.fn().mockResolvedValue(undefined);
    const result = await setChatMessages_ACU([{ message_id: 0, mes: '新内容' }], { refresh: 'affected' });
    expect(result).toBe(true);
    expect(mockSillyTavern.setChatMessages).toHaveBeenCalledWith(
      [{ message_id: 0, mes: '新内容' }],
      { refresh: 'affected' },
    );
  });
});

describe('emitMessageUpdated_ACU', () => {
  it('eventSource 不可用时静默跳过', async () => {
    await emitMessageUpdated_ACU(0);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('有 eventTypes.MESSAGE_UPDATED 时使用常量', async () => {
    const emit = vi.fn();
    mockSillyTavern.eventSource = { emit };
    mockSillyTavern.eventTypes = { MESSAGE_UPDATED: 'MESSAGE_UPDATED_CONST' };
    await emitMessageUpdated_ACU(5);
    expect(emit).toHaveBeenCalledWith('MESSAGE_UPDATED_CONST', 5);
  });

  it('无 eventTypes 时降级使用宿主事件名', async () => {
    const emit = vi.fn();
    mockSillyTavern.eventSource = { emit };
    await emitMessageUpdated_ACU(3);
    expect(emit).toHaveBeenCalledWith('message_updated', 3);
  });
});