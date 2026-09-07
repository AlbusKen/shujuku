import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P1 因果复现：50 个 AI 楼层（旧随机 key 模板）→ 切同名异构模板（稳定 key）→
 * 下一轮填表 → 历史回放身份分叉。
 * 预期（修复前）红：template 输入的新 key 被塞进旧 key guide 的 sourceData.ddl，
 * 形成“持久身份旧 key + 物理表名新 key”的契约失配；V2 历史帧仍引用旧 key。
 */
const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  saveChat: vi.fn().mockResolvedValue(undefined),
  saveChatStrict: vi.fn().mockResolvedValue(undefined),
  chatIdentifier: 'repro-template-switch-replay-chat',
  isolationKey: '',
  settings: {
    storageMode: 'native',
    dataIsolationEnabled: false,
    dataIsolationCode: '',
  } as any,
  currentJsonTableData: null as any,
  globalTemplateStr: '',
  callCustomOpenAI: vi.fn(),
  scopeContainer: null as any,
  guideContainer: null as any,
  configStore: {} as Record<string, any>,
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.saveChat,
  saveChatToHostStrict_ACU: mocks.saveChatStrict,
}));

vi.mock('../../src/data/repositories/chat-message-data-repo', async importOriginal => ({
  ...(await importOriginal<any>()),
  cloneIsolatedData_ACU: vi.fn((message: any) => {
    const raw = message?.TavernDB_ACU_IsolatedData;
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    return JSON.parse(JSON.stringify(raw || {}));
  }),
  writeMessageIdentity_ACU: vi.fn((message: any, isolationConfig: any) => {
    if (isolationConfig?.enabled) message.TavernDB_ACU_Identity = isolationConfig.code;
    else delete message.TavernDB_ACU_Identity;
  }),
}));

vi.mock('../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../src/shared/utils');
  return { ...actual, logDebug_ACU: mocks.logDebug, logWarn_ACU: mocks.logWarn, logError_ACU: mocks.logError };
});
// ---------- 宿主边界 mock 补充（与 template-switch-matrix 同套边界） ----------
vi.mock('../../src/data/storage/chat-history', async importOriginal => ({
  ...(await importOriginal<any>()),
  getActiveChatStorageIdentity_ACU: vi.fn(() => mocks.chatIdentifier),
  getChatScopedConfigContainer_ACU: vi.fn(() => (mocks.scopeContainer ? JSON.parse(JSON.stringify(mocks.scopeContainer)) : null)),
  peekChatScopedConfigContainer_ACU: vi.fn(() => (mocks.scopeContainer ? JSON.parse(JSON.stringify(mocks.scopeContainer)) : null)),
  setChatScopedConfigContainer_ACU: vi.fn((_chat: any[], value: any) => {
    mocks.scopeContainer = value ? JSON.parse(JSON.stringify(value)) : null;
  }),
  getChatSheetGuideContainer_ACU: vi.fn(() => (mocks.guideContainer ? JSON.parse(JSON.stringify(mocks.guideContainer)) : null)),
  peekChatSheetGuideContainer_ACU: vi.fn(() => (mocks.guideContainer ? JSON.parse(JSON.stringify(mocks.guideContainer)) : null)),
  setChatSheetGuideContainer_ACU: vi.fn((_chat: any[], value: any) => {
    mocks.guideContainer = value ? JSON.parse(JSON.stringify(value)) : null;
  }),
}));

vi.mock('../../src/data/repositories/profile-repo', async importOriginal => ({
  ...(await importOriginal<any>()),
  readProfileTemplateFromStorage_ACU: vi.fn(() => mocks.globalTemplateStr),
  saveCurrentProfileTemplate_ACU: vi.fn((templateStr?: string, _settings?: any) => {
    const tpl = templateStr !== undefined && templateStr !== null ? String(templateStr) : mocks.globalTemplateStr;
    mocks.globalTemplateStr = tpl;
  }),
}));

vi.mock('../../src/data/storage/tavern-storage', async importOriginal => ({
  ...(await importOriginal<any>()),
  getConfigStorage_ACU: vi.fn(() => ({
    getItem: (key: string) => mocks.configStore[key] ?? null,
    setItem: (key: string, value: string) => { mocks.configStore[key] = value; },
    removeItem: (key: string) => { delete mocks.configStore[key]; },
  })),
}));

vi.mock('../../src/service/worldbook/pipeline', async importOriginal => ({
  ...(await importOriginal<any>()),
  refreshMergedDataAndNotify_ACU: vi.fn(),
}));

vi.mock('../../src/service/table/table-storage-strategy', async importOriginal => ({
  ...(await importOriginal<any>()),
  reloadStorageProvider: vi.fn(async () => ({ ok: true })),
  didSqliteFallbackAfterReload_ACU: vi.fn(() => false),
}));

vi.mock('../../src/service/settings/settings-service', () => ({
  loadSettings_ACU: vi.fn(),
  saveSettings_ACU: vi.fn(),
  persistCurrentTemplatePresetName_ACU: vi.fn(),
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
  persistTavernSettings_ACU: vi.fn(),
  getConfigStorage_ACU: vi.fn(() => mocks.configStore),
  setGlobalPlotEnabled_ACU: vi.fn(),
  applyCombinedSettingsImport_ACU: vi.fn(),
  getDataIsolationHistory_ACU: vi.fn(() => []),
  removeDataIsolationHistory_ACU: vi.fn(),
  switchIsolationProfile_ACU: vi.fn(),
  setSummaryVectorIndexMode_ACU: vi.fn(),
  setZeroTkOccupyMode_ACU: vi.fn(),
}));

import * as stateManager from '../../src/service/runtime/state-manager';
import { applyTemplateSnapshotToScope_ACU } from '../../src/service/template/template-preset-service';
import { collectV2FullCheckpointIndices_ACU, persistTableMutationLogV2_ACU } from '../../src/service/table/storage-frame-v2-persist';
import {
  flushPendingCompatTransitionFixations_ACU,
  loadTableStateFromFramesV2Detailed_ACU,
  replayWithLegacyTolerances_ACU,
  validateCurrentChatTableRecovery_ACU,
} from '../../src/service/table/storage-frame-v2-replay';
import { ensureV2BoundaryCheckpointForRetainedBuffer_ACU } from '../../src/service/chat/chat-service';
import { getTableDataFingerprint_ACU } from '../../src/service/table/table-data-upgrade-audit';
import { commitPreparedV2Recovery_ACU, prepareV2Recovery_ACU } from '../../src/service/table/table-v2-recovery-service';
import { flushRuntimeOnlyPendingChanges_ACU } from '../../src/service/table/runtime-only-pending-flush';
import {
  clearRuntimeOnlyPendingSheets_ACU,
  hasRuntimeOnlyPendingSheets_ACU,
  markRuntimeOnlyPendingSheets_ACU,
} from '../../src/service/table/runtime-only-pending-state';
import { DEFAULT_TABLE_TEMPLATE_ACU, _set_TABLE_TEMPLATE_ACU } from '../../src/shared/defaults-json.js';

import { buildBatchMergeBase_ACU, orchestrateManualCatchUp_ACU } from '../../src/service/table/update-orchestrator';
import { getChatSheetGuideDataForIsolationKey_ACU } from '../../src/service/template/chat-scope/chat-scope-guide';
import { refreshMergedDataAndNotify_ACU } from '../../src/service/worldbook/pipeline';

// ---------- harness：与 template-switch-matrix 同构 ----------
function mate() { return { type: 'chatSheets', version: 1 }; }

function sheetFixture(key: string, name: string, columns: string[], orderNo: number) {
  return {
    uid: key, name,
    content: [['row_id', ...columns]],
    updateConfig: {}, exportConfig: {},
    sourceData: { ddl: `CREATE TABLE ${key} (row_id INTEGER PRIMARY KEY, ${columns.map(c => `${c} TEXT`).join(', ')})` },
    orderNo,
  } as any;
}

/** 模板 A：旧随机 key（现场证据同名 sheet_DpKcVGqg） */
function templateA() {
  return { mate: mate(), sheet_DpKcVGqg: sheetFixture('sheet_DpKcVGqg', '主角信息表', ['名字', '状态'], 0) };
}

/** 模板 B：同名、稳定 key、中间新增列（切模板目标） */
function templateB() {
  return { mate: mate(), sheet_zhu_jue_xin_xi_biao: sheetFixture('sheet_zhu_jue_xin_xi_biao', '主角信息表', ['名字', '处境', '状态'], 0) };
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

function buildChat(aiFloorCount: number): any[] {
  const chat: any[] = [];
  for (let i = 0; i < aiFloorCount; i++) {
    if (i > 0) chat.push({ is_user: true, mes: `用户${i}` });
    chat.push({ is_user: false, mes: `AI 楼层 ${i}` });
  }
  return chat;
}

function lastAiIndex(chat: any[]): number {
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i] && !chat[i].is_user) return i;
  }
  throw new Error('聊天中没有 AI 楼层');
}

