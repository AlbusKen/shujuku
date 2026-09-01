import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/plot/plot-logic', () => ({
  getCurrentRuntimePlotPresetName_ACU: vi.fn(),
}));
vi.mock('../../../src/service/settings/api-preset-service', () => ({
  resolveApiConfigByPreset_ACU: vi.fn(),
}));

import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU } from '../../../src/service/continuation/model';
import { resolveContinuationApiPreset_ACU } from '../../../src/service/continuation/api-preset';
import { FINAL_REVIEWER_PROMPT_SOURCE_MAP_ACU } from '../../../src/service/continuation/agent/agent-defaults';
import {
  renderContinuationPrompt_ACU,
  restoreContinuationPromptDefault_ACU,
} from '../../../src/service/continuation/prompt-template';

async function expectAsyncCode_ACU(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    expect((error as ContinuationValidationError_ACU).error.code).toBe(code);
    return;
  }
  throw new Error(`Expected validation error ${code}`);
}

const apiConfig = { url: 'https://example.invalid', apiKey: '', model: 'test', useMainApi: false, max_tokens: 128, temperature: 1, bodyParams: '', excludeBodyParams: '', requestHeaders: '' };

describe('continuation prompt templates', () => {
  it('resolves only placeholders that are actually present and preserves unknown text', async () => {
    const origin = vi.fn(() => 'initial instruction');
    const worldbook = vi.fn(() => 'must not be read');

    const rendered = await renderContinuationPrompt_ACU(
      [{ role: 'user', content: '$ORIGIN_INSTRUCTION / $ORIGIN_INSTRUCTION / $NOT_A_TOKEN' }],
      { $ORIGIN_INSTRUCTION: origin, $1: worldbook },
      'outline_prompt',
    );

    expect(rendered.messages).toEqual([{ role: 'user', content: 'initial instruction / initial instruction / $NOT_A_TOKEN' }]);
    expect(rendered.usedPlaceholders).toEqual(['$ORIGIN_INSTRUCTION']);
    expect(origin).toHaveBeenCalledTimes(1);
    expect(worldbook).not.toHaveBeenCalled();
  });

  it('does not resolve placeholders from disabled segments and rejects an all-disabled prompt', async () => {
    const disabledResolver = vi.fn(() => 'must not resolve');
    const enabledResolver = vi.fn(() => 'current instruction');

    await expect(renderContinuationPrompt_ACU([
      { role: 'system', content: '$1', enabled: false },
      { role: 'user', content: '$ORIGIN_INSTRUCTION', enabled: true },
    ], { $1: disabledResolver, $ORIGIN_INSTRUCTION: enabledResolver }, 'outline_prompt'))
      .resolves.toMatchObject({ messages: [{ role: 'user', content: 'current instruction' }], usedPlaceholders: ['$ORIGIN_INSTRUCTION'] });
    expect(disabledResolver).not.toHaveBeenCalled();
    expect(enabledResolver).toHaveBeenCalledOnce();

    await expectAsyncCode_ACU(
      () => renderContinuationPrompt_ACU([{ role: 'user', content: 'disabled', enabled: false }], {}, 'outline_prompt'),
      'CONTINUATION_PROMPT_EMPTY',
    );
  });

  it('uses empty text for absent optional data and rejects invalid custom prompt segments', async () => {
    await expect(renderContinuationPrompt_ACU([{ role: 'system', content: 'A $STORY_TAIL B' }], {}, 'turn_prompt'))
      .resolves.toMatchObject({ messages: [{ content: 'A  B' }] });
    await expectAsyncCode_ACU(
      () => renderContinuationPrompt_ACU([{ role: 'tool', content: 'invalid' }], {}, 'outline_prompt'),
      'CONTINUATION_PROMPT_INVALID',
    );
  });

  it('locks final-review prompt provenance and the imported review criteria', () => {
    expect(FINAL_REVIEWER_PROMPT_SOURCE_MAP_ACU).toEqual([
      {
        source: 'docs/Stitches_RebornV_东方辉针城.3.7f.plot-preset.json',
        sections: ['角色人设参考来源优先级', '角色卡怎么理解', '角色的情绪', '扮演角色时也要注意认知边界', '能力边界相关', '世界观锚定'],
      },
      {
        source: 'docs/奶龙推进v13.plot-preset.json',
        sections: ['legitimacy_check输出内容', '日常场景分析', '人物分析要求'],
      },
    ]);

    // V26 在 system 与任务段之间插入了故事时间一致性规则段，任务段按内容定位而不是按下标。
    const finalReviewer = buildDefaultContinuationSettings_ACU().agentPrompts.finalReviewer;
    const system = finalReviewer[0];
    const user = finalReviewer.find(segment => segment.content.includes('$USER_INTENT'))!;
    expect(system.content).toContain('角色人设参考来源优先级：角色卡（卡片简述和背景设定）> 前文剧情 > 已发生事件概览。');
    expect(system.content).toContain('公平但不冷漠：DM在规则上公平对待<user>和角色，但不用刻意制造障碍，只是不给<user>开绿灯。');
    expect(system.content).toContain('关系阶段变化需要主角和角色的双向互动+标志性事件');
    expect(system.content).toContain('角色控制权（用户只能控制自己的角色）、信息边界（角色只使用已知信息）、能力边界（行为在角色能力范围内）、世界规则（符合世界观的物理或魔法规则）、因果逻辑（行为与结果符合因果）。');
    expect(system.content).toContain('分析所有登场角色，不能遗漏；保留所有板块：基础信息+状态+心理+认知+行为预测+情绪优化+主动性。');
    expect(system.content).toContain('字段为 verdict、summary、emotionFindings、worldFindings、logicFindings、requiredFixes、preserve。');
    expect(user.content).toContain('$USER_INTENT');
    expect(user.content).toContain('$OUTLINE_WINDOW');
    expect(user.content).toContain('不要写正文、不要修改大纲、不要展示思维链。');
  });

  it('locks the fixed user-intent and complete-outline injection matrix', () => {
    const prompts = buildDefaultContinuationSettings_ACU().agentPrompts;
    const text = (segments: typeof prompts.main) => segments.map(segment => segment.content).join('\n');

    expect(text(prompts.arcArchitect)).toContain('$USER_INTENT');
    expect(text(prompts.arcArchitect)).toContain('$OUTLINE_WINDOW');
    expect(text(prompts.reviewer)).toContain('$USER_INTENT');
    expect(text(prompts.reviewer)).toContain('$OUTLINE_WINDOW');
    expect(text(prompts.mainlinePlanner)).toContain('$OUTLINE_WINDOW');
    expect(text(prompts.beatPlanner)).toContain('$OUTLINE_WINDOW');
    expect(text(prompts.mainlinePlanner)).not.toContain('$USER_INTENT');
    expect(text(prompts.beatPlanner)).not.toContain('$USER_INTENT');
    expect(text(prompts.maintainer)).not.toContain('$USER_INTENT');
    expect(text(prompts.maintainer)).not.toContain('$OUTLINE_WINDOW');
  });

  it('restores only the selected prompt default', () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.outlinePrompt = [{ role: 'user', content: 'custom outline', deletable: true }];
    settings.agentPrompts.main = [{ role: 'user', content: 'custom main', deletable: true }];
    settings.agentPrompts.reviewer = [{ role: 'user', content: 'custom reviewer', deletable: true }];
    settings.agentPrompts.finalReviewer = [{ role: 'user', content: 'custom final reviewer', deletable: true }];
    const restoredOutline = restoreContinuationPromptDefault_ACU(settings, 'outline');

    expect(restoredOutline.outlinePrompt[0].content).toContain('<stage_title>');
    expect(restoredOutline.agentPrompts.main[0].content).toBe('custom main');
    expect(restoredOutline.agentPrompts.reviewer[0].content).toBe('custom reviewer');
    expect(restoredOutline.agentPrompts.finalReviewer[0].content).toBe('custom final reviewer');
    expect(restoredOutline).toMatchObject({ apiPresetMode: 'current', maxAutomaticStages: 6 });

    const restoredMain = restoreContinuationPromptDefault_ACU(restoredOutline, 'agent_main');
    expect(restoredMain.agentPrompts.main[0].content).toContain('主控 Agent');
    expect(restoredMain.agentPrompts.reviewer[0].content).toBe('custom reviewer');

    const restoredFinalReviewer = restoreContinuationPromptDefault_ACU(restoredMain, 'agent_final_reviewer');
    expect(restoredFinalReviewer.agentPrompts.finalReviewer[0].content).toContain('发送前最终审查代理');
    expect(restoredFinalReviewer.agentPrompts.reviewer[0].content).toBe('custom reviewer');
  });
});

