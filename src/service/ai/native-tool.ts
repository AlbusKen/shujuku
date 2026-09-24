/**
 * 续写与推演共用的原生函数调用。
 * 请求走 /api/backends/chat-completions/generate 时，工具定义放在 body.tools，
 * 回包里的 tool_calls / functionCall 原样收下，结果用 role=tool 回灌。
 */

export interface AiNativeToolCall_ACU {
  id: string;
  name: string;
  arguments: string;
}

export interface AiNativeToolDefinition_ACU {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiChatTurn_ACU {
  content: string;
  toolCalls: AiNativeToolCall_ACU[];
}

export interface AiWireMessage_ACU {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface StoredNativeToolCall_ACU {
  id: string;
  name: string;
  arguments: string;
}

const objectSchema_ACU = (properties: Record<string, unknown>, required: readonly string[]): Record<string, unknown> => ({
  type: 'object',
  properties,
  required: [...required],
  additionalProperties: false,
});

export function agentNativeTools_ACU(names: readonly ('read' | 'search' | 'write_sql')[]): AiNativeToolDefinition_ACU[] {
  const catalog: Record<'read' | 'search' | 'write_sql', AiNativeToolDefinition_ACU> = {
    read: {
      type: 'function',
      function: {
        name: 'read',
        description: '按地址调阅资料。reads 必须是非空字符串数组，地址来自当前提示词里的读取地址词汇表。',
        parameters: objectSchema_ACU({
          reads: { type: 'array', items: { type: 'string' }, minItems: 1 },
        }, ['reads']),
      },
    },
    search: {
      type: 'function',
      function: {
        name: 'search',
        description: '跨域检索。query 必填。scope、maxResults、isRegex 可选。',
        parameters: objectSchema_ACU({
          query: { type: 'string' },
          scope: { type: 'array', items: { type: 'string' } },
          maxResults: { type: 'integer', minimum: 1, maximum: 50 },
          isRegex: { type: 'boolean' },
        }, ['query']),
      },
    },
    write_sql: {
      type: 'function',
      function: {
        name: 'write_sql',
        description: '提交一条受限 INSERT、UPDATE 或 DELETE。只写当前职责允许的模块，并使用回执里的 revision。',
        parameters: objectSchema_ACU({
          sql: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
        }, ['sql']),
      },
    },
  };
  return names.map(name => catalog[name]);
}

export function normalizeAgentModelReply_ACU(raw: unknown): AiChatTurn_ACU {
  if (typeof raw === 'string' || raw == null) return { content: String(raw ?? ''), toolCalls: [] };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const value = raw as { content?: unknown; toolCalls?: unknown };
    const toolCalls = Array.isArray(value.toolCalls) ? value.toolCalls.flatMap(normalizeStoredToolCall_ACU) : [];
    return { content: typeof value.content === 'string' ? value.content : '', toolCalls };
  }
  return { content: String(raw), toolCalls: [] };
}

export function normalizeStoredToolCall_ACU(raw: unknown): AiNativeToolCall_ACU[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const value = raw as { id?: unknown; name?: unknown; arguments?: unknown };
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!id || !name) return [];
  const args = typeof value.arguments === 'string' ? value.arguments : JSON.stringify(value.arguments ?? {});
  return [{ id, name, arguments: args }];
}

/** 文本协议里的 read/search/write_sql 也要落成工具记录；混有其它动作时返回空，交给原路径。 */
export function synthesizeProtocolToolCalls_ACU(calls: readonly {
  kind: string;
  reads?: readonly string[];
  query?: string;
  scope?: readonly string[];
  isRegex?: boolean;
  maxResults?: number;
  sql?: string;
  evidenceRefs?: readonly string[];
}[]): AiNativeToolCall_ACU[] {
  if (!calls.length || calls.some(call => call.kind !== 'read' && call.kind !== 'search' && call.kind !== 'write_sql')) return [];
  return calls.map((call, index) => ({
    id: `call_${index}_${call.kind}`,
    name: call.kind,
    arguments: JSON.stringify(call.kind === 'read'
      ? { reads: [...(call.reads ?? [])] }
      : call.kind === 'search'
        ? { query: call.query ?? '', ...(call.scope ? { scope: [...call.scope] } : {}), ...(call.maxResults !== undefined ? { maxResults: call.maxResults } : {}), ...(call.isRegex ? { isRegex: true } : {}) }
        : { sql: call.sql ?? '', ...(call.evidenceRefs?.length ? { evidenceRefs: [...call.evidenceRefs] } : {}) }),
  }));
}

