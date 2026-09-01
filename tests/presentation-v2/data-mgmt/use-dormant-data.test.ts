/**
 * @vitest-environment jsdom
 *
 * useDormantData（S3-4 休眠数据可见性 + 唤醒）composable 测试：
 * 刷新清单（成功/错误态）、唤醒表/列（确认→服务→toast→刷新）、确认取消、失败透传。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadDormant(overrides: {
  tables?: any;
  columns?: any;
  audit?: any;
  wakeTable?: any;
  wakeColumn?: any;
} = {}) {
  vi.resetModules();
  const listTables = vi.fn(overrides.tables ?? (() => ({ ok: true, entries: [] })));
  const listColumns = vi.fn(overrides.columns ?? (() => ({ ok: true, entries: [] })));
  const audit = vi.fn(overrides.audit ?? (() => ({ ok: true, issues: [], hiddenCount: 0 })));
  const wakeTable = vi.fn(overrides.wakeTable ?? (async () => ({ saved: true })));
  const wakeColumn = vi.fn(overrides.wakeColumn ?? (async () => ({ saved: true })));

  vi.doMock('../../../src/service/template/dormant-data-service', () => ({
    listDormantTables_ACU: listTables,
    listDormantColumns_ACU: listColumns,
    auditDormantDataIntegrity_ACU: audit,
    wakeDormantTable_ACU: wakeTable,
    wakeDormantColumn_ACU: wakeColumn,
  }));

  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
  const [{ useDormantData }, { useToastStore }, { useDialogStore }] = await Promise.all([
    import('../../../src/presentation-v2/composables/useDormantData'),
    import('../../../src/presentation-v2/stores/toast-store'),
    import('../../../src/presentation-v2/stores/dialog-store'),
  ]);
  const toast = useToastStore();
  const dialogStore = useDialogStore();
  const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => {});
  const toastError = vi.spyOn(toast, 'error').mockImplementation(() => {});
  const confirm = vi.spyOn(dialogStore, 'confirm').mockResolvedValue(true);
  return { dormant: useDormantData(), listTables, listColumns, audit, wakeTable, wakeColumn, toastSuccess, toastError, confirm };
}

const tableEntry = {
  sheetKey: 'sheet_note',
  name: 'note',
  rowCount: 2,
  columnCount: 3,
  hiddenAtMessageIndex: 5,
  canWake: true,
};

const columnEntry = {
  sheetKey: 'sheet_role',
  sheetName: '角色表',
  header: '备注',
  hiddenName: '备注',
};

beforeEach(() => { vi.restoreAllMocks(); });

describe('useDormantData', () => {
  it('refresh：并取两类清单并更新状态，成功时 listError 为 null', async () => {
    const d = await loadDormant({
      tables: () => ({ ok: true, entries: [tableEntry] }),
      columns: () => ({ ok: true, entries: [columnEntry] }),
    });
    d.dormant.refresh();
    expect(d.dormant.dormantTables.value).toEqual([tableEntry]);
    expect(d.dormant.dormantColumns.value).toEqual([columnEntry]);
    expect(d.dormant.listError.value).toBeNull();
    expect(d.dormant.loaded.value).toBe(true);
    expect(d.dormant.isEmpty.value).toBe(false);
  });

  it('refresh：任一来源失败进入错误态（区分「无休眠」与「读不出」）', async () => {
    const d = await loadDormant({
      tables: () => ({ ok: false, entries: [], error: '生命周期派生失败' }),
      columns: () => ({ ok: true, entries: [] }),
    });
    d.dormant.refresh();
    expect(d.dormant.listError.value).toContain('生命周期派生失败');
    expect(d.dormant.dormantTables.value).toEqual([]);
  });

  it('refresh：S3-3 完整性审计成功时填充 integrityIssues', async () => {
    const issue = {
      sheetKey: 'sheet_orphan',
      name: 'sheet_orphan',
      kind: 'missing_restore_data',
      message: '休眠表 sheet_orphan 的恢复数据缺失。',
    };
    const d = await loadDormant({
      audit: () => ({ ok: true, issues: [issue], hiddenCount: 1 }),
    });
    d.dormant.refresh();
    expect(d.audit).toHaveBeenCalledOnce();
    expect(d.dormant.integrityIssues.value).toEqual([issue]);
  });

  it('refresh：审计 ok=false 时 integrityIssues 置空（派生失败已由 listError 呈现，不重复报）', async () => {
    const d = await loadDormant({
      tables: () => ({ ok: false, entries: [], error: '生命周期派生失败' }),
      audit: () => ({ ok: false, issues: [], hiddenCount: 0, error: '生命周期派生失败' }),
    });
    d.dormant.refresh();
    expect(d.dormant.integrityIssues.value).toEqual([]);
    expect(d.dormant.listError.value).toContain('生命周期派生失败');
  });

  it('wakeTable：确认后调用服务、toast 成功并刷新清单', async () => {
    const d = await loadDormant({ tables: () => ({ ok: true, entries: [tableEntry] }) });
    const ok = await d.dormant.wakeTable(tableEntry as any);
    expect(ok).toBe(true);
    expect(d.confirm).toHaveBeenCalledOnce();
    expect(d.wakeTable).toHaveBeenCalledWith('sheet_note');
    expect(d.toastSuccess).toHaveBeenCalledOnce();
    // 动作后刷新清单
    expect(d.listTables).toHaveBeenCalled();
  });

  it('wakeTable：用户取消确认 → 不调用服务', async () => {
    const d = await loadDormant();
    d.confirm.mockResolvedValue(false);
    const ok = await d.dormant.wakeTable(tableEntry as any);
    expect(ok).toBe(false);
    expect(d.wakeTable).not.toHaveBeenCalled();
  });

  it('wakeTable：canWake=false 时直接 toast 阻止原因，不弹确认框', async () => {
    const d = await loadDormant();
    const blocked = { ...tableEntry, canWake: false, wakeBlockedReason: '存在同名表' };
    const ok = await d.dormant.wakeTable(blocked as any);
    expect(ok).toBe(false);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.wakeTable).not.toHaveBeenCalled();
    expect(d.toastError).toHaveBeenCalledWith('存在同名表');
  });

  it('wakeTable：服务失败 → toast 透传错误且返回 false，仍刷新清单', async () => {
    const d = await loadDormant({ wakeTable: async () => ({ saved: false, error: '协调被拒绝' }) });
    const ok = await d.dormant.wakeTable(tableEntry as any);
    expect(ok).toBe(false);
    expect(d.toastError).toHaveBeenCalledWith('协调被拒绝');
    expect(d.listTables).toHaveBeenCalled();
  });

  it('wakeColumn：确认后以 hiddenName 调用服务并 toast 成功', async () => {
    const d = await loadDormant();
    const ok = await d.dormant.wakeColumn(columnEntry as any);
    expect(ok).toBe(true);
    expect(d.wakeColumn).toHaveBeenCalledWith('sheet_role', '备注');
    expect(d.toastSuccess).toHaveBeenCalledOnce();
  });

  it('wakeColumn：服务失败 → toast 透传错误', async () => {
    const d = await loadDormant({ wakeColumn: async () => ({ saved: false, error: '列不在休眠集中' }) });
    const ok = await d.dormant.wakeColumn(columnEntry as any);
    expect(ok).toBe(false);
    expect(d.toastError).toHaveBeenCalledWith('列不在休眠集中');
  });
});
