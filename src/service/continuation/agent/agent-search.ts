/**
 * service/continuation/agent/agent-search.ts — 五域 grep 式搜索工具
 *
 * 搜索域即资料域：story（窗口内 AI 正文）、tables（全部表格行）、modules（伏笔/信息差/约束/
 * 总纲/年代学/百科资料库，含退休条目）、outline（当前修订的大纲文本）、worldbook（已启用条目全文）。
 * 互联网检索不在此列——那是 web-researcher 专用的出网工具，见 agent-web-client.ts。
 *
 * 核心原则「地址即读法」：每条命中都附带可直接复制进 read 的读取地址。
 * 三层护栏（照抄奶龙code search_in_files 思路）：单行居中截断、maxResults 条数上限、
 * 结果总量字符预算，超出即停止收集并如实标注截断。
 *
 * 执行零成本：运行时本地执行，不发 AI 调用。
 */

import type { AgentSearchCall_ACU, AgentSearchScope_ACU } from './agent-model';
import {
  listAgentStoryWindowFloors_ACU,
  type AgentResolveContext_ACU,
} from './agent-placeholder-resolver';
import { buildEmptyAgentWorldbookSnapshot_ACU } from './agent-worldbook-read';
import { currentJsonTableData_ACU } from '../../runtime/state-manager';

/** 单行片段上限：匹配词居中开窗。 */
const SEARCH_LINE_SNIPPET_LIMIT_ACU = 300;
/** 结果总量字符预算：超出即停止收集。 */
const SEARCH_TOTAL_CHAR_BUDGET_ACU = 20000;
/** 每条命中的结构开销估算（标签、地址、分隔符）。 */
const SEARCH_HIT_OVERHEAD_ACU = 60;
/** isRegex 模式的正则长度上限：模型产出的超长模式几乎必然是错误或病态回溯，直接拒绝并要求修正。 */
const SEARCH_REGEX_MAX_LENGTH_ACU = 300;

interface AgentSearchLine_ACU {
  /** 人类可读位置，如「楼层12 第3行」「角色表 第5行」。 */
  label: string;
  /** 可直接复制进 read 的读取地址。 */
  address: string;
  text: string;
}

interface AgentSearchHit_ACU {
  scope: AgentSearchScope_ACU;
  label: string;
  address: string;
  snippet: string;
}

