/**
 * service/preview/prompt-preview-sanitize.ts — 请求体脱敏（纯函数）
 *
 * 展示前把上游请求体中的敏感字段值替换为 '***'：
 * - proxy_password：反向代理密码；
 * - custom_include_headers：含 Authorization Bearer <apiKey> 与用户自定义头；
 * - custom_include_body：用户自定义合并体，按键名启发式递归脱敏。
 * 返回深拷贝，不改动入参。
 */

const SENSITIVE_KEY_PATTERN_ACU = /api[-_]?key|token|secret|password|authorization|bearer/i;

function maskValue_ACU(value: unknown): unknown {
  return '***';
}

function sanitizeDeep_ACU(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeDeep_ACU(item));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN_ACU.test(key)) {
      result[key] = maskValue_ACU(child);
    } else {
      result[key] = sanitizeDeep_ACU(child);
    }
  }
  return result;
}

export function sanitizeApiRequestBodyForPreview_ACU(body: Record<string, any> | null | undefined): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  const cloned = JSON.parse(JSON.stringify(body));
  if (typeof cloned.proxy_password === 'string' && cloned.proxy_password) {
    cloned.proxy_password = '***';
  }
  if (cloned.custom_include_headers && typeof cloned.custom_include_headers === 'object') {
    const masked: Record<string, string> = {};
    for (const [key, headerValue] of Object.entries(cloned.custom_include_headers as Record<string, unknown>)) {
      masked[key] = '***';
    }
    cloned.custom_include_headers = masked;
  }
  if (cloned.custom_include_body && typeof cloned.custom_include_body === 'object') {
    cloned.custom_include_body = sanitizeDeep_ACU(cloned.custom_include_body);
  }
  return cloned;
}
