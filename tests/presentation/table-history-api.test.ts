import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ host: undefined as any, isolationKey: '', replay: vi.fn() }));
vi.mock('../../src/shared/host-api', () => ({ get SillyTavern_API_ACU() { return mocks.host; } }));
vi.mock('../../src/data/gateways/chat-gateway', () => ({ getChatArray_ACU: () => mocks.host?.chat || [] }));
vi.mock('../../src/service/runtime/state-manager', () => ({ getCurrentIsolationKey_ACU: () => mocks.isolationKey }));
vi.mock('../../src/service/table/storage-frame-v2-replay', () => ({
    loadTableStatesAtBoundariesFromFramesV2Detailed_ACU: mocks.replay,
    V2ReplayOperationError_ACU: class extends Error {},
}));

import { createTableHistoryApi } from '../../src/presentation/bootstrap/api-groups/table-history-api';
const read = (indices: unknown) => createTableHistoryApi().exportTableSnapshotsAtMessages(indices);
const data = () => ({ sheet_0: { content: [['row_id', '值'], ['1', '旧值']] } });

beforeEach(() => {
    mocks.host = { chatId: 'chat-a', characterId: 0, groupId: undefined, chat: [
        { swipe_id: 0, TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, headRevision: '1:old' } } } },
        { is_user: true }, { is_user: false },
    ] };
    mocks.isolationKey = '';
    mocks.replay.mockReset().mockResolvedValue(new Map([[0, { data: data() }], [2, { data: data() }]]));
});

describe('public read-only table history API', () => {
    it('delegates once to the existing strict read-only batch replay and preserves requested order', async () => {
        const result = await read([2, 0, 2]);
        expect(result.success).toBe(true);
        expect(result.snapshots.map((snapshot: any) => snapshot.messageIndex)).toEqual([2, 0]);
        expect(mocks.replay).toHaveBeenCalledExactlyOnceWith(mocks.host.chat, '', [2, 0], {
            updateRuntimeState: false, compatibilityMode: 'disabled', allowTemporaryTemplateBaseline: false,
        });
    });

    it('returns independent copies, including snapshots sharing an engine result', async () => {
        const shared = data();
        mocks.replay.mockResolvedValue(new Map([[0, { data: shared }], [2, { data: shared }]]));
        const result = await read([0, 2]);
        result.snapshots[0].data.sheet_0.content[1][1] = 'caller edit';
        expect(shared.sheet_0.content[1][1]).toBe('旧值');
        expect(result.snapshots[1].data.sheet_0.content[1][1]).toBe('旧值');
    });

    it('does not replay frames after the greatest requested message', async () => {
        await read([0]);
        const [chat] = mocks.replay.mock.calls[0];
        expect(chat).toHaveLength(1);
        expect(chat[0]).toBe(mocks.host.chat[0]);
    });

    it.each([null, {}, [null], [-1], [0.5], ['0'], [Infinity], [3], Array(1)])('rejects invalid indices before replay: %j', async input => {
        expect(await read(input)).toMatchObject({ success: false, code: 'invalid_message_indices' });
        expect(mocks.replay).not.toHaveBeenCalled();
    });

    it('handles an empty request without consulting the host', async () => {
        mocks.host = undefined;
        expect(await read([])).toEqual({ success: true, snapshots: [] });
        expect(mocks.replay).not.toHaveBeenCalled();
    });

    it('reports missing host context', async () => {
        mocks.host = undefined;
        expect(await read([0])).toMatchObject({ success: false, code: 'host_unavailable' });
        expect(mocks.replay).not.toHaveBeenCalled();
    });

    it.each(['chat', 'identity', 'isolation', 'revision', 'swipe', 'frame', 'message', 'append'])('rejects context changes during replay: %s', async change => {
        const pending = read([0]);
        const chat = mocks.host.chat;
        if (change === 'chat') mocks.host.chat = chat.slice();
        if (change === 'identity') mocks.host.chatId = 'chat-b';
        if (change === 'isolation') mocks.isolationKey = 'other';
        if (change === 'revision') chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.headRevision = '2:new';
        if (change === 'swipe') chat[0].swipe_id = 1;
        if (change === 'frame') chat[0].TavernDB_ACU_IsolatedData[''].storageFrame = { version: 2, headRevision: '1:old' };
        if (change === 'message') chat[0] = { ...chat[0] };
        if (change === 'append') chat.push({ is_user: true });
        expect(await pending).toMatchObject({ success: false, code: 'context_changed' });
    });

    it('returns a structured failure rather than substituting current or empty data', async () => {
        mocks.replay.mockRejectedValue(new Error('bad persisted SQL'));
        expect(await read([0])).toEqual({ success: false, code: 'replay_failed', error: 'bad persisted SQL' });
    });

    it('rejects incomplete batch results', async () => {
        mocks.replay.mockResolvedValue(new Map());
        expect(await read([0])).toMatchObject({ success: false, code: 'replay_failed' });
    });
});
