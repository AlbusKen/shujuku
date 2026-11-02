import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockChat, mockContainer, mockSetContainer, mockIsolationKey } = vi.hoisted(() => ({
  mockChat: [{}] as any[],
  mockContainer: { value: null as Record<string, unknown> | null },
  mockSetContainer: vi.fn(),
  mockIsolationKey: { value: '' },
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => mockChat,
}));

vi.mock('../../../src/data/storage/chat-history', () => ({
  getChatScopedConfigContainer_ACU: () => mockContainer.value,
  getChatScopedConfigField_ACU: (_chat: unknown[], field: string) => mockContainer.value?.[field],
  normalizeChatScopedConfigContainer_ACU: (value: any) => ({ ...(value || {}), version: 1 }),
  setChatScopedConfigContainer_ACU: (_chat: any[], value: Record<string, unknown>) => {
    mockContainer.value = value;
    mockSetContainer(value);
  },
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: null,
  getCurrentIsolationKey_ACU: () => mockIsolationKey.value,
}));

import {
  canEnableFlightMode_ACU,
  countVisibleChronicleRows_ACU,
  getCurrentFlightModeState_ACU,
  isFlightModeActive_ACU,
  normalizeFlightModeState_ACU,
  setCurrentFlightModeState_ACU,
  stageFlightModeHiddenRowIds_ACU,
} from '../../../src/service/flight-mode/flight-mode-state';

function chronicle(rows: any[]) {
  return {
    sheet_chronicle: {
      name: '纪要表',
      content: [['row_id', '内容'], ...rows],
    },
  };
}

