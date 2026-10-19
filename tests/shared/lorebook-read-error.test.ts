/**
 * tests/shared/lorebook-read-error.test.ts
 * 共享世界书读取错误分类器：统一 gateway / strict pipeline / plot runtime 的宿主错误分类。
 */
import { describe, expect, it } from 'vitest';
import {
  classifyLorebookReadError_ACU,
  isLorebookReadAbortedError_ACU,
  isLorebookReadNotFoundError_ACU,
  summarizeLorebookRuntimeError_ACU,
} from '../../src/shared/lorebook-read-error';

describe('classifyLorebookReadError_ACU', () => {
  describe('lorebook_not_found', () => {
    it.each([
      'Worldbook "ghost" not found',
      'Lorebook does not exist',
      'Could not find the lorebook',
      'Cannot find the worldbook',
      'Can\'t find worldbook',
      'Worldbook is missing',
      'lorebook is missing',
    ])('英文明确书级缺失：%s', message => {
      expect(classifyLorebookReadError_ACU(new Error(message))).toBe('lorebook_not_found');
    });

    it.each([
      '世界书“旧书”不存在',
      '未能找到世界书',
      '无法找到世界书',
      '世界书 “X” 无法找到',
      '世界书 "X" 无法找到',
      '找不到世界书 \'Sakura - Neglected Roommate\'',
    ])('中文明确书级缺失：%s', message => {
      expect(classifyLorebookReadError_ACU(new Error(message))).toBe('lorebook_not_found');
    });
  });

  describe('aborted', () => {
    it('AbortError name 归类为 aborted', () => {
      const error = Object.assign(new Error('worldbook "X" not found'), { name: 'AbortError' });
      expect(classifyLorebookReadError_ACU(error)).toBe('aborted');
      expect(isLorebookReadAbortedError_ACU(error)).toBe(true);
      expect(isLorebookReadNotFoundError_ACU(error)).toBe(false);
    });

    it('TaskAbortedByUser 消息归类为 aborted', () => {
      expect(classifyLorebookReadError_ACU(new Error('TaskAbortedByUser'))).toBe('aborted');
    });
  });

  describe('unknown', () => {
    it.each([
      'permission denied',
      'network unavailable',
      'Lorebook permission denied',
      'Lorebook credentials missing',
      'Lorebook permission scope missing',
      'Lorebook response missing required field',
      'Lorebook credentials not found',
      'Lorebook permission scope not found',
      'Lorebook response field not found',
      'Missing permission for Lorebook',
      'Lorebook network request failed',
      'Lorebook response malformed',
      '无法找到世界书条目',
      '未能找到世界书条目',
      '找不到世界书条目',
      '世界书条目不存在',
      'Lorebook entry not found',
      'Worldbook entry does not exist',
      '无法找到世界书条目，请检查关键词',
    ])('普通失败或条目级缺失不得归类为书级缺失：%s', message => {
      expect(classifyLorebookReadError_ACU(new Error(message))).toBe('unknown');
    });

    it('非 Error 拒绝值归类为 unknown', () => {
      expect(classifyLorebookReadError_ACU({ reason: 'Lorebook unavailable' })).toBe('unknown');
      expect(classifyLorebookReadError_ACU(undefined)).toBe('unknown');
      expect(classifyLorebookReadError_ACU(null)).toBe('unknown');
    });
  });
});


/**
 * strict-wrapped 错误分类：真实 readContext 路径的 StrictLorebookReadError 是唯一真实载体，
 * 顶层分类器必须直接识别 strict 结构，而不是退回 message 匹配。
 */
