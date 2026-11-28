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
  if (typeof cloned.custom_include_headers === 'string') {
    cloned.custom_include_headers = cloned.custom_include_headers.split(/\r?\n/).map((line: string) => {
      if (!line.trim()) return line;
      const colon = line.indexOf(':');
      return colon >= 0 ? `${line.slice(0, colon)}: ***` : '***';
    }).join('\n');
  } else if (cloned.custom_include_headers && typeof cloned.custom_include_headers === 'object') {
    const masked: Record<string, string> = {};
    for (const [key, headerValue] of Object.entries(cloned.custom_include_headers as Record<string, unknown>)) {
      masked[key] = '***';
    }
    cloned.custom_include_headers = masked;
  }
  if (typeof cloned.custom_include_body === 'string' && cloned.custom_include_body) {
    try {
      cloned.custom_include_body = JSON.stringify(sanitizeDeep_ACU(JSON.parse(cloned.custom_include_body)));
    } catch {
      cloned.custom_include_body = '***';
    }
  } else if (cloned.custom_include_body && typeof cloned.custom_include_body === 'object') {
    cloned.custom_include_body = sanitizeDeep_ACU(cloned.custom_include_body);
  }
  // builder 同时将地址放入 custom_url 与 reverse_proxy，二者都不能泄露 query。
  for (const field of ['custom_url', 'reverse_proxy']) {
    if (typeof cloned[field] === 'string') {
      cloned[field] = cloned[field].replace(/\?([^#]*)/, (_match: string, query: string) => {
        const params = new URLSearchParams(query);
        return '?' + [...params.keys()].map(key => `${encodeURIComponent(key)}=***`).join('&');
      });
    }
  }
  return cloned;
}
