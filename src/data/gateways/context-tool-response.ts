/**
 * data/gateways/context-tool-response.ts — 上下文工具化传输（响应侧）
 *
 * emit 模式：把输出函数的 content 参数还原成普通正文并去掉这次调用，下游现有的文本解析链照常读取。
 * 模型在函数之外另写的正文先暂存，只有输出函数没有给出正文时才采用。
 * passthrough 模式：正文与原有工具原样保留，只去掉对 turn_ 函数的误调用。
 * 覆盖 OpenAI 兼容、Anthropic Messages、Gemini 三种形态的流式与非流式响应。
 */

import { classifyTransportToolName_ACU, type ContextToolTransportPlan_ACU } from './context-tool-transport';

const SIMPLE_ESCAPES_ACU: Record<string, string> = {
  '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
};
const KEY_LIMIT_ACU = 64;

/** 参数 JSON 边到达边解码：只取顶层 content 字符串，其余字段只扫描、不保留。 */
export class ContentArgumentDecoder_ACU {
  private depth = 0;
  private mode: '' | 'key' | 'skip' | 'content' = '';
  private expectingKey = false;
  private expectingValue = false;
  private contentKey = false;
  private key = '';
  private keyTooLong = false;
  private escaped = false;
  private pendingEscape = '';
  private highSurrogate = 0;
  private closed = false;

  feed(fragment: string): string {
    let out = '';
    for (const char of fragment) {
      if (this.closed) break;
      if (this.mode === 'content') out += this.contentChar(char);
      else if (this.mode === 'key' || this.mode === 'skip') this.stringChar(char);
      else this.structureChar(char);
    }
    return out;
  }

  /** 流结束时补出暂存的半个代理对；未完成的转义序列丢弃。 */
  finish(): string {
    this.pendingEscape = '';
    return this.flushSurrogate();
  }

  private contentChar(char: string): string {
    if (this.pendingEscape === '\\') {
      if (char === 'u') { this.pendingEscape = '\\u'; return ''; }
      this.pendingEscape = '';
      return this.emit(SIMPLE_ESCAPES_ACU[char] ?? char);
    }
    if (this.pendingEscape) {
      this.pendingEscape += char;
      if (this.pendingEscape.length < 6) return '';
      const hex = this.pendingEscape.slice(2);
      this.pendingEscape = '';
      return /^[0-9a-f]{4}$/i.test(hex) ? this.emit(String.fromCharCode(Number.parseInt(hex, 16))) : '';
    }
    if (char === '\\') { this.pendingEscape = '\\'; return ''; }
    if (char === '"') { this.mode = ''; this.closed = true; return this.flushSurrogate(); }
    return this.emit(char);
  }

  private stringChar(char: string): void {
    const isKey = this.mode === 'key';
    if (this.escaped) {
      this.escaped = false;
      if (isKey) this.appendKey(char);
      return;
    }
    if (char === '\\') {
      this.escaped = true;
      if (isKey) this.appendKey(char);
      return;
    }
    if (char !== '"') {
      if (isKey) this.appendKey(char);
      return;
    }
    if (isKey) {
      let parsed: unknown = '';
      try { parsed = this.keyTooLong ? '' : JSON.parse(`"${this.key}"`); } catch { parsed = ''; }
      this.contentKey = parsed === 'content';
      this.expectingKey = false;
    }
    this.mode = '';
  }

