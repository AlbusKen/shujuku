/**
 * tests/service/vector/summary-vector-source-text.test.ts
 * spv9.2：向量源文本 = 概览 + 纪要正文；每行默认一个 chunk；旧格式索引识别；指纹随源文本版本变化。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: null,
  currentChatFileIdentifier_ACU: 'test-chat',
  getCurrentIsolationKey_ACU: () => '',
  settings_ACU: {},
}));
vi.mock('../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: () => [] }));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({ saveChatToHost_ACU: vi.fn(), saveChatToHostStrict_ACU: vi.fn() }));
vi.mock('../../../src/data/gateways/vector-embedding-gateway', () => ({
  createEmbeddings_ACU: vi.fn(),
  isVectorEmbeddingError_ACU: () => false,
  VectorEmbeddingError_ACU: class extends Error {},
}));
vi.mock('../../../src/data/storage/vector-index-hot-cache', () => ({
  assertSummaryVectorFlushGenerationCurrent_ACU: vi.fn(),
  SummaryVectorFlushGenerationInvalidatedError_ACU: class extends Error {},
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => ({}),
  validateSummaryVectorIndexConfig_ACU: () => ({ valid: true, errors: [] }),
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  loadSummaryVectorIndexChunksFromManifest_ACU: vi.fn(),
  persistSummaryVectorIndexSnapshot_ACU: vi.fn(),
  deleteSummaryVectorIndexExternal_ACU: vi.fn(),
  abortSummaryVectorIndexSnapshotPublication_ACU: vi.fn(),
  finalizeSummaryVectorIndexSnapshotPublication_ACU: vi.fn(),
  isLegacySummaryVectorIndexManifest_ACU: () => false,
  logSummaryVectorIndexIdentityEvent_ACU: vi.fn(),
  normalizeSummaryVectorIndexManifestForRead_ACU: (m: any) => m,
}));
vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedTagData_ACU: () => null,
  writeMessageIdentity_ACU: vi.fn(),
}));

import {
  buildPreparedRows_ACU,
  buildRowChunkTexts_ACU,
  buildSummaryVectorSourceText_ACU,
  isSummaryVectorIndexSourceTextOutdated_ACU,
  SUMMARY_VECTOR_SOURCE_TEXT_MAX_CHARS_ACU,
} from '../../../src/service/vector/summary-vector-index-archive-service';
import {
  buildSummaryRowFingerprint_ACU,
  hashSummaryVectorSourceText_ACU,
} from '../../../src/service/vector/summary-vector-row-fingerprint';

const HEADER = ['row_id', '时间跨度', '地点', '纪要', '概览', '编码索引'];

function table(rows: any[][]): any {
  return { name: '纪要表', content: [HEADER, ...rows] };
}

describe('buildSummaryVectorSourceText_ACU', () => {
  it('概览在前、纪要正文在后，用换行拼接', () => {
    expect(buildSummaryVectorSourceText_ACU(' 主角进城 ', '主角在黄昏时分到达王城，遇见了守门人。')).toBe('主角进城\n主角在黄昏时分到达王城，遇见了守门人。');
  });

  it('没有纪要正文时退化为只用概览', () => {
    expect(buildSummaryVectorSourceText_ACU('主角进城', '')).toBe('主角进城');
  });

  it('超长正文截断到上限', () => {
    const text = buildSummaryVectorSourceText_ACU('概览', 'x'.repeat(5000));
    expect(text.length).toBe(SUMMARY_VECTOR_SOURCE_TEXT_MAX_CHARS_ACU);
  });
});

describe('buildRowChunkTexts_ACU', () => {
  const source = '概览。第一句。第二句。第三句。第四句。';

  it('默认每行一个 chunk（不按句切分）', () => {
    expect(buildRowChunkTexts_ACU(source, { sentenceCount: 2, chunkBySentence: false })).toEqual([source]);
  });

  it('开启按句切分时按句数切块', () => {
    const chunks = buildRowChunkTexts_ACU(source, { sentenceCount: 2, chunkBySentence: true });
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe('概览。第一句。');
  });

  it('空文本没有 chunk', () => {
    expect(buildRowChunkTexts_ACU('  ', { sentenceCount: 2, chunkBySentence: false })).toEqual([]);
  });
});

describe('buildPreparedRows_ACU 源文本含纪要正文', () => {
  it('解析纪要列，源文本 = 概览 + 纪要，并带源文本哈希', () => {
    const prepared = buildPreparedRows_ACU(table([
      ['1', '第一天', '王城', '主角在黄昏时分到达王城，遇见了守门人老李，两人聊起了城中的传闻。', '主角进城', 'AM0001'],
    ]), 'sheet_summary');

    expect(prepared.error).toBe('');
    expect(prepared.rows).toHaveLength(1);
    const row = prepared.rows[0];
    expect(row.summary).toBe('主角进城');
    expect(row.chronicleText).toContain('守门人老李');
    expect(row.vectorSourceText).toBe(`主角进城\n${row.chronicleText}`);
    expect(row.vectorSourceHash).toBe(hashSummaryVectorSourceText_ACU(row.vectorSourceText));
    expect(row.sourceFingerprint).toBe(buildSummaryRowFingerprint_ACU(row));
  });

  it('模板没有纪要列时回退为只用概览（旧模板兼容）', () => {
    const prepared = buildPreparedRows_ACU({
      name: '纪要表',
      content: [
        ['row_id', '时间跨度', '地点', '概要', '编码索引'],
        ['1', '上午', '甲地', '第一次事件。', 'AM-0001'],
      ],
    }, 'sheet_summary');

    expect(prepared.rows[0].chronicleText).toBe('');
    expect(prepared.rows[0].vectorSourceText).toBe('第一次事件。');
  });

  it('只改纪要正文（概览不变）也会让指纹变化 → 增量归档会重新 embedding 该行', () => {
    const before = buildPreparedRows_ACU(table([['1', 't', 'l', '正文 A', '概览', 'AM0001']]), 'k').rows[0];
    const after = buildPreparedRows_ACU(table([['1', 't', 'l', '正文 B', '概览', 'AM0001']]), 'k').rows[0];
    expect(before.rowKey).toBe(after.rowKey);
    expect(before.sourceFingerprint).not.toBe(after.sourceFingerprint);
  });
});

describe('指纹与旧格式识别', () => {
  it('同一源文本，用原文或用哈希算出的指纹一致（落盘行只存哈希）', () => {
    const base = { rowId: '1', timeSpan: 't', location: 'l', summary: 's', indexCode: 'AM0001' };
    const text = 's\n正文';
    expect(buildSummaryRowFingerprint_ACU({ ...base, vectorSourceText: text }))
      .toBe(buildSummaryRowFingerprint_ACU({ ...base, vectorSourceText: '', vectorSourceHash: hashSummaryVectorSourceText_ACU(text) }));
  });

  it('旧格式行（无 vectorSourceHash、源文本=概览）与新公式指纹不同 → 旧索引全量重建', () => {
    const legacyRow = { rowId: '1', timeSpan: 't', location: 'l', summary: 's', indexCode: 'AM0001', vectorSourceText: 's' };
    const prepared = buildPreparedRows_ACU(table([['1', 't', 'l', '正文', 's', 'AM0001']]), 'k').rows[0];
    expect(buildSummaryRowFingerprint_ACU(legacyRow)).not.toBe(prepared.sourceFingerprint);
  });

  it('isSummaryVectorIndexSourceTextOutdated_ACU：有活跃行缺 vectorSourceHash 即视为旧格式', () => {
    expect(isSummaryVectorIndexSourceTextOutdated_ACU(null)).toBe(false);
    expect(isSummaryVectorIndexSourceTextOutdated_ACU({ rows: [] } as any)).toBe(false);
    expect(isSummaryVectorIndexSourceTextOutdated_ACU({ rows: [{ rowKey: 'a', status: 'active', vectorSourceHash: 'h' }] } as any)).toBe(false);
    expect(isSummaryVectorIndexSourceTextOutdated_ACU({ rows: [{ rowKey: 'a', status: 'active' }] } as any)).toBe(true);
    // 已移除的旧行不算。
    expect(isSummaryVectorIndexSourceTextOutdated_ACU({ rows: [{ rowKey: 'a', status: 'removed' }, { rowKey: 'b', status: 'active', vectorSourceHash: 'h' }] } as any)).toBe(false);
  });
});
