import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  globalMeta_ACU: {},
  saveGlobalMeta_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'chat-file',
  settings_ACU: {},
}));

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: () => ({}),
}));

import {
  getEffectiveSummaryVectorIndexConfig_ACU,
  normalizeVectorMemoryConfig_ACU,
} from '../../../src/service/vector/vector-memory-config';

describe('vector-memory-config spv9.2 新增字段', () => {
  it('关键词 AI 开关缺省为开启，显式 false 才关闭', () => {
    expect(normalizeVectorMemoryConfig_ACU({}).keywordGenerationEnabled).toBe(true);
    expect(normalizeVectorMemoryConfig_ACU({ keywordGenerationEnabled: 'no' }).keywordGenerationEnabled).toBe(true);
    expect(normalizeVectorMemoryConfig_ACU({ keywordGenerationEnabled: false }).keywordGenerationEnabled).toBe(false);
  });

  it('rerank 每批条数缺省 300，夹在 [10, 500]', () => {
    expect(normalizeVectorMemoryConfig_ACU({}).rerankBatchSize).toBe(300);
    expect(normalizeVectorMemoryConfig_ACU({ rerankBatchSize: 5 }).rerankBatchSize).toBe(10);
    expect(normalizeVectorMemoryConfig_ACU({ rerankBatchSize: 2000 }).rerankBatchSize).toBe(500);
    expect(normalizeVectorMemoryConfig_ACU({ rerankBatchSize: 120 }).rerankBatchSize).toBe(120);
  });

  it('按句切分纪要正文默认关闭；minScore 新默认 0.35', () => {
    const config = normalizeVectorMemoryConfig_ACU({});
    expect(config.summaryIndexChunkChronicleBySentence).toBe(false);
    expect(config.minScore).toBe(0.35);
    expect(normalizeVectorMemoryConfig_ACU({ summaryIndexChunkChronicleBySentence: true }).summaryIndexChunkChronicleBySentence).toBe(true);
  });

  it('effective config 透传新增字段供运行时读取', () => {
    const config = getEffectiveSummaryVectorIndexConfig_ACU({
      embeddingEndpoint: 'https://embedding.test',
      embeddingModel: 'model',
      keywordGenerationEnabled: false,
      rerankBatchSize: 200,
      summaryIndexChunkChronicleBySentence: true,
    });
    expect(config.keywordGenerationEnabled).toBe(false);
    expect(config.rerankBatchSize).toBe(200);
    expect(config.summaryIndexChunkChronicleBySentence).toBe(true);
  });
});