export function nativeToolCallsToProtocolJson_ACU(calls: readonly AiNativeToolCall_ACU[]): string {
  return calls.map(call => JSON.stringify(protocolRecord_ACU(call))).join('\n');
}

function protocolRecord_ACU(call: AiNativeToolCall_ACU): Record<string, unknown> {
  const args = parseArguments_ACU(call.arguments);
  if (call.name === 'read') {
    const reads = Array.isArray(args.reads) ? args.reads : (typeof args.address === 'string' ? [args.address] : []);
    return { action: 'read', reads };
  }
  if (call.name === 'search') {
    return {
      action: 'search',
      query: args.query,
      ...(args.scope !== undefined ? { scope: args.scope } : {}),
      ...(args.maxResults !== undefined ? { maxResults: args.maxResults } : {}),
      ...(args.isRegex !== undefined ? { isRegex: args.isRegex } : {}),
    };
  }
  if (call.name === 'write_sql') {
    return {
      action: 'write_sql',
      sql: args.sql,
      ...(args.evidenceRefs !== undefined ? { evidenceRefs: args.evidenceRefs } : {}),
    };
  }
  throw new Error(`未知工具 ${call.name}`);
}

function parseArguments_ACU(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('工具参数必须是 JSON 对象');
  return parsed as Record<string, unknown>;
}

export function nativeToolExchange_ACU(content: string, calls: readonly AiNativeToolCall_ACU[], results: readonly string[]): AiWireMessage_ACU[] {
  return [
    {
      role: 'assistant',
      content,
      tool_calls: calls.map(call => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    },
    ...calls.map((call, index) => ({
      role: 'tool',
      tool_call_id: call.id,
      content: results[index] ?? results[0] ?? '',
    })),
  ];
}

export function toOpenAiToolCalls_ACU(calls: readonly StoredNativeToolCall_ACU[]): NonNullable<AiWireMessage_ACU['tool_calls']> {
  return calls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.arguments } }));
}

function isJsonPrefillStub_ACU(content: string): boolean {
  const trimmed = content.trim();
  return trimmed === '{'
    || trimmed.includes('<continue>')
    || trimmed.endsWith('{\n  "thought": "')
    || trimmed.endsWith('{\n  "summary": "')
    || trimmed.endsWith('{\n  "verdict": "')
    || trimmed.endsWith('{\n  "instruction": "');
}

/**
 * 去掉未完成的 JSON 预填充。
 * 它不能只从请求末尾拿掉：一旦后面跟上带 tool_calls 的助手消息，
 * 酒馆会把连续的 assistant 并成前一条，tool_calls 被丢掉，
 * MiniMax 就会报 tool result's tool id not found。
 */
export function dropTerminalJsonPrefill_ACU<T extends { role: string; content: string }>(messages: readonly T[]): T[] {
  return messages.filter(message => !(message.role === 'assistant' && isJsonPrefillStub_ACU(message.content)));
}

/** 原生工具请求的尾部预填充：让模型先写思维链，闭合后再调用函数或输出 JSON。 */
export const NATIVE_TOOL_THINK_PREFILL_ACU = '<think>\n';

function isThinkPrefillStub_ACU(content: string): boolean {
  return content.trim() === '<think>';
}