function escapeRegex_ACU(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 匹配词居中开窗截断单行，沿用奶龙code createMatchLineSnippet 的思路。 */
export function createAgentMatchSnippet_ACU(line: string, matchStart: number, matchLength: number, limit = SEARCH_LINE_SNIPPET_LIMIT_ACU): string {
  if (line.length <= limit) return line;
  const start = Math.max(0, matchStart);
  const end = Math.max(start, start + Math.max(0, matchLength));
  const half = Math.floor(limit / 2);
  let windowStart = Math.max(0, start - half);
  let windowEnd = windowStart + limit;
  if (windowEnd < end) {
    windowEnd = Math.min(line.length, end + half);
    windowStart = Math.max(0, windowEnd - limit);
  }
  if (windowEnd > line.length) {
    windowEnd = line.length;
    windowStart = Math.max(0, windowEnd - limit);
  }
  let snippet = line.slice(windowStart, windowEnd);
  if (windowStart > 0) snippet = `…${snippet}`;
  if (windowEnd < line.length) snippet = `${snippet}…`;
  return snippet;
}

function splitLines_ACU(text: string): string[] {
  return text.split(/\r?\n/);
}

function collectStoryLines_ACU(context: AgentResolveContext_ACU): AgentSearchLine_ACU[] {
  return listAgentStoryWindowFloors_ACU(context).flatMap(floor =>
    splitLines_ACU(floor.text).map((line, lineIndex) => ({
      label: `楼层${floor.index} 第${lineIndex + 1}行`,
      address: `$STORY_RANGE:${floor.index}-${floor.index}`,
      text: line,
    })));
}

function collectTableLines_ACU(context: AgentResolveContext_ACU): AgentSearchLine_ACU[] {
  const source = context.tableData ?? currentJsonTableData_ACU;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
  const lines: AgentSearchLine_ACU[] = [];
  for (const [key, sheet] of Object.entries(source as Record<string, any>)) {
    if (key === 'mate' || !sheet || typeof sheet !== 'object') continue;
    const name = String(sheet.name ?? '').trim();
    const content = Array.isArray(sheet.content) ? sheet.content : [];
    if (!name || !Array.isArray(content[0])) continue;
    content.slice(1).forEach((row: unknown, rowIndex: number) => {
      if (!Array.isArray(row)) return;
      const rowNumber = rowIndex + 1;
      lines.push({
        label: `${name} 第${rowNumber}行`,
        address: `$TABLE:${name}:${rowNumber}-${rowNumber}`,
        text: row.map(cell => String(cell ?? '').trim()).join(' | '),
      });
    });
  }
  return lines;
}

function collectModuleLines_ACU(context: AgentResolveContext_ACU): AgentSearchLine_ACU[] {
  const snapshot = context.moduleSnapshot;
  const lines: AgentSearchLine_ACU[] = [];
  for (const entry of snapshot.storyArc) {
    lines.push({
      label: `故事总纲 [${entry.id}]${entry.retired ? '（已废止）' : ''}`,
      address: `$STORY_ARC:${entry.id}`,
      text: [
        entry.title,
        entry.narrativeRole,
        entry.targetStageRange ? `targetStageRange=${entry.targetStageRange.min}-${entry.targetStageRange.max}` : '',
        entry.targetTimeSpan,
        entry.direction,
        entry.escalation,
        entry.progressCeiling,
        ...(entry.sustainingThreads ?? []),
        ...(entry.payoffTargets ?? []),
        entry.withheld,
        entry.completionRationale,
        entry.retiredReason,
      ].filter(Boolean).join('｜'),
    });
  }
  for (const hook of snapshot.hooks) {
    lines.push({
      label: `伏笔账本 [${hook.id}]${hook.retired ? '（已退休）' : ''}`,
      address: `$HOOKS_LEDGER:${hook.id}`,
      text: [hook.summary, hook.plannedPayoff, hook.retiredReason].filter(Boolean).join('｜'),
    });
  }
  for (const entry of snapshot.infoGap) {
    lines.push({
      label: `信息差 [${entry.id}]${entry.retired ? '（已退休）' : ''}`,
      address: `$INFO_GAP:${entry.id}`,
      text: [entry.topic, entry.objectiveFact, entry.readerKnown, ...entry.characterKnowledge.map(item => `${item.name}=${item.knows}`)].filter(Boolean).join('｜'),
    });
  }
  for (const constraint of snapshot.constraints) {
    lines.push({
      label: `长期约束 [${constraint.id}]`,
      address: `$ACTIVE_CONSTRAINTS:${constraint.id}`,
      text: [constraint.text, constraint.reason].filter(Boolean).join('｜'),
    });
  }
  for (const entry of snapshot.webRefs) {
    const head = `百科资料库 [${entry.id}]${entry.retired ? '（已退休）' : ''}`;
    const address = `$WEB_REFS:${entry.id}`;
    lines.push({ label: `${head}（名称/简介/标签/详情）`, address, text: [entry.title, entry.brief, ...entry.tags, entry.summary].filter(Boolean).join('｜') });
  }
  for (const entry of snapshot.chronology) {
    lines.push({
      label: `故事年代学 [${entry.id}]${entry.retired ? '（已作废）' : ''}`,
      address: `$CHRONOLOGY:${entry.id}`,
      text: [
        entry.anchor,
        entry.elapsed,
        `precision=${entry.precision}`,
        entry.transition,
        entry.evidenceIndexes.length ? `证据楼层=${entry.evidenceIndexes.join('、')}` : '',
        entry.retiredReason,
      ].filter(Boolean).join('｜'),
    });
  }
  return lines;
}

function collectOutlineLines_ACU(context: AgentResolveContext_ACU): AgentSearchLine_ACU[] {
  const revision = context.execution.revision;
  if (!revision) return [];
  const lines: AgentSearchLine_ACU[] = [{
    label: '大纲 阶段标题',
    address: '$OUTLINE_WINDOW',
    text: `${revision.outline.title}｜${revision.outline.goal}｜tempo=${revision.outline.tempo}｜role=${revision.outline.role ?? '未标注'}｜timeSpan=${revision.outline.timeSpanGoal ?? '未设定'}`,
  }];
  for (const node of revision.outline.nodes) {
    lines.push({ label: `大纲 节点[${node.id}]`, address: '$OUTLINE_WINDOW', text: `${node.title}｜${node.goal}` });
    for (const turn of node.turns) {
      const metadata = `pacing=${turn.pacing}｜function=${turn.function ?? '未标注'}｜mainline=${turn.mainlineDelta ?? '未标注'}｜time=${turn.timeAdvance ?? '未标注'}${turn.timeAnchor ? `｜anchor=${turn.timeAnchor}` : ''}`;
      // 搜索器匹配 text 而不是 label；元数据必须进入正文，不能只做不可检索的展示装饰。
      lines.push({ label: `大纲 轮次[${turn.id}]`, address: '$OUTLINE_WINDOW', text: `${metadata}｜${turn.goal}` });
    }
  }
  return lines;
}

function collectWorldbookLines_ACU(context: AgentResolveContext_ACU): AgentSearchLine_ACU[] {
  const worldbook = context.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false);
  const lines: AgentSearchLine_ACU[] = [];
  for (const entry of worldbook.entries) {
    const address = `$WORLDBOOK:${entry.bookName}:${entry.uid}`;
    const head = `世界书「${entry.bookName}」条目 ${entry.title}`;
    lines.push({ label: `${head}（标题/关键词）`, address, text: `${entry.title}｜${entry.keys.join('、')}` });
    splitLines_ACU(entry.content).forEach((line, lineIndex) => {
      lines.push({ label: `${head} 第${lineIndex + 1}行`, address, text: line });
    });
  }
  return lines;
}

