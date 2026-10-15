/**
 * WorldbookSelector — 世界书下拉选项
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, nextTick } from 'vue';
import WorldbookSelector from '../../../src/presentation-v2/components/WorldbookSelector.vue';
import WorldbookSourcePicker from '../../../src/presentation-v2/components/WorldbookSourcePicker.vue';
import WorldbookEntryPickerBody from '../../../src/presentation-v2/components/WorldbookEntryPickerBody.vue';
import { useWorldbookSelector } from '../../../src/presentation-v2/composables/useWorldbookSelector';

const reads = vi.hoisted(() => ({ list: vi.fn(), primary: vi.fn() }));
const scope = vi.hoisted(() => ({
  chat: [{}] as unknown[], chatId: 'chat-a', characterKey: 'char:a.png', characterId: '0',
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({ getWorldbookNames_ACU: reads.list }));
vi.mock('../../../src/service/worldbook/worldbook-service', () => ({ getCurrentCharPrimaryLorebook_ACU: reads.primary }));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({ getChatArray_ACU: () => scope.chat }));
vi.mock('../../../src/data/gateways/host-state-gateway', () => ({
  getCurrentCharacterCardKey_ACU: () => scope.characterKey,
  getCurrentCharacterId_ACU: () => scope.characterId,
}));
vi.mock('../../../src/data/storage/chat-history', () => ({
  getActiveChatStorageIdentity_ACU: () => scope.chatId,
}));
beforeEach(() => {
  reads.list.mockReset().mockResolvedValue([]);
  reads.primary.mockReset().mockResolvedValue(null);
  scope.chat = [{}];
  scope.chatId = 'chat-a';
  scope.characterKey = 'char:a.png';
  scope.characterId = '0';
});

interface Mounted {
  app: App<Element>;
  el: HTMLElement;
}

const mounted: Mounted[] = [];

function mountSelector(props: Partial<InstanceType<typeof WorldbookSelector>['$props']> = {}) {
  const wrapper = defineComponent({
    setup() {
      return () => h(WorldbookSelector, {
        modelValue: 'character',
        names: ['world-A'],
        charPrimary: null,
        status: 'success',
        error: '',
        ...props,
      });
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  mounted.push({ app, el });
  return el;
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

describe('WorldbookSelector', () => {
  it('调用方显式要求时，未解析出角色卡主世界书也显示 character 选项', async () => {
    const el = mountSelector({
      showCharacterOption: true,
      characterFallbackLabel: '当前角色卡所有世界书',
    });

    const trigger = el.querySelector<HTMLButtonElement>('.acu-select__trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toContain('当前角色卡所有世界书');

    trigger!.click();
    await Promise.resolve();

    const labels = Array.from(el.querySelectorAll('.acu-select__item')).map(item => item.textContent?.trim());
    expect(labels).toContain('当前角色卡所有世界书');
    expect(labels).toContain('world-A');
  });
});

describe('世界书读取失败与恢复', () => {
  it.each(['list', 'primary', 'both'] as const)('%s 失败保留错误，不发布部分结果，重试可恢复', async (source) => {
    const selector = useWorldbookSelector();
    reads.list.mockResolvedValue(['old-book']);
    reads.primary.mockResolvedValue('old-book');
    await selector.refresh();
    const failure = new Error('世界书读取失败');
    reads.list.mockResolvedValue(['partial-book']);
    reads.primary.mockResolvedValue('partial-book');
    if (source !== 'primary') reads.list.mockRejectedValue(failure);
    if (source !== 'list') reads.primary.mockRejectedValue(failure);
    const failed = selector.refresh();
    expect(selector.status.value).toBe('loading');
    await failed;
    expect(selector.status.value).toBe('error');
    expect(selector.error.value).toBe('世界书读取失败');
    expect(selector.names.value).toEqual(['old-book']);
    expect(selector.charPrimary.value).toBe('old-book');
    reads.list.mockResolvedValue(['new-book']);
    reads.primary.mockResolvedValue('new-book');
    const retry = selector.refresh();
    expect(selector.error.value).toBe('');
    expect(selector.status.value).toBe('loading');
    await retry;
    expect(selector.status.value).toBe('success');
    expect(selector.error.value).toBe('');
    expect(selector.names.value).toEqual(['new-book']);
    expect(selector.charPrimary.value).toBe('new-book');
  });

  it('首次加载失败不会伪装成成功空列表，合法空列表仍成功', async () => {
    const selector = useWorldbookSelector();
    reads.list.mockRejectedValueOnce(new Error('列表读取失败'));
    await selector.refresh();
    expect(selector.status.value).toBe('error');
    expect(selector.error.value).toBe('列表读取失败');
    expect(selector.names.value).toEqual([]);
    await selector.refresh();
    expect(selector.status.value).toBe('success');
    expect(selector.error.value).toBe('');
    expect(selector.names.value).toEqual([]);
    expect(selector.charPrimary.value).toBeNull();
  });

  it('下拉选择器显示错误，点击重试不修改原选择', async () => {
    const retry = vi.fn();
    const changed = vi.fn();
    const el = mountSelector({ status: 'error', error: '列表读取失败', onRetry: retry, 'onUpdate:modelValue': changed });
    expect(el.textContent).toContain('列表读取失败');
    const button = Array.from(el.querySelectorAll('button')).find(item => item.textContent?.includes('重试加载世界书'))!;
    expect(button).toBeDefined();
    button.click();
    await nextTick();
    expect(retry).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['source', 'entries'] as const)('%s 选择器显示真实读取错误，重试接回 composable', async (kind) => {
    const selector = useWorldbookSelector();
    reads.list.mockRejectedValueOnce(new Error('列表读取失败'));
    await selector.refresh();
    let retryTask: Promise<void> | undefined;
    const retry = () => { retryTask = selector.refresh(); };
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(defineComponent({ setup: () => () => {
      const shared = { source: 'manual' as const, selectedNames: [], names: selector.names.value, onRetry: retry };
      return kind === 'source'
        ? h(WorldbookSourcePicker, { ...shared, status: selector.status.value, error: selector.error.value })
        : h(WorldbookEntryPickerBody, { ...shared, selectorStatus: selector.status.value, selectorError: selector.error.value,
          currentLabel: '', filter: '', groups: [], loading: false });
    } }));
    app.mount(el);
    mounted.push({ app, el });
    expect(el.textContent).toContain('列表读取失败');
    expect(el.querySelector('.acu-v2-wb-source-picker__empty')).toBeNull();
    reads.list.mockResolvedValue(['recovered-book']);
    const button = Array.from(el.querySelectorAll('button')).find(item => item.textContent?.includes('重试加载世界书'))!;
    button.click();
    await retryTask;
    await nextTick();
    expect(selector.status.value).toBe('success');
    expect(el.textContent).toContain('recovered-book');
    expect(el.textContent).not.toContain('列表读取失败');
    expect(el.textContent).not.toContain('重试加载世界书');
    expect(reads.list).toHaveBeenCalledTimes(2);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function selectorState(selector: ReturnType<typeof useWorldbookSelector>) {
  return {
    names: [...selector.names.value], charPrimary: selector.charPrimary.value,
    status: selector.status.value, error: selector.error.value,
  };
}

describe('世界书刷新代次与作用域', () => {
  it.each(['success', 'error'] as const)('旧请求迟到 %s 不覆盖新请求的成功结果', async (outcome) => {
    const old = deferred<string | null>();
    reads.list.mockResolvedValueOnce(['old-book']).mockResolvedValueOnce(['new-book']);
    reads.primary.mockReturnValueOnce(old.promise).mockResolvedValueOnce('new-book');
    const selector = useWorldbookSelector();
    const first = selector.refresh();
    scope.chat = [{}];
    scope.chatId = 'chat-b';
    scope.characterKey = 'char:b.png';
    await selector.refresh();
    const latest = selectorState(selector);
    expect(latest).toEqual({ names: ['new-book'], charPrimary: 'new-book', status: 'success', error: '' });
    if (outcome === 'success') old.resolve('old-book');
    else old.reject(new Error('旧请求失败'));
    await first;
    expect(selectorState(selector)).toEqual(latest);
  });

  it('同一作用域中旧成功不能覆盖最新失败', async () => {
    const old = deferred<string | null>();
    reads.list.mockResolvedValue(['old-book']);
    reads.primary.mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('最新请求失败'));
    const selector = useWorldbookSelector();
    const first = selector.refresh();
    await selector.refresh();
    const latest = selectorState(selector);
    expect(latest).toEqual({ names: [], charPrimary: null, status: 'error', error: '最新请求失败' });
    old.resolve('old-book');
    await first;
    expect(selectorState(selector)).toEqual(latest);
  });

  it('快速连续刷新：过期成功和失败均不能结束最新请求的 loading', async () => {
    const requests = [deferred<string | null>(), deferred<string | null>(), deferred<string | null>()];
    reads.list.mockResolvedValueOnce(['first']).mockResolvedValueOnce(['second']).mockResolvedValueOnce(['third']);
    requests.forEach(request => reads.primary.mockReturnValueOnce(request.promise));
    const selector = useWorldbookSelector();
    const tasks = requests.map(() => selector.refresh());
    requests[1].reject(new Error('过期失败'));
    await tasks[1];
    requests[0].resolve('first');
    await tasks[0];
    expect(selectorState(selector)).toEqual({ names: [], charPrimary: null, status: 'loading', error: '' });
    requests[2].resolve('third');
    await tasks[2];
    expect(selectorState(selector)).toEqual({ names: ['third'], charPrimary: 'third', status: 'success', error: '' });
  });

  it.each(['chat', 'chatId', 'characterKey', 'characterId', 'group'] as const)(
    '%s 改变且尚未触发下一次刷新时，也不发布旧作用域结果', async (field) => {
      const old = deferred<string | null>();
      reads.list.mockResolvedValue(['old-book']);
      reads.primary.mockReturnValueOnce(old.promise);
      const selector = useWorldbookSelector();
      const task = selector.refresh();
      const before = selectorState(selector);
      if (field === 'chat') scope.chat = [{}];
      else if (field === 'group') scope.characterKey = 'group:42';
      else scope[field] = 'changed';
      old.resolve('old-book');
      await task;
      expect(selectorState(selector)).toEqual(before);
      reads.list.mockResolvedValue(['current-book']);
      reads.primary.mockResolvedValue('current-book');
      await selector.refresh();
      expect(selector.charPrimary.value).toBe('current-book');
      expect(selector.status.value).toBe('success');
    },
  );

  it('离开聊天作用域后迟到失败不发布错误状态', async () => {
    const old = deferred<string[]>();
    reads.list.mockReturnValueOnce(old.promise);
    const selector = useWorldbookSelector();
    const task = selector.refresh();
    const before = selectorState(selector);
    scope.chatId = 'chat-b';
    old.reject(new Error('旧聊天错误'));
    await task;
    expect(selectorState(selector)).toEqual(before);
  });

  it.each(['success', 'error'] as const)('组件卸载后迟到 %s 不发布，保留的 refresh 引用也不再发请求', async (outcome) => {
    const old = deferred<string | null>();
    reads.list.mockResolvedValue(['old-book']);
    reads.primary.mockReturnValueOnce(old.promise);
    let selector!: ReturnType<typeof useWorldbookSelector>;
    const el = document.createElement('div');
    const app = createApp(defineComponent({ setup() {
      selector = useWorldbookSelector();
      return () => h('div');
    } }));
    app.mount(el);
    const task = selector.refresh();
    const before = selectorState(selector);
    app.unmount();
    if (outcome === 'success') old.resolve('old-book');
    else old.reject(new Error('卸载后的旧请求失败'));
    await task;
    expect(selectorState(selector)).toEqual(before);
    await selector.refresh();
    expect(reads.list).toHaveBeenCalledOnce();
    expect(reads.primary).toHaveBeenCalledOnce();
  });
});