async function replayData(): Promise<any> {
  const replay = await loadTableStateFromFramesV2Detailed_ACU(undefined, mocks.isolationKey, { updateRuntimeState: false });
  return replay?.data ?? null;
}

function findSheetKeyByName(data: any, name: string): string | null {
  const entry = Object.entries(data || {}).find(([key, sheet]: [string, any]) =>
    key.startsWith('sheet_') && sheet && typeof sheet === 'object' && sheet.name === name);
  return entry ? entry[0] : null;
}

function sheetKeys(data: any): string[] {
  return Object.keys(data || {}).filter(k => k.startsWith('sheet_')).sort();
}

function dataRows(sheet: any): any[][] { return sheet.content.slice(1); }

/** 逐楼真实落帧（persistTableMutationLogV2_ACU 真实实现，AI 替身不参与落帧） */
async function fillFloorOnce(sheetKey: string, floor: number): Promise<void> {
  const replayed = await replayData();
  const base = replayed ? clone(replayed) : clone(stateManager.currentJsonTableData_ACU);
  if (!base) throw new Error('没有可用的填数基底');
  base[sheetKey].content.push([String(floor), `名字${floor}`, `状态${floor}`]);
  const hasCheckpoint = collectV2FullCheckpointIndices_ACU(mocks.chat, mocks.isolationKey).length > 0;
  const transactionContext = {
    baseRevision: null,
    writeSet: [{ kind: 'all' as const }],
    assertFresh: vi.fn(),
    runCommit: vi.fn(async (task: () => any) => task()),
  };
  const result = await persistTableMutationLogV2_ACU({
    source: 'manual_fill',
    afterData: base,
    operations: hasCheckpoint
      ? [{ kind: 'sheet_replace' as const, sheetKey, sheet: clone(base[sheetKey]), reason: 'manual_crud' as const }]
      : [],
    filledSheetKeys: [sheetKey],
    candidateChangedSheetKeys: [sheetKey],
    groupKeys: [],
    targetMessageIndex: lastAiIndex(mocks.chat),
    isolationKey: mocks.isolationKey,
    transactionContext: transactionContext as any,
    strictSave: true,
  } as any);
  if (!result.saved) throw new Error(`填数失败：${result.error}`);
}

describe('P1 同名异构模板切换→回放身份分叉复现', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.chat.push(...buildChat(50));
    Object.assign(stateManager.settings_ACU, {
      storageMode: 'native',
      dataIsolationEnabled: false,
      dataIsolationCode: '',
    });
    // 追平公开入口有 coreApisAreReady 准入门（update-orchestrator.ts:3617）：
    // 测试中开启 API 就绪，让入口走到真实规划/预检，fail-closed 才能落在身份检查上。
    stateManager._set_coreApisAreReady_ACU(true);
    stateManager._set_currentJsonTableData_ACU(null);
    stateManager._set_currentChatFileIdentifier_ACU(mocks.chatIdentifier);
    mocks.scopeContainer = null;
    mocks.guideContainer = null;
    mocks.configStore = {};
    mocks.globalTemplateStr = JSON.stringify(templateA());
    mocks.callCustomOpenAI.mockReset();
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
  });

  it('50楼A表→切同名异构B→基底装配按 guide 改名而历史帧仍引用旧 key（红：身份分叉）', async () => {
    // 阶段1：直接以旧随机 key 作为 runtime 基底建立 A 表。
    // 注意：pristine applyChat 会走 rekeyTemplateForPristineChat_ACU 把随机 key 重定为稳定 key，
    // 因此“旧随机 key 历史”必须用真实落帧构造，不能依赖 pristine 模板切换。
    stateManager._set_currentJsonTableData_ACU(templateA());
    const roleKeyA = 'sheet_DpKcVGqg';

    // 阶段2：50 楼真实落帧（历史身份恒为 sheet_DpKcVGqg）
    for (let floor = 1; floor <= 50; floor++) {
      await fillFloorOnce(roleKeyA as string, floor);
    }
    const afterFill = await replayData();
    expect(afterFill).toBeTruthy();
    expect(sheetKeys(afterFill)).toEqual(['sheet_DpKcVGqg']);
    expect(dataRows(afterFill[roleKeyA as string]).length).toBe(50);

    // 阶段3：全局切换同名异构模板 B（稳定 key + 中间新增列）。
    // 现场入口是全局模板切换：先协调当前聊天（保留 previous.key），再翻回 inherit_global
    // 并用新模板重建 guide——正是 guide(旧 key + 新 DDL) 与历史帧(旧 key) 分叉的生产路径。
    const switchB = await applyTemplateSnapshotToScope_ACU(JSON.stringify(templateB()), {
      scope: 'global', source: 'repro_test', persistChatScope: false,
    } as any);
    expect(switchB?.saved).toBe(true);
    const afterSwitch = await replayData();
    expect(sheetKeys(afterSwitch)).toContain('sheet_DpKcVGqg');
    expect(sheetKeys(afterSwitch)).not.toContain('sheet_zhu_jue_xin_xi_biao');

    // 阶段4：guide 与历史帧身份分叉取证。
    // 真实机制：协调器同名匹配保留 previous.key 为执行身份，但 reconcileMatchedSheet_ACU
    // 把模板 B 的 sourceData（含新物理表名 DDL）带入旧 key 槽位；guide getter 又经
    // migrateLegacyTemplateScopeForCurrentChat_ACU 固化该混合快照。
    const guide = getChatSheetGuideDataForIsolationKey_ACU(mocks.isolationKey);
    const guideKeys = sheetKeys(guide);
    // 不变量：已建立的聊天逻辑表保留稳定持久 sheetKey，guide 不得被模板 key 改写。
    expect(guideKeys).toContain('sheet_DpKcVGqg');
    expect(guideKeys).not.toContain('sheet_zhu_jue_xin_xi_biao');
    // 修复前红断言：旧 key 对应的物理表 DDL 必须仍指向旧 key，不能出现新 key。
    const guideDdl = guide['sheet_DpKcVGqg']?.sourceData?.ddl ?? '';
    expect(guideDdl).toContain('sheet_DpKcVGqg');

    // 阶段5：下一轮填表的基底装配（生产接缝 buildBatchMergeBase_ACU → mergeGuideStructureIntoBaseData_ACU）
    stateManager._set_currentJsonTableData_ACU(clone(afterSwitch));
    const baseResult = await buildBatchMergeBase_ACU(1, { liveRuntimeAuthoritative: false }, null);
    expect(baseResult.error).toBe(null);
    expect(baseResult.data).toBeTruthy();
    const baseKeys = sheetKeys(baseResult.data);
    // 基底身份与历史帧一致；若 guide DDL 被错误下发，SQLite 初始化阶段才会产生第二物理表。
    expect(baseKeys).toEqual(sheetKeys(afterSwitch));
    expect(baseKeys).toEqual(['sheet_DpKcVGqg']);

    // 阶段6：冷重载——历史帧不受基底改名影响，50 楼数据仍以旧 key 完整可读
    stateManager._set_currentJsonTableData_ACU(null);
    const coldReplay = await replayData();
    expect(sheetKeys(coldReplay)).toContain('sheet_DpKcVGqg');
    expect(dataRows(coldReplay['sheet_DpKcVGqg']).length).toBe(50);
  }, 60000);

  it('压缩降级 retained window 内 full 时 timed 单表 checkpoint 不提前进入基底，真实回放指纹不变', async () => {
    Object.assign(stateManager.settings_ACU, { retainRecentLayers: 2 });
    const untimedCheckpoint = {
      kind: 'sheet_full',
      createdAt: 24,
      reason: 'manual',
      sheetKey: 'sheet_aux',
      data: { name: '辅助表', content: [['row_id', '值'], ['1', '保留']] },
    };
    const timedHideCheckpoint = {
      kind: 'sheet_full',
      createdAt: 24,
      reason: 'schema_change',
      sheetKey: 'sheet_hidden',
      data: { name: '隐藏表', content: [['row_id', '值'], ['1', '隐藏前']] },
      timeline: { kind: 'sheet_hide', activateAtMessageIndex: 24, afterSeq: 0 },
    };
    const rootData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '最新旧快照', content: [['row_id', '物品名'], ['1', '盾']] },
      sheet_other: { name: '其他表', content: [['row_id', '值'], ['1', '不变']] },
      sheet_aux: untimedCheckpoint.data,
    };
    const chat = Array.from({ length: 25 }, (_, index) => ({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: index === 0
              ? { kind: 'full', createdAt: 0, reason: 'init', data: structuredClone(rootData) }
              : index === 24
              ? {
                  kind: 'full',
                  createdAt: 24,
                  reason: 'manual',
                  data: structuredClone(rootData),
                }
              : undefined,
            perSheetCheckpoints: index === 24 ? { sheet_aux: untimedCheckpoint, sheet_hidden: timedHideCheckpoint } : undefined,
            logEntries: [],
          },
        },
      },
    }));
    mocks.chat.length = 0;
    mocks.chat.push(...chat);

    const before = await loadTableStateFromFramesV2Detailed_ACU(undefined, mocks.isolationKey, { updateRuntimeState: false });
    const beforeFingerprint = getTableDataFingerprint_ACU(before?.data ?? {});

    const result = await ensureV2BoundaryCheckpointForRetainedBuffer_ACU({ reason: 'manual_refill', save: true });
    expect(result).toEqual(expect.objectContaining({ success: true, changed: true, anchorIndex: 23 }));

    const degradedFrame = mocks.chat[24].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(degradedFrame.checkpoint).toBeUndefined();
    expect(degradedFrame.perSheetCheckpoints).toEqual({ sheet_aux: untimedCheckpoint, sheet_hidden: timedHideCheckpoint });
    const fallbackData = degradedFrame.logEntries[0].operations[0].data;
    expect(fallbackData.sheet_aux).toEqual(untimedCheckpoint.data);
    expect(fallbackData.sheet_hidden).toBeUndefined();

    const after = await loadTableStateFromFramesV2Detailed_ACU(undefined, mocks.isolationKey, { updateRuntimeState: false });
    expect(getTableDataFingerprint_ACU(after?.data ?? {})).toBe(beforeFingerprint);
  }, 60000);
});