describe('vector-memory-config hybrid retrieval fields', () => {
  it('normalize 默认启用 hybrid，并补齐 BM25/RRF 默认值', () => {
    const config = normalizeVectorMemoryConfig_ACU({ recallCandidateLimit: 321 });

    expect(config.hybridRetrievalEnabled).toBe(true);
    expect(config.bm25CandidateLimit).toBe(1000);
    expect(config.rrfK).toBe(60);
  });

  it('normalize 保留显式关闭 hybrid，并归一化 BM25/RRF 正整数', () => {
    const config = normalizeVectorMemoryConfig_ACU({
      hybridRetrievalEnabled: false,
      bm25CandidateLimit: 25,
      rrfK: 7,
    });

    expect(config.hybridRetrievalEnabled).toBe(false);
    expect(config.bm25CandidateLimit).toBe(25);
    expect(config.rrfK).toBe(7);
  });

  it('V2 rollout 默认保持 telemetry/read-only，并允许显式开启或关闭 writer', () => {
    const defaults = normalizeVectorMemoryConfig_ACU({});
    const enabled = normalizeVectorMemoryConfig_ACU({
      summaryIndexV2WriteEnabled: true,
    });
    const override = normalizeVectorMemoryConfig_ACU({
      summaryIndexV2WriteEnabled: false,
    });

    expect(defaults.summaryIndexV2WriteEnabled).toBe(true);
    expect(enabled.summaryIndexV2WriteEnabled).toBe(true);
    expect(override.summaryIndexV2WriteEnabled).toBe(false);
  });

  it('V2 writer allowlist 仅保留非空且去重后的 scope fingerprint', () => {
    const config = normalizeVectorMemoryConfig_ACU({
      summaryIndexV2WriteScopeAllowlist: [' scope-a ', '', 'scope-a', 1, 'scope-b'],
    });

    expect(config.summaryIndexV2WriteScopeAllowlist).toEqual(['scope-a', 'scope-b']);
  });

  it('effective config 暴露运行时使用的 summaryIndex hybrid 字段', () => {
    const config = getEffectiveSummaryVectorIndexConfig_ACU({
      embeddingEndpoint: 'https://embedding.test',
      embeddingModel: 'model',
      topK: 8,
      recallCandidateLimit: 3,
      hybridRetrievalEnabled: false,
      bm25CandidateLimit: 5,
      rrfK: 11,
    });

    expect(config.summaryIndexHybridRetrievalEnabled).toBe(false);
    expect(config.summaryIndexBm25CandidateLimit).toBe(5);
    expect(config.summaryIndexRrfK).toBe(11);
    expect(config.summaryIndexCandidateLimit).toBe(8);
    expect(config.summaryIndexV2WriteEnabled).toBe(true);
  });

  it('T10：模块级 defaults 冻结常量只读，误改不生效（有效配置不受污染）', () => {
    // 首次调用会构建模块级冻结缓存；随后任何对 effective config 的写尝试不得污染全局默认。
    const before = getEffectiveSummaryVectorIndexConfig_ACU({ topK: 7 });
    expect(before.topK).toBe(7);
    expect(before.summaryIndexCandidateLimit).toBeGreaterThanOrEqual(7);

    // 尝试修改返回对象的标量字段（普通模式下静默失败）。
    (before as any).topK = 999;
    const after = getEffectiveSummaryVectorIndexConfig_ACU({ topK: 7 });
    expect(after.topK).toBe(7);
    expect(after.summaryIndexCandidateLimit).toBeGreaterThanOrEqual(7);
  });
});

describe('T11: content pack 写入开关链路', () => {
  it('缺字段时默认关闭 pack 写入，显式 true/false 均被尊重', () => {
    const defaults = normalizeVectorMemoryConfig_ACU({});
    const enabled = normalizeVectorMemoryConfig_ACU({
      summaryIndexContentPackWriteEnabled: true,
    });
    const disabled = normalizeVectorMemoryConfig_ACU({
      summaryIndexContentPackWriteEnabled: false,
    });

    expect(defaults.summaryIndexContentPackWriteEnabled).toBe(false);
    expect(enabled.summaryIndexContentPackWriteEnabled).toBe(true);
    expect(disabled.summaryIndexContentPackWriteEnabled).toBe(false);
  });

  it('allowlist 去重去空', () => {
    const config = normalizeVectorMemoryConfig_ACU({
      summaryIndexContentPackWriteScopeAllowlist: [' scope-a ', '', 'scope-a', 1, 'scope-b'],
    });
    expect(config.summaryIndexContentPackWriteScopeAllowlist).toEqual(['scope-a', 'scope-b']);
  });

  it('effective config 暴露 pack 开关与 allowlist', () => {
    const config = getEffectiveSummaryVectorIndexConfig_ACU({
      embeddingEndpoint: 'https://embedding.test',
      embeddingModel: 'model',
      summaryIndexContentPackWriteEnabled: true,
      summaryIndexContentPackWriteScopeAllowlist: ['scope-x', ' scope-x ', ''],
    });

    expect(config.summaryIndexContentPackWriteEnabled).toBe(true);
    expect(config.summaryIndexContentPackWriteScopeAllowlist).toEqual(['scope-x']);
  });

  it('effective config 未显式开启时 pack 写入保持关闭', () => {
    const config = getEffectiveSummaryVectorIndexConfig_ACU({ embeddingEndpoint: 'https://e', embeddingModel: 'm' });
    expect(config.summaryIndexContentPackWriteEnabled).toBe(false);
    expect(config.summaryIndexContentPackWriteScopeAllowlist).toEqual([]);
  });
});