  private structureChar(char: string): void {
    if (char === '{' || char === '[') {
      this.depth += 1;
      if (this.depth === 1) this.expectingKey = char === '{';
      this.expectingValue = false;
      return;
    }
    if (char === '}' || char === ']') { this.depth = Math.max(0, this.depth - 1); return; }
    if (this.depth === 1 && char === ',') {
      this.expectingKey = true;
      this.expectingValue = false;
      this.contentKey = false;
      return;
    }
    if (this.depth === 1 && char === ':') { this.expectingValue = true; return; }
    if (char === '"') {
      // 少数渠道下发的参数片段缺开头的花括号，按顶层对象处理。
      if (this.depth === 0) { this.depth = 1; this.expectingKey = true; }
      if (this.depth === 1 && this.expectingKey) {
        this.mode = 'key';
        this.key = '';
        this.keyTooLong = false;
      } else if (this.depth === 1 && this.expectingValue && this.contentKey) {
        this.mode = 'content';
      } else {
        this.mode = 'skip';
      }
      this.expectingValue = false;
      return;
    }
    if (this.depth === 1 && this.expectingValue && !/\s/.test(char)) {
      this.expectingValue = false;
      this.contentKey = false;
    }
  }

  private appendKey(char: string): void {
    if (this.key.length + char.length <= KEY_LIMIT_ACU) this.key += char;
    else this.keyTooLong = true;
  }

  /** 跨片段的代理对先暂存高位，拿到低位后一起输出，避免拆出半个字符。 */
  private emit(text: string): string {
    let out = '';
    for (let at = 0; at < text.length; at += 1) {
      const code = text.charCodeAt(at);
      if (this.highSurrogate) {
        const high = this.highSurrogate;
        this.highSurrogate = 0;
        if (code >= 0xdc00 && code <= 0xdfff) { out += String.fromCharCode(high, code); continue; }
        out += String.fromCharCode(high);
      }
      if (code >= 0xd800 && code <= 0xdbff) this.highSurrogate = code;
      else out += text[at];
    }
    return out;
  }

  private flushSurrogate(): string {
    if (!this.highSurrogate) return '';
    const out = String.fromCharCode(this.highSurrogate);
    this.highSurrogate = 0;
    return out;
  }
}

/** emit：本次输出函数；drop：turn_ 误调用，或无原有工具请求里的未知调用；keep：调用方原有工具。 */
type TransportToolKind_ACU = 'emit' | 'drop' | 'keep';

function toolKind_ACU(name: unknown, plan: ContextToolTransportPlan_ACU): TransportToolKind_ACU {
  const kind = classifyTransportToolName_ACU(name, plan);
  if (kind === 'emit') return 'emit';
  // 无原有工具的请求里，除输出函数外的调用都无从执行，一并去掉。
  return kind === 'context' || plan.mode === 'emit' ? 'drop' : 'keep';
}

/** 输出函数参数里的 content；参数被截断时取出已经到达的部分。 */
export function readEmitContent_ACU(args: unknown): string {
  if (typeof args === 'string') {
    if (!args) return '';
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' && typeof parsed.content === 'string' ? parsed.content : '';
    } catch {
      const decoder = new ContentArgumentDecoder_ACU();
      return decoder.feed(args) + decoder.finish();
    }
  }
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const value = (args as Record<string, unknown>).content;
    return typeof value === 'string' ? value : '';
  }
  return '';
}

/** 输出函数给出非空白正文时以它为准，否则采用函数之外的正文。 */
function pickReply_ACU(emitted: string, plain: string): string {
  return emitted.trim() ? emitted : plain;
}

/** 模型偶尔重复调用输出函数，取最长的一次。 */
function longest_ACU(values: readonly string[]): string {
  return values.reduce((best, value) => (value.length > best.length ? value : best), '');
}

function rewriteOpenAiChoices_ACU(choices: unknown[], plan: ContextToolTransportPlan_ACU): void {
  for (const raw of choices) {
    if (!raw || typeof raw !== 'object') continue;
    const choice = raw as Record<string, any>;
    const message = choice.message;
    if (!message || typeof message !== 'object' || !Array.isArray(message.tool_calls)) continue;
    const kept: unknown[] = [];
    const emitted: string[] = [];
    for (const call of message.tool_calls) {
      const kind = toolKind_ACU(call?.function?.name, plan);
      if (kind === 'keep') kept.push(call);
      else if (kind === 'emit') emitted.push(readEmitContent_ACU(call?.function?.arguments));
    }
    if (kept.length === message.tool_calls.length) continue;
    if (emitted.length > 0) {
      message.content = pickReply_ACU(longest_ACU(emitted), typeof message.content === 'string' ? message.content : '');
    }
    if (kept.length > 0) {
      message.tool_calls = kept;
    } else {
      delete message.tool_calls;
      if (choice.finish_reason === 'tool_calls') choice.finish_reason = 'stop';
    }
  }
}

