/**
 * tests/service/table/pristine-template-commit.integration.test.ts
 *
 * 复查点 1：确认助手复现路径已消除。
 *
 * 复现路径（计划 F 系列）：
 *   1. 空数据聊天（零 V2 数据）
 *   2. 默认表格预设 + V2 可视化编辑器删表 + 保存模板到当前聊天
 *   3. 旧逻辑会写 header-only full checkpoint 到最新 AI 楼层
 *   4. 追平撞 fail-fast：targetMessageIndex=4, latestFullCheckpointIndex=304
 *
 * 本测试用真实 persist / replay / write-transaction，只 mock 外部边界
 * （gateway、chat-history 容器、chat-scope 的 guide setter），验证：
 *   A. 空数据聊天 + scope-only 保存 → 聊天零 full checkpoint
 *   B. 旧逻辑造出 header-only root → demoteTemplateOnlyRootToScopeOnly_ACU 降级成功 → 零 full checkpoint
 *   C. 降级后追平 persist 不再撞 fail-fast
 *   D. root 含真实数据行 → 拒绝降级，零写入
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  saveChat: vi.fn().mockResolvedValue(undefined),
  saveChatStrict: vi.fn().mockResolvedValue(undefined),
  settings: {
    storageMode: 'native',
    dataIsolationEnabled: false,
    dataIsolationCode: '',
  },
  chatIdentifier: 'pristine-template-commit-test-chat',
  isolationKey: '',
  scopeContainer: null as any,
  guideContainer: null as any,
  setGuideResult: true,
  currentJsonTableData: null as any,
  templateObj: null as any,
  defaultTemplateObj: null as any,
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.saveChat,
  saveChatToHostStrict_ACU: mocks.saveChatStrict,
  emitMessageUpdated_ACU: vi.fn(),
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/data/repositories/chat-message-data-repo')>()),
  cloneIsolatedData_ACU: vi.fn((message: any) => {
    const raw = message?.TavernDB_ACU_IsolatedData;
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    return JSON.parse(JSON.stringify(raw || {}));
  }),
  writeMessageIdentity_ACU: vi.fn((message: any, isolationConfig: any) => {
    if (isolationConfig.enabled) message.TavernDB_ACU_Identity = isolationConfig.code;
    else delete message.TavernDB_ACU_Identity;
  }),
}));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return {
    ...actual,
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
    logError_ACU: vi.fn(),
  };
});

vi.mock('../../../src/service/runtime/state-manager', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/service/runtime/state-manager')>();
  return {
    ...actual,
    settings_ACU: mocks.settings,
    get currentChatFileIdentifier_ACU() { return mocks.chatIdentifier; },
    getCurrentIsolationKey_ACU: vi.fn(() => mocks.isolationKey),
    get currentJsonTableData_ACU() { return mocks.currentJsonTableData; },
    _set_currentJsonTableData_ACU: vi.fn((value: any) => { mocks.currentJsonTableData = value; }),
  };
});

vi.mock('../../../src/data/storage/chat-history', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/data/storage/chat-history')>()),
  getActiveChatStorageIdentity_ACU: vi.fn(() => mocks.chatIdentifier),
  peekChatScopedConfigContainer_ACU: vi.fn(() => mocks.scopeContainer),
  peekChatSheetGuideContainer_ACU: vi.fn(() => mocks.guideContainer),
  setChatScopedConfigContainer_ACU: vi.fn((_chat: any[], value: any) => { mocks.scopeContainer = value; }),
  setChatSheetGuideContainer_ACU: vi.fn((_chat: any[], value: any) => { mocks.guideContainer = value; }),
}));

// chat-scope 的 guide setter 依赖大量内部函数，测试中 mock 为可配置结果，
// 其余保持真实。降级函数本身不依赖 guide setter；只有 scope-only 提交用它。
vi.mock('../../../src/service/template/chat-scope', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/service/template/chat-scope')>();
  return {
    ...actual,
    setChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => mocks.setGuideResult),
  };
});

// 降级校验的模板基线来源：resolveHeaderOnlyTemplateSnapshot_ACU 在无 chat scope 时
// 回退到 getGlobalTemplateSnapshotForCurrentProfile_ACU（chat-scope-template.ts:703），
// 它经 readProfileTemplateFromStorage_ACU 读全局模板。测试 mock 该函数返回与 seed root
// 结构一致的模板（sheet_a/sheet_b + mate），否则指纹比对会因「默认模板 8 张表 != root
// 结构」而正确拒绝降级，测试将无法验证「降级成功」路径。
vi.mock('../../../src/data/repositories/profile-repo', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/data/repositories/profile-repo')>();
  mocks.defaultTemplateObj = {
    sheet_a: { uid: 'sheet_a', name: '表A', content: [['row_id', '值']], updateConfig: {}, exportConfig: {}, sourceData: {}, orderNo: 0 },
    sheet_b: { uid: 'sheet_b', name: '表B', content: [['row_id', '值']], updateConfig: {}, exportConfig: {}, sourceData: {}, orderNo: 1 },
    mate: { type: 'database', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: {} },
  };
  mocks.templateObj = mocks.defaultTemplateObj;
  return {
    ...actual,
    readProfileTemplateFromStorage_ACU: vi.fn(() => JSON.stringify(mocks.templateObj)),
  };
});


import { buildCanonicalFullCheckpoint_ACU, buildCanonicalSheetCheckpoint_ACU } from '../../../src/service/table/canonical-checkpoint-builder';
import { collectV2FullCheckpointIndices_ACU, commitCurrentFloorTemplateScopeOnly_ACU, demoteTemplateOnlyRootToScopeOnly_ACU, persistTableMutationLogV2_ACU } from '../../../src/service/table/storage-frame-v2-persist';
import { loadTableStateFromFramesV2Detailed_ACU, resolveHeaderOnlyTemplateSnapshot_ACU } from '../../../src/service/table/storage-frame-v2-replay';

function sheet(name: string, rows: any[][] = [['row_id', '值']]) {
  return {
    uid: name,
    name,
    content: rows,
    updateConfig: {},
    exportConfig: {},
    sourceData: {},
    orderNo: 0,
  } as any;
}

function mate() {
  return { type: 'database', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: {} };
}

/** 构造空数据聊天：AI 楼层 0..N，零 V2 数据。 */
function buildEmptyChat(aiFloorCount = 6): any[] {
  const chat: any[] = [];
  for (let i = 0; i < aiFloorCount; i++) {
    if (i > 0) chat.push({ is_user: true, mes: `用户${i}` });
    chat.push({ is_user: false, mes: `AI 楼层 ${i}` });
  }
  return chat;
}

