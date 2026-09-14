import type { AgentKernelToolCall_ACU } from '../agent-kernel/agent-tools';
import type { AgentStoryContextSnapshot_ACU } from '../agent-kernel/story-context';
import { renderAgentWorldbookEntries_ACU, resolveAgentWorldbookGrantEntries_ACU, type AgentWorldbookSnapshot_ACU } from '../continuation/agent/agent-worldbook-read';
import type { WorldStateSnapshot_ACU } from './model';

export interface WorldSimulationAgentToolsInput_ACU {
  calls: readonly AgentKernelToolCall_ACU[];
  snapshot: WorldStateSnapshot_ACU;
  storyContext?: AgentStoryContextSnapshot_ACU;
  worldbook: AgentWorldbookSnapshot_ACU;
}
export interface WorldSimulationAgentToolsResult_ACU { text: string; successfulReadRefs: string[]; }

function stateText_ACU(snapshot: WorldStateSnapshot_ACU): string {
  return JSON.stringify({ revisions: snapshot.revisions, entities: snapshot.entities, events: snapshot.events, threads: snapshot.threads });
}
function worldbookParts_ACU(token: string): [string, string[]] {
  const body = token.slice('$WORLDBOOK:'.length); const separator = body.lastIndexOf(':');
  return [body.slice(0, separator), body.slice(separator + 1).split(/[,，]/).map(item => item.trim()).filter(Boolean)];
}
function storyRead_ACU(address: '$STORY_OVERVIEW' | '$STORY_PENDING' | '$STORY_BRIDGE' | '$STORY_CATALOG', input: WorldSimulationAgentToolsInput_ACU): { text: string; ref: string | null } {
  const context = input.storyContext;
  if (!context) return { text: `读取 ${address} 被拒绝：本轮冻结正文快照不可用。`, ref: null };
  if (address === '$STORY_OVERVIEW') {
    if (context.overview.state !== 'ready' && context.overview.state !== 'empty') {
      return { text: `读取 ${address} 被拒绝：本轮事件概览不可用（${context.overview.state}）。`, ref: null };
    }
    return { text: `### ${address}\n${context.overview.text}`, ref: address };
  }
  const segment = address === '$STORY_PENDING' ? context.pending : address === '$STORY_BRIDGE' ? context.bridge : context.catalog;
  return { text: `### ${address}\n${segment.text}`, ref: address };
}
function read_ACU(address: string, input: WorldSimulationAgentToolsInput_ACU): { text: string; ref: string | null } {
  if (address === '$WORLD_STATE' || address === '$LEDGER') return { text: `### ${address}\n${stateText_ACU(input.snapshot)}`, ref: address };
  if (address === '$STORY_OVERVIEW' || address === '$STORY_PENDING' || address === '$STORY_BRIDGE' || address === '$STORY_CATALOG') return storyRead_ACU(address, input);
  if (address.startsWith('$WORLDBOOK:')) {
    const entries = resolveAgentWorldbookGrantEntries_ACU(input.worldbook, address);
    if (!entries.length) return { text: `读取 ${address} 被拒绝：地址不在本轮冻结的已启用世界书快照中。`, ref: null };
    return { text: renderAgentWorldbookEntries_ACU(input.worldbook, ...worldbookParts_ACU(address)), ref: address };
  }
  return { text: `读取 ${address} 被拒绝：不在世界推演子代理可读目录中。`, ref: null };
}
function searchSource_ACU(scope: readonly string[], input: WorldSimulationAgentToolsInput_ACU): string {
  const sections: string[] = [];
  if (scope.includes('story')) sections.push(input.storyContext?.overview.text ?? '', input.storyContext?.pending.text ?? '', input.storyContext?.bridge.text ?? '', input.storyContext?.catalog.text ?? '');
  if (scope.includes('ledger')) sections.push(stateText_ACU(input.snapshot));
  if (scope.includes('worldbook')) sections.push(input.worldbook.entries.map(entry => `${entry.title}｜${entry.keys.join('、')}｜$WORLDBOOK:${entry.bookName}:${entry.uid}`).join('\n'));
  if (scope.includes('tables') || scope.includes('proposals')) sections.push('该运行没有可读取的表格或提案资料。');
  return sections.join('\n');
}

/** Executes only the frozen specialist read/search directory; search hits never become evidence. */
export function executeWorldSimulationAgentTools_ACU(input: WorldSimulationAgentToolsInput_ACU): WorldSimulationAgentToolsResult_ACU {
  const sections: string[] = []; const refs = new Set<string>();
  for (const call of input.calls) {
    if (call.kind === 'read') {
      for (const address of call.reads) { const result = read_ACU(address, input); sections.push(result.text); if (result.ref) refs.add(result.ref); }
      continue;
    }
    let matcher: RegExp | null = null;
    try { matcher = call.isRegex ? new RegExp(call.query, 'i') : null; }
    catch (_) { sections.push(`搜索「${call.query}」被拒绝：正则表达式非法。`); continue; }
    const rows = searchSource_ACU(call.scope, input).split('\n').filter(row => matcher ? matcher.test(row) : row.toLowerCase().includes(call.query.toLowerCase())).slice(0, call.maxResults);
    sections.push(`搜索「${call.query}」结果：${rows.length ? rows.join('\n') : '（无匹配）'}`);
  }
  return { text: sections.join('\n\n') || '（空工具结果）', successfulReadRefs: [...refs] };
}
