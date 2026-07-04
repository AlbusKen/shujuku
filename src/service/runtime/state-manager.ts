/**
 * service/runtime/state-manager.ts — Re-export 门面
 * 
 * 此文件已拆分为三处：
 * - shared/host-api.ts        — 宿主 API 引用（SillyTavern_API、jQuery_API 等）
 * - presentation/state/ui-refs.ts — UI jQuery 元素引用（$popupInstance、$xxx 等）
 * - 本文件保留                — 业务状态 + 门控逻辑（settings、generationGate 等）
 * 
 * 为保持向后兼容，本文件 re-export 所有三处的符号。
 * 后续逐步将各文件的 import 路径改为直接引用新位置。
 */

// ═══ 宿主 API re-export 已移除 ═══
// 消费方应直接从 shared/host-api import 宿主 API 符号

// ═══ ui-refs re-export 已移除（P5）═══
// 消费方应直接从 presentation/state/ui-refs import $xxx 变量

// ═══ 业务状态 + 门控逻辑（保留在本文件） ═══

import { DEFAULT_CHAR_CARD_PROMPT_ACU, DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU, DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import { DEFAULT_AUTO_UPDATE_FREQUENCY_ACU, DEFAULT_AUTO_UPDATE_THRESHOLD_ACU, DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU, DEFAULT_CHECKPOINT_CUMULATIVE_OPERATION_RATIO_PERCENT_ACU, DEFAULT_CHECKPOINT_MAX_ENTRIES_AFTER_CHECKPOINT_ACU, DEFAULT_CHECKPOINT_MAX_OPERATION_COUNT_AFTER_CHECKPOINT_ACU, DEFAULT_CHECKPOINT_MAX_OPERATION_KB_AFTER_CHECKPOINT_ACU, DEFAULT_CHECKPOINT_SINGLE_OPERATION_RATIO_PERCENT_ACU } from '../../shared/defaults';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { globalMeta_ACU } from '../../data/repositories/profile-repo';

export const NEW_MESSAGE_DEBOUNCE_DELAY_ACU = 500;

export let pendingBaseStatePlacement_ACU = false;
export let suppressWorldbookInjectionInGreeting_ACU = false;

export const loopState_ACU = {
  isLooping: false,
  isRetrying: false,
  timerId: null as ReturnType<typeof setTimeout> | null,
  retryCount: 0,
  startTime: 0,
  totalDuration: 0,
  tickInterval: null as ReturnType<typeof setInterval> | null,
  awaitingReply: false,
};

export const planningGuard_ACU = {
  inProgress: false,
  ignoreNextGenerationEndedCount: 0,
};

export let abortController_ACU: any = null;
export let isProcessing_Plot_ACU = false;
export let tempPlotToSave_ACU: any = null;
export let pendingFinalGenerationGreenlights_ACU: any[] = [];

export const USER_SEND_TRIGGER_TTL_MS_ACU = 12000;
export const generationGate_ACU = {
  lastUserMessageId: null as number | null,
  lastUserMessageText: '',
  lastUserMessageAt: 0,
  lastUserSendIntentAt: 0,
  lastGeneration: null as any,
  lastForegroundGeneration: null as any,
  lastProcessedForegroundGenerationAt: 0,
  lastProcessedAutoTableMessageSignature: '',
};

function isInternalExtensionGeneration_ACU(params: any) {
  return params?.requestScope === 'extension_internal'
      || params?.request_scope === 'extension_internal'
      || params?._requestScope === 'extension_internal';
}

export function markUserSendIntent_ACU() {
  generationGate_ACU.lastUserSendIntentAt = Date.now();
}

export function isRecentUserSendIntent_ACU() {
  if (!generationGate_ACU.lastUserSendIntentAt) return false;
  return (Date.now() - generationGate_ACU.lastUserSendIntentAt) <= USER_SEND_TRIGGER_TTL_MS_ACU;
}

export function recordLastUserSend_ACU(messageId: any) {
  try {
    const chat = getChatArray_ACU();
    const msg = (chat && typeof messageId === 'number') ? chat[messageId] : null;
    if (!msg || !msg.is_user) return;
    generationGate_ACU.lastUserMessageId = messageId;
    generationGate_ACU.lastUserMessageText = String(msg.mes || '');
    generationGate_ACU.lastUserMessageAt = Date.now();
  } catch (e) {
    // ignore
  }
}

export function recordGenerationContext_ACU(type: any, params: any, dryRun: any) {
  const ctx = { type, params, dryRun, at: Date.now() };
  generationGate_ACU.lastGeneration = ctx;

  if (!dryRun && !isQuietLikeGeneration_ACU(type, params) && !isInternalExtensionGeneration_ACU(params)) {
    generationGate_ACU.lastForegroundGeneration = ctx;
  }
}

export function isQuietLikeGeneration_ACU(type: any, params: any) {
  if (type === 'quiet') return true;
  if (params && typeof params.quiet_prompt === 'string' && params.quiet_prompt.trim().length > 0) return true;
  return false;
}

export function isRecentUserSend_ACU() {
  if (!generationGate_ACU.lastUserMessageAt) return false;
  return (Date.now() - generationGate_ACU.lastUserMessageAt) <= USER_SEND_TRIGGER_TTL_MS_ACU;
}

function hasFreshUserGenerationTrigger_ACU() {
  const chat = getChatArray_ACU();
  const id = generationGate_ACU.lastUserMessageId;
  const msg = (chat && typeof id === 'number') ? chat[id] : null;
  const hasFreshUserMessage = !!(msg && msg.is_user && id === (chat.length - 1) && isRecentUserSend_ACU());
  const hasFreshIntent = isRecentUserSendIntent_ACU();
  return { hasFreshUserMessage, hasFreshIntent, result: hasFreshUserMessage || hasFreshIntent };
}

export function shouldProcessPlotForGeneration_ACU(type: any, params: any, dryRun: any) {
  if (dryRun) return false;
  if (!settings_ACU?.plotSettings?.enabled) return false;
  if (isQuietLikeGeneration_ACU(type, params)) return false;
  if (params?.automatic_trigger) return false;
  const fresh = hasFreshUserGenerationTrigger_ACU();
  logDebug_ACU(`[状态管理] shouldProcessPlot: type=${type}, dryRun=${dryRun}, freshMsg=${fresh.hasFreshUserMessage}, freshIntent=${fresh.hasFreshIntent}, result=${fresh.result}`);
  return fresh.result;
}

export function shouldProcessSummaryVectorIndexForGeneration_ACU(type: any, params: any, dryRun: any) {
  if (dryRun) return false;
  if (type === 'regenerate') return false;
  if (isQuietLikeGeneration_ACU(type, params)) return false;
  if (params?.automatic_trigger) return false;
  const worldbookConfig = getCurrentWorldbookConfig_ACU();
  const globalEnabled = globalMeta_ACU?.summaryVectorIndexModeGlobal === true;
  const worldbookProjectionEnabled = worldbookConfig.summaryVectorIndexModeEnabled === true;
  if (!globalEnabled) {
    logDebug_ACU(`[状态管理] shouldProcessSummaryVectorIndex: type=${type}, dryRun=${dryRun}, globalEnabled=false, worldbookProjection=${worldbookProjectionEnabled}, result=false`);
    return false;
  }
  const fresh = hasFreshUserGenerationTrigger_ACU();
  logDebug_ACU(`[状态管理] shouldProcessSummaryVectorIndex: type=${type}, dryRun=${dryRun}, globalEnabled=${globalEnabled}, worldbookProjection=${worldbookProjectionEnabled}, freshMsg=${fresh.hasFreshUserMessage}, freshIntent=${fresh.hasFreshIntent}, result=${fresh.result}`);
  return fresh.result;
}

function getAssistantMessageSignature_ACU(messageId?: any): string {
  const chat = getChatArray_ACU();
  if (!Array.isArray(chat) || chat.length === 0) return '';

  const explicitIndex = Number(messageId);
  let index = Number.isInteger(explicitIndex) ? explicitIndex : -1;

  let msg = index >= 0 ? chat[index] : null;

  // Fallback for swipe / Luker / extension-ended paths:
  // GENERATION_ENDED may arrive after MVU quiet generation, with no useful message_id.
  if (!msg || msg.is_user) {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i] && !chat[i].is_user) {
        index = i;
        msg = chat[i];
        break;
      }
    }
  }

  if (!msg || msg.is_user) return '';

  const swipeId = msg.swipe_id ?? msg.swipeId ?? '';
  const swipeCount = Array.isArray(msg.swipes) ? msg.swipes.length : '';
  const mes = String(msg.mes || '');

  return `${index}:${swipeId}:${swipeCount}:${mes}`;
}

