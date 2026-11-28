import { describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  chat: [] as Record<string, unknown>[],
  chatId: 'chat-anchored-backfill-1',
  characterKey: 'char-anchored-1',
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => mockState.chat,
  readChatFromHostStrict_ACU: async () => structuredClone(mockState.chat),
  saveChatToHostStrict_ACU: async () => undefined,
  HostChatSaveNotStartedError_ACU: class extends Error {},
}));
vi.mock('../../src/data/gateways/host-state-gateway', () => ({
  getCurrentCharacterCardKey_ACU: () => mockState.characterKey,
}));
vi.mock('../../src/data/storage/chat-history', () => ({
  getActiveChatStorageIdentity_ACU: () => mockState.chatId,
}));
vi.mock('../../src/service/table/table-write-transaction', () => ({
  runChatWriteExclusiveWithTableWrites_ACU: async <T>(work: () => Promise<T>) => work(),
}));

import { ZERO_LAYER_CARRIER_FIELD_ACU, ZERO_LAYER_SCHEMA_VERSION_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerTableResult_ACU } from '../../src/service/zero-layer/model';
import { physicalHistoryFingerprint_ACU, physicalHistorySnapshot_ACU } from '../../src/service/zero-layer/carrier-context';
import { ZeroLayerStore_ACU } from '../../src/service/zero-layer/store';
import { getPublishedZeroLayerPath_ACU } from '../../src/service/zero-layer/timeline';
import { validateZeroLayerEnvelope_ACU } from '../../src/service/zero-layer/validation';
import { getTableDataFingerprint_ACU } from '../../src/service/table/table-data-upgrade-audit';

function makeTable(rows: string[][]) {
  return {
    mate: { type: 'chatSheets', version: 1 },
    sheet_0: {
      uid: 'sheet_0',
      name: '营地成员表',
      sourceData: {},
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
      content: [['row_id', '姓名', '状态'], ...rows],
    },
  } as any;
}

