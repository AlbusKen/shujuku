/**
 * tests/integration/template-switch-matrix.test.ts
 *
 * S3-9 端到端切模板测试矩阵（native / SQLite 双跑）。
 *
 * 驱动真实链路：applyChatTemplateSnapshotWithReconciliation_ACU
 *   → resolveTemplateSwitchMode_ACU（真实）
 *   → loadConsistentTemplateBaseline（真实 replay + lifecycle 派生）
 *   → reconcileChatTemplate_ACU（真实）
 *   → commitCurrentFloorTemplateChanges/ScopeOnly_ACU（真实 persist + 事务）
 * 断言层全部基于落盘 frame 的真实 replay（loadTableStateFromFramesV2Detailed_ACU），
 * 不信任内存 runtime。只 mock 宿主边界（chat 容器、identity、settings、全局模板存储）。
 *
 * 矩阵覆盖（计划 S3-9）：
 *   ① pristine 切入 → 填数建根 → 加列(rebase) → 填数 → 切B(hide+introduce+列差异)
 *     → 填数 → 切回A(reveal+列复原) → 再切B(reveal 数据完好)
 *   ② 休眠期模板演进：表隐藏期间模板加列 → reveal 后新列是否补上
 *   ③ 重命名表：无别名（认不回）/ 带 tableAliases（认回）
 *   ④ 中途删楼：删除携带唯一 full checkpoint 的楼层
 *   ⑤ 零数据表切模板：自定义列是否被覆盖
 *
 * 【特征化断言】标记的用例记录的是当前实际行为（含已知缺陷），
 * 修复对应 todo 时必须翻转断言——这是本矩阵作为回归护栏的工作方式：
 *   - native 列级休眠缺失 → unify-reconciler（S0-3+S3-1）【已修复，断言已翻转为双模式统一】
 *   - reveal 不做列级再协调 → reveal-rebase（S1-4）【已修复，断言已翻转为 rebase 语义】
 *   - 删楼丢 checkpoint → delete-migration（S0-4）【事件驱动的 checkpoint vault 已实装；
 *     本用例直接 splice chat 数组模拟无事件删楼，vault 不触发，断言保持】
 *   - 零数据表覆盖 → zero-data-guard（S1-6）【已修复，断言已翻转：零数据表统一走
 *     列级休眠，撞名旧列因零单元格无损丢弃，覆盖特例已删除】
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  saveChat: vi.fn().mockResolvedValue(undefined),
  saveChatStrict: vi.fn().mockResolvedValue(undefined),
  chatIdentifier: 'template-switch-matrix-chat',
  isolationKey: '',
  scopeContainer: null as any,
  guideContainer: null as any,
  globalTemplateStr: '{}',
  configStore: {} as Record<string, string>,
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.saveChat,
  saveChatToHostStrict_ACU: mocks.saveChatStrict,
}));

vi.mock('../../src/data/repositories/chat-message-data-repo', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/data/repositories/chat-message-data-repo')>()),
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

vi.mock('../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../src/shared/utils');
  return {
    ...actual,
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
    logError_ACU: vi.fn(),
  };
});

// 刻意不 mock state-manager：它是无导入副作用的纯状态单例，而 vi.mock +
// importOriginal 在本仓库的循环 import 图上会产生双实例（persist/storage-mode
// 绑定真实实例、测试拿到 mock 实例，两边 settings 不一致——已实测踩坑）。
// 测试通过真实 setter 直接驱动唯一实例。

// 容器读写对称化：get/peek/set 全部指向 mocks 变量（深拷贝隔离），
// 使真实 chat-scope 逻辑（guide/scope 写入与回读）在测试容器上闭环。
// 注意不 mock chat-scope 模块本身：它与 persist/template-preset-service 存在
// 有意的循环 import，vi.mock 该模块会因加载顺序产生双实例（mock 只对测试文件
// 自身 import 生效，persist 内部绑定真实实现），已实测踩坑。
vi.mock('../../src/data/storage/chat-history', async importOriginal => {
  const readScope = () => (mocks.scopeContainer ? JSON.parse(JSON.stringify(mocks.scopeContainer)) : null);
  const readGuide = () => (mocks.guideContainer ? JSON.parse(JSON.stringify(mocks.guideContainer)) : null);
  return {
    ...(await importOriginal<typeof import('../../src/data/storage/chat-history')>()),
    getActiveChatStorageIdentity_ACU: vi.fn(() => mocks.chatIdentifier),
    getChatScopedConfigContainer_ACU: vi.fn(readScope),
    peekChatScopedConfigContainer_ACU: vi.fn(readScope),
    getChatSheetGuideContainer_ACU: vi.fn(readGuide),
    peekChatSheetGuideContainer_ACU: vi.fn(readGuide),
    setChatScopedConfigContainer_ACU: vi.fn((_chat: any[], value: any) => {
      mocks.scopeContainer = value ? JSON.parse(JSON.stringify(value)) : null;
    }),
    setChatSheetGuideContainer_ACU: vi.fn((_chat: any[], value: any) => {
      mocks.guideContainer = value ? JSON.parse(JSON.stringify(value)) : null;
    }),
  };
});

vi.mock('../../src/data/repositories/profile-repo', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/data/repositories/profile-repo')>()),
  readProfileTemplateFromStorage_ACU: vi.fn(() => mocks.globalTemplateStr),
  saveCurrentProfileTemplate_ACU: vi.fn(),
}));

vi.mock('../../src/service/settings/settings-service', () => ({
  loadSettings_ACU: vi.fn(),
  saveSettings_ACU: vi.fn(),
  persistCurrentTemplatePresetName_ACU: vi.fn(),
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
  persistTavernSettings_ACU: vi.fn(),
  getConfigStorage_ACU: vi.fn(() => ({
    getItem: (key: string) => mocks.configStore[key] ?? null,
    setItem: (key: string, value: string) => { mocks.configStore[key] = value; },
  })),
  setGlobalPlotEnabled_ACU: vi.fn(),
  applyCombinedSettingsImport_ACU: vi.fn(),
  getDataIsolationHistory_ACU: vi.fn(() => []),
  removeDataIsolationHistory_ACU: vi.fn(),
  switchIsolationProfile_ACU: vi.fn(),
  setSummaryVectorIndexMode_ACU: vi.fn(),
  setZeroTkOccupyMode_ACU: vi.fn(),
}));

vi.mock('../../src/data/storage/tavern-storage', () => ({
  getConfigStorage_ACU: vi.fn(() => ({
    getItem: (key: string) => mocks.configStore[key] ?? null,
    setItem: (key: string, value: string) => { mocks.configStore[key] = value; },
    removeItem: (key: string) => { delete mocks.configStore[key]; },
  })),
}));

vi.mock('../../src/service/worldbook/pipeline', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/service/worldbook/pipeline')>()),
  refreshMergedDataAndNotify_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/service/table/table-storage-strategy', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/service/table/table-storage-strategy')>()),
  reloadStorageProvider: vi.fn().mockResolvedValue(undefined),
  didSqliteFallbackAfterReload_ACU: vi.fn(() => false),
}));

import * as stateManager from '../../src/service/runtime/state-manager';
import { applyChatTemplateSnapshotWithReconciliation_ACU } from '../../src/service/template/template-preset-service';
import { collectV2FullCheckpointIndices_ACU, persistTableMutationLogV2_ACU } from '../../src/service/table/storage-frame-v2-persist';
import { loadTableStateFromFramesV2Detailed_ACU } from '../../src/service/table/storage-frame-v2-replay';

// ═══ fixture 构造 ═══

function mate() {
  return { type: 'chatSheets', version: 1 };
}

function sheetFixture(key: string, name: string, columns: string[], orderNo: number, extraSourceData: Record<string, any> = {}) {
  return {
    uid: key,
    name,
    content: [['row_id', ...columns]],
    updateConfig: {},
    exportConfig: {},
    sourceData: { ...extraSourceData },
    orderNo,
  } as any;
}

/** 模板 A：角色表[名字,状态] + 备注表[内容] */
function templateA() {
  return {
    mate: mate(),
    sheet_role: sheetFixture('sheet_role', '角色表', ['名字', '状态'], 0),
    sheet_note: sheetFixture('sheet_note', '备注表', ['内容'], 1),
  };
}

