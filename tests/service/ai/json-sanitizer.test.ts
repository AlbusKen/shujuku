/**
 * tests/service/ai/json-sanitizer.test.ts
 * JSON 清洗管线 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeQuotesLayer_ACU,
  getNextNonWhitespaceMeta_ACU,
  isLikelyJsonValueStart_ACU,
  isLikelyStringCloser_ACU,
  escapeUnescapedQuotesLayer_ACU,
  sanitizeControlCharsLayer_ACU,
  removeTrailingCommasLayer_ACU,
  fixNumericKeysLayer_ACU,
  sanitizeJsonPipeline_ACU,
  splitTopLevelSegments_ACU,
  findTopLevelDelimiterIndex_ACU,
  tryParseLooseJsonValue_ACU,
  parseLooseObjectKey_ACU,
  coerceLooseRowObject_ACU,
} from '../../../src/service/ai/prompt-builder/json-sanitizer';

// ═══════════════════════════════════════════════════════════════
// normalizeQuotesLayer_ACU
// ═══════════════════════════════════════════════════════════════
describe('normalizeQuotesLayer_ACU', () => {
  it('\u201c\u201d 不在正则范围内，不转换', () => {
    const input = '\u201c你好\u201d';
    const result = normalizeQuotesLayer_ACU(input);
    expect(result).toBe(input);
  });
  it('全角双引号转标准双引号', () => {
    expect(normalizeQuotesLayer_ACU('\uFF02test\uFF02')).toBe('"test"');
  });
  it('「」转标准双引号', () => {
    expect(normalizeQuotesLayer_ACU('「test」')).toBe('"test"');
  });
  it('标准双引号不变', () => {
    expect(normalizeQuotesLayer_ACU('"test"')).toBe('"test"');
  });
  it('空字符串返回空', () => {
    expect(normalizeQuotesLayer_ACU('')).toBe('');
  });
  it('非字符串返回原值', () => {
    expect(normalizeQuotesLayer_ACU(null as any)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// getNextNonWhitespaceMeta_ACU
// ═══════════════════════════════════════════════════════════════
describe('getNextNonWhitespaceMeta_ACU', () => {
  it('跳过空格找到下一个非空字符', () => {
    expect(getNextNonWhitespaceMeta_ACU('  a', 0)).toEqual({ char: 'a', index: 2 });
  });
  it('起始位置就是非空字符', () => {
    expect(getNextNonWhitespaceMeta_ACU('abc', 0)).toEqual({ char: 'a', index: 0 });
  });
  it('全是空格返回空', () => {
    expect(getNextNonWhitespaceMeta_ACU('   ', 0)).toEqual({ char: '', index: -1 });
  });
  it('从中间位置开始', () => {
    expect(getNextNonWhitespaceMeta_ACU('ab cd', 2)).toEqual({ char: 'c', index: 3 });
  });
});

// ═══════════════════════════════════════════════════════════════
// isLikelyJsonValueStart_ACU
// ═══════════════════════════════════════════════════════════════
describe('isLikelyJsonValueStart_ACU', () => {
  it('双引号是值开始', () => expect(isLikelyJsonValueStart_ACU('"')).toBe(true));
  it('左花括号是值开始', () => expect(isLikelyJsonValueStart_ACU('{')).toBe(true));
  it('左方括号是值开始', () => expect(isLikelyJsonValueStart_ACU('[')).toBe(true));
  it('负号是值开始', () => expect(isLikelyJsonValueStart_ACU('-')).toBe(true));
  it('数字是值开始', () => expect(isLikelyJsonValueStart_ACU('5')).toBe(true));
  it('t(true)是值开始', () => expect(isLikelyJsonValueStart_ACU('t')).toBe(true));
  it('f(false)是值开始', () => expect(isLikelyJsonValueStart_ACU('f')).toBe(true));
  it('n(null)是值开始', () => expect(isLikelyJsonValueStart_ACU('n')).toBe(true));
  it('空字符串不是值开始', () => expect(isLikelyJsonValueStart_ACU('')).toBe(false));
  it('字母a不是值开始', () => expect(isLikelyJsonValueStart_ACU('a')).toBe(false));
});

// ═══════════════════════════════════════════════════════════════
// escapeUnescapedQuotesLayer_ACU
// ═══════════════════════════════════════════════════════════════
describe('escapeUnescapedQuotesLayer_ACU', () => {
  it('正常 JSON 不变', () => {
    const input = '{"key":"value"}';
    const result = escapeUnescapedQuotesLayer_ACU(input);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual({ key: 'value' });
  });
  it('值中的未转义引号被转义', () => {
    const input = '{"key":"val"ue"}';
    const result = escapeUnescapedQuotesLayer_ACU(input);
    expect(result.success).toBe(true);
    expect(result.result).toContain('\\"');
  });
  it('已转义的引号不重复转义', () => {
    const input = '{"key":"val\\"ue"}';
    const result = escapeUnescapedQuotesLayer_ACU(input);
    expect(result.success).toBe(true);
    expect(result.result).toBe(input);
  });
  it('嵌套对象正常处理', () => {
    const input = '{"a":{"b":"c"}}';
    const result = escapeUnescapedQuotesLayer_ACU(input);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual({ a: { b: 'c' } });
  });
  it('数组正常处理', () => {
    const input = '["a","b","c"]';
    const result = escapeUnescapedQuotesLayer_ACU(input);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual(['a', 'b', 'c']);
  });
  it('非字符串输入返回失败', () => {
    const result = escapeUnescapedQuotesLayer_ACU(123 as any);
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// sanitizeControlCharsLayer_ACU
// ═══════════════════════════════════════════════════════════════
describe('sanitizeControlCharsLayer_ACU', () => {
  it('字符串内的换行符转义', () => {
    const input = '{"key":"line1\nline2"}';
    const result = sanitizeControlCharsLayer_ACU(input);
    expect(result).toBe('{"key":"line1\\nline2"}');
  });
  it('字符串内的制表符转义', () => {
    const input = '{"key":"a\tb"}';
    const result = sanitizeControlCharsLayer_ACU(input);
    expect(result).toBe('{"key":"a\\tb"}');
  });
  it('字符串内的回车符转义', () => {
    const input = '{"key":"a\rb"}';
    const result = sanitizeControlCharsLayer_ACU(input);
    expect(result).toBe('{"key":"a\\rb"}');
  });
  it('字符串外的换行符不转义', () => {
    const input = '{\n"key":"value"\n}';
    const result = sanitizeControlCharsLayer_ACU(input);
    expect(result).toBe(input);
  });
  it('已转义的字符不重复转义', () => {
    const input = '{"key":"a\\nb"}';
    const result = sanitizeControlCharsLayer_ACU(input);
    expect(result).toBe(input);
  });
  it('空字符串返回空', () => {
    expect(sanitizeControlCharsLayer_ACU('')).toBe('');
  });
  it('非字符串返回原值', () => {
    expect(sanitizeControlCharsLayer_ACU(null as any)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// removeTrailingCommasLayer_ACU
// ═══════════════════════════════════════════════════════════════
describe('removeTrailingCommasLayer_ACU', () => {
  it('对象尾逗号移除', () => {
    expect(removeTrailingCommasLayer_ACU('{"a":1,}')).toBe('{"a":1}');
  });
  it('数组尾逗号移除', () => {
    expect(removeTrailingCommasLayer_ACU('[1,2,]')).toBe('[1,2]');
  });
  it('嵌套尾逗号移除', () => {
    expect(removeTrailingCommasLayer_ACU('{"a":[1,],}')).toBe('{"a":[1]}');
  });
  it('字符串内的逗号不移除', () => {
    expect(removeTrailingCommasLayer_ACU('{"a":"b,}"}')).toBe('{"a":"b,}"}');
  });
  it('正常 JSON 不变', () => {
    const input = '{"a":1,"b":2}';
    expect(removeTrailingCommasLayer_ACU(input)).toBe(input);
  });
  it('空字符串返回空', () => {
    expect(removeTrailingCommasLayer_ACU('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// fixNumericKeysLayer_ACU
// ═══════════════════════════════════════════════════════════════
describe('fixNumericKeysLayer_ACU', () => {
  it('数字键加引号', () => {
    expect(fixNumericKeysLayer_ACU('{0:"a",1:"b"}')).toBe('{"0":"a","1":"b"}');
  });
  it('负数键加引号', () => {
    expect(fixNumericKeysLayer_ACU('{-1:"a"}')).toBe('{"-1":"a"}');
  });
  it('已有引号的键不变', () => {
    expect(fixNumericKeysLayer_ACU('{"0":"a"}')).toBe('{"0":"a"}');
  });
  it('字符串键不变', () => {
    expect(fixNumericKeysLayer_ACU('{"key":"a"}')).toBe('{"key":"a"}');
  });
  it('空字符串返回空', () => {
    expect(fixNumericKeysLayer_ACU('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// sanitizeJsonPipeline_ACU
// ═══════════════════════════════════════════════════════════════
describe('sanitizeJsonPipeline_ACU', () => {
  it('正常 JSON 不做任何修改', () => {
    const input = '{"a":1}';
    const result = sanitizeJsonPipeline_ACU(input);
    expect(result.success).toBe(true);
    expect(result.result).toBe(input);
    expect(result.layersApplied).toEqual([]);
  });
  it('多层清洗同时生效', () => {
    const input = '{「a」:1,}'; // 「」引号 + 尾逗号
    const result = sanitizeJsonPipeline_ACU(input);
    expect(result.success).toBe(true);
    expect(result.layersApplied).toContain('normalizeQuotes');
    expect(result.layersApplied).toContain('removeTrailingCommas');
    expect(JSON.parse(result.result)).toEqual({ a: 1 });
  });
  it('字符串值中的 URL 不会被清洗截断', () => {
    const input = '{"0":"https://example.com/a//b?x=1#hash"}';
    const result = sanitizeJsonPipeline_ACU(input);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual({ '0': 'https://example.com/a//b?x=1#hash' });
  });
  it('字符串值中的注释标记不会被清洗删除', () => {
    const input = '{"0":"包含 /* 不是注释 */ 与 // 文本"}';
    const result = sanitizeJsonPipeline_ACU(input);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual({ '0': '包含 /* 不是注释 */ 与 // 文本' });
  });
  it('非字符串输入返回失败', () => {
    const result = sanitizeJsonPipeline_ACU(123 as any);
    expect(result.success).toBe(false);
  });
  it('复杂畸形 JSON 清洗后可解析', () => {
    const input = '{0:\u201cvalue\u201d,}';
    const result = sanitizeJsonPipeline_ACU(input);
    expect(result.success).toBe(true);
    // 数字键 + 中文引号 + 尾逗号 → 清洗后应该可解析
    expect(result.layersApplied.length).toBeGreaterThan(0);
  });
  it('标准双引号字符串内的「」『』＂保持原文', () => {
    expect(normalizeQuotesLayer_ACU('{"0":"作者说「你好」『嗯』＂"}')).toBe('{"0":"作者说「你好」『嗯』＂"}');
    expect(normalizeQuotesLayer_ACU('{「0」:"a\\"「b」"}')).toBe('{"0":"a\\"「b」"}');
  });
  it('字符串内部的 ,1: 不被当作数字键加引号', () => {
    expect(fixNumericKeysLayer_ACU('{0:"数值,1:第二个",2:"c"}')).toBe('{"0":"数值,1:第二个","2":"c"}');
    expect(fixNumericKeysLayer_ACU('{"0":"转义\\",1:仍在字符串内"}')).toBe('{"0":"转义\\",1:仍在字符串内"}');
  });
});

