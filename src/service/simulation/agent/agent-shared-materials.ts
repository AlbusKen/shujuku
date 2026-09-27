/**
 * 默认运行时段按角色筛选并置于请求末尾；导演的历史与特殊能力独立保留。
 */

import type { WorldSimulationPromptSegment_ACU } from '../model';
import { renderAgentWorldbookTriggeredInjection_ACU, type AgentWorldbookEntryView_ACU } from '../../continuation/agent/agent-worldbook-read';
import { getWorldSimulationAgentAccessProfile_ACU, type WorldSimulationAgentName_ACU } from './agent-catalog';
import { buildDefaultWorldSimulationAgentPrompt_ACU, buildV20WorldSimulationAgentPrompt_ACU, worldSimulationSeamMarker_ACU, type WorldSimulationPromptPlaceholder_ACU } from './agent-defaults';

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

export function worldSimulationKeptTokens_ACU(name: WorldSimulationAgentName_ACU): Set<string> {
  return new Set<string>([...COMMON_KEPT_ACU, ...getWorldSimulationAgentAccessProfile_ACU(name).snapshotTokens]);
}

export function splitWorldSimulationSubagentPrompt_ACU(
  segments: readonly WorldSimulationPromptSegment_ACU[],
  name: WorldSimulationAgentName_ACU,
): { segments: WorldSimulationPromptSegment_ACU[]; snapshotTemplate: string; movedGuidanceIndex: number } {
  const kept = worldSimulationKeptTokens_ACU(name);
  const runtimeMarker = worldSimulationSeamMarker_ACU('RUNTIME_CONTEXT');
  const historyMarker = worldSimulationSeamMarker_ACU('HISTORY');
  // Retired roles have no current defaults, but historical recovery still splits their V20 prompts.
  const defaults = name === 'timekeeper' || name === 'chronicler'
    ? buildV20WorldSimulationAgentPrompt_ACU(name) : buildDefaultWorldSimulationAgentPrompt_ACU(name);
  const runtimeDefault_ACU = (content: string): string => name === 'world-director' || name === 'lore-researcher' ? content : content
    .replace('独立的 read/search 需求在授权及预算许可时同一回复并发调用，不分批等待；只有依赖搜索结果的精读等回执。',
      '独立的授权 read 地址在同一回复并发调用，不分批等待。')
    .replace('需要时用 worldbook scope 搜索并 read worldbook:entry:书名:uid 精读，或按证据定位并调阅旧记录。',
      '需要时仅按本角色授权的资料目录地址精读；无法核实时将缺口列入 uncertainties。');
  const guidanceIndex = defaults.findIndex(segment => segment.content.includes('$WORLD_USER_REQUIREMENTS'));
  const movedGuidanceIndex = name !== 'world-director' && guidanceIndex >= 0
    && segments[guidanceIndex]?.content === defaults[guidanceIndex].content && segments[guidanceIndex]?.enabled
    && segments.filter(segment => segment.content.includes('$WORLD_USER_REQUIREMENTS')).length === 1
    ? segments.slice(0, guidanceIndex).filter(segment => segment.enabled).length : -1;
  const snapshotLines: string[] = [];
  const next = segments.map((segment, index) => {
    if (segment.content.includes(runtimeMarker)) {
      if (segment.content !== defaults[index]?.content) return { ...segment };
      const present = RUNTIME_LINE_ACU.filter(([token]) => segment.content.includes(token));
      snapshotLines.push(...present.filter(([token]) => name === 'world-director'
        ? !kept.has(token) : kept.has(token)).map(([, line]) => line));
      const stay = name === 'world-director'
        ? present.filter(([token]) => kept.has(token)).map(([, line]) => line) : [];
      return { ...segment, content: [runtimeMarker, ...stay].join('\n') };
    }
    if (segment.content.includes(historyMarker) && segment.content.includes('$WORLD_HISTORY')) {
      if (segment.content !== defaults[index]?.content) return { ...segment };
      if (name === 'world-director') {
        snapshotLines.push('历史锚点与会话：$WORLD_HISTORY');
        return { ...segment, content: `${historyMarker}\n主会话历史见末尾快照。` };
      }
      return { ...segment, content: historyMarker };
    }
    return segment.content === defaults[index]?.content ? { ...segment, content: runtimeDefault_ACU(segment.content) } : { ...segment };
  });
  const snapshotTemplate = snapshotLines.length
    ? `【本回合运行时数据】\n以下是本角色本次请求的最新完整快照，按这里的实时状态行动。\n${snapshotLines.join('\n')}`
    : '';
  return { segments: next, snapshotTemplate, movedGuidanceIndex };
}

