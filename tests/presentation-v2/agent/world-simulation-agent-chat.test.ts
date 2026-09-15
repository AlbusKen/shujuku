/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetWorldSimulationSessionLogForTests_ACU } from '../../../src/service/simulation/world-simulation-agent-session-log';

async function mountChat(running = false, committing = false, interruptResult: 'started' | 'started_with_audit_warning' | 'queued_after_abort' | 'queued_after_flight' | 'queued_after_commit' = 'queued_after_abort', submitResult: 'started' | 'started_with_audit_warning' | 'queued' = 'started') {
  vi.resetModules();
  document.body.innerHTML = '';
  const runtime = {
    isAgentSessionRunning: vi.fn(() => running),
    isAgentSessionCommitting: vi.fn(() => committing),
    submitAgentMessage: vi.fn(async () => submitResult),
    isAutomaticFlightRunning: vi.fn(() => false),
    isAutomaticFlightCommitting: vi.fn(() => false),
    interruptAndMaintain: vi.fn(async () => interruptResult),
  };
  const read = vi.fn(() => ({ messages: [], invalidMessageIndexes: [] }));
  vi.doMock('../../../src/service/simulation/simulation-runtime-registry', () => ({ getWorldSimulationRuntime_ACU: () => runtime }));
  vi.doMock('../../../src/service/simulation/world-simulation-agent-conversation', () => ({
    readWorldSimulationConversationTimelineWithDiagnostics_ACU: read,
    subscribeWorldSimulationConversation_ACU: () => () => {},
  }));
  vi.doMock('../../../src/presentation-v2/composables/useChatChangedListener', async () => {
    const { ref } = await import('vue');
    return { useChatChangedTick: () => ref(0), useChatMutationTick: () => ref(0) };});
  const { createApp, nextTick } = await import('vue');
  const Chat = (await import('../../../src/presentation-v2/components/WorldSimulationAgentChat.vue')).default;
  const el = document.createElement('div'); document.body.appendChild(el);
  const app = createApp(Chat); app.mount(el); await nextTick();
  return { app, el, runtime, read, nextTick };
}

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.resetModules(); resetWorldSimulationSessionLogForTests_ACU(); });

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

  it('keeps ordinary sends available while running and forwards explicit interrupt control separately', async () => {
    const { app, el, runtime } = await mountChat(true);
    expect(Array.from(el.querySelectorAll('button')).map(button => button.textContent?.trim())).toContain('中断并维护');
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea');
    textarea!.value = '普通补充'; textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    const send = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '发送');
    send!.click(); await Promise.resolve();
    expect(runtime.submitAgentMessage).toHaveBeenCalledWith('普通补充');
    const interrupt = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '中断并维护');
    interrupt!.click(); await Promise.resolve(); await Promise.resolve();
    expect(runtime.interruptAndMaintain).toHaveBeenCalledWith({ action: 'interrupt_and_maintain', instruction: '中止当前可取消的世界推演，并先维护后续请求。' });
    app.unmount();
  });

  it('reports an already-entered strict save as non-cancellable instead of promising a rollback', async () => {
    const { app, el, runtime, nextTick } = await mountChat(true, true, 'queued_after_commit');
    expect(el.textContent).toContain('世界账本严格保存中');
    const interrupt = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '中断并维护');
    interrupt!.click(); await Promise.resolve(); await nextTick();
  expect(runtime.interruptAndMaintain).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('世界账本严格保存已开始，无法取消；中断请求已排队，保存完成后会先维护。');
    app.unmount();
  });

  it('reports a committed ledger with audit warning without inviting a duplicate business retry', async () => {
    const { app, el, runtime, nextTick } = await mountChat(false, false, 'queued_after_abort', 'started_with_audit_warning');
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea');
    textarea!.value = '推进港口局势';
    textarea!.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
    const send = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '发送');
    send!.click(); await Promise.resolve(); await nextTick();
    expect(runtime.submitAgentMessage).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('世界账本已联合提交，但会话审计同步失败；不要重复发送同一请求。');
    app.unmount();
  });

  it('renders live session entries from the in-memory log instead of the audit timeline', async () => {
    const { app, el, read, nextTick } = await mountChat();
    expect(read).toHaveBeenCalledTimes(1);
    const sessionLog = await import('../../../src/service/simulation/world-simulation-agent-session-log');
    await nextTick();
    sessionLog.beginWorldSimulationSessionRun_ACU('开始推演', '开始');
    sessionLog.logWorldSimulationSession_ACU({ kind: 'delegation', title: '派工', detail: '子代理推进', agentName: '子代理' });
    sessionLog.finishWorldSimulationSessionRun_ACU('完成', '已提交', true);
    await nextTick();

    expect(el.textContent).toContain('开始推演');
    expect(el.textContent).toContain('子代理');
    expect(el.textContent).toContain('已提交');
    app.unmount();
  });
});