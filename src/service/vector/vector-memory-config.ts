import { defaultVectorMemoryConfig_ACU } from '../../shared/defaults';
import { cleanChatName_ACU, normalizePositiveInteger_ACU } from '../../shared/utils';
import { normalizeRerankBatchSize_ACU, VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU } from '../../data/gateways/vector-rerank-gateway';
import { globalMeta_ACU, saveGlobalMeta_ACU } from '../../data/repositories/profile-repo';
import { currentChatFileIdentifier_ACU, settings_ACU } from '../runtime/state-manager';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { saveSettings_ACU } from '../settings/settings-service';

/**
 * 事务式更新全局向量配置字段：快照 → 修改 → 保存 → 失败回滚。
 * 权威配置位于 globalMeta.vectorMemoryConfigGlobal；settings_ACU.vectorMemoryConfig 同步投影。
 */
export function updateGlobalVectorMemoryConfigFields_ACU(
  patch: Partial<VectorMemoryConfig_ACU>,
): { ok: boolean; message?: string } {
  const config = getCurrentVectorMemoryConfig_ACU();
  const snapshot = JSON.parse(JSON.stringify(config));
  Object.assign(config as unknown as Record<string, unknown>, patch);
  const saveResult = saveSettings_ACU();
  if (!saveResult.saved) {
    Object.assign(config as unknown as Record<string, unknown>, snapshot);
    settings_ACU.vectorMemoryConfig = config;
    return {
      ok: false,
      message: saveResult.warning || saveResult.error || '保存失败，已回滚。',
    };
  }
  return { ok: true };
}

export interface VectorMemoryKeywordPromptSegment_ACU {
    role: string;
    content: string;
    deletable: boolean;
}

export interface VectorMemoryConfig_ACU {
    enabled: boolean;
    threshold: number;
    archiveTriggerCount: number;
    archiveBatchSize: number;
    archiveMaxConcurrency: number;
    topK: number;
    minScore: number;
    embeddingEndpoint: string;
    embeddingApiKey: string;
    embeddingModel: string;
    rerankEndpoint: string;
    rerankApiKey: string;
    rerankModel: string;
    rerankInstruction: string;
    rerankBatchSize: number;
    vectorNamespace: string;
    entryComment: string;
    entryKey: string;
    hybridRetrievalEnabled: boolean;
    bm25CandidateLimit: number;
    rrfK: number;
    summaryIndexKeywordMinRows: number;
    summaryChunkSentenceCount: number;
    summaryIndexChunkChronicleBySentence: boolean;
    summaryPromptGroupId: string;
    archiveWithoutSummary: boolean;
    summaryPromptGroup: VectorMemoryKeywordPromptSegment_ACU[];
    keywordApiPreset: string;
    keywordGenerationEnabled: boolean;
    keywordContextPairCount: number;
    keywordGenerationMaxAttempts: number;
    keywordPromptGroup: VectorMemoryKeywordPromptSegment_ACU[];
    recallCandidateLimit: number;
    recentFixedInjectCount: number;
    summaryIndexV2WriteEnabled: boolean;
    summaryIndexV2WriteScopeAllowlist: string[];
    summaryIndexRollingDeltaEnabled: boolean;
    summaryIndexRollingDeltaFoldThreshold: number;
    summaryIndexContentPackWriteEnabled: boolean;
    summaryIndexContentPackWriteScopeAllowlist: string[];
}

function normalizeArchiveTriggerCount_ACU(value: any, fallbackValue: number): number {
    const normalized = normalizePositiveInteger_ACU(value, fallbackValue);
    return Math.max(1, normalized);
}

export interface VectorMemoryConfigValidation_ACU {
    valid: boolean;
    errors: string[];
}

function cloneDefaultVectorMemoryConfig_ACU(): VectorMemoryConfig_ACU {
    return JSON.parse(JSON.stringify(defaultVectorMemoryConfig_ACU));
}

// T10：defaultVectorMemoryConfig_ACU 是编译期常量，运行时不变。
// effective config 只读取其标量默认值，无需每次调用都 JSON 深拷贝。
// 模块级只读缓存：任何调用方不得修改该对象；需要可变副本请用 cloneDefaultVectorMemoryConfig_ACU()。
const defaultEffectiveConfigFallback_ACU: any = (() => {
    const clone = cloneDefaultVectorMemoryConfig_ACU() as any;
    // 防误改：冻结后任何写操作在严格模式下抛错，普通模式下静默失败，能尽早暴露误用。
    Object.freeze(clone);
    return clone;
})();

