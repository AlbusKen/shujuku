/**
 * service/ai/prompt-builder/json-sanitizer.ts
 * AI 响应 JSON 清洗管线 + 松散对象解析
 * 从 prompt-builder.ts 的 parseAndApplyTableEdits_ACU 内部提取的纯函数集合
 */
import { logDebug_ACU, logWarn_ACU } from '../../../shared/utils';

const QUOTE_LIKE_CHARS_ACU = new Set(['「', '」', '『', '』', '＂']);

/**
 * 将字符串外部充当定界符的「」『』＂统一为标准双引号；
 * 标准双引号字符串内部的正文保持原样，避免改写模型输出的原文字符。
 */
export function normalizeQuotesLayer_ACU(jsonStr: string) {
    if (typeof jsonStr !== 'string' || !jsonStr) return jsonStr;
    let result = '';
    let mode: 'outside' | 'ascii' | 'quoteLike' = 'outside';
    let escapeNext = false;
    for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];
        if (escapeNext) {
            result += char;
            escapeNext = false;
            continue;
        }
        if (mode !== 'outside' && char === '\\') {
            result += char;
            escapeNext = true;
            continue;
        }
        if (mode === 'ascii') {
            result += char;
            if (char === '"') mode = 'outside';
            continue;
        }
        if (mode === 'quoteLike') {
            if (char === '"' || QUOTE_LIKE_CHARS_ACU.has(char)) {
                result += '"';
                mode = 'outside';
            } else {
                result += char;
            }
            continue;
        }
        if (char === '"') {
            result += char;
            mode = 'ascii';
        } else if (QUOTE_LIKE_CHARS_ACU.has(char)) {
            result += '"';
            mode = 'quoteLike';
        } else {
            result += char;
        }
    }
    return result;
}

/** 仅对标准双引号字符串之外的片段应用变换。 */
function mapOutsideJsonStrings_ACU(text: string, transform: (chunk: string) => string) {
    let result = '';
    let chunk = '';
    let inString = false;
    let escapeNext = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inString) {
            result += char;
            if (escapeNext) escapeNext = false;
            else if (char === '\\') escapeNext = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            result += transform(chunk) + char;
            chunk = '';
            inString = true;
            continue;
        }
        chunk += char;
    }
    return result + transform(chunk);
}

export function getNextNonWhitespaceMeta_ACU(text: string, startIndex: number) {
    for (let i = startIndex; i < text.length; i++) {
        if (!/\s/.test(text[i])) return { char: text[i], index: i };
    }
    return { char: '', index: -1 };
}

export function isLikelyJsonValueStart_ACU(char: string) {
    return !!char && (
        char === '"' ||
        char === '{' ||
        char === '[' ||
        char === '-' ||
        /\d/.test(char) ||
        char === 't' ||
        char === 'f' ||
        char === 'n'
    );
}

export function isLikelyStringCloser_ACU(text: string, quoteIndex: number, stringKind: string | null, containerType: string | null) {
    const nextMeta = getNextNonWhitespaceMeta_ACU(text, quoteIndex + 1);
    const nextChar = nextMeta.char;
    if (!nextChar) return stringKind !== 'key';
    if (stringKind === 'key') return nextChar === ':';
    if (nextChar === '}' || nextChar === ']') return true;
    if (nextChar !== ',') return false;

    const afterComma = getNextNonWhitespaceMeta_ACU(text, nextMeta.index + 1).char;
    if (!afterComma) return true;
    if (containerType === 'object') return afterComma === '"' || afterComma === '}';
    if (containerType === 'array') return afterComma === ']' || isLikelyJsonValueStart_ACU(afterComma);
    return isLikelyJsonValueStart_ACU(afterComma) || afterComma === '}' || afterComma === ']';
}

export function escapeUnescapedQuotesLayer_ACU(jsonStr: string) {
    if (typeof jsonStr !== 'string') {
        return { success: false, result: jsonStr, error: 'Input is not a string' };
    }

    let result = '';
    let inString = false;
    let escapeNext = false;
    let currentStringKind = null;
    const containerStack: { type: string; expecting: string }[] = [];

    const getTopContainer = () => containerStack.length ? containerStack[containerStack.length - 1] : null;
    const markParentValueCompleted = () => {
        const parent = getTopContainer();
        if (!parent) return;
        if (parent.type === 'object' || parent.type === 'array') {
            parent.expecting = 'commaOrEnd';
        }
    };

    for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];

        if (escapeNext) {
            result += char;
            escapeNext = false;
            continue;
        }

        if (inString) {
            if (char === '\\') {
                result += char;
                escapeNext = true;
                continue;
            }

            if (char === '"') {
                const top = getTopContainer();
                const containerType = top?.type || null;
                if (isLikelyStringCloser_ACU(jsonStr, i, currentStringKind, containerType)) {
                    result += char;
                    inString = false;
                    if (currentStringKind === 'key' && top && top.type === 'object') {
                        top.expecting = 'colon';
                    } else {
                        markParentValueCompleted();
                    }
                    currentStringKind = null;
                } else {
                    result += '\\"';
                }
                continue;
            }

            result += char;
            continue;
        }

        if (char === '"') {
            result += char;
            inString = true;
            const top = getTopContainer();
            currentStringKind = top && top.type === 'object' && (top.expecting === 'key' || top.expecting === 'keyOrEnd')
                ? 'key'
                : 'value';
            continue;
        }

        if (char === '{') {
            result += char;
            containerStack.push({ type: 'object', expecting: 'keyOrEnd' });
            continue;
        }

        if (char === '[') {
            result += char;
            containerStack.push({ type: 'array', expecting: 'valueOrEnd' });
            continue;
        }

        if (char === ':') {
            result += char;
            const top = getTopContainer();
            if (top && top.type === 'object') top.expecting = 'value';
            continue;
        }

        if (char === ',') {
            result += char;
            const top = getTopContainer();
            if (top && top.type === 'object') top.expecting = 'key';
            if (top && top.type === 'array') top.expecting = 'value';
            continue;
        }

        if (char === '}' || char === ']') {
            result += char;
            containerStack.pop();
            markParentValueCompleted();
            continue;
        }

        result += char;
    }

    return { success: true, result, error: null as string | null };
}

