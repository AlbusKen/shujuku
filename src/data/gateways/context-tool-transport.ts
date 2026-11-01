/**
 * data/gateways/context-tool-transport.ts — 上下文工具化传输（请求侧）
 *
 * 发送出口把最终 messages 改写为「首条身份段 + 一条控制提示」：
 * 首条之后的每条消息转成一个无参函数 turn_NNN_role，原文写在函数描述里。
 * 没有原有工具的请求另挂一个只调用一次的输出函数，由 context-tool-response.ts 把它的参数还原成正文；
 * 已有工具的请求保留原有工具并排在 turn_ 函数之后，响应不改写。
 * 本模块只做纯数据变换，不发请求、不读设置；开关由服务层经 configure 注入。
 */

export const CONTEXT_TOOL_PREFIX_ACU = 'turn_';
export const EMIT_TOOL_PREFIX_ACU = 'emit_complete_response_';

/** OpenAI 兼容接口单次最多 128 个函数；预留原有工具与输出函数的位置。 */
const MAX_TOTAL_TOOLS_ACU = 120;
const CONTEXT_TOOL_NAME_PATTERN_ACU = /^turn_\d+_/;

export type ContextToolTransportMode_ACU = 'emit' | 'passthrough';

export interface ContextToolTransportPlan_ACU {
  /** emit：响应侧还原输出函数；passthrough：原有工具照常返回，响应不改写。 */
  mode: ContextToolTransportMode_ACU;
  /** emit 模式下本次请求的输出函数名；passthrough 为空串。 */
  emitToolName: string;
  /** 改写前请求体的 stream 字段。 */
  streamRequested: boolean;
}

export type ContextToolBypassReason_ACU =
  | 'no-messages'
  | 'no-context'
  | 'non-text-content'
  | 'too-many-tools'
  | 'caller-forced-tool'
  | 'tools-disabled-by-caller'
  | 'already-prepared';

export type ContextToolTransportResult_ACU =
  | { kind: 'prepared'; body: Record<string, any>; plan: ContextToolTransportPlan_ACU; contextToolCount: number }
  | { kind: 'bypass'; reason: ContextToolBypassReason_ACU };

let enabledProvider_ACU: () => boolean = () => false;

/** 服务层启动时注入可用性读取函数；未注入时视为关闭，请求原样发送。是否改写另由本次请求所用 API 预设的开关决定。 */
export function configureContextToolTransport_ACU(provider: () => boolean): void {
  enabledProvider_ACU = provider;
}

export function isContextToolTransportEnabled_ACU(): boolean {
  try {
    return enabledProvider_ACU() === true;
  } catch {
    return false;
  }
}

export function bareToolName_ACU(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1);
}

/** 响应侧按函数名区分：本次输出函数、turn_ 上下文函数、调用方原有函数。 */
export function classifyTransportToolName_ACU(
  name: unknown,
  plan: ContextToolTransportPlan_ACU,
): 'emit' | 'context' | 'client' {
  if (typeof name !== 'string' || !name) return 'client';
  const bare = bareToolName_ACU(name);
  if (plan.mode === 'emit' && (bare === plan.emitToolName || bare.startsWith(EMIT_TOOL_PREFIX_ACU))) return 'emit';
  if (CONTEXT_TOOL_NAME_PATTERN_ACU.test(bare)) return 'context';
  return 'client';
}


const emptyParameters_ACU = (): Record<string, unknown> => ({ type: 'object', properties: {}, additionalProperties: false });

function safeRoleToken_ACU(role: unknown): string {
  const token = String(role ?? '').replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  return token.slice(0, 32) || 'message';
}

/** 拼接文本片段；含图片等非文本片段时返回 null，整次请求放弃改写，避免丢失多模态内容。 */
function renderTextContent_ACU(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') { parts.push(part); continue; }
    const record = part && typeof part === 'object' ? part as Record<string, unknown> : undefined;
    if (record && typeof record.text === 'string' && (record.type === undefined || record.type === 'text')) {
      parts.push(record.text);
      continue;
    }
    return null;
  }
  return parts.join('\n');
}

function renderToolCalls_ACU(calls: unknown): string {
  if (!Array.isArray(calls) || calls.length === 0) return '';
  return JSON.stringify(calls.map((call: any) => ({
    id: call?.id,
    name: call?.function?.name,
    arguments: call?.function?.arguments,
  })));
}

