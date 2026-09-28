import { describe, expect, it } from 'vitest';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU, worldSimulationAgentNativeTools_ACU, worldSimulationCanReadAddress_ACU } from '../../../../src/service/simulation/agent/agent-catalog';
import { agentNativeTools_ACU } from '../../../../src/service/ai/native-tool';
import { buildCustomApiRequestBody_ACU } from '../../../../src/service/ai/api-call';

describe('格林推演角色工具白名单', () => {
  it('按角色目录生成最终 provider 工具集合', () => {
    expect(() => worldSimulationAgentNativeTools_ACU('unknown' as never)).toThrow('WORLD_SIMULATION_AGENT_PROFILE_INVALID');
    expect(worldSimulationAgentNativeTools_ACU('world-director')).toEqual(['read', 'search']);
    expect(worldSimulationAgentNativeTools_ACU('lore-researcher')).toEqual(['read', 'search']);
    expect(worldSimulationAgentNativeTools_ACU('timekeeper')).toEqual(['read', 'write_sql']);
    expect(worldSimulationAgentNativeTools_ACU('undercurrent-analyst')).toEqual(['read', 'write_sql']);
    expect(worldSimulationAgentNativeTools_ACU('dramatis-keeper')).toEqual(['read', 'write_sql']);
    expect(worldSimulationAgentNativeTools_ACU('guidance-composer')).toEqual(['read', 'write_sql']);
    expect(worldSimulationAgentNativeTools_ACU('causality-reviewer')).toEqual(['read']);
    expect(worldSimulationAgentNativeTools_ACU('world-stage-planner')).toEqual(['read']);
  });

  it('仅资料写入角色获得 write_sql，不让普通角色继承 search', () => {
    for (const definition of WORLD_SIMULATION_AGENT_CATALOG_ACU) {
      const tools = worldSimulationAgentNativeTools_ACU(definition.name);
      expect(tools).toContain('read');
      expect(tools.includes('search')).toBe(definition.name === 'world-director' || definition.name === 'lore-researcher');
      expect(tools.includes('write_sql')).toBe(['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer'].includes(definition.name));
    }
  });

  it('普通角色仅精读自身和强相关资料，研究员与导演保留例外', () => {
    const canRead = worldSimulationCanReadAddress_ACU;
    expect(canRead('unknown' as never, 'anchor:message')).toBe(false);
    expect(canRead('unknown' as never, 'field:clock:singleton')).toBe(false);
    expect(canRead('timekeeper', 'anchor:message')).toBe(true);
    expect(canRead('timekeeper', 'field:clock:singleton')).toBe(true);
    expect(canRead('timekeeper', 'field:actors:actor-1')).toBe(false);
    expect(canRead('undercurrent-analyst', 'actors:actor-1')).toBe(true);
    expect(canRead('undercurrent-analyst', 'field:rumors:rumor-1:fact')).toBe(true);
    expect(canRead('undercurrent-analyst', 'worldbook:entry:secret')).toBe(false);
    expect(canRead('chronicler', 'chronicle-archive:arc-1')).toBe(true);
    expect(canRead('guidance-composer', 'ledger:current')).toBe(true);
    expect(canRead('guidance-composer', 'player:current')).toBe(true);
    expect(canRead('causality-reviewer', 'candidates:current')).toBe(true);
    expect(canRead('causality-reviewer', 'web:url:https://example.com')).toBe(false);
    expect(canRead('world-director', 'web:url:https://example.com')).toBe(true);
    expect(canRead('lore-researcher', 'web:url:https://example.com')).toBe(true);
    for (const address of ['actors:', 'field:actors', 'actors:a:b', 'field:actors:a:b:c']) {
      expect(canRead('dramatis-keeper', address)).toBe(false);
    }
  });

  it('provider 请求体中的工具定义与角色白名单一致', () => {
    for (const definition of WORLD_SIMULATION_AGENT_CATALOG_ACU) {
      const body = buildCustomApiRequestBody_ACU([{ role: 'user', content: '核对资料' }],
        { url: 'https://api.example.com', model: 'gpt' },
        { tools: agentNativeTools_ACU(worldSimulationAgentNativeTools_ACU(definition.name)) });
      expect((body.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name))
        .toEqual(worldSimulationAgentNativeTools_ACU(definition.name));
      if (definition.kind === 'specialist' || definition.kind === 'reviewer') {
        expect(JSON.stringify(body.tools)).not.toContain('"name":"search"');
      }
    }
  });
});