/**
 * F1 双身份存量（构造复现——计划 #followup-repro；修正后语义）。
 * 存量样本：full 根仅旧 key（sheet_DpKcVGqg，物理表名 zhujuexinxibiao），
 * msg6 同帧经 perSheetCheckpoints timeline（sheet_introduction）引入新 key header-only
 * 锚点，同帧 seq=3 执行 sql_sheet_batch（现场：INSERT row_id=1 重填）。现场成因：用户在
 * 已有旧 key 历史上导入了同名但 key 不同的新模板，表被重置为新结构后由 AI 重填。
 * 修正后契约：表的身份是表名，key 只是载体——严格回放遇到同名新 key 的锚点时「接管」
 * 旧表（表内容以事件数据为准，不合并行，接管行数记入 identityMerges.supersededRows），
 * key 统一为模板侧 key；结果是严格可写历史：baseKind=full_checkpoint、无
 * requiresCheckpointConvergence；填表写入成功、冷重载一致、恢复诊断不报身份冲突。
 */
describe('F1 双身份存量：严格回放按表名接管（修正后）', () => {
  const OLD_KEY = 'sheet_DpKcVGqg';
  const NEW_KEY = 'sheet_zhu_jue_xin_xi_biao';
  // 物理表名对齐现场日志（「zhujuexinxibiao」）；DDL 列名用 ASCII（真实模板契约，
  // 见 api-template-ascii-header-validation 里程碑），中文只出现在展示值里。
  const TABLE_NAME = 'zhujuexinxibiao';
  const OLD_ROW = ['1', '名字0', '状态=旧A1'];

  /** 用户导入的新模板：同名、新稳定 key、中间新增 pos 列（对齐现场）。 */
  function newTemplate() {
    return {
      mate: mate(),
      [NEW_KEY]: {
        uid: NEW_KEY, name: '主角信息表',
        content: [['row_id', 'name', 'pos', 'state']],
        updateConfig: {}, exportConfig: {}, orderNo: 0,
        sourceData: { ddl: `CREATE TABLE ${TABLE_NAME} (row_id INTEGER PRIMARY KEY, name TEXT, pos TEXT, state TEXT)` },
      },
    };
  }

  beforeEach(() => {
    // 复刻 P1 setup：回放/规划/持久化的准入门依赖 settings 与 chatIdentifier，
    // 顶层 describe 不继承 P1 的 beforeEach，跨用例脏状态会让回放早退。
    Object.assign(stateManager.settings_ACU, {
      storageMode: 'native',
      dataIsolationEnabled: false,
      dataIsolationCode: '',
      retainRecentLayers: 100,
    });
    stateManager._set_currentJsonTableData_ACU(null);
    stateManager._set_currentChatFileIdentifier_ACU(mocks.chatIdentifier);
    stateManager._set_independentTableStates_ACU({});
    _set_TABLE_TEMPLATE_ACU(DEFAULT_TABLE_TEMPLATE_ACU);
    mocks.scopeContainer = null;
    mocks.guideContainer = null;
    mocks.configStore = {};
    // 当前全局模板 = 用户导入的新模板：归并时新 key 优先保留（现场日志同款方向
    // sheet_DpKcVGqg→sheet_zhu_jue_xin_xi_biao）。
    mocks.globalTemplateStr = JSON.stringify(newTemplate());
    mocks.callCustomOpenAI.mockReset();
    mocks.logDebug.mockClear();
    mocks.logWarn.mockClear();
    mocks.logError.mockClear();
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    mocks.saveChatStrict.mockResolvedValue(undefined);
  });

  function dualRootData() {
    return {
      mate: { type: 'acu', version: 1 },
      [OLD_KEY]: {
        uid: OLD_KEY, name: '主角信息表',
        content: [['row_id', 'name', 'state'], OLD_ROW],
        updateConfig: {}, exportConfig: {}, orderNo: 0,
        sourceData: { ddl: `CREATE TABLE ${TABLE_NAME} (row_id INTEGER PRIMARY KEY, name TEXT, state TEXT)` },
      },
    } as any;
  }

  /** msg6 同帧：锚点 timeline afterSeq=2（早于 seq=3 SQL）+ sql_sheet_batch 目标新 key。 */
  function dualIdentityFrame(timelineAfterSeq: number = 2, sqlTargetKey: string = NEW_KEY) {
    return {
      version: 2,
      perSheetCheckpoints: {
        [NEW_KEY]: {
          kind: 'sheet_full',
          createdAt: 1,
          reason: 'schema_change',
          sheetKey: NEW_KEY,
          data: {
            uid: NEW_KEY, name: '主角信息表',
            content: [['row_id', 'name', 'pos', 'state']],
            updateConfig: {}, exportConfig: {}, orderNo: 0,
            sourceData: { ddl: `CREATE TABLE ${TABLE_NAME} (row_id INTEGER PRIMARY KEY, name TEXT, pos TEXT, state TEXT)` },
          },
          timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 6, afterSeq: timelineAfterSeq },
        },
      },
      logEntries: [{
        seq: 3,
        entryId: 'f1-dual-identity',
        createdAt: 4,
        source: 'system',
        targetMessageIndex: 6,
        aiFloor: 3,
        filledSheetKeys: [],
        changedSheetKeys: [],
        groupKeys: [],
        operations: [{
          kind: 'sql_sheet_batch',
          sheetKey: sqlTargetKey,
          tableName: TABLE_NAME,
          reason: 'system',
          // SQL 列集与目标 key 的真实 DDL 一致（存量 SQL 总是按其目标表结构书写）。
          // 目标新 key 时对齐现场：新模板表 header-only，AI 以 INSERT row_id=1 重填
          // （现场原句 `INSERT INTO zhujuexinxibiao (row_id, name, ...) VALUES (1, '陈默', ...)`）。
          statements: [sqlTargetKey === NEW_KEY
            ? `INSERT INTO ${TABLE_NAME} (row_id, name, pos, state) VALUES (1, 'SQL新1', 'SQL新1', 'SQL新1')`
            : `UPDATE ${TABLE_NAME} SET name = 'SQL改1', state = 'SQL改1' WHERE row_id = 1`],
        }],
      }],
    };
  }

  function mountDualIdentityChat() {
    const chat = buildChat(50);
    chat[0] = {
      is_user: false, mes: 'AI 楼层 0',
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: dualRootData() }, logEntries: [] } },
      },
    };
    chat[6] = {
      is_user: false, mes: 'AI 楼层 3',
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: dualIdentityFrame() },
      },
    };
    return chat;
  }

  async function strictReplay() {
    // compatibilityMode:'disabled' = 写路径校验探针的严格语义：不进入任何兼容降级链。
    const replay = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false, compatibilityMode: 'disabled' });
    if (!replay) throw new Error('F1 构造未产生回放结果');
    return replay;
  }

  function expectStrictMergedIntoNewKey(replay: NonNullable<Awaited<ReturnType<typeof loadTableStateFromFramesV2Detailed_ACU>>>) {
    expect(replay.baseKind).toBe('full_checkpoint');
    expect(replay.requiresCheckpointConvergence).toBeFalsy();
    expect(replay.compatibilityRepairs ?? []).toHaveLength(0);
    expect(sheetKeys(replay.data)).toEqual([NEW_KEY]);
    expect(replay.identityMerges).toHaveLength(1);
    // 接管：旧 key 的 1 行随事件语义丢弃并被记录，不合并、不静默。
    expect(replay.identityMerges?.[0]).toMatchObject({ fromKey: OLD_KEY, toKey: NEW_KEY, supersededRows: 1, appendedRows: 0, conflictingRowIds: [] });
    expect(replay.data[NEW_KEY].content[0]).toEqual(['row_id', 'name', 'pos', 'state']);
  }

  it('同帧顺序A：锚点(afterSeq=2)早于SQL(seq=3)新key目标——锚点接管旧表，INSERT row 1 不再撞主键，可写且冷重载一致', async () => {
    mocks.chat.length = 0;
    mocks.chat.push(...mountDualIdentityChat());
    stateManager._set_currentJsonTableData_ACU(null);

    // 现场同款历史：旧 key 根 + 新 key header-only 锚点 + INSERT row_id=1。修正后严格回放在
    // 锚点应用时接管同名旧表（表变为 header-only），随后 INSERT 在空表上成功。
    // （若把旧行并入，row_id=1 已被占用，就是现场的 UNIQUE constraint failed。）
    const replay = await strictReplay();
    console.log('[F1-A] baseKind:', replay.baseKind, '| keys:', JSON.stringify(sheetKeys(replay.data)), '| merges:', JSON.stringify(replay.identityMerges ?? null));
    console.log('[F1-A] NEW:', JSON.stringify(replay.data[NEW_KEY]?.content ?? null));
    expectStrictMergedIntoNewKey(replay);
    expect(replay.data[NEW_KEY].content).toEqual([['row_id', 'name', 'pos', 'state'], ['1', 'SQL新1', 'SQL新1', 'SQL新1']]);
    expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining('同名表接管'));
    // 归并只发生在读副本：原 storage frame 未被改写。
    expect(mocks.chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data[OLD_KEY].content[1]).toEqual(OLD_ROW);

    // 读路径（默认兼容模式）与严格探针结果一致，且不进入兼容降级链。
    const readPath = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false });
    expect(readPath?.baseKind).toBe('full_checkpoint');
    expect(readPath?.data[NEW_KEY].content).toEqual(replay.data[NEW_KEY].content);
    expect(mocks.logWarn).not.toHaveBeenCalledWith(expect.stringContaining('严格回放失败'));

    // 可写：在归并后的历史上真实落一笔填表（persist 写前门闸不再拒绝）。
    const afterData = clone(replay.data);
    afterData[NEW_KEY].content.push(['2', '名字2', '处境2', '状态2']);
    const transactionContext = {
      baseRevision: null,
      writeSet: [{ kind: 'all' as const }],
      assertFresh: vi.fn(),
      runCommit: vi.fn(async (task: () => any) => task()),
    };
    const persisted = await persistTableMutationLogV2_ACU({
      source: 'manual_fill',
      afterData,
      operations: [{ kind: 'sheet_replace' as const, sheetKey: NEW_KEY, sheet: clone(afterData[NEW_KEY]), reason: 'manual_crud' as const }],
      filledSheetKeys: [NEW_KEY],
      candidateChangedSheetKeys: [NEW_KEY],
      groupKeys: [],
      targetMessageIndex: lastAiIndex(mocks.chat),
      isolationKey: mocks.isolationKey,
      transactionContext: transactionContext as any,
      strictSave: true,
    } as any);
    console.log('[F1-A] persist:', JSON.stringify({ saved: persisted.saved, error: persisted.error }));
    expect(persisted.saved).toBe(true);

    // 冷重载：严格回放仍单 key，历史 INSERT 与新写入都在。
    const cold = await strictReplay();
    expect(sheetKeys(cold.data)).toEqual([NEW_KEY]);
    expect(cold.data[NEW_KEY].content.slice(1)).toEqual([
      ['1', 'SQL新1', 'SQL新1', 'SQL新1'],
      ['2', '名字2', '处境2', '状态2'],
    ]);

    // 诊断面：不再报身份冲突，也不是兼容只读态。
    const validation = await validateCurrentChatTableRecovery_ACU();
    expect(validation.success).toBe(true);
    const recovery = await prepareV2Recovery_ACU();
    console.log('[F1-A] recovery:', recovery.status, '|', recovery.message);
    expect(recovery.status).not.toBe('unrecoverable_identity_conflict');
    expect(recovery.status).not.toBe('recoverable_compat_tolerant_replay');
  }, 120000);

  it('同帧顺序B：锚点(afterSeq=4)晚于SQL(seq=3)且SQL目标旧key——SQL 先落旧 key，锚点生效后接管为新结构 header-only', async () => {
    mocks.chat.length = 0;
    mocks.chat.push(...mountDualIdentityChat());
    // 顺序反转：锚点 timeline.afterSeq=4 晚于 SQL seq=3，SQL 目标改指旧 key。
    mocks.chat[6].TavernDB_ACU_IsolatedData[''].storageFrame = dualIdentityFrame(4, OLD_KEY);
    stateManager._set_currentJsonTableData_ACU(null);

    const replay = await strictReplay();
    console.log('[F1-B] keys:', JSON.stringify(sheetKeys(replay.data)), '| NEW:', JSON.stringify(replay.data[NEW_KEY]?.content ?? null), '| merges:', JSON.stringify(replay.identityMerges ?? null));
    expectStrictMergedIntoNewKey(replay);
    // seq=3 SQL 先在旧 key 上生效；随后 header-only 锚点接管该表——事件语义就是「表被重置为
    // 新结构、无行」，旧行（含刚被 SQL 改写的）随接管丢弃并记录 supersededRows=1。
    expect(replay.data[NEW_KEY].content).toEqual([['row_id', 'name', 'pos', 'state']]);
    // 修正前这里是双 key 静默流出并被混合存储写决策当作可信证据；修正后结果只有单身份。
    expect(replay.data[OLD_KEY]).toBeUndefined();
    const recovery = await prepareV2Recovery_ACU();
    expect(recovery.status).not.toBe('unrecoverable_identity_conflict');
  }, 120000);

  it('116 消息拓扑：msg6 双身份帧 + msg114 终态 progress 帧，严格回放单身份且历史可写', async () => {
    mocks.chat.length = 0;
    // 116 条消息拓扑（现场日志：目标 6、终态目标 114）：58 AI 楼层，msg6 双身份帧，msg114 终态 progress。
    const chat = buildChat(58);
    chat[0] = {
      is_user: false, mes: 'AI 楼层 0',
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: dualRootData() }, logEntries: [] } },
      },
    };
    chat[6] = {
      is_user: false, mes: 'AI 楼层 3',
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: dualIdentityFrame() },
      },
    };
    // 终态 progress 帧对齐现场 21:09:25.173（msg114 manual_fill operationCount=0 changedSheetCount=0 success=true）。
    const terminalProgress = {
      kind: 'manual_refill' as const,
      status: 'complete' as const,
      selectedSheetKeys: [OLD_KEY],
      contextMessageIndices: [6],
      originalStartMessageIndex: 6,
      targetMessageIndex: 114,
      batchSize: 3,
      completedUntilMessageIndex: 114,
      mode: 'catch_up' as const,
      targetAiFloor: 57,
      updatedAt: 1,
    };
    chat[114] = {
      is_user: false, mes: 'AI 楼层 57',
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [], manualRefillProgress: terminalProgress } },
      },
    };
    mocks.chat.push(...chat);
    stateManager._set_currentJsonTableData_ACU(null);

    // 修正前这里 strict 不可读、追平 fail-closed；修正后整条 116 消息历史严格可读且单身份，
    // 终态 progress 帧（0-op）不影响回放。
    const replay = await strictReplay();
    expectStrictMergedIntoNewKey(replay);
    expect(replay.data[NEW_KEY].content[1]).toEqual(['1', 'SQL新1', 'SQL新1', 'SQL新1']);
    const validation = await validateCurrentChatTableRecovery_ACU();
    expect(validation.success).toBe(true);
    // 边界回放（追平 merge base 的取法）同样单身份：到 msg6 为止即已接管。
    const bounded = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false, maxMessageIndex: 6, compatibilityMode: 'disabled' });
    expect(sheetKeys(bounded?.data ?? {})).toEqual([NEW_KEY]);
    expect(bounded?.identityMerges).toHaveLength(1);
  }, 120000);
});