function describeMessage_ACU(message: any, index: number, text: string): string {
  const lines = [`index: ${index}`, `role: ${typeof message?.role === 'string' ? message.role : ''}`];
  if (typeof message?.name === 'string' && message.name) lines.push(`name: ${message.name}`);
  if (typeof message?.tool_call_id === 'string' && message.tool_call_id) lines.push(`tool_call_id: ${message.tool_call_id}`);
  const calls = renderToolCalls_ACU(message?.tool_calls);
  if (calls) lines.push(`tool_calls: ${calls}`);
  lines.push('', text);
  return lines.join('\n');
}

function allocateName_ACU(base: string, taken: Set<string>): string {
  let name = base;
  for (let suffix = 2; taken.has(name); suffix += 1) name = `${base}_${suffix}`;
  taken.add(name);
  return name;
}

const CONTEXT_GROUP_SEPARATOR_ACU = '\n\n----------\n\n';

function buildControlPrompt_ACU(mode: ContextToolTransportMode_ACU, emitToolName: string): string {
  const head = '本次请求的全部要求与上下文写在名称以 turn_ 开头的函数里。请按名称中的序号依次阅读这些函数的说明：每段开头标明原消息的序号（index）与角色（role），有名称时还标明 name；空行之后是原文。预设指令与对话记录都在这组函数里，要求以其中内容为准。turn_ 函数只用于阅读，不要调用。';
  if (mode === 'emit') {
    return `${head}\n\n请调用 \`${emitToolName}\` 函数恰好一次，把完整的最终回复写进它的 content 参数；不要在函数调用之外输出回复正文。`;
  }
  return `${head}\n\n排在 turn_ 函数之后的是本次可用的工具，请按上述要求调用它们，不要把工具参数写成普通回复。`;
}

function buildEmitTool_ACU(name: string): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name,
      description: '输出本次完整的最终回复。只调用一次，把全部回复正文放进 content，不要在调用之外输出正文。',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string', description: '展示给用户的完整最终回复。' } },
        required: ['content'],
      },
    },
  };
}

/** 首条之后的消息按顺序分组；数量超过函数预算时，相邻消息合并进同一个函数。 */
function groupRanges_ACU(count: number, budget: number): Array<[number, number]> {
  const size = Math.max(1, Math.ceil(count / budget));
  const ranges: Array<[number, number]> = [];
  for (let start = 1; start <= count; start += size) ranges.push([start, Math.min(count, start + size - 1)]);
  return ranges;
}

/**
 * 把一次 Chat Completion 请求体改写为上下文工具化形态；不修改入参。
 * 保留 messages[0]（身份段），其后追加一条 user 控制提示，其余消息转为 turn_ 函数。
 */
export function prepareContextToolRequest_ACU(body: Record<string, any>): ContextToolTransportResult_ACU {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return { kind: 'bypass', reason: 'no-messages' };
  const existingTools: any[] = Array.isArray(body.tools) ? body.tools.filter(Boolean) : [];
  const existingNames = new Set<string>();
  for (const tool of existingTools) {
    const name = tool?.function?.name;
    if (typeof name === 'string' && name) existingNames.add(name);
  }
  if ([...existingNames].some(name => CONTEXT_TOOL_NAME_PATTERN_ACU.test(bareToolName_ACU(name)))) {
    return { kind: 'bypass', reason: 'already-prepared' };
  }
  const choice = body.tool_choice;
  if (existingTools.length > 0) {
    if (choice === 'none') return { kind: 'bypass', reason: 'tools-disabled-by-caller' };
    if (choice === 'required' || (choice && typeof choice === 'object')) return { kind: 'bypass', reason: 'caller-forced-tool' };
  }
  if (messages.length < 2) return { kind: 'bypass', reason: 'no-context' };
  const descriptions: string[] = [];
  for (let index = 1; index < messages.length; index += 1) {
    const text = renderTextContent_ACU(messages[index]?.content);
    if (text === null) return { kind: 'bypass', reason: 'non-text-content' };
    descriptions.push(describeMessage_ACU(messages[index], index, text));
  }
  const mode: ContextToolTransportMode_ACU = existingTools.length > 0 ? 'passthrough' : 'emit';
  const budget = MAX_TOTAL_TOOLS_ACU - existingTools.length - (mode === 'emit' ? 1 : 0);
  if (budget < 1) return { kind: 'bypass', reason: 'too-many-tools' };

  const ranges = groupRanges_ACU(descriptions.length, budget);
  const width = String(messages.length - 1).length;
  const taken = new Set(existingNames);
  const contextTools = ranges.map(([start, end]) => {
    const role = start === end ? safeRoleToken_ACU(messages[start]?.role) : 'group';
    return {
      type: 'function',
      function: {
        name: allocateName_ACU(`${CONTEXT_TOOL_PREFIX_ACU}${String(start).padStart(width, '0')}_${role}`, taken),
        description: descriptions.slice(start - 1, end).join(CONTEXT_GROUP_SEPARATOR_ACU),
        parameters: emptyParameters_ACU(),
      },
    };
  });
  // 输出函数名固定，避免每次请求变化破坏工具前缀的提示词缓存。
  const emitToolName = mode === 'emit' ? allocateName_ACU(`${EMIT_TOOL_PREFIX_ACU}reply`, taken) : '';
  const tools = mode === 'emit' ? [...contextTools, buildEmitTool_ACU(emitToolName)] : [...contextTools, ...existingTools];
  const postProcessing = typeof body.custom_prompt_post_processing === 'string'
    ? TOOL_POST_PROCESSING_ACU[body.custom_prompt_post_processing] : undefined;
  return {
    kind: 'prepared',
    body: {
      ...body,
      messages: [messages[0], { role: 'user', content: buildControlPrompt_ACU(mode, emitToolName) }],
      tools,
      tool_choice: 'auto',
      ...(postProcessing ? { custom_prompt_post_processing: postProcessing } : {}),
    },
    plan: { mode, emitToolName, streamRequested: body.stream === true },
    contextToolCount: contextTools.length,
  };
}

