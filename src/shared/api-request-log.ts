import { parse as parseYaml } from 'yaml';
import { isApiLogEnabled, pushLog } from './log-buffer';

const HIDDEN = '[已隐藏凭据]';
const DISABLED_LOG_ACU: ApiRequestLog_ACU = { write() {} };
let nextRequestId = 0;
const credentialKey = (key: string): boolean => /authorization|apikey|password|passwd|secret|cookie|csrf|sessionid|token$|^key$/.test(key.replace(/[^a-z0-9]/gi, '').toLowerCase());
const headerBlock = (key: string): boolean => /^(custom_include_headers|requestHeaders|headers)$/i.test(key);
const yamlBlock = (key: string): boolean => /^(custom_include_body|bodyParams)$/i.test(key);

/** 仅生成脱离原对象的诊断快照；不调用宿主 getter/toJSON，不截短正文字符串。 */
function snapshot(value: unknown, secrets: Set<string>, ancestors = new Set<object>(), depth = 0): any {
    if (typeof value === 'string') return value;
    if (typeof value === 'function' || typeof value === 'symbol') return '[不可序列化值]';
    if (value === null || typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
    if (ancestors.has(value)) return '[循环引用]';
    if (depth > 32) return '[对象层级过深，未展开]';
    ancestors.add(value);
    const copy: any = Array.isArray(value) ? [] : Object.create(null);
    if (typeof DOMException !== 'undefined' && value instanceof DOMException) {
        // 仅调用内建品牌校验 getter，不读取宿主对象自定义访问器。
        for (const key of ['name', 'message']) {
            const get = Object.getOwnPropertyDescriptor(DOMException.prototype, key)?.get;
            if (get) copy[key] = get.call(value);
        }
    } else if (value instanceof Error) {
        copy.name = 'Error';
    }
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (key === 'length' && Array.isArray(value)) continue;
        if (!('value' in descriptor)) { copy[key] = '[访问器，未读取]'; continue; }
        let child = descriptor.value;
        if (yamlBlock(key) && typeof child === 'string') {
            try { child = parseYaml(child); } catch { /* 原文仍经凭据模式脱敏。 */ }
        }
        if (credentialKey(key) || headerBlock(key)) {
            collectSecrets(child, secrets);
            copy[key] = HIDDEN;
        } else copy[key] = snapshot(child, secrets, ancestors, depth + 1);
    }
    ancestors.delete(value);
    return copy;
}

function collectSecrets(value: unknown, secrets: Set<string>, seen = new Set<object>()): void {
    if (value === HIDDEN) return;
    if (typeof value === 'string') {
        if (value && value !== HIDDEN) secrets.add(value);
        // 标头块可能是 YAML 或 Header: Value；所有附加标头值均视为凭据。
        try { const parsed = parseYaml(value); if (parsed && typeof parsed === 'object') collectSecrets(parsed, secrets, seen); } catch { /* 保留逐行提取。 */ }
        for (const line of value.split('\n')) {
            const colon = line.indexOf(':');
            if (colon > 0) { const part = line.slice(colon + 1).trim(); if (part) secrets.add(part); }
        }
    } else if (value && typeof value === 'object' && !seen.has(value)) {
        seen.add(value);
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
            if ('value' in descriptor) collectSecrets(descriptor.value, secrets, seen);
        }
    }
}


