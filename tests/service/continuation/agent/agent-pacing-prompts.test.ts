import { describe, expect, it } from 'vitest';

import {
  buildDefaultAgentBeatPlannerPrompt_ACU,
  buildDefaultAgentFinalReviewerPrompt_ACU,
  buildDefaultAgentMaintainerPrompt_ACU,
  buildDefaultAgentMainlinePlannerPrompt_ACU,
  buildDefaultAgentMainPrompt_ACU,
  V26_FINAL_REVIEWER_CHRONOLOGY_RULES_ACU,
  V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU,
  V26_MAINTAINER_CHRONOLOGY_CONTRACT_ACU,
} from '../../../../src/service/continuation/agent/agent-defaults';
import { renderAgentTurnGuidance_ACU, renderAgentTurnPacingGuidance_ACU } from '../../../../src/service/continuation/agent/agent-placeholder-resolver';
import {
  buildDefaultContinuationSettings_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V28_ACU,
  V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU,
} from '../../../../src/service/continuation/defaults';

function promptText_ACU(segments: readonly { content: string; enabled: boolean }[]): string {
  return segments.filter(segment => segment.enabled).map(segment => segment.content).join('\n');
}

describe('continuation P0 pacing prompt contracts', () => {
  it('assembles the V24 outline contract under the current default version', () => {
    const settings = buildDefaultContinuationSettings_ACU();

    expect(settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V28_ACU);
    expect(settings.outlinePrompt.some(segment => segment.content === V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU)).toBe(true);
    expect(V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU).toContain('setup 与 cooldown 允许主线保持不动');
    expect(V24_OUTLINE_LONGFORM_PACING_CONTRACT_ACU).toContain('隔夜、数日后还是更久');
  });

  it('keeps the main Agent and planners subordinate to the selected pacing', () => {
    const main = promptText_ACU(buildDefaultAgentMainPrompt_ACU());
    const mainline = promptText_ACU(buildDefaultAgentMainlinePlannerPrompt_ACU());
    const beat = promptText_ACU(buildDefaultAgentBeatPlannerPrompt_ACU());
    const finalReviewer = promptText_ACU(buildDefaultAgentFinalReviewerPrompt_ACU());

    expect(main).toContain('setup/cooldown 必须允许主线 hold、安静闭合和自然时间流逝');
    expect(main).toContain('低压轮没有真实操作需要时不得为凑钩子强派');
    expect(main).not.toContain('必须加派 beat-planner');

    expect(mainline).toContain('setup：允许主线 hold');
    expect(mainline).toContain('主线增量（hold/micro/step/milestone）');
    expect(mainline).not.toContain('本轮的障碍必须比上一轮更高一层');

    expect(beat).toContain('揭示后可以完整结束');
    expect(beat).toContain('不是每轮都必须留钩子');
    expect(beat).not.toContain('本轮结尾至少落一个');

    expect(finalReviewer).toContain('【节奏、日常与时间审查】');
    expect(finalReviewer).toContain('只有“气氛放松”也判为 revise');
  });

  it('enforces the V26 chronology contract across maintainer, main agent, and final reviewer defaults', () => {
    const maintainer = promptText_ACU(buildDefaultAgentMaintainerPrompt_ACU());
    const main = promptText_ACU(buildDefaultAgentMainPrompt_ACU());
    const finalReviewer = promptText_ACU(buildDefaultAgentFinalReviewerPrompt_ACU());

    // 维护代理：结算故事时间事实，计划不得登记，空数组合法。
    expect(maintainer).toContain(V26_MAINTAINER_CHRONOLOGY_CONTRACT_ACU);
    expect(V26_MAINTAINER_CHRONOLOGY_CONTRACT_ACU).toContain('时间事实的唯一来源是真实正文');
    expect(V26_MAINTAINER_CHRONOLOGY_CONTRACT_ACU).toContain('timeAdvance / timeAnchor 只是待核对的计划');
    expect(V26_MAINTAINER_CHRONOLOGY_CONTRACT_ACU).toContain('chronology 输出空数组是合法结果');
    expect(V26_MAINTAINER_CHRONOLOGY_CONTRACT_ACU).toContain('evidenceIndexes');
    expect(V26_MAINTAINER_CHRONOLOGY_CONTRACT_ACU).toContain('$CHRONOLOGY');

    // 主 Agent：时间跳跃的最终指导义务——新锚、两项可感知变化、连续性桥梁。
    expect(main).toContain(V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU);
    expect(V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU).toContain('新的相对时间锚');
    expect(V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU).toContain('至少两项可感知变化');
    expect(V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU).toContain('连续性桥梁');
    expect(V26_MAIN_AGENT_CHRONOLOGY_RULE_ACU).toContain('不得用摘要跳过');

    // 终审：时间一致性审查规则——恢复周期、旅行时间、时间跳跃义务缺项判 revise。
    expect(finalReviewer).toContain(V26_FINAL_REVIEWER_CHRONOLOGY_RULES_ACU);
    expect(V26_FINAL_REVIEWER_CHRONOLOGY_RULES_ACU).toContain('伤势恢复速度');
    expect(V26_FINAL_REVIEWER_CHRONOLOGY_RULES_ACU).toContain('训练/生产/经营周期');
    expect(V26_FINAL_REVIEWER_CHRONOLOGY_RULES_ACU).toContain('旅行距离与耗时');
    expect(V26_FINAL_REVIEWER_CHRONOLOGY_RULES_ACU).toContain('缺任一项判 revise');
    expect(V26_FINAL_REVIEWER_CHRONOLOGY_RULES_ACU).toContain('时间仍连续时不凭空要求跳跃');
  });

  it('renders four distinct pacing scenarios without turning low-pressure turns into conflict turns', () => {
    const setup = renderAgentTurnPacingGuidance_ACU('setup');
    const cooldown = renderAgentTurnPacingGuidance_ACU('cooldown');
    const pressure = renderAgentTurnPacingGuidance_ACU('pressure');
    const turn = renderAgentTurnPacingGuidance_ACU('turn');

    expect(setup).toContain('允许主线 hold');
    expect(setup).toContain('隔夜、数日后或更久');
    expect(setup).toContain('允许安静闭合');

    expect(cooldown).toContain('允许主线 hold');
    expect(cooldown).toContain('完整处理上一波');
    expect(cooldown).toContain('允许安静闭合');

    expect(pressure).toContain('只推进一个冲突');
    expect(turn).toContain('已经埋过的东西');
  });

  it('本轮节奏段渲染四维标记、系统补全提示与长时间跳跃义务', () => {
    const jump = renderAgentTurnGuidance_ACU({ id: 't1', goal: 'g', pacing: 'setup', function: 'training', mainlineDelta: 'hold', timeAdvance: 'weeks', timeAnchor: '入门后第二个月', inferred: ['mainlineDelta'] });
    expect(jump).toContain('本轮节奏：setup');
    expect(jump).toContain('叙事功能=training');
    expect(jump).toContain('时间锚=入门后第二个月');
    expect(jump).toContain('mainlineDelta 是系统按节奏档保守补全的推断值');
    expect(jump).toContain('时间跳跃义务');
    expect(jump).toContain('read $CHRONOLOGY');
    expect(jump).toContain('本轮主线允许停驻');

    const tight = renderAgentTurnGuidance_ACU({ id: 't2', goal: 'g', pacing: 'pressure', function: 'conflict', mainlineDelta: 'step', timeAdvance: 'continuous' });
    expect(tight).not.toContain('时间跳跃义务');
    expect(tight).not.toContain('系统');
    expect(renderAgentTurnGuidance_ACU(null)).toContain('尚无可执行的大纲轮次');
  });
});
