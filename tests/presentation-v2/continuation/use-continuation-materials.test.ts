/**
 * useContinuationMaterials — 资料快照的重读与草稿保护
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { buildEmptyAgentModuleSnapshot_ACU } from '../../../src/service/continuation/agent/agent-module-store';
import { AGENT_MODULE_FIELD_ACU } from '../../../src/service/continuation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

function snapshotWithHooks_ACU(count: number) {
  return {
    ...buildEmptyAgentModuleSnapshot_ACU(),
    settledThroughIndex: 0,
    hooks: Array.from({ length: count }, (_item, index) => ({
      id: `H${index + 1}`, summary: `伏笔 ${index + 1}`, status: 'planted', importance: 'mid', plantedIndex: 0, updatedIndex: 0, plannedPayoff: '', retired: false, retiredReason: '',
    })),
  };
}

describe('useContinuationMaterials', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reload 默认全量重置草稿；preserveDirty 只刷新未编辑的模块，用户正在改的 JSON 不被冲掉', async () => {
    const chat: any[] = [{ mes: '正文', is_user: false, [AGENT_MODULE_FIELD_ACU]: snapshotWithHooks_ACU(1) }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
    const { useContinuationMaterials } = await import('../../../src/presentation-v2/composables/useContinuationMaterials');
    const materials = useContinuationMaterials();
    materials.reload();
    expect(materials.snapshot.value?.hooks).toHaveLength(1);
    expect(materials.modules.hooks.draft).toContain('"H1"');

    // 用户开始编辑伏笔草稿；与此同时 Agent 把新快照写到了楼层上。
    materials.updateDraft('hooks', '[{"id":"H-user","summary":"我正在写"}]');
    chat[0][AGENT_MODULE_FIELD_ACU] = snapshotWithHooks_ACU(3);

    materials.reload({ preserveDirty: true });
    expect(materials.snapshot.value?.hooks).toHaveLength(3);
    expect(materials.modules.hooks.dirty).toBe(true);
    expect(materials.modules.hooks.draft).toBe('[{"id":"H-user","summary":"我正在写"}]');
    // 没在编辑的模块照常跟着新快照刷新。
    expect(materials.modules.infoGap.dirty).toBe(false);

    materials.reload();
    expect(materials.modules.hooks.dirty).toBe(false);
    expect(materials.modules.hooks.draft).toContain('"H3"');
  });
});
