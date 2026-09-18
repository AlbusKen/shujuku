import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU } from '../../../../src/service/simulation/defaults';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU, WORLD_SIMULATION_AGENT_NAMES_ACU } from '../../../../src/service/simulation/agent/agent-catalog';
import { WORLD_SIMULATION_ENGINE_SEAMS_ACU, WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU, buildDefaultWorldSimulationAgentPrompts_ACU, migrateWorldSimulationAgentPrompts_ACU, worldSimulationDirectorProtocolInstruction_ACU, worldSimulationPlannerProtocolInstruction_ACU, worldSimulationSeamMarker_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { WORLD_SIMULATION_LEDGER_MODULES_ACU } from '../../../../src/service/simulation/model';
import { createWorldSimulationPlaceholderResolvers_ACU } from '../../../../src/service/simulation/agent/agent-placeholder-resolver';
import { parseWorldSimulationMainAction_ACU, parseWorldSimulationPlannerOutput_ACU, parseWorldSimulationReviewerResult_ACU, parseWorldSimulationSpecialistResult_ACU } from '../../../../src/service/simulation/agent/agent-protocol';
import { exportWorldSimulationPrompts_ACU, importWorldSimulationPrompts_ACU, renderWorldSimulationPrompt_ACU, validateWorldSimulationAgentPrompts_ACU } from '../../../../src/service/simulation/agent/prompt-template';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';

describe('世界推演提示词装配契约', () => {
  it('装配九角色及唯一有序固定 seam', () => {
    const prompts = validateWorldSimulationAgentPrompts_ACU(buildDefaultWorldSimulationAgentPrompts_ACU());
    expect(Object.keys(prompts)).toEqual([...WORLD_SIMULATION_AGENT_NAMES_ACU]);
    expect(WORLD_SIMULATION_AGENT_CATALOG_ACU).toHaveLength(9);
    for (const segments of Object.values(prompts)) {
      const positions = WORLD_SIMULATION_ENGINE_SEAMS_ACU.map(seam => segments.findIndex(segment => segment.content.includes(worldSimulationSeamMarker_ACU(seam))));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(positions).size).toBe(8);
    }
  });

  it('转义动态材料、拒绝缺失 resolver 与非法 seam', async () => {
    const prompt = buildDefaultWorldSimulationAgentPrompts_ACU()['world-director'];
    const registry = createWorldSimulationEvidenceRegistry_ACU('prompt');
    const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(registry);
    const values = { task: '<x>&', history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '', worldState: {}, anchorMessage: '<anchor>', anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [], worldCandidates: [], evidenceRegistry: snapshot, projectionPreview: {} };
    const resolvers = createWorldSimulationPlaceholderResolvers_ACU(values);
    const rendered = await renderWorldSimulationPrompt_ACU(prompt, 'world-director', resolvers);
    expect(rendered.messages.map(item => item.content).join('\n')).toContain('&lt;x&gt;&amp;');
    expect(rendered.messages.map(item => item.content).join('\n')).not.toMatch(/\$[A-Z][A-Z0-9_]*/);
    await expect(renderWorldSimulationPrompt_ACU(prompt, 'world-director', {})).rejects.toThrow(/resolver/);
    expect(() => validateWorldSimulationAgentPrompts_ACU({ ...buildDefaultWorldSimulationAgentPrompts_ACU(), 'world-director': prompt.slice(1) })).toThrow(/seam/);
  });

  it('导入导出、恢复默认迁移与协议示例闭合', () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('clock');
    recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'ledger:current', status: 'ok', summary: 'clock', exact: true });
    const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(registry);
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    expect(importWorldSimulationPrompts_ACU(exportWorldSimulationPrompts_ACU(defaults))).toEqual(defaults);
    const custom = structuredClone(defaults); custom['world-director'][2].content = '用户 guidance：自定义';
    expect(migrateWorldSimulationAgentPrompts_ACU(custom, {} as any)['world-director'][2].content).toContain('自定义');
    expect(buildDefaultWorldSimulationSettings_ACU().agentPrompts).toEqual(defaults);
    expect(parseWorldSimulationMainAction_ACU(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.main)).toMatchObject({ kind: 'delegate' });
    expect(parseWorldSimulationPlannerOutput_ACU(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.planner)).toMatchObject({ action: 'plan' });
    expect(parseWorldSimulationSpecialistResult_ACU(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.specialist, snapshot)).toMatchObject({ status: 'candidate' });
    expect(parseWorldSimulationReviewerResult_ACU(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.reviewer)).toMatchObject({ verdict: 'accept' });
  });

  it('director 协议明确无直接写权限是职责隔离，并要求空账本通过 specialist 初始化', () => {
    const instruction = worldSimulationDirectorProtocolInstruction_ACU();
    const directorPrompt = buildDefaultWorldSimulationAgentPrompts_ACU()['world-director'].map(item => item.content).join('\n');
    expect(instruction).toContain('writableModules=[] 是职责隔离，不是权限故障或阻断条件');
    expect(instruction).toContain('revision=0');
    expect(instruction).toContain('必须 delegate 给有对应 writableModules 的 specialist');
    expect(instruction).toContain('历史会话中的 MISSING_FIELD、REQUIRED_TEXT_LIST、INVALID_SPECIALIST_STATUS');
    expect(instruction).toContain('"reads":["ledger:current","summary:current"]');
    expect(directorPrompt).toContain('你没有直接 ledger patch 权限，但拥有取证、派工、审核与收敛权限；这不是故障');
  });

  it('规划协议指令固化账本模块白名单并禁止历史遗留命名', () => {
    const instruction = worldSimulationPlannerProtocolInstruction_ACU();
    expect(instruction).toContain(`plan.expectedLedgerChanges 只能使用这些账本模块：${WORLD_SIMULATION_LEDGER_MODULES_ACU.join(' | ')}`);
    expect(instruction).toContain('禁止使用 ledger、world_state、relationships');
    expect(WORLD_SIMULATION_LEDGER_MODULES_ACU).toEqual(['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance']);
    expect(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.planner.plan.expectedLedgerChanges.every((item) => (
      WORLD_SIMULATION_LEDGER_MODULES_ACU as readonly string[]
    ).includes(item))).toBe(true);
  });
});