/** 带工具的请求改用酒馆后处理的 *_tools 变体，与服务层原生工具请求的约定一致。 */
const TOOL_POST_PROCESSING_ACU: Record<string, string> = { merge: 'merge_tools', semi: 'semi_tools', strict: 'strict_tools', single: 'strict_tools' };

const BYPASS_TEXT_ACU: Record<ContextToolBypassReason_ACU, string> = {
  'no-messages': '请求没有 messages',
  'no-context': '只有首条消息，没有可转换的上下文',
  'non-text-content': '消息含图片等非文本内容，改写会丢失内容',
  'too-many-tools': '原有工具已占满函数数量上限',
  'caller-forced-tool': '调用方指定了必须调用的工具',
  'tools-disabled-by-caller': '调用方禁用了工具调用',
  'already-prepared': '请求已是上下文工具化形态',
};

export interface ContextToolTransportApplied_ACU {
  body: Record<string, any>;
  /** 为 null 表示本次未改写，响应保持原样。 */
  plan: ContextToolTransportPlan_ACU | null;
  /** 写入 API 请求日志的说明；开关关闭时为空串。 */
  note: string;
}

/** 发送出口统一入口：预设关闭开关、服务层未装配或无法改写时原样返回请求体。presetEnabled 缺省按开启处理。 */
export function applyContextToolTransport_ACU(body: Record<string, any>, presetEnabled = true): ContextToolTransportApplied_ACU {
  if (presetEnabled === false || !isContextToolTransportEnabled_ACU()) return { body, plan: null, note: '' };
  const result = prepareContextToolRequest_ACU(body);
  if (result.kind === 'bypass') {
    return { body, plan: null, note: `上下文工具化未改写：${BYPASS_TEXT_ACU[result.reason] ?? result.reason}` };
  }
  const how = result.plan.mode === 'emit' ? '回复经输出函数还原为正文' : '原有工具排在其后';
  return { body: result.body, plan: result.plan, note: `上下文工具化：保留首条消息，其余转为 ${result.contextToolCount} 个 turn_ 函数，${how}` };
}

/** 不能携带 tools 的通道（文本补全连接、generateRaw）写入日志的固定说明。 */
export const CONTEXT_TOOL_UNSUPPORTED_NOTE_ACU = '上下文工具化未生效：该通道不支持携带 tools，按原样发送';


/**
 * 按本次请求所用 API 预设合并直发选项：只有预设关闭「API工具调用」时才附加 contextToolTransport: false；
 * 开启（含旧预设缺省）时原样返回，不改变调用方的选项对象。
 */
export function presetContextToolOptions_ACU<T extends object>(
  config: { contextToolTransportEnabled?: boolean } | null | undefined,
  options?: T,
): (T & { contextToolTransport?: boolean }) | undefined {
  if (config?.contextToolTransportEnabled !== false) return options;
  return { ...(options ?? {}), contextToolTransport: false } as T & { contextToolTransport?: boolean };
}

/** 供原本不传直发选项的调用点展开：开启时为空数组，参数个数保持不变。 */
export function presetContextToolArgs_ACU(
  config: { contextToolTransportEnabled?: boolean } | null | undefined,
): [] | [{ contextToolTransport: boolean }] {
  return config?.contextToolTransportEnabled === false ? [{ contextToolTransport: false }] : [];
}
