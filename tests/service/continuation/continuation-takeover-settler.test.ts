import { describe, expect, it, vi } from 'vitest';

import { ContinuationTakeoverSettler_ACU } from '../../../src/service/continuation/continuation-takeover-settler';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';

const snapshot: any = { hooks: [], infoGap: [], chronology: [], revisions: { hooks: 0, infoGap: 0, chronology: 0 } };

describe('ContinuationTakeoverSettler_ACU', () => {
  it('固定注入全部外部正文，并只返回既有资料写集', async () => {
    const callInternalAi = vi.fn(async () => '{"summary":"已结算","delta":{"expectedRevisions":{"hooks":0,"infoGap":0,"chronology":0},"hooks":[],"infoGap":[],"chronology":[]}}');
    const settler = new ContinuationTakeoverSettler_ACU({ callInternalAi: callInternalAi as any, resolveApiPreset: (() => ({ presetName: '', source: 'current', reason: 'current_configuration' })) as any });
    const result = await settler.settle({ settings: buildDefaultContinuationSettings_ACU(), snapshot, externalMessages: [{ index: 2, text: '外部正文甲' }, { index: 5, text: '外部正文乙' }], createIdentity: () => ({ source: 'takeover_assessment', requestId: 'settle-1', chatIdentity: 'chat-a', taskId: 'task-1', stageId: 'stage-1', revision: 1 }), isCurrent: () => true });

    expect(result.delta).toMatchObject({ hooks: [], infoGap: [], chronology: [] });
    expect(callInternalAi.mock.calls[0][0][1].content).toContain('楼 2');
    expect(callInternalAi.mock.calls[0][0][1].content).toContain('楼 5');
  });
});
