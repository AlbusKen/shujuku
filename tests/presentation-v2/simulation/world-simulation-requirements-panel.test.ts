/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import WorldSimulationRequirementsPanel from '../../../src/presentation-v2/components/WorldSimulationRequirementsPanel.vue';

const mounted: Array<() => void> = [];
afterEach(() => { for (const unmount of mounted.splice(0)) unmount(); });

function mountRequirements() {
  const data = ref({ snapshot: { schemaVersion: 1 as const, requirements: ['原有要求'], updatedAt: 2 }, diagnostics: [] as string[], adoptedIndex: null });
  const chatIdentity = ref('chat-a');
  const busy = ref(false);
  const save = vi.fn(async (_requirements: string[]) => true);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ setup: () => () => h(WorldSimulationRequirementsPanel, {
    chatIdentity: chatIdentity.value, userRequirements: data.value, saveRequirements: save, busy: busy.value,
  }) });
  app.mount(host);
  mounted.push(() => { app.unmount(); host.remove(); });
  const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))!;
  const edit = async (text: string) => {
    const input = host.querySelector('textarea')!;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  };
  return { host, data, chatIdentity, busy, save, button, edit };
}

describe('独立的格林用户要求面板', () => {
  it('提交修剪后的数组；保存后旧快照不回滚，新快照可同步', async () => {
    const view = mountRequirements();
    await view.edit('  更新要求  ');
    view.button('保存用户要求').click();
    await nextTick();
    await nextTick();
    expect(view.save).toHaveBeenCalledWith(['更新要求']);
    expect(view.host.querySelector('textarea')!.value).toBe('更新要求');
    view.data.value = structuredClone({ snapshot: { schemaVersion: 1, requirements: ['原有要求'], updatedAt: 2 }, diagnostics: [], adoptedIndex: null });
    await nextTick();
    expect(view.host.querySelector('textarea')!.value).toBe('更新要求');
    view.data.value = { snapshot: { schemaVersion: 1, requirements: ['更新要求'], updatedAt: 3 }, diagnostics: [], adoptedIndex: null };
    await nextTick();
    expect(view.host.querySelector('textarea')!.value).toBe('更新要求');
    expect(view.host.textContent).not.toContain('字符串数组');
  });

  it('保存失败保留草稿，空条目不提交，放弃修改恢复原值', async () => {
    const view = mountRequirements();
    view.save.mockResolvedValue(false);
    await view.edit('保留草稿');
    view.button('保存用户要求').click();
    await nextTick();
    await nextTick();
    expect(view.host.textContent).toContain('保存失败');
    expect(view.host.querySelector('textarea')!.value).toBe('保留草稿');
    await view.edit('  ');
    view.button('保存用户要求').click();
    await nextTick();
    expect(view.save).toHaveBeenCalledOnce();
    expect(view.host.textContent).toContain('每条要求不能为空');
    view.button('放弃修改').click();
    await nextTick();
    expect(view.host.querySelector('textarea')!.value).toBe('原有要求');
  });

  it('刷新不覆盖未保存草稿，切换聊天会重建草稿', async () => {
    const view = mountRequirements();
    await view.edit('当前聊天草稿');
    view.data.value = { snapshot: { schemaVersion: 1, requirements: ['刷新内容'], updatedAt: 3 }, diagnostics: [], adoptedIndex: null };
    await nextTick();
    expect(view.host.querySelector('textarea')!.value).toBe('当前聊天草稿');
    view.chatIdentity.value = 'chat-b';
    view.data.value = { snapshot: { schemaVersion: 1, requirements: ['另一个聊天'], updatedAt: 1 }, diagnostics: [], adoptedIndex: null };
    await nextTick();
    expect(view.host.querySelector('textarea')!.value).toBe('另一个聊天');
  });

  it('诊断或忙碌时禁用编辑，错误仍显示在独立面板', async () => {
    const view = mountRequirements();
    view.data.value.diagnostics = ['要求资料读取失败'];
    await nextTick();
    expect(view.host.textContent).toContain('要求资料读取失败');
    expect(view.host.querySelector('textarea')!.disabled).toBe(true);
    view.data.value.diagnostics = [];
    view.busy.value = true;
    await nextTick();
    expect(view.host.querySelector('textarea')!.disabled).toBe(true);
  });
});