export function shouldProcessAutoTableUpdateForGenerationEnded_ACU(messageId?: any) {
  const messageSignature = getAssistantMessageSignature_ACU(messageId);

  if (messageSignature) {
    if (generationGate_ACU.lastProcessedAutoTableMessageSignature === messageSignature) {
      return false;
    }

    generationGate_ACU.lastProcessedAutoTableMessageSignature = messageSignature;
    return true;
  }

  const fg = generationGate_ACU.lastForegroundGeneration;
  const latest = generationGate_ACU.lastGeneration;

  const useForeground =
    fg &&
    fg.at !== generationGate_ACU.lastProcessedForegroundGenerationAt &&
    latest &&
    isQuietLikeGeneration_ACU(latest.type, latest.params);

  const g = useForeground ? fg : latest;

  if (useForeground) {
    generationGate_ACU.lastProcessedForegroundGenerationAt = fg.at;
  }

  if (!g) return true;
  if (g.dryRun) return false;
  if (isQuietLikeGeneration_ACU(g.type, g.params)) return false;
  return true;
}

// ═══ 业务运行时状态 ═══
export let coreApisAreReady_ACU = false;
export let allChatMessages_ACU: any[] = [];
export let lastTotalAiMessages_ACU = 0;
export let currentChatFileIdentifier_ACU: any = 'unknown_chat_init';
export let currentJsonTableData_ACU: any = null;
export let independentTableStates_ACU: any = {};

