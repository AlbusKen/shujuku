// service/ai/prompt-builder/table-fill-tools.ts — 填表原生工具（正文提取模式）
//
// 仅在全局开关 tableFillNativeToolEnabled 开启且通道能取回 tool_calls 时挂载；默认关闭，
// 因为部分渠道收到 tools 字段会直接报错而不会降级。原生存储模式提供 table_edit，SQLite 模式提供 table_sql。工具参数与 <tableEdit> 块内
// 的正文格式完全一致，调用结果在请求出口被合成为 <tableEdit> 块，下游解析、校验与重试
// 链路不感知工具化；模型未调用工具时保留正文原样，作为兜底走既有正文提取。

import type { AiChatTurn_ACU, AiNativeToolDefinition_ACU } from '../native-tool';
import { DEFAULT_CHAR_CARD_PROMPT_ACU, DEFAULT_CHAR_CARD_PROMPT_SQL_ACU, TABLE_FILL_MAIN_PROMPT_HISTORY_ACU } from '../../../shared/defaults-json.js';

export const TABLE_EDIT_TOOL_NAME_ACU = 'table_edit';
export const TABLE_SQL_TOOL_NAME_ACU = 'table_sql';

const TABLE_EDIT_TOOL_ACU: AiNativeToolDefinition_ACU = {
  type: 'function',
  function: {
    name: TABLE_EDIT_TOOL_NAME_ACU,
    description: '一次性提交本轮全部表格修改。commands 逐行填写 insertRow / updateRow / deleteRow 指令，格式与 <tableEdit> 块内完全相同；本轮没有修改时填空字符串。',
    parameters: {
      type: 'object',
      properties: {
        commands: { type: 'string', description: '每行一条 insertRow(表格ID, {...}) / updateRow(表格ID, 行号, {...}) / deleteRow(表格ID, 行号) 指令。' },
      },
      required: ['commands'],
      additionalProperties: false,
    },
  },
};

const TABLE_SQL_TOOL_ACU: AiNativeToolDefinition_ACU = {
  type: 'function',
  function: {
    name: TABLE_SQL_TOOL_NAME_ACU,
    description: '一次性提交本轮全部表格修改。sql 填写完整 SQL 脚本（INSERT / UPDATE / DELETE，每条以分号结尾），格式与 <tableEdit> 块内完全相同；本轮没有修改时填空字符串。',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: '完整 SQL 脚本，多条语句换行分隔。' },
      },
      required: ['sql'],
      additionalProperties: false,
    },
  },
};

/**
 * 按存储模式返回本次填表请求挂载的工具。
 * @param sqlite 是否为 SQLite 存储模式
 * @returns 仅含一个工具的定义数组
 */
export function buildTableFillNativeTools_ACU(sqlite: boolean): AiNativeToolDefinition_ACU[] {
  return [sqlite ? TABLE_SQL_TOOL_ACU : TABLE_EDIT_TOOL_ACU];
}

function isTableFillMainSegment_ACU(segment: any): boolean {
  return !!segment && (String(segment.mainSlot || '').toUpperCase() === 'A' || !!segment.isMain);
}

/**
 * 按本次请求是否携带填表工具适配提示词主段；只替换逐字命中默认正文的主段，用户改写过的主段与其余段原样保留。
 * - 携带工具：历史正文格式默认（含中间默认）替换为工具版默认。
 * - 不携带工具：工具版默认降级为正文 <tableEdit> 格式默认，避免提示词要求调用不存在的工具。
 * @param segments 本次请求的提示词段
 * @param sqlite 是否为 SQLite 存储模式
 * @param toolEnabled 本次请求是否携带填表工具
 * @returns 适配后的提示词段（新数组，不改写入参）
 */
export function adaptTableFillPromptSegmentsToToolMode_ACU(segments: any[], sqlite: boolean, toolEnabled: boolean): any[] {
  if (!Array.isArray(segments)) return segments;
  const defaults = (sqlite ? DEFAULT_CHAR_CARD_PROMPT_SQL_ACU : DEFAULT_CHAR_CARD_PROMPT_ACU) as any[];
  const toolDefault = defaults.find(isTableFillMainSegment_ACU)?.content;
  const history = TABLE_FILL_MAIN_PROMPT_HISTORY_ACU as unknown as { native: readonly string[]; sql: readonly string[] };
  const bodyDefaults = sqlite ? history.sql : history.native;
  if (typeof toolDefault !== 'string' || typeof bodyDefaults[0] !== 'string') return segments;
  return segments.map(segment => {
    if (!isTableFillMainSegment_ACU(segment) || typeof segment.content !== 'string') return segment;
    if (toolEnabled) return bodyDefaults.includes(segment.content) ? { ...segment, content: toolDefault } : segment;
    return segment.content === toolDefault ? { ...segment, content: bodyDefaults[0] } : segment;
  });
}

/**
 * 按存储模式与填表工具开关返回默认提示词段（逐段浅拷贝）。
 * @param sqlite 是否为 SQLite 存储模式
 * @param toolEnabled 是否启用填表工具调用
 * @returns 默认提示词段
 */
export function buildTableFillDefaultPromptSegments_ACU(sqlite: boolean, toolEnabled: boolean): any[] {
  const defaults = (sqlite ? DEFAULT_CHAR_CARD_PROMPT_SQL_ACU : DEFAULT_CHAR_CARD_PROMPT_ACU) as any[];
  return adaptTableFillPromptSegmentsToToolMode_ACU(defaults.map(segment => ({ ...segment })), sqlite, toolEnabled);
}

export type TableFillToolTurnResolution_ACU =
  | { ok: true; text: string; viaTool: boolean }
  | { ok: false; error: string };

/**
 * 把一次模型回复（正文 + 原生工具调用）归一为正文提取链可消费的文本。
 * - 命中本模式工具：参数合成为 <tableEdit> 块；正文里残留的 <tableEdit> 块被剔除，
 *   避免下游「首对 / 末对」取块规则取到与工具不一致的内容。
 * - 未调用工具：原样返回正文，走既有正文提取兜底。
 * - 工具参数不是合法 JSON 或缺少字段：返回 ok=false，由调用方按可重试模型输出错误处理。
 * @param turn 模型回复
 * @param sqlite 是否为 SQLite 存储模式
 * @returns 归一结果；正文与工具均为空时 text 为空串
 */
export function resolveTableFillToolTurn_ACU(turn: AiChatTurn_ACU, sqlite: boolean): TableFillToolTurnResolution_ACU {
  const toolName = sqlite ? TABLE_SQL_TOOL_NAME_ACU : TABLE_EDIT_TOOL_NAME_ACU;
  const argName = sqlite ? 'sql' : 'commands';
  const content = typeof turn?.content === 'string' ? turn.content : '';
  const calls = (Array.isArray(turn?.toolCalls) ? turn.toolCalls : []).filter(call => call?.name === toolName);
  if (calls.length === 0) return { ok: true, text: content, viaTool: false };
  const parts: string[] = [];
  for (const call of calls) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.arguments || '{}');
    } catch {
      return { ok: false, error: `${toolName} 工具参数不是合法 JSON，请重新调用并确保参数完整。` };
    }
    const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[argName] : undefined;
    if (typeof value !== 'string') return { ok: false, error: `${toolName} 工具参数缺少字符串字段 ${argName}。` };
    if (value.trim()) parts.push(value.trim());
  }
  const residual = content.replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '').trim();
  const block = `<tableEdit>\n${parts.join('\n')}\n</tableEdit>`;
  return { ok: true, text: residual ? `${residual}\n${block}` : block, viaTool: true };
}
