/**
 * useVectorIndexConfig — 交火模式（向量混合增强）页配置 + buildNow 编排。
 *
 * 边界：
 * - 读写权威配置：globalMeta_ACU.vectorMemoryConfigGlobal 通过
 *   getCurrentVectorMemoryConfig_ACU / updateGlobalVectorMemoryConfigFields_ACU 操作。
 * - 立即构建（buildNow）：调用 service 层统一的普通即时重建链路。
 * - Vue 组件只读写本 composable 暴露的 ref / form / 方法。
 */
import { computed, reactive, ref } from 'vue';
import {
  getCurrentVectorMemoryConfig_ACU,
  updateGlobalVectorMemoryConfigFields_ACU,
  validateSummaryVectorIndexConfig_ACU,
  type VectorMemoryConfig_ACU,
  type VectorMemoryKeywordPromptSegment_ACU,
} from '../../service/vector/vector-memory-config';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import {
  migrateLegacySummaryVectorIndexToContentAddressed_ACU,
} from '../../service/vector/summary-vector-index-archive-service';
import { rebuildCurrentSummaryVectorIndexNow_ACU } from '../../service/vector/summary-vector-index-rebuild-service';
import {
  getLatestSummaryVectorIndexSnapshotState_ACU,
} from '../../service/vector/summary-vector-index-state-service';
import {
  getSummaryVectorIndexStats_ACU,
  inspectSummaryVectorIndexHealth_ACU,
} from '../../service/vector/summary-vector-index-storage-service';
import { clearAllSummaryVectorIndexCaches_ACU } from '../../service/vector/summary-vector-index-cache-service';
import { deleteCurrentSummaryVectorIndexFromChat_ACU } from '../../service/vector/summary-vector-index-chat-service';
import { defaultVectorMemoryConfig_ACU } from '../../shared/defaults';
import type {
  SummaryVectorIndexHealthReport_ACU,
  SummaryVectorIndexStats_ACU,
} from '../../service/vector/summary-vector-index-types';
import { useToastStore } from '../stores/toast-store';

type MessageKind = 'info' | 'success' | 'warning' | 'error';
type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
type VectorMemoryConfigWithSummaryConcurrency = VectorMemoryConfig_ACU & {
  summaryIndexArchiveMaxConcurrency?: number;
};

function getDefaultVectorMemoryConfigForV2(): VectorMemoryConfigWithSummaryConcurrency {
  return defaultVectorMemoryConfig_ACU as VectorMemoryConfigWithSummaryConcurrency;
}

function getDefaultRecentFixedInjectCount(): number {
  const value = Number((getDefaultVectorMemoryConfigForV2() as any).recentFixedInjectCount);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 50;
}

function getDefaultRollingDeltaFoldThreshold(): number {
  const value = Number((getDefaultVectorMemoryConfigForV2() as any).summaryIndexRollingDeltaFoldThreshold);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 15;
}

export interface VectorIndexMessage {
  kind: MessageKind;
  text: string;
}

export interface VectorIndexForm {
  // Embedding
  embeddingEndpoint: string;
  embeddingModel: string;
  embeddingApiKey: string;
  // Rerank
  rerankEndpoint: string;
  rerankModel: string;
  rerankApiKey: string;
  // 召回参数
  summaryIndexKeywordMinRows: number;
  topK: number;
  minScore: number;
  recallCandidateLimit: number;
  recentFixedInjectCount: number;
  vectorNamespace: string;
  // 归档分块
  summaryChunkSentenceCount: number;
  summaryIndexChunkChronicleBySentence: boolean;
  summaryIndexArchiveMaxConcurrency: number;
  summaryIndexRollingDeltaEnabled: boolean;
  summaryIndexRollingDeltaFoldThreshold: number;
  summaryIndexV2WriteEnabled: boolean;
  summaryIndexV2WriteScopeAllowlistText: string;
  summaryIndexContentPackWriteEnabled: boolean;
  summaryIndexContentPackWriteScopeAllowlistText: string;
  // 关键词生成
  keywordGenerationEnabled: boolean;
  keywordApiPreset: string;
  keywordContextPairCount: number;
  keywordGenerationMaxAttempts: number;
}