type ToolAnchorMessage_ACU = {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

/**
 * 酒馆会把连续的 assistant 并成前一条，后一条的 tool_calls 被丢掉。
 * 先自己并成一条并保留全部编号，再给缺少编号的工具结果补上对应 tool_call，
 * 否则 MiniMax 会报 tool result's tool id not found。
 */
export function anchorNativeToolCalls_ACU<T extends ToolAnchorMessage_ACU>(messages: readonly T[]): T[] {
  const collapsed: T[] = [];
  for (const message of messages) {
    const previous = collapsed[collapsed.length - 1];
    if (previous?.role === 'assistant' && message.role === 'assistant') {
      const toolCalls = [...(previous.tool_calls ?? []), ...(message.tool_calls ?? [])];
      collapsed[collapsed.length - 1] = {
        ...previous,
        content: [previous.content, message.content].filter(part => part?.trim()).join('\n\n'),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      };
      continue;
    }
    collapsed.push({ ...message });
  }
  let assistant: T | undefined;
  for (const message of collapsed) {
    if (message.role === 'assistant') assistant = message;
    if (message.role !== 'tool' || !message.tool_call_id || !assistant) continue;
    if ((assistant.tool_calls ?? []).some(call => call.id === message.tool_call_id)) continue;
    assistant.tool_calls = [...(assistant.tool_calls ?? []), {
      id: message.tool_call_id,
      type: 'function',
      function: { name: 'read', arguments: '{}' },
    }];
  }
  return collapsed;
}

/**
 * 去掉 JSON 预填充，并在请求最末补上思维链开头。
 * 思维链只能是最后一条：若它留在带 tool_calls 的助手消息前面，
 * 酒馆会把连续 assistant 并掉，工具编号随之丢失。
 * 上一条已经是 assistant 时不再追加，避免再次并成一条。
 */
export function withNativeToolThinkPrefill_ACU<T extends ToolAnchorMessage_ACU>(messages: readonly T[]): T[] {
  const stripped = anchorNativeToolCalls_ACU(dropTerminalJsonPrefill_ACU(messages).filter(
    message => !(message.role === 'assistant' && isThinkPrefillStub_ACU(message.content)),
  ));
  const last = stripped[stripped.length - 1];
  if (!last || last.role === 'assistant') return stripped;
  return [...stripped, { role: 'assistant', content: NATIVE_TOOL_THINK_PREFILL_ACU } as T];
}

/**
 * assistant 之后必须有 user 或 tool 反馈。一个动作可以跟多条 tool 结果。
 * 纯 assistant/user 交替仍然合法。
 */
export function isModelExchangeSequence_ACU(messages: readonly { role: string }[]): boolean {
  if (!messages.length || messages[0]?.role !== 'assistant') return false;
  let feedback = 0;
  for (const message of messages) {
    if (message.role === 'assistant') {
      if (feedback === 0 && message !== messages[0]) return false;
      feedback = 0;
      continue;
    }
    if (message.role !== 'user' && message.role !== 'tool') return false;
    feedback += 1;
  }
  return feedback > 0;
}

interface ChatTurnAccumulator_ACU {
  content: string;
  calls: Map<number, AiNativeToolCall_ACU>;
  usage: unknown;
}

function accumulator_ACU(): ChatTurnAccumulator_ACU {
  return { content: '', calls: new Map(), usage: undefined };
}

function slot_ACU(state: ChatTurnAccumulator_ACU, index: number): AiNativeToolCall_ACU {
  const existing = state.calls.get(index);
  if (existing) return existing;
  const created = { id: '', name: '', arguments: '' };
  state.calls.set(index, created);
  return created;
}

function rememberUsage_ACU(state: ChatTurnAccumulator_ACU, json: Record<string, unknown>): void {
  if (json.usage && typeof json.usage === 'object') state.usage = json.usage;
  if (json.usageMetadata && typeof json.usageMetadata === 'object') state.usage = json.usageMetadata;
}

export function absorbChatCompletionEvent_ACU(state: ChatTurnAccumulator_ACU, json: unknown): void {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return;
  const record = json as Record<string, unknown>;
  rememberUsage_ACU(state, record);
  const choice = Array.isArray(record.choices) ? record.choices[0] as Record<string, unknown> | undefined : undefined;
  const delta = choice?.delta && typeof choice.delta === 'object' ? choice.delta as Record<string, unknown> : undefined;
  const message = choice?.message && typeof choice.message === 'object' ? choice.message as Record<string, unknown> : undefined;
  const packet = delta ?? message;
  if (packet && typeof packet.content === 'string') state.content += packet.content;
  const listed = packet?.tool_calls;
  if (Array.isArray(listed)) {
    listed.forEach((raw, fallback) => absorbOpenAiToolCall_ACU(state, raw, fallback));
  }
  if (record.type === 'content_block_delta' && record.delta && typeof record.delta === 'object') {
    const anthropic = record.delta as Record<string, unknown>;
    const index = typeof record.index === 'number' ? record.index : 0;
    if (anthropic.type === 'text_delta' && typeof anthropic.text === 'string') state.content += anthropic.text;
    if (anthropic.type === 'input_json_delta' && typeof anthropic.partial_json === 'string') slot_ACU(state, index).arguments += anthropic.partial_json;
  }
  if (record.type === 'content_block_start' && record.content_block && typeof record.content_block === 'object') {
    const block = record.content_block as Record<string, unknown>;
    if (block.type === 'tool_use') {
      const index = typeof record.index === 'number' ? record.index : state.calls.size;
      const current = slot_ACU(state, index);
      if (typeof block.id === 'string') current.id = block.id;
      if (typeof block.name === 'string') current.name = block.name;
    }
  }
  const candidates = Array.isArray(record.candidates) ? record.candidates[0] as Record<string, unknown> | undefined : undefined;
  const parts = candidates?.content && typeof candidates.content === 'object'
    ? (candidates.content as Record<string, unknown>).parts : undefined;
  if (Array.isArray(parts)) {
    for (const part of parts) absorbGeminiPart_ACU(state, part);
  }
}

function absorbOpenAiToolCall_ACU(state: ChatTurnAccumulator_ACU, raw: unknown, fallback: number): void {
  if (!raw || typeof raw !== 'object') return;
  const call = raw as Record<string, unknown>;
  const index = typeof call.index === 'number' ? call.index : fallback;
  const current = slot_ACU(state, index);
  if (typeof call.id === 'string' && call.id) current.id = call.id;
  const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : undefined;
  if (typeof fn?.name === 'string' && fn.name) current.name = current.name ? current.name : fn.name;
  if (typeof fn?.arguments === 'string') current.arguments += fn.arguments;
  else if (fn?.arguments && typeof fn.arguments === 'object') current.arguments = JSON.stringify(fn.arguments);
}

function absorbGeminiPart_ACU(state: ChatTurnAccumulator_ACU, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const part = raw as Record<string, unknown>;
  if (typeof part.text === 'string' && part.thought !== true) state.content += part.text;
  const call = part.functionCall;
  if (!call || typeof call !== 'object') return;
  const fn = call as Record<string, unknown>;
  const name = typeof fn.name === 'string' ? fn.name.slice(fn.name.lastIndexOf(':') + 1) : '';
  const index = state.calls.size;
  const current = name ? slot_ACU(state, index) : (state.calls.get(state.calls.size - 1) ?? slot_ACU(state, index));
  if (name) current.name = name;
  if (typeof fn.id === 'string' && fn.id) current.id = fn.id;
  if (typeof fn.args === 'string') current.arguments += fn.args;
  else if (fn.args && typeof fn.args === 'object') current.arguments = JSON.stringify(fn.args);
}

function finishChatTurn_ACU(state: ChatTurnAccumulator_ACU): AiChatTurn_ACU {
  const toolCalls = [...state.calls.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, call], index) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: call.arguments || '{}',
    }))
    .filter(call => call.name);
  return { content: state.content, toolCalls };
}

