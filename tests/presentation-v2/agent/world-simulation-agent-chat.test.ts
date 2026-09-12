/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function mountChat(running = false, committing = false, stopResult: 'idle' | 'aborted' | 'committing' | 'committed' = 'aborted', submitResult: 'started' | 'started_with_audit_warning' | 'queued' = 'started') {
  vi.resetModules();
  document.body.innerHTML = '';
  const runtime = {
    isAgentSessionRunning: vi.fn(() => running),
    isAgentSessionCommitting: vi.fn(() => committing),
    submitAgentMessage: vi.fn(async () => submitResult),
    stopAgentSession: vi.fn(() => stopResult),
  };
  const read = vi.fn(() => ({ messages: [], invalidMessageIndexes: [] }));
  vi.doMock('../../../src/service/simulation/simulation-runtime-registry', () => ({ getWorldSimulationRuntime_ACU: () => runtime }));
  vi.doMock('../../../src/service/simulation/world-simulation-agent-conversation', () => ({
    readWorldSimulationConversationTimelineWithDiagnostics_ACU: read,
    subscribeWorldSimulationConversation_ACU: () => () => {},
  }));
  vi.doMock('../../../src/presentation-v2/composables/useChatChangedListener', async () => {
    const { ref } = await import('vue');
    return { useChatChangedTick: () => ref(0) };
  });
  const { createApp, nextTick } = await import('vue');
  const Chat = (await import('../../../src/presentation-v2/components/WorldSimulationAgentChat.vue')).default;
  const el = document.createElement('div'); document.body.appendChild(el);
  const app = createApp(Chat); app.mount(el); await nextTick();
  return { app, el, runtime, read, nextTick };
}

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.resetModules(); });

describe('WorldSimulationAgentChat', () => {
  it('mounts read-only, then sends a trimmed request only after explicit user action', async () => {
    const { app, el, runtime, read, nextTick } = await mountChat();
    expect(read).toHaveBeenCalledTimes(1);
    expect(runtime.submitAgentMessage).not.toHaveBeenCalled();
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea');
    textarea!.value = '  推进港口局势  ';
    textarea!.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
    const send = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '发送');
    send!.click(); await Promise.resolve(); await nextTick();
    expect(runtime.submitAgentMessage).toHaveBeenCalledWith('推进港口局势');
    expect(el.textContent).toContain('请求已提交给世界推演 Agent。');
    app.unmount();
  });

  it('only exposes stop while the session is running and forwards the explicit stop action', async () => {
    const { app, el, runtime } = await mountChat(true);
    expect(Array.from(el.querySelectorAll('button')).map(button => button.textContent?.trim())).toContain('停止');
    const stop = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '停止');
    stop!.click();
    expect(runtime.stopAgentSession).toHaveBeenCalledTimes(1);
    expect(runtime.submitAgentMessage).not.toHaveBeenCalled();
    app.unmount();
  });

  it('reports an already-entered strict save as non-cancellable instead of promising a rollback', async () => {
    const { app, el, runtime, nextTick } = await mountChat(true, true, 'committing');
    expect(el.textContent).toContain('世界账本严格保存中');
    const stop = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '停止');
    stop!.click(); await nextTick();
    expect(runtime.stopAgentSession).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('世界账本严格保存已开始，无法取消；正在等待联合保存完成。');
    app.unmount();
  });

  it('reports a committed ledger with audit warning without inviting a duplicate business retry', async () => {
    const { app, el, runtime, nextTick } = await mountChat(false, false, 'committed', 'started_with_audit_warning');
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea');
    textarea!.value = '推进港口局势';
    textarea!.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
    const send = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '发送');
    send!.click(); await Promise.resolve(); await nextTick();
    expect(runtime.submitAgentMessage).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('世界账本已联合提交，但会话审计同步失败；不要重复发送同一请求。');
    app.unmount();
  });
});
