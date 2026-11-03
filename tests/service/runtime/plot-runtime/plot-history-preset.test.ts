/**
 * tests/service/runtime/plot-runtime/plot-history-preset.test.ts
 * 剧情推进预设加载/历史记录读写 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSettings, mockGetChatArray, mockSaveChatToHost, mockSaveChatToHostStrict, mockSaveSettings, mockGetCurrentChatPlotScopeState, mockSetCurrentChatPlotScopeState, mockBuildChatPlotScopeState, mockGetCurrentRuntimePresetName, mockFindPresetByName, mockNormalizePresetSelection, mockIsDefaultPresetSelection, mockGetPresetBinding, mockSetPresetBinding, mockClearPresetBinding, mockEnsurePresetBindingsStore, mockEnsurePlotTasksCompat, mockApplyPresetToSettings, mockResetPlotSettingsToDefault, mockSyncEditableState, mockReplaceWithSnapshot, mockGetGlobalRevision, mockTempPlotToSaveRef, mockSetTempPlotToSave, mockPlanningGuard, mockCurrentChatFileIdentifierRef } = vi.hoisted(() => ({
  mockSettings: { plotSettings: { enabled: true, lastUsedPresetName: '', promptPresets: [] } } as any,
  mockGetChatArray: vi.fn(() => []),
  mockSaveChatToHost: vi.fn(),
  mockSaveChatToHostStrict: vi.fn(),
  mockSaveSettings: vi.fn(),
  mockGetCurrentChatPlotScopeState: vi.fn(() => null),
  mockSetCurrentChatPlotScopeState: vi.fn(),
  mockBuildChatPlotScopeState: vi.fn(() => null),
  mockGetCurrentRuntimePresetName: vi.fn(() => ''),
  mockFindPresetByName: vi.fn(() => null),
  mockNormalizePresetSelection: vi.fn((v: string) => v || ''),
  mockIsDefaultPresetSelection: vi.fn((v: string) => !v),
  mockGetPresetBinding: vi.fn(() => null),
  mockSetPresetBinding: vi.fn(),
  mockClearPresetBinding: vi.fn(() => false),
  mockEnsurePresetBindingsStore: vi.fn(),
  mockEnsurePlotTasksCompat: vi.fn(),
  mockApplyPresetToSettings: vi.fn(),
  mockResetPlotSettingsToDefault: vi.fn(),
  mockSyncEditableState: vi.fn(),
  mockReplaceWithSnapshot: vi.fn(),
  mockGetGlobalRevision: vi.fn(() => 0),
  mockTempPlotToSaveRef: { value: null as any },
  mockSetTempPlotToSave: vi.fn(),
  mockPlanningGuard: { inProgress: false, ignoreNextGenerationEndedCount: 0 } as any,
  mockCurrentChatFileIdentifierRef: { value: 'test-chat' },
}));

vi.mock('../../../../src/service/plot/plot-state', () => ({
  currentPlotTaskEditorId_ACU: '',
  _set_currentPlotTaskEditorId_ACU: vi.fn(),
}));

vi.mock('../../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  get currentChatFileIdentifier_ACU() {
    return mockCurrentChatFileIdentifierRef.value;
  },
  planningGuard_ACU: mockPlanningGuard,
  get tempPlotToSave_ACU() {
    return mockTempPlotToSaveRef.value;
  },
  _set_tempPlotToSave_ACU: mockSetTempPlotToSave,
}));

vi.mock('../../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHost_ACU: mockSaveChatToHost,
  saveChatToHostStrict_ACU: mockSaveChatToHostStrict,
}));

vi.mock('../../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: mockSaveSettings,
}));

vi.mock('../../../../src/service/template/chat-scope', () => ({
  buildChatPlotScopeStateFromSettings_ACU: mockBuildChatPlotScopeState,
  getCurrentChatPlotScopeState_ACU: mockGetCurrentChatPlotScopeState,
  setCurrentChatPlotScopeState_ACU: mockSetCurrentChatPlotScopeState,
}));

vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  hashUserInput_ACU: vi.fn((text: string) => `hash_${text}`),
}));

vi.mock('../../../../src/service/plot/plot-logic', () => ({
  applyPlotPresetToSettings_ACU: mockApplyPresetToSettings,
  clearPlotPresetBindingForChat_ACU: mockClearPresetBinding,
  ensurePlotPresetBindingsStore_ACU: mockEnsurePresetBindingsStore,
  ensurePlotTasksCompat_ACU: mockEnsurePlotTasksCompat,
  findPlotPresetByName_ACU: mockFindPresetByName,
  getCurrentRuntimePlotPresetName_ACU: mockGetCurrentRuntimePresetName,
  getPlotGlobalRevision_ACU: mockGetGlobalRevision,
  getPlotPresetBindingForChat_ACU: mockGetPresetBinding,
  isDefaultPlotPresetSelection_ACU: mockIsDefaultPresetSelection,
  setPlotPresetBindingForChat_ACU: mockSetPresetBinding,
  normalizePlotPresetSelectionValue_ACU: mockNormalizePresetSelection,
  replaceCurrentPlotSettingsWithSnapshot_ACU: mockReplaceWithSnapshot,
  resetPlotSettingsToDefault_ACU: mockResetPlotSettingsToDefault,
  syncCurrentEditablePlotPresetState_ACU: mockSyncEditableState,
}));

import {
  loadPresetAndCleanCharacterData_ACU,
  getPlotFromHistory_ACU,
  savePlotToLatestMessage_ACU,
  flushPlotPendingSave_ACU,
} from '../../../../src/service/runtime/plot-runtime/plot-history-preset';

beforeEach(() => {
  vi.clearAllMocks();
  mockTempPlotToSaveRef.value = null;
  mockCurrentChatFileIdentifierRef.value = 'test-chat';
  mockSaveChatToHostStrict.mockResolvedValue(undefined);
  // _set_tempPlotToSave_ACU 的真实语义是更新模块级状态；mock 里通过 ref 联动，
  // 否则实现内 _set_tempPlotToSave_ACU(null) 后 ref.value 不会同步，断言失真。
  mockSetTempPlotToSave.mockImplementation((v: any) => {
    mockTempPlotToSaveRef.value = v;
  });
  mockGetCurrentRuntimePresetName.mockReturnValue('');
  mockGetChatArray.mockReturnValue([]);
  mockSettings.plotSettings = { enabled: true, lastUsedPresetName: '', promptPresets: [] };
  mockPlanningGuard.inProgress = false;
  mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
  mockGetCurrentChatPlotScopeState.mockReturnValue(null);
  mockGetPresetBinding.mockReturnValue(null);
  mockFindPresetByName.mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ═══ loadPresetAndCleanCharacterData_ACU ═══
describe('loadPresetAndCleanCharacterData_ACU', () => {
  it('无 plotSettings 时直接返回', async () => {
    mockSettings.plotSettings = null;
    await loadPresetAndCleanCharacterData_ACU();
    expect(mockEnsurePlotTasksCompat).not.toHaveBeenCalled();
  });

  it('有 chatScopeState 快照时应用快照', async () => {
    mockGetCurrentChatPlotScopeState.mockReturnValue({ snapshot: { prompts: [] } });
    await loadPresetAndCleanCharacterData_ACU();
    expect(mockReplaceWithSnapshot).toHaveBeenCalled();
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  it('有全局预设时应用全局预设', async () => {
    mockSettings.plotSettings.lastUsedPresetName = '预设A';
    mockNormalizePresetSelection.mockReturnValue('预设A');
    mockFindPresetByName.mockReturnValue({ name: '预设A', prompts: [] });
    await loadPresetAndCleanCharacterData_ACU();
    expect(mockApplyPresetToSettings).toHaveBeenCalled();
    expect(mockSyncEditableState).toHaveBeenCalled();
  });

  it('全局预设不存在时回退到默认', async () => {
    mockSettings.plotSettings.lastUsedPresetName = '不存在的预设';
    mockNormalizePresetSelection.mockReturnValue('不存在的预设');
    mockFindPresetByName.mockReturnValue(null);
    await loadPresetAndCleanCharacterData_ACU();
    expect(mockResetPlotSettingsToDefault).toHaveBeenCalled();
  });

  it('有旧绑定且可迁移时写回聊天预设绑定', async () => {
    mockSettings.plotSettings.lastUsedPresetName = '预设A';
    // normalizePresetSelection 第一次调用返回全局预设名，第二次返回绑定预设名
    mockNormalizePresetSelection.mockImplementation((v: string) => v || '');
    mockGetPresetBinding.mockReturnValue({ presetName: '预设B', isExplicit: true, source: 'user' });
    // findPlotPresetByName: 全局预设A不存在，绑定预设B存在
    mockFindPresetByName.mockImplementation((name: string) => {
      if (name === '预设B') return { name: '预设B', prompts: [] };
      return null;
    });
    mockBuildChatPlotScopeState.mockReturnValue({ snapshot: {} });
    await loadPresetAndCleanCharacterData_ACU();
    expect(mockApplyPresetToSettings).toHaveBeenCalled();
    expect(mockSetPresetBinding).toHaveBeenCalledWith('test-chat', '预设B', {
      source: 'user',
      isExplicit: true,
    });
    expect(mockClearPresetBinding).not.toHaveBeenCalled();
  });
});

// ═══ getPlotFromHistory_ACU ═══
describe('getPlotFromHistory_ACU', () => {
  it('空聊天记录返回空字符串', () => {
    mockGetChatArray.mockReturnValue([]);
    expect(getPlotFromHistory_ACU()).toBe('');
  });

  it('找到匹配预设的 plot 数据', () => {
    mockGetCurrentRuntimePresetName.mockReturnValue('预设A');
    mockGetChatArray.mockReturnValue([
      { is_user: true, qrf_plot: '剧情数据', qrf_plot_preset: '预设A' },
    ]);
    expect(getPlotFromHistory_ACU()).toBe('剧情数据');
  });

  it('无匹配预设时回退到无标签数据', () => {
    mockGetCurrentRuntimePresetName.mockReturnValue('预设A');
    mockGetChatArray.mockReturnValue([
      { is_user: true, qrf_plot: '旧数据', qrf_plot_preset: '' },
    ]);
    expect(getPlotFromHistory_ACU()).toBe('旧数据');
  });

  it('无预设模式下找到任意 plot 数据', () => {
    mockGetCurrentRuntimePresetName.mockReturnValue('');
    mockGetChatArray.mockReturnValue([
      { is_user: true, qrf_plot: '任意数据', qrf_plot_preset: '预设X' },
    ]);
    expect(getPlotFromHistory_ACU()).toBe('任意数据');
  });

  it('无 plot 数据返回空字符串', () => {
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: '你好' },
      { is_user: false, mes: 'AI回复' },
    ]);
    expect(getPlotFromHistory_ACU()).toBe('');
  });

  it('使用 beforeIndex 限制搜索范围', () => {
    mockGetChatArray.mockReturnValue([
      { is_user: true, qrf_plot: '旧数据' },
      { is_user: true, qrf_plot: '新数据' },

    ]);
    expect(getPlotFromHistory_ACU({ beforeIndex: 1 })).toBe('旧数据');
  });

  it('显式锚点失配且末层已带 plot 时不自读当前层', () => {
    mockGetCurrentRuntimePresetName.mockReturnValue('');
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: '第一轮', qrf_plot: '第一轮推进' },
      { is_user: false, mes: 'AI回复' },
      // 当前层：mes 已被 finalMessage 覆盖，pending 标记已在上次保存后删除
      { is_user: true, mes: '当前层最终注入内容', qrf_plot: '当前轮推进' },
    ]);
    // 调用方给了锚点（原文哈希），但当前层 mes 已被覆盖 →锚点失配
    const out = getPlotFromHistory_ACU({
      beforeUserInputHash: 'hash_用户原文',
      beforeUserInputText: '用户原文',
    });
    expect(out).toBe('第一轮推进');
  });

  it('无锚点读取保持原语义：从末层向前取最近 plot', () => {
    mockGetCurrentRuntimePresetName.mockReturnValue('');
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: '旧', qrf_plot: '旧推进' },
      { is_user: true, mes: '新', qrf_plot: '新推进' },
    ]);
    expect(getPlotFromHistory_ACU()).toBe('新推进');
  });

  it('连续三层：第三层读到第二层而非第一层', () => {
    mockGetCurrentRuntimePresetName.mockReturnValue('预设A');
    mockGetChatArray.mockReturnValue([
      { is_user: true, mes: 'U1', qrf_plot: '第一层推进', qrf_plot_preset: '预设A' },
      { is_user: false, mes: 'A1' },
      { is_user: true, mes: 'U2', qrf_plot: '第二层推进', qrf_plot_preset: '预设A' },
      { is_user: false, mes: 'A2' },
    ]);
    expect(getPlotFromHistory_ACU()).toBe('第二层推进');
  });

});


// ═══ savePlotToLatestMessage_ACU ═══
describe('savePlotToLatestMessage_ACU', () => {
  it('flushPlotPendingSave_ACU：syncOnly 未命中时不启动定时器，直接返回 deferred', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    mockGetChatArray.mockReturnValue([]);
    mockTempPlotToSaveRef.value = {
      content: '旧内容',
      userInputHash: 'hash_旧消息',
      userInputText: '旧消息',
      taskResults: null,
      chatId: 'test-chat',
    };
    const timersSpy = vi.spyOn(globalThis, 'setTimeout');

    const out = await flushPlotPendingSave_ACU();
    expect(out).toEqual({ status: 'deferred', reason: 'target_not_found_yet' });
    // 不注册任何延迟轮询定时器
    expect(timersSpy).not.toHaveBeenCalled();
    timersSpy.mockRestore();
    // pending 保留，等待下一轮 flush 再试
    expect(mockTempPlotToSaveRef.value).not.toBeNull();
  });


  it('planningGuard 进行中且非 force 时返回 deferred，不保存', async () => {
    mockPlanningGuard.inProgress = true;
    mockSetTempPlotToSave.mockClear();
    const out = await savePlotToLatestMessage_ACU();
    expect(out.status).toBe('deferred');
    expect(mockSetTempPlotToSave).not.toHaveBeenCalled();
  });

  it('ignoreNextGenerationEndedCount > 0 时递减并返回 deferred', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 2;
    const out = await savePlotToLatestMessage_ACU();
    expect(mockPlanningGuard.ignoreNextGenerationEndedCount).toBe(1);
    expect(out.status).toBe('deferred');
  });

  it('tempPlotToSave 为空时不保存', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    const out = await savePlotToLatestMessage_ACU();
    expect(out.status).toBe('deferred');
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('强制保存同步标记命中：提交剧情字段且不消费内部生成忽略计数', async () => {
    mockPlanningGuard.inProgress = true;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 2;
    const target = { is_user: true, mes: '你好', _qrf_plot_pending_hash: 'hash_你好' };
    mockGetChatArray.mockReturnValue([target]);
    mockTempPlotToSaveRef.value = {
      content: '剧情内容',
      userInputHash: 'hash_你好',
      userInputText: '你好',
      taskResults: [
        { success: true, taskId: 't1', rawResponse: '推进内容A' },
        { success: false, taskId: 't2', rawResponse: '' },
      ],
    };
    mockGetCurrentRuntimePresetName.mockReturnValue('预设A');

    const out = await savePlotToLatestMessage_ACU(true);
    expect(out).toEqual({ status: 'committed', targetIndex: 0 });
    expect(target.qrf_plot).toBe('剧情内容');
    expect(target.qrf_plot_preset).toBe('预设A');
    expect(target.qrf_plot_tasks).toEqual({ t1: '推进内容A' });
    expect(target._qrf_plot_pending_hash).toBeUndefined();
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockSetTempPlotToSave).toHaveBeenCalledWith(null);
    expect(mockPlanningGuard.ignoreNextGenerationEndedCount).toBe(2);
  });

  it('宿主保存失败时保留 pending 与标记，返回 failed', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    const target = { is_user: true, mes: '你好', _qrf_plot_pending_hash: 'hash_你好' };
    mockGetChatArray.mockReturnValue([target]);
    mockTempPlotToSaveRef.value = {
      content: '剧情内容',
      userInputHash: 'hash_你好',
      userInputText: '你好',
      taskResults: null,
    };
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('磁盘写入失败'));

    const out = await savePlotToLatestMessage_ACU(true);
    expect(out.status).toBe('failed');
    expect((out as any).reason).toBe('host_save_failed');
    expect(target.qrf_plot).toBe('剧情内容');
    expect(target._qrf_plot_pending_hash).toBe('hash_你好');
    expect(mockTempPlotToSaveRef.value).not.toBeNull();
    expect(mockSetTempPlotToSave).not.toHaveBeenCalled();
  });

  it('保存失败后下一轮 flush 能重新定位同一目标并补保存', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    // 首轮：保存失败，标记保留
    const target = { is_user: true, mes: '你好', _qrf_plot_pending_hash: 'hash_你好' };
    mockGetChatArray.mockReturnValue([target]);
    mockTempPlotToSaveRef.value = {
      content: '剧情内容',
      userInputHash: 'hash_你好',
      userInputText: '你好',
      taskResults: null,
    };
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('失败'));
    await savePlotToLatestMessage_ACU(true);
    expect(mockTempPlotToSaveRef.value).not.toBeNull();

    // 下一轮 flush：保存成功，标记删除，pending 清空
    mockSaveChatToHostStrict.mockResolvedValueOnce(undefined);
    const flushOut = await flushPlotPendingSave_ACU();
    expect(flushOut).toEqual({ status: 'committed', targetIndex: 0 });
    expect(target.qrf_plot).toBe('剧情内容');
    expect(target._qrf_plot_pending_hash).toBeUndefined();
    expect(mockTempPlotToSaveRef.value).toBeNull();
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(2);
  });

  it('未命中（目标消息尚未入数组）时立即返回 deferred，不阻塞调用方', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    mockGetChatArray.mockReturnValue([]);
    mockTempPlotToSaveRef.value = {
      content: '剧情内容',
      userInputHash: 'hash_你好',
      userInputText: '你好',
      taskResults: null,
    };
    const out = await savePlotToLatestMessage_ACU(true);
    expect(out).toEqual({ status: 'deferred', reason: 'target_not_found_yet' });
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('伪装延迟入楼：轮询耗尽后仍能补写新层，重复提交共用一次宿主保存', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 2;
    const oldLayer = { is_user: true, mes: '你好', _qrf_plot_pending_hash: 'hash_你好' } as any;
    const chat: any[] = [oldLayer, { is_user: false, mes: '旧回复' }];
    const target = { is_user: true, mes: '最终注入内容' } as any;
    mockGetChatArray.mockReturnValue(chat);
    mockTempPlotToSaveRef.value = {
      content: '剧情内容',
      userInputHash: 'hash_你好',
      finalMessageHash: 'hash_最终注入内容',
      roundId: 'round-delayed',
      userInputText: '你好',
      taskResults: [{ success: true, taskId: 't1', rawResponse: '任务推进' }],
      targetStartIndex: chat.length,
      chatId: 'test-chat',
    };
    vi.useFakeTimers();
    const out = await savePlotToLatestMessage_ACU(true);
    expect(out.status).toBe('deferred');
    await vi.advanceTimersByTimeAsync(3000);
    expect(oldLayer.qrf_plot).toBeUndefined();
    expect(oldLayer._qrf_plot_round_id).toBeUndefined();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    expect(mockTempPlotToSaveRef.value).not.toBeNull();

    // 宿主在事件监听返回后创建真实层；保存替身记录真实写口收到的快照。
    chat.push(target);
    let savedChat: any[] = [];
    let finishSave!: () => void;
    mockSaveChatToHostStrict.mockImplementationOnce(() => {
      savedChat = JSON.parse(JSON.stringify(chat));
      return new Promise<void>(resolve => { finishSave = resolve; });
    });
    const firstFlush = flushPlotPendingSave_ACU();
    const secondFlush = flushPlotPendingSave_ACU();
    await Promise.resolve();
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    finishSave();
    expect(await firstFlush).toEqual({ status: 'committed', targetIndex: 2 });
    expect(await secondFlush).toEqual({ status: 'committed', targetIndex: 2 });
    await vi.advanceTimersByTimeAsync(300);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockTempPlotToSaveRef.value).toBeNull();
    expect(mockPlanningGuard.ignoreNextGenerationEndedCount).toBe(2);
    // 从宿主保存的快照恢复，而不是只断言内存对象。
    mockGetChatArray.mockReturnValue(savedChat);
    expect(savedChat[2]).toMatchObject({
      mes: '最终注入内容', qrf_plot: '剧情内容',
      qrf_plot_tasks: { t1: '任务推进' }, _qrf_plot_round_id: 'round-delayed',
    });
    expect(getPlotFromHistory_ACU()).toBe('剧情内容');
    expect(getPlotFromHistory_ACU({ taskId: 't1' })).toBe('任务推进');
  });

  it('延迟提交：新一轮 pending 替换时旧回调不写入也不清空新 pending', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    const oldTarget = { is_user: true, mes: '旧消息', _qrf_plot_pending_hash: 'hash_旧消息' };
    mockGetChatArray.mockReturnValue([]);
    const oldPending = {
      content: '旧内容',
      userInputHash: 'hash_旧消息',
      userInputText: '旧消息',
      taskResults: null,
    };
    mockTempPlotToSaveRef.value = oldPending;
    vi.useFakeTimers();
    await savePlotToLatestMessage_ACU(true);

    // 新一轮 pending 替换全局 pending
    const newPending = {
      content: '新内容',
      userInputHash: 'hash_新消息',
      userInputText: '新消息',
      taskResults: null,
    };
    mockTempPlotToSaveRef.value = newPending;
    mockGetChatArray.mockReturnValue([oldTarget]);

    await vi.advanceTimersByTimeAsync(200);
    // 旧回调检测到 pending 被替换，放弃本轮，不写入 oldTarget
    expect(oldTarget.qrf_plot).toBeUndefined();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    // 新 pending 未被清空
    expect(mockTempPlotToSaveRef.value).toBe(newPending);
    expect(mockSetTempPlotToSave).not.toHaveBeenCalled();
  });

  it('延迟提交：聊天切换时旧回调不写入，且清空本轮 pending', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    const oldTarget = { is_user: true, mes: '旧消息', _qrf_plot_pending_hash: 'hash_旧消息' };
    mockGetChatArray.mockReturnValue([]);
    mockTempPlotToSaveRef.value = {
      content: '旧内容',
      userInputHash: 'hash_旧消息',
      userInputText: '旧消息',
      taskResults: null,
    };
    vi.useFakeTimers();
    await savePlotToLatestMessage_ACU(true);

    // 聊天切换
    mockCurrentChatFileIdentifierRef.value = 'another-chat';
    mockGetChatArray.mockReturnValue([oldTarget]);
    await vi.advanceTimersByTimeAsync(200);
    expect(oldTarget.qrf_plot).toBeUndefined();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    expect(mockTempPlotToSaveRef.value).toBeNull();
  });

  it('持有 userInputHash 时不得尾部回退到无关用户消息', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    const unrelated = { is_user: true, mes: '完全无关的消息' };
    mockGetChatArray.mockReturnValue([unrelated]);
    mockTempPlotToSaveRef.value = {
      content: '剧情内容',
      userInputHash: 'hash_你好',
      userInputText: '你好',
      taskResults: null,
    };
    vi.useFakeTimers();
    const out = await savePlotToLatestMessage_ACU(true);
    expect(out.status).toBe('deferred');
    // 轮询耗尽后仍不写入无关消息
    await vi.advanceTimersByTimeAsync(3000);
    expect(unrelated.qrf_plot).toBeUndefined();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    expect(mockTempPlotToSaveRef.value).not.toBeNull();
  });

  it('无 hash 旧字符串格式保留尾部回退兼容', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    const target = { is_user: true, mes: '旧消息' };
    const other = { is_user: true, mes: '另一条' };
    mockGetChatArray.mockReturnValue([other, target]);
    mockTempPlotToSaveRef.value = '旧剧情内容';
    mockGetCurrentRuntimePresetName.mockReturnValue('');

    const out = await savePlotToLatestMessage_ACU(true);
    expect(out).toEqual({ status: 'committed', targetIndex: 1 });
    expect(target.qrf_plot).toBe('旧剧情内容');
    expect(other.qrf_plot).toBeUndefined();
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockTempPlotToSaveRef.value).toBeNull();
  });

  it('flushPlotPendingSave_ACU：pending 绑定其他聊天时丢弃，不跨聊天误写', async () => {
    mockTempPlotToSaveRef.value = {
      content: '旧内容',
      userInputHash: 'hash_旧消息',
      userInputText: '旧消息',
      taskResults: null,
      chatId: 'old-chat',
    };
    mockCurrentChatFileIdentifierRef.value = 'new-chat';
    const oldTarget = { is_user: true, mes: '旧消息', _qrf_plot_pending_hash: 'hash_旧消息' };
    mockGetChatArray.mockReturnValue([oldTarget]);

    const out = await flushPlotPendingSave_ACU();
    expect(out).toEqual({ status: 'superseded', reason: 'chat_changed' });
    expect(oldTarget.qrf_plot).toBeUndefined();
    expect(mockTempPlotToSaveRef.value).toBeNull();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  // ── roundId 身份契约（策略2 错层缺陷回归） ──

  it('策略2红线：mes 已被 finalMessage 覆盖时，按 finalMessageHash 首次认领并写入 roundId', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    // 第一层已完成；第二层是宿主刚创建的用户层，mes 是最终注入内容而非用户原文
    const first = { is_user: true, mes: 'U1', qrf_plot: '第一层推进', qrf_plot_preset: '预设A', _qrf_plot_round_id: 'round-1' };
    const aiReply = { is_user: false, mes: 'A1' };
    const target = { is_user: true, mes: '最终注入内容' } as any;
    mockGetChatArray.mockReturnValue([first, aiReply, target]);
    mockTempPlotToSaveRef.value = {
      content: '第二层推进',
      userInputHash: 'hash_用户原文',
      finalMessageHash: 'hash_最终注入内容',
      roundId: 'round-2',
      userInputText: '用户原文',
      taskResults: null,
      chatId: 'test-chat',
    };
    mockGetCurrentRuntimePresetName.mockReturnValue('预设A');

    const out = await savePlotToLatestMessage_ACU(true);
    expect(out).toEqual({ status: 'committed', targetIndex: 2 });
    expect(target.qrf_plot).toBe('第二层推进');
    expect(target.qrf_plot_preset).toBe('预设A');
    expect(target._qrf_plot_round_id).toBe('round-2');
    // 不得污染第一层
    expect(first.qrf_plot).toBe('第一层推进');
    expect(first._qrf_plot_round_id).toBe('round-1');
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockTempPlotToSaveRef.value).toBeNull();
  });

  it('策略2：finalMessageHash 不匹配时回退用户原文哈希认领（hook 未改写 mes）', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    const target = { is_user: true, mes: '用户原文' } as any;
    mockGetChatArray.mockReturnValue([target]);
    mockTempPlotToSaveRef.value = {
      content: '本轮推进',
      userInputHash: 'hash_用户原文',
      finalMessageHash: 'hash_最终注入内容',
      roundId: 'round-2',
      userInputText: '用户原文',
      taskResults: null,
      chatId: 'test-chat',
    };

    const out = await savePlotToLatestMessage_ACU(true);
    expect(out).toEqual({ status: 'committed', targetIndex: 0 });
    expect(target.qrf_plot).toBe('本轮推进');
    expect(target._qrf_plot_round_id).toBe('round-2');
  });

  it('roundId 重试：保存失败后 flush 按 roundId 精确命中同一层，即便已出现新用户层', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    const target = { is_user: true, mes: '最终注入内容' } as any;
    mockGetChatArray.mockReturnValue([target]);
    const pending = {
      content: '第二层推进',
      userInputHash: 'hash_用户原文',
      finalMessageHash: 'hash_最终注入内容',
      roundId: 'round-2',
      userInputText: '用户原文',
      taskResults: null,
      chatId: 'test-chat',
    };
    mockTempPlotToSaveRef.value = pending;
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('宿主保存失败'));

    const first = await savePlotToLatestMessage_ACU(true);
    expect(first.status).toBe('failed');
    // 失败后 roundId 已落在目标层上，pending 保留
    expect(target._qrf_plot_round_id).toBe('round-2');
    expect(mockTempPlotToSaveRef.value).toBe(pending);

    // 下一轮：新用户层已进入聊天尾部，且其 mes 与本轮 finalMessage 完全相同
    const newerLayer = { is_user: true, mes: '最终注入内容' } as any;
    // 重试仍以 roundId 为权威，不受首次认领范围限制。
    (pending as any).targetStartIndex = 2;
    mockGetChatArray.mockReturnValue([target, { is_user: false, mes: 'A' }, newerLayer]);
    mockSaveChatToHostStrict.mockResolvedValueOnce(undefined);

    const retry = await flushPlotPendingSave_ACU();
    expect(retry).toEqual({ status: 'committed', targetIndex: 0 });
    expect(target.qrf_plot).toBe('第二层推进');
    // 绝不能写到新用户层
    expect(newerLayer.qrf_plot).toBeUndefined();
    expect(newerLayer._qrf_plot_round_id).toBeUndefined();
    expect(mockTempPlotToSaveRef.value).toBeNull();
  });

  it('防错认：已属于其他 roundId 的用户层不得被本轮哈希认领', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    const occupied = { is_user: true, mes: '最终注入内容', _qrf_plot_round_id: 'round-other' } as any;
    mockGetChatArray.mockReturnValue([occupied]);
    mockTempPlotToSaveRef.value = {
      content: '本轮推进',
      userInputHash: 'hash_用户原文',
      finalMessageHash: 'hash_最终注入内容',
      roundId: 'round-2',
      userInputText: '用户原文',
      taskResults: null,
      chatId: 'test-chat',
    };

    const out = await flushPlotPendingSave_ACU();
    expect(out).toEqual({ status: 'deferred', reason: 'target_not_found_yet' });
    expect(occupied.qrf_plot).toBeUndefined();
    expect(occupied._qrf_plot_round_id).toBe('round-other');
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    expect(mockTempPlotToSaveRef.value).not.toBeNull();
  });

  it('防错认：已附着 qrf_plot 的层即使带策略1标记也不得被新轮次覆盖', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    // 残留场景：上一轮已写入 plot 但标记未清理，且未带 roundId（旧版本遗留）
    const stale = { is_user: true, mes: '用户原文', qrf_plot: '上一轮推进', _qrf_plot_pending_hash: 'hash_用户原文' } as any;
    mockGetChatArray.mockReturnValue([stale]);
    mockTempPlotToSaveRef.value = {
      content: '本轮推进',
      userInputHash: 'hash_用户原文',
      finalMessageHash: 'hash_最终注入内容',
      roundId: 'round-2',
      userInputText: '用户原文',
      taskResults: null,
      chatId: 'test-chat',
    };

    const out = await flushPlotPendingSave_ACU();
    expect(out).toEqual({ status: 'deferred', reason: 'target_not_found_yet' });
    expect(stale.qrf_plot).toBe('上一轮推进');
    expect(stale._qrf_plot_round_id).toBeUndefined();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('roundId 格式仍保留策略1标记路径，并在保存成功后清理标记、保留 roundId', async () => {
    mockPlanningGuard.inProgress = false;
    mockPlanningGuard.ignoreNextGenerationEndedCount = 0;
    const target = { is_user: true, mes: '你好', _qrf_plot_pending_hash: 'hash_你好' } as any;
    mockGetChatArray.mockReturnValue([target]);
    mockTempPlotToSaveRef.value = {
      content: '本轮推进',
      userInputHash: 'hash_你好',
      finalMessageHash: 'hash_你好',
      roundId: 'round-2',
      userInputText: '你好',
      taskResults: null,
      chatId: 'test-chat',
    };

    const out = await savePlotToLatestMessage_ACU(true);
    expect(out).toEqual({ status: 'committed', targetIndex: 0 });
    expect(target.qrf_plot).toBe('本轮推进');
    expect(target._qrf_plot_pending_hash).toBeUndefined();
    expect(target._qrf_plot_round_id).toBe('round-2');
  });

});
