export type LorebookReadErrorCategory_ACU =
  | 'aborted'
  | 'scope_changed'
  | 'lorebook_not_found'
  | 'api_unavailable'
  | 'unknown';

function getLorebookReadErrorMessage_ACU(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return String(error ?? '');
}

export function classifyLorebookReadError_ACU(error: unknown): LorebookReadErrorCategory_ACU {
  // 1. strict 结构优先：真实 readContext 路径的 StrictLorebookReadError 是唯一真实载体，
  //    其 message 固定为 `StrictLorebookRead:<status>`，message 匹配必然失效。
  if (isStrictLorebookReadError_ACU(error)) {
    const strict = error as {
      status?: unknown;
      failedBooks?: Array<{ errorCategory?: unknown }>;
    };
    if (strict.status === 'aborted') return 'aborted';
    if (strict.status === 'scope_changed') return 'scope_changed';
    if (strict.status === 'read_failed') {
      const failedBooks = Array.isArray(strict.failedBooks) ? strict.failedBooks : [];
      // 仅当全部书级失败都是 not-found 时才隔离；mixed/unknown 必须失败关闭。
      if (failedBooks.length > 0 && failedBooks.every(failure => failure?.errorCategory === 'lorebook_not_found')) {
        return 'lorebook_not_found';
      }
    }
    return 'unknown';
  }

  // 2. 命名 host API 缺失错误：required gateway 的唯一失败形态。
  if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'WorldbookReadError_ACU') {
    const category = (error as { category?: unknown }).category;
    if (category === 'lorebook_not_found' || category === 'api_unavailable'
      || category === 'scope_changed' || category === 'unknown') return category;
  }
  if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'WorldbookHostApiUnavailableError_ACU') {
    return 'api_unavailable';
  }

  const candidate = error as { name?: unknown; message?: unknown } | null | undefined;
  const message = getLorebookReadErrorMessage_ACU(error);
  if (candidate?.name === 'AbortError' || message === 'TaskAbortedByUser') return 'aborted';

  const isExplicitlyMissingEnglishBook = /\b(?:worldbook|lorebook)\b(?:\s+['\"`][^'\"`\r\n]+['\"`])?\s+(?:not found|does not exist|(?:is\s+)?missing)\b/i.test(message)
    || /\b(?:could not find|cannot find|can't find)\s+(?:the\s+)?(?:worldbook|lorebook)\b/i.test(message);
  const isExplicitlyMissingChineseBook = /世界书(?!\s*条目)\s*(?:[“\"'`][^”\"'`\r\n]+[”\"'`])?\s*(?:未能找到|无法找到|找不到|不存在)/.test(message)
    || /(?:未能找到|无法找到|找不到)\s*世界书(?!\s*条目)/.test(message);

  return isExplicitlyMissingEnglishBook || isExplicitlyMissingChineseBook
    ? 'lorebook_not_found'
    : 'unknown';
}

export function isLorebookReadAbortedError_ACU(error: unknown): boolean {
  return classifyLorebookReadError_ACU(error) === 'aborted';
}

export function isLorebookReadNotFoundError_ACU(error: unknown): boolean {
  return classifyLorebookReadError_ACU(error) === 'lorebook_not_found';
}

/**
 * 纯 duck-typing 的 StrictLorebookReadError 识别。
 * 不 import pipeline，避免 plot-runtime-scope → pipeline → runtime 的循环依赖。
 * 仅检查有限白名单字段，不读取 message/stack。
 */
export function isStrictLorebookReadError_ACU(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    source?: unknown;
    validationPolicy?: unknown;
    runId?: unknown;
    failedBooks?: unknown;
    invalidBookNames?: unknown;
    staleBookNames?: unknown;
  };
  return candidate.name === 'StrictLorebookReadError_ACU'
    && typeof candidate.status === 'string'
    && typeof candidate.source === 'string'
    && typeof candidate.validationPolicy === 'string'
    && typeof candidate.runId === 'string'
    && Array.isArray(candidate.failedBooks)
    && Array.isArray(candidate.invalidBookNames)
    && Array.isArray(candidate.staleBookNames);
}

/**
 * 安全摘要：只输出白名单结构化字段，绝不复制 message/stack。
 * 供 plot runtime 顶层与日志使用；pipeline 内可委托本实现避免双份漂移。

/**
 * 统一运行时错误安全摘要：
 * - strict 错误 → strict 白名单摘要；
 * - 命名 host API 不可用 → 只输出 operation；
 * - 已安全摘要对象 → 原样规范化透传（防止阶段摘要二次压缩为 unknown）；
 * - 其余 → 安全分类。
 * 任何分支都不复制原始 message/stack/宿主正文。
 */
export function summarizeLorebookRuntimeError_ACU(error: unknown): Record<string, unknown> | null {
  if (isStrictLorebookReadError_ACU(error)) {
    return { category: 'strict_lorebook_read', ...summarizeStrictLorebookReadError_ACU(error) };
  }
  if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'WorldbookHostApiUnavailableError_ACU') {
    const candidate = error as { operation?: unknown };
    return {
      category: 'api_unavailable',
      operation: typeof candidate.operation === 'string' ? candidate.operation : 'unknown',
    };
  }
  if (error && typeof error === 'object') {
    const candidate = error as { category?: unknown; phase?: unknown; subphase?: unknown; status?: unknown; source?: unknown; validationPolicy?: unknown; runId?: unknown; failedBookNames?: unknown; errorCategories?: unknown; staleBookNames?: unknown; invalidCount?: unknown; staleCount?: unknown; failedCount?: unknown };
    if (typeof candidate.category === 'string' && candidate.category) {
      return normalizeSafePreflightSummary_ACU(error);
    }
  }
  return { category: classifyLorebookReadError_ACU(error) };
}

/**
 * 规范化已安全摘要对象：只允许白名单字段，拒绝任意附加字段，避免日志注入。
 * 用于阶段摘要透传（clearFinalGenerationGreenlights → plot-task-engine → plot-runtime-phase）。
 */
export function normalizeSafePreflightSummary_ACU(error: unknown): Record<string, unknown> {
  const candidate = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const stringFields: Array<[string, unknown]> = [
    ['category', candidate.category],
    ['phase', candidate.phase],
    ['subphase', candidate.subphase],
    ['status', candidate.status],
    ['source', candidate.source],
    ['validationPolicy', candidate.validationPolicy],
    ['runId', candidate.runId],
    ['operation', candidate.operation],
  ];
  const numberFields: Array<[string, unknown]> = [
    ['failedCount', candidate.failedCount],
    ['invalidCount', candidate.invalidCount],
    ['staleCount', candidate.staleCount],
  ];
  const arrayFields: Array<[string, unknown]> = [
    ['failedBookNames', candidate.failedBookNames],
    ['errorCategories', candidate.errorCategories],
    ['staleBookNames', candidate.staleBookNames],
  ];
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of stringFields) {
    if (typeof value === 'string') normalized[key] = value;
  }
  for (const [key, value] of numberFields) {
    if (typeof value === 'number' && Number.isFinite(value)) normalized[key] = value;
  }
  for (const [key, value] of arrayFields) {
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) normalized[key] = [...value];
  }
  const reasons = ['http', 'network', 'timeout', 'invalid_json', 'invalid_payload', 'host_origin', 'request_headers'];
  if (typeof candidate.reason === 'string' && reasons.includes(candidate.reason)) normalized.reason = candidate.reason;
  if (typeof candidate.httpStatus === 'number' && Number.isInteger(candidate.httpStatus)
    && candidate.httpStatus >= 100 && candidate.httpStatus <= 599) {
    normalized.httpStatus = candidate.httpStatus;
  }
  return normalized;
}
export function summarizeStrictLorebookReadError_ACU(error: unknown) {
  if (!isStrictLorebookReadError_ACU(error)) return null;
  const candidate = error as {
    status?: unknown;
    source?: unknown;
    validationPolicy?: unknown;
    runId?: unknown;
    failedBooks?: Array<{ bookName?: unknown; errorCategory?: unknown }>;
    invalidBookNames?: unknown;
    staleBookNames?: unknown;
  };
  const failedBooks = (Array.isArray(candidate.failedBooks) ? candidate.failedBooks : [])
    .filter(failure => failure && typeof failure.bookName === 'string' && typeof failure.errorCategory === 'string')
    .map(failure => ({ bookName: failure.bookName as string, errorCategory: failure.errorCategory as string }));
  return {
    category: 'strict_lorebook_read',
    status: String(candidate.status ?? ''),
    source: String(candidate.source ?? ''),
    validationPolicy: String(candidate.validationPolicy ?? ''),
    runId: String(candidate.runId ?? ''),
    failedCount: failedBooks.length,
    failedBookNames: failedBooks.map(failure => failure.bookName),
    errorCategories: failedBooks.map(failure => failure.errorCategory),
    invalidCount: Array.isArray(candidate.invalidBookNames) ? candidate.invalidBookNames.length : 0,
    staleCount: Array.isArray(candidate.staleBookNames) ? candidate.staleBookNames.length : 0,
  };
}
