import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTableHistoryApi } from '../../src/presentation/bootstrap/api-groups/table-history-api';
import { _set_SillyTavern_API_ACU, SillyTavern_API_ACU } from '../../src/shared/host-api';
import {
    _set_currentJsonTableData_ACU, currentJsonTableData_ACU,
    _set_independentTableStates_ACU, independentTableStates_ACU,
    _set_settings_ACU, settings_ACU,
} from '../../src/service/runtime/state-manager';

const original = {
    host: SillyTavern_API_ACU, tables: currentJsonTableData_ACU,
    independent: independentTableStates_ACU, settings: settings_ACU,
};
const read = (indices: number[]) => createTableHistoryApi().exportTableSnapshotsAtMessages(indices);
const checkpoint = () => ({
    mate: { type: 'acu', version: 1 },
    sheet_inventory: {
        uid: 'inventory', name: 'inventory', orderNo: 0,
        content: [['row_id', 'name', 'rating', 'detail'], ['1', '初始', 1.25, '{"value":1,"$cache":"甲"}']],
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT, rating REAL CHECK(rating BETWEEN 0 AND 5), detail TEXT);' },
        updateConfig: {}, exportConfig: {},
    },
});
function entry(messageIndex: number, statements: string[]) {
    return {
        seq: 1, entryId: 'public_history_' + messageIndex, createdAt: messageIndex + 2,
        source: 'manual_crud', targetMessageIndex: messageIndex, aiFloor: messageIndex + 1,
        filledSheetKeys: ['sheet_inventory'], changedSheetKeys: ['sheet_inventory'], groupKeys: [],
        operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_inventory', tableName: 'inventory', statements, reason: 'system' }],
    };
}
let chat: any[], saveChat: ReturnType<typeof vi.fn>;
beforeEach(() => {
    chat = [
        { is_user: false, swipe_id: 0, TavernDB_ACU_IsolatedData: { '': {
            _acu_storage_version: 2,
            storageFrame: { version: 2, headRevision: '1:opening',
                checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpoint(),
                    event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] } },
                logEntries: [entry(0, ['UPDATE inventory SET rating = 1.75 WHERE row_id = 1'])],
            },
        } } },
        { is_user: true, mes: 'a message with no frame' },
        { is_user: false, TavernDB_ACU_IsolatedData: { '': {
            _acu_storage_version: 2,
            storageFrame: { version: 2, headRevision: '1:later', logEntries: [entry(2,
                ['UPDATE inventory SET rating = 2.5, detail = json_set(detail,\'$.value\',2) WHERE row_id = 1'])] },
        } } },
    ];
    saveChat = vi.fn();
    _set_SillyTavern_API_ACU({ chat, chatId: 'public-history', characterId: 0, saveChat } as any);
    _set_settings_ACU({ ...original.settings, dataIsolationEnabled: false });
    const current = checkpoint(); current.sheet_inventory.content[1][2] = 4.5;
    _set_currentJsonTableData_ACU(current as any);
    _set_independentTableStates_ACU({ sentinel: { lastUpdatedAiFloor: 99 } });
});
afterEach(() => {
    _set_SillyTavern_API_ACU(original.host);
    _set_currentJsonTableData_ACU(original.tables);
    _set_independentTableStates_ACU(original.independent);
    _set_settings_ACU(original.settings);
});

describe('public history API using real SQLite replay', () => {
    it('includes opening SQL, inherits frameless messages, and returns distinct historical states without publishing or saving', async () => {
        const beforeChat = structuredClone(chat), beforeCurrent = structuredClone(currentJsonTableData_ACU);
        const result = await read([2, 0, 1]);
        expect(result.success).toBe(true);
        expect(result.snapshots.map((snapshot: any) => snapshot.messageIndex)).toEqual([2, 0, 1]);
        const rows = result.snapshots.map((snapshot: any) => snapshot.data.sheet_inventory.content[1]);
        expect(rows.map((row: any[]) => Number(row[2]))).toEqual([2.5, 1.75, 1.75]);
        expect(JSON.parse(rows[0][3])).toEqual({ value: 2, $cache: '甲' });
        expect(JSON.parse(rows[1][3])).toEqual({ value: 1, $cache: '甲' });
        expect(chat).toEqual(beforeChat);
        expect(currentJsonTableData_ACU).toEqual(beforeCurrent);
        expect(independentTableStates_ACU).toEqual({ sentinel: { lastUpdatedAiFloor: 99 } });
        expect(saveChat).not.toHaveBeenCalled();
    });

    it('can read a valid older state even when later SQL is invalid, and preserves failure details when that floor is requested', async () => {
        chat[2].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].operations[0].statements = ['UPDATE inventory SET missing_column = 5'];
        const earlier = await read([0]);
        expect(earlier.success).toBe(true);
        expect(Number(earlier.snapshots[0].data.sheet_inventory.content[1][2])).toBe(1.75);
        const later = await read([2]);
        expect(later).toMatchObject({ success: false, code: 'replay_failed',
            failurePoint: { messageIndex: 2, seq: 1, operationIndex: 0, kind: 'sql_sheet_batch' } });
        expect(saveChat).not.toHaveBeenCalled();
    });

    it('reports an absent V2 checkpoint instead of returning current tables or a fabricated empty snapshot', async () => {
        chat.splice(0, chat.length, { is_user: false });
        expect(await read([0])).toMatchObject({ success: false, code: 'replay_failed' });
        expect(saveChat).not.toHaveBeenCalled();
    });
});
