import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationSettings_ACU } from '../../../../src/service/simulation/defaults';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU, WORLD_SIMULATION_AGENT_NAMES_ACU, worldSimulationDirectorVisibleCatalog_ACU } from '../../../../src/service/simulation/agent/agent-catalog';
import { WORLD_SIMULATION_ENGINE_SEAMS_ACU, WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU, WORLD_SIMULATION_PROMPT_VERSION_ACU, WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU, buildDefaultWorldSimulationAgentPrompts_ACU, migrateWorldSimulationAgentPrompts_ACU, worldSimulationDirectorProtocolInstruction_ACU, worldSimulationPlannerProtocolInstruction_ACU, worldSimulationReviewerProtocolInstruction_ACU, worldSimulationSeamMarker_ACU, worldSimulationSpecialistProtocolInstruction_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { WORLD_SIMULATION_LEDGER_MODULES_ACU } from '../../../../src/service/simulation/model';
import { createWorldSimulationPlaceholderResolvers_ACU } from '../../../../src/service/simulation/agent/agent-placeholder-resolver';
import { parseWorldSimulationMainAction_ACU, parseWorldSimulationPlannerOutput_ACU, parseWorldSimulationReviewerResult_ACU, parseWorldSimulationSpecialistResult_ACU } from '../../../../src/service/simulation/agent/agent-protocol';
import { exportWorldSimulationPrompts_ACU, importWorldSimulationPrompts_ACU, renderWorldSimulationPrompt_ACU, validateWorldSimulationAgentPrompts_ACU, validateWorldSimulationPromptSegments_ACU } from '../../../../src/service/simulation/agent/prompt-template';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';

describe('世界推演提示词装配契约', () => {
  it('装配九角色、主 Agent 可见全部角色，以及唯一有序固定 seam', () => {
    const prompts = validateWorldSimulationAgentPrompts_ACU(buildDefaultWorldSimulationAgentPrompts_ACU());
    expect(Object.keys(prompts)).toEqual([...WORLD_SIMULATION_AGENT_NAMES_ACU]);
    expect(WORLD_SIMULATION_AGENT_CATALOG_ACU).toHaveLength(9);
    expect(worldSimulationDirectorVisibleCatalog_ACU()).toHaveLength(9);
    expect(WORLD_SIMULATION_AGENT_NAMES_ACU).toEqual([
      'world-director', 'world-stage-planner', 'timekeeper', 'undercurrent-analyst',
      'dramatis-keeper', 'chronicler', 'causality-reviewer', 'guidance-composer', 'lore-researcher',
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
    expect(parseWorldSimulationMainAction_ACU(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.main)).toMatchObject({ kind: 'open_round', focus: '时间推进与暗流压力' });
    expect(parseWorldSimulationPlannerOutput_ACU(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.planner)).toMatchObject({ action: 'plan' });
    expect(parseWorldSimulationSpecialistResult_ACU(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.specialist, snapshot)).toMatchObject({ status: 'candidate' });
    expect(parseWorldSimulationReviewerResult_ACU(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.reviewer)).toMatchObject({ verdict: 'accept' });
  });

  it('director 协议明确无直接写权限是职责隔离，并要求空账本通过 specialist 初始化', () => {
    const instruction = worldSimulationDirectorProtocolInstruction_ACU();
    const directorPrompt = buildDefaultWorldSimulationAgentPrompts_ACU()['world-director'].map(item => item.content).join('\n');
    expect(instruction).toContain('writableModules=[] 是职责隔离，不是权限故障或阻断条件');
    expect(instruction).toContain('revision=0');
    expect(instruction).toContain('输出 open_round');
    expect(instruction).toContain('历史会话中的 MISSING_FIELD、REQUIRED_TEXT_LIST、INVALID_SPECIALIST_STATUS');
    expect(instruction).toContain('"reads":["ledger:current","summary:current"]');
    expect(directorPrompt).toContain('你没有直接 ledger patch 权限');
    expect(directorPrompt).toContain('常规推演取证后输出 open_round');
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
    expect(instruction).toContain('不得输出 guidance');
    expect(instruction).not.toContain('verdict 为 accept 时必须包含 guidance');
    expect(instruction).toContain('"verdict":"accept"');
    expect(instruction).toContain('"verdict":"revise"');
    expect(instruction).toContain('"verdict":"reject"');
    expect(reviewerPrompt).toContain(instruction);
  });

  it('提示词 v14 固化信息渠道纪律，并把 v9~v13 默认指纹保留为历史版本', () => {
    expect(WORLD_SIMULATION_PROMPT_VERSION_ACU).toBe('world-simulation-v14');
    expect(buildDefaultWorldSimulationSettings_ACU().agentRunBudget).toMatchObject({ maxIterations: 6, maxExtraReads: 1, maxConcurrent: 5 });
    expect(WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].map(item => item.version)).toEqual([
      'world-simulation-v3', 'world-simulation-v4', 'world-simulation-v5', 'world-simulation-v6', 'world-simulation-v7', 'world-simulation-v8', 'world-simulation-v9', 'world-simulation-v10', 'world-simulation-v11', 'world-simulation-v12', 'world-simulation-v13', 'world-simulation-v14',
    ]);
    expect(WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU.timekeeper.map(item => item.version)).toEqual(['world-simulation-v7', 'world-simulation-v8', 'world-simulation-v9', 'world-simulation-v10', 'world-simulation-v11', 'world-simulation-v12', 'world-simulation-v13', 'world-simulation-v14']);
    const v8 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v8');
    const v9 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v9');
    const v10 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v10');
    const v11 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v11');
    const v12 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v12');
    const v13 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v13');
    const v14 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === WORLD_SIMULATION_PROMPT_VERSION_ACU);
    expect(v8?.fingerprint).toBe('4767:87f876e3');
    expect(v9?.fingerprint).toBe('4777:cd4e92ac');
    expect(v9?.fingerprint).not.toBe(v8?.fingerprint);
    expect(v10?.fingerprint).toBe('4486:cf7dd826');
    expect(v11?.fingerprint).toBe('4486:cf7dd826');
    expect(v12?.fingerprint).toBe('4563:97559198');
    expect(v13?.fingerprint).toBe('4794:f45a80de');
    expect(v14).toBeDefined();
    expect(v14?.fingerprint).toBe(v13?.fingerprint);
    const composerV10 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === 'world-simulation-v10');
    const composerV11 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === 'world-simulation-v11');
    const composerV12 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === 'world-simulation-v12');
    const composerV13 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === 'world-simulation-v13');
    const composerV14 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === WORLD_SIMULATION_PROMPT_VERSION_ACU);
    expect(composerV10?.fingerprint).toBe('3363:eb46ac19');
    expect(composerV11?.fingerprint).toBe('4082:ac59da90');
    expect(composerV13?.fingerprint).toBe('4498:a3457f28');
    expect(composerV14?.fingerprint).toBe(composerV13?.fingerprint);
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const directorPrompt = prompts['world-director'].map(item => item.content).join('\n');
    const plannerPrompt = prompts['world-stage-planner'].map(item => item.content).join('\n');
    const timekeeperPrompt = prompts.timekeeper.map(item => item.content).join('\n');
    const undercurrentPrompt = prompts['undercurrent-analyst'].map(item => item.content).join('\n');
    const chroniclerPrompt = prompts.chronicler.map(item => item.content).join('\n');
    const reviewerPrompt = prompts['causality-reviewer'].map(item => item.content).join('\n');
    expect(directorPrompt).toContain('$WORLD_USER_REQUIREMENTS');
    expect(directorPrompt).toContain('$WORLD_COLLISIONS');
    expect(plannerPrompt).toContain('$WORLD_COLLISIONS');
    expect(plannerPrompt).toContain('临界暗流');
    expect(worldSimulationPlannerProtocolInstruction_ACU()).toContain('$WORLD_COLLISIONS');

    const director = worldSimulationDirectorProtocolInstruction_ACU();
    expect(director).toContain('player:current');
    expect(director).toContain('rumors:current');
    expect(director).toContain('open_round');
    expect(director).toContain('用户明确要求维护某份资料时才 delegate');
    expect(director).toContain('"agentName":"dramatis-keeper"');
    expect(director).toContain('dispatchChronicler');
    expect(directorPrompt).toContain('secluded');
    expect(directorPrompt).toContain('正文对话只是观察素材');
    expect(directorPrompt).toContain('固定工作流');
    expect(director).not.toContain('编年与归档派 chronicler');

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
    expect(chroniclerPrompt).toContain('不是每轮常规角色');
    expect(reviewerPrompt).toContain('不得输出 guidance');
    expect(reviewerPrompt).not.toContain('guidance 是幕后→台面的唯一通道');
    const composerPrompt = prompts['guidance-composer'].map(item => item.content).join('\n');
    expect(composerPrompt).toContain('sourceId');
    expect(composerPrompt).toContain('80');
    expect(composerPrompt).toContain('投影选题标准');
    expect(composerPrompt).toContain('正文尚未描写');
    expect(composerPrompt).toContain('禁止把正文已发生事件做记录、总结或评价');
    const composerInstruction = worldSimulationSpecialistProtocolInstruction_ACU(
      'guidance-composer',
      WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === 'guidance-composer')!.writableModules,
    );
    expect(composerInstruction).toContain('选题纪律');
    expect(composerInstruction).toContain('正文剧情所在位置附近、或与正文强相关、但正文尚未描写');
    expect(composerPrompt).toContain('数量与注入门槛');
    expect(composerPrompt).toContain('宁缺毋滥');
    expect(composerPrompt).toContain('secluded 时 rumor 语态禁止产出');
    expect(composerPrompt).toContain('excludedFacts');
    expect(directorPrompt).toContain('focus 写法');
    expect(directorPrompt).toContain('禁止「更新世界动态」这类空泛套话');
    expect(timekeeperPrompt).toContain('时间判定细则');
    expect(timekeeperPrompt).toContain('正文无时间流逝证据时 days=0');
    expect(undercurrentPrompt).toContain('维度细则');
    expect(undercurrentPrompt).toContain('catalyst 必须写清什么条件触发升级或显形');
    expect(undercurrentPrompt).toContain('只前进不后退');
    const dramatisPrompt = prompts['dramatis-keeper'].map(item => item.content).join('\n');
    expect(dramatisPrompt).toContain('行动者细则');
    expect(dramatisPrompt).toContain('NPC 言行不得超出 knownFacts 与 informationSources 可达范围');
    expect(dramatisPrompt).toContain('每条 knownFact 都必须能由 informationSources 中至少一个具体渠道支撑');
    expect(dramatisPrompt).toContain('亲历、目击、听闻、阅读、转述或可验证推断');
    expect(dramatisPrompt).toContain('传闻细则');
    expect(chroniclerPrompt).toContain('编年细则');
    expect(reviewerPrompt).toContain('审核清单逐项过');
    expect(reviewerPrompt).toContain('仅因事实客观存在、读者知道或账本有记录而赋知');
    expect(reviewerPrompt).toContain('空壳条目按 MISSING_FIELD 打回');
    expect(undercurrent).toContain('rationale（依据摘要）、catalyst（催化条件）');
    expect(undercurrent).toContain('证据不足时不要新建该条目，把缺口写进 uncertainties');
    expect(undercurrent).not.toContain('其余字段由服务端按缺省补齐');
    expect(director).toContain('chronicle-archive:');
    expect(director).toContain('seeds:{id}');

    const reviewer = worldSimulationReviewerProtocolInstruction_ACU();
    expect(reviewer).toContain('不得输出 guidance');
    expect(reviewerPrompt).toContain(reviewer);
    expect(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.reviewer).not.toHaveProperty('guidance');
  });

  it('指纹迁移：旧默认替换为当前默认，自定义提示词保留', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    const previous = structuredClone(defaults);
    const stock = structuredClone(previous);
    const custom = structuredClone(previous);
    custom['world-director'][2].content = '以下是用户对任务曾经提过的要求：\n$WORLD_USER_REQUIREMENTS\n用户附加：自定义动态世界';
    expect(migrateWorldSimulationAgentPrompts_ACU(custom, previous)['world-director'][2].content).toContain('自定义动态世界');
    expect(migrateWorldSimulationAgentPrompts_ACU(stock, previous)).toEqual(defaults);
    const restoredV8Guidance = structuredClone(defaults);
    restoredV8Guidance['world-director'][2] = { role: 'system', content: '用户 guidance：$WORLD_USER_GUIDANCE', enabled: true, deletable: true, pinned: false };
    expect(migrateWorldSimulationAgentPrompts_ACU(restoredV8Guidance, {})['world-director'][2].content).toContain('$WORLD_USER_GUIDANCE');
    const customGuidance = structuredClone(defaults);
    customGuidance['world-director'][2] = { role: 'system', content: '用户 guidance：$WORLD_USER_GUIDANCE\n用户附加：自定义 guidance', enabled: true, deletable: true, pinned: false };
    expect(migrateWorldSimulationAgentPrompts_ACU(customGuidance, {})['world-director'][2].content).toContain('$WORLD_USER_GUIDANCE');
    expect(migrateWorldSimulationAgentPrompts_ACU(customGuidance, {})['world-director'][2].content).toContain('自定义 guidance');
  });

  it('自定义唯一可编辑段仍可用 $WORLD_USER_GUIDANCE 通过校验', () => {
    const segments = structuredClone(buildDefaultWorldSimulationAgentPrompts_ACU()['world-director']);
    const index = segments.findIndex(segment => segment.content.includes('$WORLD_USER_REQUIREMENTS'));
    expect(index).toBeGreaterThanOrEqual(0);
    segments[index].content = '用户 guidance：$WORLD_USER_GUIDANCE';
    expect(() => validateWorldSimulationPromptSegments_ACU(segments, 'world-director')).not.toThrow();
  });

});