function normalizeMinScore_ACU(value: any, fallbackValue: number): number {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallbackValue;
    if (num < 0) return 0;
    if (num > 1) return 1;
    return num;
}

function normalizeTextField_ACU(value: any, fallbackValue = ''): string {
    if (typeof value !== 'string') return fallbackValue;
    return value.trim();
}

function normalizeKeywordPromptGroup_ACU(
    value: any,
    fallbackValue: VectorMemoryKeywordPromptSegment_ACU[],
): VectorMemoryKeywordPromptSegment_ACU[] {
    if (!Array.isArray(value) || value.length === 0) {
        return JSON.parse(JSON.stringify(fallbackValue));
    }
    const validRoles = new Set(['system', 'assistant', 'user']);
    const segments: VectorMemoryKeywordPromptSegment_ACU[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const role = typeof item.role === 'string'
            ? item.role.toLowerCase().trim()
            : 'system';
        const content = typeof item.content === 'string'
            ? item.content.trim()
            : '';
        if (!content) continue;
        segments.push({
            role: validRoles.has(role) ? role : 'system',
            content,
            deletable: item.deletable !== false,
        });
    }
    return segments.length > 0
        ? segments
        : JSON.parse(JSON.stringify(fallbackValue));
}

function normalizeSummaryIndexV2WriteScopeAllowlist_ACU(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)));
}

export function getDefaultVectorMemoryConfig_ACU(): VectorMemoryConfig_ACU {
    return cloneDefaultVectorMemoryConfig_ACU();
}