/** 返回还原后的正文；没有输出函数调用时返回 undefined。 */
function rewriteAnthropicMessage_ACU(record: Record<string, any>, plan: ContextToolTransportPlan_ACU): string | undefined {
  const kept: unknown[] = [];
  const emitted: string[] = [];
  let plain = '';
  let touched = false;
  let clientCalls = 0;
  for (const raw of record.content as unknown[]) {
    const block = raw && typeof raw === 'object' ? raw as Record<string, any> : undefined;
    if (block?.type === 'tool_use') {
      const kind = toolKind_ACU(block.name, plan);
      if (kind !== 'keep') {
        touched = true;
        if (kind === 'emit') emitted.push(readEmitContent_ACU(block.input));
        continue;
      }
      clientCalls += 1;
    }
    if (block?.type === 'text' && typeof block.text === 'string') plain += block.text;
    kept.push(raw);
  }
  if (!touched) return undefined;
  if (clientCalls === 0 && record.stop_reason === 'tool_use') record.stop_reason = 'end_turn';
  if (emitted.length === 0) {
    record.content = kept;
    return undefined;
  }
  const text = pickReply_ACU(longest_ACU(emitted), plain);
  record.content = [{ type: 'text', text }, ...kept.filter((block: any) => block?.type !== 'text')];
  return text;
}

/** 还原 Gemini parts：输出函数改成首个文本片段，误调用去掉；没有输出函数调用时 reply 为 undefined。 */
function rewriteGeminiParts_ACU(parts: unknown[], plan: ContextToolTransportPlan_ACU): { parts: unknown[]; reply: string | undefined } {
  const kept: unknown[] = [];
  const emitted: string[] = [];
  let plain = '';
  let signature: unknown;
  let touched = false;
  for (const raw of parts) {
    const part = raw && typeof raw === 'object' ? raw as Record<string, any> : undefined;
    const call = part?.functionCall && typeof part.functionCall === 'object' ? part.functionCall : undefined;
    if (call) {
      const kind = toolKind_ACU(call.name, plan);
      if (kind !== 'keep') {
        touched = true;
        if (kind === 'emit') {
          emitted.push(readEmitContent_ACU(call.args));
          if (signature === undefined && part?.thoughtSignature !== undefined) signature = part.thoughtSignature;
        }
        continue;
      }
    }
    if (part && part.thought !== true && typeof part.text === 'string') plain += part.text;
    kept.push(raw);
  }
  if (!touched) return { parts, reply: undefined };
  if (emitted.length === 0) return { parts: kept, reply: undefined };
  const reply = pickReply_ACU(longest_ACU(emitted), plain);
  const textPart: Record<string, unknown> = { text: reply };
  if (signature !== undefined) textPart.thoughtSignature = signature;
  const isPlainText = (value: unknown): boolean => !!value && typeof value === 'object'
    && (value as Record<string, unknown>).thought !== true && typeof (value as Record<string, unknown>).text === 'string';
  return { parts: [textPart, ...kept.filter(value => !isPlainText(value))], reply };
}

