/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';

import { useChatChangedListener, useChatMutationTick } from '../../../src/presentation-v2/composables/useChatChangedListener';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

function createEventSource() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    }),
    removeListener: vi.fn((name: string, listener: (...args: unknown[]) => void) => { listeners.get(name)?.delete(listener); }),
    emit: (name: string, ...args: unknown[]) => { for (const listener of listeners.get(name) ?? []) listener(...args); },
    count: (name: string) => listeners.get(name)?.size ?? 0,
  };
}

function mountListener() {
  const host = defineComponent({ setup() { useChatChangedListener(); return () => h('div'); } });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(host);
  app.mount(el);
  return app;
}

beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); _set_SillyTavern_API_ACU(undefined); });

describe('useChatChangedListener · 楼层变动计数', () => {
  it('删楼与 swipe 事件聚合成一次楼层变动计数，卸载后退订', async () => {
    const eventSource = createEventSource();
    _set_SillyTavern_API_ACU({ eventSource, eventTypes: { CHAT_CHANGED: 'chat_changed', MESSAGE_DELETED: 'message_deleted', MESSAGE_SWIPED: 'message_swiped' } } as any);
    const tick = useChatMutationTick();
    const before = tick.value;
    const app = mountListener();

    // 批量删楼会连发多次事件：防抖窗口内只算一次。
    eventSource.emit('message_deleted', 5);
    eventSource.emit('message_deleted', 4);
    eventSource.emit('message_swiped', 3);
    expect(tick.value).toBe(before);
    await vi.advanceTimersByTimeAsync(300);
    expect(tick.value).toBe(before + 1);

    app.unmount();
    expect(eventSource.count('message_deleted')).toBe(0);
    expect(eventSource.count('message_swiped')).toBe(0);
    eventSource.emit('message_deleted', 2);
    await vi.advanceTimersByTimeAsync(300);
    expect(tick.value).toBe(before + 1);
  });

  it('宿主未暴露楼层事件名时只订阅聊天切换，不报错', () => {
    const eventSource = createEventSource();
    _set_SillyTavern_API_ACU({ eventSource, eventTypes: { CHAT_CHANGED: 'chat_changed' } } as any);
    const app = mountListener();
    expect(eventSource.on).toHaveBeenCalledTimes(1);
    expect(eventSource.on).toHaveBeenCalledWith('chat_changed', expect.any(Function));
    app.unmount();
  });
});