/** 模板 A2：用户中途给角色表加了「心情」列（模拟可视化编辑器保存） */
function templateA2() {
  return {
    mate: mate(),
    sheet_role: sheetFixture('sheet_role', '角色表', ['名字', '状态', '心情'], 0),
    sheet_note: sheetFixture('sheet_note', '备注表', ['内容'], 1),
  };
}

/** 模板 B：角色表[名字,状态]（无心情）+ 任务表[标题,进度]（无备注表） */
function templateB() {
  return {
    mate: mate(),
    sheet_role: sheetFixture('sheet_role', '角色表', ['名字', '状态'], 0),
    sheet_task: sheetFixture('sheet_task', '任务表', ['标题', '进度'], 1),
  };
}

/** 模板 B2：任务表休眠期间演进出「优先级」列 */
function templateB2() {
  return {
    mate: mate(),
    sheet_role: sheetFixture('sheet_role', '角色表', ['名字', '状态'], 0),
    sheet_task: sheetFixture('sheet_task', '任务表', ['标题', '进度', '优先级'], 1),
  };
}

// ═══ 测试辅助 ═══

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

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

function findSheetKeyByName(data: any, name: string): string {
  const entry = Object.entries(data || {}).find(([key, sheet]: [string, any]) =>
    key.startsWith('sheet_') && sheet && typeof sheet === 'object' && sheet.name === name);
  if (!entry) throw new Error(`表「${name}」不存在于数据集，实际有：${Object.keys(data || {}).filter(k => k.startsWith('sheet_')).map(k => (data as any)[k]?.name).join('、')}`);
  return entry[0];
}

