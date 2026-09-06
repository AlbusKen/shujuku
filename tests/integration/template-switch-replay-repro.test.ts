import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P1 因果复现：50 个 AI 楼层（旧随机 key 模板）→ 切同名异构模板（稳定 key）→
 * 下一轮填表 → 历史回放身份分叉。
 * 预期（修复前）红：template 输入的新 key 被塞进旧 key guide 的 sourceData.ddl，
 * 形成“持久身份旧 key + 物理表名新 key”的契约失配；V2 历史帧仍引用旧 key。
 */
const mocks = vi.hoisted(() => ({
  chat: [] as any[],
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
  return { ...actual, logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn(), logError_ACU: vi.fn() };
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
import { loadTableStateFromFramesV2Detailed_ACU } from '../../src/service/table/storage-frame-v2-replay';
import { ensureV2BoundaryCheckpointForRetainedBuffer_ACU } from '../../src/service/chat/chat-service';
import { getTableDataFingerprint_ACU } from '../../src/service/table/table-data-upgrade-audit';

import { buildBatchMergeBase_ACU } from '../../src/service/table/update-orchestrator';
import { getChatSheetGuideDataForIsolationKey_ACU } from '../../src/service/template/chat-scope/chat-scope-guide';

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

/** AI 替身：仅 mock callCustomOpenAI_ACU，模块内 parser/prepare 等保持真实实现。 */
vi.mock('../../src/service/ai/prompt-builder', async importOriginal => ({
  ...(await importOriginal<any>()),
  callCustomOpenAI_ACU: (...args: any[]) => mocks.callCustomOpenAI(...args),
}));