export interface VectorIndexStatsItem {
  label: string;
  value: string | number;
  key?: string;
}

const STATUS_LABELS: Record<string, string> = {
  none: '未加载',
  building: '构建中',
  uploading: '上传中',
  ready: '可用',
  missing: '外置文件缺失',
  corrupt: '索引损坏',
  incompatible: '版本不兼容',
  upload_failed: '上传失败',
  rebuild_required: '需要重建',
  delete_pending: '等待删除',
  delete_failed: '删除失败',
  superseded: '已被新索引替代',
};

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  none: 'neutral',
  building: 'accent',
  uploading: 'accent',
  ready: 'success',
  missing: 'danger',
  corrupt: 'danger',
  incompatible: 'danger',
  upload_failed: 'danger',
  rebuild_required: 'warning',
  delete_pending: 'warning',
  delete_failed: 'danger',
  superseded: 'neutral',
};

function createEmptyForm(): VectorIndexForm {
  const defaults = getDefaultVectorMemoryConfigForV2();
  return {
    embeddingEndpoint: defaults.embeddingEndpoint || '',
    embeddingModel: defaults.embeddingModel || '',
    embeddingApiKey: defaults.embeddingApiKey || '',
    rerankEndpoint: defaults.rerankEndpoint || '',
    rerankModel: defaults.rerankModel || '',
    rerankApiKey: defaults.rerankApiKey || '',
    summaryIndexKeywordMinRows: defaults.summaryIndexKeywordMinRows,
    topK: defaults.topK,
    minScore: defaults.minScore,
    recallCandidateLimit: defaults.recallCandidateLimit,
    recentFixedInjectCount: defaults.recentFixedInjectCount,
    vectorNamespace: defaults.vectorNamespace || 'chat',
    summaryChunkSentenceCount: defaults.summaryChunkSentenceCount,
    summaryIndexChunkChronicleBySentence: (defaults as any).summaryIndexChunkChronicleBySentence === true,
    summaryIndexArchiveMaxConcurrency: defaults.summaryIndexArchiveMaxConcurrency ?? 30,
    summaryIndexRollingDeltaEnabled: defaults.summaryIndexRollingDeltaEnabled === true,
    summaryIndexRollingDeltaFoldThreshold: defaults.summaryIndexRollingDeltaFoldThreshold,
    summaryIndexV2WriteEnabled: defaults.summaryIndexV2WriteEnabled === true,
    summaryIndexV2WriteScopeAllowlistText: Array.isArray(defaults.summaryIndexV2WriteScopeAllowlist) ? defaults.summaryIndexV2WriteScopeAllowlist.join('\n') : '',
    summaryIndexContentPackWriteEnabled: defaults.summaryIndexContentPackWriteEnabled === true,
    summaryIndexContentPackWriteScopeAllowlistText: Array.isArray(defaults.summaryIndexContentPackWriteScopeAllowlist) ? defaults.summaryIndexContentPackWriteScopeAllowlist.join('\n') : '',
    keywordGenerationEnabled: (defaults as any).keywordGenerationEnabled !== false,
    keywordApiPreset: defaults.keywordApiPreset || '',
    keywordContextPairCount: defaults.keywordContextPairCount,
    keywordGenerationMaxAttempts: defaults.keywordGenerationMaxAttempts,
  };
}

function cloneSegments(
  segments: VectorMemoryKeywordPromptSegment_ACU[] | null | undefined,
): VectorMemoryKeywordPromptSegment_ACU[] {
  if (!Array.isArray(segments)) return [];
  return segments.map((seg) => ({
    role: typeof seg?.role === 'string' ? seg.role : 'system',
    content: typeof seg?.content === 'string' ? seg.content : '',
    deletable: seg?.deletable !== false,
  }));
}

