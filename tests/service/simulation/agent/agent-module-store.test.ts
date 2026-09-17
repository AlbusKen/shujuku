import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { readLatestWorldSimulationMaterials_ACU, writeWorldSimulationMaterialsSnapshot_ACU } from '../../../../src/service/simulation/agent/agent-module-store';
import { resolveWorldSimulationAnchor_ACU } from '../../../../src/service/simulation/simulation-store';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

describe('world simulation materials snapshots', () => {
  beforeEach(() => _set_SillyTavern_API_ACU(undefined));

  it('uses the latest valid active-swipe snapshot and falls back on damage or swipe change', async () => {
    const chat: any[] = [
      { message_id: 1, mes: 'one', swipe_id: 0 },
      { message_id: 2, mes: 'two-a', swipe_id: 0, swipes: ['two-a', 'two-b'] },
    ];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const firstLedger = { ...buildEmptyWorldSimulationLedger_ACU(), revision: 1 };
    const secondLedger = { ...buildEmptyWorldSimulationLedger_ACU(), revision: 2 };
    const registry = createWorldSimulationEvidenceRegistry_ACU('materials');
    const ref1 = recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'ledger:first', status: 'ok', summary: 'first', exact: true }).evidenceRef!;
    const ref2 = recordWorldSimulationEvidence_ACU(registry, { operation: 'read', address: 'ledger:second', status: 'ok', summary: 'second', exact: true }).evidenceRef!;
    const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(registry);
    await expect(writeWorldSimulationMaterialsSnapshot_ACU(resolveWorldSimulationAnchor_ACU(0, chat), firstLedger, ['unknown'], snapshot, chat)).rejects.toThrow(/未授权/);
    await writeWorldSimulationMaterialsSnapshot_ACU(resolveWorldSimulationAnchor_ACU(0, chat), firstLedger, [ref1], snapshot, chat);
    await writeWorldSimulationMaterialsSnapshot_ACU(resolveWorldSimulationAnchor_ACU(1, chat), secondLedger, [ref2], snapshot, chat);
    expect(readLatestWorldSimulationMaterials_ACU(chat)).toMatchObject({ adoptedIndex: 1, snapshot: { ledgerRevision: 2 } });

    chat[1].swipe_id = 1;
    chat[1].mes = 'two-b';
    expect(readLatestWorldSimulationMaterials_ACU(chat)).toMatchObject({ adoptedIndex: 0, snapshot: { ledgerRevision: 1 } });

    chat[1].swipe_id = 0;
    chat[1].mes = 'two-a';
    chat[1]._qrf_world_simulation_agent_materials = { schemaVersion: 1, entries: 'broken' };
    const restored = readLatestWorldSimulationMaterials_ACU(chat);
    expect(restored).toMatchObject({ adoptedIndex: 0, snapshot: { ledgerRevision: 1 } });
    expect(restored.diagnostics.length).toBeGreaterThan(0);
  });
});
