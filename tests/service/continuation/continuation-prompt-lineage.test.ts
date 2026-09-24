/**
 * 默认提示词谱系回归：每一份历史版本的默认提示词组（V17–V26，含 9.1 正式版发布时的 V20）
 * 经当前迁移链后都必须与当前默认组逐段一致，用户改写段与追加段原样保留。
 *
 * fixture 维护约定：改写任何默认段正文前，先把改写前的默认组追加进
 * fixtures/continuation-prompt-history.json（可复用其 texts 去重结构），并把旧正文的哈希与长度
 * 登记到 AGENT_PROMPT_DEFAULT_LINEAGE_ACU；否则本文件会在对应版本上失败。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateContinuationSettings_ACU } from '../../../src/service/continuation/continuation-store';
import { buildDefaultContinuationSettings_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V27_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V34_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V35_ACU } from '../../../src/service/continuation/defaults';
import {
  AGENT_PROMPT_DEFAULT_LINEAGE_ACU,
  buildV33ContinuationAgentPrompts_ACU,
  buildV34ContinuationAgentPrompts_ACU,
  AGENT_PREFILLS_ACU,
  buildDefaultContinuationAgentPrompts_ACU,
  findAgentPromptSlot_ACU,
  hashAgentPromptContent_ACU,
  V20_DEFAULT_ARC_ARCHITECT_CONTRACT_ACU,
  V20_DEFAULT_ARC_ARCHITECT_EPISTEMOLOGY_ACU,
  V20_DEFAULT_ARC_ARCHITECT_PURPOSE_ACU,
  V20_DEFAULT_ARC_ARCHITECT_SYSTEM_ACU,
  V20_DEFAULT_ARC_ARCHITECT_TASK_ACU,
  V25_ARC_ARCHITECT_VOLUME_CAPACITY_CONTRACT_ACU,
} from '../../../src/service/continuation/agent/agent-defaults';
import { parseAgentMainOutput_ACU, parseAgentWritableToolCalls_ACU } from '../../../src/service/continuation/agent/agent-protocol';
import type { ContinuationPromptSegment_ACU } from '../../../src/service/continuation/model';

interface FixtureSegmentRef_ACU { id: string; enabled?: boolean; deletable?: boolean; pinned?: boolean }
interface PromptHistoryFixture_ACU {
  texts: Record<string, { role: ContinuationPromptSegment_ACU['role']; content: string }>;
  versions: Record<string, { version: string; agentPrompts: Record<string, FixtureSegmentRef_ACU[]>; outlinePrompt: FixtureSegmentRef_ACU[] }>;
}

const fixture_ACU: PromptHistoryFixture_ACU = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/continuation-prompt-history.json', import.meta.url)), 'utf8'));

function materialize_ACU(refs: FixtureSegmentRef_ACU[]): ContinuationPromptSegment_ACU[] {
  return refs.map(ref => {
    const text = fixture_ACU.texts[ref.id];
    const segment: ContinuationPromptSegment_ACU = { role: text.role, content: text.content };
    if (ref.enabled !== undefined) segment.enabled = ref.enabled;
    if (ref.deletable !== undefined) segment.deletable = ref.deletable;
    if (ref.pinned !== undefined) segment.pinned = ref.pinned;
    return segment;
  });
}

function historicalSettings_ACU(label: string): any {
  const entry = fixture_ACU.versions[label];
  const settings = buildDefaultContinuationSettings_ACU() as any;
  settings.promptForceDefaultVersion = entry.version;
  settings.outlinePrompt = materialize_ACU(entry.outlinePrompt);
  const agentPrompts: Record<string, ContinuationPromptSegment_ACU[]> = {};
  for (const [role, refs] of Object.entries(entry.agentPrompts)) agentPrompts[role] = materialize_ACU(refs);
  // finalReviewer 在 V23 才出现；更早的信封由校验层补默认，这里预先补齐以便逐段比对。
  if (!agentPrompts.finalReviewer) agentPrompts.finalReviewer = buildDefaultContinuationAgentPrompts_ACU().finalReviewer;
  settings.agentPrompts = agentPrompts;
  return settings;
}

const REQUIRED_PLACEHOLDERS_ACU: Record<string, string[]> = {
  main: ['$HISTORY_ANCHOR', '$STORY_OVERVIEW', '$STORY_TAIL', '$STORY_CATALOG', '$CHRONOLOGY'],
  arcArchitect: ['$AGENT_TASK', '$AGENT_READ_MATERIALS', '$STORY_OVERVIEW', '$STORY_TAIL', '$STORY_ARC', '$USER_REQUIREMENTS', '$OUTLINE_WINDOW', '$AGENT_WRITE_SCOPE'],
  maintainer: ['$AGENT_TASK', '$AGENT_READ_MATERIALS', '$HISTORY_UNSETTLED', '$HOOKS_LEDGER', '$INFO_GAP', '$CHRONOLOGY', '$USER_REQUIREMENTS'],
  mainlinePlanner: ['$AGENT_TASK', '$AGENT_READ_MATERIALS', '$OUTLINE_WINDOW', '$STORY_OVERVIEW', '$STORY_TAIL', '$STORY_ARC', '$USER_REQUIREMENTS'],
  beatPlanner: ['$AGENT_TASK', '$AGENT_READ_MATERIALS', '$OUTLINE_WINDOW', '$STORY_TAIL', '$HOOKS_LEDGER', '$INFO_GAP', '$USER_REQUIREMENTS'],
  reviewer: ['$AGENT_TASK', '$AGENT_READ_MATERIALS', '$OUTLINE_WINDOW', '$STORY_TAIL', '$HOOKS_LEDGER', '$ACTIVE_CONSTRAINTS', '$USER_REQUIREMENTS'],
  finalReviewer: ['$AGENT_TASK', '$AGENT_READ_MATERIALS', '$OUTLINE_WINDOW', '$STORY_TAIL', '$STORY_ARC', '$USER_REQUIREMENTS', '$WORLDBOOK_HITS'],
  instructionComposer: ['$USER_REQUIREMENTS', '$AGENT_TASK', '$OUTLINE_WINDOW', '$STORY_TAIL', '$HOOKS_LEDGER', '$ACTIVE_CONSTRAINTS'],
};

describe('默认提示词谱系迁移', () => {
  const labels = Object.keys(fixture_ACU.versions);

  it('fixture 覆盖 9.1 正式版（V20）在内的历史默认组', () => {
    expect(labels).toEqual(expect.arrayContaining(['v17', 'v18', 'v19', 'v20', 'v22', 'v23', 'v26']));
  });

  it.each(labels)('%s 的默认组迁移后与当前默认组逐段一致', label => {
    const loaded = validateContinuationSettings_ACU(historicalSettings_ACU(label));
    const defaults = buildDefaultContinuationSettings_ACU();
    expect(loaded.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V35_ACU);
    expect(loaded.outlinePrompt).toEqual(defaults.outlinePrompt);
    for (const role of Object.keys(defaults.agentPrompts) as (keyof typeof defaults.agentPrompts)[]) {
      expect(loaded.agentPrompts[role], `agentPrompts.${role}`).toEqual(defaults.agentPrompts[role]);
    }
  });

  it.each(labels)('%s 迁移后每个角色都保有运行时依赖的占位符', label => {
    const loaded = validateContinuationSettings_ACU(historicalSettings_ACU(label));
    for (const [role, required] of Object.entries(REQUIRED_PLACEHOLDERS_ACU)) {
      const text = (loaded.agentPrompts as any)[role].filter((segment: ContinuationPromptSegment_ACU) => segment.enabled !== false).map((segment: ContinuationPromptSegment_ACU) => segment.content).join('\n');
      const missing = required.filter(token => !text.includes(token));
      expect(missing, `${label} ${role}`).toEqual([]);
    }
  });

  it('用户改写过的段与追加段在谱系迁移中原样保留', () => {
    const settings = historicalSettings_ACU('v20');
    const customized = settings.agentPrompts.mainlinePlanner.find((segment: ContinuationPromptSegment_ACU) => segment.content.includes('$AGENT_TASK'));
    customized.content = `${customized.content}\n【用户附加要求】保持第一人称。`;
    const appended = { role: 'user', content: '用户自定义的策划补充规则', enabled: true, deletable: true };
    settings.agentPrompts.mainlinePlanner.push(appended);
    const loaded = validateContinuationSettings_ACU(settings);
    expect(loaded.agentPrompts.mainlinePlanner.some(segment => segment.content.endsWith('【用户附加要求】保持第一人称。'))).toBe(true);
    expect(loaded.agentPrompts.mainlinePlanner).toContainEqual(appended);
    expect(loaded.agentPrompts.mainlinePlanner.filter(segment => segment.content.includes('$AGENT_TASK'))).toHaveLength(1);
  });

  it('真实 V20 形态（任务段在容量段位置、无容量段）迁移后总纲任务段完整保留', () => {
    const settings = buildDefaultContinuationSettings_ACU() as any;
    settings.promptForceDefaultVersion = 'spv2.8-continuation-runtime-snapshot-v20';
    settings.agentPrompts = buildV33ContinuationAgentPrompts_ACU();
    const arc = settings.agentPrompts.arcArchitect.filter((segment: ContinuationPromptSegment_ACU) => segment.content !== V25_ARC_ARCHITECT_VOLUME_CAPACITY_CONTRACT_ACU);
    arc[0].content = V20_DEFAULT_ARC_ARCHITECT_SYSTEM_ACU;
    arc[2].content = V20_DEFAULT_ARC_ARCHITECT_PURPOSE_ACU;
    arc[4].content = V20_DEFAULT_ARC_ARCHITECT_EPISTEMOLOGY_ACU;
    arc[6].content = V20_DEFAULT_ARC_ARCHITECT_CONTRACT_ACU;
    arc[7].content = V20_DEFAULT_ARC_ARCHITECT_TASK_ACU;
    settings.agentPrompts.arcArchitect = arc;

    const loaded = validateContinuationSettings_ACU(settings);

    expect(loaded.agentPrompts.arcArchitect).toEqual(buildDefaultContinuationAgentPrompts_ACU().arcArchitect);
  });

  it('已被误迁的 V27 信封（总纲任务段被覆盖成容量契约）会被修复回默认任务段', () => {
    const settings = buildDefaultContinuationSettings_ACU() as any;
    settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V27_ACU;
    settings.agentPrompts = buildV33ContinuationAgentPrompts_ACU();
    const previous = settings.agentPrompts as ReturnType<typeof buildV33ContinuationAgentPrompts_ACU>;
    const defaults = buildDefaultContinuationAgentPrompts_ACU();
    const taskIndex = previous.arcArchitect.findIndex(segment => segment.content.includes('$AGENT_TASK'));
    // 复现旧迁移的产物：容量段消失、pinned 任务槽位被写成容量契约正文。
    settings.agentPrompts.arcArchitect = previous.arcArchitect
      .filter(segment => segment.content !== V25_ARC_ARCHITECT_VOLUME_CAPACITY_CONTRACT_ACU)
      .map(segment => (segment.content === previous.arcArchitect[taskIndex].content ? { ...segment, content: V25_ARC_ARCHITECT_VOLUME_CAPACITY_CONTRACT_ACU } : segment));
    expect(settings.agentPrompts.arcArchitect.some((segment: ContinuationPromptSegment_ACU) => segment.content.includes('$AGENT_TASK'))).toBe(false);

    const loaded = validateContinuationSettings_ACU(settings);

    expect(loaded.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V35_ACU);
    expect(loaded.agentPrompts.arcArchitect).toEqual(defaults.arcArchitect);
  });

  it('整组自定义、没有已知损坏签名的提示词不会被补入默认段', () => {
    const settings = buildDefaultContinuationSettings_ACU() as any;
    settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V27_ACU;
    const custom = [{ role: 'user', content: '用户完全自定义的审查提示词', enabled: true, deletable: true }];
    settings.agentPrompts.reviewer = custom;

    const loaded = validateContinuationSettings_ACU(settings);

    expect(loaded.agentPrompts.reviewer).toEqual(custom);
  });

  it('谱系表条目都指向当前默认组里存在的槽位，且不与当前默认正文重合', () => {
    const defaults = buildDefaultContinuationAgentPrompts_ACU();
    for (const [role, entries] of Object.entries(AGENT_PROMPT_DEFAULT_LINEAGE_ACU) as [keyof typeof defaults, typeof AGENT_PROMPT_DEFAULT_LINEAGE_ACU.main][]) {
      const currentHashes = new Set(defaults[role].map(segment => `${hashAgentPromptContent_ACU(segment.content)}:${segment.content.length}`));
      for (const entry of entries) {
        expect(findAgentPromptSlot_ACU(defaults[role], entry.slot), `${role} ${entry.note}`).toBeDefined();
        expect(currentHashes.has(`${entry.hash}:${entry.length}`), `${role} ${entry.note} 仍是当前默认正文`).toBe(false);
      }
    }
  });
});

describe('V34 → V35 逐段精确迁移', () => {
  const frozen = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/prompt-lineage-v34-v16.json', import.meta.url)), 'utf8')) as {
    continuationV34: Record<string, Array<{ role: string; length: number; hash: string }>>;
  };

  it('V34 旧默认组与修改前冻结的逐槽角色、长度和正文指纹完全一致', () => {
    const previous = buildV34ContinuationAgentPrompts_ACU();
    for (const [role, segments] of Object.entries(previous)) {
      expect(segments.map(segment => ({ role: segment.role, length: segment.content.length, hash: hashAgentPromptContent_ACU(segment.content) })), role)
        .toEqual(frozen.continuationV34[role]);
    }
    expect(Object.keys(previous).sort()).toEqual(Object.keys(frozen.continuationV34).sort());
  });

  it('仅升级原位旧默认正文，保留用户改写、追加段和已有元数据', () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V34_ACU;
    settings.agentPrompts = buildV34ContinuationAgentPrompts_ACU();
    const previous = structuredClone(settings.agentPrompts);
    const defaults = buildDefaultContinuationAgentPrompts_ACU();
    const mainIndex = previous.main.findIndex(segment => segment.content.startsWith('我的行动规则：'));
    const customIndex = previous.maintainer.findIndex(segment => segment.content.startsWith('我的最终交付是一个 JSON 对象：'));
    expect(mainIndex).toBeGreaterThanOrEqual(0);
    expect(customIndex).toBeGreaterThanOrEqual(0);
    settings.agentPrompts.main[mainIndex].enabled = false;
    settings.agentPrompts.maintainer[customIndex].content += '\n用户修改：保留我的交付术语。';
    const appended = { role: 'user' as const, content: '用户追加的独立规则', enabled: true, deletable: true };
    settings.agentPrompts.maintainer.push(appended);

    const loaded = validateContinuationSettings_ACU(settings);
    expect(loaded.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V35_ACU);
    expect(loaded.agentPrompts.main[mainIndex]).toEqual({ ...defaults.main[mainIndex], enabled: false });
    expect(loaded.agentPrompts.maintainer[customIndex]).toEqual(settings.agentPrompts.maintainer[customIndex]);
    expect(loaded.agentPrompts.maintainer.at(-1)).toEqual(appended);
    expect(loaded.agentPrompts.arcArchitect).toEqual(defaults.arcArchitect);
    expect(settings.agentPrompts.main[mainIndex].content).toBe(previous.main[mainIndex].content);
    expect(validateContinuationSettings_ACU(loaded).agentPrompts).toEqual(loaded.agentPrompts);
  });

  it('当前组与迁移后的文字契合工具、工作流、预填充和 parser', () => {
    const current = buildDefaultContinuationAgentPrompts_ACU();
    const main = current.main.map(segment => segment.content).join('\n');
    const maintainer = current.maintainer.map(segment => segment.content).join('\n');
    expect(main).toContain('open_round 固定工作流');
    expect(main).toContain('用户中途指令');
    expect(main).toContain('本次主循环结束');
    expect(maintainer).toContain('$FIELD:模块:ID[:栏目]');
    expect(maintainer).toContain('"action":"write_sql"');
    expect(maintainer).toContain('status=committed');
    expect(current.main.at(-1)?.content.endsWith(AGENT_PREFILLS_ACU.main)).toBe(true);
    expect(parseAgentMainOutput_ACU('{"action":"open_round","focus":"核对真实剧情后结算"}', AGENT_PREFILLS_ACU.main, true).kind).toBe('open_round');
    expect(parseAgentWritableToolCalls_ACU('{"action":"write_sql","sql":"INSERT INTO hooks (id, summary) VALUES (\'H1\', \'伏笔\')"}', AGENT_PREFILLS_ACU.maintainer))
      .toEqual([{ kind: 'write_sql', sql: "INSERT INTO hooks (id, summary) VALUES ('H1', '伏笔')" }]);
    const exported = JSON.stringify({ version: 1, outlinePrompt: buildDefaultContinuationSettings_ACU().outlinePrompt, agentPrompts: current });
    const imported = JSON.parse(exported);
    expect(validateContinuationSettings_ACU({ ...buildDefaultContinuationSettings_ACU(), agentPrompts: imported.agentPrompts, outlinePrompt: imported.outlinePrompt }).agentPrompts).toEqual(current);
  });
});
