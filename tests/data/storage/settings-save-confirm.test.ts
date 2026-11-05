/**
 * tests/data/storage/settings-save-confirm.test.ts
 * 酒馆设置保存确认 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockTopLevelWindow } = vi.hoisted(() => ({ mockTopLevelWindow: {} as any }));

vi.mock('../../../src/shared/env', () => ({ topLevelWindow_ACU: mockTopLevelWindow }));
vi.mock('../../../src/shared/utils', () => ({ logWarn_ACU: vi.fn() }));

import {
  HOST_SETTINGS_DEBOUNCE_MS_ACU,
  SETTINGS_CONFIRM_GRACE_MS_ACU,
  SETTINGS_MAX_RESAVES_ACU,
  getSettingsPersistenceSnapshot_ACU,
  getSettingsPersistenceState_ACU,
  noteSettingsWrite_ACU,
  noteSettingsWriteFailed_ACU,
  subscribeSettingsPersistence_ACU,
  subscribeSettingsWrites_ACU,
  _resetSettingsSaveConfirm_ACU,
} from '../../../src/data/storage/settings-save-confirm';

const handlers: Array<() => void> = [];
const eventSource = { on: vi.fn((_type: string, handler: () => void) => { handlers.push(handler); }) };
const emitSettingsUpdated = () => { for (const handler of [...handlers]) handler(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  handlers.length = 0;
  eventSource.on.mockClear();
  _resetSettingsSaveConfirm_ACU();
  mockTopLevelWindow.SillyTavern = {
    getContext: () => ({ eventSource, eventTypes: { SETTINGS_UPDATED: 'settings_updated' } }),
  };
});

afterEach(() => {
  _resetSettingsSaveConfirm_ACU();
  delete mockTopLevelWindow.SillyTavern;
  vi.useRealTimers();
});

describe('settings-save-confirm', () => {
  it('防抖窗口之后到达的 SETTINGS_UPDATED 确认写入', () => {
    const resave = vi.fn();
    const seq = noteSettingsWrite_ACU({ direct: false, resave });
    expect(getSettingsPersistenceState_ACU()).toBe('pending');
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU);
    emitSettingsUpdated();
    expect(getSettingsPersistenceSnapshot_ACU()).toMatchObject({ state: 'confirmed', confirmedWriteSeq: seq });
    expect(resave).not.toHaveBeenCalled();
  });

  it('事件一直不到时超时标为未落盘', () => {
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU + SETTINGS_CONFIRM_GRACE_MS_ACU - 1);
    expect(getSettingsPersistenceState_ACU()).toBe('pending');
    vi.advanceTimersByTime(1);
    expect(getSettingsPersistenceState_ACU()).toBe('unsaved');
  });

  it('早于防抖窗口的事件不确认写入，补发一次保存后等待后续事件', () => {
    const resave = vi.fn();
    noteSettingsWrite_ACU({ direct: false, resave });
    emitSettingsUpdated();
    expect(resave).toHaveBeenCalledTimes(1);
    expect(getSettingsPersistenceState_ACU()).toBe('pending');
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU);
    emitSettingsUpdated();
    expect(getSettingsPersistenceState_ACU()).toBe('confirmed');
  });

  it('早到事件触发的补发次数有上限', () => {
    const resave = vi.fn();
    noteSettingsWrite_ACU({ direct: false, resave });
    for (let i = 0; i < SETTINGS_MAX_RESAVES_ACU + 2; i++) emitSettingsUpdated();
    expect(resave).toHaveBeenCalledTimes(SETTINGS_MAX_RESAVES_ACU);
    expect(getSettingsPersistenceState_ACU()).toBe('pending');
  });

  it('补发抛错时标为未落盘并记录失败序号', () => {
    const seq = noteSettingsWrite_ACU({ direct: false, resave: () => { throw new Error('boom'); } });
    emitSettingsUpdated();
    expect(getSettingsPersistenceSnapshot_ACU()).toMatchObject({ state: 'unsaved', lastFailedWriteSeq: seq, latestWriteSeq: seq });
  });

  it('连续写入重新计时，不因首次写入超时误报', () => {
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    vi.advanceTimersByTime(8_000);
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    vi.advanceTimersByTime(4_000);
    expect(getSettingsPersistenceState_ACU()).toBe('pending');
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU + SETTINGS_CONFIRM_GRACE_MS_ACU - 4_000);
    expect(getSettingsPersistenceState_ACU()).toBe('unsaved');
  });

  it('直接保存的写入可被紧随其后的事件确认', () => {
    const resave = vi.fn();
    noteSettingsWrite_ACU({ direct: true, resave });
    emitSettingsUpdated();
    expect(getSettingsPersistenceState_ACU()).toBe('confirmed');
    expect(resave).not.toHaveBeenCalled();
  });

  it('未落盘后只有新的确认才恢复，后续写入不掩盖未落盘状态', () => {
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU + SETTINGS_CONFIRM_GRACE_MS_ACU);
    expect(getSettingsPersistenceState_ACU()).toBe('unsaved');
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    expect(getSettingsPersistenceState_ACU()).toBe('unsaved');
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU);
    emitSettingsUpdated();
    expect(getSettingsPersistenceState_ACU()).toBe('confirmed');
  });

  it('没有事件源时标为无法确认，不安装监听', () => {
    delete mockTopLevelWindow.SillyTavern;
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    expect(getSettingsPersistenceState_ACU()).toBe('unconfirmable');
    expect(eventSource.on).not.toHaveBeenCalled();
  });

  it('同一事件源只安装一次监听', () => {
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    expect(eventSource.on).toHaveBeenCalledTimes(1);
  });

  it('同步失败直接标为未落盘', () => {
    const seq = noteSettingsWriteFailed_ACU();
    expect(getSettingsPersistenceSnapshot_ACU()).toMatchObject({ state: 'unsaved', lastFailedWriteSeq: seq });
  });

  it('订阅者收到状态变化，取消订阅后不再收到', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSettingsPersistence_ACU(listener);
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU);
    emitSettingsUpdated();
    expect(listener.mock.calls.map(call => call[0])).toEqual(['pending', 'confirmed']);
    unsubscribe();
    noteSettingsWriteFailed_ACU();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('写入订阅者在每次登记写入（含同步失败与无法确认）后收到写入序号', () => {
    const listener = vi.fn();
    subscribeSettingsWrites_ACU(listener);
    const a = noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    const b = noteSettingsWriteFailed_ACU();
    delete mockTopLevelWindow.SillyTavern;
    const c = noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    expect(listener.mock.calls.map(call => call[0])).toEqual([a, b, c]);
  });
});