export function normalizeVectorMemoryConfig_ACU(rawConfig: any): VectorMemoryConfig_ACU {
    const defaults = cloneDefaultVectorMemoryConfig_ACU();
    const source = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
        ? rawConfig
        : {};

    const archiveBatchSize = normalizePositiveInteger_ACU(source.archiveBatchSize, defaults.archiveBatchSize);
    const archiveTriggerCount = normalizeArchiveTriggerCount_ACU(
        source.archiveTriggerCount,
        (defaults as any).archiveTriggerCount ?? archiveBatchSize,
    );
    const archiveMaxConcurrency = normalizePositiveInteger_ACU(
        source.archiveMaxConcurrency,
        (defaults as any).archiveMaxConcurrency ?? 3,
    );

    return {
        enabled: source.enabled === true,
        threshold: normalizePositiveInteger_ACU(source.threshold, defaults.threshold),
        archiveTriggerCount,
        archiveBatchSize,
        archiveMaxConcurrency,
        topK: normalizePositiveInteger_ACU(source.topK, defaults.topK),
        minScore: normalizeMinScore_ACU(source.minScore, defaults.minScore),
        embeddingEndpoint: normalizeTextField_ACU(source.embeddingEndpoint, defaults.embeddingEndpoint),
        embeddingApiKey: normalizeTextField_ACU(source.embeddingApiKey, defaults.embeddingApiKey),
        embeddingModel: normalizeTextField_ACU(source.embeddingModel, defaults.embeddingModel),
        rerankEndpoint: normalizeTextField_ACU((source as any).rerankEndpoint, (defaults as any).rerankEndpoint),
        rerankApiKey: normalizeTextField_ACU((source as any).rerankApiKey, (defaults as any).rerankApiKey),
        rerankModel: normalizeTextField_ACU((source as any).rerankModel, (defaults as any).rerankModel),
        rerankInstruction: typeof (source as any).rerankInstruction === 'string'
            ? (source as any).rerankInstruction.trim() : (defaults as any).rerankInstruction,
        rerankBatchSize: normalizeRerankBatchSize_ACU((source as any).rerankBatchSize, Number((defaults as any).rerankBatchSize) || VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU),
        vectorNamespace: normalizeTextField_ACU(source.vectorNamespace, defaults.vectorNamespace) || defaults.vectorNamespace,
        entryComment: normalizeTextField_ACU(source.entryComment, defaults.entryComment) || defaults.entryComment,
        entryKey: normalizeTextField_ACU(source.entryKey, defaults.entryKey) || defaults.entryKey,
        hybridRetrievalEnabled: (source as any).hybridRetrievalEnabled !== false,
        bm25CandidateLimit: normalizePositiveInteger_ACU(
            (source as any).bm25CandidateLimit,
            Number((defaults as any).bm25CandidateLimit) || Number((source as any).recallCandidateLimit) || defaults.recallCandidateLimit,
        ),
        rrfK: normalizePositiveInteger_ACU((source as any).rrfK, Number((defaults as any).rrfK) || 60),
        summaryIndexKeywordMinRows: normalizePositiveInteger_ACU(
            (source as any).summaryIndexKeywordMinRows,
            (defaults as any).summaryIndexKeywordMinRows || 100,
        ),
        summaryChunkSentenceCount: normalizePositiveInteger_ACU(source.summaryChunkSentenceCount, defaults.summaryChunkSentenceCount),
        summaryIndexChunkChronicleBySentence: (source as any).summaryIndexChunkChronicleBySentence === true,
        summaryPromptGroupId: normalizeTextField_ACU(source.summaryPromptGroupId, defaults.summaryPromptGroupId) || defaults.summaryPromptGroupId,
        archiveWithoutSummary: source.archiveWithoutSummary === true,
        summaryPromptGroup: normalizeKeywordPromptGroup_ACU(source.summaryPromptGroup, (defaults as any).summaryPromptGroup || []),
        keywordApiPreset: normalizeTextField_ACU(source.keywordApiPreset, defaults.keywordApiPreset),
        // 缺省视为开启：老配置没有这个字段，行为必须与升级前一致。
        keywordGenerationEnabled: (source as any).keywordGenerationEnabled !== false,
        keywordContextPairCount: normalizePositiveInteger_ACU(source.keywordContextPairCount, defaults.keywordContextPairCount),
        keywordGenerationMaxAttempts: normalizePositiveInteger_ACU((source as any).keywordGenerationMaxAttempts, (defaults as any).keywordGenerationMaxAttempts || 3),
        keywordPromptGroup: normalizeKeywordPromptGroup_ACU(source.keywordPromptGroup, defaults.keywordPromptGroup),
        recallCandidateLimit: normalizePositiveInteger_ACU(source.recallCandidateLimit, defaults.recallCandidateLimit),
        recentFixedInjectCount: normalizePositiveInteger_ACU(
            (source as any).recentFixedInjectCount,
            (defaults as any).recentFixedInjectCount || 50,
        ),
        summaryIndexV2WriteEnabled: typeof (source as any).summaryIndexV2WriteEnabled === 'boolean'
            ? (source as any).summaryIndexV2WriteEnabled
            : defaults.summaryIndexV2WriteEnabled !== false,
        summaryIndexV2WriteScopeAllowlist: normalizeSummaryIndexV2WriteScopeAllowlist_ACU((source as any).summaryIndexV2WriteScopeAllowlist),
        summaryIndexRollingDeltaEnabled: (source as any).summaryIndexRollingDeltaEnabled === true,
        summaryIndexRollingDeltaFoldThreshold: normalizePositiveInteger_ACU(
            (source as any).summaryIndexRollingDeltaFoldThreshold,
            (defaults as any).summaryIndexRollingDeltaFoldThreshold || 15,
        ),
        summaryIndexContentPackWriteEnabled: typeof (source as any).summaryIndexContentPackWriteEnabled === 'boolean'
            ? (source as any).summaryIndexContentPackWriteEnabled
            : defaults.summaryIndexContentPackWriteEnabled === true,
        summaryIndexContentPackWriteScopeAllowlist: normalizeSummaryIndexV2WriteScopeAllowlist_ACU((source as any).summaryIndexContentPackWriteScopeAllowlist),
    };
}

/**
 * 获取当前向量记忆/交火配置。
 *
 * 权威配置存储在 globalMeta_ACU.vectorMemoryConfigGlobal（跨 profile 全局）。
 * settings_ACU.vectorMemoryConfig 只保留为运行时投影，避免旧调用方崩溃。
 *
 * 返回的始终是经过 normalize 的完整配置对象。
 * 对返回值的直接修改会反映到 globalMeta_ACU.vectorMemoryConfigGlobal（引用），
 * 但不会自动持久化——需要调用 saveSettingsAndNotify_ACU() 或 saveGlobalMeta_ACU()。
 */
