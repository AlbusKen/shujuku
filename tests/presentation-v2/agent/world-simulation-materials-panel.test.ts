/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function mountPanel() {
  vi.resetModules();
  document.body.innerHTML = '';
  const { ref, reactive, createApp, defineComponent, nextTick } = await import('vue');
  const snapshot = ref<any>({ anchorMessageIndex: 4, storyClock: { anchorText: '港口封锁后的清晨', elapsedSinceLastRun: '隔夜', precision: 'approximate' }, entities: [{ id: 'E1', kind: 'character', name: '密探', situation: '藏身码头', agenda: '观察巡逻', lastMovedIndex: 4, lastMovedAt: '昨夜', updatedIndex: 4, visibility: { mode: 'hidden' }, retired: false }], events: [{ id: 'V1', summary: '港口实施临时宵禁', occurredAt: '昨夜', occurredIndex: 4, actorIds: ['E1'], consequenceHint: '商路受阻', updatedIndex: 4, visibility: { mode: 'rumored' }, retired: false }], threads: [{ id: 'T1', title: '密探的密道线索', summary: '仍待核验', status: 'active', relatedEventIds: ['V1'], expectedSurfaceHint: '通过船夫传闻', updatedIndex: 4, visibility: { mode: 'hidden' }, retired: false }], revisions: { entities: 2, events: 3, threads: 1 } });
  const materials = { snapshot, baseline: ref<any>({ anchorMessageIndex: 4, swipe: { messageKey: 'ai-5', swipeIndex: 0 } }), requirementsBaseline: ref<any>({ requirements: [{ id: 'R1', category: 'prohibition', priority: 'hard', text: '不得伪造正文事实', sourceRefs: ['user:5'] }] }), diagnostics: ref<any>({ checkpointId: 'CP-4', checkpointMessageIndex: 4, deltaMessageIndices: [4], branchReparsed: false }), loadError: ref(''), modules: reactive<any>({ entities: { draft: '[]', dirty: false, saving: false, error: '' }, events: { draft: '[]', dirty: false, saving: false, error: '' }, threads: { draft: '[]', dirty: false, saving: false, error: '' } }), requirements: reactive<any>({ draft: '[]', dirty: false, saving: false, error: '' }), reload: vi.fn(), updateDraft: vi.fn(), updateRequirementsDraft: vi.fn(), discard: vi.fn(), discardRequirements: vi.fn(), save: vi.fn(), saveRequirements: vi.fn() };
  vi.doMock('../../../src/presentation-v2/composables/useWorldSimulationMaterials', () => ({ useWorldSimulationMaterials: () => materials, WORLD_SIMULATION_MATERIAL_MODULES_ACU: ['entities', 'events', 'threads'], WORLD_SIMULATION_MATERIAL_MODULE_LABELS_ACU: { entities: '实体', events: '事件', threads: '线索' } }));
  const Panel = (await import('../../../src/presentation-v2/components/WorldSimulationMaterialsPanel.vue')).default;
  const el = document.createElement('div'); document.body.appendChild(el);
  const app = createApp(defineComponent({ components: { Panel }, template: '<Panel :refresh-tick="0" />' })); app.mount(el); await nextTick();
  return { app, el, nextTick };
}

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('WorldSimulationMaterialsPanel', () => {
  it('renders world-state cards and requirement cards before exposing advanced JSON editing', async () => {
    const { app, el, nextTick } = await mountPanel();
    expect(el.textContent).toContain('世界状态修订');
    expect(el.textContent).toContain('密探 · 藏身码头');
    expect(el.textContent).toContain('港口实施临时宵禁');
    expect(el.textContent).toContain('密探的密道线索');
    expect(el.textContent).toContain('高级编辑：原始 JSON');
    const requirements = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '当前要求');
    requirements!.click(); await nextTick();
    expect(el.textContent).toContain('不得伪造正文事实');
    expect(el.textContent).toContain('硬约束');
    expect(el.textContent).toContain('高级编辑：当前要求 JSON');
    app.unmount();
  });
});
