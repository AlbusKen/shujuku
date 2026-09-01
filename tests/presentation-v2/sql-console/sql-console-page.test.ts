/**
 * AdvancedToolsPage SQL 面板集成 — SQL 控制台布局、执行与历史
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

async function mountAdvancedToolsSqlPanel(opts: {
  queryResult?: { columns: string[]; values: any[][]; rowCount: number };
  mutationResult?: { changes: number; errors: string[] };
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ router: { activePageId: 'advanced-tools' } }));

  const executeQuery = vi.fn(() => opts.queryResult ?? {
    columns: ['name'],
    values: [['背包物品表']],
    rowCount: 1,
  });
  const executeMutation = vi.fn(() => opts.mutationResult ?? { changes: 1, errors: [] });
  const provider = {
    executeQuery,
    executeMutation,
  };
  const getStorageProvider = vi.fn(() => provider);
  const ensureStorageProviderReady = vi.fn(async () => provider);

  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: {
      storageMode: 'sqlite',
      plotSettings: { enabled: false },
      summaryVectorIndexModeDefault: false,
    },
    currentJsonTableData_ACU: {},
    currentChatFileIdentifier_ACU: 'chat-sql',
    coreApisAreReady_ACU: true,
    isAutoUpdatingCard_ACU: false,
    getCurrentIsolationKey_ACU: () => '',
  }));
  vi.doMock('../../../src/service/table/storage-mode', () => ({
    isSqliteMode: () => true,
    getCurrentStorageMode: () => 'sqlite',
  }));
  vi.doMock('../../../src/service/table/table-storage-strategy', () => ({
    isStorageRuntimeReadyForSyncRead_ACU: () => true,
    getStorageProvider,
    ensureStorageProviderReady_ACU: ensureStorageProviderReady,
  }));

  const sqlConsole = await import('../../../src/presentation-v2/composables/useSqlConsole');
  sqlConsole.__resetSqlConsoleHistoryForTests();

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));

  return {
    mount,
    executeQuery,
    executeMutation,
    getStorageProvider,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AdvancedToolsPage SQL panel', () => {
  it('渲染高级工具页内 SQL 控制台面板，header 只放页面标题', async () => {
    const { mount } = await mountAdvancedToolsSqlPanel();

    const page = document.querySelector('.acu-v2-advanced-tools-page');
    expect(page).not.toBeNull();
    const text = page!.textContent || '';
    expect(text).toContain('SQL 控制台');
    expect(text).toContain('运行日志');
    expect(text).toContain('执行历史');
    expect(text).toContain('结果');
    expect(text).toContain('SQLite 模式');
    expect(page!.querySelectorAll('.acu-panel')).toHaveLength(2);
    expect(page!.querySelectorAll('.acu-v2-advanced-tools-page__tools-grid > .acu-panel')).toHaveLength(2);
    const mobileNavItems = Array.from(page!.querySelectorAll('.acu-mobile-panel-nav__item'))
      .map(item => item.textContent?.trim());
    expect(mobileNavItems).toEqual(['SQL 控制台', '运行日志']);

    expect(document.querySelector('.acu-v2-app__page-title')?.textContent?.trim()).toBe('高级工具');
    expect(page!.querySelector('.acu-page-header')).toBeNull();

    mount.__resetAcuV2MountForTests();
  });

  it('每个面板都渲染常驻说明信息条', async () => {
    const { mount } = await mountAdvancedToolsSqlPanel();

    const panels = document.querySelectorAll('.acu-v2-advanced-tools-page .acu-panel');
    expect(panels.length).toBe(2);
    panels.forEach(panel => {
      expect(panel.querySelector('.acu-panel__description-region .acu-info-banner')).not.toBeNull();
      expect(panel.querySelector('.acu-panel__header .acu-info-banner')).toBeNull();
    });

    mount.__resetAcuV2MountForTests();
  });

  it('输入 SELECT 后执行，展示查询表格并记录历史', async () => {
    const { mount, executeQuery } = await mountAdvancedToolsSqlPanel({
      queryResult: {
        columns: ['id', 'name'],
        values: [[1, '药水']],
        rowCount: 1,
      },
    });

    const textarea = document.querySelector<HTMLTextAreaElement>('.acu-v2-advanced-tools-page textarea[aria-label="SQL 语句"]');
    expect(textarea).not.toBeNull();
    textarea!.value = 'SELECT id, name FROM item;';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const executeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.acu-v2-advanced-tools-page button'))
      .find(button => button.textContent?.includes('执行'));
    expect(executeButton).not.toBeUndefined();
    executeButton!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(executeQuery).toHaveBeenCalledWith('SELECT id, name FROM item;');
    const text = document.querySelector('.acu-v2-advanced-tools-page')?.textContent || '';
    expect(text).toContain('药水');
    expect(text).toContain('1 行');
    expect(text).toContain('成功');

    const clearButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.acu-v2-advanced-tools-page button'))
      .find(button => button.textContent?.includes('清空'));
    expect(clearButton).not.toBeUndefined();
    clearButton!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(textarea!.value).toBe('');

    const historyItem = document.querySelector<HTMLElement>('.acu-v2-advanced-tools-page__sql-history-item');
    expect(historyItem).not.toBeNull();
    expect(historyItem!.tagName).toBe('BUTTON');
    expect(historyItem!.getAttribute('role')).toBeNull();
    expect(historyItem!.getAttribute('tabindex')).toBeNull();
    expect(historyItem!.querySelector('.acu-v2-advanced-tools-page__log-message')?.textContent).toBe('SELECT id, name FROM item;');
    expect(historyItem!.querySelector('.acu-v2-advanced-tools-page__log-tag')).toBeNull();
    historyItem!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(textarea!.value).toBe('SELECT id, name FROM item;');

    mount.__resetAcuV2MountForTests();
  });

  it('快捷查看所有表会填入 SQL 并立即执行', async () => {
    const { mount, executeQuery } = await mountAdvancedToolsSqlPanel();

    const showTablesButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.acu-v2-advanced-tools-page button'))
      .find(button => button.textContent?.includes('查看所有表'));
    expect(showTablesButton).not.toBeUndefined();
    showTablesButton!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(executeQuery).toHaveBeenCalledWith(expect.stringContaining("sqlite_master"));
    const textarea = document.querySelector<HTMLTextAreaElement>('.acu-v2-advanced-tools-page textarea[aria-label="SQL 语句"]');
    expect(textarea?.value).toContain("sqlite_master");
    expect(document.querySelector('.acu-v2-advanced-tools-page')?.textContent || '').toContain('背包物品表');

    mount.__resetAcuV2MountForTests();
  });

  it('执行变更失败时展示错误结果', async () => {
    const { mount, executeMutation } = await mountAdvancedToolsSqlPanel({
      mutationResult: { changes: 0, errors: ['no such table: item'] },
    });

    const textarea = document.querySelector<HTMLTextAreaElement>('.acu-v2-advanced-tools-page textarea[aria-label="SQL 语句"]')!;
    textarea.value = "UPDATE item SET name = 'x';";
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const executeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.acu-v2-advanced-tools-page button'))
      .find(button => button.textContent?.includes('执行'));
    executeButton!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(executeMutation).toHaveBeenCalledWith("UPDATE item SET name = 'x';", undefined);
    const text = document.querySelector('.acu-v2-advanced-tools-page')?.textContent || '';
    expect(text).toContain('no such table: item');
    expect(text).toContain('失败');
    expect(document.querySelector('.acu-v2-advanced-tools-page__sql-history-item--failure')).not.toBeNull();

    mount.__resetAcuV2MountForTests();
  });
});