export function getCurrentVectorMemoryConfig_ACU(): VectorMemoryConfig_ACU {
    const metaConfig = globalMeta_ACU?.vectorMemoryConfigGlobal;
    if (metaConfig && typeof metaConfig === 'object' && !Array.isArray(metaConfig)) {
        const normalized = normalizeVectorMemoryConfig_ACU(metaConfig);
        Object.assign(metaConfig, normalized);
        settings_ACU.vectorMemoryConfig = metaConfig;
        return metaConfig as VectorMemoryConfig_ACU;
    }

    const profileConfig = settings_ACU.vectorMemoryConfig;
    if (profileConfig && typeof profileConfig === 'object' && !Array.isArray(profileConfig)) {
        const migrated = normalizeVectorMemoryConfig_ACU(profileConfig);
        globalMeta_ACU.vectorMemoryConfigGlobal = migrated;
        settings_ACU.vectorMemoryConfig = globalMeta_ACU.vectorMemoryConfigGlobal;
        saveGlobalMeta_ACU();
        return globalMeta_ACU.vectorMemoryConfigGlobal as VectorMemoryConfig_ACU;
    }

    // 兜底：全局配置不存在时（loadSettings 未覆盖到的边界情况），
    // 从当前角色的世界书配置迁移
    const worldbookConfig = getCurrentWorldbookConfig_ACU();
    const legacyConfig = worldbookConfig?.vectorMemory;
    const source = (legacyConfig && typeof legacyConfig === 'object' && !Array.isArray(legacyConfig))
        ? legacyConfig
        : {};

    const migrated = normalizeVectorMemoryConfig_ACU(source);
    globalMeta_ACU.vectorMemoryConfigGlobal = migrated;
    settings_ACU.vectorMemoryConfig = globalMeta_ACU.vectorMemoryConfigGlobal;
    saveGlobalMeta_ACU();
    return globalMeta_ACU.vectorMemoryConfigGlobal as VectorMemoryConfig_ACU;
}

export function getVectorMemoryNamespace_ACU(chatFileIdentifier?: string | null): string {
    const config = getCurrentVectorMemoryConfig_ACU();
    const chatKey = cleanChatName_ACU(chatFileIdentifier || currentChatFileIdentifier_ACU || 'default');
    return `${config.vectorNamespace}:${chatKey}`;
}

export function hasVectorMemoryRerankConfig_ACU(configInput?: any): boolean {
    const config = normalizeVectorMemoryConfig_ACU(configInput ?? getCurrentVectorMemoryConfig_ACU());
    return !!(config.rerankEndpoint && config.rerankModel);
}

