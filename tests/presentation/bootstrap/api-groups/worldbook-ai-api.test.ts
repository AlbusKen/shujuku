/**
 * tests/presentation/bootstrap/api-groups/worldbook-ai-api.test.ts
 * worldbook-ai-api callAI 参数透传测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallAIWithPreset, mockSettings } = vi.hoisted(() => ({
  mockCallAIWithPreset: vi.fn(),
  mockSettings: { streamingEnabled: false, tavernProfile: 'default' } as any,
}));

vi.mock('../../../../src/service/ai/api-call', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/service/ai/api-call')>();
  return {
    ...actual,
    callAIWithPreset_ACU: mockCallAIWithPreset,
  };
});
vi.mock('../../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentJsonTableData_ACU: null,
}));
vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));
vi.mock('../../../../src/shared/env', () => ({ topLevelWindow_ACU: {} }));
vi.mock('../../../../src/service/chat/chat-service', () => ({ getChatArray_ACU: vi.fn() }));
vi.mock('../../../../src/service/settings/settings-service', () => ({ setZeroTkOccupyMode_ACU: vi.fn() }));
vi.mock('../../../../src/service/worldbook/pipeline', () => ({ deleteAllGeneratedEntries_ACU: vi.fn(), updateReadableLorebookEntry_ACU: vi.fn() }));
vi.mock('../../../../src/service/worldbook/injection-engine', () => ({ updateOutlineTableEntry_ACU: vi.fn() }));
vi.mock('../../../../src/service/runtime/helpers-remaining', () => ({ formatJsonToReadable_ACU: vi.fn() }));
vi.mock('../../../../src/service/optimization/content-optimization', () => ({ cancelContentOptimization_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/components/optimization-ui', () => ({ reoptimizeMessage_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshMergedDataAndNotifyWithUI_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));

import { createWorldbookAiApi } from '../../../../src/presentation/bootstrap/api-groups/worldbook-ai-api';
import { ApiPresetUnresolvedError_ACU } from '../../../../src/service/ai/api-call';

beforeEach(() => {
  vi.clearAllMocks();
  mockCallAIWithPreset.mockResolvedValue('AI reply');
});

describe('callAI 委托与输入边界', () => {
  it('使用默认 preset 和未指定的 max tokens 委托 service 层', async () => {
    const api = createWorldbookAiApi({} as any);
    const messages = [{ role: 'user', content: 'hello' }];

    await expect(api.callAI(messages)).resolves.toBe('AI reply');
    expect(mockCallAIWithPreset).toHaveBeenCalledWith(messages, '', undefined);
  });

  it('保留 presetName 并透传 max_tokens=0', async () => {
    const api = createWorldbookAiApi({} as any);
    const messages = [{ role: 'user', content: 'hello' }];

    await api.callAI(messages, { presetName: ' preset-A ', max_tokens: 0 });
    expect(mockCallAIWithPreset).toHaveBeenCalledWith(messages, 'preset-A', 0);
  });

  it('接受 maxTokens 驼峰别名', async () => {
    const api = createWorldbookAiApi({} as any);
    const messages = [{ role: 'user', content: 'hello' }];

    await api.callAI(messages, { maxTokens: 0 });
    expect(mockCallAIWithPreset).toHaveBeenCalledWith(messages, '', 0);
  });

  it('拒绝空消息而不调用 service 层', async () => {
    const api = createWorldbookAiApi({} as any);
    await expect(api.callAI([])).resolves.toBeNull();
    expect(mockCallAIWithPreset).not.toHaveBeenCalled();
  });

  it.each(['apiConfig', 'apiKey', 'url', 'requestHeaders', 'temperature', 'stream'])('拒绝禁止字段 %s', async forbiddenKey => {
    const api = createWorldbookAiApi({} as any);
    await expect(api.callAI([{ role: 'user', content: 'hello' }], { [forbiddenKey]: 'unsafe' })).resolves.toBeNull();
    expect(mockCallAIWithPreset).not.toHaveBeenCalled();
  });

  it('service 层抛错时返回 null', async () => {
    mockCallAIWithPreset.mockRejectedValue(new Error('upstream failure'));
    const api = createWorldbookAiApi({} as any);
    await expect(api.callAI([{ role: 'user', content: 'hello' }])).resolves.toBeNull();
  });

  it('悬挂预设错误重新抛出，不吞成 null', async () => {
    mockCallAIWithPreset.mockRejectedValue(new ApiPresetUnresolvedError_ACU('ghost'));
    const api = createWorldbookAiApi({} as any);
    await expect(api.callAI([{ role: 'user', content: 'hello' }], { presetName: 'ghost' }))
      .rejects.toBeInstanceOf(ApiPresetUnresolvedError_ACU);
  });
});