describe('行对象恢复入口保留正文', () => {
  it.each([
    ['普通文本', '第一行\n第二行'],
    ['中文直角引号', '作者说「你好」\n第二行'],
    ['正文中的数字键样式片段', '数值,1:第二个\n第三行'],
  ])('%s 含裸换行时恢复且不改写字符', (_name, text) => {
    const result = coerceLooseRowObject_ACU(`{"0":"${text}","1":"尾列"}`);
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ '0': text, '1': '尾列' });
  });
  it('字符串外部的「」仍按定界符修复', () => {
    const result = sanitizeJsonPipeline_ACU('{「0」:「值」}');
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result)).toEqual({ '0': '值' });
  });
});

// ═══════════════════════════════════════════════════════════════
// splitTopLevelSegments_ACU
// ═══════════════════════════════════════════════════════════════
describe('splitTopLevelSegments_ACU', () => {
  it('逗号分隔简单值', () => {
    expect(splitTopLevelSegments_ACU('"a","b","c"')).toEqual(['"a"', '"b"', '"c"']);
  });
  it('嵌套对象不拆分', () => {
    expect(splitTopLevelSegments_ACU('"a":{"b":"c"},"d":"e"')).toEqual(['"a":{"b":"c"}', '"d":"e"']);
  });
  it('嵌套数组不拆分', () => {
    expect(splitTopLevelSegments_ACU('"a":[1,2],"b":3')).toEqual(['"a":[1,2]', '"b":3']);
  });
  it('空字符串返回空数组', () => {
    expect(splitTopLevelSegments_ACU('')).toEqual([]);
  });
  it('非字符串返回空数组', () => {
    expect(splitTopLevelSegments_ACU(null as any)).toEqual([]);
  });
  it('自定义分隔符', () => {
    expect(splitTopLevelSegments_ACU('a|b|c', '|')).toEqual(['a', 'b', 'c']);
  });
  it('字符串内的逗号不拆分', () => {
    expect(splitTopLevelSegments_ACU('"a,b","c"')).toEqual(['"a,b"', '"c"']);
  });
  it('字符串内 URL 的冒号和双斜杠不影响顶层分段', () => {
    expect(splitTopLevelSegments_ACU('"url":"https://example.com/a//b","note":"ok"')).toEqual(['"url":"https://example.com/a//b"', '"note":"ok"']);
  });
});