/** 非流式响应体原位改写：OpenAI choices、Anthropic content、Gemini responseContent 与 candidates。 */
export function rewriteContextToolJson_ACU(data: unknown, plan: ContextToolTransportPlan_ACU): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const record = data as Record<string, any>;
  if (Array.isArray(record.choices)) rewriteOpenAiChoices_ACU(record.choices, plan);
  if (Array.isArray(record.content)) rewriteAnthropicMessage_ACU(record, plan);
  const responseContent = record.responseContent;
  if (responseContent && typeof responseContent === 'object' && Array.isArray(responseContent.parts)) {
    // 酒馆的 Gemini 非流式回包同时带 choices[0].message.content 与原始 parts，两处保持一致。
    const result = rewriteGeminiParts_ACU(responseContent.parts, plan);
    responseContent.parts = result.parts;
    const message = Array.isArray(record.choices) ? record.choices[0]?.message : undefined;
    if (result.reply !== undefined && message && typeof message === 'object') message.content = result.reply;
  }
  if (Array.isArray(record.candidates)) {
    for (const candidate of record.candidates) {
      const content = candidate?.content;
      if (content && typeof content === 'object' && Array.isArray(content.parts)) {
        content.parts = rewriteGeminiParts_ACU(content.parts, plan).parts;
      }
    }
  }
  return record;
}

type StreamDialect_ACU = 'openai' | 'anthropic' | 'gemini';

interface StreamSlot_ACU {
  kind: TransportToolKind_ACU;
  decoder: ContentArgumentDecoder_ACU;
  named: boolean;
  /** 已解出的正文，用于对整段下发的参数去重。 */
  received: string;
}

interface StreamChoiceState_ACU {
  slots: Map<number, StreamSlot_ACU>;
  /** emit 模式下函数之外的正文，结束时才决定是否采用。 */
  held: string;
  emitted: string;
  keptCalls: number;
  finished: boolean;
  activeGemini?: StreamSlot_ACU;
}

/** 插在原 data 行之前的补充 data 行。 */
export interface InjectedSseEvent_ACU {
  data: string;
}

export interface SsePayloadRewrite_ACU {
  before: InjectedSseEvent_ACU[];
  /** 替换原事件的 data；undefined 表示整条事件丢弃。 */
  payload: string | undefined;
}

function isFinishReason_ACU(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
    && !['null', 'none', 'unspecified', 'finish_reason_unspecified'].includes(value.toLowerCase());
}

/** SSE 逐事件改写：输出函数的参数边到达边转成正文；函数之外的正文暂存，结束时输出函数没给正文才放出。 */
export class ContextToolStreamRewriter_ACU {
  private readonly states = new Map<number, StreamChoiceState_ACU>();
  private dialect: StreamDialect_ACU = 'openai';

  constructor(private readonly plan: ContextToolTransportPlan_ACU) {}

  transform(payload: string): SsePayloadRewrite_ACU {
    const trimmed = payload.trim();
    if (trimmed === '[DONE]') return { before: this.finishPending(), payload };
    let json: unknown;
    try { json = JSON.parse(trimmed); } catch { return { before: [], payload }; }
    if (!json || typeof json !== 'object' || Array.isArray(json)) return { before: [], payload };
    const record = json as Record<string, any>;
    if (Array.isArray(record.choices)) {
      this.dialect = 'openai';
      return { before: [], payload: this.openAi(record) };
    }
    if (typeof record.type === 'string' && /^(message|content_block)_/.test(record.type)) {
      this.dialect = 'anthropic';
      return this.anthropic(record, payload);
    }
    if (Array.isArray(record.candidates)) {
      this.dialect = 'gemini';
      return { before: [], payload: this.gemini(record) };
    }
    return { before: [], payload };
  }

  /** 流在结束原因之前断开时补出剩余正文；不补结束原因，不把断流伪装成正常完成。 */
  finishPending(): InjectedSseEvent_ACU[] {
    const events: InjectedSseEvent_ACU[] = [];
    for (const [index, state] of this.states) events.push(...this.tailEvents(state, index));
    return events;
  }

  private state(index: number): StreamChoiceState_ACU {
    let state = this.states.get(index);
    if (!state) {
      state = { slots: new Map(), held: '', emitted: '', keptCalls: 0, finished: false };
      this.states.set(index, state);
    }
    return state;
  }

