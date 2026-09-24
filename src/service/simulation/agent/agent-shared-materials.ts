/**
 * 世界推演子代理保留和本职强相关的占位符。其余主会话快照附在末尾，并去掉已经单独注入的行。
 */

import type { WorldSimulationPromptSegment_ACU } from '../model';
import { type WorldSimulationAgentName_ACU } from './agent-catalog';
import { worldSimulationSeamMarker_ACU, type WorldSimulationPromptPlaceholder_ACU } from './agent-defaults';

const RUNTIME_LINE_ACU: ReadonlyArray<readonly [WorldSimulationPromptPlaceholder_ACU, string]> = [
  ['$WORLD_TASK', '任务：$WORLD_TASK'],
  ['$WORLD_RUNTIME_CONTEXT', '运行快照：$WORLD_RUNTIME_CONTEXT'],
  ['$WORLD_STATE', '世界状态：$WORLD_STATE'],
  ['$ANCHOR_MESSAGE', '锚点正文：$ANCHOR_MESSAGE'],
  ['$ANCHOR_IDENTITY', '锚点身份：$ANCHOR_IDENTITY'],
  ['$WORLD_STAGE_PLAN', '阶段计划：$WORLD_STAGE_PLAN'],
  ['$WORLD_CHRONICLE', '编年：$WORLD_CHRONICLE'],
  ['$WORLD_CANDIDATES', '候选：$WORLD_CANDIDATES'],
  ['$WORLD_COLLISIONS', '碰撞：$WORLD_COLLISIONS'],
  ['$CURRENT_EVIDENCE_REGISTRY', '证据注册表：$CURRENT_EVIDENCE_REGISTRY'],
  ['$PROJECTION_PREVIEW', '投影预览：$PROJECTION_PREVIEW'],
  ['$READ_BUDGET', '实时阅读预算：$READ_BUDGET'],
  ['$WORLD_AGENT_CATALOG', '角色目录：$WORLD_AGENT_CATALOG'],
  ['$WORLD_TOOL_CATALOG', '工具目录：$WORLD_TOOL_CATALOG'],
  ['$WORLD_EVIDENCE', '证据：$WORLD_EVIDENCE'],
];

const COMMON_KEPT_ACU = ['$WORLD_TASK', '$WORLD_USER_REQUIREMENTS', '$READ_BUDGET', '$ANCHOR_MESSAGE'] as const;

const RELATED_TOKENS_ACU: Partial<Record<WorldSimulationAgentName_ACU, readonly WorldSimulationPromptPlaceholder_ACU[]>> = {
  timekeeper: ['$WORLD_STATE'],
  'undercurrent-analyst': ['$WORLD_STATE', '$WORLD_COLLISIONS'],
  'dramatis-keeper': ['$WORLD_STATE', '$WORLD_COLLISIONS', '$ANCHOR_IDENTITY'],
  chronicler: ['$WORLD_STATE', '$WORLD_CHRONICLE'],
  'guidance-composer': ['$WORLD_STATE', '$PROJECTION_PREVIEW', '$WORLD_COLLISIONS'],
  'causality-reviewer': ['$WORLD_STATE', '$WORLD_CANDIDATES', '$CURRENT_EVIDENCE_REGISTRY', '$WORLD_COLLISIONS'],
  'lore-researcher': ['$WORLD_TOOL_CATALOG'],
  'world-stage-planner': ['$WORLD_COLLISIONS', '$WORLD_STAGE_PLAN'],
};

export function worldSimulationKeptTokens_ACU(name: WorldSimulationAgentName_ACU): Set<string> {
  return new Set<string>([...COMMON_KEPT_ACU, ...(RELATED_TOKENS_ACU[name] ?? [])]);
}

export function splitWorldSimulationSubagentPrompt_ACU(
  segments: readonly WorldSimulationPromptSegment_ACU[],
  name: WorldSimulationAgentName_ACU,
): { segments: WorldSimulationPromptSegment_ACU[]; snapshotTemplate: string } {
  const kept = worldSimulationKeptTokens_ACU(name);
  const runtimeMarker = worldSimulationSeamMarker_ACU('RUNTIME_CONTEXT');
  const historyMarker = worldSimulationSeamMarker_ACU('HISTORY');
  const snapshotLines: string[] = [];
  const next = segments.map(segment => {
    if (segment.content.includes(runtimeMarker)) {
      const present = RUNTIME_LINE_ACU.filter(([token]) => segment.content.includes(token));
      snapshotLines.push(...present.filter(([token]) => !kept.has(token)).map(([, line]) => line));
      const stay = present.filter(([token]) => kept.has(token)).map(([, line]) => line);
      return { ...segment, content: [runtimeMarker, ...stay].join('\n') };
    }
    if (segment.content.includes(historyMarker) && segment.content.includes('$WORLD_HISTORY')) {
      snapshotLines.push('历史锚点与会话：$WORLD_HISTORY');
      return { ...segment, content: `${historyMarker}\n主会话历史见末尾快照。` };
    }
    return { ...segment };
  });
  const snapshotTemplate = snapshotLines.length
    ? `【本回合运行时数据】\n以下是主会话快照里本角色没有单独注入的部分。\n${snapshotLines.join('\n')}`
    : '';
  return { segments: next, snapshotTemplate };
}

export async function renderWorldSimulationSnapshotTemplate_ACU(
  template: string,
  resolvers: Partial<Record<WorldSimulationPromptPlaceholder_ACU, () => string | Promise<string>>>,
): Promise<string> {
  const tokens = [...new Set(template.match(/\$[A-Z][A-Z0-9_]*/g) ?? [])];
  let text = template;
  for (const token of tokens) {
    const resolve = resolvers[token as WorldSimulationPromptPlaceholder_ACU];
    if (!resolve) continue;
    text = text.split(token).join(String(await resolve()));
  }
  return text.trim();
}

/** 主会话本轮 read/search 的回执。附在子代理快照后面。 */
export function renderWorldSimulationDirectorReads_ACU(transcript: readonly { role: string; content: string }[]): string {
  const chunks = transcript.filter(item => {
    if (item.role !== 'user' && item.role !== 'tool') return false;
    const text = item.content.trim();
    return text.includes('"kind":"read"') || text.includes('"kind":"search"') || text.includes('worldbook:entry:');
  }).map(item => item.content.trim());
  if (!chunks.length) return '';
  return ['【主会话已调阅】', '下面是主会话本轮已经读到的全文。不要再对同一地址调用 read。', ...chunks].join('\n\n');
}
