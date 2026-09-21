import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU } from '../../../../src/service/simulation/defaults';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU, WORLD_SIMULATION_AGENT_NAMES_ACU } from '../../../../src/service/simulation/agent/agent-catalog';
import { WORLD_SIMULATION_ENGINE_SEAMS_ACU, WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU, WORLD_SIMULATION_PROMPT_VERSION_ACU, WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU, buildDefaultWorldSimulationAgentPrompts_ACU, migrateWorldSimulationAgentPrompts_ACU, worldSimulationDirectorProtocolInstruction_ACU, worldSimulationPlannerProtocolInstruction_ACU, worldSimulationReviewerProtocolInstruction_ACU, worldSimulationSeamMarker_ACU, worldSimulationSpecialistProtocolInstruction_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { WORLD_SIMULATION_LEDGER_MODULES_ACU } from '../../../../src/service/simulation/model';
import { createWorldSimulationPlaceholderResolvers_ACU } from '../../../../src/service/simulation/agent/agent-placeholder-resolver';
import { parseWorldSimulationMainAction_ACU, parseWorldSimulationPlannerOutput_ACU, parseWorldSimulationReviewerResult_ACU, parseWorldSimulationSpecialistResult_ACU } from '../../../../src/service/simulation/agent/agent-protocol';
import { exportWorldSimulationPrompts_ACU, importWorldSimulationPrompts_ACU, renderWorldSimulationPrompt_ACU, validateWorldSimulationAgentPrompts_ACU } from '../../../../src/service/simulation/agent/prompt-template';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';

describe('世界推演提示词装配契约', () => {
  it('装配八角色及唯一有序固定 seam', () => {
    const prompts = validateWorldSimulationAgentPrompts_ACU(buildDefaultWorldSimulationAgentPrompts_ACU());
    expect(Object.keys(prompts)).toEqual([...WORLD_SIMULATION_AGENT_NAMES_ACU]);
    expect(WORLD_SIMULATION_AGENT_CATALOG_ACU).toHaveLength(8);
    expect(WORLD_SIMULATION_AGENT_NAMES_ACU).toEqual([
      'world-director', 'world-stage-planner', 'timekeeper', 'undercurrent-analyst',
      'dramatis-keeper', 'chronicler', 'causality-reviewer', 'lore-researcher',
    ]);
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
    const worldCollisions = { playerRegion: 'qingyang', playerContact: 'open' as const, secludedNote: null, collidedSeeds: ['seed-1'], ripeRumors: [] };
    const values = { task: '<x>&', history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '', worldState: {}, anchorMessage: '<anchor>', anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [], worldCandidates: [], worldCollisions, evidenceRegistry: snapshot, projectionPreview: {} };
    const resolvers = createWorldSimulationPlaceholderResolvers_ACU(values);
    const rendered = await renderWorldSimulationPrompt_ACU(prompt, 'world-director', resolvers);
    expect(rendered.messages.map(item => item.content).join('\n')).toContain('&lt;x&gt;&amp;');
    expect(rendered.messages.map(item => item.content).join('\n')).not.toMatch(/\$[A-Z][A-Z0-9_]*/);
    expect(resolvers['$WORLD_COLLISIONS']()).toBe(JSON.stringify(worldCollisions));
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
    expect(WORLD_SIMULATION_LEDGER_MODULES_ACU).toEqual(['clock', 'dimensions', 'seeds', 'actors', 'chronicle', 'guidance', 'rumors', 'player']);
    expect(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.planner.plan.expectedLedgerChanges.every((item) => (
      WORLD_SIMULATION_LEDGER_MODULES_ACU as readonly string[]
    ).includes(item))).toBe(true);
  });

  it('因果 reviewer 默认协议固化 verdict、finding 与候选接受约束', () => {
    const instruction = worldSimulationReviewerProtocolInstruction_ACU();
    const reviewerPrompt = buildDefaultWorldSimulationAgentPrompts_ACU()['causality-reviewer'].map(item => item.content).join('\n');
    expect(instruction).toContain('verdict 必须精确为 accept、revise、reject');
    expect(instruction).toContain('severity 必须精确为 blocking、major、minor');
    expect(instruction).toContain('accept 必须至少接受一个候选');
    expect(instruction).toContain('verdict 为 accept 时可额外包含 guidance');
    expect(instruction).toContain('"verdict":"accept"');
    expect(instruction).toContain('"verdict":"revise"');
    expect(instruction).toContain('"verdict":"reject"');
    expect(reviewerPrompt).toContain(instruction);
  });

  it('提示词 v7 含碰撞占位符、四拆分 specialist、并发派工与各角色动态世界硬约束', () => {
    expect(WORLD_SIMULATION_PROMPT_VERSION_ACU).toBe('world-simulation-v7');
    expect(buildDefaultWorldSimulationSettings_ACU().agentRunBudget.maxConcurrent).toBe(5);
    expect(WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].map(item => item.version)).toEqual([
      'world-simulation-v3', 'world-simulation-v4', 'world-simulation-v5', 'world-simulation-v6', 'world-simulation-v7',
    ]);
    expect(WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU.timekeeper.map(item => item.version)).toEqual(['world-simulation-v7']);
    const v5 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v5');
    const v6 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v6');
    const v7 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === WORLD_SIMULATION_PROMPT_VERSION_ACU);
    expect(v5?.fingerprint).toBe('3749:5e40f616');
    expect(v6?.fingerprint).toBe('3910:629ead1');
    expect(v6?.fingerprint).not.toBe(v5?.fingerprint);
    expect(v7?.fingerprint).not.toBe(v6?.fingerprint);
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const directorPrompt = prompts['world-director'].map(item => item.content).join('\n');
    const plannerPrompt = prompts['world-stage-planner'].map(item => item.content).join('\n');
    const timekeeperPrompt = prompts.timekeeper.map(item => item.content).join('\n');
    const undercurrentPrompt = prompts['undercurrent-analyst'].map(item => item.content).join('\n');
    const chroniclerPrompt = prompts.chronicler.map(item => item.content).join('\n');
    const reviewerPrompt = prompts['causality-reviewer'].map(item => item.content).join('\n');
    expect(directorPrompt).toContain('$WORLD_COLLISIONS');
    expect(plannerPrompt).toContain('$WORLD_COLLISIONS');
    expect(plannerPrompt).toContain('临界暗流');
    expect(worldSimulationPlannerProtocolInstruction_ACU()).toContain('$WORLD_COLLISIONS');

    const director = worldSimulationDirectorProtocolInstruction_ACU();
    expect(director).toContain('player:current');
    expect(director).toContain('rumors:current');
    expect(director).toContain('相互独立的推演事项必须在同一次 delegate');
    expect(director).toContain('优先按阶段计划 plannedSpecialists 派工');
    expect(director).toContain('可先放弃该模块更新');
    expect(director).toContain('"agentName":"timekeeper"');
    expect(directorPrompt).toContain('碰撞报告');
    expect(directorPrompt).toContain('secluded');
    expect(directorPrompt).toContain('clockAdvance');
    expect(directorPrompt).toContain('伴生');

    const timekeeper = worldSimulationSpecialistProtocolInstruction_ACU(
      'timekeeper',
      WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === 'timekeeper')!.writableModules,
    );
    expect(timekeeper).toContain('clockAdvance');
    expect(timekeeper).toContain('禁止直接写 day');
    expect(timekeeperPrompt).toContain(timekeeper);
    expect(timekeeperPrompt).toContain('只写入 clock');

    const undercurrent = worldSimulationSpecialistProtocolInstruction_ACU(
      'undercurrent-analyst',
      WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === 'undercurrent-analyst')!.writableModules,
    );
    expect(undercurrent).toContain('exposePolicy');
    expect(undercurrentPrompt).toContain(undercurrent);
    expect(undercurrentPrompt).toContain('只写入 dimensions 与 seeds');

    const dramatis = worldSimulationSpecialistProtocolInstruction_ACU(
      'dramatis-keeper',
      WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === 'dramatis-keeper')!.writableModules,
    );
    expect(dramatis).toContain('locationUpdatedAtDay');
    expect(dramatis).toContain('regionVisits');
    expect(dramatis).toContain('secluded');
    expect(dramatis).toContain('life');
    expect(dramatis).toContain('rumors');
    expect(dramatis).toContain('earliestRevealDay');

    const chronicler = worldSimulationSpecialistProtocolInstruction_ACU(
      'chronicler',
      WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === 'chronicler')!.writableModules,
    );
    expect(chronicler).toContain('chronicleArchive');
    expect(chronicler).toContain('目录中任一条目都可通过 read 工具按地址调阅详细信息');
    expect(chronicler).toContain('可省略 id/at');
    expect(chroniclerPrompt).toContain(chronicler);
    expect(chroniclerPrompt).toContain('归档职责');
    expect(director).toContain('chronicle-archive:');
    expect(director).toContain('seeds:{id}');

    const reviewer = worldSimulationReviewerProtocolInstruction_ACU();
    expect(reviewer).toContain('encounter');
    expect(reviewer).toContain('sourceId');
    expect(reviewer).toContain("contact='open'");
    expect(reviewerPrompt).toContain(reviewer);
    expect(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.reviewer.guidance.signals[0]).toMatchObject({
      voice: 'rumor',
      sourceId: expect.any(String),
    });
  });

  it('指纹迁移：旧默认替换为当前默认，自定义提示词保留', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    const previous = structuredClone(defaults);
    const stock = structuredClone(previous);
    const custom = structuredClone(previous);
    custom['world-director'][2].content = '用户 guidance：自定义动态世界';
    expect(migrateWorldSimulationAgentPrompts_ACU(custom, previous)['world-director'][2].content).toContain('自定义动态世界');
    expect(migrateWorldSimulationAgentPrompts_ACU(stock, previous)).toEqual(defaults);
  });

});
