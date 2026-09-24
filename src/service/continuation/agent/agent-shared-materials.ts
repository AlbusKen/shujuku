/**
 * 子代理任务段保留和本职强相关的资料占位符。附在末尾的快照去掉已经由这些占位符注入的段落。
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
import type { AgentConversationMessage_ACU, AgentSubagentKind_ACU, AgentWritableModule_ACU } from './agent-model';

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

/** 主会话本轮已经 read/search 到的正文。附在子代理快照后面，避免再对同一地址调阅。 */
export function renderMainSessionReadAppendix_ACU(messages: readonly AgentConversationMessage_ACU[]): string {
  const latest = new Map<string, string>();
  for (const message of messages) {
    if (message.kind !== 'tool') continue;
    const text = message.text.trim();
    if (!text || text === '工具没有返回内容' || text.includes('不再重注')) continue;
    const isRead = Boolean(message.readKey) || message.digest === 'read' || message.digest === 'search' || message.digest.startsWith('调阅 ');
    if (!isRead) continue;
    latest.set(message.readKey || `${message.digest}:${text.slice(0, 80)}`, text);
  }
  if (!latest.size) return '';
  return [
    '【主会话已调阅】',
    '下面是主会话本轮已经读到的全文。快照里写着「应精读」的条目如果已出现在这里，直接使用，不要再对同一地址调用 read 或 search。',
    ...latest.values(),
  ].join('\n\n');
}

const KIND_RELATED_TOKENS_ACU: Record<AgentSubagentKind_ACU, readonly string[]> = {
  arc: ['$STORY_ARC', '$STORY_TAIL', '$STORY_OVERVIEW', '$WORLDBOOK_HITS', '$USER_REQUIREMENTS'],
  maintain: ['$HISTORY_UNSETTLED', '$HOOKS_LEDGER', '$INFO_GAP', '$CHRONOLOGY', '$USER_REQUIREMENTS'],
  plan: ['$OUTLINE_WINDOW', '$STORY_TAIL', '$STORY_OVERVIEW', '$STORY_ARC', '$HOOKS_LEDGER', '$INFO_GAP', '$USER_REQUIREMENTS'],
  review: ['$OUTLINE_WINDOW', '$STORY_TAIL', '$STORY_ARC', '$HOOKS_LEDGER', '$ACTIVE_CONSTRAINTS', '$WORLDBOOK_HITS', '$USER_REQUIREMENTS'],
  research: ['$WEB_REFS', '$WEB_TOOL_CATALOG', '$WORLDBOOK_CATALOG', '$STORY_TAIL', '$TABLE_CATALOG', '$USER_REQUIREMENTS'],
  compose: ['$OUTLINE_WINDOW', '$STORY_ARC', '$STORY_TAIL', '$HOOKS_LEDGER', '$ACTIVE_CONSTRAINTS', '$CHRONOLOGY', '$USER_REQUIREMENTS'],
};

export function keptSubagentMaterialTokens_ACU(kind: AgentSubagentKind_ACU, writes: readonly AgentWritableModule_ACU[]): Set<string> {
  return new Set<string>(['$AGENT_TASK', '$AGENT_WRITE_SCOPE', '$AGENT_READ_MATERIALS', ...KIND_RELATED_TOKENS_ACU[kind], ...writes.map(module => MODULE_TOKEN_ACU[module])]);
}

/** 子代理任务段已经注入的资料，不再在附带快照里重复。主会话自己的快照不走这里。 */
export function omitSnapshotSectionsForSubagent_ACU(snapshot: string, kept: ReadonlySet<string>): string {
  const drop = new Set<string>();
  if (kept.has('$USER_REQUIREMENTS')) drop.add('以下是用户对任务曾经提过的要求：');
  if (kept.has('$OUTLINE_WINDOW')) {
    drop.add('【完整当前阶段大纲】');
    drop.add('【大纲状态】');
    drop.add('【本轮目标】');
    drop.add('【本轮节奏】');
  }
  if (kept.has('$STORY_ARC')) drop.add('【故事总纲状态】');
  if (kept.has('$HISTORY_UNSETTLED')) drop.add('【未结算历史范围】');
  if (kept.has('$TABLE_CATALOG')) drop.add('【表格目录】');
  if (kept.has('$WORLDBOOK_CATALOG')) drop.add('【已启用世界书目录】');
  if (kept.has('$WORLDBOOK_HITS')) drop.add('【本轮语境命中的世界书条目】');
  if (kept.has('$WEB_REFS')) drop.add('【百科资料库目录】');
  if (kept.has('$AGENT_READ_CATALOG')) drop.add('【读取地址词汇表】');
  const keptBlocks: string[] = [];
  let skipping = false;
  for (const block of snapshot.split(/\n\n/)) {
    const first = block.split('\n')[0].trim();
    const heading = first.startsWith('【') || first.startsWith('以下是用户对任务曾经提过的要求');
    if (heading) skipping = drop.has(first);
    if (!skipping) keptBlocks.push(block);
  }
  return keptBlocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
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
