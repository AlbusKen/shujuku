/**
 * 子代理与主会话共用同一份运行时快照。任务段里只保留该子代理自己维护的资料占位符。
 */

import type { ContinuationPromptSegment_ACU, ContinuationSettings_ACU } from '../model';
import { renderContinuationPrompt_ACU } from '../prompt-template';
import { AGENT_RUNTIME_SNAPSHOT_TEMPLATE_ACU } from './agent-defaults';
import { renderAgentModuleCatalog_ACU, renderAgentReadCatalog_ACU, renderAgentSubagentCatalog_ACU } from './agent-catalog';
import { hasActiveStoryArc_ACU, renderAgentWebRefsCatalog_ACU } from './agent-module-store';
import { renderAgentTableCatalog_ACU } from './agent-tables';
import { renderAgentUserRequirements_ACU } from './agent-user-requirements';
import {
  buildAgentWorldbookScanText_ACU,
  renderAgentOutlineState_ACU,
  renderAgentOutlineWindow_ACU,
  renderAgentTurnGuidance_ACU,
  type AgentResolveContext_ACU,
} from './agent-placeholder-resolver';
import { buildEmptyAgentWorldbookSnapshot_ACU, renderAgentWorldbookCatalog_ACU, renderAgentWorldbookHits_ACU } from './agent-worldbook-read';
import type { AgentSubagentKind_ACU, AgentWritableModule_ACU } from './agent-model';

const MODULE_TOKEN_ACU: Record<AgentWritableModule_ACU, string> = {
  storyArc: '$STORY_ARC',
  hooks: '$HOOKS_LEDGER',
  infoGap: '$INFO_GAP',
  chronology: '$CHRONOLOGY',
  constraints: '$ACTIVE_CONSTRAINTS',
  webRefs: '$WEB_REFS',
  userRequirements: '$USER_REQUIREMENTS',
};

/** 这些占位符已经在主会话快照里，子代理任务段不再各注入一份。 */
const SHARED_PLACEHOLDERS_ACU = [
  '$USER_REQUIREMENTS', '$USER_INTENT', '$OUTLINE_WINDOW', '$STORY_OVERVIEW', '$STORY_TAIL', '$STORY_CATALOG',
  '$WORLDBOOK_CATALOG', '$WORLDBOOK_HITS', '$AGENT_READ_CATALOG', '$TABLE_CATALOG',
  '$HISTORY_UNSETTLED', '$HOOKS_LEDGER', '$INFO_GAP', '$ACTIVE_CONSTRAINTS', '$STORY_ARC', '$CHRONOLOGY',
  '$WEB_REFS', '$WEB_TOOL_CATALOG',
];

export function keptSubagentMaterialTokens_ACU(kind: AgentSubagentKind_ACU, writes: readonly AgentWritableModule_ACU[]): Set<string> {
  const kept = new Set<string>(['$AGENT_TASK', '$AGENT_WRITE_SCOPE', ...writes.map(module => MODULE_TOKEN_ACU[module])]);
  if (kind === 'maintain') kept.add('$HISTORY_UNSETTLED');
  if (kind === 'research') kept.add('$WEB_TOOL_CATALOG');
  return kept;
}

export function stripUnownedSubagentPrompt_ACU(
  segments: readonly ContinuationPromptSegment_ACU[],
  kept: ReadonlySet<string>,
): ContinuationPromptSegment_ACU[] {
  const dropped = new Set(SHARED_PLACEHOLDERS_ACU.filter(token => !kept.has(token)));
  return segments.flatMap(segment => {
    if (!segment.content.includes('$AGENT_TASK')) return [{ ...segment }];
    const lines = segment.content.split('\n');
    const dropLine = new Set<number>();
    lines.forEach((line, index) => {
      const tokens = line.match(/\$[A-Z][A-Z0-9_]*/g) ?? [];
      if (!tokens.some(token => dropped.has(token)) || tokens.some(token => kept.has(token))) return;
      dropLine.add(index);
      const previous = lines[index - 1] ?? '';
      if (previous.includes('【') && !previous.includes('$')) dropLine.add(index - 1);
    });
    const content = lines.filter((_, index) => !dropLine.has(index)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return content ? [{ ...segment, content }] : [];
  });
}

export async function renderFallbackAgentSnapshot_ACU(settings: ContinuationSettings_ACU, context: AgentResolveContext_ACU): Promise<string> {
  const worldbook = context.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false);
  const start = context.settledThroughIndex + 1;
  const last = context.chat.length - 1;
  const rendered = await renderContinuationPrompt_ACU(
    [{ role: 'user', content: AGENT_RUNTIME_SNAPSHOT_TEMPLATE_ACU, enabled: true, deletable: false, pinned: true }],
    {
      $USER_REQUIREMENTS: () => renderAgentUserRequirements_ACU(context.moduleSnapshot, context.originInstruction),
      $OUTLINE_WINDOW: () => renderAgentOutlineWindow_ACU(context),
      $CURRENT_TURN_GOAL: () => context.execution.turn?.goal || '（尚无可执行的大纲轮次）',
      $CURRENT_TURN_PACING: () => renderAgentTurnGuidance_ACU(context.execution.turn ?? null),
      $OUTLINE_STATE: () => renderAgentOutlineState_ACU(context),
      $STORY_ARC_STATE: () => hasActiveStoryArc_ACU(context.moduleSnapshot)
        ? `故事总纲：已建立（修订号 ${context.moduleSnapshot.revisions.storyArc}）。`
        : '故事总纲：尚未建立。',
      $UNSETTLED_RANGE: () => start > last ? '没有尚未结算的真实历史。' : `未结算楼层区间：${start} 到 ${last}。`,
      $AGENT_CATALOG: () => renderAgentSubagentCatalog_ACU({ webResearchEnabled: settings.webResearch.enabled }),
      $MODULE_CATALOG: () => renderAgentModuleCatalog_ACU({
        webResearchEnabled: settings.webResearch.enabled,
        webRefsPresent: context.moduleSnapshot.webRefs.some(entry => !entry.retired),
      }),
      $TABLE_CATALOG: () => renderAgentTableCatalog_ACU(context.tableData),
      $WORLDBOOK_CATALOG: () => renderAgentWorldbookCatalog_ACU(worldbook),
      $WORLDBOOK_HITS: () => renderAgentWorldbookHits_ACU(worldbook, buildAgentWorldbookScanText_ACU(context)),
      $WEB_REFS_CATALOG: () => renderAgentWebRefsCatalog_ACU(context.moduleSnapshot, settings.webResearch.enabled),
      $AGENT_READ_CATALOG: () => renderAgentReadCatalog_ACU(),
      $BUDGET: () => '主会话预算见会话里的最新快照。本子代理的读取轮次见紧随其后的【读取预算状态】。',
    },
    'agent_delegate',
  );
  return rendered.messages[0]?.content?.trim() ?? '';
}