export function validateVectorMemoryRerankConfig_ACU(configInput?: any): VectorMemoryConfigValidation_ACU {
    const config = normalizeVectorMemoryConfig_ACU(configInput ?? getCurrentVectorMemoryConfig_ACU());
    const errors: string[] = [];
    const hasRerankEndpoint = !!config.rerankEndpoint;
    const hasRerankModel = !!config.rerankModel;

    if (!hasRerankEndpoint && !hasRerankModel) {
        return {
            valid: false,
            errors: [],
        };
    }

    if (hasRerankEndpoint !== hasRerankModel) {
        errors.push('rerankEndpoint 和 rerankModel 必须同时填写或同时留空');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

function collectVectorMemoryCommonErrors_ACU(config: VectorMemoryConfig_ACU): string[] {
    const errors: string[] = [];

    if (!config.embeddingEndpoint) {
        errors.push('缺少 embeddingEndpoint');
    }
    if (!config.embeddingModel) {
        errors.push('缺少 embeddingModel');
    }
    if (config.threshold < 1) {
        errors.push('threshold 必须大于 0');
    }
    if (config.archiveTriggerCount < 1) {
        errors.push('archiveTriggerCount 必须大于 0');
    }
    if (config.archiveBatchSize < 1) {
        errors.push('archiveBatchSize 必须大于 0');
    }
    if (config.archiveMaxConcurrency < 1) {
        errors.push('archiveMaxConcurrency 必须大于 0');
    }
    if (config.summaryChunkSentenceCount < 1) {
        errors.push('summaryChunkSentenceCount 必须大于 0');
    }
    if (!config.summaryPromptGroupId) {
        errors.push('缺少 summaryPromptGroupId');
    }
    if (config.recallCandidateLimit < config.topK) {
        errors.push('recallCandidateLimit 不能小于 topK');
    }
    if (config.bm25CandidateLimit < 1) {
        errors.push('bm25CandidateLimit 必须大于 0');
    }
    if (config.rrfK < 1) {
        errors.push('rrfK 必须大于 0');
    }

    return errors;
}

export function validateVectorIndexBuildConfig_ACU(configInput?: any): VectorMemoryConfigValidation_ACU {
    const config = normalizeVectorMemoryConfig_ACU(configInput ?? getCurrentVectorMemoryConfig_ACU());
    const errors = collectVectorMemoryCommonErrors_ACU(config);

    return {
        valid: errors.length === 0,
        errors,
    };
}

export function validateVectorMemoryConfig_ACU(configInput?: any): VectorMemoryConfigValidation_ACU {
    const config = normalizeVectorMemoryConfig_ACU(configInput ?? getCurrentVectorMemoryConfig_ACU());
    const errors = collectVectorMemoryCommonErrors_ACU(config);

    if (!config.entryComment) {
        errors.push('缺少 entryComment');
    }
    if (!config.entryKey) {
        errors.push('缺少 entryKey');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

export interface SummaryVectorIndexEffectiveConfig_ACU extends VectorMemoryConfig_ACU {
    summaryIndexMinScore: number;
    summaryIndexCandidateLimit: number;
    summaryIndexChunkSentenceCount: number;
    summaryIndexArchiveMaxConcurrency: number;
    summaryIndexArchiveEmbeddingConcurrency: number;
    summaryIndexKeywordMinRows: number;
    summaryIndexRecentFixedInjectCount: number;
    summaryIndexHybridRetrievalEnabled: boolean;
    summaryIndexBm25CandidateLimit: number;
    summaryIndexRrfK: number;
    summaryIndexV2WriteEnabled: boolean;
    summaryIndexV2WriteScopeAllowlist: string[];
    summaryIndexRollingDeltaEnabled: boolean;
    summaryIndexRollingDeltaFoldThreshold: number;
    summaryIndexContentPackWriteEnabled: boolean;
    summaryIndexContentPackWriteScopeAllowlist: string[];
}

export function getEffectiveSummaryVectorIndexConfig_ACU(configInput?: any): SummaryVectorIndexEffectiveConfig_ACU {
    const config = normalizeVectorMemoryConfig_ACU(configInput ?? getCurrentVectorMemoryConfig_ACU());
    const defaults = defaultEffectiveConfigFallback_ACU;
    const topK = normalizePositiveInteger_ACU(config.topK, defaults.topK);
    const minScore = normalizeMinScore_ACU(config.minScore, defaults.minScore);
    const recallCandidateLimit = Math.max(
        topK,
        normalizePositiveInteger_ACU(config.recallCandidateLimit, defaults.recallCandidateLimit || topK),
    );
    const summaryChunkSentenceCount = normalizePositiveInteger_ACU(
        config.summaryChunkSentenceCount,
        defaults.summaryChunkSentenceCount || 2,
    );
    const summaryIndexArchiveMaxConcurrency = normalizePositiveInteger_ACU(
        (config as any).summaryIndexArchiveMaxConcurrency,
        Number(defaults.summaryIndexArchiveMaxConcurrency) || 30,
    );
    // T9：归档 embedding 批次的有界并发度（同时进行中的批次上限）。独立于 summaryIndexArchiveMaxConcurrency（批大小）。
    const summaryIndexArchiveEmbeddingConcurrency = normalizePositiveInteger_ACU(
        (config as any).summaryIndexArchiveEmbeddingConcurrency,
        Number((defaults as any).summaryIndexArchiveEmbeddingConcurrency) || 3,
    );
    const summaryIndexKeywordMinRows = normalizePositiveInteger_ACU(
        (config as any).summaryIndexKeywordMinRows,
        Number((defaults as any).summaryIndexKeywordMinRows) || 100,
    );
    const recentFixedInjectCount = normalizePositiveInteger_ACU(
        (config as any).recentFixedInjectCount,
        Number((defaults as any).recentFixedInjectCount) || 50,
    );
    const bm25CandidateLimit = Math.max(
        1,
        normalizePositiveInteger_ACU(
            (config as any).bm25CandidateLimit,
            Number((defaults as any).bm25CandidateLimit) || recallCandidateLimit,
        ),
    );
    const rrfK = normalizePositiveInteger_ACU((config as any).rrfK, Number((defaults as any).rrfK) || 60);
    const summaryIndexRollingDeltaFoldThreshold = normalizePositiveInteger_ACU(
        (config as any).summaryIndexRollingDeltaFoldThreshold,
        Number((defaults as any).summaryIndexRollingDeltaFoldThreshold) || 15,
    );
    return {
        ...config,
        enabled: true,
        minScore,
        topK,
        recallCandidateLimit,
        summaryChunkSentenceCount,
        summaryIndexMinScore: minScore,
        summaryIndexCandidateLimit: recallCandidateLimit,
        summaryIndexChunkSentenceCount: summaryChunkSentenceCount,
        summaryIndexArchiveMaxConcurrency,
        summaryIndexArchiveEmbeddingConcurrency,
        summaryIndexKeywordMinRows,
        summaryIndexRecentFixedInjectCount: recentFixedInjectCount,
        summaryIndexHybridRetrievalEnabled: config.hybridRetrievalEnabled !== false,
        summaryIndexBm25CandidateLimit: bm25CandidateLimit,
        summaryIndexRrfK: rrfK,
        summaryIndexV2WriteEnabled: config.summaryIndexV2WriteEnabled === true,
        summaryIndexV2WriteScopeAllowlist: normalizeSummaryIndexV2WriteScopeAllowlist_ACU((config as any).summaryIndexV2WriteScopeAllowlist),
        summaryIndexRollingDeltaEnabled: (config as any).summaryIndexRollingDeltaEnabled === true,
        summaryIndexRollingDeltaFoldThreshold,
        summaryIndexContentPackWriteEnabled: config.summaryIndexContentPackWriteEnabled === true,
        summaryIndexContentPackWriteScopeAllowlist: normalizeSummaryIndexV2WriteScopeAllowlist_ACU((config as any).summaryIndexContentPackWriteScopeAllowlist),
    };
}

export function validateSummaryVectorIndexConfig_ACU(configInput?: any): VectorMemoryConfigValidation_ACU {
    const config = getEffectiveSummaryVectorIndexConfig_ACU(configInput);
    const errors: string[] = [];
    if (!config.embeddingEndpoint) {
        errors.push('缺少 embeddingEndpoint');
    }
    if (!config.embeddingModel) {
        errors.push('缺少 embeddingModel');
    }
    if (config.summaryIndexKeywordMinRows < 1) {
        errors.push('summaryIndexKeywordMinRows 必须大于 0');
    }
    if (config.summaryIndexBm25CandidateLimit < 1) {
        errors.push('bm25CandidateLimit 必须大于 0');
    }
    if (config.summaryIndexRollingDeltaFoldThreshold < 1) {
        errors.push('summaryIndexRollingDeltaFoldThreshold 必须大于 0');
    }
    if (config.summaryIndexRrfK < 1) {
        errors.push('rrfK 必须大于 0');
    }
    const rerankValidation = validateVectorMemoryRerankConfig_ACU(config);
    errors.push(...rerankValidation.errors);
    return {
        valid: errors.length === 0,
        errors,
    };
}

export function isVectorMemoryEnabled_ACU(configInput?: any): boolean {
    const config = normalizeVectorMemoryConfig_ACU(configInput ?? getCurrentVectorMemoryConfig_ACU());
    if (!config.enabled) return false;
    return validateVectorMemoryConfig_ACU(config).valid;
}

export function setSummaryVectorIndexRollingDeltaEnabled_ACU(
    enabled: boolean,
    foldThreshold?: number,
): { enabled: boolean; foldThreshold: number } {
    const config = getCurrentVectorMemoryConfig_ACU();
    config.summaryIndexRollingDeltaEnabled = enabled === true;
    if (foldThreshold != null && Number.isFinite(Number(foldThreshold)) && Number(foldThreshold) >= 1) {
        config.summaryIndexRollingDeltaFoldThreshold = Math.floor(Number(foldThreshold));
    }
    saveGlobalMeta_ACU();
    const status = {
        enabled: config.summaryIndexRollingDeltaEnabled === true,
        foldThreshold: Math.max(1, Math.floor(Number(config.summaryIndexRollingDeltaFoldThreshold) || 15)),
    };
    return status;
}

try {
    if (typeof window !== 'undefined') {
        (window as any).ACU_setCrossfireRollingDelta = setSummaryVectorIndexRollingDeltaEnabled_ACU;
        (window as any).ACU_getCrossfireRollingDelta = () => {
            const config = getCurrentVectorMemoryConfig_ACU();
            return {
                enabled: config.summaryIndexRollingDeltaEnabled === true,
                foldThreshold: Math.max(1, Math.floor(Number(config.summaryIndexRollingDeltaFoldThreshold) || 15)),
            };
        };
    }
} catch (_) {}
