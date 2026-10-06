/**
 * tests/service/optimization/content-optimization.test.ts
 * 正文优化服务 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockSaveCache, mockLoadCache } = vi.hoisted(() => ({
  mockSettings: {
    contentOptimizationSettings: { maxOptimizations: 10, loopCount: 1, retryCount: 3 },
    plotSettings: {},
  } as any,
  mockSaveCache: vi.fn(),
  mockLoadCache: vi.fn(() => null),
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU: [],
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentJsonTableData_ACU: null,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => []),
}));

vi.mock('../../../src/data/gateways/host-state-gateway', () => ({
  getPersonaDescription_ACU: vi.fn(() => ''),
  getCharDescription_ACU: vi.fn(() => ''),
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  callAIWithPreset_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/text-optimization', () => ({
  applyOptimizations_ACU: vi.fn((content: string) => content),
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../src/data/storage/optimization-cache-storage', () => ({
  saveOptimizationBaseToCache_ACU: mockSaveCache,
  loadOptimizationBaseFromCache_ACU: mockLoadCache,
}));

vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  formatOutlineTableForPlot_ACU: vi.fn(() => ''),
  formatSummaryIndexForPlot_ACU: vi.fn(() => ({ success: false })),
  getLatestAIMessageContent_ACU: vi.fn(() => ''),
  getLatestUserMessageContent_ACU: vi.fn(() => ''),
  composeSeedMatchContent_ACU: (userContent: string, aiContent: string) => [userContent, aiContent].filter(Boolean).join('\n'),
  getPlotFromHistory_ACU: vi.fn(() => ''),
  getWorldbookContentForPlot_ACU: vi.fn(async () => ''),
  parseCalcTags_ACU: vi.fn((s: string) => s),
  parseIfBlockRecursive_ACU: vi.fn((s: string) => s),
  parseMaxTags_ACU: vi.fn((s: string) => s),
  parseMinTags_ACU: vi.fn((s: string) => s),
  parseRandomTags_ACU: vi.fn((s: string) => s),
  replaceCalcVariables_ACU: vi.fn((s: string) => s),
  replaceMaxVariables_ACU: vi.fn((s: string) => s),
  replaceMinVariables_ACU: vi.fn((s: string) => s),
  replaceRandomVariables_ACU: vi.fn((s: string) => s),
}));

vi.mock('../../../src/shared/defaults', () => ({
  buildDefaultContentOptimizationPromptGroup_ACU: vi.fn(() => []),
  defaultVectorMemoryConfig_ACU: {
    enabled: false,
    threshold: 50,
    archiveTriggerCount: 9,
    archiveBatchSize: 3,
    archiveMaxConcurrency: 3,
    summaryIndexArchiveMaxConcurrency: 30,
    summaryIndexArchiveEmbeddingConcurrency: 3,
    topK: 200,
    minScore: 0.45,
    embeddingEndpoint: '',
    embeddingApiKey: '',
    embeddingModel: '',
    rerankEndpoint: '',
    rerankApiKey: '',
    rerankModel: '',
  },
}));

vi.mock('../../../src/service/runtime/template-vars/sql-query-var', () => ({
  withSqlTemplateReadContext_ACU: <T>(_context: unknown, run: () => T): T => run(),
  replaceDbSqlVariables: vi.fn((s: string) => s),
}));

import {
  setLastOptimizationBase_ACU,
  getLastOptimizationBase_ACU,
  cancelContentOptimization_ACU,
  ensureOptimizationNotCancelled_ACU,
  _set_contentOptimizationAbortRequested_ACU,
  _set_optimizationProgressToast_ACU,
  optimizationProgressToast_ACU,
} from '../../../src/service/optimization/content-optimization';

beforeEach(() => {
  vi.clearAllMocks();
  _set_contentOptimizationAbortRequested_ACU(false);
  mockLoadCache.mockReturnValue(null);
});

// ═══ setLastOptimizationBase_ACU ═══
describe('setLastOptimizationBase_ACU', () => {
  it('保存优化基准', () => {
    const result = setLastOptimizationBase_ACU({
      messageIndex: 5,
      messageId: 'msg1',
      baseContent: '原始内容',
    });
    expect(result.messageIndex).toBe(5);
    expect(result.messageId).toBe('msg1');
    expect(result.baseContent).toBe('原始内容');
    expect(result.updatedAt).toBeGreaterThan(0);
    expect(mockSaveCache).toHaveBeenCalled();
  });

  it('空 payload 使用默认值', () => {
    const result = setLastOptimizationBase_ACU();
    expect(result.messageIndex).toBe(-1);
    expect(result.messageId).toBeNull();
    expect(result.baseContent).toBe('');
  });

  it('非整数 messageIndex 使用 -1', () => {
    const result = setLastOptimizationBase_ACU({ messageIndex: 'abc' });
    expect(result.messageIndex).toBe(-1);
  });
});

// ═══ getLastOptimizationBase_ACU ═══
describe('getLastOptimizationBase_ACU', () => {
  it('有内存缓存时返回内存缓存', () => {
    setLastOptimizationBase_ACU({ messageIndex: 3, baseContent: '缓存内容' });
    const result = getLastOptimizationBase_ACU();
    expect(result).not.toBeNull();
    expect(result!.baseContent).toBe('缓存内容');
  });

  it('无内存缓存时从持久化缓存加载', () => {
    mockLoadCache.mockReturnValue({ messageIndex: 2, baseContent: '持久化内容' });
    // 先清除内存缓存
    setLastOptimizationBase_ACU({ baseContent: '' });
    const result = getLastOptimizationBase_ACU();
    expect(result).not.toBeNull();
    expect(result!.baseContent).toBe('持久化内容');
  });

  it('无任何缓存时返回 null', () => {
    // 清除内存缓存
    setLastOptimizationBase_ACU({ baseContent: '' });
    mockLoadCache.mockReturnValue(null);
    const result = getLastOptimizationBase_ACU();
    expect(result).toBeNull();
  });
});

// ═══ cancelContentOptimization_ACU ═══
describe('cancelContentOptimization_ACU', () => {
  it('取消优化', () => {
    const result = cancelContentOptimization_ACU();
    expect(result.cancelled).toBe(true);
    expect(result.reason).toContain('终止');
  });

  it('自定义取消原因', () => {
    const result = cancelContentOptimization_ACU('自定义原因');
    expect(result.reason).toBe('自定义原因');
  });
});

// ═══ ensureOptimizationNotCancelled_ACU ═══
describe('ensureOptimizationNotCancelled_ACU', () => {
  it('未取消时不抛错', () => {
    _set_contentOptimizationAbortRequested_ACU(false);
    expect(() => ensureOptimizationNotCancelled_ACU()).not.toThrow();
  });

  it('已取消时抛错', () => {
    cancelContentOptimization_ACU();
    expect(() => ensureOptimizationNotCancelled_ACU()).toThrow('终止');
  });
});

// ═══ _set_contentOptimizationAbortRequested_ACU ═══
describe('_set_contentOptimizationAbortRequested_ACU', () => {
  it('设置为 true 后 ensureOptimizationNotCancelled 抛错', () => {
    _set_contentOptimizationAbortRequested_ACU(true);
    expect(() => ensureOptimizationNotCancelled_ACU()).toThrow();
  });
  it('设置为 false 后 ensureOptimizationNotCancelled 不抛错', () => {
    _set_contentOptimizationAbortRequested_ACU(false);
    expect(() => ensureOptimizationNotCancelled_ACU()).not.toThrow();
  });
});

// ═══ _set_optimizationProgressToast_ACU ═══
describe('_set_optimizationProgressToast_ACU', () => {
  it('设置 toast 值后变量更新为该值', () => {
    const toast = { message: '优化中...' };
    _set_optimizationProgressToast_ACU(toast);
    expect(optimizationProgressToast_ACU).toBe(toast);
    expect(optimizationProgressToast_ACU.message).toBe('优化中...');
  });
  it('设置为 null 后变量为 null', () => {
    _set_optimizationProgressToast_ACU({ message: '先设置一个值' });
    expect(optimizationProgressToast_ACU).not.toBeNull();
    _set_optimizationProgressToast_ACU(null);
    expect(optimizationProgressToast_ACU).toBeNull();
  });
});

// ═══ performContentOptimization_ACU ═══
describe('performContentOptimization_ACU', () => {
  it('API 调用成功且解析成功时返回优化结果', async () => {
    const { callAIWithPreset_ACU } = await import('../../../src/service/ai/api-call');
    const { applyOptimizations_ACU } = await import('../../../src/shared/text-optimization');
    vi.mocked(callAIWithPreset_ACU).mockResolvedValue(JSON.stringify({
      optimizations: [
        { type: 'replace', original: '旧文本', optimized: '新文本', plan: '优化计划' },
      ],
      summary: '优化总结',
    }));
    vi.mocked(applyOptimizations_ACU).mockReturnValue('优化后的内容');

    const { performContentOptimization_ACU } = await import('../../../src/service/optimization/content-optimization');
    const result = await performContentOptimization_ACU('原始内容', { currentLoop: 1 });
    expect(result.success).toBe(true);
    expect(result.optimizations).toBeDefined();
    expect(result.optimizedContent).toBe('优化后的内容');
  });

  it('API 返回空响应时所有重试失败', async () => {
    const { callAIWithPreset_ACU } = await import('../../../src/service/ai/api-call');
    vi.mocked(callAIWithPreset_ACU).mockResolvedValue('');

    mockSettings.contentOptimizationSettings = { maxOptimizations: 10, loopCount: 1, retryCount: 1 };
    const { performContentOptimization_ACU } = await import('../../../src/service/optimization/content-optimization');
    const result = await performContentOptimization_ACU('内容', {});
    expect(result.success).toBe(false);
    expect(result.retryExhausted).toBe(true);
  });

  it('API 抛错时重试后失败', async () => {
    const { callAIWithPreset_ACU } = await import('../../../src/service/ai/api-call');
    vi.mocked(callAIWithPreset_ACU).mockRejectedValue(new Error('网络错误'));

    mockSettings.contentOptimizationSettings = { maxOptimizations: 10, loopCount: 1, retryCount: 1 };
    const { performContentOptimization_ACU } = await import('../../../src/service/optimization/content-optimization');
    const result = await performContentOptimization_ACU('内容', {});
    expect(result.success).toBe(false);
  });
});