const SCOPE_COLLECTORS_ACU: Record<AgentSearchScope_ACU, (context: AgentResolveContext_ACU) => AgentSearchLine_ACU[]> = {
  story: collectStoryLines_ACU,
  tables: collectTableLines_ACU,
  modules: collectModuleLines_ACU,
  outline: collectOutlineLines_ACU,
  worldbook: collectWorldbookLines_ACU,
};

const SCOPE_LABELS_ACU: Record<AgentSearchScope_ACU, string> = {
  story: '正文',
  tables: '表格',
  modules: '资料模块',
  outline: '大纲',
  worldbook: '世界书',
};

/**
 * 执行一次 grep 式搜索。
 * @param call 已通过协议校验的 search 调用
 * @param context 解析上下文（与 read 共用同一份数据快照，地址不漂移）
 * @returns 结果文本：每条命中一行「[域] 位置：片段｜读取地址」；正则非法/无命中时返回可修正的说明
 */
export function runAgentSearch_ACU(call: AgentSearchCall_ACU, context: AgentResolveContext_ACU): string {
  if (call.isRegex && call.query.length > SEARCH_REGEX_MAX_LENGTH_ACU) {
    return `搜索正则过长（${call.query.length} > ${SEARCH_REGEX_MAX_LENGTH_ACU} 字符），已拒绝执行。请精简正则，或拆分为多次搜索。`;
  }
  let regex: RegExp;
  try {
    regex = call.isRegex ? new RegExp(call.query, 'i') : new RegExp(escapeRegex_ACU(call.query), 'i');
  } catch (error) {
    return `搜索正则「${call.query}」编译失败：${error instanceof Error ? error.message : String(error)}。请修正正则，或去掉 isRegex 按字面关键词搜索。`;
  }

  const hits: AgentSearchHit_ACU[] = [];
  let budget = SEARCH_TOTAL_CHAR_BUDGET_ACU;
  let truncated = false;
  for (const scope of call.scope) {
    if (truncated) break;
    for (const line of SCOPE_COLLECTORS_ACU[scope](context)) {
      if (hits.length >= call.maxResults || budget <= 0) {
        truncated = true;
        break;
      }
      const matched = regex.exec(line.text);
      if (!matched) continue;
      const snippet = createAgentMatchSnippet_ACU(line.text, matched.index, matched[0].length);
      const cost = snippet.length + line.label.length + line.address.length + SEARCH_HIT_OVERHEAD_ACU;
      if (budget - cost < 0) {
        truncated = true;
        break;
      }
      budget -= cost;
      hits.push({ scope, label: line.label, address: line.address, snippet });
    }
  }

  const scopeText = call.scope.map(scope => SCOPE_LABELS_ACU[scope]).join('、');
  if (!hits.length) {
    return `搜索「${call.query}」在 ${scopeText} 域内没有命中。可尝试：换更短的关键词、扩大 scope、或改用正则（isRegex: true）。注意正文只能搜到可读窗口内的楼层，更早剧情的脉络请查看事件概览或用 $TABLE:纪要表:行区间 精读。`;
  }
  const lines = hits.map(hit => `- [${SCOPE_LABELS_ACU[hit.scope]}] ${hit.label}：${hit.snippet}｜读取地址 ${hit.address}`);
  const tail = truncated
    ? `\n（结果已截断：达到条数上限 ${call.maxResults} 或总量预算。请用更精确的关键词缩小范围，或分域搜索。）`
    : '';
  return `搜索「${call.query}」命中 ${hits.length} 处（域：${scopeText}）。命中行右侧附读取地址，可直接复制进 read：\n${lines.join('\n')}${tail}`;
}