/** Positions refer to the rendered snapshot, not to a prompt segment or message index. */
export interface WorldSimulationSnapshotSection_ACU {
  key: WorldSimulationPromptPlaceholder_ACU;
  source: string;
  address: string;
  revision: number | null;
  start: number;
  length: number;
  completeness: 'pending' | 'verified';
  complete: boolean;
}

const SNAPSHOT_SOURCE_ACU: Partial<Record<WorldSimulationPromptPlaceholder_ACU, readonly [string, string]>> = {
  $WORLD_TASK: ['run-state', 'task:current'],
  $WORLD_HISTORY: ['director-conversation', 'history:current'],
  $WORLD_RUNTIME_CONTEXT: ['run-state', 'runtime:current'],
  $WORLD_AGENT_CATALOG: ['agent-catalog', 'agents:current'],
  $WORLD_TOOL_CATALOG: ['tool-catalog', 'tools:current'],
  $WORLD_EVIDENCE: ['run-state', 'evidence:current'],
  $WORLD_USER_GUIDANCE: ['user-input', 'guidance:current'],
  $WORLD_USER_REQUIREMENTS: ['user-input', 'requirements:current'],
  $ANCHOR_MESSAGE: ['host-chat', 'anchor:message'],
  $ANCHOR_IDENTITY: ['host-chat', 'anchor:identity'],
  // Resolver may return a role-specific catalog or an unverified context fallback, not the entire ledger.
  $WORLD_STATE: ['resolved-context', '$WORLD_STATE'],
  $WORLD_CHRONICLE: ['resolved-context', '$WORLD_CHRONICLE'],
  $WORLD_CANDIDATES: ['run-state', 'candidates:current'],
  $WORLD_COLLISIONS: ['derived-relevance', 'ledger+anchor:collisions'],
  $CURRENT_EVIDENCE_REGISTRY: ['evidence-registry', 'registry:current'],
  $WORLD_STAGE_PLAN: ['stage-plan', 'stage-plan:current'],
  $PROJECTION_PREVIEW: ['resolved-context', '$PROJECTION_PREVIEW'],
  $READ_BUDGET: ['runtime-policy', 'read-budget:current'],
};

export async function renderWorldSimulationSnapshotSections_ACU(
  template: string,
  resolvers: Partial<Record<WorldSimulationPromptPlaceholder_ACU, () => string | Promise<string>>>,
  revisions: { ledger?: number; stage?: number } = {},
): Promise<{ text: string; sections: WorldSimulationSnapshotSection_ACU[] }> {
  const pattern = /\$[A-Z][A-Z0-9_]*/g;
  const tokens = [...new Set(template.match(pattern) ?? [])];
  // Validate every source before invoking any resolver: a late missing source must not
  // leave an earlier resolver executed for a snapshot that cannot be sent.
  for (const token of tokens) {
    if (!SNAPSHOT_SOURCE_ACU[token as WorldSimulationPromptPlaceholder_ACU]) {
      throw new Error(`WORLD_SIMULATION_SNAPSHOT_SOURCE_UNMAPPED:${token}`);
    }
    if (typeof resolvers[token as WorldSimulationPromptPlaceholder_ACU] !== 'function') {
      throw new Error(`WORLD_SIMULATION_SNAPSHOT_SOURCE_MISSING:${token}`);
    }
  }
  const values = new Map<string, string>();
  for (const token of tokens) {
    const value = await resolvers[token as WorldSimulationPromptPlaceholder_ACU]!();
    if (typeof value !== 'string') throw new Error(`WORLD_SIMULATION_SNAPSHOT_SOURCE_INVALID:${token}`);
    values.set(token, value);
  }
  const sections: WorldSimulationSnapshotSection_ACU[] = [];
  let text = '';
  let from = 0;
  for (const match of template.matchAll(pattern)) {
    text += template.slice(from, match.index);
    const key = match[0] as WorldSimulationPromptPlaceholder_ACU;
    const value = values.get(key)!;
    const [source, address] = SNAPSHOT_SOURCE_ACU[key]!;
    const revision = source === 'world-ledger' ? revisions.ledger : source === 'stage-plan' ? revisions.stage : undefined;
    sections.push({ key, source, address, revision: Number.isSafeInteger(revision) && revision! >= 0 ? revision! : null,
      start: text.length, length: value.length, completeness: 'pending', complete: false });
    text += value;
    from = match.index + key.length;
  }
  return { text: text + template.slice(from), sections };
}