describe('classifyLorebookReadError_ACU with strict-wrapped errors', () => {
  function strictError(failedBooks: Array<{ bookName: string; errorCategory: string }>, status = 'read_failed'): Error {
    return Object.assign(new Error(`StrictLorebookRead:${status}`), {
      name: 'StrictLorebookReadError_ACU',
      status,
      source: 'agent_runtime',
      validationPolicy: 'trusted_direct',
      runId: 'run-1',
      failedBooks,
      invalidBookNames: [],
      staleBookNames: [],
    });
  }

  it('strict read_failed 且全部书级 not-found → lorebook_not_found', () => {
    const error = strictError([{ bookName: '旧书', errorCategory: 'lorebook_not_found' }]);
    expect(classifyLorebookReadError_ACU(error)).toBe('lorebook_not_found');
    expect(isLorebookReadNotFoundError_ACU(error)).toBe(true);
  });

  it('strict mixed not-found + unknown → unknown，不得误隔离', () => {
    const error = strictError([
      { bookName: '旧书', errorCategory: 'lorebook_not_found' },
      { bookName: '权限书', errorCategory: 'unknown' },
    ]);
    expect(classifyLorebookReadError_ACU(error)).toBe('unknown');
    expect(isLorebookReadNotFoundError_ACU(error)).toBe(false);
  });

  it('strict 全部 unknown → unknown', () => {
    const error = strictError([{ bookName: '权限书', errorCategory: 'unknown' }]);
    expect(classifyLorebookReadError_ACU(error)).toBe('unknown');
  });

  it('strict aborted → aborted，不得落为 unknown', () => {
    const error = strictError([], 'aborted');
    expect(classifyLorebookReadError_ACU(error)).toBe('aborted');
  });

  it('strict scope_changed → scope_changed，不得落为 unknown', () => {
    const error = strictError([], 'scope_changed');
    expect(classifyLorebookReadError_ACU(error)).toBe('scope_changed');
  });

  it('strict 安全摘要只输出白名单字段，不复制 message/stack', () => {
    const error = strictError([{ bookName: '旧书', errorCategory: 'lorebook_not_found' }]);
    const summary = summarizeLorebookRuntimeError_ACU(error);
    expect(summary).toMatchObject({
      category: 'strict_lorebook_read',
      status: 'read_failed',
      source: 'agent_runtime',
      validationPolicy: 'trusted_direct',
      runId: 'run-1',
      failedBookNames: ['旧书'],
      errorCategories: ['lorebook_not_found'],
    });
    expect(JSON.stringify(summary)).not.toContain('StrictLorebookRead:read_failed');
    expect(JSON.stringify(summary)).not.toContain('stack');
  });

  it('命名 host API 不可用错误 → api_unavailable', () => {
    const error = Object.assign(new Error('get_entries unavailable'), {
      name: 'WorldbookHostApiUnavailableError_ACU',
      operation: 'get_entries',
    });
    expect(classifyLorebookReadError_ACU(error)).toBe('api_unavailable');
    const summary = summarizeLorebookRuntimeError_ACU(error);
    expect(summary).toEqual({ category: 'api_unavailable', operation: 'get_entries' });
  });

  it('宿主读取诊断仅透传安全阶段和 HTTP 状态，不复制敏感载荷', () => {
    const error = Object.assign(new Error('敏感响应正文'), {
      name: 'WorldbookReadError_ACU', category: 'unknown', operation: '/api/worldinfo/list',
      reason: 'http', httpStatus: 403, responseBody: '敏感响应正文', token: '敏感凭据',
    });
    expect(summarizeLorebookRuntimeError_ACU(error)).toEqual({
      category: 'unknown', operation: '/api/worldinfo/list', reason: 'http', httpStatus: 403,
    });
  });

  it.each([
    { reason: '敏感响应正文', httpStatus: 99 },
    { reason: '敏感响应正文', httpStatus: 600 },
    { reason: '敏感响应正文', httpStatus: 403.5 },
  ])('拒绝任意原因文本和非法 HTTP 状态：%j', details => {
    expect(summarizeLorebookRuntimeError_ACU({ category: 'unknown', ...details })).toEqual({ category: 'unknown' });
  });


  it('已安全摘要对象规范化：不再次压缩为 unknown', () => {
    const safeSummary = {
      category: 'strict_lorebook_read',
      status: 'read_failed',
      source: 'agent_runtime',
      validationPolicy: 'trusted_direct',
      runId: 'run-1',
      failedCount: 1,
      failedBookNames: ['旧书'],
      errorCategories: ['lorebook_not_found'],
      invalidCount: 0,
      staleCount: 0,
    };
    const normalized = summarizeLorebookRuntimeError_ACU(safeSummary);
    expect(normalized).toEqual(safeSummary);
  });
});
