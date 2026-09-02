/**
 * service/vector/summary-vector-row-fingerprint.ts — 纪要行内容指纹的单一来源
 *
 * 所有行指纹必须经由这里计算，避免多处内联公式漂移。
 * 输入字段顺序与 join 分隔符不得变更：指纹参与增量归档的行复用判定
 * 与查询时的实时纪要表对账，公式漂移会导致全量行 mismatch（检索被永久 fail-closed）
 * 或复用判定失效（改行不重新 embedding）。
 *
 * 源文本进入指纹的方式是它的哈希（vectorSourceHash），而不是原文：
 * spv9.2 起源文本包含几百字纪要正文，行落盘时不再保存原文，只保存哈希。
 * 调用方可以只给 vectorSourceText（现算哈希）或只给 vectorSourceHash（已落盘的行）。
 *
 * 独立成模块的原因：archive-service 与 storage-service 都需要此公式，
 * 而两者已存在 archive → storage 的单向依赖，公式放任一侧都会成环。
 */

import { hashUserInput_ACU } from '../../shared/utils';

/** 源文本格式版本，参与指纹：版本变化即全部旧行 mismatch → 自动全量重建。 */
export const SUMMARY_VECTOR_SOURCE_TEXT_VERSION_ACU = 2;

export function hashSummaryVectorSourceText_ACU(vectorSourceText: string): string {
    return hashUserInput_ACU(String(vectorSourceText ?? ''));
}

export function buildSummaryRowFingerprint_ACU(source: {
    rowId: string;
    timeSpan: string;
    location: string;
    summary: string;
    indexCode: string;
    vectorSourceText?: string;
    vectorSourceHash?: string;
}): string {
    const sourceHash = source.vectorSourceHash || hashSummaryVectorSourceText_ACU(source.vectorSourceText ?? '');
    return hashUserInput_ACU([
        source.rowId,
        source.timeSpan,
        source.location,
        source.summary,
        source.indexCode,
        `v${SUMMARY_VECTOR_SOURCE_TEXT_VERSION_ACU}`,
        sourceHash,
    ].join('\n'));
}
