import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { FirstFloorContinuationStore_ACU } from '../../../src/service/continuation/continuation-store';
import { ContinuationRequirementsStore_ACU } from '../../../src/service/continuation/continuation-requirements-store';

const replacement = (revision = 0) => ({ action: 'maintain_requirements', thought: '更新', expectedRevision: revision, appliedUserMessageId: 'continuation-user:3', requirements: [{ id: 'R1', category: 'goal', priority: 'hard', text: '保持视角', sourceRefs: ['continuation-user:3'] }], summary: '同步' });

describe('ContinuationRequirementsStore_ACU', () => {
  beforeEach(() => _set_SillyTavern_API_ACU(undefined));
  it('stores an independent first-floor sidecar and rejects stale or forged replacements', async () => {
    const chat: any[] = [{}]; const saveChat = vi.fn(async () => undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const store = new ContinuationRequirementsStore_ACU(new FirstFloorContinuationStore_ACU(), () => [{ id: 3, kind: 'user' }] as any);
    expect(store.read()).toBeNull();
    await expect(store.replace(replacement())).resolves.toMatchObject({ revision: 1, feature: 'continuation' });
    expect(chat[0]._qrf_continuation_requirements).toMatchObject({ requirements: [{ id: 'R1' }] });
    expect(chat[0]._qrf_continuation).toBeUndefined();
    await expect(store.replace(replacement())).rejects.toThrow('revision 已变化');
    await expect(store.replace({ ...replacement(1), appliedUserMessageId: 'continuation-user:99' })).rejects.toThrow('不存在的用户输入');
  });
  it('restores the old sidecar when strict host save fails', async () => {
    const previous = { feature: 'continuation', revision: 0, lastAppliedUserMessageId: null, requirements: [] };
    const chat: any[] = [{ _qrf_continuation_requirements: previous }]; const saveChat = vi.fn().mockRejectedValueOnce(new Error('save failed'));
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const store = new ContinuationRequirementsStore_ACU(new FirstFloorContinuationStore_ACU(), () => [{ id: 3, kind: 'user' }] as any);
    await expect(store.replace(replacement())).rejects.toThrow();
    expect(chat[0]._qrf_continuation_requirements).toEqual(previous);
  });
});