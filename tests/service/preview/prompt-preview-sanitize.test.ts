/**
 * tests/service/preview/prompt-preview-sanitize.test.ts
 * 预览请求体脱敏 — 纯函数单测
 */
import { describe, it, expect } from 'vitest';
import { sanitizeApiRequestBodyForPreview_ACU } from '../../../src/service/preview/prompt-preview-sanitize';
import { buildCustomApiRequestBody_ACU } from '../../../src/service/ai/api-call';

describe('sanitizeApiRequestBodyForPreview_ACU', () => {
  it('真实 builder 的字符串 headers 逐行保留头名并掩码所有值', () => {
    const body = buildCustomApiRequestBody_ACU([], {
      url: 'https://preview.test/v1', model: 'm', apiKey: 'builder-api-secret',
      requestHeaders: 'X-Custom: header-secret\r\nX-Trace: trace-secret',
    });
    expect(typeof body.custom_include_headers).toBe('string');
    const before = structuredClone(body);
    const sanitized = sanitizeApiRequestBodyForPreview_ACU(body);
    expect(sanitized.custom_include_headers.split(/\r?\n/)).toEqual([
      'Authorization: ***', 'X-Custom: ***', 'X-Trace: ***',
    ]);
    expect(body).toEqual(before);
  });

  it('真实 builder 的 JSON body 字符串解析后递归脱敏并保留普通字段', () => {
    const body = buildCustomApiRequestBody_ACU([], {
      url: 'https://preview.test/v1', model: 'm',
      bodyParams: JSON.stringify({ safe: 1, nested: { api_key: 'body-secret', list: [{ token: 'token-secret', ok: true }] } }),
    });
    expect(typeof body.custom_include_body).toBe('string');
    const before = structuredClone(body);
    const sanitized = sanitizeApiRequestBodyForPreview_ACU(body);
    expect(JSON.parse(sanitized.custom_include_body)).toEqual({
      safe: 1, nested: { api_key: '***', list: [{ token: '***', ok: true }] },
    });
    expect(body).toEqual(before);
  });

  it.each(['api_key: yaml-secret', 'metadata: [invalid-secret'])('真实 builder 的非 JSON body 整段掩码：%s', bodyParams => {
    const body = buildCustomApiRequestBody_ACU([], { url: 'https://preview.test/v1', model: 'm', bodyParams });
    expect(sanitizeApiRequestBodyForPreview_ACU(body).custom_include_body).toBe('***');
  });

  it('真实 builder 的 URL query 全部值掩码，包含重复键与空值且不修改输入', () => {
    const body = buildCustomApiRequestBody_ACU([], {
      url: 'https://preview.test/v1?key=query-secret&region=region-secret&key=second-secret&empty=', model: 'm',
    });
    const sanitized = sanitizeApiRequestBodyForPreview_ACU(body);
    const url = new URL(sanitized.custom_url);
    expect([...url.searchParams.entries()]).toEqual([
      ['key', '***'], ['region', '***'], ['key', '***'], ['empty', '***'],
    ]);
    expect(body.custom_url).toContain('query-secret');
    expect(JSON.stringify(sanitized)).not.toMatch(/query-secret|region-secret|second-secret/);
  });

  it('proxy_password 非空时替换为 ***，空串保持原样', () => {
    const body = { proxy_password: 'sk-live-secret', model: 'm' };
    const sanitized = sanitizeApiRequestBodyForPreview_ACU(body);
    expect(sanitized.proxy_password).toBe('***');
    expect(sanitized.model).toBe('m');
    expect(sanitizeApiRequestBodyForPreview_ACU({ proxy_password: '' }).proxy_password).toBe('');
  });

  it('custom_include_headers 所有值替换为 ***（含 Authorization Bearer）', () => {
    const body = {
      custom_include_headers: {
        Authorization: 'Bearer sk-abc',
        'X-Custom': 'secret-value',
      },
    };
    const sanitized = sanitizeApiRequestBodyForPreview_ACU(body);
    expect(sanitized.custom_include_headers.Authorization).toBe('***');
    expect(sanitized.custom_include_headers['X-Custom']).toBe('***');
  });

  it('custom_include_body 按键名启发式递归脱敏，非敏感键保留', () => {
    const body = {
      custom_include_body: {
        api_key: 'sk-1',
        myToken: 't',
        user_password: 'p',
        Authorization: 'Bearer x',
        nested: { deep_secret: 's', safe: 1, list: [{ api_token: 'a' }, { ok: true }] },
        keepMe: 'value',
      },
    };
    const sanitized = sanitizeApiRequestBodyForPreview_ACU(body);
    const c = sanitized.custom_include_body as any;
    expect(c.api_key).toBe('***');
    expect(c.myToken).toBe('***');
    expect(c.user_password).toBe('***');
    expect(c.Authorization).toBe('***');
    expect(c.nested.deep_secret).toBe('***');
    expect(c.nested.safe).toBe(1);
    expect(c.nested.list[0].api_token).toBe('***');
    expect(c.nested.list[1].ok).toBe(true);
    expect(c.keepMe).toBe('value');
  });

  it('深拷贝：脱敏不改动入参', () => {
    const body = { proxy_password: 'secret', custom_include_headers: { A: 'B' } };
    sanitizeApiRequestBodyForPreview_ACU(body);
    expect(body.proxy_password).toBe('secret');
    expect(body.custom_include_headers.A).toBe('B');
  });

  it('空值与非法输入安全返回', () => {
    expect(sanitizeApiRequestBodyForPreview_ACU(null)).toEqual({});
    expect(sanitizeApiRequestBodyForPreview_ACU(undefined)).toEqual({});
    expect(sanitizeApiRequestBodyForPreview_ACU({})).toEqual({});
  });
});
