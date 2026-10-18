import { describe, expect, it, vi } from 'vitest';

const { mockCharacterId, mockIsolationKey, mockChatId } = vi.hoisted(() => ({
  mockCharacterId: vi.fn(),
  mockIsolationKey: vi.fn(),
  mockChatId: { value: 'chat-1' },
}));

vi.mock('../../../../src/data/gateways/host-state-gateway', () => ({
  getCurrentCharacterId_ACU: mockCharacterId,
}));

vi.mock('../../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mockChatId.value; },
  getCurrentIsolationKey_ACU: mockIsolationKey,
}));

import {
  capturePlotRuntimeScope_ACU,
  isSamePlotRuntimeScope_ACU,
  isTransientLorebookNotFoundError_ACU,
  normalizeLorebookNames_ACU,
  summarizePlotRuntimeError_ACU,
} from '../../../../src/service/runtime/plot-runtime/plot-runtime-scope';

describe('plot-runtime-scope', () => {
  it('角色世界书名称保留原值，只过滤空白并按精确身份去重', () => {
    expect(normalizeLorebookNames_ACU({
      primary: ' Sakura - Neglected Roommate ',
      additional: ['外部导入-', 'Sakura - Neglected Roommate', '  红莉栖の世界书  ', 1, '', null],
    })).toEqual([' Sakura - Neglected Roommate ', '外部导入-', 'Sakura - Neglected Roommate', '  红莉栖の世界书  ']);
  });

  it('unknown_chat_init 不构成可靠 scope，隔离为空仍是合法值', () => {
    mockChatId.value = 'unknown_chat_init';
    mockCharacterId.mockReturnValue('0');
    mockIsolationKey.mockReturnValue('');
    expect(capturePlotRuntimeScope_ACU()).toEqual({ chatId: null, characterId: '0', isolationKey: '', reliable: false });
  });

  it('仅可靠且 chat、character、isolation 三维均相同才视为同 scope', () => {
    const base = { chatId: 'chat-1', characterId: '0', isolationKey: '', reliable: true };
    expect(isSamePlotRuntimeScope_ACU(base, { ...base })).toBe(true);
    expect(isSamePlotRuntimeScope_ACU(base, { ...base, isolationKey: 'isolated' })).toBe(false);
    expect(isSamePlotRuntimeScope_ACU(base, { ...base, characterId: '1' })).toBe(false);
    expect(isSamePlotRuntimeScope_ACU(base, { ...base, reliable: false })).toBe(false);
  });

  it('仅识别明确的世界书未找到错误，AbortError 与无关错误不匹配', () => {
    expect(isTransientLorebookNotFoundError_ACU(new Error("未能找到世界书 'Sakura - Neglected Roommate'"))).toBe(true);
    expect(isTransientLorebookNotFoundError_ACU(new Error('Lorebook does not exist'))).toBe(true);
    expect(isTransientLorebookNotFoundError_ACU(new DOMException('aborted', 'AbortError'))).toBe(false);
    expect(isTransientLorebookNotFoundError_ACU(new Error('permission denied'))).toBe(false);
  });

  it('错误摘要只保留固定分类，不复制宿主错误正文或堆栈', () => {
    const sensitiveText = '用户输入、提示词和世界书正文都不能出现在诊断中';
    const error = new Error(sensitiveText);
    error.stack = `Error: ${sensitiveText}\n  at host`;

    const summary = summarizePlotRuntimeError_ACU(error);
    expect(summary).toEqual({ category: 'unknown' });
    expect(JSON.stringify(summary)).not.toContain(sensitiveText);
  });
});

  it('preflight 阶段错误摘要透传保留 phase/subphase/category 与 strict 白名单字段，不复制宿主正文/堆栈', () => {
    const sensitiveText = '宿主的真实错误正文、用户输入、提示词、世界书正文'; // 不应出现在任何摘要中
    const strictCause = Object.assign(new Error(`StrictLorebookRead:read_failed: ${sensitiveText}`), {
      name: 'StrictLorebookReadError_ACU',
      status: 'read_failed',
      source: 'agent_runtime',
      validationPolicy: 'trusted_direct',
      runId: 'run-preflight-1',
      failedBooks: [{ bookName: '世界书A', errorCategory: 'api_unavailable' }],
      invalidBookNames: [],
      staleBookNames: ['已删除世界书'],
    });
    const stageError = Object.assign(new Error('stage failed'), {
      name: 'PlotStageError_ACU',
      phase: 'clear_final_generation_greenlights',
      cause: { category: 'strict_lorebook_read', status: 'read_failed', source: 'agent_runtime', validationPolicy: 'trusted_direct', runId: 'run-preflight-1', failedCount: 1, failedBookNames: ['世界书A'], errorCategories: ['api_unavailable'], staleCount: 1, staleBookNames: ['已删除世界书'] },
    });

    const summary = summarizePlotRuntimeError_ACU(stageError);
    expect(summary).toEqual({
      category: 'stage',
      phase: 'clear_final_generation_greenlights',
      cause: {
        category: 'strict_lorebook_read',
        status: 'read_failed',
        source: 'agent_runtime',
        validationPolicy: 'trusted_direct',
        runId: 'run-preflight-1',
        failedCount: 1,
        failedBookNames: ['世界书A'],
        errorCategories: ['api_unavailable'],
        staleCount: 1,
        staleBookNames: ['已删除世界书'],
      },
    });
    // 白名单之外的任何字段（message/stack/宿主正文）一律不进摘要。
    expect(JSON.stringify(summary)).not.toContain(sensitiveText);
    expect(JSON.stringify(summary)).not.toContain('StrictLorebookRead:read_failed');
    expect(JSON.stringify(summary)).not.toContain('stack');
    expect(JSON.stringify(summary)).not.toContain('用户输入');
  });