export interface WorldSimulationVerifiedSnapshotSection_ACU extends WorldSimulationSnapshotSection_ACU {
  messageIndex: number;
  messageStart: number;
}

/** Verify the exact rendered spans in the actual prepared request before declaring them complete. */
export function verifyWorldSimulationSnapshotSections_ACU(
  rendered: { text: string; sections: WorldSimulationSnapshotSection_ACU[] },
  messages: readonly { content: string }[],
): WorldSimulationVerifiedSnapshotSection_ACU[] {
  if (!rendered.text || !rendered.sections.length) throw new Error('WORLD_SIMULATION_SNAPSHOT_BOUNDARY_UNVERIFIED');
  let previousEnd = 0;
  for (const section of rendered.sections) {
    const expectedSource = SNAPSHOT_SOURCE_ACU[section.key];
    const end = section.start + section.length;
    if (!section.source.trim() || !section.address.trim()
      || !expectedSource || expectedSource[0] !== section.source || expectedSource[1] !== section.address
      || section.completeness !== 'pending' || section.complete
      || (section.revision !== null && (!Number.isSafeInteger(section.revision) || section.revision < 0))
      || !Number.isSafeInteger(section.start) || !Number.isSafeInteger(section.length)
      || section.start < 0 || section.length < 0
      || !Number.isSafeInteger(end) || end > rendered.text.length
      || section.start < previousEnd) {
      throw new Error('WORLD_SIMULATION_SNAPSHOT_METADATA_UNVERIFIED');
    }
    previousEnd = end;
  }
  const occurrences = messages.flatMap((message, messageIndex) => {
    const positions: Array<{ messageIndex: number; start: number }> = [];
    let start = message.content.indexOf(rendered.text);
    while (start >= 0) {
      positions.push({ messageIndex, start });
      start = message.content.indexOf(rendered.text, start + 1);
    }
    return positions;
  });
  if (occurrences.length !== 1) throw new Error('WORLD_SIMULATION_SNAPSHOT_BOUNDARY_UNVERIFIED');
  const { messageIndex, start } = occurrences[0];
  for (const section of rendered.sections) {
    if (section.start < 0 || section.length < 0 || section.start + section.length > rendered.text.length) {
      throw new Error('WORLD_SIMULATION_SNAPSHOT_BOUNDARY_UNVERIFIED');
    }
    const value = rendered.text.slice(section.start, section.start + section.length);
    if (messages[messageIndex].content.slice(start + section.start, start + section.start + section.length) !== value) {
      throw new Error('WORLD_SIMULATION_SNAPSHOT_BOUNDARY_UNVERIFIED');
    }
  }
  return rendered.sections.map(section => ({ ...section, messageIndex, messageStart: start + section.start,
    completeness: 'verified', complete: true }));
}

export async function renderWorldSimulationSnapshotTemplate_ACU(
  template: string,
  resolvers: Partial<Record<WorldSimulationPromptPlaceholder_ACU, () => string | Promise<string>>>,
): Promise<string> {
  return (await renderWorldSimulationSnapshotSections_ACU(template, resolvers)).text;
}

/** 主会话本轮 read/search 的回执。附在子代理快照后面。 */
export function renderWorldSimulationDirectorReads_ACU(transcript: readonly { role: string; content: string }[]): string {
  const chunks = transcript.filter(item => {
    if (item.role !== 'user' && item.role !== 'tool') return false;
    const text = item.content.trim();
    return text.includes('"kind":"read"') || text.includes('"kind":"search"') || text.includes('worldbook:entry:');
  }).map(item => item.content);
  if (!chunks.length) return '';
  return ['【主会话已调阅】', '下面是主会话本轮已经读到的全文。不要再对同一地址调用 read。', ...chunks].join('\n\n');
}

export const WORLD_SIMULATION_WORLDBOOK_UNAVAILABLE_ACU =
  '【世界书快照读取失败】本轮未取得宿主世界书快照；不能将缺失条目视作世界书为空，也不能据此推断设定不存在。需要世界书证据时标记缺口，不得虚构。';

/** Source-bound spans of the fixed worldbook injection, measured in UTF-16 code units. */
export interface WorldSimulationFixedWorldbook_ACU {
  text: string;
  sections: Array<{ address: string; start: number; length: number; revision: null; completeness: 'pending' | 'verified' }>;
}