export let settings_ACU: any = {
    apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1.0 },
    apiMode: 'custom',
    streamingEnabled: false,
    tavernProfile: '',
    apiPresets: [],
    tableApiPreset: '',
    plotApiPreset: '',
    strictJsonTableFillEnabled: false,
    // [剧情推进] 按剧情任务ID保存的任务级 API 预设覆盖（key=taskId, value=presetName）
    // 不保存入聊天记录或剧情推进预设，只写进插件全局设置。
    plotTaskApiPresetOverridesById: {} as Record<string, string>,
    // [新增] 按表格名称保存的表级 API 预设覆盖（key=标准化表名, value=presetName）
    tableApiPresetOverridesByName: {} as Record<string, string>,
    charCardPrompt: DEFAULT_CHAR_CARD_PROMPT_ACU,
    strictJsonCharCardPrompt: DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU,
    strictJsonSqlCharCardPrompt: DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU,
    autoUpdateThreshold: DEFAULT_AUTO_UPDATE_THRESHOLD_ACU,
    autoUpdateFrequency: DEFAULT_AUTO_UPDATE_FREQUENCY_ACU,
    autoUpdateTokenThreshold: DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU,
    updateBatchSize: 3,
    maxConcurrentGroups: 1,
    autoUpdateEnabled: true,
    standardizedTableFillEnabled: true,
    toastMuteEnabled: false,
    plotSettings: JSON.parse(JSON.stringify(DEFAULT_PLOT_SETTINGS_ACU)),
    plotPresetBindings: {},
    currentTemplatePresetName: '',
    tableContextExtractTags: '',
    tableContextExtractRules: [],
    tableContextExcludeTags: '',
    tableContextExcludeRules: [],
    tableEditLastPairOnly: true,
    tableMaxRetries: 3,
    importSplitSize: 10000,
    skipUpdateFloors: 0,
    retainRecentLayers: 100,
    checkpointMaxEntriesAfterCheckpoint: DEFAULT_CHECKPOINT_MAX_ENTRIES_AFTER_CHECKPOINT_ACU,
    checkpointMaxOperationKbAfterCheckpoint: DEFAULT_CHECKPOINT_MAX_OPERATION_KB_AFTER_CHECKPOINT_ACU,
    checkpointMaxOperationCountAfterCheckpoint: DEFAULT_CHECKPOINT_MAX_OPERATION_COUNT_AFTER_CHECKPOINT_ACU,
    checkpointCumulativeOperationRatioPercent: DEFAULT_CHECKPOINT_CUMULATIVE_OPERATION_RATIO_PERCENT_ACU,
    checkpointSingleOperationRatioPercent: DEFAULT_CHECKPOINT_SINGLE_OPERATION_RATIO_PERCENT_ACU,
    tableKeyOrder: [],
    manualSelectedTables: [],
    hasManualSelection: false,
    importSelectedTables: [],
    hasImportTableSelection: false,
    tableUpdateLocks: {},
    specialIndexLocks: {},
    importWorldbookTarget: '',
    importPromptExcludeImportedWorldbookEntries: true,
    zeroTkOccupyModeDefault: false,
    dataIsolationEnabled: false,
    dataIsolationCode: '',
    dataIsolationHistory: [],
    promptTemplateSettings: {
      enabled: true,
      maxNestingDepth: 10,
      debugMode: false
    },
    contentOptimizationSettings: {
      enabled: false,
      apiPreset: '',
      seamlessMode: true,
      autoApply: true,
      showDiff: true,
      minLength: 100,
      maxOptimizations: 10,
      loopCount: 1,
      retryCount: 3,
      promptGroup: [],
    },
    characterSettings: {},
};