export function chatTurnFromJson_ACU(data: unknown): { turn: AiChatTurn_ACU; usage: unknown } {
  const state = accumulator_ACU();
  absorbChatCompletionEvent_ACU(state, data);
  if (typeof data === 'string') state.content = data;
  else if (data && typeof data === 'object' && typeof (data as { content?: unknown }).content === 'string' && !state.content) {
    state.content = (data as { content: string }).content;
  }
  return { turn: finishChatTurn_ACU(state), usage: state.usage };
}

export async function readFetchChatTurn_ACU(response: { headers?: { get(name: string): string | null }; json: () => Promise<unknown>; body?: { getReader(): ReadableStreamDefaultReader<Uint8Array> } }, streaming: boolean, signal?: AbortSignal | null): Promise<{ turn: AiChatTurn_ACU; usage: unknown }> {
  const contentType = response.headers?.get('content-type') ?? '';
  if (!streaming && !contentType.includes('text/event-stream')) {
    return chatTurnFromJson_ACU(await response.json());
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const state = accumulator_ACU();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new Error('Request aborted');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try { absorbChatCompletionEvent_ACU(state, JSON.parse(data)); } catch { /* 半截 SSE 留给下一行。 */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { turn: finishChatTurn_ACU(state), usage: state.usage };
}