describe('continuation API preset resolution', () => {
  it('resolves current at each call with explicit source diagnostics', () => {
    let plotPreset = 'plot-a';
    const resolvePreset = vi.fn((name: string) => ({ resolved: true, apiMode: 'custom' as const, apiConfig, tavernProfile: name }));
    const dependencies = { resolvePreset };
    const settings = buildDefaultContinuationSettings_ACU();

    expect(resolveContinuationApiPreset_ACU(settings, 'outline_call', dependencies)).toMatchObject({ presetName: '', source: 'current', reason: 'current_configuration' });
    plotPreset = 'plot-b';
    expect(resolveContinuationApiPreset_ACU(settings, 'turn_call', dependencies)).toMatchObject({ presetName: '', source: 'current', reason: 'current_configuration' });
    expect(resolvePreset).toHaveBeenCalledWith('');
  });

  it('fails closed when a fixed preset is empty or unresolved', () => {
    const settings = { ...buildDefaultContinuationSettings_ACU(), apiPresetMode: 'fixed' as const, fixedApiPresetName: 'deleted' };
    const missing = { resolvePreset: () => ({ resolved: false, apiMode: 'custom' as const, apiConfig, tavernProfile: '' }) };

    expect(() => resolveContinuationApiPreset_ACU(settings, 'outline_call', missing)).toThrow(ContinuationValidationError_ACU);
    try { resolveContinuationApiPreset_ACU(settings, 'outline_call', missing); } catch (error) {
      expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_API_PRESET_MISSING');
    }

    expect(() => resolveContinuationApiPreset_ACU({ ...settings, fixedApiPresetName: '  ' }, 'turn_call', missing)).toThrow(ContinuationValidationError_ACU);
    try { resolveContinuationApiPreset_ACU({ ...settings, fixedApiPresetName: '  ' }, 'turn_call', missing); } catch (error) {
      expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_API_PRESET_MISSING');
    }
  });
});