/**
 * F2 兼容宽容回放结果契约（修正后——计划 #followup-replay-contract）。
 * 构造：full 根仅旧 key，logEntry 带一个未知 operation kind（未来版本产物）后跟 SQL。
 * 严格回放抛「不支持的 operation kind」；Tier-1 宽容回放按 spv7.9 语义跳过它并继续。
 * 契约：tolerant 结果必须自带 requiresCheckpointConvergence=true 与 legacyToleranceDiagnosis，
 * 写路径（persist / 追平 / runtime-only flush）fail-closed，诊断路径（validate / recovery）
 * 给出指向恢复收敛的精确诊断。
 * 注意：同名不同 key 的双身份已是严格回放的正常归并语义（见 F1），不再属于兼容态。
 */
describe('F2 兼容宽容回放结果契约（修正后）', () => {
  const OLD_KEY = 'sheet_DpKcVGqg';
  const NEW_KEY = 'sheet_zhu_jue_xin_xi_biao';
  const TABLE_NAME = 'zhujuexinxibiao';
  const DDL = `CREATE TABLE ${TABLE_NAME} (row_id INTEGER PRIMARY KEY, name TEXT, state TEXT)`;

  beforeEach(() => {
    Object.assign(stateManager.settings_ACU, {
      storageMode: 'native',
      dataIsolationEnabled: false,
      dataIsolationCode: '',
      // P1 第二用例把 retainRecentLayers 改为 2 且不恢复；F2 显式回到默认值 100。
      retainRecentLayers: 100,
    });
    // P1 真实落帧会写入 sheet_DpKcVGqg 的模块级调度状态；F2 不测调度，复位以隔离 describe 间状态。
    stateManager._set_independentTableStates_ACU({});
    // P1 第一用例的全局模板切换把模块级 TABLE_TEMPLATE_ACU 留为模板 B（含
    // sheet_zhu_jue_xin_xi_biao）。不复位时，追平 chunk 的 rebindSheetKeysThroughTableAliases_ACU
    // 会按同名别名把目标 sheet_DpKcVGqg 改绑为新 key，再被 TemplateScope「模板未声明」
    // 剔除→零 bucket→直接进入终态验证；拦截路径随 describe 执行顺序漂移。复位为默认模板，
    // 让 F2 追平用例确定性地走「AI 调用前 merge base 拦截」路径。
    _set_TABLE_TEMPLATE_ACU(DEFAULT_TABLE_TEMPLATE_ACU);
    // 追平公开入口有 coreApisAreReady 准入门：开启后入口才会走到真实预检/merge base，
    // 让 fail-closed 落在 F2 结果契约上而不是 API 未就绪的早退。
    stateManager._set_coreApisAreReady_ACU(true);
    stateManager._set_currentJsonTableData_ACU(null);
    stateManager._set_currentChatFileIdentifier_ACU(mocks.chatIdentifier);
    mocks.scopeContainer = null;
    mocks.guideContainer = null;
    mocks.configStore = {};
    mocks.globalTemplateStr = '';
    mocks.callCustomOpenAI.mockReset();
    mocks.logDebug.mockClear();
    mocks.logWarn.mockClear();
    mocks.logError.mockClear();
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    clearRuntimeOnlyPendingSheets_ACU();
    // mocks.chat 即宿主当前聊天：tolerant 读取会后台调度兼容过渡根固化
    // （createCompatTransitionCheckpointFromTolerantReplay_ACU → saveChatToHostStrict_ACU）。
    // 固化成功后历史将从过渡根起算走严格快路径，不再是 F2 的被测态。让宿主严格保存失败
    // 使固化确定性回滚（对齐生产「固化失败→下次加载继续宽容回放」路径），
    // 整个用例期间历史保持「仅可宽容读出、未固化」。
    mocks.saveChatStrict.mockRejectedValue(new Error('F2 测试：宿主严格保存不可用，兼容过渡根固化必须失败并回滚'));
  });

  afterEach(async () => {
    await flushPendingCompatTransitionFixations_ACU();
    mocks.saveChatStrict.mockReset();
    mocks.saveChatStrict.mockResolvedValue(undefined);
    clearRuntimeOnlyPendingSheets_ACU();
    _set_TABLE_TEMPLATE_ACU(DEFAULT_TABLE_TEMPLATE_ACU);
  });

  function tolerantRootData() {
    return {
      mate: { type: 'acu', version: 1 },
      [OLD_KEY]: {
        uid: OLD_KEY, name: '主角信息表',
        content: [['row_id', 'name', 'state'], ['1', '名字0', '状态=旧A1'], ['2', '名字旧独有', '状态旧独有']],
        updateConfig: {}, exportConfig: {}, orderNo: 0,
        sourceData: { ddl: DDL },
      },
    } as any;
  }

  /**
   * 强制进入 Tier-1 宽容态的构造：logEntry 带一个未来版本的未知 operation kind。
   * 严格回放抛「不支持的 operation kind」；spv7.9 兼容语义跳过它并继续应用后续 SQL。
   * （同名双 key 已是严格回放的正常归并语义，不能再用来构造兼容态。）
   */
  const UNKNOWN_OP_KIND = 'future_sheet_annotation_v99';
  function tolerantFrame(extraSheets: Record<string, any> = {}) {
    const root = tolerantRootData();
    Object.assign(root, extraSheets);
    return {
      version: 2,
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: root },
      logEntries: [{
        seq: 1,
        entryId: 'f2-tolerant-unknown-op',
        createdAt: 2,
        source: 'system',
        targetMessageIndex: 0,
        aiFloor: 0,
        filledSheetKeys: [],
        changedSheetKeys: [],
        groupKeys: [],
        operations: [
          { kind: UNKNOWN_OP_KIND, sheetKey: OLD_KEY, reason: 'system', payload: { note: '来自未来版本' } },
          {
            kind: 'sql_sheet_batch',
            sheetKey: OLD_KEY,
            tableName: TABLE_NAME,
            reason: 'system',
            statements: [`UPDATE ${TABLE_NAME} SET name = 'SQL改1', state = 'SQL改1' WHERE row_id = 1`],
          },
        ],
      }],
    };
  }

  function mountTolerantChat(extraSheets: Record<string, any> = {}): void {
    const chat = buildChat(50);
    chat[0] = {
      is_user: false, mes: 'AI 楼层 0',
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: tolerantFrame(extraSheets) },
      },
    };
    mocks.chat.length = 0;
    mocks.chat.push(...chat);
  }

  function mountReplacementEligibleDuplicateChat(): void {
    const chat = buildChat(50);
    chat[0] = {
      is_user: false, mes: 'AI 楼层 0',
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: tolerantRootData() },
            logEntries: [],
          },
        },
      },
    };
    chat[4] = {
      is_user: false, mes: 'AI 楼层 3',
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [{
              seq: 1, entryId: 'replacement-eligible-duplicate', createdAt: 4, source: 'system', targetMessageIndex: 4, aiFloor: 3,
              filledSheetKeys: [OLD_KEY], changedSheetKeys: [OLD_KEY], groupKeys: [OLD_KEY],
              operations: [{
                kind: 'sql_sheet_batch', sheetKey: OLD_KEY, tableName: TABLE_NAME, reason: 'system',
                statements: [`INSERT INTO ${TABLE_NAME} (row_id, name, state) VALUES (1, '重复', '重复')`],
              }],
            }],
          },
        },
      },
    };
    mocks.chat.length = 0;
    mocks.chat.push(...chat);
  }

  it('追平预检候选会裁掉本次 replacement 覆盖的重复 SQL 增量', async () => {
    mountReplacementEligibleDuplicateChat();
    stateManager._set_currentJsonTableData_ACU(clone(tolerantRootData()));
    const { buildReplacementPurgedCandidateChat_ACU } = await import('../../src/service/table/storage-frame-v2-persist');
    const candidate = buildReplacementPurgedCandidateChat_ACU(
      mocks.chat,
      mocks.isolationKey,
      [4],
      [OLD_KEY],
    );
    expect(candidate).not.toBe(mocks.chat);
    expect(candidate[4].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
    const replay = await loadTableStateFromFramesV2Detailed_ACU(candidate, mocks.isolationKey, {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(replay?.baseKind).toBe('full_checkpoint');
  }, 120000);


  async function loadTolerant() {
    const replay = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false });
    if (!replay) throw new Error('F2 构造未产生回放结果');
    // 等首次固化尝试结束（宿主保存被拒→回滚），消费者调用不与固化并发。
    await flushPendingCompatTransitionFixations_ACU();
    return replay;
  }

  /** 任一消息带兼容过渡根即表示固化成功——F2 用例期间必须恒为 false。 */
  function hasAnyCompatTransitionCheckpoint(): boolean {
    return mocks.chat.some(message => !!message?.TavernDB_ACU_IsolatedData?.['']?.compatTransitionCheckpoint);
  }

  /** 统计 msg0 以外所有帧的 logEntries 总数：写路径 fail-closed 时必须保持为 0。 */
  function countAppendedLogEntriesOutsideRoot(): number {
    let total = 0;
    for (let index = 1; index < mocks.chat.length; index++) {
      const frame = mocks.chat[index]?.TavernDB_ACU_IsolatedData?.['']?.storageFrame;
      if (frame && Array.isArray(frame.logEntries)) total += frame.logEntries.length;
    }
    return total;
  }

  it('结果契约：tolerant 成功结果自带 requiresCheckpointConvergence=true 与 legacyToleranceDiagnosis，不塞 compatibilityRepairs', async () => {
    mountTolerantChat();

    // 严格回放必须失败于未知 operation kind（构造有效性前提），否则不会进入降级链。
    let strictError: unknown = null;
    try {
      await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false, compatibilityMode: 'disabled' });
    } catch (error) {
      strictError = error;
    }
    expect(strictError instanceof Error ? strictError.message : String(strictError ?? '')).toContain('不支持的 operation kind');

    const replay = await loadTolerant();
    console.log('[F2 观察] baseKind:', replay.baseKind, '| keys:', JSON.stringify(sheetKeys(replay.data)),
      '| tolerances:', JSON.stringify(replay.legacyToleranceDiagnosis?.tolerances ?? null));
    expect(replay.baseKind).toBe('compat_tolerant_replay');
    expect(replay.requiresCheckpointConvergence).toBe(true);
    expect(replay.legacyToleranceDiagnosis).toBeDefined();
    expect(replay.legacyToleranceDiagnosis?.tolerances).toContain('unknown_operation_kind_skipped:1');
    expect(replay.legacyToleranceDiagnosis?.strictError).toContain('不支持的 operation kind');
    expect(replay.legacyToleranceDiagnosis?.identityRemaps).toEqual([]);
    // Phase 4b 约束：宽容态容忍项不是 temporary_sheet_anchor 模型，不得伪装成 repairs。
    expect(replay.compatibilityRepairs ?? []).toHaveLength(0);
    // 只读可用性保留：未知 op 被跳过、后续 SQL 改写生效（读永远宽容）。
    expect(sheetKeys(replay.data)).toEqual([OLD_KEY]);
    expect(replay.data[OLD_KEY].content[1]).toEqual(['1', 'SQL改1', 'SQL改1']);
    // 固化确已尝试并因宿主保存失败回滚：历史保持未固化 tolerant 态，且无残迹。
    expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining('兼容过渡根固化失败'));
    expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
  }, 60000);

  it('validate 诊断：validateCurrentChatTableRecovery_ACU 返回 replay_requires_checkpoint_convergence 并说明兼容宽容回放', async () => {
    mountTolerantChat();

    const result = await validateCurrentChatTableRecovery_ACU();
    console.log('[F2 观察] validate:', JSON.stringify(result));
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.diagnosticCode).toBe('replay_requires_checkpoint_convergence');
    expect(result.error).toContain('兼容宽容回放');
    expect(result.error).toContain('不支持的 operation kind');
    await flushPendingCompatTransitionFixations_ACU();
    expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
  }, 60000);

  it('persist 拒写：写前门闸识别 tolerant 态，saved=false 且历史帧零副作用', async () => {
    mountTolerantChat();
    const replay = await loadTolerant();
    const keys = sheetKeys(replay.data);
    expect(keys.length).toBeGreaterThan(0);
    const sheetKey = keys[0];
    const afterData = clone(replay.data);
    afterData[sheetKey].content.push(['3', '名字新', '状态新']);
    const entriesBefore = countAppendedLogEntriesOutsideRoot();
    const rootBefore = JSON.stringify(mocks.chat[0].TavernDB_ACU_IsolatedData);
    const transactionContext = {
      baseRevision: null,
      writeSet: [{ kind: 'all' as const }],
      assertFresh: vi.fn(),
      runCommit: vi.fn(async (task: () => any) => task()),
    };

    const result = await persistTableMutationLogV2_ACU({
      source: 'manual_fill',
      afterData,
      operations: [{ kind: 'sheet_replace' as const, sheetKey, sheet: clone(afterData[sheetKey]), reason: 'manual_crud' as const }],
      filledSheetKeys: [sheetKey],
      candidateChangedSheetKeys: [sheetKey],
      groupKeys: [],
      targetMessageIndex: lastAiIndex(mocks.chat),
      isolationKey: mocks.isolationKey,
      transactionContext: transactionContext as any,
      strictSave: true,
    } as any);
    console.log('[F2 观察] persist:', JSON.stringify({ saved: result.saved, error: result.error }));
    expect(result.saved).toBe(false);
    expect(result.error).toContain('兼容宽容回放读出');
    expect(result.error).toContain('不支持的 operation kind');
    // 零副作用：根帧字节不变、无新增 logEntries、固化（persist 内部回放再次触发）仍回滚无残迹。
    await flushPendingCompatTransitionFixations_ACU();
    expect(JSON.stringify(mocks.chat[0].TavernDB_ACU_IsolatedData)).toBe(rootBefore);
    expect(countAppendedLogEntriesOutsideRoot()).toBe(entriesBefore);
    expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
  }, 60000);

  it('追平 fail-closed：tolerant 态历史上公开追平入口失败且零 AI 消耗', async () => {
    mountTolerantChat();
    const replay = await loadTolerant();
    const sheetKey = sheetKeys(replay.data)[0];
    // runtime 置为用户可见的兼容结果（对齐现场：用户已加载表格并点击追平）。
    stateManager._set_currentJsonTableData_ACU(clone(replay.data));
    mocks.callCustomOpenAI.mockResolvedValue('<tableEdit>\ninsertRow(0, {"0":"名字A", "1":"状态A"});\n</tableEdit>');
    const callsBefore = mocks.callCustomOpenAI.mock.calls.length;

    const result = await orchestrateManualCatchUp_ACU([sheetKey], refreshMergedDataAndNotify_ACU, {
      abortController: new AbortController(),
      onProgress: () => {},
      executionSnapshot: { sheetKeys: [sheetKey] },
    });
    console.log('[F2 观察] 追平 outcome:', result.outcome, '| diagnosticCode:', result.diagnosticCode, '| error:', result.error);
    await flushPendingCompatTransitionFixations_ACU();
    expect(result.success).toBe(false);
    // 回放宽容、写入严格：追平预检在任何 AI 调用与 bucket 之前检测到历史只能兼容读出，
    // 直接 blocked 并给出可操作的诊断码（不在写路径里隐式修历史），聊天零写入。
    expect(result.outcome).toBe('blocked');
    expect(result.diagnosticCode).toBe('replay_requires_checkpoint_convergence');
    expect(result.committedBucketCount).toBe(0);
    expect(result.dataCommitted).toBe(false);
    expect(result.error).toContain('兼容宽容回放读出');
    expect(result.error).toContain('诊断 V2 数据恢复');
    expect(mocks.callCustomOpenAI.mock.calls.length).toBe(callsBefore);
    expect(countAppendedLogEntriesOutsideRoot()).toBe(0);
    expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
  }, 120000);

  it('追平 fail-closed（零 bucket 路径）：全局模板已切到新 key 时预检仍报 replay_requires_checkpoint_convergence', async () => {
    mountTolerantChat();
    const replay = await loadTolerant();
    const sheetKey = sheetKeys(replay.data)[0];
    // 现场配置：全局模板已切到模板 B（同名、新稳定 key），聊天 guide 仍只有旧 key。
    // 追平预检在 bucket 规划之后、任何 AI 调用之前检查历史严格可回放性：无论 wave 里
    // 有没有 bucket，tolerant 态历史都在预检处以 blocked 阻断，不会把兼容数据当作
    // 「验证通过」回写运行时视图。
    _set_TABLE_TEMPLATE_ACU(JSON.stringify(templateB()));
    stateManager._set_currentJsonTableData_ACU(clone(replay.data));
    mocks.callCustomOpenAI.mockResolvedValue('<tableEdit>\ninsertRow(0, {"0":"名字A", "1":"状态A"});\n</tableEdit>');
    const callsBefore = mocks.callCustomOpenAI.mock.calls.length;

    const result = await orchestrateManualCatchUp_ACU([sheetKey], refreshMergedDataAndNotify_ACU, {
      abortController: new AbortController(),
      onProgress: () => {},
      executionSnapshot: { sheetKeys: [sheetKey] },
    });
    console.log('[F2 观察] 零 bucket 追平 outcome:', result.outcome, '| diagnosticCode:', result.diagnosticCode, '| error:', result.error);
    await flushPendingCompatTransitionFixations_ACU();
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('blocked');
    expect(result.diagnosticCode).toBe('replay_requires_checkpoint_convergence');
    expect(result.error).toContain('兼容宽容回放读出');
    expect(result.error).toContain('诊断 V2 数据恢复');
    expect(result.replayVerified).toBeFalsy();
    expect(mocks.callCustomOpenAI.mock.calls.length).toBe(callsBefore);
    expect(countAppendedLogEntriesOutsideRoot()).toBe(0);
    expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
  }, 120000);

  it('recovery 诊断：prepareV2Recovery_ACU 返回 recoverable_compat_tolerant_replay 而非「无需恢复」', async () => {
    mountTolerantChat();

    const summary = await prepareV2Recovery_ACU();
    console.log('[F2 观察] recovery:', JSON.stringify(summary));
    expect(summary.status).toBe('recoverable_compat_tolerant_replay');
    expect(summary.requiresConfirmation).toBe(false);
    expect(summary.sourceMessageIndex).toBe(0);
    expect(summary.message).toContain('兼容宽容回放');
    expect(summary.message).toContain('unknown_operation_kind_skipped:1');
    expect(summary.message).toContain('身份归并=无');
    // 显式恢复是把兼容结果转成权威根的用户入口：诊断即产出经严格探针验证的固化 plan。
    expect(summary.planId).toBeTruthy();
    expect(summary.message).toContain('固化方案');
    await flushPendingCompatTransitionFixations_ACU();
    expect(hasAnyCompatTransitionCheckpoint()).toBe(false);

    // 本套件宿主严格保存被拒：提交必须回滚且报告失败，聊天零残迹。
    const commit = await commitPreparedV2Recovery_ACU(summary.planId!);
    console.log('[F2 观察] recovery commit:', JSON.stringify(commit));
    expect(commit.status).toBe('commit_failed_rolled_back');
    expect(commit.error).toContain('宿主保存失败');
    expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
    expect(countAppendedLogEntriesOutsideRoot()).toBe(0);
  }, 60000);

  it('flush 兼容态：runtime-only 落盘跳过并保留登记，不把兼容数据固化为权威快照', async () => {
    mountTolerantChat();
    const replay = await loadTolerant();
    const sheetKey = sheetKeys(replay.data)[0];
    const scope = { chatKey: String(stateManager.currentChatFileIdentifier_ACU || ''), isolationKey: mocks.isolationKey };
    try {
      markRuntimeOnlyPendingSheets_ACU(scope, { all: false, sheetKeys: [sheetKey] });
      expect(hasRuntimeOnlyPendingSheets_ACU(scope)).toBe(true);
      // runtime 快照与回放不同（多一行），若门闸失效会被当作「有分歧需落盘」写入聊天。
      const runtime = clone(replay.data);
      runtime[sheetKey].content.push(['3', 'runtime 独有', 'runtime 独有']);
      stateManager._set_currentJsonTableData_ACU(runtime);

      const result = await flushRuntimeOnlyPendingChanges_ACU('f2-tolerant-contract');
      console.log('[F2 观察] flush:', JSON.stringify(result));
      expect(result.flushed).toBe(false);
      expect(result.sheetKeys).toEqual([]);
      expect(result.error).toContain('兼容宽容回放');
      expect(hasRuntimeOnlyPendingSheets_ACU(scope)).toBe(true);
      expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining('兼容只读态'));
      await flushPendingCompatTransitionFixations_ACU();
      expect(countAppendedLogEntriesOutsideRoot()).toBe(0);
      expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
    } finally {
      clearRuntimeOnlyPendingSheets_ACU();
    }
  }, 60000);

  /**
   * 补充：用户场景端到端与围绕同名接管的边界——
   * (1) 已有旧 key 历史 + 用户导入同名新 key 模板 → 首次填表把新 key 以锚点写入历史
   *     → 之后严格回放按表名接管为模板侧单表（旧行随事件丢弃并记录），历史持续可写；
   * (2) 不同名新表照常引入（接管不误伤）；
   * (3) strict 成功的 F1-B 形状经接管后，恢复诊断不再报身份冲突；
   * (4) 仍需走宽容路径且含身份归并的历史（未知 op + 根内双 key）不会被自动固化为过渡根。
   */
  describe('补充：同名接管端到端、对照、恢复诊断与固化守卫', () => {
    function mountCleanSingleKeyChat(): void {
      const chat = buildChat(50);
      chat[0] = {
        is_user: false, mes: 'AI 楼层 0',
        TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: tolerantRootData() }, logEntries: [] } },
        },
      };
      mocks.chat.length = 0;
      mocks.chat.push(...chat);
    }

    function hasAnyPerSheetCheckpointFor(sheetKey: string): boolean {
      return mocks.chat.some(message => !!message?.TavernDB_ACU_IsolatedData?.['']?.storageFrame?.perSheetCheckpoints?.[sheetKey]);
    }

    function persistOptionsFor(afterData: any, sheetKey: string) {
      return {
        source: 'manual_fill',
        afterData,
        operations: [{ kind: 'sheet_replace' as const, sheetKey, sheet: clone(afterData[sheetKey]), reason: 'manual_crud' as const }],
        filledSheetKeys: [sheetKey],
        candidateChangedSheetKeys: [sheetKey],
        groupKeys: [],
        targetMessageIndex: lastAiIndex(mocks.chat),
        isolationKey: mocks.isolationKey,
        transactionContext: {
          baseRevision: null,
          writeSet: [{ kind: 'all' as const }],
          assertFresh: vi.fn(),
          runCommit: vi.fn(async (task: () => any) => task()),
        } as any,
        strictSave: true,
      } as any;
    }

    it('用户场景：旧 key 历史上导入同名新 key 模板并填表 → 锚点入史 → 严格回放按表名接管为模板侧单表并持续可写', async () => {
      mountCleanSingleKeyChat();
      mocks.saveChatStrict.mockReset();
      mocks.saveChatStrict.mockResolvedValue(undefined);
      // 用户导入的新模板：同名、新 key（模板侧 key 在归并时优先保留）。
      const importedTemplate = {
        mate: mate(),
        [NEW_KEY]: { uid: NEW_KEY, name: '主角信息表', content: [['row_id', 'name', 'state']], updateConfig: {}, exportConfig: {}, orderNo: 0, sourceData: { ddl: DDL } },
      };
      mocks.globalTemplateStr = JSON.stringify(importedTemplate);
      _set_TABLE_TEMPLATE_ACU(JSON.stringify(importedTemplate));

      // 首次填表：runtime 已按新模板使用新 key（旧 key 数据尚在历史里），AI 结果以 SQL 增量
      // 写入新 key——与现场 msg0「锚点 + sql_sheet_batch」的历史形状完全一致。
      const afterData: any = {
        mate: { type: 'acu', version: 1 },
        [NEW_KEY]: {
          uid: NEW_KEY, name: '主角信息表',
          content: [['row_id', 'name', 'state'], ['3', '新key填入', '新key态']],
          updateConfig: {}, exportConfig: {}, orderNo: 0,
          sourceData: { ddl: DDL },
        },
      };
      const result = await persistTableMutationLogV2_ACU({
        ...persistOptionsFor(afterData, NEW_KEY),
        operations: [{
          kind: 'sql_sheet_batch' as const,
          sheetKey: NEW_KEY,
          tableName: TABLE_NAME,
          reason: 'system' as const,
          statements: [`INSERT INTO ${TABLE_NAME} (row_id, name, state) VALUES (3, '新key填入', '新key态')`],
        }],
      });
      console.log('[F2 补充] 用户场景 persist:', JSON.stringify({ saved: result.saved, error: result.error }));
      expect(result.saved).toBe(true);
      // 新 key 以 header-only 锚点进入历史（这就是现场双身份历史的产生方式）——不再被拒。
      expect(hasAnyPerSheetCheckpointFor(NEW_KEY)).toBe(true);

      // 严格回放：header-only 锚点接管同名旧表（写入时该表确实被重置为空），随后 INSERT
      // 第 3 行——与现场「导入新模板后 AI 重填」完全一致；单身份、无兼容态、接管行数可见。
      const replay = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false, compatibilityMode: 'disabled' });
      console.log('[F2 补充] 用户场景 replay keys:', JSON.stringify(sheetKeys(replay?.data ?? {})), '| merges:', JSON.stringify(replay?.identityMerges ?? null));
      expect(replay?.baseKind).toBe('full_checkpoint');
      expect(replay?.requiresCheckpointConvergence).toBeFalsy();
      expect(sheetKeys(replay?.data ?? {})).toEqual([NEW_KEY]);
      expect(replay?.identityMerges).toHaveLength(1);
      expect(replay?.identityMerges?.[0]).toMatchObject({ fromKey: OLD_KEY, toKey: NEW_KEY, supersededRows: 2, appendedRows: 0 });
      expect(replay!.data[NEW_KEY].content).toEqual([
        ['row_id', 'name', 'state'],
        ['3', '新key填入', '新key态'],
      ]);
      expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining('同名表接管'));

      // 继续填表（第二笔）仍然可写，冷重载仍单身份：header + 第 3 行 + 第 4 行。
      const afterData2: any = clone(replay!.data);
      afterData2[NEW_KEY].content.push(['4', '第二笔', '态4']);
      const result2 = await persistTableMutationLogV2_ACU(persistOptionsFor(afterData2, NEW_KEY));
      expect(result2.saved).toBe(true);
      const cold = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false, compatibilityMode: 'disabled' });
      expect(sheetKeys(cold?.data ?? {})).toEqual([NEW_KEY]);
      expect(cold!.data[NEW_KEY].content).toEqual([
        ['row_id', 'name', 'state'],
        ['3', '新key填入', '新key态'],
        ['4', '第二笔', '态4'],
      ]);
      // 诊断面：validate 通过，recovery 不报身份冲突也不是兼容态。
      const validation = await validateCurrentChatTableRecovery_ACU();
      expect(validation.success).toBe(true);
      const recovery = await prepareV2Recovery_ACU();
      expect(recovery.status).not.toBe('unrecoverable_identity_conflict');
      expect(recovery.status).not.toBe('recoverable_compat_tolerant_replay');
    }, 60000);

    it('对照：引入不同名新表照常补写锚点并成功，归并不误伤不同名表', async () => {
      mountCleanSingleKeyChat();
      mocks.saveChatStrict.mockReset();
      mocks.saveChatStrict.mockResolvedValue(undefined);
      const ITEM_KEY = 'sheet_wu_pin_biao';
      const afterData = tolerantRootData();
      afterData[ITEM_KEY] = {
        uid: ITEM_KEY, name: '物品表',
        content: [['row_id', 'item'], ['1', '铁剑']],
        updateConfig: {}, exportConfig: {}, orderNo: 1,
        sourceData: { ddl: 'CREATE TABLE wupinbiao (row_id INTEGER PRIMARY KEY, item TEXT)' },
      };

      const result = await persistTableMutationLogV2_ACU(persistOptionsFor(afterData, ITEM_KEY));
      console.log('[F2 补充] 对照 persist:', JSON.stringify({ saved: result.saved, error: result.error }));
      expect(result.saved).toBe(true);
      expect(hasAnyPerSheetCheckpointFor(ITEM_KEY)).toBe(true);
      const after = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false, compatibilityMode: 'disabled' });
      expect(sheetKeys(after?.data ?? {})).toEqual([OLD_KEY, ITEM_KEY].sort());
      expect(after?.data?.[ITEM_KEY]?.content?.[1]).toEqual(['1', '铁剑']);
    }, 60000);

    it('恢复诊断：F1-B 形状经严格接管后单身份（无模板时沿用历史 key），recovery 不报身份冲突', async () => {
      // 复刻 F1-B：msg6 锚点 timeline afterSeq=4 晚于 SQL seq=3，SQL 目标旧 key。
      const chat = buildChat(50);
      chat[0] = {
        is_user: false, mes: 'AI 楼层 0',
        TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: tolerantRootData() }, logEntries: [] } },
        },
      };
      chat[6] = {
        is_user: false, mes: 'AI 楼层 3',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              perSheetCheckpoints: {
                [NEW_KEY]: {
                  kind: 'sheet_full', createdAt: 1, reason: 'schema_change', sheetKey: NEW_KEY,
                  data: {
                    uid: NEW_KEY, name: '主角信息表',
                    content: [['row_id', 'name', 'pos', 'state']],
                    updateConfig: {}, exportConfig: {}, orderNo: 0,
                    sourceData: { ddl: `CREATE TABLE ${TABLE_NAME} (row_id INTEGER PRIMARY KEY, name TEXT, pos TEXT, state TEXT)` },
                  },
                  timeline: { kind: 'sheet_introduction', activateAtMessageIndex: 6, afterSeq: 4 },
                },
              },
              logEntries: [{
                seq: 3, entryId: 'f2-supp-dual-identity-b', createdAt: 4, source: 'system', targetMessageIndex: 6, aiFloor: 3,
                filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
                operations: [{
                  kind: 'sql_sheet_batch', sheetKey: OLD_KEY, tableName: TABLE_NAME, reason: 'system',
                  statements: [`UPDATE ${TABLE_NAME} SET name = 'SQL改1', state = 'SQL改1' WHERE row_id = 1`],
                }],
              }],
            },
          },
        },
      };
      mocks.chat.length = 0;
      mocks.chat.push(...chat);

      // 修正前：strict 成功且双 key 并存、recovery 判「无需恢复」（双身份静默流出）。
      // 修正后：锚点应用时按表名接管，结果单身份。F2 describe 的模板不含「主角信息表」
      // （无偏好），规范 key 沿用已在历史中的旧 key——与 P2 协调让指导表保留 previous.key 一致，
      // 填表侧不会再把它当「模板外表」剔除；事件 key（新）登记重定向。
      const strict = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false, compatibilityMode: 'disabled' });
      console.log('[F2 补充] F1-B 形状 strict keys:', JSON.stringify(sheetKeys(strict?.data ?? {})), '| merges:', JSON.stringify(strict?.identityMerges ?? null));
      expect(strict?.baseKind).toBe('full_checkpoint');
      expect(sheetKeys(strict?.data ?? {})).toEqual([OLD_KEY]);
      expect(strict?.identityMerges).toEqual([expect.objectContaining({ fromKey: NEW_KEY, toKey: OLD_KEY, supersededRows: 2 })]);
      // 接管后表内容以锚点数据为准（新结构、header-only）。
      expect(strict!.data[OLD_KEY].content).toEqual([['row_id', 'name', 'pos', 'state']]);

      const summary = await prepareV2Recovery_ACU();
      console.log('[F2 补充] recovery(F1-B):', summary.status, '|', summary.message);
      expect(summary.status).not.toBe('unrecoverable_identity_conflict');
      expect(summary.status).not.toBe('recoverable_compat_tolerant_replay');
    }, 60000);

    it('固化守卫：仍需宽容路径且含身份归并的兼容结果不会被自动固化为过渡根，宿主保存零调用，二次加载仍为 tolerant 态', async () => {
      // 未知 op 迫使进入宽容路径；根内另有同名新 key，宽容路径也会做身份归并。
      mountTolerantChat({
        [NEW_KEY]: {
          uid: NEW_KEY, name: '主角信息表',
          content: [['row_id', 'name', 'state'], ['9', '根内新key行', '态9']],
          updateConfig: {}, exportConfig: {}, orderNo: 0,
          sourceData: { ddl: DDL },
        },
      });
      // 让宿主保存可用：若守卫失效，固化会真正写入过渡根并调用保存——本用例要证明它不会。
      mocks.saveChatStrict.mockReset();
      mocks.saveChatStrict.mockResolvedValue(undefined);

      const first = await loadTolerant();
      expect(first.baseKind).toBe('compat_tolerant_replay');
      expect(first.legacyToleranceDiagnosis?.tolerances).toContain('unknown_operation_kind_skipped:1');
      expect(first.legacyToleranceDiagnosis?.identityRemaps.length).toBe(1);
      expect(sheetKeys(first.data)).toHaveLength(1);
      expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
      expect(mocks.saveChatStrict).not.toHaveBeenCalled();
      expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining('放弃固化兼容过渡根：兼容结果含 sheetKey 身份归并'));
      expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining('身份归一化'));

      const second = await loadTolerant();
      expect(second.baseKind).toBe('compat_tolerant_replay');
      expect(second.requiresCheckpointConvergence).toBe(true);
      expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
      expect(mocks.saveChatStrict).not.toHaveBeenCalled();
      // 恢复诊断把身份归并明细带给用户。
      const summary = await prepareV2Recovery_ACU();
      expect(summary.status).toBe('recoverable_compat_tolerant_replay');
      expect(summary.message).toContain('身份归并=');
      expect(summary.message).toContain('不会自动固化为过渡根');
      expect(summary.affectedSheetKeys ?? []).toEqual(expect.arrayContaining([OLD_KEY, NEW_KEY]));
    }, 60000);
  });
});

/** AI 替身：仅 mock callCustomOpenAI_ACU，模块内 parser/prepare 等保持真实实现。 */
vi.mock('../../src/service/ai/prompt-builder', async importOriginal => ({
  ...(await importOriginal<any>()),
  callCustomOpenAI_ACU: (...args: any[]) => mocks.callCustomOpenAI(...args),
}));
