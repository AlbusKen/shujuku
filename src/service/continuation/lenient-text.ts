/**
 * service/continuation/lenient-text.ts — 模型输出的宽容预处理
 *
 * 快速/推理型模型的输出常带三类噪音：把思考写进 content 的 <think> 块、
 * 不严格的 JSON（尾逗号、单引号、无引号键、注释）、以及 Markdown 围栏。
 * 这里只做与语义无关的归一化，不替模型补内容；解析仍由各协议自己的解析器负责。
 */

const REASONING_TAGS_ACU = ['think', 'thinking', 'reasoning', 'thought', 'analysis'] as const;

/**
 * 剥离推理块。闭合的 <think>…</think> 整块删除；只剩未闭合的开标签时只删标签本身，
 * 让后续解析器仍能在剩余文本里寻找标签或 JSON——推理模型常常忘记闭合却已经写出了答案。
 * @param text 模型原文
 * @returns 去掉推理块后的文本
 */
export function stripReasoningBlocks_ACU(text: string): string {
  if (typeof text !== 'string' || !text) return '';
  let result = text;
  for (const tag of REASONING_TAGS_ACU) {
    result = result.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}\\s*>`, 'gi'), '');
    result = result.replace(new RegExp(`</?${tag}(?:\\s[^>]*)?>`, 'gi'), '');
  }
  return result;
}

/**
 * 把“像 JSON 但不严格”的文本整理成 JSON.parse 能接受的形态：
 * 去注释、单引号字符串转双引号、无引号键补引号、删尾逗号。
 * 只在字符串外做改写，字符串内容逐字保留。
 */
export function sanitizeLooseJson_ACU(text: string): string {
  const out: string[] = [];
  let index = 0;
  const length = text.length;
  const isIdentStart = (ch: string) => /[A-Za-z_$]/.test(ch);
  const isIdent = (ch: string) => /[\w$]/.test(ch);
  while (index < length) {
    const ch = text[index];
    // 注释
    if (ch === '/' && text[index + 1] === '/') {
      while (index < length && text[index] !== '\n') index += 1;
      continue;
    }
    if (ch === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? length : end + 2;
      continue;
    }
    // 字符串：双引号原样复制；单引号转双引号并处理内部转义
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let buffer = '"';
      index += 1;
      while (index < length) {
        const current = text[index];
        if (current === '\\') {
          const next = text[index + 1] ?? '';
          if (quote === "'" && next === "'") { buffer += "'"; index += 2; continue; }
          buffer += current + next;
          index += 2;
          continue;
        }
        if (current === quote) { index += 1; break; }
        if (quote === "'" && current === '"') { buffer += '\\"'; index += 1; continue; }
        if (current === '\n' || current === '\r') { buffer += current === '\n' ? '\\n' : ''; index += 1; continue; }
        buffer += current;
        index += 1;
      }
      out.push(`${buffer}"`);
      continue;
    }
    // 无引号键：标识符后紧跟冒号
    if (isIdentStart(ch)) {
      let end = index;
      while (end < length && isIdent(text[end])) end += 1;
      let probe = end;
      while (probe < length && /\s/.test(text[probe])) probe += 1;
      const word = text.slice(index, end);
      if (text[probe] === ':' && !['true', 'false', 'null'].includes(word)) {
        out.push(`"${word}"`);
        index = end;
        continue;
      }
      out.push(word);
      index = end;
      continue;
    }
    // 尾逗号
    if (ch === ',') {
      let probe = index + 1;
      while (probe < length && /\s/.test(text[probe])) probe += 1;
      if (text[probe] === '}' || text[probe] === ']') { index += 1; continue; }
    }
    out.push(ch);
    index += 1;
  }
  return out.join('');
}

/**
 * 抢救被截断的 JSON：从首个 { 起扫描，记住每个“嵌套容器刚闭合”的位置作为安全切点；
 * 到文末仍未配平时，退回最后一个安全切点，丢掉未写完的尾部元素，再补上未闭合的括号。
 * 适用于 delta 数组这类“元素是对象”的契约——截断只损失最后一个未完成条目，前面的整条保留。
 * @param text 可能被截断的 JSON 文本（允许前后夹杂散文）
 * @returns 补全后的 JSON 与被切掉的字符数；已配平或无法抢救时返回 null
 */
export function salvageTruncatedJson_ACU(text: string): { json: string; dropped: number } | null {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafeCut = -1;
  let lastSafeStack: string[] = [];
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = inString; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); continue; }
    if (ch === '}' || ch === ']') {
      if (!stack.length) return null;
      stack.pop();
      if (!stack.length) return null; // 已配平，不是截断
      lastSafeCut = index + 1;
      lastSafeStack = [...stack];
    }
  }
  if (!stack.length || lastSafeCut < 0) return null;
  let head = text.slice(start, lastSafeCut).replace(/,\s*$/, '');
  head += lastSafeStack.slice().reverse().join('');
  return { json: head, dropped: text.length - lastSafeCut };
}

/**
 * 先按严格 JSON 解析，失败再按宽松规则整理后重试。
 * @param text 候选 JSON 文本
 * @returns 解析结果；两种方式都失败时返回 undefined
 */
export function parseJsonLenient_ACU(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch { /* 严格解析失败，走宽松整理。 */ }
  try {
    return JSON.parse(sanitizeLooseJson_ACU(text));
  } catch {
    return undefined;
  }
}
