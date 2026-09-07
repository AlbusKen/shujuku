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
import { prepareV2Recovery_ACU } from '../../src/service/table/table-v2-recovery-service';
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
 * F1 双身份存量复现（构造复现——计划 #followup-repro）。
 * 存量样本：full 根仅旧 key（sheet_DpKcVGqg，物理表名 zhu_jue_xin_xi_biao），
 * msg6 同帧经 perSheetCheckpoints timeline（sheet_introduction, afterSeq=2）引入
 * 新 key header-only 锚点，同帧 seq=3 执行 sql_sheet_batch（目标新 key）。
 * 对齐现场因果链（21:09:18.305 回放失败 → 18.316 兼容归并追加 1 行 → 18.791 兼容成功继续）。
 * 列保真用独特值断言：旧行「状态=旧A1」；「个人原存档复现」待脱敏样本，未在本包验证。
 */
describe('F1 双身份存量经真实追平提交与冷重载（修正前观察）', () => {
  const OLD_KEY = 'sheet_DpKcVGqg';
  const NEW_KEY = 'sheet_zhu_jue_xin_xi_biao';
  // 物理表名对齐现场日志（「zhujuexinxibiao」）；DDL 列名用 ASCII（真实模板契约，
  // 见 api-template-ascii-header-validation 里程碑），中文只出现在展示值里。
  const TABLE_NAME = 'zhujuexinxibiao';
  const OLD_ROW = ['1', '名字0', '状态=旧A1'];

  beforeEach(() => {
    // 复刻 P1 setup：回放/规划/持久化的准入门依赖 settings 与 chatIdentifier，
    // 顶层 describe 不继承 P1 的 beforeEach，跨用例脏状态会让回放早退。
    Object.assign(stateManager.settings_ACU, {
      storageMode: 'native',
      dataIsolationEnabled: false,
      dataIsolationCode: '',
    });
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
          // SQL 列集与目标 key 的真实 DDL 一致（存量 SQL 总是按其目标表结构书写），
          // 排除构造失真，让失败只由身份冲突/归并缺陷引起。
          statements: [sqlTargetKey === NEW_KEY
            ? `UPDATE ${TABLE_NAME} SET name = 'SQL改1', pos = 'SQL改1', state = 'SQL改1' WHERE row_id = 1`
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

  it('同帧顺序A：锚点(afterSeq=2)早于SQL(seq=3)新key目标——修正前观察兼容归并与列保真（构造复现）', async () => {
    mocks.chat.length = 0;
    mocks.chat.push(...mountDualIdentityChat());
    stateManager._set_currentJsonTableData_ACU(null);

    // 修正前基线：strict 回放实测。对齐现场 21:09:18.305：双身份+SQL 历史让 strict
    // 回放在 seq=3 sql_sheet_batch 抛物理表名冲突（现场该错误由兼容路径接管后转成功）。
    let strictError: unknown = null;
    let before: Awaited<ReturnType<typeof loadTableStateFromFramesV2Detailed_ACU>> = null;
    try {
      before = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false });
    } catch (error) {
      strictError = error;
    }
    const strictErrorMessage = strictError instanceof Error ? strictError.message : strictError === null ? null : String(strictError);
    console.log('[F1 观察] strictError:', strictErrorMessage);
    console.log('[F1 观察] strict baseKind:', before?.baseKind, '| keys:', JSON.stringify(sheetKeys(before?.data ?? {})));
    // 修正前断言：strict 回放必须失败于物理表名冲突，且报出双 key（现场同款证据）。
    expect(strictErrorMessage).toContain('SQLite 物理表名冲突');
    expect(strictErrorMessage).toContain(OLD_KEY);
    expect(strictErrorMessage).toContain(NEW_KEY);

    // 兼容宽容回放：对齐现场 21:09:18.316-18.791（兼容归并接管后回放继续）。
    // 实测第二缺陷面：宽容链无法完整回放双身份历史——seq=3 SQL 执行处列失配
    // （no such column: pos）：两 key 共享规范物理表名时实际建表结构与存量 SQL
    // 引用列错位，身份归并/物理名解析未覆盖「锚点引入 + 存量 SQL」组合。F3 修复面即此。
    let tolerantError: unknown = null;
    let tolerant: Awaited<ReturnType<typeof replayWithLegacyTolerances_ACU>> = null;
    try {
      tolerant = await replayWithLegacyTolerances_ACU(mocks.chat, mocks.isolationKey);
    } catch (error) {
      tolerantError = error;
    }
    const tolerantErrorMessage = tolerantError instanceof Error ? tolerantError.message : tolerantError === null ? null : String(tolerantError);
    console.log('[F1 观察] tolerantError:', tolerantErrorMessage);
    if (tolerant) {
      console.log('[F1 观察] tolerant keys:', JSON.stringify(sheetKeys(tolerant.data ?? {})));
      console.log('[F1 观察] tolerant OLD:', JSON.stringify(tolerant.data?.[OLD_KEY]?.content ?? null));
      console.log('[F1 观察] tolerant NEW:', JSON.stringify(tolerant.data?.[NEW_KEY]?.content ?? null));
      console.log('[F1 观察] tolerant report:', JSON.stringify(tolerant.toleranceReport ?? null));
    }
    // 修正前断言（实测签名）：宽容链无法完整回放双身份历史，SQL 执行处列失配。
    expect(tolerantErrorMessage).toContain('no such column');

    // 公开追平入口（真实规划/预检/提交链；宿主与 AI 为替身）。
    // runtime 置为用户可见的旧 key 单表（对齐现场：用户已加载表格并追平），
    // 目标与快照一致以绕过 TOCTOU 闸门，观察规划器在双身份历史上的修正前路径：
    // fail-closed 报错，还是经兼容读取继续消耗 AI——以实测断言，不预设。
    stateManager._set_currentJsonTableData_ACU(clone(dualRootData()));
    mocks.callCustomOpenAI.mockResolvedValue('<tableEdit>\ninsertRow(0, {"0":"名字A", "1":"状态A"});\n</tableEdit>');
    const callCountBefore = mocks.callCustomOpenAI.mock.calls.length;
    const result = await orchestrateManualCatchUp_ACU([OLD_KEY], refreshMergedDataAndNotify_ACU, {
      abortController: new AbortController(),
      onProgress: () => {},
      executionSnapshot: { sheetKeys: [OLD_KEY] },
    });
    console.log('[F1 观察] 追平结果:', JSON.stringify(result));
    console.log('[F1 观察] AI 消耗次数:', mocks.callCustomOpenAI.mock.calls.length - callCountBefore);
    // 修正前断言：双身份历史不可构造可填状态，追平必须失败且零 AI 消耗（F2 不变量）。
    expect(result.success).toBe(false);
    expect(mocks.callCustomOpenAI.mock.calls.length).toBe(callCountBefore);

    // 冷重载不变性：修正前 strict 回放对构造帧持续失败，状态未被静默改写。
    let coldError: unknown = null;
    try {
      await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false });
    } catch (error) {
      coldError = error;
    }
    expect(coldError instanceof Error ? coldError.message : '').toContain('SQLite 物理表名冲突');
  }, 120000);

  it('同帧顺序B：锚点(afterSeq=4)晚于SQL(seq=3)且SQL目标旧key——修正前观察归并触发与冲突分类（构造复现）', async () => {
    mocks.chat.length = 0;
    mocks.chat.push(...mountDualIdentityChat());
    // 顺序反转：锚点 timeline.afterSeq=4 晚于 SQL seq=3，SQL 目标改指旧 key。
    mocks.chat[6].TavernDB_ACU_IsolatedData[''].storageFrame = dualIdentityFrame(4, OLD_KEY);
    stateManager._set_currentJsonTableData_ACU(null);

    let strictErrorB: unknown = null;
    let resultB: Awaited<ReturnType<typeof loadTableStateFromFramesV2Detailed_ACU>> = null;
    try {
      resultB = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false });
    } catch (error) {
      strictErrorB = error;
    }
    const msgB = strictErrorB instanceof Error ? strictErrorB.message : String(strictErrorB ?? '');
    console.log('[F1-B 观察] strictError:', msgB);
    console.log('[F1-B 观察] baseKind:', resultB?.baseKind, '| keys:', JSON.stringify(sheetKeys(resultB?.data ?? {})));
    console.log('[F1-B 观察] OLD:', JSON.stringify(resultB?.data?.[OLD_KEY]?.content ?? null));
    console.log('[F1-B 观察] NEW:', JSON.stringify(resultB?.data?.[NEW_KEY]?.content ?? null));
    // 修正前断言（实测签名）：顺序反转下 strict 回放静默成功——seq=3 SQL 执行时锚点
    // （afterSeq=4）尚未生效，state 仅旧 key，SQL 通过；锚点生效后无后续 SQL 段，
    // 物理表名冲突不暴露，双身份随结果静默流出。严格回放通过不等于历史身份干净，
    // 而混合存储写决策恰以严格回放为可信证据——第三个缺陷面。
    expect(strictErrorB).toBeNull();
    // 双身份随 strict 结果静默流出（实测）：两 key 并存，存量 SQL 的改写值落在旧 key，
    // 新 key 仅 header-only 锚点无数据行（物理表名冲突因此未触发）。
    expect(sheetKeys(resultB?.data ?? {})).toEqual([OLD_KEY, NEW_KEY].sort());
    expect(resultB?.data?.[OLD_KEY]?.content?.[1]).toEqual(['1', 'SQL改1', 'SQL改1']);
  }, 120000);

  it('116 消息拓扑：终态 progress 帧不被计为新增填表，追平 fail-closed 零 AI 消耗（构造复现）', async () => {
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

    // strict 历史不可读（同用例 A 因果链），追平 fail-closed 且终态 progress 不被当作
    // 「已填完」免检依据（0-op 终态事件不得展示为新增填表完成——计划 F5 不变量）。
    let strictErrorC: unknown = null;
    try {
      await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false });
    } catch (error) {
      strictErrorC = error;
    }
    expect(strictErrorC instanceof Error ? strictErrorC.message : '').toContain('SQLite 物理表名冲突');

    stateManager._set_currentJsonTableData_ACU(clone(dualRootData()));
    mocks.callCustomOpenAI.mockResolvedValue('<tableEdit>\ninsertRow(0, {"0":"名字A", "1":"状态A"});\n</tableEdit>');
    const callsBeforeC = mocks.callCustomOpenAI.mock.calls.length;
    const resultC = await orchestrateManualCatchUp_ACU([OLD_KEY], refreshMergedDataAndNotify_ACU, {
      abortController: new AbortController(),
      onProgress: () => {},
      executionSnapshot: { sheetKeys: [OLD_KEY] },
    });
    console.log('[F1-C 观察] 追平结果 outcome:', resultC.outcome, '| diagnosticCode:', resultC.diagnosticCode);
    expect(resultC.success).toBe(false);
    expect(mocks.callCustomOpenAI.mock.calls.length).toBe(callsBeforeC);
  }, 120000);
});

