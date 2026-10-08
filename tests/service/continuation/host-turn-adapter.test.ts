import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  setTextarea: vi.fn(() => true),
  clickSend: vi.fn(() => true),
  clickRegenerate: vi.fn(() => true),
  triggerGenerate: vi.fn(() => true),
  markSendIntent: vi.fn(),
  host: { deleteLastMessage: vi.fn(async () => undefined) } as any,
}));

vi.mock('../../../src/shared/host-input', () => ({
  setSendTextareaValue_ACU: (...args: any[]) => h.setTextarea(...args),
  clickSendButton_ACU: (...args: any[]) => h.clickSend(...args),
  clickRegenerateButton_ACU: (...args: any[]) => h.clickRegenerate(...args),
  triggerHostGenerate_ACU: (...args: any[]) => h.triggerGenerate(...args),
}));
vi.mock('../../../src/shared/host-api', () => ({
  get SillyTavern_API_ACU() { return h.host; },
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  markUserSendIntent_ACU: () => h.markSendIntent(),
}));

import { SillyTavernHostTurnAdapter_ACU } from '../../../src/service/continuation/host-turn-adapter';

describe('SillyTavernHostTurnAdapter_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.host = { deleteLastMessage: vi.fn(async () => undefined) };
    h.setTextarea.mockReturnValue(true);
    h.clickSend.mockReturnValue(true);
    h.clickRegenerate.mockReturnValue(true);
    h.triggerGenerate.mockReturnValue(true);
  });

  it('only reports deletion success after the native host deletion resolves', async () => {
    const adapter = new SillyTavernHostTurnAdapter_ACU();

    await expect(adapter.removeLastMessage()).resolves.toBe(true);

    expect(h.host.deleteLastMessage).toHaveBeenCalledOnce();
  });

  it('fails closed when native host deletion is unavailable or rejects', async () => {
    const adapter = new SillyTavernHostTurnAdapter_ACU();
    h.host = {};
    await expect(adapter.removeLastMessage()).resolves.toBe(false);

    h.host = { deleteLastMessage: vi.fn(async () => { throw new Error('host failure'); }) };
    await expect(adapter.removeLastMessage()).resolves.toBe(false);
  });

  it('每轮指导直接生成一次，写入失败不生成，正文重试使用对应宿主入口', () => {
    const adapter = new SillyTavernHostTurnAdapter_ACU();
    for (const instruction of ['首轮写作指导', '下一轮写作指导']) {
      expect(adapter.send(instruction)).toBe(true);
      expect(h.setTextarea).toHaveBeenLastCalledWith(instruction, undefined, { restoreAfterInput: true });
    }
    expect(h.triggerGenerate).toHaveBeenCalledTimes(2);
    expect(h.triggerGenerate.mock.calls).toEqual([['normal'], ['normal']]);
    expect(h.markSendIntent).toHaveBeenCalledTimes(2);
    expect(h.setTextarea).toHaveBeenCalledBefore(h.markSendIntent);
    expect(h.markSendIntent).toHaveBeenCalledBefore(h.triggerGenerate);
    expect(h.clickSend).not.toHaveBeenCalled();

    h.triggerGenerate.mockClear();
    h.markSendIntent.mockClear();
    expect(adapter.send('   ')).toBe(false);
    h.setTextarea.mockReturnValueOnce(false);
    expect(adapter.send('写入失败的指导')).toBe(false);
    expect(h.markSendIntent).not.toHaveBeenCalled();
    expect(h.triggerGenerate).not.toHaveBeenCalled();

    h.triggerGenerate.mockReturnValueOnce(false);
    expect(adapter.send('宿主不可用时的指导')).toBe(false);
    expect(h.triggerGenerate).toHaveBeenCalledExactlyOnceWith('normal');
    expect(h.clickSend).not.toHaveBeenCalled();

    h.triggerGenerate.mockClear();
    expect(adapter.retryGeneration('regenerate')).toBe(true);
    expect(h.clickRegenerate).toHaveBeenCalledOnce();
    expect(adapter.retryGeneration('generate')).toBe(true);
    expect(h.triggerGenerate).toHaveBeenCalledWith('normal');
  });

  it('stops in-flight host generation when the native API exists, and skips when it does not', () => {
    const adapter = new SillyTavernHostTurnAdapter_ACU();
    h.host = { stopGeneration: vi.fn() };
    adapter.stopGeneration();
    expect(h.host.stopGeneration).toHaveBeenCalledOnce();

    h.host = {};
    expect(() => adapter.stopGeneration()).not.toThrow();
  });
});
