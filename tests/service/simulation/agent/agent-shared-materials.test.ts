import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationAgentPrompt_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { splitWorldSimulationSubagentPrompt_ACU, renderWorldSimulationDirectorReads_ACU } from '../../../../src/service/simulation/agent/agent-shared-materials';

describe('世界推演子代理资料边界', () => {
  it('时间官保留时钟与锚点正文，目录和编年改到快照', () => {
    const split = splitWorldSimulationSubagentPrompt_ACU(buildDefaultWorldSimulationAgentPrompt_ACU('timekeeper'), 'timekeeper');
    const runtime = split.segments.find(segment => segment.content.includes('RUNTIME_CONTEXT'))!.content;
    expect(runtime).toContain('$WORLD_STATE');
    expect(runtime).toContain('$ANCHOR_MESSAGE');
    expect(runtime).not.toContain('$WORLD_CHRONICLE');
    expect(runtime).not.toContain('$WORLD_AGENT_CATALOG');
    expect(split.snapshotTemplate).toContain('编年：$WORLD_CHRONICLE');
    expect(split.snapshotTemplate).toContain('角色目录：$WORLD_AGENT_CATALOG');
    expect(split.snapshotTemplate).not.toContain('世界状态：$WORLD_STATE');
  });

  it('主会话已经读到的回执会附上，普通派工回执不会', () => {
    const text = renderWorldSimulationDirectorReads_ACU([
      { role: 'user', content: '{"kind":"read","address":"worldbook:entry:书:1","content":"顾雨涵全文"}' },
      { role: 'user', content: '{"outcome":"prepared"}' },
    ]);
    expect(text).toContain('顾雨涵全文');
    expect(text).not.toContain('prepared');
  });
});