/**
 * F2 兼容宽容回放结果契约（修正后——计划 #followup-replay-contract）。
 * 构造：full 根仅旧 key（sheet_DpKcVGqg），同帧 logEntry 经 sheet_replace 引入同名同列的
 * 新 key（sheet_zhu_jue_xin_xi_biao），随后 sql_sheet_batch 目标新 key。严格回放在 SQL 段
 * 抛「SQLite 物理表名冲突」；Tier-1 宽容回放经身份归并成功读出（两代 key 列集一致，
 * 避开 F1-A 的 `no such column: pos` 缺陷面，让结果契约本身成为被测对象）。
 * 契约：tolerant 结果必须自带 requiresCheckpointConvergence=true 与 legacyToleranceDiagnosis，
 * 写路径（persist / 追平 / runtime-only flush）fail-closed，诊断路径（validate / recovery）
 * 给出指向恢复收敛的精确诊断；F1 三用例的观察结果不因 F2 改变。
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
    // 固化成功后历史将从过渡根起算走严格快路径，不再是 F2 的被测态。本构造含身份归并，
    // 固化守卫会直接放弃（见「固化守卫」用例）；这里再让宿主严格保存失败作第二道保险，
    // 保证即使守卫条件变化，整个用例期间历史也保持「仅可宽容读出、未固化」。
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

  /** 同帧：sheet_replace 引入同名同列新 key → sql_sheet_batch 目标新 key。 */
  function tolerantFrame() {
    return {
      version: 2,
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: tolerantRootData() },
      logEntries: [{
        seq: 1,
        entryId: 'f2-tolerant-identity',
        createdAt: 2,
        source: 'system',
        targetMessageIndex: 0,
        aiFloor: 0,
        filledSheetKeys: [],
        changedSheetKeys: [],
        groupKeys: [],
        operations: [
          {
            kind: 'sheet_replace',
            sheetKey: NEW_KEY,
            reason: 'system',
            sheet: {
              uid: NEW_KEY, name: '主角信息表',
              content: [['row_id', 'name', 'state'], ['1', '模板名', '模板态']],
              updateConfig: {}, exportConfig: {}, orderNo: 0,
              sourceData: { ddl: DDL },
            },
          },
          {
            kind: 'sql_sheet_batch',
            sheetKey: NEW_KEY,
            tableName: TABLE_NAME,
            reason: 'system',
            statements: [`UPDATE ${TABLE_NAME} SET name = 'SQL改1', state = 'SQL改1' WHERE row_id = 1`],
          },
        ],
      }],
    };
  }

  function mountTolerantChat(): void {
    const chat = buildChat(50);
    chat[0] = {
      is_user: false, mes: 'AI 楼层 0',
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: tolerantFrame() },
      },
    };
    mocks.chat.length = 0;
    mocks.chat.push(...chat);
  }

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

    // 严格回放必须失败于物理表名冲突（构造有效性前提），否则不会进入降级链。
    let strictError: unknown = null;
    try {
      await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false, compatibilityMode: 'disabled' });
    } catch (error) {
      strictError = error;
    }
    expect(strictError instanceof Error ? strictError.message : String(strictError ?? '')).toContain('SQLite 物理表名冲突');

    const replay = await loadTolerant();
    console.log('[F2 观察] baseKind:', replay.baseKind, '| keys:', JSON.stringify(sheetKeys(replay.data)),
      '| tolerances:', JSON.stringify(replay.legacyToleranceDiagnosis?.tolerances ?? null));
    expect(replay.baseKind).toBe('compat_tolerant_replay');
    expect(replay.requiresCheckpointConvergence).toBe(true);
    expect(replay.legacyToleranceDiagnosis).toBeDefined();
    expect(replay.legacyToleranceDiagnosis?.tolerances).toContain('sheet_identity_remap:1');
    expect(replay.legacyToleranceDiagnosis?.strictError).toContain('SQLite 物理表名冲突');
    // Phase 4b 约束：宽容态容忍项不是 temporary_sheet_anchor 模型，不得伪装成 repairs。
    expect(replay.compatibilityRepairs ?? []).toHaveLength(0);
    // 只读可用性保留：归并后单身份且 SQL 改写生效（读永远宽容）。
    const keys = sheetKeys(replay.data);
    expect(keys).toHaveLength(1);
    const merged = replay.data[keys[0]];
    expect(merged.content[1]).toEqual(['1', 'SQL改1', 'SQL改1']);
    // 身份归并明细随诊断带出（F3 消费面）：一次 remap，两 key 之一归并到另一个。
    const remaps = replay.legacyToleranceDiagnosis?.identityRemaps ?? [];
    expect(remaps).toHaveLength(1);
    expect([OLD_KEY, NEW_KEY]).toContain(remaps[0].fromKey);
    expect([OLD_KEY, NEW_KEY]).toContain(remaps[0].toKey);
    expect(remaps[0].fromKey).not.toBe(remaps[0].toKey);
    expect(remaps[0].toKey).toBe(keys[0]);
    // 固化确已尝试但被身份归并守卫放弃：历史保持未固化 tolerant 态，且无残迹。
    expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining('放弃固化兼容过渡根：兼容结果含 sheetKey 身份归并'));
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
    expect(result.error).toContain('SQLite 物理表名冲突');
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
    expect(result.error).toContain('SQLite 物理表名冲突');
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
    // 实测路径（模板复位后确定）：规划出 1 wave/50 楼，首个 bucket 在 AI 调用前由
    // loadV2ReplayMergeBase_ACU 的 F2 分支 throw → 本批中止；随后终态 progress 写入
    // 也被 persist 写前门拒绝——聊天零写入。该路径无 diagnosticCode（catch 转 failed）。
    expect(result.outcome).toBeUndefined();
    expect(result.committedBucketCount).toBe(0);
    expect(result.dataCommitted).toBe(false);
    expect(result.error).toContain('不能作为填表基底');
    expect(result.error).toContain('终态进度保存失败');
    expect(result.error).toContain('兼容宽容回放读出');
    expect(mocks.callCustomOpenAI.mock.calls.length).toBe(callsBefore);
    expect(countAppendedLogEntriesOutsideRoot()).toBe(0);
    expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
  }, 120000);

  it('追平 fail-closed（零 bucket 路径）：全局模板已切到新 key 时终态验证报 replay_requires_checkpoint_convergence', async () => {
    mountTolerantChat();
    const replay = await loadTolerant();
    const sheetKey = sheetKeys(replay.data)[0];
    // 现场配置：全局模板已切到模板 B（同名、新稳定 key），聊天 guide 仍只有旧 key。
    // chunk 处理里 rebindSheetKeysThroughTableAliases_ACU 按同名别名把目标旧 key 改绑为
    // 新 key，随后 TemplateScope（来自 guide）判定新 key「模板未声明」而剔除→本 wave
    // 零 bucket→不经 merge base 直接进入 verifyCommittedCatchUpReplay。该终态验证必须
    // 识别 tolerant 态并报恢复需求，不能把兼容数据当作「验证通过」回写运行时视图。
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
    expect(result.outcome).toBe('integrity_failed');
    expect(result.diagnosticCode).toBe('replay_requires_checkpoint_convergence');
    expect(result.error).toContain('兼容宽容回放读出');
    expect(result.replayVerified).toBe(false);
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
    expect(summary.message).toContain('sheet_identity_remap:1');
    await flushPendingCompatTransitionFixations_ACU();
    expect(hasAnyCompatTransitionCheckpoint()).toBe(false);
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
   * 补充：前序计划（table-template-replay-consistency）P2/P5 核对后发现的三个缺口——
   * (1) persist 补写 per-sheet 锚点的写入口不检查物理表名冲突，可继续制造双身份历史；
   * (2) 恢复诊断只审计 full 根，strict 静默成功的双身份（F1-B 形状）被判「无需恢复」；
   * (3) C3 自动固化会把按 key 优先级归并的兼容结果持久化为权威过渡根，绕过全部写门闸。
   */
  describe('补充：双身份写入口、回放结果诊断与固化守卫', () => {
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

    it('写入口：为同名新 key 补写锚点会与既有活跃表物理名冲突，persist fail-closed 且不落任何锚点', async () => {
      mountCleanSingleKeyChat();
      mocks.saveChatStrict.mockReset();
      mocks.saveChatStrict.mockResolvedValue(undefined);
      // 干净单 key 历史（strict 可读），写入方带来同名新 key——这正是存量双身份历史的产生方式。
      const afterData = tolerantRootData();
      afterData[NEW_KEY] = {
        uid: NEW_KEY, name: '主角信息表',
        content: [['row_id', 'name', 'state'], ['1', '新key名', '新key态']],
        updateConfig: {}, exportConfig: {}, orderNo: 0,
        sourceData: { ddl: DDL },
      };

      const result = await persistTableMutationLogV2_ACU(persistOptionsFor(afterData, NEW_KEY));
      console.log('[F2 补充] 写入口 persist:', JSON.stringify({ saved: result.saved, error: result.error }));
      expect(result.saved).toBe(false);
      expect(result.error).toContain('物理表名冲突');
      expect(result.error).toContain('已拒绝补写 per-sheet 锚点');
      expect(result.error).toContain(OLD_KEY);
      expect(result.error).toContain(NEW_KEY);
      expect(result.error).toContain(TABLE_NAME);
      expect(hasAnyPerSheetCheckpointFor(NEW_KEY)).toBe(false);
      expect(countAppendedLogEntriesOutsideRoot()).toBe(0);
      expect(mocks.saveChatStrict).not.toHaveBeenCalled();
      // 历史仍严格可读且仅旧 key。
      const after = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false, compatibilityMode: 'disabled' });
      expect(after?.baseKind).toBe('full_checkpoint');
      expect(sheetKeys(after?.data ?? {})).toEqual([OLD_KEY]);
    }, 60000);

    it('写入口对照：引入不同名新表照常补写锚点并成功，门闸不误伤正常新表', async () => {
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

    it('恢复诊断：strict 静默成功的双身份（F1-B 形状）报 unrecoverable_identity_conflict 而非「无需恢复」', async () => {
      // 复刻 F1-B：msg6 锚点 timeline afterSeq=4 晚于 SQL seq=3，SQL 目标旧 key → strict 成功、双 key 流出。
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

      // 前提：strict 成功且双 key 并存（F1-B 实测签名）。
      const strict = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, mocks.isolationKey, { updateRuntimeState: false, compatibilityMode: 'disabled' });
      expect(strict?.baseKind).toBe('full_checkpoint');
      expect(sheetKeys(strict?.data ?? {})).toEqual([OLD_KEY, NEW_KEY].sort());

      const summary = await prepareV2Recovery_ACU();
      console.log('[F2 补充] recovery(F1-B):', JSON.stringify(summary));
      expect(summary.status).toBe('unrecoverable_identity_conflict');
      expect(summary.message).toContain(OLD_KEY);
      expect(summary.message).toContain(NEW_KEY);
      expect(summary.message).toContain(TABLE_NAME);
      expect(summary.affectedSheetKeys ?? []).toEqual(expect.arrayContaining([OLD_KEY, NEW_KEY]));
    }, 60000);

    it('固化守卫：含身份归并的兼容结果不会被自动固化为过渡根，宿主保存零调用，二次加载仍为 tolerant 态', async () => {
      mountTolerantChat();
      // 让宿主保存可用：若守卫失效，固化会真正写入过渡根并调用保存——本用例要证明它不会。
      mocks.saveChatStrict.mockReset();
      mocks.saveChatStrict.mockResolvedValue(undefined);

      const first = await loadTolerant();
      expect(first.baseKind).toBe('compat_tolerant_replay');
      expect(first.legacyToleranceDiagnosis?.identityRemaps.length).toBe(1);
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