  /** 首个带名称的片段决定这次调用的去向；有的渠道每个片段都重复名称，不重建解码器。 */
  private slot(state: StreamChoiceState_ACU, index: number, name: unknown): StreamSlot_ACU {
    const existing = state.slots.get(index);
    const named = typeof name === 'string' && name !== '';
    if (existing && (existing.named || !named)) return existing;
    const kind: TransportToolKind_ACU = named ? toolKind_ACU(name, this.plan) : this.plan.mode === 'emit' ? 'drop' : 'keep';
    const slot: StreamSlot_ACU = { kind, decoder: new ContentArgumentDecoder_ACU(), named, received: '' };
    state.slots.set(index, slot);
    if (kind === 'keep') state.keptCalls += 1;
    return slot;
  }

  private tail(state: StreamChoiceState_ACU): string {
    if (state.finished) return '';
    state.finished = true;
    let out = '';
    for (const slot of state.slots.values()) if (slot.kind === 'emit') out += slot.decoder.finish();
    state.emitted += out;
    if (this.plan.mode === 'emit' && !state.emitted.trim()) out += state.held;
    state.held = '';
    return out;
  }

  private tailEvents(state: StreamChoiceState_ACU, index: number): InjectedSseEvent_ACU[] {
    const text = this.tail(state);
    if (!text) return [];
    if (this.dialect === 'anthropic') {
      return [{ data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) }];
    }
    if (this.dialect === 'gemini') {
      return [{ data: JSON.stringify({ candidates: [{ index, content: { role: 'model', parts: [{ text }] } }] }) }];
    }
    return [{ data: JSON.stringify({ choices: [{ index, delta: { content: text }, finish_reason: null }] }) }];
  }

  /** 输出函数的参数片段：字符串按 JSON 源码增量解码；整段对象按已解出的正文去重。 */
  private absorbEmit(state: StreamChoiceState_ACU, slot: StreamSlot_ACU, args: unknown): string {
    let text = '';
    if (typeof args === 'string') {
      text = slot.decoder.feed(args);
    } else if (args && typeof args === 'object') {
      const full = readEmitContent_ACU(args);
      if (full.startsWith(slot.received)) text = full.slice(slot.received.length);
      else if (!slot.received.startsWith(full)) text = full;
    }
    slot.received += text;
    state.emitted += text;
    return text;
  }

  private openAi(record: Record<string, any>): string {
    for (const raw of record.choices as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const choice = raw as Record<string, any>;
      const index = typeof choice.index === 'number' ? choice.index : 0;
      const state = this.state(index);
      const field = choice.delta && typeof choice.delta === 'object' ? 'delta'
        : choice.message && typeof choice.message === 'object' ? 'message' : 'delta';
      const delta: Record<string, any> = choice[field] && typeof choice[field] === 'object' ? choice[field] : {};
      let out = '';
      if (Array.isArray(delta.tool_calls)) {
        const kept: unknown[] = [];
        delta.tool_calls.forEach((call: any, fallback: number) => {
          const slot = this.slot(state, typeof call?.index === 'number' ? call.index : fallback, call?.function?.name);
          if (slot.kind === 'keep') kept.push(call);
          else if (slot.kind === 'emit') out += this.absorbEmit(state, slot, call?.function?.arguments);
        });
        if (kept.length > 0) delta.tool_calls = kept;
        else delete delta.tool_calls;
      }
      if (this.plan.mode === 'emit' && typeof delta.content === 'string') {
        state.held += delta.content;
        delete delta.content;
      }
      if (isFinishReason_ACU(choice.finish_reason)) {
        out += this.tail(state);
        if (choice.finish_reason === 'tool_calls' && state.keptCalls === 0) choice.finish_reason = 'stop';
      }
      if (out) delta.content = (typeof delta.content === 'string' ? delta.content : '') + out;
      choice[field] = delta;
    }
    return JSON.stringify(record);
  }

  private anthropic(record: Record<string, any>, payload: string): SsePayloadRewrite_ACU {
    const state = this.state(0);
    const index = typeof record.index === 'number' ? record.index : 0;
    const pass: SsePayloadRewrite_ACU = { before: [], payload };
    const drop: SsePayloadRewrite_ACU = { before: [], payload: undefined };
    if (record.type === 'content_block_start') {
      const block = record.content_block;
      if (!block || typeof block !== 'object' || block.type !== 'tool_use') return pass;
      return this.slot(state, index, block.name).kind === 'keep' ? pass : drop;
    }
    if (record.type === 'content_block_delta') {
      const delta: Record<string, any> = record.delta && typeof record.delta === 'object' ? record.delta : {};
      if (delta.type === 'input_json_delta') {
        const slot = state.slots.get(index);
        if (!slot || slot.kind === 'keep') return pass;
        const text = slot.kind === 'emit' ? this.absorbEmit(state, slot, delta.partial_json) : '';
        return text ? { before: [], payload: JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } }) } : drop;
      }
      if (delta.type === 'text_delta' && this.plan.mode === 'emit') {
        if (typeof delta.text === 'string') state.held += delta.text;
        return drop;
      }
      return pass;
    }
    if (record.type === 'content_block_stop') {
      const slot = state.slots.get(index);
      return slot && slot.kind !== 'keep' ? drop : pass;
    }
    if (record.type === 'message_delta' && record.delta && typeof record.delta === 'object' && isFinishReason_ACU(record.delta.stop_reason)) {
      const before = this.tailEvents(state, 0);
      if (record.delta.stop_reason === 'tool_use' && state.keptCalls === 0) record.delta.stop_reason = 'end_turn';
      return { before, payload: JSON.stringify(record) };
    }
    if (record.type === 'message_stop') return { before: this.tailEvents(state, 0), payload };
    return pass;
  }

  /** Gemini 只有首个片段带函数名；后续匿名片段沿用上一次调用，直到 willContinue 结束。 */
  private geminiSlot(state: StreamChoiceState_ACU, call: Record<string, any>): StreamSlot_ACU | undefined {
    if (typeof call.name !== 'string' || !call.name) return state.activeGemini;
    const kind = toolKind_ACU(call.name, this.plan);
    const slot: StreamSlot_ACU = { kind, decoder: new ContentArgumentDecoder_ACU(), named: true, received: '' };
    if (kind === 'keep') state.keptCalls += 1;
    state.activeGemini = slot;
    return slot;
  }

  private gemini(record: Record<string, any>): string {
    for (const raw of record.candidates as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const candidate = raw as Record<string, any>;
      const index = typeof candidate.index === 'number' ? candidate.index : 0;
      const state = this.state(index);
      const content: Record<string, any> | undefined = candidate.content && typeof candidate.content === 'object' ? candidate.content : undefined;
      const parts: unknown[] = Array.isArray(content?.parts) ? content.parts : [];
      const kept: unknown[] = [];
      let out = '';
      for (const rawPart of parts) {
        const part = rawPart && typeof rawPart === 'object' ? rawPart as Record<string, any> : undefined;
        const call = part?.functionCall && typeof part.functionCall === 'object' ? part.functionCall as Record<string, any> : undefined;
        if (call) {
          const slot = this.geminiSlot(state, call);
          const keep = slot ? slot.kind === 'keep' : this.plan.mode !== 'emit';
          if (keep) kept.push(rawPart);
          else if (slot?.kind === 'emit') {
            const partial = readPartialContent_ACU(call.partialArgs);
            if (partial) {
              slot.received += partial;
              state.emitted += partial;
              out += partial;
            }
            if (call.args !== undefined) out += this.absorbEmit(state, slot, call.args);
          }
          if (call.willContinue !== true) state.activeGemini = undefined;
          continue;
        }
        if (this.plan.mode === 'emit' && part && part.thought !== true && typeof part.text === 'string') {
          state.held += part.text;
          continue;
        }
        kept.push(rawPart);
      }
      if (isFinishReason_ACU(candidate.finishReason)) out += this.tail(state);
      if (!content && !out) continue;
      candidate.content = {
        ...(content ?? {}),
        role: typeof content?.role === 'string' ? content.role : 'model',
        // 文本片段放在最前，下游按首个非思考片段读取正文。
        parts: out ? [{ text: out }, ...kept] : kept,
      };
    }
    return JSON.stringify(record);
  }
}

