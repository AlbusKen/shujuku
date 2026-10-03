import { describe, expect, it } from 'vitest';
import { buildDefaultContinuationAgentPrompts_ACU } from '../../../src/service/continuation/agent/agent-defaults';
import { buildContinuationAgentPromptsForMode_ACU, adaptContinuationAgentPromptsToToolMode_ACU } from '../../../src/service/continuation/agent/agent-prompt-mode';
import { buildDefaultWorldSimulationAgentPrompts_ACU } from '../../../src/service/simulation/agent/agent-defaults';
import { buildWorldSimulationAgentPromptsForMode_ACU, adaptWorldSimulationAgentPromptsToToolMode_ACU } from '../../../src/service/simulation/agent/agent-prompt-mode';

const features = [
  { name: '续写', stock: buildDefaultContinuationAgentPrompts_ACU, build: buildContinuationAgentPromptsForMode_ACU, adapt: adaptContinuationAgentPromptsToToolMode_ACU },
  { name: '推演', stock: buildDefaultWorldSimulationAgentPrompts_ACU, build: buildWorldSimulationAgentPromptsForMode_ACU, adapt: adaptWorldSimulationAgentPromptsToToolMode_ACU },
] as const;

describe.each(features)('$name 默认提示词模式', feature => {
  it.each(['json', 'tools'] as const)('%s 默认只描述当前模式的动作与交付', mode => {
    const prompts = feature.build(mode);
    const forbidden = mode === 'json'
      ? /函数调用|原生 write_sql|调用 (?:read|search|write_sql) 函数/
      : /输出(?:必须是一个|一个|契约)?\s*JSON(?: 对象)?|交(?:付)?(?:最终|契约)\s*JSON|以一个完整的 JSON 对象收尾|回复 NO_CHANGE/;
    const violations = Object.entries(prompts).flatMap(([role, segments]) => segments.flatMap((segment, index) =>
      segment.content.split('\n').filter(line => forbidden.test(line)).map(line => `${role}#${index}: ${line}`)));
    expect(violations).toEqual([]);
  });

  it.each(['json', 'tools'] as const)('三版默认完整匹配后映射为 %s，输入保持不变', mode => {
    for (const source of [feature.stock(), feature.build('json'), feature.build('tools')]) {
      const before = JSON.stringify(source);
      expect(feature.adapt(source as never, mode)).toEqual(feature.build(mode));
      expect(JSON.stringify(source)).toBe(before);
    }
  });
  it.each(['json', 'tools'] as const)('%s 映射保留重排、用户改写、追加与元数据', mode => {
    const stock = feature.stock();
    const expected = feature.build(mode);
    const input = Object.fromEntries(Object.entries(stock).map(([role, segments]) => [role,
      [...segments].reverse().map((segment, index) => ({ ...segment, enabled: index !== 0,
        ...(index === 1 ? { content: `${segment.content}\n用户改写` } : {}) })).concat([
          { role: 'user' as const, content: '用户追加', enabled: false, deletable: true },
        ]),
    ]));
    const before = JSON.stringify(input);
    const result = feature.adapt(input as never, mode);
    for (const [role, segments] of Object.entries(input)) {
      const target = (expected as Record<string, typeof segments>)[role];
      segments.forEach((segment, index) => {
        const output = (result as Record<string, typeof segments>)[role][index];
        expect(output).toEqual(index === 1 || index === segments.length - 1 ? segment
          : { ...segment, content: target[target.length - 1 - index].content });
      });
    }
    expect(JSON.stringify(input)).toBe(before);
  });

});
