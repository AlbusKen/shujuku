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
import { DEFAULT_AUTO_UPDATE_FREQUENCY_ACU, DEFAULT_AUTO_UPDATE_THRESHOLD_ACU, DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU } from '../../shared/defaults';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { globalMeta_ACU } from '../../data/repositories/profile-repo';

export const NEW_MESSAGE_DEBOUNCE_DELAY_ACU = 500;

// [触发修复] GENERATION_ENDED 后 AI 楼层有界物化等待参数。
// makeFirst 可能早于宿主把本轮 AI 回复追加进 chat；防抖回调发现尚未物化时，
// 最多重试 AI_MATERIALIZATION_MAX_RETRIES_ACU 次、每次间隔
// AI_MATERIALIZATION_RETRY_DELAY_MS_ACU，最大额外等待 300ms。
// 正常精确命中路径零等待，不影响既有响应。
export const AI_MATERIALIZATION_MAX_RETRIES_ACU = 3;
export const AI_MATERIALIZATION_RETRY_DELAY_MS_ACU = 100;

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
export const GENERATION_CONTEXT_TTL_MS_ACU = 60000;

export interface GenerationContext_ACU {
  seq: number;
  type: any;
  params: any;
  dryRun: any;
  at: number;
}

export const generationGate_ACU = {
  lastUserMessageId: null as number | null,
  lastUserMessageText: '',
  lastUserMessageAt: 0,
  lastUserSendIntentAt: 0,
  // 保留给旧调用方和诊断；自动填表不能再仅依赖这个可被其他插件覆写的单槽。
  lastGeneration: null as GenerationContext_ACU | null,
  generationSeq: 0,
  activeGenerations: [] as GenerationContext_ACU[],
};

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

function removeExpiredGenerationContexts_ACU(now = Date.now()): void {
  const earliestValidAt = now - GENERATION_CONTEXT_TTL_MS_ACU;
  generationGate_ACU.activeGenerations = generationGate_ACU.activeGenerations.filter(context => context.at >= earliestValidAt);
}

export function recordGenerationContext_ACU(type: any, params: any, dryRun: any): GenerationContext_ACU {
  const context: GenerationContext_ACU = {
    seq: ++generationGate_ACU.generationSeq,
    type,
    params,
    dryRun,
    at: Date.now(),
  };
  removeExpiredGenerationContexts_ACU(context.at);
  generationGate_ACU.activeGenerations.push(context);
  generationGate_ACU.lastGeneration = context;
  return context;
}

/**
 * 宿主的 GENERATION_STOPPED 不携带 generation id，只能关闭最近一个未结束生成。
 * 这比让陈旧上下文持续污染下一次 GENERATION_ENDED 更安全。
 */
export function discardLatestGenerationContext_ACU(): GenerationContext_ACU | null {
  removeExpiredGenerationContexts_ACU();
  return generationGate_ACU.activeGenerations.pop() || null;
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

/**
 * 消费与本次 GENERATION_ENDED 对应的最近生成上下文。
 * 事件 API 没有 generation id，因此按完成顺序（栈）配对；配合 makeFirst，避免其他插件在
 * 同一 ended 回调里新开 quiet 生成后覆盖当前正文生成的判定。
 */
export function consumeGenerationContextForEnded_ACU(): GenerationContext_ACU | null {
  removeExpiredGenerationContexts_ACU();
  const activeContext = generationGate_ACU.activeGenerations.pop();
  // lastGeneration 仅保留给旧调用方。已有受追踪生成全部消费后，不能重复使用最后一个
  // quiet 上下文，否则下一次无关 GENERATION_ENDED 会被持续误拦截。
  return activeContext || (generationGate_ACU.generationSeq === 0 ? generationGate_ACU.lastGeneration : null);
}

export function shouldProcessAutoTableUpdateForGenerationEnded_ACU(context?: GenerationContext_ACU | null) {
  const g = context === undefined ? consumeGenerationContextForEnded_ACU() : context;
  if (!g) return true;
  if (g.dryRun) return false;
  if (isQuietLikeGeneration_ACU(g.type, g.params)) return false;
  if (g.params?.automatic_trigger) return false;
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
    apiConfig: { url: '', apiKey: '', model: '', useMainApi: true, max_tokens: 60000, temperature: 1.0, promptPostProcessing: 'strict' },
    apiMode: 'custom',
    streamingEnabled: false,
    tavernProfile: '',
    apiPresets: [],
    defaultApiPresetName: '',
    apiPresetBindingsByChat: {},
    tableApiPreset: '',
    plotApiPreset: '',
    strictJsonTableFillEnabled: false,
    discardUnauthorizedTableEditsEnabled: true,
    // [剧情推进] 按剧情任务ID保存的任务级 API 预设覆盖（key=taskId, value=presetName）
    // 不保存入聊天记录或剧情推进预设，只写进插件全局设置。
    plotTaskApiPresetOverridesById: {} as Record<string, string>,
    // [新增] 按表格名称保存的表级 API 预设覆盖（key=标准化表名, value=presetName）
    tableApiPresetOverridesByName: {} as Record<string, string>,
    charCardPrompt: DEFAULT_CHAR_CARD_PROMPT_ACU,
    strictJsonCharCardPrompt: DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU,
    strictJsonSqlCharCardPrompt: DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU,
    // [AI 改表助手] 可编辑提示词卡片段（空数组 = 使用默认硬编码提示词）
    templateAssistantPromptSegments: [] as any[],
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
    tableTemplateDefaultsRefreshVersion: '',
    tableFillPromptForceDefaultVersion: '',
    templateAssistantPromptForceDefaultVersion: '',
    strictJsonTableFillForceDisableVersion: '',
    tableContextExtractTags: '',
    tableContextExtractRules: [],
    tableContextExcludeTags: '',
    tableContextExcludeRules: [],
    tableEditLastPairOnly: true,
    tableMaxRetries: 3,
    importSplitSize: 10000,
    skipUpdateFloors: 0,
    retainRecentLayers: 100,
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
export let autoFillDebounceTimer_ACU: any = null;
export let chatMutationDebounceTimer_ACU: any = null;
export let currentAbortController_ACU: any = null;
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
export function _set_autoFillDebounceTimer_ACU(v: any) { autoFillDebounceTimer_ACU = v; }
export function _set_chatMutationDebounceTimer_ACU(v: any) { chatMutationDebounceTimer_ACU = v; }
