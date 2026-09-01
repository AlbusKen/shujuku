import { renderAgentOutlineWindow_ACU, renderAgentStoryTail_ACU, resolveAgentReadToken_ACU, type AgentResolveContext_ACU } from './agent-placeholder-resolver';
import { renderAgentWorldbookCatalog_ACU, type AgentWorldbookEntryView_ACU } from './agent-worldbook-read';
import type { AgentGateItem_ACU } from './agent-read-gate';

export interface AgentFinalReviewEvidenceInput_ACU {
  resolveContext: AgentResolveContext_ACU;
  candidateInstruction: string;
  currentUserInput: string;
  planningSummary?: string;
}

export interface AgentFinalReviewEvidence_ACU {
  gateItems: AgentGateItem_ACU[];
  supplementalMaterials: string;
  worldbookEvidence: string;
  worldbookSeeds: string[];
  fixedReadKeys: string[];
}

function unique_ACU(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function extractAgentFinalReviewWorldbookSeeds_ACU(text: string): string[] {
  const matches = String(text ?? '').match(/[\p{Script=Han}]{2,12}|[A-Za-z][A-Za-z0-9_-]{2,}/gu) ?? [];
  const candidates: string[] = [];
  for (const match of matches) {
    candidates.push(match);
    if (!/^[\p{Script=Han}]+$/u.test(match)) continue;
    for (let index = 0; index < match.length - 1; index += 1) {
      candidates.push(match.slice(index, index + 2));
    }
  }
  return unique_ACU(candidates).slice(0, 48);
}

function selectWorldbookEntries_ACU(entries: readonly AgentWorldbookEntryView_ACU[], seeds: readonly string[]): AgentWorldbookEntryView_ACU[] {
  const haystack = seeds.join('\n').toLowerCase();
  return entries.filter(entry => entry.constant || [entry.title, ...entry.keys].some(term => term && haystack.includes(term.toLowerCase())));
}

function renderFullWorldbookEvidence_ACU(entries: readonly AgentWorldbookEntryView_ACU[]): string {
  if (!entries.length) return '';
  return entries.map(entry => `### ${entry.title}（${entry.bookName}#${entry.uid}）\n${entry.content}`).join('\n\n');
}

function selectFinalReviewWorldbookEntries_ACU(context: AgentResolveContext_ACU, seeds: readonly string[]): AgentWorldbookEntryView_ACU[] {
  const snapshot = context.worldbook;
  if (!snapshot?.available) return [];
  const hits = selectWorldbookEntries_ACU(snapshot.entries, seeds);
  return hits;
}

export function buildAgentFinalReviewEvidence_ACU(input: AgentFinalReviewEvidenceInput_ACU): AgentFinalReviewEvidence_ACU {
  const { resolveContext: context } = input;
  const outline = renderAgentOutlineWindow_ACU(context);
  const storyArc = resolveAgentReadToken_ACU('$STORY_ARC', context).text;
  const tail = renderAgentStoryTail_ACU(context);
  const constraints = resolveAgentReadToken_ACU('$ACTIVE_CONSTRAINTS', context).text;
  const chronology = resolveAgentReadToken_ACU('$CHRONOLOGY', context).text;
  const seedSource = [context.originInstruction, input.currentUserInput, input.candidateInstruction, outline, tail].join('\n');
  const worldbookSeeds = extractAgentFinalReviewWorldbookSeeds_ACU(seedSource);
  const worldbookEntries = selectFinalReviewWorldbookEntries_ACU(context, worldbookSeeds);
  const worldbookEvidence = context.worldbook?.available
    ? (renderFullWorldbookEvidence_ACU(worldbookEntries) || '没有命中或常开世界书条目。不要凭印象判定世界观冲突；先用 worldbook scope 的 search 定位，再用 $WORLDBOOK:书名:uid 精读全文。')
    : '世界书当前不可用；涉及人物、能力、地点、组织、种族、社会规则或世界常识的结论必须标注未验证，并可用 worldbook scope 的 search 补查。';
  const supplementalMaterials = [
    `### 本轮用户输入\n${input.currentUserInput || '（本轮没有额外用户输入）'}`,
    `### 长期约束\n${constraints}`,
    `### 故事年代学账本（已发生正文结算出的时间事实；大纲时间字段只是计划）\n${chronology}`,
    `### 本轮策划结果摘要\n${input.planningSummary || '（未提供策划结果摘要）'}`,
    `### 世界书检索种子\n${worldbookSeeds.length ? worldbookSeeds.join('、') : '（未提取到有效检索种子）'}`,
    `### 已启用世界书目录\n${renderAgentWorldbookCatalog_ACU(context.worldbook ?? { available: false, entries: [] })}`,
  ].join('\n\n');
  return {
    supplementalMaterials,
    worldbookEvidence,
    worldbookSeeds,
    fixedReadKeys: unique_ACU([
      '$USER_INTENT', '$OUTLINE_WINDOW', '$STORY_ARC', '$STORY_TAIL', '$ACTIVE_CONSTRAINTS', '$CHRONOLOGY',
      ...worldbookEntries.map(entry => `$WORLDBOOK:${entry.bookName}:${entry.uid}`),
    ]),
    gateItems: [
      { label: '用户初始要求', text: context.originInstruction || '（用户未提供初始要求）' },
      { label: '本轮用户输入', text: input.currentUserInput || '（本轮没有额外用户输入）' },
      { label: '候选写作指导', text: input.candidateInstruction },
      { label: '完整当前阶段大纲', text: outline },
      { label: '故事总纲', text: storyArc },
      { label: '最近正文', text: tail },
      { label: '长期约束、故事年代学账本、策划摘要、检索种子与世界书目录', text: supplementalMaterials },
      { label: '命中世界书条目全文', text: worldbookEvidence },
    ],
  };
}
