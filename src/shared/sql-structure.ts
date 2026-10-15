import { logDebug_ACU } from './utils';

/** 仅归一化 SQL 结构位置；字符串字面量与行注释保持原文。 */
const FULLWIDTH_TO_ASCII: Record<string, string> = {
  '＝': '=', '＞': '>', '＜': '<', '＋': '+', '－': '-', '＊': '*', '／': '/',
  '（': '(', '）': ')', '，': ',', '；': ';', '\u3000': ' ',
};

export function normalizeSqlStructure(sql: string): string {
  if (!sql || typeof sql !== 'string') return sql;
  const needsNormalization = Object.keys(FULLWIDTH_TO_ASCII).some(ch => sql.includes(ch));
  if (!needsNormalization) return sql;

  const chars = Array.from(sql);
  const result: string[] = [];
  let inString = false;
  let inComment = false;
  let stringChar = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (inComment) {
      result.push(ch);
      if (ch === '\n') inComment = false;
      continue;
    }
    if (inString) {
      result.push(ch);
      if (ch === stringChar) {
        if (i + 1 < chars.length && chars[i + 1] === stringChar) {
          result.push(chars[i + 1]);
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      stringChar = "'";
      result.push(ch);
      continue;
    }
    if (ch === '-' && i + 1 < chars.length && chars[i + 1] === '-') {
      inComment = true;
      result.push(ch);
      continue;
    }
    const replacement = FULLWIDTH_TO_ASCII[ch];
    result.push(replacement !== undefined ? replacement : ch);
  }
  const normalized = result.join('');
  if (normalized !== sql) logDebug_ACU('[SqlNormalizer] SQL 结构字符已规范化');
  return normalized;
}
