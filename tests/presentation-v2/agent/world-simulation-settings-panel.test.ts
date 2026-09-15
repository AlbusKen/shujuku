/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function mountPanel(saveResult: unknown = { saved: true, storageType: 'tavern' }) {
  vi.resetModules();
  document.body.innerHTML = '';
  const settings: any = { apiPresets: [], apiPresetBindingsByChat: {}, apiMode: 'custom', apiConfig: { url: '', model: '' }, defaultApiPresetName: '', streamingEnabled: false, tavernProfile: '' };
  const persist = vi.fn(() => saveResult);
  vi.doMock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: settings, currentChatFileIdentifier_ACU: 'test-chat' }));
  vi.doMock('../../../src/service/settings/api-preset-service', async importOriginal => ({
    ...(await importOriginal()),
    ensureApiSettingsShape_ACU: () => {},
  }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: persist }));
  const { createApp, defineComponent, nextTick } = await import('vue');
  const { createPinia } = await import('pinia');
  const Panel = (await import('../../../src/presentation-v2/components/WorldSimulationSettingsPanel.vue')).default;
  const received = vi.fn();
  const Root = defineComponent({ components: { Panel }, setup: () => ({ received }), template: '<Panel @saved="received" />' });
  const el = document.createElement('div'); document.body.appendChild(el);
  const app = createApp(Root); app.use(createPinia()); app.mount(el); await nextTick();
  return { app, el, settings, persist, received, nextTick };
}

async function flushSave(nextTick: () => Promise<void>): Promise<void> {
  // The strict path lazy-imports settings-service, then awaits its save result.
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await nextTick();
}

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('WorldSimulationSettingsPanel', () => {
  it('mounts protected engine seams, allows editing their guidance shell, and saves only explicitly', async () => {
    const { app, el, settings, received, nextTick } = await mountPanel();
    expect(settings.worldSimulation).toBeUndefined();
    expect(el.textContent).toContain('四角色提示词（引擎协议受保护）');
    expect(el.textContent).toContain('主 Agent（world-director）');
    expect(el.textContent).toContain('实体子代理（entity-movement）');
    expect(el.textContent).toContain('事件子代理（faction-events）');
    expect(el.textContent).toContain('线索子代理（thread-weaver）');
    // The shell text remains editable, while the placeholder seam itself stays present.
    const textareas = el.querySelectorAll<HTMLTextAreaElement>('.world-simulation-settings__prompt-agent textarea');
    expect(textareas.length).toBeGreaterThan(4);
    // The first segment is the guided world charter: editable body containing the placeholder token.
    const first = textareas[0]!;
    expect(first.value).toContain('$WORLD_SIMULATION_ROOT');
    expect(first.value).toContain('世界推演核心宪章');
    first.value = '自定义宪章引导：\n$WORLD_SIMULATION_ROOT';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(settings.worldSimulation).toBeUndefined();

    const save = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '保存世界推演设置');
    save!.click(); await flushSave(nextTick);
    expect(settings.worldSimulation.agentPrompts['world-director'].some((segment: any) => segment.content === '自定义宪章引导：\n$WORLD_SIMULATION_ROOT')).toBe(true);
    expect(settings.worldSimulation.agentPrompts['world-director'][0].content).toContain('$WORLD_SIMULATION_ROOT');
    expect(settings.worldSimulation.agentGuidance).toBeUndefined();
    expect(received).toHaveBeenCalledTimes(1);
    app.unmount();
  });

  it('locks engine segment role, enabled state, deletion and ordering', async () => {
    const { app, el, settings, nextTick } = await mountPanel();
    const agentSection = el.querySelector('.world-simulation-settings__prompt-agent')!;
    const firstItem = agentSection.querySelector('.acu-prompt-segs__item')!;
    expect(firstItem.querySelector<HTMLButtonElement>('[role="checkbox"]')?.disabled).toBe(true);
    expect(firstItem.querySelector<HTMLButtonElement>('.acu-select__trigger')?.disabled).toBe(true);
    expect(firstItem.querySelector<HTMLButtonElement>('.acu-icon-btn--danger')?.disabled).toBe(true);
    const moveButtons = firstItem.querySelectorAll<HTMLButtonElement>('.acu-icon-btn');
    expect(Array.from(moveButtons).every(button => button.disabled)).toBe(true);
    expect(settings.worldSimulation).toBeUndefined();

    const save = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '保存世界推演设置');
    save!.click(); await flushSave(nextTick);
    const director = settings.worldSimulation.agentPrompts['world-director'];
    expect(director[0]).toMatchObject({ role: 'system', enabled: true, deletable: false, content: expect.stringContaining('$WORLD_SIMULATION_ROOT') });
    expect(director.at(-1)).toMatchObject({ role: 'system', enabled: true, deletable: false, content: expect.stringContaining('$WORLD_SIMULATION_EXECUTION_BOUNDARY') });
    expect(settings.worldSimulation.agentGuidance).toBeUndefined();
    app.unmount();
  });

  it('persists the explicit read/search switch only after the user saves the local draft', async () => {
    const { app, el, settings, nextTick } = await mountPanel();
    expect(el.textContent).toContain('允许 Agent 使用 read/search');
    const switches = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
    expect(switches).toHaveLength(2);
    switches[1]!.click(); await nextTick();
    expect(settings.worldSimulation).toBeUndefined();
    const save = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '保存世界推演设置');
    save!.click(); await flushSave(nextTick);
    expect(settings.worldSimulation.toolsEnabled).toBe(false);
    app.unmount();
  });

  it('exports and imports only a complete prompt-segment configuration into the local draft', async () => {
    const { app, el, settings, nextTick } = await mountPanel();
    const exportButton = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '导出到文本');
    exportButton!.click(); await nextTick();
    const transfer = el.querySelector<HTMLTextAreaElement>('.world-simulation-settings__prompt-transfer textarea');
    expect(transfer?.value).toContain('world-director');
    transfer!.value = '{"world-director":[]}';
    transfer!.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
    const importButton = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '从文本导入');
    importButton!.click(); await nextTick();
    expect(el.textContent).toContain('导入失败');
    expect(settings.worldSimulation).toBeUndefined();
    app.unmount();
  });

  it('shows persistence failure, restores the old snapshot, and does not emit saved', async () => {
    const { app, el, settings, received, nextTick } = await mountPanel({ saved: false, storageType: 'memory' });
    const toggle = el.querySelector<HTMLButtonElement>('[role="switch"]');
    toggle!.click(); await nextTick();
    const save = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '保存世界推演设置');
    save!.click(); await flushSave(nextTick);
    expect(el.textContent).toContain('设置持久化失败，已恢复保存前的配置。');
    expect(settings.worldSimulation).toBeUndefined();
    expect(received).not.toHaveBeenCalled();
    app.unmount();
  });
});
