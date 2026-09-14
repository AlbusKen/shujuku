import { describe, expect, it, vi } from 'vitest';
import { ContinuationTakeoverAssessor_ACU } from '../../../src/service/continuation/continuation-takeover-assessor';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';

const stage: any = { stageId: 'stage-1', completedTurns: 0 };
const revision: any = { revision: 1, outline: { nodes: [{ turns: [{ id: 'turn-1', goal: '通过门禁' }] }] } };

describe('ContinuationTakeoverAssessor_ACU', () => {
  it('固定注入外部正文并只接受严格 assessment JSON', async () => {
    const callInternalAi = vi.fn(async () => '{"targetMessageIndex":3,"disposition":"continue_current_stage","satisfiedTurnIds":["turn-1"],"evidenceMessageIndexes":[2],"requiresStoryArcRevision":false,"reason":"第二楼已写出通过门禁。"}');
    const assessor = new ContinuationTakeoverAssessor_ACU({ callInternalAi: callInternalAi as any, resolveApiPreset: (() => ({ presetName: '', source: 'current', reason: 'current_configuration' })) as any });
    const result = await assessor.assess({ settings: buildDefaultContinuationSettings_ACU(), stage, revision, snapshot: { hooks: [], infoGap: [], chronology: [], storyArc: [], revisions: {} } as any, sourceStartMessageIndex: 1, targetMessageIndex: 3, instruction: '从这里接管', externalMessages: [{ index: 2, text: '外部正文' }, { index: 3, text: '目标正文' }], createIdentity: () => ({ source: 'takeover_assessment', requestId: 'r1', chatIdentity: 'chat-a', taskId: 'task-1', stageId: 'stage-1', revision: 1 }), isCurrent: () => true });
    expect(result).toMatchObject({ disposition: 'continue_current_stage', satisfiedTurnIds: ['turn-1'] });
    expect(callInternalAi.mock.calls[0][0][1].content).toContain('[UNTRUSTED_EXTERNAL_STORY]');
  });
});
