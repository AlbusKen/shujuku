/**
 * tests/service/template/dormant-data-service.test.ts
 * 休眠数据可见性与唤醒服务（S3-4）单元测试
 *
 * 覆盖：
 * - listDormantTables_ACU：生命周期映射（楼层/时间/来源模板）、四类唤醒守卫、派生失败错误态
 * - listDormantColumns_ACU：隐藏列投影、快照不可用错误态、单表投影失败跳过
 * - wakeDormantTable_ACU：header-only 壳构造与 apply 调用形态、非休眠/守卫失败拒绝
 * - wakeDormantColumn_ACU：隐藏集移除（大小写不敏感）、列不在休眠集/表不存在拒绝
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChat } = vi.hoisted(() => ({ mockChat: [{ is_user: false }] as any[] }));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mockChat),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
}));

vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  deriveSheetLifecycleFromFramesV2_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../src/service/template/template-preset-service', () => ({
  applyChatTemplateSnapshotWithReconciliation_ACU: vi.fn(async () => ({ saved: true })),
  getRuntimeTemplateSnapshot_ACU: vi.fn(() => null),
  resolveActiveTemplatePresetName_ACU: vi.fn(() => '预设A'),
}));

import { deriveSheetLifecycleFromFramesV2_ACU } from '../../../src/service/table/storage-frame-v2-replay';
import {
  applyChatTemplateSnapshotWithReconciliation_ACU,
  getRuntimeTemplateSnapshot_ACU,
} from '../../../src/service/template/template-preset-service';
import {
  auditDormantDataIntegrity_ACU,
  listDormantColumns_ACU,
  listDormantTables_ACU,
  wakeDormantColumn_ACU,
  wakeDormantTable_ACU,
} from '../../../src/service/template/dormant-data-service';

const mockDeriveLifecycle = vi.mocked(deriveSheetLifecycleFromFramesV2_ACU);
const mockApply = vi.mocked(applyChatTemplateSnapshotWithReconciliation_ACU);
const mockGetSnapshot = vi.mocked(getRuntimeTemplateSnapshot_ACU);

function makeSheet(name: string, headers: string[], rows: string[][] = [], sourceData: Record<string, unknown> = {}) {
  return { name, content: [headers, ...rows], sourceData } as any;
}

function makeLifecycle(hiddenEntries: Record<string, any>) {
  const statusBySheetKey: Record<string, any> = {};
  for (const [key, entry] of Object.entries(hiddenEntries)) {
    statusBySheetKey[key] = { status: 'hidden', lastTimelineKind: 'sheet_hide', ...entry };
  }
  return {
    statusBySheetKey,
    activeSheetKeys: [],
    hiddenSheetKeys: Object.keys(hiddenEntries),
    indeterminateSheetKeys: [],
    neverSeenSheetKeys: [],
  } as any;
}

function makeSnapshot(templateObj: Record<string, any>) {
  return { templateObj, templateStr: JSON.stringify(templateObj) } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApply.mockResolvedValue({ saved: true } as any);
  mockGetSnapshot.mockReturnValue(null);
});

describe('listDormantTables_ACU', () => {
  it('映射生命周期条目：行列数、休眠楼层、休眠时间、来源模板与 canWake=true', () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_note: {
        lastTimelineMessageIndex: 5,
        lastTimelineAfterSeq: 2,
        lastTimelineCreatedAt: 1717000000000,
        hideSourcePresetName: '旧预设',
        restoreSourceData: makeSheet('note', ['行', '角色', '备注'], [['1', '爱丽丝', '重要'], ['2', '鲍勃', '次要']]),
      },
    }));
    mockGetSnapshot.mockReturnValue(makeSnapshot({
      sheet_other: makeSheet('other', ['行', '事件']),
    }));

    const result = listDormantTables_ACU();
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      sheetKey: 'sheet_note',
      name: 'note',
      rowCount: 2,
      columnCount: 2,
      hiddenAtMessageIndex: 5,
      hiddenAtTime: 1717000000000,
      sourcePresetName: '旧预设',
      canWake: true,
    });
    expect(result.entries[0].wakeBlockedReason).toBeUndefined();
  });

  it('历史 checkpoint 无时间/来源模板时字段为 undefined（展示层回退楼层号/「未记录」）', () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_note: {
        lastTimelineMessageIndex: 3,
        restoreSourceData: makeSheet('note', ['行', '角色']),
      },
    }));
    mockGetSnapshot.mockReturnValue(makeSnapshot({}));

    const result = listDormantTables_ACU();
    expect(result.ok).toBe(true);
    expect(result.entries[0].hiddenAtTime).toBeUndefined();
    expect(result.entries[0].sourcePresetName).toBeUndefined();
    expect(result.entries[0].hiddenAtMessageIndex).toBe(3);
  });

  it('守卫：派生 key 与历史 key 不一致（休眠后改名）→ canWake=false', () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_note: {
        restoreSourceData: makeSheet('renamed', ['行', '角色']),
      },
    }));
    mockGetSnapshot.mockReturnValue(makeSnapshot({}));

    const result = listDormantTables_ACU();
    expect(result.entries[0].canWake).toBe(false);
    expect(result.entries[0].wakeBlockedReason).toContain('改名');
  });

  it('守卫：当前模板存在 canonical 同名表 → canWake=false 并提示重命名', () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_note: {
        restoreSourceData: makeSheet('note', ['行', '角色']),
      },
    }));
    mockGetSnapshot.mockReturnValue(makeSnapshot({
      sheet_note_v2: makeSheet('  NOTE ', ['行', '事件']),
    }));

    const result = listDormantTables_ACU();
    expect(result.entries[0].canWake).toBe(false);
    expect(result.entries[0].wakeBlockedReason).toContain('同名表');
  });

  it('守卫：restoreSourceData 缺失 → canWake=false（快照缺失）', () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_note: { restoreSourceData: undefined },
    }));
    mockGetSnapshot.mockReturnValue(makeSnapshot({}));

    const result = listDormantTables_ACU();
    expect(result.entries[0].canWake).toBe(false);
    expect(result.entries[0].wakeBlockedReason).toContain('快照缺失');
  });

  it('守卫：运行时模板不可用 → canWake=false 但清单仍列出', () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_note: {
        restoreSourceData: makeSheet('note', ['行', '角色']),
      },
    }));
    mockGetSnapshot.mockReturnValue(null);

    const result = listDormantTables_ACU();
    expect(result.ok).toBe(true);
    expect(result.entries[0].canWake).toBe(false);
    expect(result.entries[0].wakeBlockedReason).toContain('运行时模板不可用');
  });

  it('生命周期派生抛错 → ok=false 错误态（区分「无休眠」与「读不出」）', () => {
    mockDeriveLifecycle.mockImplementation(() => { throw new Error('frame 损坏'); });

    const result = listDormantTables_ACU();
    expect(result.ok).toBe(false);
    expect(result.entries).toHaveLength(0);
    expect(result.error).toContain('frame 损坏');
  });
});

describe('listDormantColumns_ACU', () => {
  it('native 隐藏集（表头名身份）：列出 header 与 hiddenName', () => {
    mockGetSnapshot.mockReturnValue(makeSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_role: makeSheet('角色表', ['行', '角色', '备注'], [], { hiddenPhysicalColumns: ['备注'] }),
    }));

    const result = listDormantColumns_ACU();
    expect(result.ok).toBe(true);
    expect(result.entries).toEqual([
      { sheetKey: 'sheet_role', sheetName: '角色表', header: '备注', hiddenName: '备注' },
    ]);
  });

  it('无隐藏列的表不产生条目', () => {
    mockGetSnapshot.mockReturnValue(makeSnapshot({
      sheet_role: makeSheet('角色表', ['行', '角色']),
    }));

    const result = listDormantColumns_ACU();
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(0);
  });

  it('运行时模板不可用 → ok=false', () => {
    mockGetSnapshot.mockReturnValue(null);

    const result = listDormantColumns_ACU();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('运行时模板不可用');
  });

  it('单表投影失败（幽灵隐藏项）被跳过，其余表正常列出', () => {
    mockGetSnapshot.mockReturnValue(makeSnapshot({
      sheet_bad: makeSheet('坏表', ['行', '角色'], [], { hiddenPhysicalColumns: ['幽灵列'] }),
      sheet_good: makeSheet('好表', ['行', '事件', '地点'], [], { hiddenPhysicalColumns: ['地点'] }),
    }));

    const result = listDormantColumns_ACU();
    expect(result.ok).toBe(true);
    expect(result.entries).toEqual([
      { sheetKey: 'sheet_good', sheetName: '好表', header: '地点', hiddenName: '地点' },
    ]);
  });
});

describe('wakeDormantTable_ACU', () => {
  it('成功：以 header-only 壳并入运行时模板，经协调器应用（source=dormant_wake_table）', async () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_note: {
        restoreSourceData: makeSheet(
          'note',
          ['行', '角色', '备注'],
          [['1', '爱丽丝', '重要']],
          { hiddenPhysicalColumns: ['备注'] },
        ),
      },
    }));
    mockGetSnapshot.mockReturnValue(makeSnapshot({
      sheet_other: makeSheet('other', ['行', '事件']),
    }));

    const result = await wakeDormantTable_ACU('sheet_note');
    expect(result.saved).toBe(true);
    expect(mockApply).toHaveBeenCalledTimes(1);
    const [templateObj, options] = mockApply.mock.calls[0];
    // 壳只带表头行：数据由 reveal 链路从 hide checkpoint 权威恢复
    expect(templateObj.sheet_note.content).toEqual([['行', '角色', '备注']]);
    // 结构证据（隐藏集等 sourceData）保留
    expect(templateObj.sheet_note.sourceData.hiddenPhysicalColumns).toEqual(['备注']);
    // 既有现役表不受影响
    expect(templateObj.sheet_other.name).toBe('other');
    expect(options).toMatchObject({ source: 'dormant_wake_table', presetName: '预设A' });
  });

  it('非休眠状态的表 → 拒绝且不调用 apply', async () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({}));

    const result = await wakeDormantTable_ACU('sheet_note');
    expect(result.saved).toBe(false);
    expect(result.error).toContain('不处于休眠状态');
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('守卫失败（现役同名表）→ 拒绝且不调用 apply', async () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_note: {
        restoreSourceData: makeSheet('note', ['行', '角色']),
      },
    }));
    mockGetSnapshot.mockReturnValue(makeSnapshot({
      sheet_conflict: makeSheet('note', ['行', '事件']),
    }));

    const result = await wakeDormantTable_ACU('sheet_note');
    expect(result.saved).toBe(false);
    expect(result.error).toContain('同名表');
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('生命周期派生抛错 → 错误透传且不调用 apply', async () => {
    mockDeriveLifecycle.mockImplementation(() => { throw new Error('frame 损坏'); });

    const result = await wakeDormantTable_ACU('sheet_note');
    expect(result.saved).toBe(false);
    expect(result.error).toContain('frame 损坏');
    expect(mockApply).not.toHaveBeenCalled();
  });
});

describe('wakeDormantColumn_ACU', () => {
  it('成功：从隐藏集移除目标项（大小写不敏感），source=dormant_wake_column', async () => {
    mockGetSnapshot.mockReturnValue(makeSnapshot({
      sheet_role: makeSheet('角色表', ['行', '角色', 'Fav_Col', '备注'], [], {
        hiddenPhysicalColumns: ['Fav_Col', '备注'],
      }),
    }));

    const result = await wakeDormantColumn_ACU('sheet_role', 'fav_col');
    expect(result.saved).toBe(true);
    expect(mockApply).toHaveBeenCalledTimes(1);
    const [templateObj, options] = mockApply.mock.calls[0];
    expect(templateObj.sheet_role.sourceData.hiddenPhysicalColumns).toEqual(['备注']);
    expect(options).toMatchObject({ source: 'dormant_wake_column', presetName: '预设A' });
  });

  it('最后一个隐藏项被唤醒后隐藏集整体移除（不留空数组）', async () => {
    mockGetSnapshot.mockReturnValue(makeSnapshot({
      sheet_role: makeSheet('角色表', ['行', '角色', '备注'], [], { hiddenPhysicalColumns: ['备注'] }),
    }));

    const result = await wakeDormantColumn_ACU('sheet_role', '备注');
    expect(result.saved).toBe(true);
    const [templateObj] = mockApply.mock.calls[0];
    expect('hiddenPhysicalColumns' in templateObj.sheet_role.sourceData).toBe(false);
  });

  it('列不在休眠集 → 拒绝且不调用 apply', async () => {
    mockGetSnapshot.mockReturnValue(makeSnapshot({
      sheet_role: makeSheet('角色表', ['行', '角色'], [], { hiddenPhysicalColumns: [] }),
    }));

    const result = await wakeDormantColumn_ACU('sheet_role', '备注');
    expect(result.saved).toBe(false);
    expect(result.error).toContain('不在');
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('表不存在于当前模板 → 拒绝且不调用 apply', async () => {
    mockGetSnapshot.mockReturnValue(makeSnapshot({}));

    const result = await wakeDormantColumn_ACU('sheet_missing', '备注');
    expect(result.saved).toBe(false);
    expect(result.error).toContain('不存在');
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('运行时模板不可用 → 拒绝', async () => {
    mockGetSnapshot.mockReturnValue(null);

    const result = await wakeDormantColumn_ACU('sheet_role', '备注');
    expect(result.saved).toBe(false);
    expect(result.error).toContain('运行时模板不可用');
    expect(mockApply).not.toHaveBeenCalled();
  });
});

// ═══ S3-3 休眠完整性自检 ═══
describe('auditDormantDataIntegrity_ACU', () => {
  it('全部 hidden 表恢复来源可达且无 indeterminate → issues 为空', () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_note: { restoreSourceData: makeSheet('note', ['行', '角色'], [['1', '爱丽丝']]) },
      sheet_item: { restoreSourceData: makeSheet('item', ['行', '物品']) },
    }));

    const result = auditDormantDataIntegrity_ACU();
    expect(result).toEqual({ ok: true, issues: [], hiddenCount: 2 });
  });

  it('hidden 表 restoreSourceData 缺失 → missing_restore_data 孤儿', () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_orphan: { lastTimelineMessageIndex: 7 },
      sheet_ok: { restoreSourceData: makeSheet('ok', ['行', '值']) },
    }));

    const result = auditDormantDataIntegrity_ACU();
    expect(result.ok).toBe(true);
    expect(result.hiddenCount).toBe(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      sheetKey: 'sheet_orphan',
      name: 'sheet_orphan',
      kind: 'missing_restore_data',
    });
    expect(result.issues[0].message).toContain('无法唤醒');
  });

  it('restoreSourceData 存在但缺有效表头 → corrupt_restore_data（表名取快照 name）', () => {
    mockDeriveLifecycle.mockReturnValue(makeLifecycle({
      sheet_bad: { restoreSourceData: { name: '坏表', content: 'not-an-array', sourceData: {} } },
    }));

    const result = auditDormantDataIntegrity_ACU();
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      sheetKey: 'sheet_bad',
      name: '坏表',
      kind: 'corrupt_restore_data',
    });
  });

  it('indeterminate 生命周期计入警告（名称回退 sheetKey）', () => {
    const lifecycle = makeLifecycle({
      sheet_ok: { restoreSourceData: makeSheet('ok', ['行', '值']) },
    });
    lifecycle.indeterminateSheetKeys = ['sheet_mystery'];
    lifecycle.statusBySheetKey.sheet_mystery = { status: 'indeterminate' };
    mockDeriveLifecycle.mockReturnValue(lifecycle);

    const result = auditDormantDataIntegrity_ACU();
    expect(result.ok).toBe(true);
    expect(result.hiddenCount).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      sheetKey: 'sheet_mystery',
      name: 'sheet_mystery',
      kind: 'indeterminate_lifecycle',
    });
  });

  it('生命周期派生抛错 → ok=false + 错误信息，issues 为空', () => {
    mockDeriveLifecycle.mockImplementation(() => { throw new Error('frame 解析失败'); });

    const result = auditDormantDataIntegrity_ACU();
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.hiddenCount).toBe(0);
    expect(result.error).toContain('frame 解析失败');
  });
});
