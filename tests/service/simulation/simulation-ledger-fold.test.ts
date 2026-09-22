import { describe, expect, it } from 'vitest';

import { buildDefaultWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/defaults';
import { WORLD_SIMULATION_STATE_FIELD_ACU } from '../../../src/service/simulation/agent/agent-model';
import {
  appendWorldSimulationCommitChain_ACU,
  foldWorldSimulationLedger_ACU,
} from '../../../src/service/simulation/simulation-ledger-fold';
import { buildWorldSimulationBucketKey_ACU, resolveWorldSimulationAnchor_ACU } from '../../../src/service/simulation/simulation-store';
import type { WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';

function assistant(mes: string, swipeId = 0) {
  return { is_user: false, message_id: mes, mes, swipe_id: swipeId };
}

describe('世界推演账本折叠', () => {
  it('提交 delta 叠加后等于新账本，删掉锚点楼后回到基线', () => {
    const chat = [{}, assistant('第一楼'), assistant('第二楼')];
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const before = envelope.ledger;
    const next: WorldSimulationLedger_ACU = {
      ...before,
      revision: before.revision + 1,
      clock: { ...before.clock, day: before.clock.day + 1, storyTime: '次日' },
    };
    const anchor = resolveWorldSimulationAnchor_ACU(2, chat);
    appendWorldSimulationCommitChain_ACU({
      chat,
      messageIndex: 2,
      anchor,
      beforeLedger: before,
      nextLedger: next,
      evidenceRefs: ['e1'],
      updatedAt: 10,
      checkpointIndex: null,
      beforeArchive: { schemaVersion: 1, records: {} },
      nextArchive: { schemaVersion: 1, records: { arc: { archiveRef: 'arc', day: 1, oneLine: '北岭塌方已归档', fingerprint: 'fp', detail: '' } as never } },
    });

    const folded = foldWorldSimulationLedger_ACU(chat);
    expect(folded?.ledger.revision).toBe(next.revision);
    expect(folded?.ledger.clock.storyTime).toBe('次日');
    expect(folded?.evidenceRefs).toEqual(['e1']);
    expect(JSON.stringify(chat[2])).toContain('北岭塌方已归档');

    const withoutTail = chat.slice(0, 2);
    expect(foldWorldSimulationLedger_ACU(withoutTail)).toBeNull();
  });

  it('另一 swipe 的分桶不进入当前折叠', () => {
    const chat = [assistant('正文', 0)];
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const other = { ...anchor, swipeId: '1' };
    chat[0][WORLD_SIMULATION_STATE_FIELD_ACU] = {
      schemaVersion: 1,
      entries: {
        [buildWorldSimulationBucketKey_ACU(other)]: {
          anchor: other,
          value: { ...envelope.ledger, revision: 9 },
          updatedAt: 1,
        },
      },
    };
    expect(foldWorldSimulationLedger_ACU(chat)).toBeNull();
  });

  it('旧的全量账本在读取时当成基线', () => {
    const chat = [assistant('旧楼')];
    const ledger = buildDefaultWorldSimulationEnvelope_ACU().ledger;
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    chat[0][WORLD_SIMULATION_STATE_FIELD_ACU] = {
      schemaVersion: 1,
      entries: { [buildWorldSimulationBucketKey_ACU(anchor)]: { anchor, value: ledger, updatedAt: 1 } },
    };
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.revision).toBe(ledger.revision);
    expect(chat[0][WORLD_SIMULATION_STATE_FIELD_ACU].entries[buildWorldSimulationBucketKey_ACU(anchor)].value.schemaVersion).toBe(ledger.schemaVersion);
  });
});
