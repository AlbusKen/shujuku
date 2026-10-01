import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WORLD_SIMULATION_PROMPT_VERSION_V25_ACU, WORLD_SIMULATION_PROMPT_VERSION_V26_ACU, WORLD_SIMULATION_PROMPT_VERSION_V27_ACU, WORLD_SIMULATION_PROMPT_VERSION_V28_ACU, WORLD_SIMULATION_PROMPT_VERSION_V29_ACU, WORLD_SIMULATION_PROMPT_VERSION_V30_ACU, WORLD_SIMULATION_PROMPT_VERSION_V31_ACU, WORLD_SIMULATION_PROMPT_VERSION_V32_ACU, WORLD_SIMULATION_PROMPT_VERSION_V33_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { USER_PREFILL_CONTENT_ACU } from '../../../../src/shared/user-prefill.js';
import { buildDefaultWorldSimulationSettings_ACU } from '../../../../src/service/simulation/defaults';
import { WORLD_SIMULATION_AGENT_CATALOG_ACU, WORLD_SIMULATION_AGENT_NAMES_ACU, findWorldSimulationAgentDefinition_ACU, worldSimulationDirectorVisibleCatalog_ACU } from '../../../../src/service/simulation/agent/agent-catalog';
import { WORLD_SIMULATION_ENGINE_SEAMS_ACU, WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU, WORLD_SIMULATION_PROMPT_VERSION_ACU, WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU, buildDefaultWorldSimulationAgentPrompts_ACU, buildV16WorldSimulationAgentPrompt_ACU, buildV20WorldSimulationAgentPrompt_ACU, migrateWorldSimulationAgentPrompts_ACU, worldSimulationDirectorProtocolInstruction_ACU, worldSimulationPlannerProtocolInstruction_ACU, worldSimulationReviewerProtocolInstruction_ACU, worldSimulationSeamMarker_ACU, worldSimulationSpecialistProtocolInstruction_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { WORLD_SIMULATION_LEDGER_MODULES_ACU } from '../../../../src/service/simulation/model';
import { createWorldSimulationPlaceholderResolvers_ACU } from '../../../../src/service/simulation/agent/agent-placeholder-resolver';
import { parseWorldSimulationMainAction_ACU, parseWorldSimulationPlannerOutput_ACU, parseWorldSimulationReviewerResult_ACU, parseWorldSimulationSpecialistResult_ACU } from '../../../../src/service/simulation/agent/agent-protocol';
import { exportWorldSimulationPrompts_ACU, importWorldSimulationPrompts_ACU, renderWorldSimulationPrompt_ACU, validateWorldSimulationAgentPrompts_ACU, validateWorldSimulationPromptSegments_ACU } from '../../../../src/service/simulation/agent/prompt-template';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';

describe('格林推演提示词装配契约', () => {
  it('装配七个现役角色、主 Agent 不派遣退役角色；seam 仍唯一升序，一次性角色不再带 HISTORY', () => {
    const prompts = validateWorldSimulationAgentPrompts_ACU(buildDefaultWorldSimulationAgentPrompts_ACU());
    expect(Object.keys(prompts)).toEqual([...WORLD_SIMULATION_AGENT_NAMES_ACU]);
    expect(WORLD_SIMULATION_AGENT_CATALOG_ACU).toHaveLength(7);
    expect(worldSimulationDirectorVisibleCatalog_ACU()).toHaveLength(6);
    expect(worldSimulationDirectorVisibleCatalog_ACU().some(item => item.name === 'lore-researcher')).toBe(false);
    expect(WORLD_SIMULATION_AGENT_NAMES_ACU).toEqual([
      'world-director', 'world-stage-planner', 'undercurrent-analyst',
      'dramatis-keeper', 'causality-reviewer', 'guidance-composer', 'lore-researcher',
    ]);
    for (const [name, segments] of Object.entries(prompts)) {
      const positions = WORLD_SIMULATION_ENGINE_SEAMS_ACU
        .map(seam => segments.findIndex(segment => segment.content.includes(worldSimulationSeamMarker_ACU(seam))))
        .filter(index => index >= 0);
      // 出现过的 seam 仍按枚举顺序升序且互不重复；段数与是否齐全不再强制。
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(positions).size).toBe(positions.length);
      // 一次性角色不读会话历史，HISTORY 段已移除；其余角色仍保留全部 8 个 seam。
      const oneShot = ['undercurrent-analyst', 'dramatis-keeper', 'guidance-composer'].includes(name);
      expect(positions).toHaveLength(oneShot ? 7 : 8);
      expect(segments.some(segment => segment.content.includes(worldSimulationSeamMarker_ACU('HISTORY')))).toBe(!oneShot);
    }
  });

  it('转义动态材料、拒绝缺失 resolver；段落顺序与增删自由，仅保留字段与用户要求段约束', async () => {
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
    // seam 强约束已移除：段落顺序、数量与增删都交给使用者，删掉首段不再报错。
    expect(() => validateWorldSimulationAgentPrompts_ACU({ ...buildDefaultWorldSimulationAgentPrompts_ACU(), 'world-director': prompt.slice(1) })).not.toThrow();
    // 调换顺序同样合法。
    expect(() => validateWorldSimulationAgentPrompts_ACU({ ...buildDefaultWorldSimulationAgentPrompts_ACU(), 'world-director': [...prompt].reverse() })).not.toThrow();
    // 仍然拦住的两条：段字段非法、用户要求段不唯一。
    expect(() => validateWorldSimulationAgentPrompts_ACU({ ...buildDefaultWorldSimulationAgentPrompts_ACU(), 'world-director': [{ role: 'system', content: '', enabled: true, deletable: true, pinned: false }] })).toThrow();
    expect(() => validateWorldSimulationAgentPrompts_ACU({ ...buildDefaultWorldSimulationAgentPrompts_ACU(), 'world-director': [...prompt, prompt.find(item => item.content.includes('$WORLD_USER_REQUIREMENTS'))!] })).toThrow(/用户要求/);
  });

  it('导入导出、恢复默认迁移与协议示例闭合', () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('clock');
    recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'ledger:current', status: 'ok', summary: 'clock', exact: true });
    const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(registry);
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    expect(importWorldSimulationPrompts_ACU(exportWorldSimulationPrompts_ACU(defaults))).toEqual(defaults);
    const custom = structuredClone(defaults);
    const guidanceIndex = custom['world-director'].findIndex(segment => segment.content.includes('$WORLD_USER_REQUIREMENTS'));
    custom['world-director'][guidanceIndex].content = '用户 guidance：自定义';
    expect(migrateWorldSimulationAgentPrompts_ACU(custom, {} as any)['world-director'][guidanceIndex].content).toContain('自定义');
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
    expect(directorPrompt).toContain('你没有直接 ledger 写入权限');
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

  it('提示词完整覆盖角色职责，同时保留时间先行、历史默认指纹与信息渠道纪律', () => {
    expect(WORLD_SIMULATION_PROMPT_VERSION_ACU).toBe(WORLD_SIMULATION_PROMPT_VERSION_V33_ACU);
    expect(buildDefaultWorldSimulationSettings_ACU().agentRunBudget).toMatchObject({ maxIterations: 4, maxExtraReads: 1, maxConcurrent: 5 });
    expect(WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].map(item => item.version)).toEqual([
      'world-simulation-v3', 'world-simulation-v4', 'world-simulation-v5', 'world-simulation-v6', 'world-simulation-v7', 'world-simulation-v8', 'world-simulation-v9', 'world-simulation-v10', 'world-simulation-v11', 'world-simulation-v12', 'world-simulation-v13', 'world-simulation-v14', 'world-simulation-v15', 'world-simulation-v16', 'world-simulation-v17', 'world-simulation-v18', 'world-simulation-v19', 'world-simulation-v20', 'world-simulation-v21', 'world-simulation-v22', 'world-simulation-v23', 'world-simulation-v24',
      WORLD_SIMULATION_PROMPT_VERSION_V25_ACU,
      WORLD_SIMULATION_PROMPT_VERSION_V26_ACU,
      WORLD_SIMULATION_PROMPT_VERSION_V27_ACU,
      WORLD_SIMULATION_PROMPT_VERSION_V28_ACU,
      WORLD_SIMULATION_PROMPT_VERSION_V29_ACU,
      WORLD_SIMULATION_PROMPT_VERSION_V30_ACU,
      WORLD_SIMULATION_PROMPT_VERSION_V31_ACU,
      WORLD_SIMULATION_PROMPT_VERSION_V32_ACU,
      WORLD_SIMULATION_PROMPT_VERSION_V33_ACU,
    ]);
    expect(WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['undercurrent-analyst'].at(-1)?.version).toBe(WORLD_SIMULATION_PROMPT_VERSION_ACU);
    const v8 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v8');
    const v9 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v9');
    const v10 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v10');
    const v11 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v11');
    const v12 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v12');
    const v13 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v13');
    const v14 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v14');
    const v15 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v15');
    const v16 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['world-director'].find(item => item.version === 'world-simulation-v16');
    expect(v8?.fingerprint).toBe('4767:87f876e3');
    expect(v9?.fingerprint).toBe('4777:cd4e92ac');
    expect(v9?.fingerprint).not.toBe(v8?.fingerprint);
    expect(v10?.fingerprint).toBe('4486:cf7dd826');
    expect(v11?.fingerprint).toBe('4486:cf7dd826');
    expect(v12?.fingerprint).toBe('4563:97559198');
    expect(v13?.fingerprint).toBe('4794:f45a80de');
    expect(v14).toBeDefined();
    expect(v14?.fingerprint).toBe(v13?.fingerprint);
    expect(v15?.fingerprint).toBe('4803:27464e62');
    expect(v16?.fingerprint).not.toBe(v15?.fingerprint);
    const composerV10 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === 'world-simulation-v10');
    const composerV11 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === 'world-simulation-v11');
    const composerV12 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === 'world-simulation-v12');
    const composerV13 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === 'world-simulation-v13');
    const composerV14 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === 'world-simulation-v14');
    const composerV15 = WORLD_SIMULATION_PROMPT_DEFAULT_LINEAGE_ACU['guidance-composer'].find(item => item.version === 'world-simulation-v15');
    expect(composerV10?.fingerprint).toBe('3363:eb46ac19');
    expect(composerV11?.fingerprint).toBe('4082:ac59da90');
    expect(composerV13?.fingerprint).toBe('4498:a3457f28');
    expect(composerV14?.fingerprint).toBe(composerV13?.fingerprint);
    expect(composerV15?.fingerprint).not.toBe(composerV14?.fingerprint);
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const directorPrompt = prompts['world-director'].map(item => item.content).join('\n');
    const plannerPrompt = prompts['world-stage-planner'].map(item => item.content).join('\n');
    const timekeeperPrompt = buildV20WorldSimulationAgentPrompt_ACU('timekeeper').map(item => item.content).join('\n');
    const undercurrentPrompt = prompts['undercurrent-analyst'].map(item => item.content).join('\n');
    const chroniclerPrompt = buildV20WorldSimulationAgentPrompt_ACU('chronicler').map(item => item.content).join('\n');
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
      findWorldSimulationAgentDefinition_ACU('timekeeper')!.writableModules,
    );
    expect(timekeeper).toContain('UPDATE clock');
    expect(timekeeper).toContain('禁止直接写 day');
    expect(timekeeperPrompt).toContain('调用 write_sql 函数');
    expect(timekeeperPrompt).toContain('UPDATE clock');
    expect(timekeeperPrompt).toContain('只写入 clock');

    const undercurrent = worldSimulationSpecialistProtocolInstruction_ACU(
      'undercurrent-analyst',
      WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === 'undercurrent-analyst')!.writableModules,
    );
    expect(undercurrent).toContain('exposePolicy');
    // v28 的交付纪律改由 assistant 自述承载，不再是 system 段的【交付方式】标记。
    expect(undercurrentPrompt).toContain('同一次 write_sql');
    expect(undercurrentPrompt).toContain('clock、dimensions、seeds');
    expect(undercurrentPrompt).not.toContain('调用 write_sql 函数');

    const dramatis = worldSimulationSpecialistProtocolInstruction_ACU(
      'dramatis-keeper',
      WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === 'dramatis-keeper')!.writableModules,
    );
    expect(dramatis).toContain('location_updated_at_day');
    expect(dramatis).toContain('region_visits');
    expect(dramatis).toContain('secluded');
    expect(dramatis).toContain('life');
    expect(dramatis).toContain('仅允许修改写入模块：actors | player | rumors');
    expect(dramatis).toContain('earliest_reveal_day');

    const chronicler = worldSimulationSpecialistProtocolInstruction_ACU(
      'chronicler',
      findWorldSimulationAgentDefinition_ACU('chronicler')!.writableModules,
    );
    expect(chronicler).toContain('earliest_reveal_day');
    expect(chronicler).toContain('chronicle_archive');
    expect(chronicler).toContain('DELETE 不使用 expected_revision');
    expect(chronicler).toContain('完整编年禁止 UPDATE');
    expect(chronicler).toContain('目录中任一条目都可通过 read 工具按地址调阅详细信息');
    expect(chronicler).toContain('chronicle 的 id/at');
    expect(chroniclerPrompt).toContain('read、write_sql 使用函数调用');
    expect(chroniclerPrompt).not.toContain('read、search、write_sql 使用函数调用');
    expect(chroniclerPrompt).toContain('chronicle 的 id/at');
    expect(chroniclerPrompt).toContain('归档职责');
    expect(chroniclerPrompt).toContain('不是每轮常规角色');
    expect(reviewerPrompt).toContain('不得输出 guidance');
    expect(reviewerPrompt).not.toContain('guidance 是幕后→台面的唯一通道');
    const composerPrompt = prompts['guidance-composer'].map(item => item.content).join('\n');
    expect(composerPrompt).toContain('sourceId');
    expect(composerPrompt).toContain('80');
    expect(composerPrompt).toContain('正文没写过');
    // v29：场外信号是写给后续剧情的引导提示，大变局时逐轮牵引，且每轮至少保留 1 条（与运行时门禁一致）。
    expect(composerPrompt).toContain('写给接下来续写者的引导提示');
    expect(composerPrompt).toContain('大变局牵引：');
    expect(composerPrompt).toContain('每轮至少保留 1 条');
    expect(composerPrompt).not.toContain('需要清理时可以提交空 signals');
    expect(composerPrompt).not.toContain('禁止把正文已发生事件做记录、总结或评价');
    const composerInstruction = worldSimulationSpecialistProtocolInstruction_ACU(
      'guidance-composer',
      WORLD_SIMULATION_AGENT_CATALOG_ACU.find(item => item.name === 'guidance-composer')!.writableModules,
    );
    expect(composerInstruction).toContain('选题纪律');
    expect(composerInstruction).toContain('正文剧情所在位置附近、或与正文强相关、但正文尚未描写');
    expect(composerPrompt).toContain('每轮新信号最多 4 条，encounter 最多 2 条');
    expect(composerPrompt).toContain('玩家 secluded 时不写 rumor');
    expect(directorPrompt).toContain('focus 写法');
    expect(directorPrompt).toContain('禁止「更新世界动态」这类空泛套话');
    expect(timekeeperPrompt).toContain('时间判定细则');
    expect(timekeeperPrompt).toContain('正文无时间流逝证据时 days=0');
    expect(undercurrentPrompt).toContain('value 0-100 表示当下烈度，trend 写 rising/stable/falling');
    expect(undercurrentPrompt).toContain('catalyst');
    const dramatisPrompt = prompts['dramatis-keeper'].map(item => item.content).join('\n');
    expect(dramatisPrompt).toContain('同一次 write_sql');
    expect(dramatisPrompt).toContain('只写 actors、player；rumors 只写人物死亡的伴生风声');
    expect(dramatisPrompt).toContain('无变化回复 NO_CHANGE');
    expect(reviewerPrompt).toContain('审核清单逐项过');
    expect(reviewerPrompt).toContain('仅因事实客观存在、读者知道或账本有记录而赋知');
    expect(reviewerPrompt).toContain('空壳条目按 MISSING_FIELD 打回');
    expect(undercurrent).toContain('rationale、catalyst、interests/goals/known_facts');
    expect(undercurrent).toContain('缺少事实依据时把缺口写进 uncertainties');
    expect(undercurrent).not.toContain('其余字段由服务端按缺省补齐');
    expect(director).toContain('chronicle-archive:');
    expect(director).toContain('seeds:{id}');

    const reviewer = worldSimulationReviewerProtocolInstruction_ACU();
    expect(reviewer).toContain('不得输出 guidance');
    expect(reviewerPrompt).toContain(reviewer);
    expect(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.reviewer).not.toHaveProperty('guidance');
  });

  it('幕后人物规则进入 dramatis-keeper 的最终渲染消息且不要求 JSON patch 写集', async () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('dramatis-prompt');
    const context = {
      task: { instruction: '核对幕后角色' }, history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [],
      evidence: [], userGuidance: '', worldState: {}, anchorMessage: '主角正在客栈，旧识已经离开',
      anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [], worldCandidates: [], worldCollisions: {},
      evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry), projectionPreview: {},
    };
    const rendered = await renderWorldSimulationPrompt_ACU(
      buildDefaultWorldSimulationAgentPrompts_ACU()['dramatis-keeper'],
      'dramatis-keeper', createWorldSimulationPlaceholderResolvers_ACU(context),
    );
    const sent = [...rendered.messages, {
      role: 'system',
      content: worldSimulationSpecialistProtocolInstruction_ACU('dramatis-keeper', ['actors', 'player', 'rumors']),
    }].map(message => message.content).join('\n');
    expect(sent).toContain('同一次 write_sql');
    expect(sent).toContain('只写 actors、player；rumors 只写人物死亡的伴生风声');
    expect(sent).toContain('无变化回复 NO_CHANGE');
    expect(sent).toContain('UPDATE player');
    expect(sent).toContain('"sql"');
    expect(sent).not.toMatch(/"patch"\s*:|玩家位置按正文地标 upsert player/);
  });

  it('V16 存量默认词升级到当前版本，用户改写的角色段保持原样', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    const legacy = Object.fromEntries(WORLD_SIMULATION_AGENT_NAMES_ACU.map(name => [name, buildV16WorldSimulationAgentPrompt_ACU(name)])) as ReturnType<typeof buildDefaultWorldSimulationAgentPrompts_ACU>;
    const custom = structuredClone(legacy);
    custom['dramatis-keeper'][2].content += '\n用户定制：仅核对北境人物';
    custom['world-director'][3].enabled = false;
    const appended = { role: 'user' as const, content: '用户追加规则', enabled: true, deletable: true };
    custom['dramatis-keeper'].push(appended);
    const migrated = migrateWorldSimulationAgentPrompts_ACU(custom, {});
    expect(migrated['world-director'][3].enabled).toBe(false);
    expect(migrated.chronicler).toEqual(defaults.chronicler);
    expect(migrated['dramatis-keeper']).toEqual(defaults['dramatis-keeper']);
    expect(migrateWorldSimulationAgentPrompts_ACU(legacy, {})['dramatis-keeper']).toEqual(defaults['dramatis-keeper']);
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

  it('旧默认静态协议不变时迁移可编辑要求到稳定前缀之后，自定义工作流仍保持原顺序', () => {
    const legacy = buildV16WorldSimulationAgentPrompt_ACU('world-director');
    const guidance = legacy.findIndex(segment => segment.content.includes('$WORLD_USER_REQUIREMENTS'));
    legacy[guidance] = { ...legacy[guidance], content: `${legacy[guidance].content}
仅推演北境`, deletable: true };
    const migrated = migrateWorldSimulationAgentPrompts_ACU({ 'world-director': legacy }, {} as any)['world-director'];
    expect(migrated.findIndex(segment => segment.content.includes('仅推演北境'))).toBe(4);
    expect(migrated[4]).toEqual(legacy[guidance]);
    expect(migrated[2].content).toContain(worldSimulationSeamMarker_ACU('PROTOCOL'));
    expect(migrated[3].content).toContain(worldSimulationSeamMarker_ACU('WORKFLOW'));

    const customWorkflow = structuredClone(legacy);
    customWorkflow[4].content += `
用户改写工作流`;
    const preserved = migrateWorldSimulationAgentPrompts_ACU({ 'world-director': customWorkflow }, {} as any)['world-director'];
    expect(preserved.findIndex(segment => segment.content.includes('仅推演北境'))).toBe(2);
    expect(preserved[4]).toEqual(customWorkflow[4]);
  });

  it('两次真实渲染的静态前缀不随用户要求、历史与当前锚点变化', async () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU()['world-director'];
    const registry = snapshotWorldSimulationEvidenceRegistry_ACU(createWorldSimulationEvidenceRegistry_ACU('prefix'));
    const base = {
      task: '任务一', history: ['上轮'], runtimeContext: { turn: 1 }, agentCatalog: [], toolCatalog: [], evidence: [],
      userGuidance: '用户要求甲', userRequirements: '要求甲', worldState: {}, anchorMessage: '正文甲', anchorIdentity: {},
      worldStagePlan: {}, worldChronicle: [], worldCandidates: [], worldCollisions: {}, evidenceRegistry: registry, projectionPreview: {},
    };
    const first = await renderWorldSimulationPrompt_ACU(prompts, 'world-director', createWorldSimulationPlaceholderResolvers_ACU(base));
    const second = await renderWorldSimulationPrompt_ACU(prompts, 'world-director', createWorldSimulationPlaceholderResolvers_ACU({
      ...base, userGuidance: '用户要求乙', userRequirements: '要求乙', history: ['后续历史'], anchorMessage: '正文乙', runtimeContext: { turn: 2 },
    }));
    expect(first.messages.slice(0, 4)).toEqual(second.messages.slice(0, 4));
    expect(first.messages.slice(0, 4).map(item => item.role)).toEqual(['system', 'system', 'system', 'system']);
    expect(first.messages[4].content).toContain('要求甲');
    expect(second.messages[4].content).toContain('要求乙');
    expect(first.messages[5].content).toContain('上轮');
    expect(second.messages[5].content).toContain('后续历史');
    expect(first.messages[6].content).toContain('正文甲');
    expect(second.messages[6].content).toContain('正文乙');
  });

  it('自定义唯一可编辑段仍可用 $WORLD_USER_GUIDANCE 通过校验', () => {
    const segments = structuredClone(buildDefaultWorldSimulationAgentPrompts_ACU()['world-director']);
    const index = segments.findIndex(segment => segment.content.includes('$WORLD_USER_REQUIREMENTS'));
    expect(index).toBeGreaterThanOrEqual(0);
    segments[index].content = '用户 guidance：$WORLD_USER_GUIDANCE';
    expect(() => validateWorldSimulationPromptSegments_ACU(segments, 'world-director')).not.toThrow();
  });

});