/** 在指定 AI 楼层写入 header-only init full checkpoint（复刻旧逻辑 pristine 分支）。
 * 结构必须取自 resolveHeaderOnlyTemplateSnapshot_ACU（模板基线的 header-only 投影）：
 * 真实场景中旧逻辑的 baselineData 来自 visualizer.templateBaseData（即模板），
 * 因此 root 的 uid/exportConfig/orderNo 等字段天然与模板一致。手工造结构会让降级
 * 校验的整对象指纹比对（getTableDataFingerprint_ACU）因字段集差异而错误拒绝。
 */
function seedHeaderOnlyTemplateRoot(chat: any[], isolationKey: string, aiIndex: number): void {
  const templateBaseline = resolveHeaderOnlyTemplateSnapshot_ACU(chat, isolationKey);
  if (!templateBaseline) throw new Error('测试模板基线不可得（mock readProfileTemplateFromStorage_ACU 未生效）');
  const checkpointData = templateBaseline;
  const checkpointResult = buildCanonicalFullCheckpoint_ACU({
    createdAt: Date.now(),
    reason: 'init',
    data: checkpointData,
    event: { filledSheetKeys: [], changedSheetKeys: ['sheet_a', 'sheet_b'], groupKeys: [] },
    context: { messageIndex: aiIndex, aiFloor: 0, isolationKey },
  });
  if (!checkpointResult.checkpoint) throw new Error(`构造 init checkpoint 失败：${checkpointResult.error}`);
  const sheetCheckpoints: any[] = [];
  for (const sheetKey of ['sheet_a', 'sheet_b']) {
    const result = buildCanonicalSheetCheckpoint_ACU({
      createdAt: Date.now(),
      reason: 'schema_change',
      sheetKey,
      data: (checkpointData as any)[sheetKey],
      event: { filledSheetKeys: [], changedSheetKeys: [sheetKey], groupKeys: [] },
      baseRevision: null,
      context: { messageIndex: aiIndex, aiFloor: 0, isolationKey },
    });
    if (!result.checkpoint) throw new Error(`构造 sheet checkpoint 失败：${result.error}`);
    sheetCheckpoints.push(result.checkpoint);
  }
  chat[aiIndex].TavernDB_ACU_IsolatedData = {
    [isolationKey]: {
      _acu_storage_version: 2,
      storageFrame: {
        version: 2,
        checkpoint: checkpointResult.checkpoint,
        perSheetCheckpoints: Object.fromEntries(sheetCheckpoints.map(cp => [cp.sheetKey, cp])),
        logEntries: [],
        headRevision: 'checkpoint:mock',
      },
    },
  };
}