function sheetByName(data: any, name: string): any {
  return data[findSheetKeyByName(data, name)];
}

function hasSheetNamed(data: any, name: string): boolean {
  return Object.entries(data || {}).some(([key, sheet]: [string, any]) =>
    key.startsWith('sheet_') && sheet && typeof sheet === 'object' && sheet.name === name);
}

async function switchTemplate(templateObj: any, options: Record<string, any> = {}): Promise<any> {
  const result: any = await applyChatTemplateSnapshotWithReconciliation_ACU(templateObj, { source: 'matrix_test', ...options });
  if (!result?.saved) {
    throw new Error(`切模板失败：${result?.error || JSON.stringify(result?.blockers || result)}`);
  }
  return result;
}

/**
 * 填数：以 replay 落盘态（无帧时取 pristine 提交的 candidateData）为基底，
 * 修改指定表后提交。首笔写入走初始 full checkpoint（operations 必须为空，
 * 与 update-orchestrator 空基底路径一致）；后续写入携带 sheet_replace 操作
 * （与手动 CRUD 提交模型一致）。
 */
async function fillSheet(sheetName: string, mutateSheet: (sheet: any) => void): Promise<void> {
  const replayed = await replayData();
  const base = replayed ? clone(replayed) : clone(stateManager.currentJsonTableData_ACU);
  if (!base) throw new Error('没有可用的填数基底');
  const sheetKey = findSheetKeyByName(base, sheetName);
  mutateSheet(base[sheetKey]);
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
  });
  if (!result.saved) throw new Error(`填数失败（${sheetName}）：${result.error}`);
}

/** 给表追加一行：自动按当前表头宽度补齐（含 SQLite 隐藏列尾部）。 */
function appendRow(sheet: any, rowId: string, visibleCells: string[]): void {
  const width = sheet.content[0].length;
  const row = [rowId, ...visibleCells];
  if (row.length > width) throw new Error(`行宽 ${row.length} 超过表头 ${width}`);
  while (row.length < width) row.push(null);
  sheet.content.push(row);
}