function defaultKeywordPromptGroup(): VectorMemoryKeywordPromptSegment_ACU[] {
  return cloneSegments(
    (defaultVectorMemoryConfig_ACU as VectorMemoryConfig_ACU).keywordPromptGroup,
  );
}

function prepareKeywordPromptGroup(
  segments: VectorMemoryKeywordPromptSegment_ACU[],
): VectorMemoryKeywordPromptSegment_ACU[] {
  return segments
    .map((seg) => ({
      role: typeof seg.role === 'string' && seg.role.trim() ? seg.role.trim().toLowerCase() : 'system',
      content: typeof seg.content === 'string' ? seg.content : '',
      deletable: seg.deletable !== false,
    }))
    .filter((seg) => seg.content.trim().length > 0);
}

function promptFingerprint(segments: VectorMemoryKeywordPromptSegment_ACU[]): string {
  return JSON.stringify(prepareKeywordPromptGroup(segments).map((seg) => ({
    ...seg,
    content: seg.content.trim(),
  })));
}

export function useVectorIndexConfig() {
  const toast = useToastStore();
  const form = reactive<VectorIndexForm>(createEmptyForm());
  const promptSegments = ref<VectorMemoryKeywordPromptSegment_ACU[]>([]);
  const promptDirty = ref(false);
  const message = ref<VectorIndexMessage | null>(null);
  const validationErrors = ref<string[]>([]);
  const buildBusy = ref(false);
  const maintenanceBusy = ref(false);
  const statusLoading = ref(false);
  const indexStats = ref<SummaryVectorIndexStats_ACU | null>(null);
  const healthReport = ref<SummaryVectorIndexHealthReport_ACU | null>(null);
  const displayRowCount = ref(0);
  const displayChunkCount = ref(0);
  let progressToastId: string | null = null;

  function notify(kind: MessageKind, text: string, options: { durationMs?: number; muteable?: boolean } = {}): void {
    if (progressToastId) {
      if (toast.update(progressToastId, kind, text, options)) {
        if (options.durationMs !== 0) progressToastId = null;
        return;
      }
      progressToastId = null;
    }
    toast[kind](text, options);
  }

  function notifyProgress(text: string): void {
    if (progressToastId && toast.update(progressToastId, 'info', text, { durationMs: 0, muteable: false })) {
      return;
    }
    progressToastId = toast.info(text, { durationMs: 0, muteable: false });
  }

  function readFromConfig(): void {
    const config = getCurrentVectorMemoryConfig_ACU() as VectorMemoryConfigWithSummaryConcurrency;
    form.embeddingEndpoint = config.embeddingEndpoint || '';
    form.embeddingModel = config.embeddingModel || '';
    form.embeddingApiKey = config.embeddingApiKey || '';
    form.rerankEndpoint = config.rerankEndpoint || '';
    form.rerankModel = config.rerankModel || '';
    form.rerankApiKey = config.rerankApiKey || '';
    form.summaryIndexKeywordMinRows = config.summaryIndexKeywordMinRows;
    form.topK = config.topK;
    form.minScore = config.minScore;
    form.recallCandidateLimit = config.recallCandidateLimit;
    form.recentFixedInjectCount = config.recentFixedInjectCount;
    form.vectorNamespace = config.vectorNamespace || 'chat';
    form.summaryChunkSentenceCount = config.summaryChunkSentenceCount;
    form.summaryIndexChunkChronicleBySentence = config.summaryIndexChunkChronicleBySentence === true;
    form.summaryIndexArchiveMaxConcurrency = config.summaryIndexArchiveMaxConcurrency;
    form.summaryIndexRollingDeltaEnabled = config.summaryIndexRollingDeltaEnabled === true;
    form.summaryIndexRollingDeltaFoldThreshold = config.summaryIndexRollingDeltaFoldThreshold;
    form.summaryIndexV2WriteEnabled = config.summaryIndexV2WriteEnabled === true;
    form.summaryIndexV2WriteScopeAllowlistText = Array.isArray(config.summaryIndexV2WriteScopeAllowlist) ? config.summaryIndexV2WriteScopeAllowlist.join('\n') : '';
    form.summaryIndexContentPackWriteEnabled = config.summaryIndexContentPackWriteEnabled === true;
    form.summaryIndexContentPackWriteScopeAllowlistText = Array.isArray(config.summaryIndexContentPackWriteScopeAllowlist) ? config.summaryIndexContentPackWriteScopeAllowlist.join('\n') : '';
    form.keywordGenerationEnabled = config.keywordGenerationEnabled !== false;
    form.keywordApiPreset = config.keywordApiPreset || '';
    form.keywordContextPairCount = config.keywordContextPairCount;
    form.keywordGenerationMaxAttempts = config.keywordGenerationMaxAttempts;
    promptSegments.value = cloneSegments(config.keywordPromptGroup);
    promptDirty.value = false;
  }

  function refresh(): void {
    readFromConfig();
    runValidation();
  }

  function pushSavedMessage(text = '设置已保存。'): void {
    void text;
  }

  function runValidation(): boolean {
    const validation = validateSummaryVectorIndexConfig_ACU();
    validationErrors.value = validation.valid ? [] : [...validation.errors];
    return validation.valid;
  }

  function setApiField<
    K extends 'vectorNamespace' | 'keywordApiPreset',
  >(key: K, raw: string | number): void {
    const value = typeof raw === 'string' ? raw : String(raw ?? '');
    const next = key.endsWith('ApiKey') ? value : value.trim();
    (form as any)[key] = next;
    const result = updateGlobalVectorMemoryConfigFields_ACU({ [key]: next });
    if (!result.ok) {
      toast.error(result.message || '保存失败。');
      return;
    }
    runValidation();
    pushSavedMessage();
  }

  function setNumberField<
    K extends 'summaryIndexKeywordMinRows' | 'topK' | 'recallCandidateLimit'
      | 'recentFixedInjectCount' | 'summaryChunkSentenceCount'
      | 'summaryIndexArchiveMaxConcurrency' | 'keywordContextPairCount'
      | 'keywordGenerationMaxAttempts'
      | 'summaryIndexRollingDeltaFoldThreshold',
  >(key: K, raw: number | string): void {
    if (key === 'recentFixedInjectCount') {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        const fallback = getDefaultRecentFixedInjectCount();
        form.recentFixedInjectCount = Number.isFinite(value) ? Math.floor(value) : 0;
        toast.warning(`固定写入必须是正整数，已重置为默认值 ${fallback}。`);
        form.recentFixedInjectCount = fallback;
        const result = updateGlobalVectorMemoryConfigFields_ACU({
          recentFixedInjectCount: fallback,
        });
        if (!result.ok) {
          toast.error(result.message || '保存失败。');
          return;
        }
        runValidation();
        pushSavedMessage();
        return;
      }
    }
    if (key === 'summaryIndexRollingDeltaFoldThreshold') {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        const fallback = getDefaultRollingDeltaFoldThreshold();
        form.summaryIndexRollingDeltaFoldThreshold = fallback;
        toast.warning(`滚动增量折叠阈值必须是正整数，已重置为默认值 ${fallback}。`);
        const result = updateGlobalVectorMemoryConfigFields_ACU({
          summaryIndexRollingDeltaFoldThreshold: fallback,
        });
        if (!result.ok) {
          toast.error(result.message || '保存失败。');
          return;
        }
        runValidation();
        pushSavedMessage();
        return;
      }
    }
    const min = 1;
    const fallback = 1;
    const num = Math.max(min, Math.floor(Number(raw)) || fallback);
    (form as any)[key] = num;
    const result = updateGlobalVectorMemoryConfigFields_ACU({ [key]: num });
    if (!result.ok) {
      toast.error(result.message || '保存失败。');
      return;
    }
    runValidation();
    pushSavedMessage();
  }

  function setBooleanField<
    K extends 'summaryIndexRollingDeltaEnabled' | 'summaryIndexV2WriteEnabled' | 'summaryIndexContentPackWriteEnabled'
      | 'keywordGenerationEnabled' | 'summaryIndexChunkChronicleBySentence',
  >(key: K, value: boolean): void {
    const next = value === true;
    (form as any)[key] = next;
    const result = updateGlobalVectorMemoryConfigFields_ACU({ [key]: next });
    if (!result.ok) {
      toast.error(result.message || '保存失败。');
      return;
    }
    runValidation();
    pushSavedMessage();
  }

  function setV2WriteScopeAllowlist(raw: string): void {
    const normalized = Array.from(new Set(String(raw || '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)));
    form.summaryIndexV2WriteScopeAllowlistText = normalized.join('\n');
    const result = updateGlobalVectorMemoryConfigFields_ACU({ summaryIndexV2WriteScopeAllowlist: normalized });
    if (!result.ok) {
      toast.error(result.message || '保存失败。');
      return;
    }
    runValidation();
    pushSavedMessage();
  }

  function previewRecentFixedInjectCount(raw: number | string): void {
    const value = Number(raw);
    form.recentFixedInjectCount = Number.isFinite(value) ? Math.floor(value) : 0;
  }

  function setMinScore(raw: number | string): void {
    let num = Number(raw);
    if (!Number.isFinite(num)) num = 0;
    if (num < 0) num = 0;
    if (num > 1) num = 1;
    form.minScore = num;
    const result = updateGlobalVectorMemoryConfigFields_ACU({ minScore: num });
    if (!result.ok) {
      toast.error(result.message || '保存失败。');
      return;
    }
    runValidation();
    pushSavedMessage();
  }

  function addPromptSegment(position: 'top' | 'bottom'): void {
    const seg: VectorMemoryKeywordPromptSegment_ACU = {
      role: 'system',
      content: '',
      deletable: true,
    };
    const next = promptSegments.value.slice();
    if (position === 'top') next.unshift(seg);
    else next.push(seg);
    promptSegments.value = next;
    promptDirty.value = true;
  }

  function deletePromptSegment(index: number): void {
    const target = promptSegments.value[index];
    if (!target || target.deletable === false) return;
    const next = promptSegments.value.slice();
    next.splice(index, 1);
    promptSegments.value = next;
    promptDirty.value = true;
  }

  function updatePromptSegment(
    index: number,
    patch: Partial<VectorMemoryKeywordPromptSegment_ACU>,
  ): void {
    if (!promptSegments.value[index]) return;
    const next = promptSegments.value.map((seg, i) => {
      if (i !== index) return { ...seg };
      return { ...seg, ...patch };
    });
    promptSegments.value = next;
    promptDirty.value = true;
  }

  function savePromptGroup(): void {
    const segs = prepareKeywordPromptGroup(promptSegments.value);

    const result = updateGlobalVectorMemoryConfigFields_ACU({ keywordPromptGroup: segs });
    if (!result.ok) {
      toast.error(result.message || '保存失败。');
      return;
    }
    promptSegments.value = cloneSegments(segs);
    promptDirty.value = false;
    notify('success', '关键词生成提示词已保存');
  }


  function resetPromptGroup(): void {
    promptSegments.value = defaultKeywordPromptGroup();
    promptDirty.value = true;
    notify('warning', '已载入默认关键词提示词，保存后生效。');
  }

  function formatBytes(bytes: number): string {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  }

  function formatTime(value: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  async function refreshIndexStatus(notify = false): Promise<void> {
    statusLoading.value = true;
    try {
      const snapshot = getLatestSummaryVectorIndexSnapshotState_ACU();
      const state = snapshot?.summaryVectorIndexState || null;
      const [stats, health] = await Promise.all([
        getSummaryVectorIndexStats_ACU(state?.manifest || null),
        inspectSummaryVectorIndexHealth_ACU(),
      ]);
      indexStats.value = stats;
      healthReport.value = health;
      const stateRows = Array.isArray(state?.rows)
        ? state.rows.filter((row: any) => row?.status !== 'removed').length
        : 0;
      const stateChunks = Array.isArray(state?.chunks) ? state.chunks.length : 0;
      displayRowCount.value = stateRows > 0 ? stateRows : stats.rowCount;
      displayChunkCount.value = stateChunks > 0 ? stateChunks : stats.chunkCount;
      if (notify) toast.success('交火索引状态已刷新。');
    } catch (error: any) {
      toast.error(`交火索引状态读取失败：${error?.message || '未知错误'}`);
    } finally {
      statusLoading.value = false;
    }
  }

  async function clearIndexCache(): Promise<void> {
    if (maintenanceBusy.value) return;
    maintenanceBusy.value = true;
    try {
      await clearAllSummaryVectorIndexCaches_ACU();
      await refreshIndexStatus(false);
      notify('success', '交火索引临时缓存与热缓存已清空。权威外置文件和聊天记录不会被删除。', { muteable: false });
    } catch (error: any) {
      notify('error', `清空交火索引缓存失败：${error?.message || '未知错误'}`, { muteable: false });
    } finally {
      maintenanceBusy.value = false;
    }
  }

  async function deleteCurrentIndex(): Promise<void> {
    if (maintenanceBusy.value) return;
    maintenanceBusy.value = true;
    try {
      const changed = await deleteCurrentSummaryVectorIndexFromChat_ACU();
      await refreshIndexStatus(false);
      notify(
        changed ? 'success' : 'info',
        changed
          ? '当前聊天的交火索引已删除。需要使用时请重新构建。'
          : '当前聊天没有可删除的交火索引。',
        { muteable: false },
      );
    } catch (error: any) {
      notify('error', `删除当前交火索引失败：${error?.message || '未知错误'}`, { muteable: false });
    } finally {
      maintenanceBusy.value = false;
    }
  }

  async function migrateLegacyIndex(): Promise<void> {
    if (maintenanceBusy.value || buildBusy.value) return;
    maintenanceBusy.value = true;
    progressToastId = null;
    notifyProgress('正在检查旧交火索引...');
    try {
      const report = await inspectSummaryVectorIndexHealth_ACU();
      const legacyCount = report.legacyManifestCount || 0;
      if (legacyCount === 0) {
        notify('info', '当前没有可迁移的旧交火索引。', { muteable: false });
        return;
      }

      notifyProgress('正在迁移旧交火索引...');
      const result = await migrateLegacySummaryVectorIndexToContentAddressed_ACU();
      await refreshIndexStatus(false);
      if (result.success && !result.skipped) {
        notify('success', `旧交火索引非破坏迁移完成：${result.indexedRowCount || 0} 行，${result.chunkCount || 0} 个 chunks。新 V2 pointer 已 durable 发布；旧外置对象未在主提交路径删除，后续由安全 GC 处理。`, { muteable: false });
        return;
      }

      const reason = result.errors?.length
        ? result.errors.join('；')
        : (result.reason || '无可迁移内容');
      notify(result.success ? 'info' : 'warning', `旧交火索引迁移未执行：${reason}`, { muteable: false });
    } catch (error: any) {
      notify('error', `旧交火索引迁移失败：${error?.message || '未知错误'}`, { muteable: false });
    } finally {
      maintenanceBusy.value = false;
    }
  }

  async function buildNow(): Promise<void> {
    if (buildBusy.value) return;
    buildBusy.value = true;
    progressToastId = null;
    notifyProgress('正在重建交火索引快照...');
    try {
      const result = await rebuildCurrentSummaryVectorIndexNow_ACU();
      if (result.success && !result.skipped) {
        notify('success', `交火索引快照重建完成：${result.indexedRowCount || 0} 行，${result.chunkCount || 0} 个 chunks。`, { muteable: false });
        await refreshIndexStatus(false);
        return;
      }
      const reason = result.errors?.length
        ? result.errors.join('；')
        : (result.reason || '无可重建内容');
      notify(result.success ? 'info' : 'error', `交火索引快照未完成：${reason}`, { muteable: false });
    } catch (error: any) {
      notify('error', `交火索引快照重建失败：${error?.message || '未知错误'}`, { muteable: false });
    } finally {
      buildBusy.value = false;
    }
  }

  const hasValidationErrors = computed(() => validationErrors.value.length > 0);
  const currentStatusKey = computed(() => indexStats.value?.status || 'none');
  const statusLabel = computed(() => STATUS_LABELS[currentStatusKey.value] || currentStatusKey.value);
  const statusVariant = computed<BadgeVariant>(() => STATUS_VARIANTS[currentStatusKey.value] || 'neutral');
  const statusStatsItems = computed<VectorIndexStatsItem[]>(() => {
    const stats = indexStats.value;
    return [
      { label: '索引 ID', value: stats?.indexId || '—', key: 'indexId' },
      { label: '后端', value: stats?.backend || 'none' },
      { label: '行 / 分片', value: `${displayRowCount.value} / ${displayChunkCount.value}` },
      { label: 'Base / Delta', value: `${stats?.baseShardCount || 0} / ${stats?.deltaShardCount || 0}` },
      { label: 'Tombstone', value: `${stats?.tombstoneRowCount || 0} 行 / ${stats?.tombstoneChunkCount || 0} 块` },
      { label: '外置体积', value: formatBytes(stats?.externalTotalBytes || 0) },
      { label: '缓存体积', value: formatBytes(stats?.cacheTotalBytes || 0) },
      {
        label: '归档队列',
        value: `${(stats?.flushTaskDirtyCount || 0) + (stats?.flushTaskQueuedCount || 0) + (stats?.flushTaskFlushingCount || 0)} 等待 / ${stats?.flushTaskFailedCount || 0} 失败`,
      },
      {
        label: '身份健康',
        value: `${healthReport.value?.status || 'unknown'} / ${healthReport.value?.identityMismatchCount || 0} identity / ${healthReport.value?.pathIdentityCollisionCount || 0} collision / ${healthReport.value?.checksumMismatchCount || 0} checksum`,
      },
      {
        label: 'Legacy 待迁移',
        value: healthReport.value?.legacyManifestCount || 0,
      },
      { label: '更新时间', value: formatTime(stats?.updatedAt || ''), key: 'updatedAt' },
    ];
  });
  const promptTemplateMode = computed<'default' | 'custom'>(() =>
    promptFingerprint(promptSegments.value) === promptFingerprint(defaultKeywordPromptGroup())
      ? 'default'
      : 'custom',
  );

  refresh();

  return {
    form,
    promptSegments,
    promptDirty,
    message,
    validationErrors,
    hasValidationErrors,
    buildBusy,
    maintenanceBusy,
    statusLoading,
    indexStats,
    healthReport,
    statusLabel,
    statusVariant,
    statusStatsItems,
    promptTemplateMode,
    refresh,
    refreshIndexStatus,
    clearIndexCache,
    deleteCurrentIndex,
    migrateLegacyIndex,
    previewRecentFixedInjectCount,
    setApiField,
    setNumberField,
    setBooleanField,
    setV2WriteScopeAllowlist,
    setMinScore,
    addPromptSegment,
    deletePromptSegment,
    updatePromptSegment,
    savePromptGroup,
    resetPromptGroup,
    buildNow,
  };
}