export function bindWorldSimulationFixedWorldbook_ACU(
  text: string,
  hits: readonly AgentWorldbookEntryView_ACU[],
): WorldSimulationFixedWorldbook_ACU {
  const sections: WorldSimulationFixedWorldbook_ACU['sections'] = [];
  // The fixed renderer owns the note and the no-hit text; no unmatched prefix/suffix may
  // masquerade as part of the bound source. Do not trim any entry content.
  const note = renderAgentWorldbookTriggeredInjection_ACU({ available: true, entries: [] }, '');
  const prefix = note.slice(0, note.length - '当前没有已启用的世界书条目。'.length);
  if (hits.length && !text.startsWith(prefix)) throw new Error('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
  let cursor = hits.length ? prefix.length : 0;
  // The renderer groups hits by book; entries from different books can interleave in the source.
  const byBook = new Map<string, AgentWorldbookEntryView_ACU[]>();
  for (const hit of hits) byBook.set(hit.bookName, [...(byBook.get(hit.bookName) ?? []), hit]);
  for (const bookHits of byBook.values()) for (const hit of bookHits) {
    const frame = `### ${hit.title}（${hit.bookName}#${hit.uid}）\n${hit.content}`;
    const separator = sections.length ? '\n\n' : '';
    const start = cursor + separator.length;
    if (text.slice(cursor, start) !== separator || text.slice(start, start + frame.length) !== frame) {
      throw new Error('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
    }
    const bodyStart = start + frame.length - hit.content.length;
    sections.push({ address: `worldbook:entry:${hit.bookName}:${hit.uid}`, start: bodyStart,
      length: hit.content.length, revision: null, completeness: 'pending' });
    cursor = bodyStart + hit.content.length;
  }
  if (hits.length && cursor !== text.length) throw new Error('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
  if (!hits.length && text && text !== note && text !== `${prefix}本轮没有命中世界书条目。`
    && text !== WORLD_SIMULATION_WORLDBOOK_UNAVAILABLE_ACU) throw new Error('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
  return { text, sections };
}

/** Proves the source-bound complete bodies occur in one fixed injection in prepared messages. */
export function verifyWorldSimulationFixedWorldbook_ACU(
  fixed: WorldSimulationFixedWorldbook_ACU,
  messages: readonly { content: string }[],
): Array<{ address: string; revision: null; messageIndex: number; start: number; length: number; completeness: 'verified'; complete: true }> {
  if (!fixed.text) {
    if (fixed.sections.length) throw new Error('WORLD_SIMULATION_WORLDBOOK_BOUNDARY_UNVERIFIED');
    return [];
  }
  const matches = messages.flatMap((message, messageIndex) => {
    const found: Array<{ messageIndex: number; start: number }> = [];
    let at = message.content.indexOf(fixed.text);
    while (at >= 0) {
      found.push({ messageIndex, start: at });
      at = message.content.indexOf(fixed.text, at + 1);
    }
    return found;
  });
  if (matches.length !== 1) throw new Error('WORLD_SIMULATION_WORLDBOOK_BOUNDARY_UNVERIFIED');
  const match = matches[0];
  let cursor = 0;
  const addresses = new Set<string>();
  return fixed.sections.map(section => {
    const end = section.start + section.length;
    if (section.completeness !== 'pending' || !Number.isSafeInteger(section.start) || !Number.isSafeInteger(section.length)
      || !Number.isSafeInteger(end) || section.start < cursor || section.length <= 0 || end > fixed.text.length
      || !/^worldbook:entry:[^:]+:[^:]+$/.test(section.address) || section.revision !== null
      || addresses.has(section.address)) {
      throw new Error('WORLD_SIMULATION_WORLDBOOK_METADATA_UNVERIFIED');
    }
    addresses.add(section.address);
    const messageStart = match.start + section.start;
    const messageEnd = messageStart + section.length;
    if (!Number.isSafeInteger(messageStart) || !Number.isSafeInteger(messageEnd)
      || messageStart < 0 || messageEnd > messages[match.messageIndex].content.length
      || messages[match.messageIndex].content.slice(messageStart, messageEnd)
        !== fixed.text.slice(section.start, section.start + section.length)) {
      throw new Error('WORLD_SIMULATION_WORLDBOOK_BOUNDARY_UNVERIFIED');
    }
    cursor = end;
    return { address: section.address, revision: section.revision, messageIndex: match.messageIndex,
      start: messageStart, length: section.length, completeness: 'verified', complete: true as const };
  });
}