describe('V16 → V17 格林推演提示词迁移', () => {
  const frozen = JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/prompt-lineage-v34-v16.json', import.meta.url)), 'utf8')) as {
    simulationV16: Record<string, Array<{ role: string; length: number; hash: string }>>;
    simulationV16Groups: Record<string, { length: number; hash: string }>;
  };
  const fingerprint = (text: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  };

  it('V16 旧默认组与修改前冻结的逐槽及整组指纹完全一致', () => {
    const mismatches: string[] = [];
    for (const name of Object.keys(frozen.simulationV16) as Array<Parameters<typeof buildV16WorldSimulationAgentPrompt_ACU>[0]>) {
      const segments = buildV16WorldSimulationAgentPrompt_ACU(name);
      const toRef = (segment: typeof segments[number]) => ({ role: segment.role, length: segment.content.length, hash: fingerprint(segment.content) });
      const actual = segments.map(toRef);
      const expected = frozen.simulationV16[name];
      actual.forEach((segment, index) => {
        if (JSON.stringify(segment) !== JSON.stringify(expected?.[index])) mismatches.push(`${name}[${index}]: ${JSON.stringify(segment)} != ${JSON.stringify(expected?.[index])}`);
      });
      if (actual.length !== expected?.length) mismatches.push(`${name}: segment count ${actual.length} != ${expected?.length}`);
      const serialized = JSON.stringify(segments);
      const group = { length: serialized.length, hash: fingerprint(serialized) };
      if (JSON.stringify(group) !== JSON.stringify(frozen.simulationV16Groups[name])) mismatches.push(`${name} group: ${JSON.stringify(group)} != ${JSON.stringify(frozen.simulationV16Groups[name])}`);
    }
    expect(Object.keys(frozen.simulationV16).sort()).toEqual(Object.keys(frozen.simulationV16Groups).sort());
    expect(mismatches).toEqual([]);
  });

  it('只替换原位旧默认段，保留用户改写、追加段与启用状态', () => {
    const previous = Object.fromEntries(WORLD_SIMULATION_AGENT_NAMES_ACU.map(name => [name, buildV16WorldSimulationAgentPrompt_ACU(name)])) as ReturnType<typeof buildDefaultWorldSimulationAgentPrompts_ACU>;
    const current = structuredClone(previous);
    const customIndex = current['world-stage-planner'].findIndex(segment => segment.content.startsWith(worldSimulationSeamMarker_ACU('WORKFLOW')));
    expect(customIndex).toBeGreaterThanOrEqual(0);
    current['world-stage-planner'][customIndex] = { ...current['world-stage-planner'][customIndex], content: current['world-stage-planner'][customIndex].content + '\n用户自定义流程规则', deletable: true };
    current['world-director'][3].enabled = false;
    const appended = { role: 'user' as const, content: '用户追加规则', enabled: true, deletable: true };
    current['world-stage-planner'].push(appended);
    const migrated = migrateWorldSimulationAgentPrompts_ACU(current, {});
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    expect(migrated['world-director'][3]).toEqual(current['world-director'][3]);
    expect(migrated['world-stage-planner'][customIndex]).toEqual(current['world-stage-planner'][customIndex]);
    expect(migrated['world-stage-planner'].at(-1)).toEqual(appended);
    expect(migrated['world-stage-planner'][2]).toEqual(previous['world-stage-planner'][2]);
    expect(migrateWorldSimulationAgentPrompts_ACU(previous, {})).toEqual(defaults);
    expect(migrateWorldSimulationAgentPrompts_ACU(migrated, {})).toEqual(migrated);
  });

  it('工作流、隔离写入、末位预填充、导入导出与 parser 保持一致', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompts_ACU();
    const director = buildV20WorldSimulationAgentPrompt_ACU('world-director').map(segment => segment.content).join('\n');
    const timekeeper = buildV20WorldSimulationAgentPrompt_ACU('timekeeper').map(segment => segment.content).join('\n');
    expect(director).toContain('默认节奏：先读本轮用户要求');
    expect(director).toContain('用户中途要求可');
    expect(timekeeper).toContain('field:模块:ID[:栏目]');
    expect(timekeeper).toContain('status=committed');
    expect(timekeeper).toContain('跨工作流只继承可读的已提交账本');
    const timekeeperSegments = buildV20WorldSimulationAgentPrompt_ACU('timekeeper');
    expect(timekeeperSegments.at(-2)?.content.startsWith(worldSimulationSeamMarker_ACU('EXECUTION_BOUNDARY'))).toBe(true);
    expect(timekeeperSegments.at(-1)).toMatchObject({ role: 'user', content: USER_PREFILL_CONTENT_ACU, enabled: true });
    expect(importWorldSimulationPrompts_ACU(exportWorldSimulationPrompts_ACU(defaults))).toEqual(defaults);
    expect(parseWorldSimulationMainAction_ACU(WORLD_SIMULATION_PROTOCOL_EXAMPLES_ACU.main).kind).toBe('open_round');
    expect(parseWorldSimulationSpecialistResult_ACU({ status: 'failed', agentName: 'timekeeper', reasonCode: 'MISSING_FIELD', message: '缺栏' }).status).toBe('failed');
  });
});