describe('zero-layer anchored async table backfill', () => {
  it('inserts Turn 1 backfilled table at Turn 1 anchor even after Turn 2 already published, forward-propagates to Turn 2 & in-flight Turn 3, and ignores off-branch anchors', async () => {
    const baseTable = makeTable([['1', '林野', '开局']]);
    const t1FilledTable = makeTable([['1', '林野', '第1轮已更新'], ['2', '老陶', '修补砖窑']]);
    const t2FilledTable = makeTable([['1', '林野', '第2轮已更新'], ['2', '老陶', '修补砖窑'], ['3', '苏禾', '带来草药']]);

    mockState.chat = [{ mes: '开场白', is_user: false, is_system: false, swipe_id: 0 }];
    const fp = await physicalHistoryFingerprint_ACU(physicalHistorySnapshot_ACU(mockState.chat));

    const makeTableRes = (floorId: string, tableData: any, frontier: number, filled: string[] = []): ZeroLayerTableResult_ACU => ({
      floorId,
      tableData: structuredClone(tableData),
      completedAiFloorBySheetKey: { sheet_0: frontier },
      filledSheetKeys: filled,
    });
    const simResult = {
      schemaVersion: 1,
      floorId: '',
      ledger: null,
      fields: {
        schemaVersion: 1,
        columns: {},
      },
      archive: {
        schemaVersion: 1,
        entries: [],
      },
    } as any;

    const t1TablePlaceholder = makeTableRes('f-a1', baseTable, 1, []);
    const t2TablePlaceholder = makeTableRes('f-a2', baseTable, 1, []);

    const envelope: ZeroLayerEnvelope_ACU = {
      schemaVersion: ZERO_LAYER_SCHEMA_VERSION_ACU,
      sessionId: 'sess-1',
      carrierId: 'car-1',
      scope: { chatId: mockState.chatId, characterKey: mockState.characterKey },
      carrierSwipeId: 0,
      seedBody: '开场白',
      activationFingerprint: fp,
      activationMessageCount: 1,
      enabled: true,
      apiPresetName: 'preset-1',
      revision: 10,
      activeBranchId: 'br-main',
      branches: [
        {
          branchId: 'br-main',
          headTurnId: 't2',
        },
        {
          branchId: 'br-other',
          headTurnId: null,
        },
      ],
      turns: [
        {
          turnId: 't1',
          branchId: 'br-main',
          parentTurnId: null,
          attemptId: 'att-1',
          input: '第1轮行动',
          body: '第1轮正文已提前发布',
          phase: 'published',
          createdAt: 1000,
          updatedAt: 1000,
          userFloor: { floorId: 'f-u1', role: 'user', data: {} },
          assistantFloor: {
            floorId: 'f-a1',
            role: 'assistant',
            data: { table: t1TablePlaceholder, simulation: { ...simResult, floorId: 'f-a1' } },
          },
          requiredEffects: ['table', 'simulation'],
          effectReceipts: [
            { effectId: 'eff-t1-table', kind: 'table', status: 'durable', fingerprint: getTableDataFingerprint_ACU(t1TablePlaceholder) },
            { effectId: 'eff-t1-sim', kind: 'simulation', status: 'skipped-by-config', fingerprint: 'skip-1' },
          ],
          tableBackfillStatus: 'pending',
          tableInput: {
            chatKey: 'chat-1',
            isolationKey: '',
            storageMode: 'native',
            tableData: structuredClone(baseTable),
            templateData: structuredClone(baseTable),
            completedAiFloorBySheetKey: { sheet_0: 1 },
            autoUpdateEnabled: true,
          },
          errorCode: null,
        },
        {
          turnId: 't2',
          branchId: 'br-main',
          parentTurnId: 't1',
          attemptId: 'att-2',
          input: '第2轮行动（在t1填表完成前就已先出正文！）',
          body: '第2轮正文抢先发布',
          phase: 'published',
          createdAt: 2000,
          updatedAt: 2000,
          userFloor: { floorId: 'f-u2', role: 'user', data: {} },
          assistantFloor: {
            floorId: 'f-a2',
            role: 'assistant',
            data: { table: t2TablePlaceholder, simulation: { ...simResult, floorId: 'f-a2' } },
          },
          requiredEffects: ['table', 'simulation'],
          effectReceipts: [
            { effectId: 'eff-t2-table', kind: 'table', status: 'durable', fingerprint: getTableDataFingerprint_ACU(t2TablePlaceholder) },
            { effectId: 'eff-t2-sim', kind: 'simulation', status: 'skipped-by-config', fingerprint: 'skip-2' },
          ],
          tableBackfillStatus: 'pending',
          tableInput: {
            chatKey: 'chat-1',
            isolationKey: '',
            storageMode: 'native',
            tableData: structuredClone(baseTable),
            templateData: structuredClone(baseTable),
            completedAiFloorBySheetKey: { sheet_0: 1 },
            autoUpdateEnabled: true,
          },
          errorCode: null,
        },
        {
          turnId: 't3',
          branchId: 'br-main',
          parentTurnId: 't2',
          attemptId: 'att-3',
          input: '第3轮正在生成中',
          body: null,
          phase: 'dispatching',
          createdAt: 3000,
          updatedAt: 3000,
          userFloor: { floorId: 'f-u3', role: 'user', data: {} },
          assistantFloor: { floorId: 'f-a3', role: 'assistant', data: {} },
          requiredEffects: ['table', 'simulation'],
          effectReceipts: [],
          tableInput: {
            chatKey: 'chat-1',
            isolationKey: '',
            storageMode: 'native',
            tableData: structuredClone(baseTable),
            templateData: structuredClone(baseTable),
            completedAiFloorBySheetKey: { sheet_0: 1 },
            autoUpdateEnabled: true,
          },
          errorCode: null,
        },
      ],
    };

    mockState.chat[0][ZERO_LAYER_CARRIER_FIELD_ACU] = envelope;
    const store = new ZeroLayerStore_ACU();

    // 1. 回填锚点 t1（此时 t2 已先发布、t3 正在 dispatching！）
    const res1 = await store.commitAnchoredTableBackfill('sess-1', 'br-main', {
      turnId: 't1',
      attemptId: 'att-1',
      floorId: 'f-a1',
      result: makeTableRes('f-a1', t1FilledTable, 2, ['sheet_0']),
      status: 'settled',
    });

    expect(res1.applied).toBe(true);
    expect(res1.propagatedCount).toBe(1);
    const envAfterT1 = validateZeroLayerEnvelope_ACU(res1.envelope);
    const t1After = envAfterT1.turns.find(t => t.turnId === 't1')!;
    const t2After = envAfterT1.turns.find(t => t.turnId === 't2')!;
    const t3After = envAfterT1.turns.find(t => t.turnId === 't3')!;

    expect(t1After.tableBackfillStatus).toBe('settled');
    expect((t1After.assistantFloor.data.table as ZeroLayerTableResult_ACU).tableData.sheet_0.content.length).toBe(3);
    // t2 自动承接了 t1 的真表作为占位表与下轮填表基底（保留 t2 自己的 floorId 与 pending 状态）
    expect(t2After.tableBackfillStatus).toBe('pending');
    expect((t2After.assistantFloor.data.table as ZeroLayerTableResult_ACU).floorId).toBe('f-a2');
    expect((t2After.assistantFloor.data.table as ZeroLayerTableResult_ACU).tableData.sheet_0.content[2]).toEqual(['2', '老陶', '修补砖窑']);
    expect(t2After.tableInput?.completedAiFloorBySheetKey.sheet_0).toBe(2);
    // 在途的 t3 的 tableInput 也同步更新到最新真表！
    expect(t3After.tableInput?.tableData.sheet_0.content[2]).toEqual(['2', '老陶', '修补砖窑']);
    expect(t3After.tableInput?.completedAiFloorBySheetKey.sheet_0).toBe(2);

    // 沿已发布链读当前分支 head (=t2) 的表数据，已立刻可见 t1 回填的新行，且只剩 1 个 pending 锚点！
    const publishedAfterT1 = getPublishedZeroLayerPath_ACU(envAfterT1);
    expect((publishedAfterT1[publishedAfterT1.length - 1].assistantFloor.data.table as ZeroLayerTableResult_ACU).tableData.sheet_0.content[2]).toEqual(['2', '老陶', '修补砖窑']);
    expect(publishedAfterT1.filter(t => t.tableBackfillStatus === 'pending').length).toBe(1);

    // 2. 紧接着队列按序回填锚点 t2
    const res2 = await store.commitAnchoredTableBackfill('sess-1', 'br-main', {
      turnId: 't2',
      attemptId: 'att-2',
      floorId: 'f-a2',
      result: makeTableRes('f-a2', t2FilledTable, 3, ['sheet_0']),
      status: 'settled',
    });
    expect(res2.applied).toBe(true);
    const envAfterT2 = validateZeroLayerEnvelope_ACU(res2.envelope);
    const publishedAfterT2 = getPublishedZeroLayerPath_ACU(envAfterT2);
    expect((publishedAfterT2[publishedAfterT2.length - 1].assistantFloor.data.table as ZeroLayerTableResult_ACU).tableData.sheet_0.content[3]).toEqual(['3', '苏禾', '带来草药']);
    expect(publishedAfterT2.filter(t => t.tableBackfillStatus === 'pending').length).toBe(0);

    // 3. 幂等/防错位：对已 settled 的锚点或非活动分支锚点重复回填一律安全拒绝
    const dup = await store.commitAnchoredTableBackfill('sess-1', 'br-main', {
      turnId: 't1',
      attemptId: 'att-1',
      floorId: 'f-a1',
      result: makeTableRes('f-a1', baseTable, 1, []),
      status: 'settled',
    });
    expect(dup.applied).toBe(false);
    expect(dup.reason).toBe('anchor-not-pending');

    const wrongBranch = await store.commitAnchoredTableBackfill('sess-1', 'br-other', {
      turnId: 't2',
      attemptId: 'att-2',
      floorId: 'f-a2',
      result: makeTableRes('f-a2', baseTable, 1, []),
      status: 'settled',
    });
    expect(wrongBranch.applied).toBe(false);
    expect(wrongBranch.reason).toBe('scope-changed');
  });
});
