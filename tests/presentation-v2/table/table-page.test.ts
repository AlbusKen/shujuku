/**
 * TablePage 集成 — 标签筛选 + 填表提示词 + 注入目标 + 附加世界书条目
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { readFileSync } from 'node:fs';

const STORAGE_KEY = 'acu_v2_ui_state';

function createSettings() {
  return {
    autoUpdateThreshold: 3,
    autoUpdateFrequency: 2,
    updateBatchSize: 2,
    maxConcurrentGroups: 1,
    skipUpdateFloors: 0,
    retainRecentLayers: 100,
    autoUpdateTokenThreshold: 500,
    tableMaxRetries: 3,
    tableEditLastPairOnly: true,
    strictJsonTableFillEnabled: false,
    discardUnauthorizedTableEditsEnabled: true,
    tableContextExtractTags: '',
    tableContextExtractRules: [{ start: '<正文>', end: '</正文>' }],
    tableContextExcludeTags: '',
    tableContextExcludeRules: [{ start: '<think>', end: '</think>' }],
    storageMode: 'native',
    charCardPrompt: [
      { role: 'SYSTEM', content: '系统段', deletable: true },
      { role: 'USER', content: '主任务', mainSlot: 'A', isMain: true, deletable: false },
      { role: 'USER', content: '数据段', mainSlot: 'B', isMain2: true, deletable: false },
    ],
  } as any;
}

async function mountTablePage(opts: {
  selectedChatPreset?: string;
  selectedGlobalPreset?: string;
  injectionCharPrimary?: string | null;
} = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ router: { activePageId: 'table' } }));

  const { ref, shallowRef, computed } = await import('vue');
  const settings = createSettings();
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));

  // —— useTableTemplatePresets（页面顶部下拉） ——
  const selectGlobalPreset = vi.fn(async () => {});
  const selectChatPreset = vi.fn(async () => {});
  const refresh = vi.fn();
  const tplExportTemplate = vi.fn(() => {});
  const importPresetForCurrentChat = vi.fn(async () => {});

  vi.doMock('../../../src/presentation-v2/composables/useChatChangedListener', () => ({
    useChatChangedListener: () => {},
    useChatChangedTick: () => ref(0),
  }));
  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: saveSettings,
  }));
  vi.doMock('../../../src/service/table/storage-mode', () => ({
    getCurrentStorageMode: () => settings.storageMode,
  }));
  vi.doMock('../../../src/presentation-v2/composables/useTableTemplatePresets', () => ({
    useTableTemplatePresets: () => {
      const selectedGlobalPreset = ref(opts.selectedGlobalPreset ?? 'global-A');
      const selectedGlobalPresetValue = ref(`global:${selectedGlobalPreset.value}`);
      const selectedChatPreset = ref(`global:${opts.selectedChatPreset ?? 'global-A'}`);
      return {
      busy: ref(false),
      message: ref(null),
      selectedGlobalPreset,
      selectedGlobalPresetValue,
      selectedChatPreset,
      selectedChatPresetLabel: ref(`${opts.selectedChatPreset ?? 'global-A'}（全局预设）`),
      isChatOverridden: computed(() => selectedChatPreset.value !== selectedGlobalPresetValue.value),
      chatPresetItems: ref([
        { value: 'global:', label: '默认预设（全局）', meta: '2 张表' },
        { value: 'global:global-A', label: 'global-A（全局预设）', meta: '2 张表' },
        { value: 'snapshot:chat-A', label: 'chat-A（当前聊天快照）', meta: '3 张表' },
      ]),
      refresh,
      selectGlobalPreset,
      selectChatPreset,
      importPresetForCurrentChat,
      exportTemplate: tplExportTemplate,
    };
    },
  }));

  // —— useTablePresetManagement（抽屉） ——
  const drawerView = ref<'closed' | 'manage'>('closed');
  const isDrawerOpen = computed(() => drawerView.value !== 'closed');
  const title = computed(() => (drawerView.value === 'manage' ? '管理表格模板预设' : ''));
  const presetMeta = ref<Array<{ name: string }>>([{ name: 'global-A' }, { name: 'global-B' }]);
  const defaultPresetName = ref('global-A');
  const message = ref<{ kind: 'success' | 'error' | 'info' | 'warning'; text: string } | null>(null);

  const openVisualizer = vi.fn(async () => {});
  const editPreset = vi.fn(async () => {});
  const setAsDefault = vi.fn(async () => {});
  const deletePreset = vi.fn(async () => {});
  const exportPresetMgmt = vi.fn(() => {});
  const renamePreset = vi.fn(async () => {});
  const createBlankPreset = vi.fn(async () => {});

  vi.doMock('../../../src/presentation-v2/composables/useTablePresetManagement', () => ({
    useTablePresetManagement: () => ({
      drawerView,
      isDrawerOpen,
      title,
      busy: ref(false),
      message,
      presetMeta,
      defaultPresetName,
      refresh: vi.fn(),
      openManage: () => { drawerView.value = 'manage'; },
      closeDrawer: () => { drawerView.value = 'closed'; },
      openVisualizer,
      editPreset,
      setAsDefault,
      deletePreset,
      exportPreset: exportPresetMgmt,
      renamePreset,
      createBlankPreset,
    }),
  }));

  // —— 注入目标 / 附加条目 / 选择器 ——
  const injectionTargetRef = ref('character');
  const injectionTargetChange = vi.fn((value: string) => {
    injectionTargetRef.value = value;
  });
  const describeInjectionTarget = vi.fn(async () =>
    injectionTargetRef.value === 'character'
      ? '角色卡绑定世界书 · CharBookT'
      : injectionTargetRef.value,
  );
  vi.doMock('../../../src/presentation-v2/composables/useFormFillInjectionTarget', () => ({
    useFormFillInjectionTarget: () => ({
      target: injectionTargetRef,
      selectorValue: computed(() => injectionTargetRef.value || 'character'),
      refreshFromSettings: vi.fn(),
      onSelectorChange: injectionTargetChange,
      describeTarget: describeInjectionTarget,
    }),
  }));

  const entriesSourceRef = ref<'character' | 'manual'>('character');
  const entriesManualSelectionRef = ref<string[]>([]);
  const setEntriesSource = vi.fn((value: 'character' | 'manual') => {
    entriesSourceRef.value = value;
  });
  const toggleEntriesManualBook = vi.fn((name: string, checked: boolean) => {
    entriesSourceRef.value = 'manual';
    entriesManualSelectionRef.value = checked
      ? [...new Set([...entriesManualSelectionRef.value, name])]
      : entriesManualSelectionRef.value.filter(item => item !== name);
  });
  vi.doMock('../../../src/presentation-v2/composables/useFormFillWorldbookConfig', () => ({
    useFormFillWorldbookConfig: () => ({
      source: entriesSourceRef,
      manualSelection: entriesManualSelectionRef,
      manualBook: computed(() => entriesManualSelectionRef.value[0] || ''),
      refreshFromSettings: vi.fn(),
      setSource: setEntriesSource,
      setManualSelection: vi.fn((names: string[]) => {
        entriesSourceRef.value = 'manual';
        entriesManualSelectionRef.value = names;
      }),
      toggleManualBook: toggleEntriesManualBook,
      resolveBookNames: vi.fn(async () =>
        entriesSourceRef.value === 'manual' ? entriesManualSelectionRef.value : ['CharBookT'],
      ),
    }),
  }));

  const groupsRef = shallowRef<any[]>([
    { bookName: 'CharBookT', expanded: true, entries: [{ uid: 1, bookName: 'CharBookT', label: '人物', checked: true, disabled: false }] },
  ]);
  vi.doMock('../../../src/presentation-v2/composables/useFormFillWorldbookEntries', () => ({
    useFormFillWorldbookEntries: () => ({
      groups: groupsRef,
      status: ref('success'),
      error: ref(''),
      loadEntries: vi.fn(async () => {}),
      toggleEntry: vi.fn(),
      selectAll: vi.fn(),
      deselectAll: vi.fn(),
      toggleGroupExpanded: vi.fn(),
    }),
  }));

  vi.doMock('../../../src/presentation-v2/composables/useWorldbookSelector', () => ({
    useWorldbookSelector: () => ({
      names: shallowRef(['CharBookT', 'Other']),
      charPrimary: ref(opts.injectionCharPrimary === undefined ? 'CharBookT' : opts.injectionCharPrimary),
      status: ref('success'),
      error: ref(''),
      refresh: vi.fn(async () => {}),
    }),
  }));
  vi.doMock('../../../src/presentation-v2/components/DanglingReferenceBanner.vue', () => ({
    default: { name: 'DanglingReferenceBanner', template: '<div class="dangling-banner-stub"></div>', props: ['scope'] },
  }));

  const mount = await import('../../../src/presentation-v2/bootstrap/mount');
  await mount.openAcuV2App();
  await new Promise(r => setTimeout(r, 0));
  return {
    mount,
    selectGlobalPreset,
    selectChatPreset,
    refresh,
    openVisualizer,
    editPreset,
    setAsDefault,
    deletePreset,
    exportPresetMgmt,
    renamePreset,
    createBlankPreset,
    importPresetForCurrentChat,
    settings,
    saveSettings,
    injectionTargetChange,
    describeInjectionTarget,
    drawerView,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TablePage', () => {
  it('注入目标面板挂载世界书失效引用标记', () => {
    const source = readFileSync('src/presentation-v2/pages/TablePage.vue', 'utf8');
    expect(source).toContain('<DanglingReferenceBanner scope="worldbook" />');
    expect(source).toContain("import DanglingReferenceBanner from '../components/DanglingReferenceBanner.vue'");
  });

  it('左右分栏：左列含附加世界书条目与提示词，右列含标签筛选与注入目标', async () => {
    const { mount } = await mountTablePage();

    const page = document.querySelector('.acu-v2-table-page');
    expect(page).not.toBeNull();
    const text = page!.textContent || '';
    expect(document.querySelector('.acu-v2-app__page-title')?.textContent || '').toContain('填表规则');
    expect(text).toContain('标签筛选');
    expect(text).toContain('填表提示词');
    expect(text).toContain('写入目标世界书');
    expect(text).toContain('附加世界书条目');
    expect(text).not.toContain('表格模板预设');
    expect(text).not.toContain('打开可视化表格编辑器');
    expect(text).not.toContain('表格工具');
    expect(page!.querySelector('.acu-v2-table-page__tool-card')).toBeNull();
    expect(text).not.toContain('立即构建交火纪要索引');
    expect(text).not.toContain('Embedding / Rerank');
    expect(Array.from(page!.querySelectorAll('button')).some(b => b.textContent?.trim() === '刷新')).toBe(false);
    expect(page!.querySelector('[data-acu-toggle-key="strictJsonTableFillEnabled"]')).toBeNull();

    const cols = page!.querySelectorAll('.acu-v2-table-page__col');
    expect(cols.length).toBe(2);
    const panelTitles = Array.from(page!.querySelectorAll('.acu-panel .acu-panel__title'))
      .map(title => (title.textContent || '').trim());
    expect(panelTitles).toEqual(['附加世界书条目', '填表提示词', '标签筛选', '写入目标世界书']);
    const mobileNavItems = Array.from(page!.querySelectorAll('.acu-mobile-panel-nav__item'))
      .map(item => (item.textContent || '').trim());
    expect(mobileNavItems).toEqual(['附加世界书条目', '提示词', '标签筛选', '写入目标世界书']);

    mount.__resetAcuV2MountForTests();
  });

  it('越权 SQL 降级开关默认开启，切换后立即保存设置', async () => {
    const { mount, settings, saveSettings } = await mountTablePage();
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-acu-setting-key="discardUnauthorizedTableEditsEnabled"]',
    );

    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('role')).toBe('switch');
    expect(toggle!.getAttribute('aria-checked')).toBe('true');

    toggle!.click();
    await nextTick();

    expect(settings.discardUnauthorizedTableEditsEnabled).toBe(false);
    expect(toggle!.getAttribute('aria-checked')).toBe('false');
    expect(saveSettings).toHaveBeenCalledTimes(1);

    mount.__resetAcuV2MountForTests();
  });

  it('关闭后重新打开 UI 会刷新当前表格页', async () => {
    const { mount, describeInjectionTarget } = await mountTablePage();

    expect(describeInjectionTarget).toHaveBeenCalledTimes(1);
    mount.closeAcuV2App();
    await mount.openAcuV2App();
    await new Promise(r => setTimeout(r, 0));

    expect(describeInjectionTarget).toHaveBeenCalledTimes(2);

    mount.__resetAcuV2MountForTests();
  });

  it('每个面板都渲染常驻说明信息条', async () => {
    const { mount } = await mountTablePage();

    const panels = Array.from(document.querySelectorAll<HTMLElement>('.acu-v2-table-page .acu-panel'));
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) {
      expect(panel.querySelector('.acu-panel__description-region .acu-info-banner')).not.toBeNull();
    }

    mount.__resetAcuV2MountForTests();
  });

  it('注入目标在未解析角色卡世界书时仍显示角色卡绑定世界书默认选项', async () => {
    const { mount } = await mountTablePage({ injectionCharPrimary: null });

    const page = document.querySelector('.acu-v2-table-page') as HTMLElement;
    const injectionPanel = page.querySelector<HTMLElement>('#table-injection-target-panel')!;
    const trigger = injectionPanel.querySelector<HTMLButtonElement>('.acu-select__trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toContain('角色卡绑定世界书');

    trigger!.click();
    await Promise.resolve();

    const labels = Array.from(injectionPanel.querySelectorAll('.acu-select__item'))
      .map(item => item.textContent?.trim());
    expect(labels).toContain('角色卡绑定世界书');
    expect(labels).toContain('CharBookT');

    mount.__resetAcuV2MountForTests();
  });

  it('附加世界书条目手动模式可以多选世界书', async () => {
    const { mount } = await mountTablePage();

    const page = document.querySelector('.acu-v2-table-page') as HTMLElement;
    const entriesPanel = page.querySelector<HTMLElement>('#table-entries-panel')!;
    const manualButton = Array.from(entriesPanel.querySelectorAll<HTMLButtonElement>('.acu-segmented__item'))
      .find(button => button.textContent?.trim() === '手动选择')!;
    manualButton.click();
    await Promise.resolve();

    const checkboxes = Array.from(entriesPanel.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]'));
    const charBook = checkboxes.find(button => button.textContent?.trim() === 'CharBookT')!;
    const other = checkboxes.find(button => button.textContent?.trim() === 'Other')!;
    charBook.click();
    other.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(entriesPanel.textContent).toContain('目前已选: CharBookT、Other');
    expect(charBook.getAttribute('aria-checked')).toBe('true');
    expect(other.getAttribute('aria-checked')).toBe('true');

    mount.__resetAcuV2MountForTests();
  });

  it('切换注入目标世界书后立即刷新目前已选提示', async () => {
    const { mount, injectionTargetChange, describeInjectionTarget } = await mountTablePage();

    const page = document.querySelector('.acu-v2-table-page') as HTMLElement;
    const injectionPanel = page.querySelector<HTMLElement>('#table-injection-target-panel')!;
    expect(injectionPanel.textContent).toContain('目前已选: 角色卡绑定世界书 · CharBookT');

    const trigger = injectionPanel.querySelector<HTMLButtonElement>('.acu-select__trigger')!;
    trigger.click();
    await Promise.resolve();
    (Array.from(injectionPanel.querySelectorAll('.acu-select__item'))
      .find(item => item.textContent?.trim() === 'Other') as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(injectionTargetChange).toHaveBeenCalledWith('Other');
    expect(describeInjectionTarget).toHaveBeenCalledTimes(2);
    expect(injectionPanel.textContent).toContain('目前已选: Other');

    mount.__resetAcuV2MountForTests();
  });

});
