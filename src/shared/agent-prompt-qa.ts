import { USER_PREFILL_CONTENT_ACU } from './user-prefill.js';
import { isAgentFixedSlot_ACU, isAgentHistorySlot_ACU, isAgentSnapshotSlot_ACU } from './agent-prompt-layout';

export const AGENT_FORMAT_QUESTION_ACU = '你的具体动作与最终交付采用什么格式？请说明字段、示例和提交约束。';
export const AGENT_FORMAT_ANSWER_MARKER_ACU = '【具体格式输出】\n';
export function isAgentFormatAnswer_ACU(segment: { role: string; content: string }): boolean {
  return segment.role === 'assistant' && segment.content.startsWith(AGENT_FORMAT_ANSWER_MARKER_ACU);
}
export interface AgentQaSegment_ACU {
  role: string; content: string; snapshotTemplate?: string;
  enabled?: boolean; deletable?: boolean; pinned?: boolean;
}
export interface AgentQaOptions_ACU {
  formatIndex: number;
  formatContent: string;
  identity: string;
  rootRemainder: string;
  cleanStatic: (text: string) => string;
  snapshotAppend?: string;
  omitIndices?: readonly number[];
  questions?: Readonly<Record<number, string>>;
}

/** 地址语法分开书写美元符号，避免模板渲染器把语法示例当作资料占位符。 */
export function literalAgentAddresses_ACU(text: string): string {
  return text.replace(/\$([A-Z][A-Z0-9_]*|1)\b(:[^\s，。；）\n"`]+)?/g, (_whole, name: string, suffix: string | undefined) => {
    if (suffix || ['FIELD', 'TABLE', 'WORLDBOOK', 'STORY_RANGE'].includes(name)) {
      return `「$」+「${name}${suffix ?? ''}」（地址拼接为一个字符串，名称与 ID 取自快照目录）`;
    }
    return `快照中的【${AGENT_RUNTIME_LABELS_ACU[name] ?? name}】`;
  });
}

const AGENT_RUNTIME_LABELS_ACU: Readonly<Record<string, string>> = {
  USER_REQUIREMENTS: '用户累计要求', CHRONOLOGY: '故事年代学', STORY_ARC: '故事总纲',
  HOOKS_LEDGER: '伏笔账本', INFO_GAP: '认知信息差', ACTIVE_CONSTRAINTS: '长期约束',
  STORY_TAIL: '最近正文', STORY_OVERVIEW: '已发生事件概览', STORY_CATALOG: '正文目录',
  OUTLINE_WINDOW: '当前阶段大纲', HISTORY_UNSETTLED: '未结算正文', READ_BUDGET: '阅读预算',
  BUDGET: '运行预算', AGENT_TASK: '本轮任务', AGENT_READ_MATERIALS: '已调阅资料',
  AGENT_WRITE_SCOPE: '写入范围', WORLD_TASK: '推演任务', WORLD_COLLISIONS: '碰撞报告',
  WORLD_STATE: '世界状态', WORLD_USER_REQUIREMENTS: '用户累计要求',
};

/** 只有资料引用才搬入快照；带冒号的地址范例仍是静态语法，不调用 resolver。 */
function runtimeTokens_ACU(text: string): string[] {
  return [...new Set([...text.matchAll(/\$(?:[A-Z][A-Z0-9_]*|1)\b/g)]
    .filter(hit => text[hit.index! + hit[0].length] !== ':'
      && !['$FIELD', '$TABLE', '$WORLDBOOK', '$STORY_RANGE'].includes(hit[0]))
    .map(hit => hit[0]))];
}

interface QaPlan_ACU<T> { groups: T[][]; order: number[] }
function qaPlan_ACU<T extends AgentQaSegment_ACU>(previous: readonly T[], options: AgentQaOptions_ACU): QaPlan_ACU<T> {
  const root = previous.findIndex(segment => segment.role === 'system' && !isAgentFixedSlot_ACU(segment));
  const snapshot = previous.findIndex(isAgentSnapshotSlot_ACU);
  const history = previous.findIndex(isAgentHistorySlot_ACU);
  const prefill = previous.findIndex(segment => segment.content === USER_PREFILL_CONTENT_ACU);
  const groups: T[][] = previous.map((): T[] => []);
  const moved: string[] = [];
  const clean = (text: string) => literalAgentAddresses_ACU(options.cleanStatic(text));
  const turn = (source: T, role: string, content: string): T => ({ ...source, role, content } as T);
  const pair = (source: T, ask: string, answer: string): T[] => [turn(source, 'user', ask), turn(source, 'assistant', clean(answer))];
  const included = new Set(runtimeTokens_ACU([previous[snapshot]?.snapshotTemplate ?? '', options.snapshotAppend ?? ''].join('\n')));
  const material = (text: string): string => text.split(/\n\n+/).filter(paragraph => {
    const tokens = runtimeTokens_ACU(paragraph);
    const dataOnly = /^\s*\$(?:[A-Z][A-Z0-9_]*|1)\s*$/m.test(paragraph)
      && paragraph.split('\n').every(line => !line.trim() || /^\s*(?:【[^】]+】[^\n]*|以下是用户[^\n]*|\$(?:[A-Z][A-Z0-9_]*|1))\s*$/.test(line));
    if (dataOnly) {
      if (tokens.some(token => !included.has(token))) moved.push(paragraph);
      tokens.forEach(token => included.add(token));
      return false;
    }
    for (const token of tokens) {
      if (!included.has(token)) {
        moved.push(`【${AGENT_RUNTIME_LABELS_ACU[token.slice(1)] ?? token.slice(1)}】\n${token}`);
        included.add(token);
      }
    }
    return true;
  }).join('\n\n');

  previous.forEach((source, index) => {
    if (index === snapshot || index === history || index === prefill || options.omitIndices?.includes(index)) return;
    if (index === root) {
      groups[index] = [turn(source, 'system', clean(material(options.identity)))];
      if (options.rootRemainder.trim()) groups[index].push(...pair(source, '你的职责、边界和注意事项是什么？', material(options.rootRemainder)));
      if (index !== options.formatIndex) return;
    }
    if (index === options.formatIndex) {
      const format = [turn(source, 'user', AGENT_FORMAT_QUESTION_ACU),
        turn(source, 'assistant', AGENT_FORMAT_ANSWER_MARKER_ACU + literalAgentAddresses_ACU(material(options.formatContent)))];
      if (index === root) groups[index].push(...format);
      else groups[index] = format;
      return;
    }
    if (source.content === '你的输出契约是什么？') return;
    const body = material(source.content);
    if (!body.trim()) return;
    if (source.role === 'user' && /[？?]$/.test(body.trim())) {
      groups[index] = [turn(source, 'user', clean(body))];
      return;
    }
    const prior = previous[index - 1];
    if (source.role === 'assistant' && prior?.role === 'user' && groups[index - 1]?.length) {
      const priorGroup = groups[index - 1];
      if (priorGroup[priorGroup.length - 1]?.role === 'user') groups[index] = [turn(source, 'assistant', clean(body))];
      else groups[index] = pair(source, '这些规则你具体怎样落实？', body);
    } else groups[index] = pair(source, options.questions?.[index] ?? '这一部分有哪些规则，你会怎样执行？', body);
  });
  if (snapshot >= 0) groups[snapshot] = [{ ...previous[snapshot], snapshotTemplate:
    [previous[snapshot].snapshotTemplate ?? '', ...moved, options.snapshotAppend ?? ''].filter(Boolean).join('\n\n') }];
  if (history >= 0) groups[history] = [{ ...previous[history] }];
  if (prefill >= 0) groups[prefill] = [{ ...previous[prefill] }];
  const middle = previous.map((_, index) => index).filter(index => ![root, options.formatIndex, snapshot, history, prefill].includes(index));
  // 身份与格式原来可能共用一段，输出时仍将格式问答放在身份之后。
  if (options.formatIndex === root) {
    const rootGroup = groups[root];
    const format = rootGroup.splice(-2);
    groups[root] = [rootGroup[0], ...format, ...rootGroup.slice(1)];
  }
  return { groups, order: [root, ...(options.formatIndex === root ? [] : [options.formatIndex]), ...middle, snapshot, history, prefill].filter(index => index >= 0) };
}

export function buildAgentQaLayout_ACU<T extends AgentQaSegment_ACU>(previous: readonly T[], options: AgentQaOptions_ACU): T[] {
  const plan = qaPlan_ACU(previous, options);
  // 身份的职责问答也排在格式问答之后。
  const root = plan.order[0];
  const identity = plan.groups[root].slice(0, 1);
  const remainder = plan.groups[root].slice(1);
  if (options.formatIndex === root) return plan.order.flatMap(index => plan.groups[index]);
  return [...identity, ...plan.groups[options.formatIndex], ...remainder,
    ...plan.order.filter(index => index !== root && index !== options.formatIndex).flatMap(index => plan.groups[index])];
}

/** 逐字识别内置槽位；用户正文、模板、开关与重排位置不作为默认覆盖对象。 */
export function migrateAgentQaLayout_ACU<T extends AgentQaSegment_ACU>(segments: readonly T[], previous: readonly T[], options: AgentQaOptions_ACU): T[] {
  // 某些旧信封缺失的角色已由加载器补为当前默认，不可再次拆分其问答。
  if (segments.some(isAgentFormatAnswer_ACU)) return segments.map(segment => ({ ...segment }));
  const plan = qaPlan_ACU(previous, options);
  const match = (segment: T, old: T) => segment.role === old.role && segment.content === old.content;
  if (segments.length === previous.length && segments.every((segment, index) => match(segment, previous[index])
    && segment.enabled === previous[index].enabled && segment.snapshotTemplate === previous[index].snapshotTemplate)) {
    const inherit = (next: T, index: number): T => ({ ...segments[index], role: next.role, content: next.content,
      ...(isAgentSnapshotSlot_ACU(next) && segments[index].snapshotTemplate === previous[index].snapshotTemplate
        ? { snapshotTemplate: next.snapshotTemplate } : {}) } as T);
    const root = plan.order[0];
    if (options.formatIndex === root) return plan.order.flatMap(index => plan.groups[index].map(next => inherit(next, index)));
    return [
      ...plan.groups[root].slice(0, 1).map(next => inherit(next, root)),
      ...plan.groups[options.formatIndex].map(next => inherit(next, options.formatIndex)),
      ...plan.groups[root].slice(1).map(next => inherit(next, root)),
      ...plan.order.filter(index => index !== root && index !== options.formatIndex)
        .flatMap(index => plan.groups[index].map(next => inherit(next, index))),
    ];
  }
  const result: T[] = [];
  for (const segment of segments) {
    const index = previous.findIndex(old => match(segment, old));
    if (index < 0) { result.push({ ...segment }); continue; }
    const group = plan.groups[index].map(next => ({ ...segment, role: next.role, content: next.content,
      ...(isAgentSnapshotSlot_ACU(next) && segment.snapshotTemplate === previous[index].snapshotTemplate
        ? { snapshotTemplate: next.snapshotTemplate } : {}) } as T));
    result.push(...group);
  }
  return result;
}