function aiIndices(chat: any[]): number[] {
  return chat.map((m: any, index: number) => (!m.is_user ? index : -1)).filter((index: number) => index >= 0);
}

describe('pristine 模板提交复现路径（复查点 1）', () => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.currentJsonTableData = null;
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
    mocks.chatIdentifier = 'pristine-template-commit-test-chat';
    mocks.isolationKey = '';
    mocks.scopeContainer = null;
    mocks.guideContainer = null;
    mocks.setGuideResult = true;
    mocks.templateObj = mocks.defaultTemplateObj;
  });

  it('A：空数据聊天 + scope-only 保存模板 → 聊天零 full checkpoint', async () => {
    mocks.chat.push(...buildEmptyChat(6));
    const isolationKey = mocks.isolationKey;
    const orderedData = {
      mate: mate(),
      sheet_a: sheet('表A', [['row_id', '值']]),
    };
    const result = await commitCurrentFloorTemplateScopeOnly_ACU({
      isolationKey,
      baselineData: orderedData as any,
      candidateData: orderedData as any,
      guideData: { sheet_a: { name: '表A' } },
      templateSource: orderedData,
      source: 'visualizer_v2_save',
      reason: 'visualizer_v2_template_scope_only',
      pristineOverride: true,
    });
    expect(result.saved).toBe(true);
    expect(result.mode).toBe('scope_only');
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, isolationKey).length).toBe(0);
  });

  it('B：旧逻辑残留 header-only init root → 降级成功 → 零 full checkpoint，表结构等价', async () => {
    mocks.chat.push(...buildEmptyChat(6));
    const isolationKey = mocks.isolationKey;
    const aiIndicesList = aiIndices(mocks.chat);
    const rootIndex = aiIndicesList[aiIndicesList.length - 1];
    seedHeaderOnlyTemplateRoot(mocks.chat, isolationKey, rootIndex);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, isolationKey).length).toBe(1);

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey });
    expect(demotion.ok).toBe(true);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, isolationKey).length).toBe(0);

    // 降级后聊天无 full checkpoint：引擎默认（allowTemporaryTemplateBaseline 未开启）
    // 拒绝无锚点恢复（返回 null）是保护性设计（storage-frame-v2-replay.ts:1382），
    // 结构等价由 scope/guide 承载，直接对比模板基线验证。
    const templateBaseline = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, isolationKey);
    expect(templateBaseline).not.toBeNull();
    expect((templateBaseline as any).sheet_a.content.length).toBe(1);
    expect((templateBaseline as any).sheet_b.content.length).toBe(1);
  });

  it('C：降级后追平真实写入成功，且不再撞原 fail-fast', async () => {
    mocks.chat.push(...buildEmptyChat(6));
    const isolationKey = mocks.isolationKey;
    const aiIndicesList = aiIndices(mocks.chat);
    const rootIndex = aiIndicesList[aiIndicesList.length - 1];
    seedHeaderOnlyTemplateRoot(mocks.chat, isolationKey, rootIndex);

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey });
    expect(demotion.ok).toBe(true);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, isolationKey).length).toBe(0);

    const targetIndex = aiIndicesList[0];
    // 真实追平路径：orchestrator 在「无 checkpoint 锚点且无 unanchored artifacts」时
    // 不构建 operations（update-orchestrator.ts:1411-1440 SQLite 路径 / 1566-1592
    // 快照路径），只提交完整 afterData 快照，由 persist 建立初始 full checkpoint。
    // 直接给 persist 塞 sql_sheet_batch 会造出生产中不存在的状态，并撞上
    // 「V2 初始 full checkpoint 不接受 operations」这道与本缺陷无关的保护。
    // afterData 必须是完整快照（persist.ts requiresFullAfterData 在无 checkpoint 时为 true），
    // 故以模板基线为底再改 sheet_a.content，保证 mate 与 sheet_b 齐全、行标识 canonical。
    const baseline = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, isolationKey);
    if (!baseline) throw new Error('模板基线不可得，无法构造追平 afterData');
    const afterData: any = JSON.parse(JSON.stringify(baseline));
    afterData.sheet_a.content = [['row_id', '值'], ['1', 'a1']];
    const transactionContext = {
      baseRevision: null,
      writeSet: [{ kind: 'all' as const }],
      assertFresh: vi.fn(),
      runCommit: vi.fn(async (task: () => any) => task()),
    };
    const persistResult = await persistTableMutationLogV2_ACU({
      source: 'manual_fill',
      afterData,
      operations: [],
      filledSheetKeys: ['sheet_a'],
      candidateChangedSheetKeys: ['sheet_a'],
      groupKeys: [],
      targetMessageIndex: targetIndex,
      isolationKey,
      transactionContext: transactionContext as any,
      strictSave: true,
    });
    // 原缺陷文案必须消失（降级后无 full checkpoint，该 fail-fast 不再可能命中）。
    expect(persistResult.error || '').not.toMatch(/precedes the latest full checkpoint/);
    // 追平真实成功，并在目标楼层建立唯一的初始 full checkpoint。
    expect(persistResult.saved).toBe(true);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, isolationKey)).toEqual([targetIndex]);
  });

  it('D：root 含真实数据行 → 拒绝降级，零写入', async () => {
    mocks.chat.push(...buildEmptyChat(6));
    const isolationKey = mocks.isolationKey;
    const aiIndicesList = aiIndices(mocks.chat);
    const rootIndex = aiIndicesList[aiIndicesList.length - 1];
    const templateData = {
      mate: mate(),
      sheet_a: sheet('表A', [['row_id', '值'], ['1', 'a1'], ['2', 'a2']]),
    };
    const checkpointResult = buildCanonicalFullCheckpoint_ACU({
      createdAt: Date.now(),
      reason: 'init',
      data: templateData,
      event: { filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [] },
      context: { messageIndex: rootIndex, aiFloor: 0, isolationKey },
    });
    if (!checkpointResult.checkpoint) throw new Error('构造 init checkpoint 失败');
    mocks.chat[rootIndex].TavernDB_ACU_IsolatedData = {
      [isolationKey]: {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: checkpointResult.checkpoint,
          perSheetCheckpoints: {},
          logEntries: [],
          headRevision:'checkpoint:mock',
        },
      },
    };
    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey });
    expect(demotion.ok).toBe(false);
    expect(demotion.demoted).toBe(false);
    expect(demotion.noReplayRoot).toBe(false);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, isolationKey).length).toBe(1);
  });

  it('P0 集成：checkpoint 与当前模板仅 updateConfig.updateFrequency 不同 → 降级成功、零 full checkpoint', async () => {
    // 旧 root 由旧模板生成（updateFrequency: 5），当前全局模板已把 updateFrequency
    // 改为 60。降级只应比较结构投影，配置差异不得触发「表结构不一致」误报。
    const templateWithOldConfig = {
      sheet_a: {
        uid: 'sheet_a', name: '表A', content: [['row_id', '值']],
        updateConfig: { updateFrequency: 5 }, exportConfig: {}, sourceData: {}, orderNo: 0,
      },
      sheet_b: {
        uid: 'sheet_b', name: '表B', content: [['row_id', '值']],
        updateConfig: { updateFrequency: 5 }, exportConfig: {}, sourceData: {}, orderNo: 1,
      },
      mate: { type: 'database', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: {} },
    };
    mocks.templateObj = templateWithOldConfig;
    mocks.chat.push(...buildEmptyChat(6));
    const isolationKey = mocks.isolationKey;
    const aiIndicesList = aiIndices(mocks.chat);
    const rootIndex = aiIndicesList[aiIndicesList.length - 1];
    seedHeaderOnlyTemplateRoot(mocks.chat, isolationKey, rootIndex);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, isolationKey).length).toBe(1);

    // 当前全局模板仅把 updateFrequency 改为 60（结构完全一致）。
    mocks.templateObj = {
      ...templateWithOldConfig,
      sheet_a: { ...templateWithOldConfig.sheet_a, updateConfig: { updateFrequency: 60 } },
      sheet_b: { ...templateWithOldConfig.sheet_b, updateConfig: { updateFrequency: 60 } },
    };

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey });
    expect(demotion.ok).toBe(true);
    expect(demotion.demoted).toBe(true);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, isolationKey).length).toBe(0);
    // 结构等价由 scope/guide 承载，降级后模板基线只含表头。
    const templateBaseline = resolveHeaderOnlyTemplateSnapshot_ACU(mocks.chat, isolationKey);
    expect((templateBaseline as any).sheet_a.content.length).toBe(1);
    expect((templateBaseline as any).sheet_b.content.length).toBe(1);
  });

  it('P0 集成：DDL 物理列变化（删列）→ 拒绝降级，零写入且保留 root', async () => {
    mocks.chat.push(...buildEmptyChat(6));
    const isolationKey = mocks.isolationKey;
    const aiIndicesList = aiIndices(mocks.chat);
    const rootIndex = aiIndicesList[aiIndicesList.length - 1];
    seedHeaderOnlyTemplateRoot(mocks.chat, isolationKey, rootIndex);
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, isolationKey).length).toBe(1);

    // 当前全局模板对 sheet_a 的 DDL 删除了「值」列 → 物理列身份变化，必须拒绝。
    mocks.templateObj = {
      ...(mocks.templateObj as any),
      sheet_a: {
        ...(mocks.templateObj as any).sheet_a,
        content: [['row_id']],
        sourceData: { ddl: 'CREATE TABLE "表A" ("row_id" INTEGER PRIMARY KEY NOT NULL);' },
      },
    };

    const demotion = await demoteTemplateOnlyRootToScopeOnly_ACU({ isolationKey });
    expect(demotion.ok).toBe(false);
    expect(demotion.demoted).toBe(false);
    // 结构不一致分支只返回 ok/demoted/reason，不带 noReplayRoot；
    // 调用方「!ok && noReplayRoot !== true → fail-closed」即阻止保存。
    expect(demotion.noReplayRoot).toBeUndefined();
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, isolationKey).length).toBe(1);
  });
});
