import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_MODULE_FIELD_ACU, AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, type AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import {
  buildEmptyAgentModuleSnapshot_ACU,
  readAgentModuleFieldSnapshot_ACU,
  readAgentModuleSnapshot_ACU,
  writeAgentModuleFields_ACU,
  writeAgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import { notifyMaterialCheckpointFloor_ACU } from '../../../../src/service/chat/material-checkpoint-sync';
import { installMaterialCheckpointScheduler_ACU, readTableCheckpointCadence_ACU } from '../../../../src/service/continuation/agent/agent-checkpoint-scheduler';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

function snapshotAt(settledThroughIndex: number, patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex, ...patch };
}

function hook(id: string) {
  return { id, summary: `伏笔 ${id}`, status: 'planted', importance: 'mid', plantedIndex: 1, updatedIndex: 1, plannedPayoff: '', retired: false, retiredReason: '' };
}

beforeEach(() => {
  _set_SillyTavern_API_ACU(null as any);
  installMaterialCheckpointScheduler_ACU();
});

describe('续写资料楼层增量折叠', () => {
  it('多条 delta 按楼层顺序叠加后等于依次全量写入的结果', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0, { hooks: [hook('H1') as any] }));
    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any, hook('H2') as any] }));
    chat.push({ mes: 'c', is_user: false });
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt(2, { hooks: [hook('H2') as any] }));

    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H2']);
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(2);
    expect(chat[0][AGENT_MODULE_FIELD_ACU].schemaVersion).toBe(AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU);
  });

  it('删掉中间楼或末楼后，该楼 delta 不再进入折叠', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0, { hooks: [hook('H1') as any] }));
    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any, hook('MID') as any] }));
    chat.push({ mes: 'c', is_user: false });
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt(2, { hooks: [hook('H1') as any, hook('MID') as any, hook('END') as any] }));

    const withoutEnd = chat.slice(0, 2);
    expect(readAgentModuleSnapshot_ACU(withoutEnd).hooks.map(item => item.id)).toEqual(['H1', 'MID']);

    const withoutMiddle = [chat[0], chat[2]];
    expect(readAgentModuleSnapshot_ACU(withoutMiddle).hooks.map(item => item.id)).toEqual(['H1', 'END']);
  });

  it('swipe 切走后不读取原 swipe 的基线和 delta，切回后恢复', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false, swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0, { hooks: [hook('SWIPE0') as any] }));

    chat[0].swipe_id = 1;
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toEqual([]);
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(-1);

    chat[0].swipe_id = 0;
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['SWIPE0']);
  });

  it('旧全量快照读取时归一成基线，磁盘 schema 保持不变', () => {
    const legacy = snapshotAt(3, { hooks: [hook('OLD') as any] });
    const chat = [{ mes: 'a', is_user: false, [AGENT_MODULE_FIELD_ACU]: legacy }];
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['OLD']);
    expect(chat[0][AGENT_MODULE_FIELD_ACU].schemaVersion).toBe(legacy.schemaVersion);
    expect(chat[0][AGENT_MODULE_FIELD_ACU].deltas).toBeUndefined();
  });

  it('表格 checkpoint 落层时续写基线搬到同一楼，之后的 delta 仍叠加', async () => {
    const chat: any[] = [
      { mes: 'root', is_user: false, TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, checkpoint: { kind: 'full', reason: 'init', data: {} }, logEntries: [] }, _acu_storage_version: 2 } } },
      { mes: 'mid', is_user: false },
      { mes: 'tail', is_user: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt(2, { hooks: [hook('LATE') as any] }));
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['LATE']);

    chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint = undefined;
    chat[2].TavernDB_ACU_IsolatedData = { '': { storageFrame: { version: 2, checkpoint: { kind: 'full', reason: 'periodic', data: {} }, logEntries: [] }, _acu_storage_version: 2 } };
    notifyMaterialCheckpointFloor_ACU(chat, 2);

    expect(chat[2][AGENT_MODULE_FIELD_ACU].checkpoint.snapshot.hooks.map((item: { id: string }) => item.id)).toEqual(['LATE']);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['LATE']);
    expect(readTableCheckpointCadence_ACU().bufferLayers).toBe(20);
    expect(readTableCheckpointCadence_ACU().periodicStepLayers).toBe(20);
  });
});

describe('续写资料逐栏写入与分栏视图', () => {
  it('同一 ID 分两次写不同栏目合并为一条分栏记录，中间态不进入领域数组', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));

    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { value: '伏笔 P1' }, status: { value: 'planted' } } } });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { importance: { value: 'high' } } } });

    const record = readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1;
    expect(record?.status).toBe('partial');
    expect(record?.fields.summary.value).toBe('伏笔 P1');
    expect(record?.fields.status.value).toBe('planted');
    expect(record?.fields.importance.value).toBe('high');
    expect(record?.missingFields).toContain('plantedIndex');
    // 中间态不进入完整领域数组
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toEqual([]);
    // 新写只产生新帧 delta，基线楼不被改写
    expect(chat[1][AGENT_MODULE_FIELD_ACU].deltas).toHaveLength(2);
    expect(chat[0][AGENT_MODULE_FIELD_ACU].deltas).toEqual([]);
    expect(chat[0][AGENT_MODULE_FIELD_ACU].checkpoint.snapshot.hooks).toEqual([]);
  });

  it('整条写入覆盖同名 partial 记录并提升为完整条目', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { value: '伏笔 P1' } } } });
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.status).toBe('partial');

    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('P1') as any] }));
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.status).toBe('complete');
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['P1']);
  });

  it('领域条目被整条写入删除后，partial 记录仍保留在分栏视图', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0, { hooks: [hook('H1') as any] }));
    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { value: '伏笔 P1' } } } });

    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [] }));
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toEqual([]);
    const records = readAgentModuleFieldSnapshot_ACU(chat).records.hooks ?? {};
    expect(records.H1).toBeUndefined();
    expect(records.P1?.status).toBe('partial');
  });

  it('swipe 切走后逐栏 delta 不进入折叠，切回后恢复', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false, swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: 'b', is_user: false, swipe_id: 0 });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { value: '伏笔 P1' } } } });
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.status).toBe('partial');

    chat[1].swipe_id = 1;
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks ?? {}).toEqual({});

    chat[1].swipe_id = 0;
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.fields.summary.value).toBe('伏笔 P1');
  });
});
