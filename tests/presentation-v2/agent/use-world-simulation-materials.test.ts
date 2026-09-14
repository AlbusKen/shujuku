/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useWorldSimulationMaterials } from '../../../src/presentation-v2/composables/useWorldSimulationMaterials';

const state: any = { anchorMessageIndex: 1, entities: [{ id: 'E1', name: '甲' }], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
function read() { return { kind: 'ready' as const, baseline: { state, anchorMessageIndex: 1, replayDigest: 'd1', parentReplayDigest: null, swipe: { messageIndex: 1, messageKey: 'string:a', swipeIndex: 0, baseTextHash: 'body' }, expectedProjectionBlockHash: null }, requirements: { anchorMessageIndex: 1, swipe: { messageIndex: 1, messageKey: 'string:a', swipeIndex: 0, baseTextHash: 'body' }, revision: 1, requirements: [], sourceIds: ['u1'] }, diagnostics: { checkpointMessageIndex: 1, checkpointId: 'c1', deltaMessageIndices: [], branchReparsed: false } }; }
describe('useWorldSimulationMaterials', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it('preserves dirty module drafts during refresh and after strict save failure', async () => {
    const adapter: any = { read, saveModule: vi.fn().mockRejectedValue(new Error('host save failed')), saveRequirements: vi.fn() };
    const materials = useWorldSimulationMaterials(adapter); materials.reload();
    materials.updateDraft('entities', '[{"id":"E-user"}]'); materials.reload({ preserveDirty: true });
    expect(materials.modules.entities.draft).toBe('[{"id":"E-user"}]'); expect(materials.modules.entities.dirty).toBe(true);
    await expect(materials.save('entities')).resolves.toBe(false);
    expect(materials.modules.entities.dirty).toBe(true); expect(materials.modules.entities.draft).toBe('[{"id":"E-user"}]'); expect(materials.modules.entities.error).toContain('host save failed');
  });
});
