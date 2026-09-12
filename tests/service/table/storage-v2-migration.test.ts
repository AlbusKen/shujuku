import { beforeEach, describe, expect, it, vi } from 'vitest';
import legacyValidFixture from '../../fixtures/migrations/spv7.9/legacy-valid.json';
import headerChineseFixture from '../../fixtures/migrations/spv7.9/header-chinese.json';
import headerIdFixture from '../../fixtures/migrations/spv7.9/header-id.json';
import headerRowIdFixture from '../../fixtures/migrations/spv7.9/header-row-id.json';
import headerNullFixture from '../../fixtures/migrations/spv7.9/header-null.json';
import duplicateNumberStringFixture from '../../fixtures/migrations/spv7.9/duplicate-row-id-number-string.json';
import emptyRowIdFixture from '../../fixtures/migrations/spv7.9/empty-row-id.json';
import shortRowFixture from '../../fixtures/migrations/spv7.9/row-width-short.json';
import longRowFixture from '../../fixtures/migrations/spv7.9/row-width-long.json';
import mixedLegacyV2Fixture from '../../fixtures/migrations/spv7.9/mixed-legacy-v2.json';

const { mockChatRef, mockSaveChatToHost, mockRuntimeScope } = vi.hoisted(() => ({
  mockChatRef: { value: [] as any[] },
  mockSaveChatToHost: vi.fn().mockResolvedValue(undefined),
  mockRuntimeScope: {
    chatIdentifier: 'migration-test-chat',
    isolationKey: '',
  },
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mockChatRef.value),
  saveChatToHostStrict_ACU: mockSaveChatToHost,
  emitMessageUpdated_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: { storageMode: 'native' },
  get currentChatFileIdentifier_ACU() { return mockRuntimeScope.chatIdentifier; },
  getCurrentIsolationKey_ACU: vi.fn(() => mockRuntimeScope.isolationKey),
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

import { resolveTableStorageStrategy_ACU } from '../../../src/service/table/storage-strategy-resolver';
import { migrateLegacyStorageToV2OnLoad_ACU } from '../../../src/service/table/storage-v2-migration';
import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';
import { validateMigrationProvenanceV1_ACU } from '../../../src/shared/canonical-checkpoint-validator';
import { loadTableStateFromFramesV2_ACU } from '../../../src/service/table/storage-frame-v2-replay';

function sheet(name: string, rows: any[][] = [['row_id', '名称'], ['1', name]]) {
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

function setLegacyMigrationChat(data: any) {
  mockChatRef.value = [
    {
      is_user: false,
      TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
      TavernDB_ACU_ModifiedKeys: ['sheet_0'],
    },
    { is_user: true },
    { is_user: false, mes: 'latest ai' },
  ];
}

function getBusinessDataProjection_ACU(data: any): {
  sheetCount: number;
  sheets: Record<string, { rowCount: number; nonEmptyBusinessCellCount: number; businessValueFingerprint: string }>;
} {
  const sheetEntries = Object.entries(data || {})
    .filter(([key, value]) => key.startsWith('sheet_') && value && typeof value === 'object')
    .sort(([left], [right]) => left.localeCompare(right));
  const sheets = Object.fromEntries(sheetEntries.map(([sheetKey, sheet]: [string, any]) => {
    const rows = Array.isArray(sheet.content)
      ? sheet.content.slice(1).filter(Array.isArray).map((row: any[]) => {
        const businessCells = row.slice(1);
        while (businessCells.length > 0) {
          const lastCell = businessCells[businessCells.length - 1];
          if (lastCell !== null && lastCell !== undefined) break;
          businessCells.pop();
        }
        return businessCells;
      })
      : [];
    const serializedValues = JSON.stringify(rows);
    let hash = 2166136261;
    for (let index = 0; index < serializedValues.length; index += 1) {
      hash ^= serializedValues.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return [sheetKey, {
      rowCount: rows.length,
      nonEmptyBusinessCellCount: rows.flat().filter(value => value !== null && value !== undefined && value !== '').length,
      businessValueFingerprint: `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`,
    }];
  }));
  return { sheetCount: sheetEntries.length, sheets };
}


describe('migrateLegacyStorageToV2OnLoad_ACU', () => {
  beforeEach(() => {
    mockChatRef.value = [];
    mockSaveChatToHost.mockClear();
    mockRuntimeScope.chatIdentifier = 'migration-test-chat';
    mockRuntimeScope.isolationKey = '';
  });

  it('在数据库加载阶段把原版顶层旧字段迁移为 V2 migration checkpoint，并清理旧字段', async () => {
    const data = { sheet_0: sheet('背包') } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      { is_user: true },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result).toMatchObject({ migrated: true, messageIndex: 2 });
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    expect(mockChatRef.value[0].TavernDB_ACU_IndependentData).toBeUndefined();
    expect(mockChatRef.value[0].TavernDB_ACU_ModifiedKeys).toBeUndefined();

    const tagData = mockChatRef.value[2].TavernDB_ACU_IsolatedData[''];
    expect(tagData._acu_storage_version).toBe(2);
    expect(tagData.storageFrame.checkpoint.reason).toBe('migration');
    expect(tagData.storageFrame.checkpoint.data).toEqual(data);
    expect(tagData.storageFrame.checkpoint.event).toBeUndefined();
    expect(tagData.storageFrame.checkpoint.scheduleSummary.sheet_0).toEqual({
      lastFilledAiFloor: 1,
      lastChangedAiFloor: 1,
    });
    expect(tagData.storageFrame.checkpoint.migrationProvenance).toMatchObject({
      version: 1,
      legacyDataFingerprint: expect.any(String),
      legacySourceMessageIndices: [0],
      legacySourceAiFloors: [1],
      legacyLastChangedAiFloorBySheet: { sheet_0: 1 },
      targetMessageIndex: 2,
      targetAiFloor: 2,
      isolationKey: '',
      migratedAt: expect.any(Number),
    });
    expect(validateMigrationProvenanceV1_ACU(tagData.storageFrame.checkpoint.migrationProvenance))
      .toEqual({ valid: true, issues: [] });
    expect(tagData.storageFrame.logEntries).toEqual([]);
    expect(tagData.migrationAuditBackup).toMatchObject({
      version: 1,
      auditStatus: 'clean',
      sourceData: data,
      dataFingerprintBefore: getTableDataFingerprint_ACU(data),
      dataFingerprintAfter: getTableDataFingerprint_ACU(data),
      issues: [],
      repairPlan: [],
      idRemap: [],
    });
    expect(resolveTableStorageStrategy_ACU(mockChatRef.value, '', { enabled: false, code: '' }).mode).toBe('v2');
  });

  it('配置保留当前楼不更新时，旧存储迁移 checkpoint 落在当前 AI 楼的上一楼', async () => {
    const data = { sheet_0: sheet('背包') } as any;
    mockChatRef.value = [
      {
        is_user: false,
        mes: 'previous ai',
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      { is_user: true },
      { is_user: false, mes: 'current ai without fill' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
      skipUpdateFloors: 1,
    });

    expect(result).toMatchObject({ migrated: true, messageIndex: 0 });
    expect(mockChatRef.value[0].TavernDB_ACU_IsolatedData['']._acu_storage_version).toBe(2);
    expect(mockChatRef.value[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data).toEqual(data);
    expect(mockChatRef.value[2].TavernDB_ACU_IsolatedData).toBeUndefined();
  });

  it('表级 skipFloors=1 时，旧存储迁移也落在当前 AI 楼的上一楼', async () => {
    const data = { sheet_0: sheet('背包') } as any;
    data.sheet_0.updateConfig = { skipFloors: 1 };
    mockChatRef.value = [
      {
        is_user: false,
        mes: 'previous ai',
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      { is_user: true },
      { is_user: false, mes: 'current ai without fill' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result).toMatchObject({ migrated: true, messageIndex: 0 });
    expect(mockChatRef.value[0].TavernDB_ACU_IsolatedData['']._acu_storage_version).toBe(2);
    expect(mockChatRef.value[2].TavernDB_ACU_IsolatedData).toBeUndefined();
  });

  it('迁移 V1 隔离槽时保留其他隔离标签，并把旧 updateGroupKeys 写入 scheduleSummary', async () => {
    const data = {
      sheet_0: sheet('角色'),
      sheet_1: sheet('后勤'),
    } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_Identity: 'tag-b',
        TavernDB_ACU_IndependentData: { sheet_9: sheet('顶层其他') },
        TavernDB_ACU_IsolatedData: {
          'tag-a': {
            independentData: { sheet_0: data.sheet_0 },
            modifiedKeys: ['sheet_0'],
            updateGroupKeys: ['sheet_1'],
            summaryVectorIndexManifest: { id: 'manifest-a' },
            _acu_storage_mode: 'checkpoint',
            _acu_storage_version: 1,
          },
          'tag-b': {
            independentData: { sheet_9: sheet('其他') },
            modifiedKeys: ['sheet_9'],
            updateGroupKeys: [],
            _acu_storage_version: 1,
          },
        },
      },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data,
      isolationKey: 'tag-a',
      isolationConfig: { enabled: true, code: 'tag-a' },
    });

    expect(result.migrated).toBe(true);
    const isolatedData = mockChatRef.value[0].TavernDB_ACU_IsolatedData;
    expect(isolatedData['tag-b'].independentData.sheet_9.name).toBe('其他');
    expect(mockChatRef.value[0].TavernDB_ACU_Identity).toBe('tag-b');
    expect(mockChatRef.value[0].TavernDB_ACU_IndependentData.sheet_9.name).toBe('顶层其他');
    expect(isolatedData['tag-a'].summaryVectorIndexManifest).toEqual({ id: 'manifest-a' });
    expect(isolatedData['tag-a'].storageFrame.checkpoint.scheduleSummary.sheet_0).toEqual({
      lastFilledAiFloor: 1,
      lastChangedAiFloor: 1,
    });
    expect(isolatedData['tag-a'].storageFrame.checkpoint.scheduleSummary.sheet_1).toEqual({
      lastFilledAiFloor: 1,
    });
    expect(resolveTableStorageStrategy_ACU(mockChatRef.value, 'tag-a', { enabled: true, code: 'tag-a' }).mode).toBe('v2');
  });

  it('旧数据合并结果为空时失败且不清理旧字段', async () => {
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: sheet('背包') },
      },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data: null,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result.migrated).toBe(false);
    expect(result.error).toContain('non-empty merged table data');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
    expect(mockChatRef.value[0].TavernDB_ACU_IndependentData.sheet_0.name).toBe('背包');
  });

  it('破坏保险闸：合并结果 0 行而旧存储源含真实行时拒绝迁移且零写入', async () => {
    // 合并结果只有表头（例如模板/指导表不匹配导致丢行），但楼层旧字段里有真实行
    const emptyMerged = { sheet_0: sheet('背包', [['row_id', '名称']]) } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: sheet('背包', [['row_id', '名称'], ['1', '铁剑']]) },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      { is_user: true },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data: emptyMerged,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result.migrated).toBe(false);
    expect(result.error).toContain('拒绝迁移');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
    // 旧字段原件必须原样保留
    expect(mockChatRef.value[0].TavernDB_ACU_IndependentData.sheet_0.content).toEqual([['row_id', '名称'], ['1', '铁剑']]);
  });

  it('破坏保险闸：合并结果 0 行且旧存储源也无真实行时放行迁移（全空聊天合法）', async () => {
    const emptyMerged = { sheet_0: sheet('背包', [['row_id', '名称']]) } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: sheet('背包', [['row_id', '名称']]) },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      { is_user: true },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data: emptyMerged,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result.migrated).toBe(true);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    expect(mockChatRef.value[0].TavernDB_ACU_IndependentData).toBeUndefined();
  });

  it('破坏保险闸（逐表）：合并结果缺失旧源中一张带真实行的表时拒绝迁移且零写入（部分丢表场景）', async () => {
    // 原事故场景：合并把 4 张带行数据的表隔离丢掉，剩余表仍有行 → 旧的"总 0 行"闸放行。
    // 逐表闸必须按 key/规范名比对每张带真实行的旧表在合并结果中的存在性。
    const partialMerged = {
      sheet_notes: sheet('纪要表', [['row_id', '纪要'], ['1', '第一章']]),
    } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_notes: sheet('纪要表', [['row_id', '纪要'], ['1', '第一章']]),
          sheet_bag: sheet('背包物品表', [['row_id', '名称', '数量'], ['1', '铁剑', '3']]),
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_notes', 'sheet_bag'],
      },
      { is_user: true },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data: partialMerged,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result.migrated).toBe(false);
    expect(result.error).toContain('缺失');
    expect(result.error).toContain('背包物品表');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
    expect(mockChatRef.value[0].TavernDB_ACU_IndependentData.sheet_bag.content).toEqual([['row_id', '名称', '数量'], ['1', '铁剑', '3']]);
  });

  it('破坏保险闸（逐表）：旧表按规范名重映射进新 key 时放行迁移（key 迁移不误拦）', async () => {
    // 合并把历史 key sheet_old 的数据迁入 guide key sheet_new，名字相同 → 规范名通道匹配。
    // 另有一张同 key 表 sheet_notes 保证迁移证据链（provenance）成立，本用例只验证闸门不误拦。
    const remappedMerged = {
      sheet_new: sheet('背包物品表', [['row_id', '名称'], ['1', '铁剑']]),
      sheet_notes: sheet('纪要表', [['row_id', '纪要'], ['1', '第一章']]),
    } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_old: sheet('背包物品表', [['row_id', '名称'], ['1', '铁剑']]),
          sheet_notes: sheet('纪要表', [['row_id', '纪要'], ['1', '第一章']]),
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_old', 'sheet_notes'],
      },
      { is_user: true },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data: remappedMerged,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result.migrated).toBe(true);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('破坏保险闸（清单同源）：提供 sourceInventory 时闸门消费清单而非独立扫描（独立扫描会误报的场景放行）', async () => {
    // 旧源里 sheet_ghost 带行，但合并读取语义下该表不可见（如字段归属/隔离语义差异）。
    // 独立扫描会把它计入并误报缺失；sourceInventory 与合并同源，只登记 sheet_notes → 放行。
    const merged = {
      sheet_notes: sheet('纪要表', [['row_id', '纪要'], ['1', '第一章']]),
    } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_notes: sheet('纪要表', [['row_id', '纪要'], ['1', '第一章']]),
          sheet_ghost: sheet('幽灵表', [['row_id', '列'], ['1', '值']]),
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_notes'],
      },
      { is_user: true },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data: merged,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
      sourceInventory: new Map([['sheet_notes', '纪要表']]),
    });

    expect(result.migrated).toBe(true);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
  });

  it('破坏保险闸（清单同源）：sourceInventory 登记的带行表在合并结果缺失时仍拒绝迁移', async () => {
    const merged = {
      sheet_notes: sheet('纪要表', [['row_id', '纪要'], ['1', '第一章']]),
    } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_notes: sheet('纪要表', [['row_id', '纪要'], ['1', '第一章']]),
          sheet_bag: sheet('背包物品表', [['row_id', '名称'], ['1', '铁剑']]),
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_notes', 'sheet_bag'],
      },
      { is_user: true },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data: merged,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
      sourceInventory: new Map([['sheet_notes', '纪要表'], ['sheet_bag', '背包物品表']]),
    });

    expect(result.migrated).toBe(false);
    expect(result.error).toContain('缺失');
    expect(result.error).toContain('背包物品表');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
  });

  it('legacy 数据含 canonical 后重复 row_id 时重映射后迁移，并保留全部行', async () => {
    const data = {
      sheet_0: sheet('背包', [['row_id', '名称'], ['1', '铁剑'], [' 1 ', '冒名副本']]),
    } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      { is_user: true },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result).toEqual(expect.objectContaining({ migrated: true }));
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    expect(mockChatRef.value[2].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_0.content)
      .toEqual([['row_id', '名称'], ['1', '铁剑'], ['2', '冒名副本']]);
  });

  it('可从合成 spv7.9 合法 legacy fixture 建立 V2 checkpoint', async () => {
    const data = {
      sheet_0: sheet(legacyValidFixture.name, structuredClone(legacyValidFixture.content)),
    } as any;
    setLegacyMigrationChat(data);

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result).toMatchObject({ migrated: true, messageIndex: 2 });
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    expect(mockChatRef.value[2].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data).toEqual(data);
  });

  it.each([
    { name: 'id 表头', fixture: headerIdFixture },
    { name: 'rowId 表头', fixture: headerRowIdFixture },
    { name: 'null 表头', fixture: headerNullFixture },
    { name: '数值与字符串等价 row_id', fixture: duplicateNumberStringFixture },
    { name: '空 row_id', fixture: emptyRowIdFixture },
    { name: '短行', fixture: shortRowFixture },
  ])('无损可修复的合成 spv7.9 fixture 会迁移为 V2 checkpoint', async ({ fixture }) => {
    const data = {
      sheet_0: sheet(fixture.name, structuredClone(fixture.content)),
    } as any;
    const beforeProjection = getBusinessDataProjection_ACU(data);
    setLegacyMigrationChat(data);

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result).toEqual(expect.objectContaining({ migrated: true }));
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    const checkpointData = mockChatRef.value[2].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data;
    const replayedData = await loadTableStateFromFramesV2_ACU(mockChatRef.value, '', { updateRuntimeState: false });
    const auditBackup = mockChatRef.value[2].TavernDB_ACU_IsolatedData[''].migrationAuditBackup;
    expect(auditBackup).toMatchObject({
      version: 1,
      auditStatus: 'repairable',
      sourceData: data,
      dataFingerprintBefore: getTableDataFingerprint_ACU(data),
      dataFingerprintAfter: getTableDataFingerprint_ACU(checkpointData),
    });
    expect(auditBackup.repairPlan.length).toBeGreaterThan(0);
    expect(getBusinessDataProjection_ACU(result.data)).toEqual(beforeProjection);
    expect(getBusinessDataProjection_ACU(checkpointData)).toEqual(beforeProjection);
    expect(getBusinessDataProjection_ACU(replayedData)).toEqual(beforeProjection);
  });

  it.each([
    { name: '中文业务表头', fixture: headerChineseFixture },
    { name: '长行', fixture: longRowFixture },
  ])('无法安全推导的合成 spv7.9 fixture 要求确认，且不写入或删除 legacy 数据', async ({ fixture }) => {
    const data = { sheet_0: sheet(fixture.name, structuredClone(fixture.content)) } as any;
    setLegacyMigrationChat(data);
    const before = structuredClone(mockChatRef.value);
    const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

    expect(result).toEqual(expect.objectContaining({ migrated: false }));
    expect(result.error).toContain('requires confirmation');
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
    expect(mockChatRef.value).toEqual(before);
  });

  it('mixed 且 migration provenance、coverage、fingerprint 全部验证时，仅清理 legacy 并保持 V2 frame', async () => {
    const data = { sheet_0: sheet('背包', [['row_id', '名称'], ['1', 'legacy 铁剑']]) } as any;
    mockChatRef.value = [
      { is_user: false, TavernDB_ACU_Data: data, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: 'checkpoint:verified-migration',
              checkpoint: {
                kind: 'full',
                createdAt: 1,
                reason: 'migration',
                data: structuredClone(data),
                scheduleSummary: { sheet_0: { lastChangedAiFloor: 1 } },
                migrationProvenance: {
                  version: 1,
                  legacyDataFingerprint: getTableDataFingerprint_ACU(data),
                  legacySourceMessageIndices: [0],
                  legacySourceAiFloors: [1],
                  legacyLastChangedAiFloorBySheet: { sheet_0: 1 },
                  targetMessageIndex: 1,
                  targetAiFloor: 2,
                  isolationKey: '',
                  migratedAt: 1,
                },
              },
              logEntries: [],
            },
          },
        },
      },
    ];
    const v2Before = structuredClone(mockChatRef.value[1].TavernDB_ACU_IsolatedData[''].storageFrame);

    const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

    expect(result.error).toBeUndefined();
    expect(result.mixedDecision?.kind).toBe('equivalent_provenance_verified');
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    expect(mockChatRef.value[0].TavernDB_ACU_Data).toBeUndefined();
    expect(mockChatRef.value[1].TavernDB_ACU_IsolatedData[''].storageFrame).toEqual(v2Before);
  });

  it('合成 spv7.9 mixed legacy/V2 fixture 中 legacy 来源晚于无后继 V2 时静默收敛为新 checkpoint', async () => {
    const data = structuredClone(mixedLegacyV2Fixture.legacy) as any;
    const beforeProjection = getBusinessDataProjection_ACU(data);
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: structuredClone(mixedLegacyV2Fixture.v2Frame) },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      { is_user: true },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

    expect(result).toEqual(expect.objectContaining({ migrated: true, messageIndex: 3 }));
    expect(result.mixedDecision?.kind).toBe('conflict_requires_user_choice');
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    expect(mockChatRef.value[1].TavernDB_ACU_IndependentData).toBeUndefined();
    const migratedTag = mockChatRef.value[3].TavernDB_ACU_IsolatedData[''];
    expect(migratedTag.storageFrame.checkpoint.reason).toBe('migration');
    expect(getBusinessDataProjection_ACU(migratedTag.storageFrame.checkpoint.data)).toEqual(beforeProjection);
    expect(getBusinessDataProjection_ACU(result.data)).toEqual(beforeProjection);
    expect(migratedTag.migrationAuditBackup.supersededV2Frames).toEqual([
      expect.objectContaining({ messageIndex: 0, isolationKey: '', storageFrame: mixedLegacyV2Fixture.v2Frame }),
    ]);
    expect(resolveTableStorageStrategy_ACU(mockChatRef.value, '', { enabled: false, code: '' })).toEqual({ mode: 'v2' });

    mockSaveChatToHost.mockClear();
    const reopened = await migrateLegacyStorageToV2OnLoad_ACU({
      data: result.data!,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(reopened).toEqual({ migrated: false });
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
    expect(resolveTableStorageStrategy_ACU(mockChatRef.value, '', { enabled: false, code: '' })).toEqual({ mode: 'v2' });
  });

  it('mixed 升级残留的 legacy 旧 key 按 V2 规范名命名空间写入新 checkpoint', async () => {
    const legacyData = {
      sheet_legacy_random: { ...sheet('背包物品表', [['row_id', '名称'], ['1', 'legacy 新值']]), uid: 'sheet_legacy_random' },
    } as any;
    const v2Data = {
      sheet_bei_bao_wu_pin_biao: { ...sheet('背包物品表', [['row_id', '名称'], ['1', 'V2 旧值']]), uid: 'sheet_bei_bao_wu_pin_biao' },
    } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: {
            version: 2,
            headRevision: 'checkpoint:old-key-residual',
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: v2Data },
            logEntries: [],
          } },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_legacy_random: legacyData.sheet_legacy_random },
        TavernDB_ACU_ModifiedKeys: ['sheet_legacy_random'],
      },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({ data: legacyData, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

    expect(result.migrated).toBe(true);
    expect(result.data).not.toHaveProperty('sheet_legacy_random');
    expect(result.data?.sheet_bei_bao_wu_pin_biao).toMatchObject({
      uid: 'sheet_bei_bao_wu_pin_biao',
      content: [['row_id', '名称'], ['1', 'legacy 新值']],
    });
    const checkpoint = mockChatRef.value[2].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint;
    expect(checkpoint.data).toEqual(result.data);
    expect(checkpoint.scheduleSummary).toHaveProperty('sheet_bei_bao_wu_pin_biao');
    expect(checkpoint.scheduleSummary).not.toHaveProperty('sheet_legacy_random');
    expect(checkpoint.migrationProvenance.legacySourceMessageIndices).toEqual([1]);
  });

  it('mixed legacy/V2 无 provenance 且 legacy 来源晚于无后继 V2 时以 legacy 静默重建 V2', async () => {
    const data = { sheet_0: sheet('背包', [['row_id', '名称'], ['1', 'legacy 铁剑']]) } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: {
            version: 2,
            headRevision: 'checkpoint:existing',
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: sheet('背包', [['row_id', '名称'], ['1', 'V2 铁剑']]) } },
            logEntries: [],
          } },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      { is_user: true },
      { is_user: false, mes: 'latest ai' },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result.mixedDecision?.kind).toBe('conflict_requires_user_choice');
    expect(result).toEqual(expect.objectContaining({ migrated: true, messageIndex: 3, data }));
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    expect(mockChatRef.value[1].TavernDB_ACU_IndependentData).toBeUndefined();
    expect(mockChatRef.value[3].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data).toEqual(data);
    expect(mockChatRef.value[3].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.migrationProvenance).toBeDefined();
    expect(resolveTableStorageStrategy_ACU(mockChatRef.value, '', { enabled: false, code: '' })).toEqual({ mode: 'v2' });
  });

  it('mixed V2 anchor 晚于 legacy 来源时静默保 V2：legacy 残留备份进 anchor tagData 并清除', async () => {
    // 方向感知自愈：V2 根写在全部 legacy 源之后 → legacy 是旧版残留，用 legacy 覆盖会
    // 回滚用户数据。自愈方向 = keep_v2：清理 legacy 残留（原件进 mixedStorageDecisionBackup）。
    const data = { sheet_0: sheet('背包', [['row_id', '名称'], ['1', 'legacy 铁剑']]) } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: {
            version: 2,
            headRevision: 'checkpoint:newer-v2',
            checkpoint: { kind: 'full', createdAt: 2, reason: 'init', data: { sheet_0: sheet('背包', [['row_id', '名称'], ['1', 'V2 新数据']]) } },
            logEntries: [],
          } },
        },
      },
    ];

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result.migrated).toBe(true);
    expect((result.data as any).sheet_0.content[1]).toEqual(['1', 'V2 新数据']);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    // legacy 残留字段已从楼层清除
    expect(mockChatRef.value[0].TavernDB_ACU_IndependentData).toBeUndefined();
    // 原件备份写在 anchor tagData 上
    const anchorTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
    expect(anchorTag.mixedStorageDecisionBackup).toEqual(expect.objectContaining({ action: 'keep_v2' }));
    expect(anchorTag.mixedStorageDecisionBackup.legacyData.sheet_0.content[1]).toEqual(['1', 'legacy 铁剑']);
    // V2 帧原样保留
    expect(anchorTag.storageFrame.headRevision).toBe('checkpoint:newer-v2');
  });

  it('V2 anchor 早于 legacy 源且带业务日志时静默采纳合并结果，V2 帧全量归档', async () => {
    // 方向感知自愈：legacy 源晚于 V2 anchor → legacy 是最近权威（降级版本在 V2 之上又写了
    // V1）。自愈方向 = 采纳当前合并结果重写迁移根；V2 帧（含业务日志）深拷贝进归档兜底。
    const data = { sheet_0: sheet('背包', [['row_id', '名称'], ['1', 'legacy 铁剑']]) } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: {
            version: 2,
            headRevision: 'checkpoint:v2-with-log',
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: sheet('背包', [['row_id', '名称'], ['1', 'V2 基底']]) } },
            logEntries: [{
              seq: 1,
              entryId: 'v2-successor-in-anchor-frame',
              createdAt: 2,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: [],
              changedSheetKeys: ['sheet_0'],
              groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', 'V2 后继数据'] }],
            }],
          } },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
    ];
    const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

    expect(result.migrated).toBe(true);
    expect((result.data as any).sheet_0.content[1]).toEqual(['1', 'legacy 铁剑']);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    // 新迁移根写在末位 AI 楼层，被替代的 V2 帧（含业务日志）已归档
    const targetTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
    expect(targetTag.storageFrame.checkpoint.reason).toBe('migration');
    expect(targetTag.migrationAuditBackup.supersededV2Frames).toEqual([
      expect.objectContaining({ messageIndex: 0, storageFrame: expect.objectContaining({ headRevision: 'checkpoint:v2-with-log' }) }),
    ]);
  });

  it('V2 replay 含 legacy 候选缺失的业务表时自愈补表：该表不离开活动数据', async () => {
    const data = { sheet_0: sheet('背包', [['row_id', '名称'], ['1', 'legacy 铁剑']]) } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: {
            version: 2,
            headRevision: 'checkpoint:v2-extra-sheet',
            checkpoint: {
              kind: 'full',
              createdAt: 1,
              reason: 'init',
              data: {
                sheet_0: sheet('背包', [['row_id', '名称'], ['1', 'V2 旧值']]),
                sheet_v2_only: sheet('V2 独有表', [['row_id', '名称'], ['1', '不得静默删除']]),
              },
            },
            logEntries: [],
          } },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
    ];
    const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

    expect(result.migrated).toBe(true);
    // legacy 权威方向的采纳合并：V2 独有表补进候选（数据不删除），legacy 表按候选为准
    expect((result.data as any).sheet_v2_only.content[1]).toEqual(['1', '不得静默删除']);
    expect((result.data as any).sheet_0.content[1]).toEqual(['1', 'legacy 铁剑']);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    const targetTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
    expect(targetTag.storageFrame.checkpoint.data.sheet_v2_only.content[1]).toEqual(['1', '不得静默删除']);
    expect(targetTag.migrationAuditBackup.supersededV2Frames).toHaveLength(1);
  });

  it('mixed 升级残留收敛严格保存失败时恢复 legacy 与旧 V2', async () => {
    const data = structuredClone(mixedLegacyV2Fixture.legacy) as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: structuredClone(mixedLegacyV2Fixture.v2Frame) },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
    ];
    const before = structuredClone(mockChatRef.value);
    mockSaveChatToHost.mockRejectedValueOnce(new Error('mixed host write failed'));

    const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

    expect(result).toEqual(expect.objectContaining({ migrated: false, error: expect.stringContaining('mixed host write failed') }));
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    expect(mockChatRef.value).toEqual(before);
  });

  // logEntries 损坏时日志区域不可枚举：V2 不可严格读出 → 方向不可判定 → 静默自愈采纳
  // legacy 合并结果重写迁移根；损坏帧原样深拷贝进归档（数据不销毁、可追溯）。
  it('存在畸形 V2 历史标记（logEntries 损坏）时静默自愈：采纳 legacy 合并并归档损坏帧', async () => {
    const data = { sheet_0: sheet('背包', [['row_id', '名称'], ['1', 'legacy 铁剑']]) } as any;
    mockChatRef.value = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: 'checkpoint:malformed',
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data },
              logEntries: 'broken',
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
    ];
    const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

    expect(result.migrated).toBe(true);
    expect((result.data as any).sheet_0.content[1]).toEqual(['1', 'legacy 铁剑']);
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    const targetTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
    expect(targetTag.storageFrame.checkpoint.reason).toBe('migration');
    expect(targetTag.migrationAuditBackup.supersededV2Frames).toEqual([
      expect.objectContaining({ messageIndex: 0, storageFrame: expect.objectContaining({ headRevision: 'checkpoint:malformed' }) }),
    ]);
  });

  it('候选构建期间 isolation scope 漂移时零写入并保留原聊天', async () => {
    const data = structuredClone(mixedLegacyV2Fixture.legacy) as any;
    mockChatRef.value = [
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: structuredClone(mixedLegacyV2Fixture.v2Frame) } } },
      { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
    ];
    const before = structuredClone(mockChatRef.value);

    const pending = migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });
    mockRuntimeScope.isolationKey = 'drifted-isolation';
    const result = await pending;

    expect(result).toEqual(expect.objectContaining({
      migrated: false,
      error: 'legacy migration aborted: active isolation changed before commit',
    }));
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
    expect(mockChatRef.value).toEqual(before);
  });

  it('候选构建期间活动聊天漂移时零写入且不改写原聊天', async () => {
    const data = structuredClone(mixedLegacyV2Fixture.legacy) as any;
    const originalChat = [
      { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: structuredClone(mixedLegacyV2Fixture.v2Frame) } } },
      { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
    ];
    mockChatRef.value = originalChat;
    const before = structuredClone(originalChat);

    const pending = migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });
    mockChatRef.value = [{ is_user: false, mes: 'other chat' }];
    const result = await pending;

    expect(result).toEqual(expect.objectContaining({
      migrated: false,
      error: 'legacy migration aborted: active chat changed before commit',
    }));
    expect(mockSaveChatToHost).not.toHaveBeenCalled();
    expect(originalChat).toEqual(before);
    expect(mockChatRef.value).toEqual([{ is_user: false, mes: 'other chat' }]);
  });


  it('严格保存失败时恢复整个 legacy chat，不留下半迁移状态', async () => {
    const data = { sheet_0: sheet('背包') } as any;
    setLegacyMigrationChat(data);
    const before = structuredClone(mockChatRef.value);
    mockSaveChatToHost.mockRejectedValueOnce(new Error('host write failed'));

    const result = await migrateLegacyStorageToV2OnLoad_ACU({
      data,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
    });

    expect(result).toEqual(expect.objectContaining({ migrated: false, error: expect.stringContaining('host write failed') }));
    expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
    expect(mockChatRef.value).toEqual(before);
  });


  describe('V2 不可读时以 legacy 为权威源重建（T8 矩阵）', () => {
    // 「V2 不可读但表清单可静态枚举」的形态：无 full checkpoint（anchor=null →
    // replay 不可用 → 走重建分支），perSheetCheckpoints 合法（清单可完整枚举 →
    // 不触发 fail-closed），logEntries 为空数组。
    //
    // 不能用 logEntries:'broken'：日志不可枚举时静态扫描按计划 §3.1/§6/§9
    // fail-closed，必然继续阻塞（见上方 A2 阻塞用例）。
    const unreadableEnumerableFrame = (v2Data: any) => ({
      version: 2,
      headRevision: 'checkpoint:no-full-anchor',
      perSheetCheckpoints: {
        sheet_0: { kind: 'sheet_full', createdAt: 1, reason: 'init', sheetKey: 'sheet_0', data: v2Data.sheet_0 },
      },
      logEntries: [],
    });

    it('A1：legacy + 仅 _acu_storage_version:2 无 storageFrame 时重建成功且畸形槽已归档移除', async () => {
      const data = { sheet_0: sheet('背包', [['row_id', '名称'], ['1', '铁剑']]) } as any;
      const beforeProjection = getBusinessDataProjection_ACU(data);
      mockChatRef.value = [
        { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2 } } },
        { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      ];

      const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

      expect(result.migrated).toBe(true);
      expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
      expect(mockChatRef.value[0].TavernDB_ACU_IsolatedData?.['']?.storageFrame).toBeUndefined();
      const targetTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
      expect(targetTag.storageFrame.checkpoint.reason).toBe('migration');
      expect(getBusinessDataProjection_ACU(targetTag.storageFrame.checkpoint.data)).toEqual(beforeProjection);
      const replayedData = await loadTableStateFromFramesV2_ACU(mockChatRef.value, '', { updateRuntimeState: false });
      expect(getBusinessDataProjection_ACU(replayedData)).toEqual(beforeProjection);
      expect(targetTag.migrationAuditBackup.supersededV2Frames).toEqual([
        expect.objectContaining({ messageIndex: 0, isolationKey: '', malformed: true }),
      ]);
    });

    it('A3：legacy + 有 frame 无 full checkpoint（missing_with_artifacts）时重建成功且 artifacts 全部归档', async () => {
      const data = { sheet_0: sheet('背包', [['row_id', '名称'], ['1', '铁剑']]) } as any;
      const beforeProjection = getBusinessDataProjection_ACU(data);
      mockChatRef.value = [
        {
          is_user: false,
          TavernDB_ACU_IsolatedData: {
            '': {
              _acu_storage_version: 2,
              storageFrame: {
                version: 2,
                headRevision: 'checkpoint:no-full',
                perSheetCheckpoints: {
                  sheet_0: { kind: 'sheet_full', createdAt: 1, reason: 'init', sheetKey: 'sheet_0', data: data.sheet_0 },
                },
                logEntries: [],
              },
            },
          },
        },
        { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      ];

      const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

      expect(result.migrated).toBe(true);
      const targetTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
      expect(targetTag.storageFrame.checkpoint.reason).toBe('migration');
      expect(getBusinessDataProjection_ACU(targetTag.storageFrame.checkpoint.data)).toEqual(beforeProjection);
      expect(targetTag.migrationAuditBackup.supersededV2Frames).toEqual([
        expect.objectContaining({ messageIndex: 0, isolationKey: '', storageFrame: expect.objectContaining({ version: 2, headRevision: 'checkpoint:no-full' }) }),
      ]);
    });

    it('A4：legacy + anchor 存在但 replay 抛错时重建成功', async () => {
      const data = { sheet_0: sheet('背包', [['row_id', '名称'], ['1', '铁剑']]) } as any;
      const beforeProjection = getBusinessDataProjection_ACU(data);
      mockChatRef.value = [
        {
          is_user: false,
          TavernDB_ACU_IsolatedData: {
            '': {
              _acu_storage_version: 2,
              storageFrame: {
                version: 2,
                headRevision: 'checkpoint:replay-crash',
                checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: { ...data.sheet_0, content: [['row_id', '名称'], ['9', 'V2 损坏行']] } } },
                logEntries: [{ seq: 1, entryId: 'e1', createdAt: 1, source: 'manual', targetMessageIndex: 0, aiFloor: 1, operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['x'] }] }],
              },
            },
          },
        },
        { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      ];

      const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

      expect(result.migrated).toBe(true);
      const targetTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
      expect(targetTag.storageFrame.checkpoint.reason).toBe('migration');
      expect(getBusinessDataProjection_ACU(targetTag.storageFrame.checkpoint.data)).toEqual(beforeProjection);
    });

    it('B1：静态扫描发现 V2 有 legacy 中不存在的表时静默自愈（同名表判重不重复补表，帧归档）', async () => {
      const data = { sheet_0: sheet('背包') } as any;
      mockChatRef.value = [
        {
          is_user: false,
          TavernDB_ACU_IsolatedData: {
            '': {
              _acu_storage_version: 2,
              storageFrame: { version: 2, headRevision: 'h', checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_0: data.sheet_0, sheet_v2_only: data.sheet_0 } }, logEntries: [] },
            },
          },
        },
        { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      ];

      const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

      expect(result.migrated).toBe(true);
      // sheet_v2_only 与候选 sheet_0 同显示名（背包）→ 规范名判重不补（避免同名双表冲突），
      // 原帧整体归档兜底。
      expect((result.data as any).sheet_v2_only).toBeUndefined();
      expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
      const targetTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
      expect(targetTag.migrationAuditBackup.supersededV2Frames).toEqual([
        expect.objectContaining({ messageIndex: 0, storageFrame: expect.objectContaining({ headRevision: 'h' }) }),
      ]);
    });

    it('B2：静态扫描命中无法解码区域时静默自愈（V2 不可读，采纳 legacy 合并并归档）', async () => {
      const data = { sheet_0: sheet('背包') } as any;
      mockChatRef.value = [
        {
          is_user: false,
          TavernDB_ACU_IsolatedData: {
            '': {
              _acu_storage_version: 2,
              storageFrame: { version: 2, headRevision: 'h', checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: 'not-an-object' }, logEntries: [] },
            },
          },
        },
        { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      ];

      const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

      expect(result.migrated).toBe(true);
      expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
      const targetTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
      expect(targetTag.storageFrame.checkpoint.reason).toBe('migration');
      expect(targetTag.migrationAuditBackup.supersededV2Frames).toEqual([
        expect.objectContaining({ messageIndex: 0, storageFrame: expect.objectContaining({ headRevision: 'h' }) }),
      ]);
    });

    it('B5：V2 带 provenance 但源证据不匹配且 legacy 源更晚时静默自愈采纳合并（不再阻塞）', async () => {
      // provenance 声称源在 #0，实际 legacy 源在 #1（provenance 源证据不匹配 → 不构成
      // "V2 继承 legacy"的证明）；legacy 源晚于 anchor → legacy 为最近权威，采纳合并。
      const data = { sheet_0: sheet('背包') } as any;
      mockChatRef.value = [
        {
          is_user: false,
          TavernDB_ACU_IsolatedData: {
            '': {
              _acu_storage_version: 2,
              storageFrame: {
                version: 2,
                headRevision: 'checkpoint:with-provenance',
                checkpoint: {
                  kind: 'full', createdAt: 1, reason: 'migration', data,
                  migrationProvenance: {
                    version: 1,
                    legacyDataFingerprint: getTableDataFingerprint_ACU(data),
                    legacySourceMessageIndices: [0], legacySourceAiFloors: [1],
                    legacyLastChangedAiFloorBySheet: { sheet_0: 1 },
                    targetMessageIndex: 0, targetAiFloor: 1, isolationKey: '', migratedAt: 1,
                  },
                },
                logEntries: [],
              },
            },
          },
        },
        { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      ];

      const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

      expect(result.migrated).toBe(true);
      expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
      const targetTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
      expect(targetTag.storageFrame.checkpoint.reason).toBe('migration');
      expect(targetTag.migrationAuditBackup.supersededV2Frames).toEqual([
        expect.objectContaining({ messageIndex: 0, storageFrame: expect.objectContaining({ headRevision: 'checkpoint:with-provenance' }) }),
      ]);
    });

    it('B7：V2 静态表名归一化存在多对一歧义时静默自愈（原帧整体归档，不做歧义 key 猜测）', async () => {
      const data = { sheet_0: sheet('背包') } as any;
      mockChatRef.value = [
        {
          is_user: false,
          TavernDB_ACU_IsolatedData: {
            '': {
              _acu_storage_version: 2,
              storageFrame: { version: 2, headRevision: 'h', checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: { sheet_a: { ...data.sheet_0, name: '背包' }, sheet_b: { ...data.sheet_0, name: '背包' } } }, logEntries: [] },
            },
          },
        },
        { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      ];

      const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

      expect(result.migrated).toBe(true);
      expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
      const targetTag = mockChatRef.value[1].TavernDB_ACU_IsolatedData[''];
      expect(targetTag.storageFrame.checkpoint.reason).toBe('migration');
      expect(targetTag.migrationAuditBackup.supersededV2Frames).toEqual([
        expect.objectContaining({ messageIndex: 0, storageFrame: expect.objectContaining({ headRevision: 'h' }) }),
      ]);
    });

    it('幂等：重建成功后重复加载不再调用 migration 且不重复写入', async () => {
      const data = { sheet_0: sheet('背包') } as any;
      mockChatRef.value = [
        { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: unreadableEnumerableFrame(data) } } },
        { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      ];

      const first = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });
      expect(first.migrated).toBe(true);
      expect(mockSaveChatToHost).toHaveBeenCalledTimes(1);
      const checkpointData = structuredClone(mockChatRef.value[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data);

      mockSaveChatToHost.mockClear();
      const reopened = await migrateLegacyStorageToV2OnLoad_ACU({ data: checkpointData, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

      expect(reopened).toEqual({ migrated: false });
      expect(mockSaveChatToHost).not.toHaveBeenCalled();
      expect(resolveTableStorageStrategy_ACU(mockChatRef.value, '', { enabled: false, code: '' })).toEqual({ mode: 'v2' });
    });

    it('A5：多 isolationKey 时只影响目标槽，其他槽字节等价', async () => {
      const data = { sheet_0: sheet('背包') } as any;
      const otherTag = { _acu_storage_version: 1, independentData: { sheet_9: data.sheet_0 }, modifiedKeys: ['sheet_9'], updateGroupKeys: [] };
      mockChatRef.value = [
        {
          is_user: false,
          TavernDB_ACU_IsolatedData: {
            'tag-a': { _acu_storage_version: 2, storageFrame: unreadableEnumerableFrame(data) },
            'tag-b': structuredClone(otherTag),
          },
        },
        { is_user: false, TavernDB_ACU_Identity: 'tag-a', TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      ];
      const otherBefore = structuredClone(mockChatRef.value[0].TavernDB_ACU_IsolatedData['tag-b']);

      const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: 'tag-a', isolationConfig: { enabled: true, code: 'tag-a' } });

      expect(result.migrated).toBe(true);
      expect(mockChatRef.value[0].TavernDB_ACU_IsolatedData['tag-b']).toEqual(otherBefore);
      expect(mockChatRef.value[0].TavernDB_ACU_IsolatedData['tag-a']?.storageFrame).toBeUndefined();
      expect(mockChatRef.value[1].TavernDB_ACU_IsolatedData['tag-a'].storageFrame.checkpoint.reason).toBe('migration');
    });

    it('归档完整性：移除集合与归档集合逐项对应', async () => {
      const data = { sheet_0: sheet('背包') } as any;
      mockChatRef.value = [
        { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: unreadableEnumerableFrame(data) } } },
        { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: unreadableEnumerableFrame(data) } } },
        { is_user: false, TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 }, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
      ];

      const result = await migrateLegacyStorageToV2OnLoad_ACU({ data, isolationKey: '', isolationConfig: { enabled: false, code: '' } });

      expect(result.migrated).toBe(true);
      const backup = mockChatRef.value[2].TavernDB_ACU_IsolatedData[''].migrationAuditBackup;
      expect(backup.supersededV2Frames).toHaveLength(2);
      expect(backup.supersededV2Frames.map((f: any) => f.messageIndex)).toEqual([0, 1]);
      // 全部被移除的 V2 槽在 backup 中可逐项还原
      for (const frame of backup.supersededV2Frames) {
        expect(frame.storageFrame).toBeDefined();
        expect(frame.isolationKey).toBe('');
      }
      expect(mockChatRef.value[0].TavernDB_ACU_IsolatedData?.['']?.storageFrame).toBeUndefined();
      expect(mockChatRef.value[1].TavernDB_ACU_IsolatedData?.['']?.storageFrame).toBeUndefined();
    });
  });

});