export function sanitizeControlCharsLayer_ACU(jsonStr: string) {
    if (typeof jsonStr !== 'string' || !jsonStr) return jsonStr;

    let result = '';
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];

        if (escapeNext) {
            result += char;
            escapeNext = false;
            continue;
        }

        if (char === '\\') {
            result += char;
            if (inString) escapeNext = true;
            continue;
        }

        if (char === '"') {
            result += char;
            inString = !inString;
            continue;
        }

        if (inString && char === '\n') {
            result += '\\n';
            continue;
        }
        if (inString && char === '\r') {
            result += '\\r';
            continue;
        }
        if (inString && char === '\t') {
            result += '\\t';
            continue;
        }
        if (inString && char === '\0') {
            result += '\\u0000';
            continue;
        }

        result += char;
    }

    return result;
}

export function removeTrailingCommasLayer_ACU(jsonStr: string) {
    if (typeof jsonStr !== 'string' || !jsonStr) return jsonStr;

    let result = '';
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];

        if (escapeNext) {
            result += char;
            escapeNext = false;
            continue;
        }

        if (char === '\\') {
            result += char;
            if (inString) escapeNext = true;
            continue;
        }

        if (char === '"') {
            result += char;
            inString = !inString;
            continue;
        }

        if (!inString && char === ',') {
            const nextChar = getNextNonWhitespaceMeta_ACU(jsonStr, i + 1).char;
            if (nextChar === '}' || nextChar === ']') continue;
        }

        result += char;
    }

    return result;
}

export function fixNumericKeysLayer_ACU(jsonStr: string) {
    if (typeof jsonStr !== 'string' || !jsonStr) return jsonStr;
    return mapOutsideJsonStrings_ACU(jsonStr, chunk => chunk.replace(/([{,]\s*)(-?\d+)(\s*:)/g, '$1"$2"$3'));
}

export function sanitizeJsonPipeline_ACU(jsonStr: string) {
    if (typeof jsonStr !== 'string') {
        return { success: false, result: jsonStr, layersApplied: [] as string[], error: 'Input is not a string' };
    }

    const layersApplied: string[] = [];
    let current = jsonStr;
    logDebug_ACU(`[JSON清洗] sanitizeJsonPipeline: 输入长度=${jsonStr.length}`);

    const normalizedQuotes = normalizeQuotesLayer_ACU(current);
    if (normalizedQuotes !== current) layersApplied.push('normalizeQuotes');
    current = normalizedQuotes;

    const escapedQuotes = escapeUnescapedQuotesLayer_ACU(current);
    if (!escapedQuotes.success) {
        return { success: false, result: current, layersApplied, error: escapedQuotes.error };
    }
    if (escapedQuotes.result !== current) layersApplied.push('escapeUnescapedQuotes');
    current = escapedQuotes.result;

    const sanitizedControlChars = sanitizeControlCharsLayer_ACU(current);
    if (sanitizedControlChars !== current) layersApplied.push('sanitizeControlChars');
    current = sanitizedControlChars;

    const withoutTrailingCommas = removeTrailingCommasLayer_ACU(current);
    if (withoutTrailingCommas !== current) layersApplied.push('removeTrailingCommas');
    current = withoutTrailingCommas;

    const fixedNumericKeys = fixNumericKeysLayer_ACU(current);
    if (fixedNumericKeys !== current) layersApplied.push('fixNumericKeys');
    current = fixedNumericKeys;

    return { success: true, result: current, layersApplied, error: null };
}

// ═══ 松散对象解析 ═══

export function splitTopLevelSegments_ACU(text: string, delimiterChar = ',') {
    if (typeof text !== 'string' || !text) return [];

    const segments = [];
    let current = '';
    let inString = false;
    let escapeNext = false;
    let braceDepth = 0;
    let bracketDepth = 0;
    let parenDepth = 0;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
            current += char;
            escapeNext = false;
            continue;
        }

        if (char === '\\') {
            current += char;
            if (inString) escapeNext = true;
            continue;
        }

        if (char === '"') {
            current += char;
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (char === '{') braceDepth++;
            else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
            else if (char === '[') bracketDepth++;
            else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            else if (char === '(') parenDepth++;
            else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
            else if (char === delimiterChar && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
                if (current.trim()) segments.push(current.trim());
                current = '';
                continue;
            }
        }

        current += char;
    }

    if (current.trim()) segments.push(current.trim());
    return segments;
}