describe('flight-mode-state', () => {
  beforeEach(() => {
    mockChat.splice(0, mockChat.length, {});
    mockContainer.value = null;
    mockSetContainer.mockClear();
    mockIsolationKey.value = '';
  });

  it('旧会话缺少状态时默认关闭', () => {
    expect(getCurrentFlightModeState_ACU()).toMatchObject({
      enabled: false,
      hiddenRowIds: [],
    });
    expect(isFlightModeActive_ACU()).toBe(false);
  });

  it('规范化脏状态并去重隐藏 row_id', () => {
    expect(normalizeFlightModeState_ACU({
      enabled: true,
      enabledAt: 12.7,
      hiddenRowIds: [1, '1', '', null, ' 2 '],
    })).toMatchObject({
      enabled: true,
      enabledAt: 12,
      hiddenRowIds: ['1', '2'],
    });
  });

  it('在当前聊天作用域持久化状态', () => {
    setCurrentFlightModeState_ACU({
      enabled: true,
      enabledAt: 100,
      hiddenRowIds: ['2'],
      bigSummarySheetKey: 'sheet_big',
    });
    expect(mockSetContainer).toHaveBeenCalledOnce();
    expect(getCurrentFlightModeState_ACU()).toMatchObject({
      enabled: true,
      hiddenRowIds: ['2'],
      bigSummarySheetKey: 'sheet_big',
    });
  });

  it('持久化 archive，且不覆盖同一作用域的既有槽位', () => {
    mockContainer.value = { version: 1, template: { '': { mode: 'chat_override' } } };
    setCurrentFlightModeState_ACU({
      enabled: true,
      enabledAt: 100,
      hiddenRowIds: [],
      bigSummarySheetKey: 'sheet_big',
      archive: { chronicleExportConfig: { entryType: 'keyword' } as any },
    });

    expect(mockContainer.value).toMatchObject({
      version: 1,
      template: { '': { mode: 'chat_override' } },
      flightModeByIsolationKey: {
        '': {
          enabled: true,
          archive: { chronicleExportConfig: { entryType: 'keyword' } },
        },
      },
    });
  });

  it('状态按 isolationKey 隔离，切换标签不会继承其他标签的飞行模式', () => {
    mockIsolationKey.value = '标签A';
    setCurrentFlightModeState_ACU({
      enabled: true,
      enabledAt: 100,
      hiddenRowIds: ['a1'],
      bigSummarySheetKey: 'sheet_a_summary',
    });

    mockIsolationKey.value = '标签B';
    expect(getCurrentFlightModeState_ACU()).toMatchObject({ enabled: false, hiddenRowIds: [] });

    setCurrentFlightModeState_ACU({
      enabled: true,
      enabledAt: 200,
      hiddenRowIds: ['b1'],
      bigSummarySheetKey: 'sheet_b_summary',
    });

    mockIsolationKey.value = '标签A';
    expect(getCurrentFlightModeState_ACU()).toMatchObject({ enabled: true, hiddenRowIds: ['a1'], bigSummarySheetKey: 'sheet_a_summary' });
    mockIsolationKey.value = '标签B';
    expect(getCurrentFlightModeState_ACU()).toMatchObject({ enabled: true, hiddenRowIds: ['b1'], bigSummarySheetKey: 'sheet_b_summary' });
  });

  it('暂存隐藏行会保留同 scoped container 的其他槽位，并可在提交失败时恢复完整快照', () => {
    mockContainer.value = {
      version: 1,
      template: { '': { mode: 'chat_override' } },
      flightModeByIsolationKey: {
        '': {
          enabled: true,
          enabledAt: 100,
          hiddenRowIds: ['c1'],
          bigSummarySheetKey: 'sheet_da_zong_jie',
        },
      },
    };

    const rollback = stageFlightModeHiddenRowIds_ACU(['c1', 'c2']);

    expect(mockContainer.value).toMatchObject({
      template: { '': { mode: 'chat_override' } },
      flightModeByIsolationKey: { '': { enabled: true, hiddenRowIds: ['c1', 'c2'] } },
    });
    expect(rollback).toEqual(expect.any(Function));

    rollback!();

    expect(mockContainer.value).toEqual({
      version: 1,
      template: { '': { mode: 'chat_override' } },
      flightModeByIsolationKey: {
        '': {
          enabled: true,
          enabledAt: 100,
          hiddenRowIds: ['c1'],
          bigSummarySheetKey: 'sheet_da_zong_jie',
        },
      },
    });
  });

  it('关闭状态不暂存隐藏行', () => {
    mockContainer.value = { version: 1, flightMode: { enabled: false, hiddenRowIds: [] } };

    expect(stageFlightModeHiddenRowIds_ACU(['c1'])).toBeNull();
    expect(mockSetContainer).not.toHaveBeenCalled();
  });

  it('无当前聊天时安全返回关闭状态', () => {
    mockChat.splice(0);
    expect(isFlightModeActive_ACU()).toBe(false);
  });

  it('只统计未隐藏的纪要行，并在超过 15 行时拒绝开启', () => {
    setCurrentFlightModeState_ACU({
      enabled: true,
      enabledAt: 1,
      hiddenRowIds: ['2'],
      bigSummarySheetKey: 'sheet_big',
    });
    const data = chronicle(Array.from({ length: 16 }, (_, i) => [String(i + 1), `第${i + 1}行`]));
    expect(countVisibleChronicleRows_ACU(data)).toBe(15);
    expect(canEnableFlightMode_ACU(data)).toEqual({ canEnable: true, visibleChronicleRowCount: 15 });
    mockContainer.value = { version: 1, flightMode: { enabled: true, hiddenRowIds: [], bigSummarySheetKey: 'sheet_big' } };
    expect(canEnableFlightMode_ACU(data)).toEqual({
      canEnable: false,
      visibleChronicleRowCount: 16,
      reason: 'too_many_visible_chronicle_rows',
    });
  });

  it('纪要表不存在时拒绝开启', () => {
    expect(canEnableFlightMode_ACU({})).toEqual({
      canEnable: false,
      visibleChronicleRowCount: 0,
      reason: 'chronicle_not_found',
    });
  });
});
