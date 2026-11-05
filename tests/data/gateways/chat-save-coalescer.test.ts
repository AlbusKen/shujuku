/**
 * tests/data/gateways/chat-save-coalescer.test.ts
 * 宿主存盘合并调度器（chat-gateway 填表运行期节流）单元测试
 *
 * 直测 src/data/gateways/chat-gateway.ts 的调度器本体（open/close/coalesced/forceFlush + DEFER_MAX 兜底），
 * 仅 mock 宿主 API 与日志，不 mock 调度器自身。
 * 注意：调度器是模块级单例状态，跨用例残留经 beforeEach 的 close+forceFlush 收口归零。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSillyTavern, mockLogWarn, saveChat, mockHost } = vi.hoisted(() => {
  // mockHost.currentChatId：脏归属比对的聊天键来源（模拟切聊天）；默认 null=宿主不暴露
  // 聊天 id（currentChatKey 返回 null=不可判定，按同聊天处理=旧行为，既有用例不受扰）。
  const mockHost = { currentChatId: null as string | null };
  return {
    mockHost,
    mockSillyTavern: {
      getCurrentChatId: () => (mockHost.currentChatId === null ? undefined : mockHost.currentChatId),
    } as any,
    mockLogWarn: vi.fn(),
    saveChat: vi.fn(),
  };
});

vi.mock('../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: mockSillyTavern,
  jQuery_API_ACU: {},
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: mockLogWarn,
  cleanChatName_ACU: (name: string) => name.replace(/\.jsonl$|\.json$/i, ''),
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  getHostRequestHeaders_ACU: () => ({}),
}));

import {
  openChatSaveCoalescing_ACU,
  closeChatSaveCoalescing_ACU,
  saveChatToHostCoalesced_ACU,
  saveChatToHostStrict_ACU,
  forceFlushChatSave_ACU,
} from '../../../src/data/gateways/chat-gateway';

/** 可控 resolve 的 saveChat：每次调用返回未 resolve 的 promise，release() 放行最挂在队首的一个。 */
function installGatedSaveChat() {
  const gates: Array<() => void> = [];
  saveChat.mockImplementation(() => new Promise<void>((resolve) => { gates.push(resolve); }));
  return {
    calls: () => saveChat.mock.calls.length,
    release: () => { gates.shift()?.(); },
  };
}