function dataRows(sheet: any): any[][] {
  return sheet.content.slice(1);
}

function headerIndex(sheet: any, columnName: string): number {
  return sheet.content[0].indexOf(columnName);
}

// ═══ 矩阵 ═══

describe.each(['native', 'sqlite'] as const)('端到端切模板矩阵（storageMode=%s）', storageMode => {
  beforeEach(() => {
    mocks.chat.length = 0;
    mocks.chat.push(...buildChat(6));
    Object.assign(stateManager.settings_ACU, {
      storageMode,
      dataIsolationEnabled: false,
      dataIsolationCode: '',
    });
    stateManager._set_currentJsonTableData_ACU(null);
    stateManager._set_currentChatFileIdentifier_ACU(mocks.chatIdentifier);
    mocks.scopeContainer = null;
    mocks.guideContainer = null;
    mocks.configStore = {};
    mocks.globalTemplateStr = JSON.stringify(templateA());
    mocks.saveChat.mockClear();
    mocks.saveChatStrict.mockClear();
  });

  it('①-⑥ 完整往返：建表→填数→加列→填数→切B→填数→切回A→再切B', async () => {
    // ① pristine 切入 A：只落配置，零 checkpoint
    await switchTemplate(templateA());
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, mocks.isolationKey).length).toBe(0);
    expect(stateManager.currentJsonTableData_ACU).not.toBeNull();

    // 首次填数建立回放根
    await fillSheet('角色表', sheet => appendRow(sheet, '1', ['爱丽丝', '健康']));
    await fillSheet('备注表', sheet => appendRow(sheet, '1', ['第一条备注']));
    expect(collectV2FullCheckpointIndices_ACU(mocks.chat, mocks.isolationKey).length).toBeGreaterThan(0);
    let data = await replayData();
    expect(dataRows(sheetByName(data, '角色表'))).toHaveLength(1);
    expect(dataRows(sheetByName(data, '备注表'))).toHaveLength(1);

    // ② 加列 A2（inherit + rebase）：心情列出现，既有行保留
    await switchTemplate(templateA2());
    data = await replayData();
    const roleAfterAddColumn = sheetByName(data, '角色表');
    expect(headerIndex(roleAfterAddColumn, '心情')).toBeGreaterThan(0);
    expect(dataRows(roleAfterAddColumn)).toHaveLength(1);
    expect(dataRows(roleAfterAddColumn)[0][headerIndex(roleAfterAddColumn, '名字')]).toBe('爱丽丝');

    // 填心情值
    await fillSheet('角色表', sheet => {
      sheet.content[1][headerIndex(sheet, '心情')] = '开心';
    });
    data = await replayData();
    expect(dataRows(sheetByName(data, '角色表'))[0][headerIndex(sheetByName(data, '角色表'), '心情')]).toBe('开心');

    // ③ 切 B：备注表 hide、任务表 introduce、角色表心情列差异
    await switchTemplate(templateB());
    data = await replayData();
    expect(hasSheetNamed(data, '备注表')).toBe(false);
    const taskIntroduced = sheetByName(data, '任务表');
    expect(dataRows(taskIntroduced)).toHaveLength(0);
    const roleUnderB = sheetByName(data, '角色表');
    expect(dataRows(roleUnderB)[0][headerIndex(roleUnderB, '名字')]).toBe('爱丽丝');
    // 列级休眠（S0-3 后双模式统一）：hiddenPhysicalColumns 记录休眠列
    // （sqlite=物理列名，native=表头名），content 尾部保留数据。
    const hidden = roleUnderB.sourceData?.hiddenPhysicalColumns;
    expect(Array.isArray(hidden) && hidden.length === 1).toBe(true);
    expect(headerIndex(roleUnderB, '心情')).toBeGreaterThan(0);
    expect(dataRows(roleUnderB)[0][headerIndex(roleUnderB, '心情')]).toBe('开心');

    // ④ 填任务表
    await fillSheet('任务表', sheet => appendRow(sheet, '1', ['找线索', '进行中']));
    data = await replayData();
    expect(dataRows(sheetByName(data, '任务表'))).toHaveLength(1);

    // ⑤ 切回 A2：任务表 hide、备注表 reveal（数据完好）、心情列回归
    await switchTemplate(templateA2());
    data = await replayData();
    expect(hasSheetNamed(data, '任务表')).toBe(false);
    const noteRevealed = sheetByName(data, '备注表');
    expect(dataRows(noteRevealed)).toHaveLength(1);
    expect(dataRows(noteRevealed)[0][headerIndex(noteRevealed, '内容')]).toBe('第一条备注');
    const roleBack = sheetByName(data, '角色表');
    expect(headerIndex(roleBack, '心情')).toBeGreaterThan(0);
    // 休眠列被同名模板列唤醒（S0-3 后双模式统一），数据复原，hiddenPhysicalColumns 清空。
    expect(dataRows(roleBack)[0][headerIndex(roleBack, '心情')]).toBe('开心');
    expect(roleBack.sourceData?.hiddenPhysicalColumns ?? []).toHaveLength(0);

    // ⑥ 再切 B：任务表 reveal，休眠期间数据完好（表级休眠双模式都必须成立）
    await switchTemplate(templateB());
    data = await replayData();
    const taskRevealed = sheetByName(data, '任务表');
    expect(dataRows(taskRevealed)).toHaveLength(1);
    expect(dataRows(taskRevealed)[0][headerIndex(taskRevealed, '标题')]).toBe('找线索');
    expect(hasSheetNamed(data, '备注表')).toBe(false);
  }, 60000);

  it('② 休眠期模板演进：任务表隐藏期间模板加列，reveal 后的列集', async () => {
    await switchTemplate(templateB());
    await fillSheet('角色表', sheet => appendRow(sheet, '1', ['爱丽丝', '健康']));
    await fillSheet('任务表', sheet => appendRow(sheet, '1', ['找线索', '进行中']));
    // 隐藏任务表
    await switchTemplate(templateA());
    let data = await replayData();
    expect(hasSheetNamed(data, '任务表')).toBe(false);
    // 休眠期间模板演进：B2 的任务表多了「优先级」列 → reveal
    await switchTemplate(templateB2());
    data = await replayData();
    const taskRevealed = sheetByName(data, '任务表');
    expect(dataRows(taskRevealed)).toHaveLength(1);
    expect(dataRows(taskRevealed)[0][headerIndex(taskRevealed, '标题')]).toBe('找线索');
    // reveal 后列级再协调（S1-4）：休眠期演进出的「优先级」列补上（空值），
    // 既有列数据完整继承，且无列被休眠（旧列集是新列集的子集）。
    expect(headerIndex(taskRevealed, '优先级')).toBeGreaterThan(0);
    expect(dataRows(taskRevealed)[0][headerIndex(taskRevealed, '优先级')] ?? null).toBeNull();
    expect(dataRows(taskRevealed)[0][headerIndex(taskRevealed, '进度')]).toBe('进行中');
    expect(taskRevealed.sourceData?.hiddenPhysicalColumns ?? []).toHaveLength(0);
  }, 60000);

  it('③a 重命名表（无别名）：当前行为是 hide 旧表 + introduce 新空表，数据认不回', async () => {
    await switchTemplate(templateA());
    await fillSheet('角色表', sheet => appendRow(sheet, '1', ['爱丽丝', '健康']));
    // 模板中角色表改名为「主角表」，未声明 tableAliases
    const renamed = templateA();
    (renamed.sheet_role as any).name = '主角表';
    await switchTemplate(renamed);
    const data = await replayData();
    // 旧表按名称认不回 → 隐藏；新名字作为空表引入
    expect(hasSheetNamed(data, '角色表')).toBe(false);
    const introduced = sheetByName(data, '主角表');
    expect(dataRows(introduced)).toHaveLength(0);
  }, 60000);

  it('③b 重命名表（声明 tableAliases）：按别名认回，数据保留', async () => {
    await switchTemplate(templateA());
    await fillSheet('角色表', sheet => appendRow(sheet, '1', ['爱丽丝', '健康']));
    const renamed = templateA();
    (renamed.sheet_role as any).name = '人物表';
    (renamed.sheet_role as any).sourceData = { tableAliases: ['角色表'] };
    await switchTemplate(renamed);
    let data = await replayData();
    const matched = sheetByName(data, '人物表');
    expect(dataRows(matched)).toHaveLength(1);
    expect(dataRows(matched)[0][headerIndex(matched, '名字')]).toBe('爱丽丝');
    expect(hasSheetNamed(data, '角色表')).toBe(false);

    // S1-5 双向别名认回：改名后的表已累积旧名别名（角色表），再切回仍用原名的
    // 模板 A 时按 baseline 侧别名认回同一张表——数据保留、名字复原，而不是
    // hide 人物表 + introduce 空角色表。
    await switchTemplate(templateA());
    data = await replayData();
    const restored = sheetByName(data, '角色表');
    expect(dataRows(restored)).toHaveLength(1);
    expect(dataRows(restored)[0][headerIndex(restored, '名字')]).toBe('爱丽丝');
    expect(hasSheetNamed(data, '人物表')).toBe(false);
  }, 60000);

  it('④ 中途删楼：删除携带唯一 full checkpoint 的楼层后数据不可恢复', async () => {
    await switchTemplate(templateA());
    await fillSheet('角色表', sheet => appendRow(sheet, '1', ['爱丽丝', '健康']));
    const checkpointIndices = collectV2FullCheckpointIndices_ACU(mocks.chat, mocks.isolationKey);
    expect(checkpointIndices.length).toBeGreaterThan(0);
    // 模拟宿主删楼：直接从 chat 数组移除携带 checkpoint 的楼层
    mocks.chat.splice(checkpointIndices[checkpointIndices.length - 1], 1);
    const data = await replayData();
    // 【特征化断言 · 将随 delete-migration（S0-4）翻转】
    // 当前没有删楼前 checkpoint 前移迁移：唯一回放根随楼层一起消失，数据永久丢失。
    expect(data).toBeNull();
  }, 60000);

  it('⑤ 零数据表切模板保护（S1-6）：自定义列进列级休眠并可唤醒', async () => {
    await switchTemplate(templateA());
    // 角色表填数（保证聊天非 pristine），备注表保持零数据
    await fillSheet('角色表', sheet => appendRow(sheet, '1', ['爱丽丝', '健康']));
    // 用户给零数据的备注表加自定义列
    const customized = templateA();
    (customized.sheet_note as any).content = [['row_id', '内容', '备注人']];
    await switchTemplate(customized);
    let data = await replayData();
    expect(headerIndex(sheetByName(data, '备注表'), '备注人')).toBeGreaterThan(0);
    // 切回原模板 A（备注表只有内容列）：零数据表不再整体覆盖，
    // 自定义列保留为尾部隐藏列（列级休眠），结构不丢。
    await switchTemplate(templateA());
    data = await replayData();
    const noteAfter = sheetByName(data, '备注表');
    expect(headerIndex(noteAfter, '备注人')).toBeGreaterThan(0);
    expect(noteAfter.sourceData?.hiddenPhysicalColumns ?? []).toHaveLength(1);
    // 再切回含备注人的模板：休眠列唤醒，隐藏集清空。
    await switchTemplate(customized);
    data = await replayData();
    const revived = sheetByName(data, '备注表');
    expect(headerIndex(revived, '备注人')).toBeGreaterThan(0);
    expect(revived.sourceData?.hiddenPhysicalColumns ?? []).toHaveLength(0);
  }, 60000);
});