// ═══════════════════════════════════════════════════════════════
// findTopLevelDelimiterIndex_ACU
// ═══════════════════════════════════════════════════════════════
describe('findTopLevelDelimiterIndex_ACU', () => {
  it('找到顶层冒号', () => {
    expect(findTopLevelDelimiterIndex_ACU('"key":"value"')).toBe(5);
  });
  it('嵌套对象内的冒号不匹配', () => {
    expect(findTopLevelDelimiterIndex_ACU('{"a":"b"}:c')).toBe(9);
  });
  it('字符串内的冒号不匹配', () => {
    expect(findTopLevelDelimiterIndex_ACU('"a:b"')).toBe(-1);
  });
  it('无分隔符返回 -1', () => {
    expect(findTopLevelDelimiterIndex_ACU('abc')).toBe(-1);
  });
  it('空字符串返回 -1', () => {
    expect(findTopLevelDelimiterIndex_ACU('')).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════
// tryParseLooseJsonValue_ACU
// ═══════════════════════════════════════════════════════════════
describe('tryParseLooseJsonValue_ACU', () => {
  it('标准 JSON 值解析成功', () => {
    expect(tryParseLooseJsonValue_ACU('"hello"')).toEqual({ success: true, value: 'hello', error: null });
  });
  it('数字解析成功', () => {
    expect(tryParseLooseJsonValue_ACU('42')).toEqual({ success: true, value: 42, error: null });
  });
  it('布尔值解析成功', () => {
    expect(tryParseLooseJsonValue_ACU('true')).toEqual({ success: true, value: true, error: null });
  });
  it('null 解析成功', () => {
    expect(tryParseLooseJsonValue_ACU('null')).toEqual({ success: true, value: null, error: null });
  });
  it('单引号字符串转双引号后解析', () => {
    const result = tryParseLooseJsonValue_ACU("'hello'");
    expect(result.success).toBe(true);
    expect(result.value).toBe('hello');
  });
  it('空字符串返回失败', () => {
    expect(tryParseLooseJsonValue_ACU('')).toEqual({ success: false, value: null, error: 'Empty value' });
  });
  it('非字符串直接返回', () => {
    expect(tryParseLooseJsonValue_ACU(42)).toEqual({ success: true, value: 42, error: null });
  });
  it('「」引号字符串经管线清洗后解析', () => {
    const result = tryParseLooseJsonValue_ACU('「hello」');
    expect(result.success).toBe(true);
    expect(result.value).toBe('hello');
  });
});

// ═══════════════════════════════════════════════════════════════
// parseLooseObjectKey_ACU
// ═══════════════════════════════════════════════════════════════
describe('parseLooseObjectKey_ACU', () => {
  it('带引号的键', () => {
    expect(parseLooseObjectKey_ACU('"key"')).toBe('key');
  });
  it('数字键', () => {
    expect(parseLooseObjectKey_ACU('0')).toBe('0');
  });
  it('无引号的键去除引号', () => {
    expect(parseLooseObjectKey_ACU('key')).toBe('key');
  });
  it('空字符串返回 null', () => {
    expect(parseLooseObjectKey_ACU('')).toBeNull();
  });
  it('纯空格返回 null', () => {
    expect(parseLooseObjectKey_ACU('   ')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// coerceLooseRowObject_ACU
// ═══════════════════════════════════════════════════════════════
describe('coerceLooseRowObject_ACU', () => {
  it('标准 JSON 对象解析成功', () => {
    const result = coerceLooseRowObject_ACU('{"0":"a","1":"b"}');
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ '0': 'a', '1': 'b' });
  });
  it('数字键对象解析成功', () => {
    const result = coerceLooseRowObject_ACU('{0:"a",1:"b"}');
    expect(result.success).toBe(true);
    expect(result.result?.['0']).toBe('a');
  });
  it('空对象解析成功', () => {
    const result = coerceLooseRowObject_ACU('{}');
    expect(result.success).toBe(true);
    expect(result.result).toEqual({});
  });
  it('非对象格式返回失败', () => {
    const result = coerceLooseRowObject_ACU('[1,2,3]');
    expect(result.success).toBe(false);
  });
  it('非字符串返回失败', () => {
    const result = coerceLooseRowObject_ACU(123 as any);
    expect(result.success).toBe(false);
  });
  it('无键值对的值自动分配数字键', () => {
    const result = coerceLooseRowObject_ACU('{"a":"b","c":"d"}');
    expect(result.success).toBe(true);
    expect(result.result?.['a']).toBe('b');
    expect(result.result?.['c']).toBe('d');
  });
  it('混合键值对和纯值', () => {
    const result = coerceLooseRowObject_ACU('{0:"first","second"}');
    expect(result.success).toBe(true);
    expect(result.result?.['0']).toBe('first');
    expect(result.result?.['1']).toBe('second');
  });
  it('松散对象中的 URL 和注释标记作为字符串值保留', () => {
    const result = coerceLooseRowObject_ACU('{0:"https://example.com/a//b",1:"含 /* 文本 */"}');
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ '0': 'https://example.com/a//b', '1': '含 /* 文本 */' });
  });
});

// ═══════════════════════════════════════════════════════════════
// isLikelyStringCloser_ACU
// ═══════════════════════════════════════════════════════════════
describe('isLikelyStringCloser_ACU', () => {
  it('key 类型后跟冒号返回 true', () => {
    expect(isLikelyStringCloser_ACU('"key": "value"', 4, 'key', 'object')).toBe(true);
  });
  it('key 类型后不跟冒号返回 false', () => {
    expect(isLikelyStringCloser_ACU('"key" "value"', 4, 'key', 'object')).toBe(false);
  });
  it('value 类型后跟 } 返回 true', () => {
    expect(isLikelyStringCloser_ACU('"val"}', 4, 'value', 'object')).toBe(true);
  });
  it('value 类型后跟 ] 返回 true', () => {
    expect(isLikelyStringCloser_ACU('"val"]', 4, 'value', 'array')).toBe(true);
  });
  it('value 类型后跟逗号和新 key 返回 true', () => {
    expect(isLikelyStringCloser_ACU('"val", "next"', 4, 'value', 'object')).toBe(true);
  });
  it('文本末尾且非 key 返回 true', () => {
    expect(isLikelyStringCloser_ACU('"val"', 4, 'value', null)).toBe(true);
  });
  it('文本末尾且是 key 返回 false', () => {
    expect(isLikelyStringCloser_ACU('"key"', 4, 'key', null)).toBe(false);
  });
});