function redactText(text: string, secrets: Set<string>): string {
    // URL 凭据先登记，再处理其他字段和回显；不在日志中保留查询值。
    let result = text.replace(/https?:\/\/[^\s"'<>\\]+/gi, raw => {
        try {
            const url = new URL(raw);
            for (const part of [url.username, url.password, ...url.searchParams.values()]) {
                if (part) { secrets.add(part); try { secrets.add(decodeURIComponent(part)); } catch { /* 保留原值。 */ } }
            }
            if (!url.search && !url.username && !url.password) return raw;
            url.search = ''; url.username = ''; url.password = '';
            return url.toString();
        } catch { return raw; }
    });
    result = result.replace(/((?:["']?[\w-]*(?:authorization|api[-_]?key|password|passwd|secret|cookie|csrf|session[-_]?id|[\w-]*token)["']?)\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi,
        (_match, prefix: string, value: string) => {
            try { collectSecrets(JSON.parse(value), secrets); } catch { collectSecrets(value.replace(/^['"]|['"]$/g, ''), secrets); }
            return prefix + JSON.stringify(HIDDEN);
        });
    for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
        for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)])) {
            result = result.split(form).join(HIDDEN);
        }
        if (/^Bearer\s+/i.test(secret)) result = result.split(secret.replace(/^Bearer\s+/i, '')).join(HIDDEN);
    }
    return result;
}

export interface ApiRequestLog_ACU {
    write(phase: string, value: unknown): void;
}

/** 只格式化已脱敏的快照；多行正文用文本块展示，不改写字面量反斜杠。 */
function formatApiLogText_ACU(text: string): string {
    const render = (value: any, depth: number): string => {
        const indent = '  '.repeat(depth);
        const childIndent = indent + '  ';
        if (typeof value === 'string') {
            // 请求 body 和工具参数可能是嵌套 JSON 字符串，只有合法结构才展开。
            if (depth < 32 && /^\s*[\[{]/.test(value)) {
                try { return render(JSON.parse(value), depth + 1); } catch { /* 保留原文。 */ }
            }
            if (/[\r\n]/.test(value)) {
                return '|\n' + value.split(/\r\n|\r|\n/).map(line => childIndent + line).join('\n');
            }
            return JSON.stringify(value);
        }
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        const array = Array.isArray(value);
        const entries = Object.entries(value);
        const [open, close] = array ? ['[', ']'] : ['{', '}'];
        if (!entries.length) return open + close;
        return open + '\n' + entries.map(([key, child]) =>
            childIndent + (array ? '' : JSON.stringify(key) + ': ') + render(child, depth + 1),
        ).join(',\n') + '\n' + indent + close;
    };
    try {
        const value = JSON.parse(text);
        // 非 JSON 正文、SSE 和 JSON 标量不擅自重解释。
        if (value && typeof value === 'object') return render(value, 0);
    } catch { /* 不完整 JSON 和普通文本保持原文。 */ }
    return text;
}

/** 同一请求共用编号和凭据集合，详细日志遵从独立 API 请求采集开关。 */
export function createApiRequestLog_ACU(tag: string, phase: string, request: unknown, context?: unknown): ApiRequestLog_ACU {
    if (!isApiLogEnabled()) return DISABLED_LOG_ACU;
    const id = ++nextRequestId;
    const secrets = new Set<string>();
    const write = (label: string, value: unknown): void => {
        if (!isApiLogEnabled()) return;
        try {
            const copy = snapshot(value, secrets);
            const text = typeof copy === 'string' ? copy : JSON.stringify(copy) ?? String(copy);
            const safeLabel = redactText(label, secrets);
            const safeText = redactText(text, secrets);
            pushLog('api', ['[ACU]', `[${tag}] #${id} ${safeLabel}\n${formatApiLogText_ACU(safeText)}`]);
        } catch {
            pushLog('api', ['[ACU]', `[${tag}] #${id} 日志快照失败（未记录原对象）`]);
        }
    };
    try { redactText(JSON.stringify(snapshot(context, secrets)) ?? '', secrets); } catch { /* 不泄露未知对象。 */ }
    write(phase, request);
    return { write };
}


/** 只旁观消费者发起的读取：不预读、不 clone/tee、不增加取消或释放锁动作。 */
export function observeApiResponse_ACU(response: Response, log: ApiRequestLog_ACU, signal?: AbortSignal | null): { response: Response; finish(): void } {
    if (log === DISABLED_LOG_ACU) return { response, finish() {} };
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let finished = false;
    const finish = (state = '未读完，仅记录已消费内容'): void => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        parts.push(decoder.decode());
        log.write(`回复 HTTP ${response.status}（${state}）`, parts.join(''));
        parts.length = 0;
    };
    const onAbort = (): void => finish('请求取消，仅记录已消费内容');
    signal?.addEventListener('abort', onAbort, { once: true });
    const failed = (error: unknown): void => {
        finish('读取失败，仅记录已消费内容');
        log.write('响应读取失败', error);
    };
    const consumeText = async (): Promise<string> => {
        try {
            const text = await response.text();
            if (!finished) parts.push(text);
            finish('完整');
            return text;
        } catch (error) { failed(error); throw error; }
    };
    const body = response.body;
    const observedBody = body && new Proxy(body, {
        get(target, key) {
            if (key === 'getReader') return (...args: any[]) => {
                const reader = (target.getReader as any)(...args);
                return new Proxy(reader, {
                    get(readerTarget, readerKey) {
                        if (readerKey === 'read') return async (...readArgs: any[]) => {
                            try {
                                const result = await readerTarget.read(...readArgs);
                                if (result.value && !finished) parts.push(decoder.decode(result.value, { stream: true }));
                                if (result.done) finish('完整');
                                return result;
                            } catch (error) { failed(error); throw error; }
                        };
                        if (readerKey === 'releaseLock') return () => {
                            const result = readerTarget.releaseLock();
                            finish();
                            return result;
                        };
                        if (readerKey === 'cancel') return async (reason?: unknown) => {
                            try { return await readerTarget.cancel(reason); }
                            finally { finish('消费者取消，仅记录已消费内容'); }
                        };
                        const value = Reflect.get(readerTarget, readerKey, readerTarget);
                        return typeof value === 'function' ? value.bind(readerTarget) : value;
                    },
                });
            };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const observed = new Proxy(response, {
        get(target, key) {
            if (key === 'body') return observedBody;
            if (key === 'text') return consumeText;
            if (key === 'json') return async () => {
                // 实际 Response 只消费一次 text，并保留解析前的原始 JSON；兼容已有结构化测试替身。
                if (typeof target.text === 'function') return JSON.parse(await consumeText());
                try {
                    const result = await target.json();
                    if (!finished) log.write(`回复 HTTP ${target.status}（结构化返回值）`, result);
                    finished = true; signal?.removeEventListener('abort', onAbort);
                    return result;
                }
                catch (error) { failed(error); throw error; }
            };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    if (body === null) finish('无响应体');
    if (signal?.aborted) onAbort();
    return { response: observed, finish: () => finish() };
}
