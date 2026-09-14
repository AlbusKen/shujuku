import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { WorldSimulationRequirementsStore_ACU } from '../../../src/service/simulation/simulation-requirements-store';

const source = 'world-simulation-user:0:string:ai-1:0:1';
const replacement = (revision = 0, sourceId = source) => ({ action: 'maintain_requirements', thought: '更新', expectedRevision: revision, appliedUserMessageId: sourceId, requirements: [{ id: 'R1', category: 'canon', priority: 'hard', text: '港口封锁', sourceRefs: [sourceId] }], summary: '同步' });
function chat(messageId = 'ai-1') { return [{ is_user: false, message_id: messageId, mes: '正文 A', swipe_id: 0, swipes: ['正文 A', '正文 B'], _qrf_world_simulation_agent_chat: { version: 1, entries: [{ swipe: { messageIndex: 0, messageKey: `string:${messageId}`, swipeIndex: 0, baseTextHash: 'ignored' }, nextId: 2, messages: [{ id: 1, at: 1, kind: 'user', status: 'pending', title: '补充', detail: '保持港口封锁' }] }] } }]; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve };
}

describe('WorldSimulationRequirementsStore_ACU', () => {
  beforeEach(() => _set_SillyTavern_API_ACU(undefined));
  it('stores requirements per active swipe without touching the ledger or projection', async () => {
    const value = chat(); const saveChat = vi.fn(async () => undefined); _set_SillyTavern_API_ACU({ chat: value, saveChat } as any);
    const store = new WorldSimulationRequirementsStore_ACU();
    await expect(store.replace(0, replacement(), value)).resolves.toMatchObject({ feature: 'world-simulation', revision: 1 });
    expect(value[0]._qrf_world_simulation_requirements).toMatchObject({ entries: [{ snapshot: { requirements: [{ id: 'R1' }] } }] });
    expect(value[0].TavernDB_ACU_IsolatedData).toBeUndefined();
    value[0].swipe_id = 1; value[0].mes = '正文 B';
    expect(store.read(0, value)).toBeNull();
  });

  it('rejects forged sources and rolls back its independent sidecar on save failure', async () => {
    const value = chat(); const saveChat = vi.fn().mockRejectedValueOnce(new Error('save failed')); _set_SillyTavern_API_ACU({ chat: value, saveChat } as any);
    const store = new WorldSimulationRequirementsStore_ACU();
    await expect(store.replace(0, { ...replacement(), appliedUserMessageId: 'world-simulation-user:0:string:ai-1:0:9' }, value)).rejects.toThrow('不存在的用户输入');
    await expect(store.replace(0, replacement(), value)).rejects.toMatchObject({ error: { code: 'WORLD_SIM_PERSIST_FAILED' } });
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(value[0]._qrf_world_simulation_requirements).toBeUndefined();
  });

  it('reports both failures when strict save and its compensating rollback save fail', async () => {
    const value = chat(); const saveChat = vi.fn().mockRejectedValueOnce(new Error('primary failed')).mockRejectedValueOnce(new Error('rollback failed'));
    _set_SillyTavern_API_ACU({ chat: value, chatId: 'chat-double-failure', saveChat } as any);
    const store = new WorldSimulationRequirementsStore_ACU();
    await expect(store.replace(0, replacement(), value)).rejects.toMatchObject({ error: { code: 'WORLD_SIM_PERSIST_FAILED', details: { primaryMessage: 'primary failed', rollbackMessage: 'rollback failed' } } });
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(value[0]._qrf_world_simulation_requirements).toBeUndefined();
  });

  it('serializes different Store instances on the same swipe so the later stale revision cannot overwrite the first', async () => {
    const value = chat(); const gate = deferred(); const saveChat = vi.fn(() => gate.promise); _set_SillyTavern_API_ACU({ chat: value, chatId: 'chat-queue', saveChat } as any);
    const firstStore = new WorldSimulationRequirementsStore_ACU(); const secondStore = new WorldSimulationRequirementsStore_ACU();
    const first = firstStore.replace(0, replacement(), value);
    const second = secondStore.replace(0, replacement(), value);
    await Promise.resolve();
    expect(saveChat).toHaveBeenCalledTimes(1);
    gate.resolve();
    await expect(first).resolves.toMatchObject({ revision: 1 });
    await expect(second).rejects.toThrow('revision 已变化');
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(firstStore.read(0, value)).toMatchObject({ revision: 1, requirements: [{ id: 'R1' }] });
  });

  it('serializes different Store instances on the same chat array without a host chatId', async () => {
    const value = chat(); const gate = deferred(); const saveChat = vi.fn(() => gate.promise); _set_SillyTavern_API_ACU({ chat: value, saveChat } as any);
    const first = new WorldSimulationRequirementsStore_ACU().replace(0, replacement(), value);
    const second = new WorldSimulationRequirementsStore_ACU().replace(0, replacement(), value);
    await Promise.resolve();
    expect(saveChat).toHaveBeenCalledTimes(1);
    gate.resolve();
    await expect(first).resolves.toMatchObject({ revision: 1 });
    await expect(second).rejects.toThrow('revision 已变化');
    expect(saveChat).toHaveBeenCalledTimes(1);
  });

  it('does not serialize different chat arrays through the host-without-chat-id fallback', async () => {
    const firstChat = chat('ai-first'); const secondChat = chat('ai-second'); const gate = deferred();
    const saveFirst = vi.fn(() => gate.promise); const saveSecond = vi.fn(async () => undefined);
    _set_SillyTavern_API_ACU({ chat: firstChat, saveChat: saveFirst } as any);
    const first = new WorldSimulationRequirementsStore_ACU().replace(0, replacement(0, 'world-simulation-user:0:string:ai-first:0:1'), firstChat);
    await Promise.resolve();
    expect(saveFirst).toHaveBeenCalledTimes(1);
    _set_SillyTavern_API_ACU({ chat: secondChat, saveChat: saveSecond } as any);
    const second = new WorldSimulationRequirementsStore_ACU().replace(0, replacement(0, 'world-simulation-user:0:string:ai-second:0:1'), secondChat);
    await Promise.resolve();
    expect(saveSecond).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toMatchObject({ revision: 1 });
    gate.resolve();
    await expect(first).rejects.toMatchObject({
      error: {
        code: 'WORLD_SIM_PERSIST_FAILED',
        details: { persistenceState: 'unknown', rollbackAttempted: false },
      },
    });
  });

  it('fails closed and persists the rollback when the active swipe changes during host save', async () => {
    const value = chat(); const gate = deferred(); const saveChat = vi.fn(() => gate.promise); _set_SillyTavern_API_ACU({ chat: value, chatId: 'chat-swipe', saveChat } as any);
    const store = new WorldSimulationRequirementsStore_ACU();
    const pending = store.replace(0, replacement(), value);
    await Promise.resolve();
    expect(saveChat).toHaveBeenCalledTimes(1);
    value[0].swipe_id = 1; value[0].mes = '正文 B';
    gate.resolve();
    await expect(pending).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(value[0]._qrf_world_simulation_requirements).toBeUndefined();
    expect(store.read(0, value)).toBeNull();
  });

  it('fails closed and rolls back when only the active swipe base text changes during host save', async () => {
    const value = chat(); const gate = deferred(); const saveChat = vi.fn(() => gate.promise); _set_SillyTavern_API_ACU({ chat: value, chatId: 'chat-base-text', saveChat } as any);
    const pending = new WorldSimulationRequirementsStore_ACU().replace(0, replacement(), value);
    await Promise.resolve();
    value[0].mes = '正文 A 已编辑'; value[0].swipes[0] = '正文 A 已编辑';
    gate.resolve();
    await expect(pending).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(value[0]._qrf_world_simulation_requirements).toBeUndefined();
  });

  it('fails closed without writing a replacement target message object during host save', async () => {
    const value = chat(); const replacementTarget = clone(value[0]); const gate = deferred(); const saveChat = vi.fn(() => gate.promise);
    _set_SillyTavern_API_ACU({ chat: value, chatId: 'chat-message-replacement', saveChat } as any);
    const pending = new WorldSimulationRequirementsStore_ACU().replace(0, replacement(), value);
    await Promise.resolve();
    value[0] = replacementTarget;
    gate.resolve();
    await expect(pending).rejects.toMatchObject({
      error: {
        code: 'WORLD_SIM_PERSIST_FAILED',
        details: { persistenceState: 'unknown', rollbackAttempted: false },
      },
    });
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(replacementTarget._qrf_world_simulation_requirements).toBeUndefined();
  });

  it('changes only the independent requirements sidecar, preserving audit, body, swipes and ledger fields', async () => {
    const value = chat();
    value[0].TavernDB_ACU_IsolatedData = { worldSimulation: { sentinel: 'ledger' } };
    value[0].extra = { publicProjection: '<与此同时>用户拥有的投影</与此同时>' };
    const before = clone(value[0]); const saveChat = vi.fn(async () => undefined); _set_SillyTavern_API_ACU({ chat: value, chatId: 'chat-field-boundary', saveChat } as any);
    await new WorldSimulationRequirementsStore_ACU().replace(0, replacement(), value);
    const after = clone(value[0]); delete after._qrf_world_simulation_requirements;
    expect(after).toEqual(before);
  });

  it.each([
    ['目标 message 被替换', (value: any[]) => { value[0] = clone(value[0]); }],
    ['active swipe 切换', (value: any[]) => { value[0].swipe_id = 1; value[0].mes = '正文 B'; }],
    ['active 正文基底变化', (value: any[]) => { value[0].mes = '正文 A 已编辑'; value[0].swipes[0] = '正文 A 已编辑'; }],
  ])('队首保存阻塞期间%s时，排队 replacement 在写前 stale 且不额外保存', async (_label, mutateTarget) => {
    const value = chat();
    const queueTarget = chat('ai-2')[0];
    queueTarget._qrf_world_simulation_agent_chat.entries[0].swipe.messageIndex = 1;
    value.push(queueTarget);
    const gate = deferred(); const saveChat = vi.fn(() => gate.promise); _set_SillyTavern_API_ACU({ chat: value, saveChat } as any);
    const first = new WorldSimulationRequirementsStore_ACU().replace(1, replacement(0, 'world-simulation-user:1:string:ai-2:0:1'), value);
    await Promise.resolve();
    expect(saveChat).toHaveBeenCalledTimes(1);
    const queued = new WorldSimulationRequirementsStore_ACU().replace(0, replacement(), value);
    mutateTarget(value);
    gate.resolve();
    await expect(first).resolves.toMatchObject({ revision: 1 });
    await expect(queued).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(value[0]._qrf_world_simulation_requirements).toBeUndefined();
  });

  it('rejects a queued replacement before write when the active chat changes while its queue is blocked', async () => {
    const value = chat(); const other = chat('ai-other'); const gate = deferred(); const saveChat = vi.fn(() => gate.promise);
    _set_SillyTavern_API_ACU({ chat: value, chatId: 'chat-queued-original', saveChat } as any);
    const first = new WorldSimulationRequirementsStore_ACU().replace(0, replacement(), value);
    await Promise.resolve();
    const queued = new WorldSimulationRequirementsStore_ACU().replace(0, replacement(), value);
    _set_SillyTavern_API_ACU({ chat: other, chatId: 'chat-queued-other', saveChat } as any);
    gate.resolve();
    await expect(first).rejects.toMatchObject({
      error: {
        code: 'WORLD_SIM_PERSIST_FAILED',
        details: { persistenceState: 'unknown', rollbackAttempted: false },
      },
    });
    await expect(queued).rejects.toMatchObject({ error: { code: 'WORLD_SIM_STALE' } });
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(value[0]._qrf_world_simulation_requirements).toBeUndefined();
    expect(other[0]._qrf_world_simulation_requirements).toBeUndefined();
  });

  it('fails closed without cross-chat rollback when the host chat changes during save', async () => {
    const value = chat(); const other = chat('ai-other'); const gate = deferred(); const saveChat = vi.fn(() => gate.promise);
    _set_SillyTavern_API_ACU({ chat: value, chatId: 'chat-original', saveChat } as any);
    const store = new WorldSimulationRequirementsStore_ACU();
    const pending = store.replace(0, replacement(), value);
    await Promise.resolve();
    expect(saveChat).toHaveBeenCalledTimes(1);
    _set_SillyTavern_API_ACU({ chat: other, chatId: 'chat-other', saveChat } as any);
    gate.resolve();
    await expect(pending).rejects.toMatchObject({
      error: {
        code: 'WORLD_SIM_PERSIST_FAILED',
        details: { persistenceState: 'unknown', rollbackAttempted: false },
      },
    });
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(value[0]._qrf_world_simulation_requirements).toBeUndefined();
    expect(other[0]._qrf_world_simulation_requirements).toBeUndefined();
  });
});