/** Gemini 流式参数片段里 $.content 的已解码文本。 */
function readPartialContent_ACU(partialArgs: unknown): string {
  if (!Array.isArray(partialArgs)) return '';
  let text = '';
  for (const fragment of partialArgs) {
    if (!fragment || typeof fragment !== 'object') continue;
    const record = fragment as Record<string, unknown>;
    if (typeof record.jsonPath === 'string' && record.jsonPath.trim() === '$.content' && typeof record.stringValue === 'string') {
      text += record.stringValue;
    }
  }
  return text;
}

function rewrittenHeaders_ACU(headers: Headers): Headers {
  const next = new Headers(headers);
  next.delete('content-length');
  next.delete('content-encoding');
  return next;
}

function renderInjected_ACU(events: readonly InjectedSseEvent_ACU[]): string {
  return events.map(event => `data: ${event.data}\n\n`).join('');
}

/** 逐行改写 SSE：只改写 data 行，其余行原样保留；下游解析器都按 data 行读取。 */
export function rewriteContextToolEventStream_ACU(response: Response, plan: ContextToolTransportPlan_ACU): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const rewriter = new ContextToolStreamRewriter_ACU(plan);
  let buffer = '';
  let ended = false;
  const rewriteLine = (raw: string): string => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!text.startsWith('data:')) return `${text}\n`;
    const result = rewriter.transform(text.slice(5).replace(/^ /, ''));
    const head = renderInjected_ACU(result.before);
    if (result.payload === undefined) return head;
    return `${head}${result.payload.split('\n').map(part => `data: ${part}`).join('\n')}\n`;
  };
  const drain = (final: boolean): string => {
    let out = '';
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      out += rewriteLine(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
    }
    if (final) {
      if (buffer) out += rewriteLine(buffer);
      buffer = '';
      out += renderInjected_ACU(rewriter.finishPending());
    }
    return out;
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!ended) {
          const { done, value } = await reader.read();
          if (done) {
            ended = true;
            buffer += decoder.decode();
            const tail = drain(true);
            if (tail) controller.enqueue(encoder.encode(tail));
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const out = drain(false);
          if (out) {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      } catch (error) {
        ended = true;
        controller.error(error);
      }
    },
    cancel(reason) {
      ended = true;
      return reader.cancel(reason);
    },
  });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: rewrittenHeaders_ACU(response.headers) });
}

/** 发送出口的响应改写入口；失败响应原样返回，交给既有错误处理。 */
export async function rewriteContextToolResponse_ACU(response: Response, plan: ContextToolTransportPlan_ACU): Promise<Response> {
  if (!response.ok || !response.body) return response;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream') || (plan.streamRequested && !contentType.includes('json'))) {
    return rewriteContextToolEventStream_ACU(response, plan);
  }
  const text = await response.text();
  let rewritten = text;
  try {
    rewritten = JSON.stringify(rewriteContextToolJson_ACU(JSON.parse(text), plan));
  } catch { /* 非 JSON 正文原样交给下游，由既有解析链报告错误。 */ }
  return new Response(rewritten, { status: response.status, statusText: response.statusText, headers: rewrittenHeaders_ACU(response.headers) });
}