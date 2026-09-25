import { USER_PREFILL_CONTENT_ACU } from '../../shared/user-prefill.js';
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

export type AgentNativeToolName_ACU = 'read' | 'search' | 'write_sql' | 'encyclopedia_search' | 'encyclopedia_read' | 'web_search' | 'web_read';

const notesSchema_ACU = { type: 'array', items: { type: 'string' }, description: '上一批页面里要留下的简短事实。继续调用工具时带上，网页正文不会进入历史。' };

export function agentNativeTools_ACU(names: readonly AgentNativeToolName_ACU[]): AiNativeToolDefinition_ACU[] {
  const catalog: Record<AgentNativeToolName_ACU, AiNativeToolDefinition_ACU> = {
    read: {
      type: 'function',
      function: {
        name: 'read',
        description: '按地址读取一条或一批资料的全文。何时使用：提示词里已经给出地址，或 search 命中行右侧有地址，需要正文、表格行、总纲、伏笔、世界书条目或推演账本字段时。预算与授权允许时，同一次回复把所有相互独立的读取地址放入 reads 数组并并发完成，不要分批等待；依赖 search 结果的精读留到下一轮。不要用它搜索未知内容。参数 reads 是非空字符串数组，一次可混用多种地址，例如 ["$STORY_RANGE:3-5","$STORY_ARC:VOL-01"] 或 ["ledger:current","field:seeds:seed-1:title"]。世界书命中全文通常已注入，不要对 $WORLDBOOK:... 反复 read；地址必须从当前提示词的目录或词汇表复制。',
        parameters: objectSchema_ACU({
          reads: { type: 'array', items: { type: 'string' }, minItems: 1 },
        }, ['reads']),
      },
    },
    search: {
      type: 'function',
      function: {
        name: 'search',
        description: '在资料里按关键词找位置。何时使用：知道要找什么，但还没有读取地址。预算与授权允许时，同一回复并发发出所有相互独立的 search / read，不要把独立查询拆成多批等待；只有依赖搜索结果的精读留待回执后。先 search 再按命中行里的地址 read。query 必填，用短关键词或人名，不要贴整段正文。scope 是范围数组，续写可用 story、tables、modules、outline、worldbook，推演可用 worldbook、encyclopedia、web；省略表示该角色允许的全部范围。可选 isRegex、maxResults（1 到 50）。范例：{"query":"晶屑","scope":["worldbook"],"maxResults":8}。',
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
        description: '把资料写入你负责的表。何时使用：要新增、修改或删除一条已有资料，而且系统提示里给你的表允许写。没有变化不要调用。sql 是一条或多条用分号隔开的 INSERT、UPDATE 或 DELETE。尽可能把本次要写的全部语句放进同一次调用的同一个 sql 参数里一次完成，不要拆成几批分多次调用。字符串用单引号，正文里的单引号写成两个单引号；数组和对象写成单引号包裹的 JSON。新行是否须显式给 expected_revision=0 依具体角色的表契约：推演 dimensions/seeds/actors/rumors 必须给 0，续写新行可省略；已有数组行的 WHERE 带 id 与当前条目/模块修订号，单例模块只带当前账本修订号；已保存 partial 仅按 missingFields 补未存栏目，状态不确定先 read。具体表、必填列和范例以系统提示中你这个角色的 write_sql 说明为准。范例：INSERT INTO hooks (summary, status, importance, planted_index, planned_payoff) VALUES (\'守门人藏着晶屑\', \'planted\', \'mid\', 3, \'稍后交出\');',
        parameters: objectSchema_ACU({
          sql: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
        }, ['sql']),
      },
    },
    encyclopedia_search: {
      type: 'function',
      function: {
        name: 'encyclopedia_search',
        description: '在百科里找候选词条。何时使用：要登记原作或公开设定，还不知道准确标题。query 用「角色名」或「作品名 角色名」，不要用整句剧情。sources 可省略，省略即全部启用来源；可填 moegirl、wikipedia_zh、wikipedia_en、baidu。萌娘按标题前缀匹配，百度按精确词条名匹配。范例：{"query":"守门人","sources":["moegirl","wikipedia_zh"]}。查到后再调用 encyclopedia_read。',
        parameters: objectSchema_ACU({
          query: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
          notes: notesSchema_ACU,
        }, ['query']),
      },
    },
    encyclopedia_read: {
      type: 'function',
      function: {
        name: 'encyclopedia_read',
        description: '精读一条百科词条。何时使用：encyclopedia_search 已经返回候选，需要正文才能写入 web_refs。source 和 title 必须从候选里原样复制，不要改写标题。范例：{"source":"moegirl","title":"守门人"}。返回的页面句柄才能作为 web_refs.page_ref。',
        parameters: objectSchema_ACU({
          source: { type: 'string' },
          title: { type: 'string' },
          notes: notesSchema_ACU,
        }, ['source', 'title']),
      },
    },
    web_search: {
      type: 'function',
      function: {
        name: 'web_search',
        description: '通用网页搜索。何时使用：百科没有这个实体，或只在专栏、设定站里出现。query 用短关键词加作品名。范例：{"query":"禁区 守门人 设定"}。先看标题和摘要，再对可信链接调用 web_read。论坛和自媒体只作旁证。',
        parameters: objectSchema_ACU({
          query: { type: 'string' },
          notes: notesSchema_ACU,
        }, ['query']),
      },
    },
    web_read: {
      type: 'function',
      function: {
        name: 'web_read',
        description: '抓取一个网页的正文。何时使用：web_search 给出了可信 url，需要页面内容才能写入资料。url 必须是结果里的完整地址，不要编造。范例：{"url":"https://example.com/setting"}。内网、酒馆自身和黑名单域名会被拒绝。返回的页面句柄才能作为 web_refs.page_ref。',
        parameters: objectSchema_ACU({
          url: { type: 'string' },
          notes: notesSchema_ACU,
        }, ['url']),
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

/** 原生调用的协议边界：不从 assistant.content 猜工具动作，参数先验证再交领域解析器。 */
export function nativeToolArguments_ACU(calls: readonly AiNativeToolCall_ACU[]): Array<{ call: AiNativeToolCall_ACU; payload: Record<string, unknown> }> {
  const ids = new Set<string>();
  return calls.map(call => {
    if (!call.id.trim() || !call.name.trim() || ids.has(call.id)) throw new Error('原生工具调用 ID 或函数名无效、或 ID 重复');
    ids.add(call.id);
    const args: unknown = JSON.parse(call.arguments);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(`工具 ${call.name} 的参数必须是 JSON 对象`);
    const payload = args as Record<string, unknown>;
    if ('action' in payload) throw new Error(`工具 ${call.name} 的参数不得包含文本协议 action`);
    return { call, payload: { ...payload, action: call.name } };
  });
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
  if (call.name === 'encyclopedia_search' || call.name === 'encyclopedia_read' || call.name === 'web_search' || call.name === 'web_read') {
    return { action: call.name, ...args };
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
      content: results[index] ?? '工具未返回对应结果',
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
  if (!last || last.role === 'assistant' || (last.role === 'user' && last.content === USER_PREFILL_CONTENT_ACU)) return stripped;
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