/** 真实计时器下冲刷微任务队列。 */
const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** 安装默认即时 resolve 的宿主 saveChat。 */
function installDefaultSaveChat() {
  saveChat.mockReset().mockResolvedValue(undefined);
  mockSillyTavern.saveChat = saveChat;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  // 上一用例可能把聊天键切到别的值：先复位为「宿主不暴露 id」（不可判定=按同聊天），
  // 再收口——否则残留归属会让收口冲洗误判异聊天而清不掉脏。
  mockHost.currentChatId = null;
  // 上一用例可能留下脏标记 / 未关窗口 / 兜底定时器：窗口深度不可能超过本文件用例嵌套数，
  // close 到 0 后继续 close 是 no-op，多关几次即可归零；再把 saveChat 换成立即 resolve
  // （唤醒任何悬挂 await）后冲洗收口。
  for (let i = 0; i < 8; i += 1) closeChatSaveCoalescing_ACU();
  installDefaultSaveChat();
  await forceFlushChatSave_ACU();
  await flushMicrotasks();
  // 收口后重装干净实现，供本用例使用。
  installDefaultSaveChat();
  // 锚定 _lastRealSaveAt 到当前真实时钟：窗口内延迟判定依赖与上次真存盘的差值，
  // 不锚定则上一用例在假时钟下留下的时间戳会让本用例首调跳过延迟分支直接真存。
  await saveChatToHostCoalesced_ACU();
  await flushMicrotasks();
  installDefaultSaveChat();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('saveChatToHostCoalesced_ACU 非运行期', () => {
  it('窗口外行为与直存等价：一次调用一次真存盘', async () => {
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('在途期间的后续调用合并进尾随环：挂起期计数不涨，尾随补存不丢数据', async () => {
    const gate = installGatedSaveChat();
    const first = saveChatToHostCoalesced_ACU();
    await flushMicrotasks();
    expect(gate.calls()).toBe(1);
    const second = saveChatToHostCoalesced_ACU();
    await flushMicrotasks();
    // 第二次调用只置脏并 await 在途环，不再排宿主队列。
    expect(gate.calls()).toBe(1);
    gate.release();
    await flushMicrotasks();
    // 在途期置脏 → 尾随环补存一次（第二次真存已挂上受控 promise），两次调用的数据都落盘。
    expect(gate.calls()).toBe(2);
    gate.release();
    await first;
    await second;
    expect(gate.calls()).toBe(2);
  });

  it('saveChat 缺失时静默返回并告警，不抛错', async () => {
    delete mockSillyTavern.saveChat;
    await expect(saveChatToHostCoalesced_ACU()).resolves.toBeUndefined();
    expect(mockLogWarn).toHaveBeenCalled();
  });
});

describe('存盘合并运行窗口', () => {
  it('运行期内两批只真存 1 次，第二次调用立即返回不占批间隙', async () => {
    openChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).not.toHaveBeenCalled();
    closeChatSaveCoalescing_ACU();
    await forceFlushChatSave_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('运行期 DEFER_MAX 兜底：挂起 120 秒后自动真存一次，无新脏不再空转', async () => {
    vi.useFakeTimers();
    // 假时钟下先真存一次锚定 _lastRealSaveAt：兜底定时器时长=DEFER_MAX-距上次真存盘差值，
    // 不锚定则假时钟与真实时间戳混算导致定时器远大于 120 秒。
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
    saveChat.mockClear();
    openChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120000);
    expect(saveChat).toHaveBeenCalledTimes(1);
    // 脏已被兜底补存清掉；即便窗口仍开，定时器也不重复空转全量存盘。
    await vi.advanceTimersByTimeAsync(120000);
    expect(saveChat).toHaveBeenCalledTimes(1);
    closeChatSaveCoalescing_ACU();
  });
});

describe('strict 成功清脏', () => {
  it('strict 全量落盘是超集覆盖：其后 forceFlush 无脏 no-op', async () => {
    openChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).not.toHaveBeenCalled();
    await saveChatToHostStrict_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
    closeChatSaveCoalescing_ACU();
    await forceFlushChatSave_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });
});

describe('失败保脏（真存盘抛错不吞脏）', () => {
  it('非运行期真存失败：首调感知异常且脏留驻，forceFlush 补成（计数=2）', async () => {
    saveChat.mockRejectedValueOnce(new Error('宿主存盘炸了'));
    await expect(saveChatToHostCoalesced_ACU()).rejects.toThrow('宿主存盘炸了');
    expect(saveChat).toHaveBeenCalledTimes(1);
    // 脏未被失败的这一轮吞掉：强制冲洗会真存重试（mock 已回到 resolve 态）。
    await forceFlushChatSave_ACU();
    expect(saveChat).toHaveBeenCalledTimes(2);
    // 补成后无脏：再冲洗 no-op。
    await forceFlushChatSave_ACU();
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('连续两次失败脏仍在：第三次 forceFlush 才补成（计数=3）', async () => {
    saveChat.mockRejectedValueOnce(new Error('炸1'));
    saveChat.mockRejectedValueOnce(new Error('炸2'));
    await expect(saveChatToHostCoalesced_ACU()).rejects.toThrow('炸1');
    // forceFlush 永不抛：这次重试也失败，只 logWarn，脏继续留驻。
    await forceFlushChatSave_ACU();
    expect(saveChat).toHaveBeenCalledTimes(2);
    await forceFlushChatSave_ACU();
    expect(saveChat).toHaveBeenCalledTimes(3);
  });
});

describe('脏聊天归属比对', () => {
  it('跨聊天置脏：旧聊天脏作废，forceFlush no-op 且告警', async () => {
    mockHost.currentChatId = 'chat-A';
    openChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).not.toHaveBeenCalled();
    closeChatSaveCoalescing_ACU();
    mockHost.currentChatId = 'chat-B';
    await forceFlushChatSave_ACU();
    // 异聊天：不冒领到新聊天头上——一次真存盘都不排，只告警。
    expect(saveChat).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('跨聊天置脏后再置新脏：新聊天脏照常补存（弃旧记新不挡新）', async () => {
    mockHost.currentChatId = 'chat-A';
    openChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    mockHost.currentChatId = 'chat-B';
    await saveChatToHostCoalesced_ACU();
    closeChatSaveCoalescing_ACU();
    await forceFlushChatSave_ACU();
    // 旧脏作废 + 新脏落盘：恰好一次真存。
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('跨聊天 defer 定时器触发：丢弃旧脏不排队列', async () => {
    vi.useFakeTimers();
    mockHost.currentChatId = 'chat-A';
    // 假时钟下先真存锚定 _lastRealSaveAt（同 DEFER_MAX 用例口径），定时器才落在 120 秒档。
    await saveChatToHostCoalesced_ACU();
    saveChat.mockClear();
    openChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    expect(saveChat).not.toHaveBeenCalled();
    mockHost.currentChatId = 'chat-B';
    await vi.advanceTimersByTimeAsync(120000);
    // 定时器触发时归属比对不过：作废旧脏，不排宿主队列。
    expect(saveChat).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalled();
    closeChatSaveCoalescing_ACU();
  });

  it('跨聊天 strict 成功：旧聊天脏作废（strict 覆盖不到旧聊天），forceFlush no-op', async () => {
    mockHost.currentChatId = 'chat-A';
    openChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    closeChatSaveCoalescing_ACU();
    mockHost.currentChatId = 'chat-B';
    // strict 存的是 B；A 的脏覆盖不到——归属比对作废，不能留给后续触发点冒领 B。
    await saveChatToHostStrict_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
    await forceFlushChatSave_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenCalled();
  });
});

describe('forceFlushChatSave_ACU 三态', () => {
  it('无脏时 no-op', async () => {
    await forceFlushChatSave_ACU();
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('有脏时补存一次', async () => {
    openChatSaveCoalescing_ACU();
    await saveChatToHostCoalesced_ACU();
    closeChatSaveCoalescing_ACU();
    await forceFlushChatSave_ACU();
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('在途时 await 在途环并补掉尾脏，不另起双存', async () => {
    // 口径说明：本用例钉的是调度器契约（在途环+尾随环不双存），不涉及 init.ts。
    // 运行窗口开着且中途换聊天：异聊天旧脏已由调度器归属比对作废（见「脏聊天归属比对」），
    // 换底前的旧聊天收敛仍靠 init.ts CHAT_CHANGED 回调头部的换底冲洗（换底前对旧聊天
    // forceFlush），pagehide 次之。
    const gate = installGatedSaveChat();
    const first = saveChatToHostCoalesced_ACU();
    await flushMicrotasks();
    expect(gate.calls()).toBe(1);
    // 在途期间置脏，然后触发强制冲洗。
    const dirty = saveChatToHostCoalesced_ACU();
    const flushing = forceFlushChatSave_ACU();
    gate.release();
    await flushMicrotasks();
    // 在途环的尾随补存已挂上受控 promise，放行它清脏。
    gate.release();
    await first;
    await dirty;
    await flushing;
    // 在途环第一次真存 + 尾随环补存脏各一次；forceFlush 只 await 环与复检，不另起队列。
    expect(gate.calls()).toBe(2);
  });
});