export function getCurrentIsolationKey_ACU() {
    return settings_ACU.dataIsolationEnabled ? (settings_ACU.dataIsolationCode || '') : '';
}

// ═══ Setter 函数 ═══
export function _set_settings_ACU(v: any) { settings_ACU = v; }
export function _set_currentJsonTableData_ACU(v: any) { currentJsonTableData_ACU = v; }
export function _set_currentChatFileIdentifier_ACU(v: any) {
  logDebug_ACU(`[状态管理] 切换聊天标识: ${currentChatFileIdentifier_ACU} -> ${v}`);
  currentChatFileIdentifier_ACU = v;
}
export function _set_coreApisAreReady_ACU(v: any) {
  logDebug_ACU(`[状态管理] coreApisAreReady: ${v}`);
  coreApisAreReady_ACU = v;
}
export function _set_allChatMessages_ACU(v: any) { allChatMessages_ACU = v; }
export function _set_lastTotalAiMessages_ACU(v: any) { lastTotalAiMessages_ACU = v; }
export function _set_isProcessing_Plot_ACU(v: any) { isProcessing_Plot_ACU = v; }
export function _set_abortController_ACU(v: any) { abortController_ACU = v; }
export function _set_tempPlotToSave_ACU(v: any) { tempPlotToSave_ACU = v; }
export function _set_pendingFinalGenerationGreenlights_ACU(v: any) { pendingFinalGenerationGreenlights_ACU = Array.isArray(v) ? v : []; }
export function _set_pendingBaseStatePlacement_ACU(v: any) { pendingBaseStatePlacement_ACU = v; }
export function _set_suppressWorldbookInjectionInGreeting_ACU(v: any) { suppressWorldbookInjectionInGreeting_ACU = v; }
export function _set_independentTableStates_ACU(v: any) { independentTableStates_ACU = v; }

// ═══ 从 plot-editors.ts 迁移的业务状态 ═══
export let isAutoUpdatingCard_ACU = false;
export let wasStoppedByUser_ACU = false;
export let newMessageDebounceTimer_ACU: any = null;
export let currentAbortController_ACU: any = null;
export let plotTaskEditorAutoSaveTimer_ACU: any = null;
export let activeAbortControllers_ACU = new Set<any>();
export let manualExtraHint_ACU = '';

export function trackAbortController_ACU(controller: any) {
    if (controller) activeAbortControllers_ACU.add(controller);
}
export function untrackAbortController_ACU(controller: any) {
    if (controller) activeAbortControllers_ACU.delete(controller);
}
export function abortAllActiveRequests_ACU() {
    logWarn_ACU(`[状态管理] abortAllActiveRequests: 中止 ${activeAbortControllers_ACU.size} 个活跃请求`);
    activeAbortControllers_ACU.forEach(controller => {
        try { controller.abort(); } catch (e) {}
    });
    activeAbortControllers_ACU.clear();
}

export function _set_currentAbortController_ACU(v: any) { currentAbortController_ACU = v; }
export function _set_isAutoUpdatingCard_ACU(v: any) { isAutoUpdatingCard_ACU = v; }
export function _set_manualExtraHint_ACU(v: any) { manualExtraHint_ACU = v; }
export function _set_wasStoppedByUser_ACU(v: any) { wasStoppedByUser_ACU = v; }
export function _set_newMessageDebounceTimer_ACU(v: any) { newMessageDebounceTimer_ACU = v; }
