/**
 * tests/service/preview/table-fill-prompt-preview.test.ts
 * 填表提示词预览 — 三管线计划选取 + 渲染 + 脱敏串联
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSettings,
  mockCurrentJsonTableData,
  mockChat,
  mockFillMode,
  mockPrepare,
  mockRenderMessages,
  mockGetApiConfigByPreset,
  mockRequireResolved,
  mockBuildBody,
  mockAutoPlan,
  mockCatchUpPlan,
  mockHistoryState,
  mockLorebookDispose,
  mockIsNonFillAiFloor,
} = vi.hoisted(() => {
  return {
    mockSettings: {
      tableApiPreset: 'preset-main',
      charCardPrompt: [{ role: 'SYSTEM', content: '系统 $0' }],
      strictJsonTableFillEnabled: false,
      tableFillNativeToolEnabled: false,
      streamingEnabled: false,
      autoUpdateTokenThreshold: 10,
      updateBatchSize: 2,
      skipUpdateFloors: 0,
      plotSettings: { enabled: true },
      plotApiPreset: '',
      plotTaskApiPresetOverridesById: {},
    } as any,
    mockCurrentJsonTableData: {
      sheet_0: { name: '状态表', updateConfig: { groupId: 1 } },
      sheet_1: { name: '背包表', updateConfig: { groupId: 2 } },
    } as any,
    mockChat: { value: [] as any[] },
    mockFillMode: { value: 'llm' as string },
    mockPrepare: vi.fn(),
    mockRenderMessages: vi.fn(),
    mockGetApiConfigByPreset: vi.fn(() => ({
      apiMode: 'custom',
      apiConfig: { url: 'http://localhost', model: 'test-model', customApiFormat: 'openai_compat' },
      tavernProfile: '',
      resolved: true,
    })),
    mockRequireResolved: vi.fn(),
    mockBuildBody: vi.fn(() => ({
      model: 'test-model',
      messages: [],
      proxy_password: 'sk-live',
      custom_include_headers: { Authorization: 'Bearer sk-live' },
      custom_include_body: { api_key: 'k', safe: 1 },
    })),
    mockAutoPlan: { value: null as any },
    mockCatchUpPlan: { value: null as any },
    mockHistoryState: vi.fn(() => ({ lastCompletedAiFloor: 0 })),
    mockLorebookDispose: vi.fn(),
    mockIsNonFillAiFloor: vi.fn(() => false),
  };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentJsonTableData_ACU: mockCurrentJsonTableData,
  getCurrentIsolationKey_ACU: vi.fn(() => 'iso-key'),
  pendingFinalGenerationGreenlights_ACU: [],
}));

vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: vi.fn(() => mockChat.value),
}));

vi.mock('../../../src/service/fill-mode/fill-mode-chat-record', () => ({
  resolveCurrentChatFillMode_ACU: vi.fn(() => ({ mode: mockFillMode.value, source: 'record' })),
}));

vi.mock('../../../src/service/agent/agent-worldbook-runtime-state', () => ({
  isAgentWorldbookRuntimeEnabled_ACU: vi.fn(() => false),
}));

vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => false),
}));

vi.mock('../../../src/service/ai/prompt-builder/prompt-prepare', () => ({
  prepareAIInput_ACU: mockPrepare,
}));

vi.mock('../../../src/service/ai/prompt-builder/prompt-api-call', () => ({
  renderTableFillMessages_ACU: mockRenderMessages,
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  getApiConfigByPreset_ACU: mockGetApiConfigByPreset,
  requireResolvedApiPreset_ACU: mockRequireResolved,
  buildCustomApiRequestBody_ACU: mockBuildBody,
}));

vi.mock('../../../src/service/table/update-scheduler', () => ({
  buildAutoUpdatePlan_ACU: vi.fn(() => mockAutoPlan.value),
}));

vi.mock('../../../src/service/table/update-orchestrator', () => ({
  resolveUpdateMode_ACU: vi.fn((mode: string) => mode === 'auto_independent' ? 'auto_standard' : 'manual_independent'),
  resolveTableApiPresetOverride_ACU: vi.fn(() => ''),
}));

vi.mock('../../../src/service/table/table-history', () => ({
  resolveTableHistoryStateFromChat_ACU: mockHistoryState,
}));

vi.mock('../../../src/service/table/manual-fill-planner', () => ({
  planManualCatchUpWaves_ACU: vi.fn(() => mockCatchUpPlan.value),
}));

vi.mock('../../../src/service/table/manual-update-settings', () => ({
  resolveManualUpdateBatchSize_ACU: vi.fn(() => 2),
  resolveManualUpdateContextDepth_ACU: vi.fn(() => 0),
}));

vi.mock('../../../src/service/runtime/message-handler', () => ({
  isNonFillAiFloor_ACU: mockIsNonFillAiFloor,
  selectFillEligibleIndices_ACU: vi.fn((_chat: any[], allAiMessageIndices: number[], _s: number, _skip: number, filter: (i: number) => boolean) =>
    allAiMessageIndices.filter(filter)),
}));

vi.mock('../../../src/service/worldbook/read-context', () => ({
  createLorebookReadContext_ACU: vi.fn(() => ({ dispose: mockLorebookDispose, readBookEntries: vi.fn() })),
}));

vi.mock('../../../src/shared/utils', () => ({
  parseTableTemplateJson_ACU: vi.fn(() => ({
    sheet_0: { name: '状态表', updateConfig: { groupId: 1 } },
    sheet_1: { name: '背包表', updateConfig: { groupId: 2 } },
  })),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU: [],
  DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU: [],
}));

vi.mock('../../../src/service/ai/prompt-builder/strict-json-table-fill', () => ({
  cloneStrictPromptSegments_ACU: vi.fn(() => []),
  buildStrictJsonTableFillResponseFormatForData_ACU: vi.fn(() => ({ responseFormat: { type: 'json_schema' } })),
}));

vi.mock('../../../src/service/ai/prompt-builder/table-fill-tools', () => ({
  buildTableFillNativeTools_ACU: vi.fn(() => []),
}));

vi.mock('../../../src/service/ai/agent-tool-mode', () => ({
  isNativeToolChannelAvailable_ACU: vi.fn(() => false),
}));

import { previewTableFillPrompt_ACU } from '../../../src/service/preview/table-fill-prompt-preview';
import { PromptPreviewGateBlockedError_ACU, PromptPreviewPrepareError_ACU } from '../../../src/service/preview/prompt-preview-types';

function resetBase() {
  mockChat.value = [
    { is_user: true, mes: '你好' },
    { is_user: false, mes: 'A'.repeat(50) },
    { is_user: false, mes: 'B'.repeat(50) },
    { is_user: false, mes: 'C'.repeat(50) },
  ];
  mockAutoPlan.value = {
    updateGroups: {
      g1: { indices: [1, 2], batchSize: 2, sheetKeys: ['sheet_0'], groupId: 1, requiresBoundaryStaging: false },
      g2: { indices: [3], batchSize: 2, sheetKeys: ['sheet_1'], groupId: 2, requiresBoundaryStaging: false },
    },
    boundary: null,
  };
  mockCatchUpPlan.value = {
    targetAiFloor: 3,
    targetMessageIndex: 3,
    planSignature: 'sig',
    waves: [{
      startAiFloor: 1,
      endAiFloor: 3,
      messageIndices: [1, 2, 3],
      sheetKeys: ['sheet_0', 'sheet_1'],
      groups: [{
        key: 'k', groupId: 1, batchSize: 2, sheetKeys: ['sheet_0'],
        requestOptions: null, updateMode: 'manual_independent', executionKind: 'standard',
      }],
    }],
  };
  mockPrepare.mockReset().mockResolvedValue({
    tableDataText: 'TT', messagesText: 'MT', worldbookContent: '', manualExtraHint: '',
  });
  mockRenderMessages.mockReset().mockResolvedValue([
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'USER' },
  ]);
  mockSettings.continuationPageEnabled = false;
  mockSettings.contentOptimizationSettings = { enabled: false };
  mockSettings.worldSimulationPageEnabled = false;
  mockSettings.autoUpdateTokenThreshold = 10;
  mockSettings.tableApiPreset = 'preset-main';
  mockFillMode.value = 'llm';
  mockLorebookDispose.mockClear();
}

describe('previewTableFillPrompt_ACU', () => {
  beforeEach(resetBase);

  it('auto 场景：产出分段、脱敏请求体与元信息，segments tokens 汇总', async () => {
    const preview = await previewTableFillPrompt_ACU();
    expect(preview.meta.scenario).toBe('auto');
    expect(preview.meta.fillMode).toBe('llm');
    expect(preview.meta.storageMode).toBe('json');
    expect(preview.meta.updateMode).toBe('auto_standard');
    expect(preview.meta.targetSheetKeys).toEqual(['sheet_0']);
    expect(preview.meta.presetName).toBe('preset-main');
    expect(preview.segments).toHaveLength(2);
    expect(preview.totalTokens).toBeGreaterThan(0);
    // 脱敏串联：mock 请求体里的敏感字段被替换。
    expect(preview.requestBody.proxy_password).toBe('***');
    expect((preview.requestBody.custom_include_headers as any).Authorization).toBe('***');
    expect((preview.requestBody.custom_include_body as any).api_key).toBe('***');
    expect((preview.requestBody.custom_include_body as any).safe).toBe(1);
  });

  it('auto 场景消息切法：批首紧邻用户楼时一并纳入上下文（update-orchestrator.ts:2651-2655）', async () => {
    await previewTableFillPrompt_ACU();
    const messagesForContext = mockPrepare.mock.calls[0][0] as any[];
    // g1 批 = 楼1..2，前一楼(0)是用户楼 → 上下文从楼 0 起。
    expect(messagesForContext.map((m) => m.mes)).toEqual(['你好', 'A'.repeat(50), 'B'.repeat(50)]);
  });

  it('auto 场景：末楼过短的批被阈值跳过，取下一个合格批', async () => {
    mockSettings.autoUpdateTokenThreshold = 60; // 楼2(50字)不合格，g2 楼3(50字)也不合格
    await expect(previewTableFillPrompt_ACU()).rejects.toMatchObject({
      name: 'PromptPreviewPrepareError_ACU',
      failureCode: 'no_pending_auto_job',
    });
    // 降低阈值：g1 不合格（末楼50<60？不，楼2=50<60 不合格）→ 落到 g2（末楼 3=50<60 也不合格）
    mockSettings.autoUpdateTokenThreshold = 40; // g1 末楼 50>=40 合格
    const preview = await previewTableFillPrompt_ACU();
    expect(preview.meta.targetSheetKeys).toEqual(['sheet_0']);
  });

  it('manual_refill 场景：未传 targetSheetKeys 时回退全部 sheet_ 表，按 groupId 分组后预览第一组', async () => {
    const preview = await previewTableFillPrompt_ACU({ scenario: 'manual_refill' });
    expect(preview.meta.scenario).toBe('manual_refill');
    expect(preview.meta.updateMode).toBe('manual_independent');
    // 真实管线每组各发一次请求；预览取「第一个将发出的请求」→ 首组（sheet_0，groupId=1）。
    expect(preview.meta.targetSheetKeys).toEqual(['sheet_0']);
  });

  it('manual_refill 场景：传入 targetSheetKeys 时只保留所选表', async () => {
    const preview = await previewTableFillPrompt_ACU({ scenario: 'manual_refill', targetSheetKeys: ['sheet_1'] });
    expect(preview.meta.targetSheetKeys).toEqual(['sheet_1']);
  });

  it('catch_up 场景：取第一波第一组，波内消息序列直接作为批序列', async () => {
    const preview = await previewTableFillPrompt_ACU({ scenario: 'catch_up' });
    expect(preview.meta.scenario).toBe('catch_up');
    expect(preview.meta.updateMode).toBe('manual_independent');
    expect(preview.meta.targetSheetKeys).toEqual(['sheet_0']);
    // 波 messageIndices=[1,2,3]，组 batchSize=2 → 批=楼1..2，前一楼是用户楼 → 上下文楼0..2。
    const messagesForContext = mockPrepare.mock.calls[0][0] as any[];
    expect(messagesForContext).toHaveLength(3);
  });

  it('prepareAIInput 收到结构克隆的 tableData（绕开 seed 写入陷阱）且只读上下文被 dispose', async () => {
    await previewTableFillPrompt_ACU();
    const options = mockPrepare.mock.calls[0][3] as any;
    expect(options.tableData).not.toBe(mockCurrentJsonTableData);
    expect(options.tableData).toEqual(mockCurrentJsonTableData);
    expect(mockLorebookDispose).toHaveBeenCalled();
  });

  it('prepareAIInput 返回结构化失败时透出 failureCode 与 retryable', async () => {
    mockPrepare.mockResolvedValue({ ok: false, failureCode: 'worldbook_read_failed', message: '世界书读取失败', retryable: true });
    await expect(previewTableFillPrompt_ACU()).rejects.toMatchObject({
      name: 'PromptPreviewPrepareError_ACU',
      failureCode: 'worldbook_read_failed',
      retryable: true,
    });
  });

  it('prepareAIInput 返回 null 时抛结构化错误', async () => {
    mockPrepare.mockResolvedValue(null);
    await expect(previewTableFillPrompt_ACU()).rejects.toMatchObject({
      name: 'PromptPreviewPrepareError_ACU',
      failureCode: 'prepare_empty',
    });
  });

  it('门控阻断：智能续写开启时抛 PromptPreviewGateBlockedError_ACU 且不触达 prepare', async () => {
    mockSettings.continuationPageEnabled = true;
    await expect(previewTableFillPrompt_ACU()).rejects.toMatchObject({
      name: 'PromptPreviewGateBlockedError_ACU',
      scenario: 'tableFill',
    });
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('填表模式为 classic 时填表预览可用，但剧情门控不可用', async () => {
    mockFillMode.value = 'classic';
    const preview = await previewTableFillPrompt_ACU();
    expect(preview.meta.fillMode).toBe('classic');
  });

  it('渲染调用 renderTableFillMessages_ACU 并把结果按分段透出', async () => {
    await previewTableFillPrompt_ACU();
    expect(mockRenderMessages).toHaveBeenCalled();
    const input = mockRenderMessages.mock.calls[0][2] as any;
    expect(input.sourcePromptSegments).toEqual(mockSettings.charCardPrompt);
    expect(input.strictJsonFillEnabled).toBe(false);
    expect(input.sqliteMode).toBe(false);
  });
});