export function findTopLevelDelimiterIndex_ACU(text: string, delimiterChar = ':') {
    if (typeof text !== 'string' || !text) return -1;

    let inString = false;
    let escapeNext = false;
    let braceDepth = 0;
    let bracketDepth = 0;
    let parenDepth = 0;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (char === '\\') {
            if (inString) escapeNext = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (char === '{') braceDepth++;
            else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
            else if (char === '[') bracketDepth++;
            else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            else if (char === '(') parenDepth++;
            else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
            else if (char === delimiterChar && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) return i;
        }
    }

    return -1;
}

export function tryParseLooseJsonValue_ACU(rawValue: any) {
    if (typeof rawValue !== 'string') return { success: true, value: rawValue, error: null as string | null };

    const trimmed = rawValue.trim();
    if (!trimmed) return { success: false, value: null, error: 'Empty value' };

    const normalizedValue = (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ? `"${trimmed.slice(1, -1)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
            .replace(/\t/g, '\\t')}"`
        : trimmed;

    const wrappedValue = `[${normalizedValue}]`;
    try {
        return { success: true, value: JSON.parse(wrappedValue)[0], error: null };
    } catch (directError) {
        const sanitizedWrapped = sanitizeJsonPipeline_ACU(wrappedValue);
        if (sanitizedWrapped.success) {
            try {
                return { success: true, value: JSON.parse(sanitizedWrapped.result)[0], error: null };
            } catch (sanitizedError) {}
        }
        return { success: false, value: null as any, error: directError?.message || 'Failed to parse loose value' };
    }
}

export function parseLooseObjectKey_ACU(rawKey: string) {
    const trimmed = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!trimmed) return null;
    if (/^-?\d+$/.test(trimmed)) return trimmed;

    const parsedKey = tryParseLooseJsonValue_ACU(trimmed);
    if (parsedKey.success && (typeof parsedKey.value === 'string' || typeof parsedKey.value === 'number')) {
        return String(parsedKey.value);
    }

    return trimmed.replace(/^["']|["']$/g, '');
}

export function coerceLooseRowObject_ACU(jsonStr: string) {
    if (typeof jsonStr !== 'string') {
        return { success: false, result: null, recoveredKeys: [], error: 'Input is not a string' };
    }

    const trimmed = jsonStr.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        return { success: false, result: null, recoveredKeys: [], error: 'Input is not an object literal' };
    }

    const body = trimmed.slice(1, -1).trim();
    if (!body) return { success: true, result: {}, recoveredKeys: [], error: null };

    const segments = splitTopLevelSegments_ACU(body, ',').filter(Boolean);
    logDebug_ACU(`[JSON清洗] coerceLooseRowObject: ${segments.length} 个段落`);
    if (!segments.length) {
        return { success: false, result: null, recoveredKeys: [], error: 'No top-level segments detected' };
    }

    const result: Record<string, any> = {};
    let nextAutoKey = 0;

    for (const segment of segments) {
        const colonIndex = findTopLevelDelimiterIndex_ACU(segment, ':');
        if (colonIndex !== -1) {
            const parsedKey = parseLooseObjectKey_ACU(segment.slice(0, colonIndex));
            const parsedValue = tryParseLooseJsonValue_ACU(segment.slice(colonIndex + 1));
            if (!parsedKey || !parsedValue.success) {
                return {
                    success: false,
                    result: null as Record<string, any> | null,
                    recoveredKeys: Object.keys(result),
                    error: `Failed to parse keyed segment: ${segment}`,
                };
            }
            result[parsedKey] = parsedValue.value;
            const numericKey = Number.parseInt(parsedKey, 10);
            if (!Number.isNaN(numericKey) && String(numericKey) === parsedKey) {
                nextAutoKey = Math.max(nextAutoKey, numericKey + 1);
            }
            continue;
        }

        const parsedValue = tryParseLooseJsonValue_ACU(segment);
        if (!parsedValue.success) {
            return {
                success: false,
                result: null,
                recoveredKeys: Object.keys(result),
                error: `Failed to parse value-only segment: ${segment}`,
            };
        }

        while (Object.prototype.hasOwnProperty.call(result, String(nextAutoKey))) {
            nextAutoKey++;
        }
        result[String(nextAutoKey)] = parsedValue.value;
        nextAutoKey++;
    }

    const recoveredKeys = Object.keys(result).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    if (!recoveredKeys.length) {
        return { success: false, result: null, recoveredKeys: [], error: 'No recoverable columns found' };
    }

    return { success: true, result, recoveredKeys, error: null };
}
