import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginWorldSimulationInternalAiMainApiInvocation_ACU,
  beginWorldSimulationInternalAiRequest_ACU,
  bindWorldSimulationInternalAiGenerationStarted_ACU,
  endWorldSimulationInternalAiMainApiInvocation_ACU,
  hasWorldSimulationInternalAiInflight_ACU,
  settleWorldSimulationInternalAiRequest_ACU,
  resetWorldSimulationInternalAiEventsForTests_ACU,
} from '../../../src/service/simulation/simulation-internal-ai-events';

describe('世界推演内部 AI 事件在途判定', () => {
  beforeEach(() => resetWorldSimulationInternalAiEventsForTests_ACU());

  it('无主 API 活动且无已绑定 seq 时不算在途', () => {
    expect(hasWorldSimulationInternalAiInflight_ACU()).toBe(false);
    beginWorldSimulationInternalAiRequest_ACU({ requestId: 'run:r:1', runId: 'run', role: 'world-director' });
    expect(hasWorldSimulationInternalAiInflight_ACU()).toBe(false);
  });

  it('主 API 同步归属窗口打开时算在途，窗口关闭且未绑定 seq 后释放', () => {
    beginWorldSimulationInternalAiRequest_ACU({ requestId: 'run:r:1', runId: 'run', role: 'world-director' });
    beginWorldSimulationInternalAiMainApiInvocation_ACU('run:r:1');
    expect(hasWorldSimulationInternalAiInflight_ACU()).toBe(true);
    endWorldSimulationInternalAiMainApiInvocation_ACU('run:r:1');
    expect(hasWorldSimulationInternalAiInflight_ACU()).toBe(false);
  });

  it('已绑定 generationSeq 但 ENDED 未消费前算在途；settle 不提前释放已绑定记录', () => {
    beginWorldSimulationInternalAiRequest_ACU({ requestId: 'run:r:1', runId: 'run', role: 'world-analyst' });
    beginWorldSimulationInternalAiMainApiInvocation_ACU('run:r:1');
    const record = bindWorldSimulationInternalAiGenerationStarted_ACU(42);
    endWorldSimulationInternalAiMainApiInvocation_ACU('run:r:1');
    expect(record).not.toBeNull();
    expect(hasWorldSimulationInternalAiInflight_ACU()).toBe(true);
    settleWorldSimulationInternalAiRequest_ACU('run:r:1');
    expect(hasWorldSimulationInternalAiInflight_ACU()).toBe(true);
  });

  it('settle 后未绑定 seq 的记录被清除，不再阻止触发', () => {
    beginWorldSimulationInternalAiRequest_ACU({ requestId: 'run:r:1', runId: 'run', role: 'world-director' });
    beginWorldSimulationInternalAiMainApiInvocation_ACU('run:r:1');
    endWorldSimulationInternalAiMainApiInvocation_ACU('run:r:1');
    settleWorldSimulationInternalAiRequest_ACU('run:r:1');
    expect(hasWorldSimulationInternalAiInflight_ACU()).toBe(false);
  });
});
