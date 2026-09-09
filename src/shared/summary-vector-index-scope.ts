export interface SummaryVectorIndexCanonicalScope_ACU {
    chatKey: string;
    isolationKey: string;
    sourceTableKey: string;
}

function normalizeScopePart_ACU(value: unknown, fallback: string): string {
    const normalized = String(value ?? '').trim();
    return normalized || fallback;
}

/**
 * Vector-index persistence identity is independent from the chat tag slot key.
 * Empty runtime isolation is the canonical default vector scope.
 */
export function normalizeSummaryVectorIsolationKey_ACU(value: unknown): string {
    return normalizeScopePart_ACU(value, 'default');
}

/**
 * 把向量 scope 的 isolation token 映射回聊天 IsolatedData 槽键。
 * 空运行时隔离的 scope token 是 default，槽键仍是 ''；两者规范化后相同则用运行时槽键。
 */
export function toChatIsolationSlotKey_ACU(scopeIsolationKey: unknown, runtimeIsolationKey: unknown): string {
    const scopeKey = String(scopeIsolationKey ?? '');
    const runtimeKey = String(runtimeIsolationKey ?? '');
    if (normalizeSummaryVectorIsolationKey_ACU(scopeKey) === normalizeSummaryVectorIsolationKey_ACU(runtimeKey)) {
        return runtimeKey;
    }
    return scopeKey;
}

export function normalizeSummaryVectorIndexScope_ACU(parts: {
    chatKey?: unknown;
    isolationKey?: unknown;
    sourceTableKey?: unknown;
}): SummaryVectorIndexCanonicalScope_ACU {
    return {
        chatKey: normalizeScopePart_ACU(parts.chatKey, 'current-chat'),
        isolationKey: normalizeSummaryVectorIsolationKey_ACU(parts.isolationKey),
        sourceTableKey: normalizeScopePart_ACU(parts.sourceTableKey, 'summary'),
    };
}

export function serializeSummaryVectorIndexScope_ACU(parts: {
    chatKey?: unknown;
    isolationKey?: unknown;
    sourceTableKey?: unknown;
}): string {
    const scope = normalizeSummaryVectorIndexScope_ACU(parts);
    return JSON.stringify([scope.chatKey, scope.isolationKey, scope.sourceTableKey]);
}
