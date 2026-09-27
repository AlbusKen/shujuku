import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockChatTurn, mockResolvedPreset } = vi.hoisted(() => ({
  mockChatTurn: vi.fn(async () => ({ content: '', toolCalls: [] })),
  mockResolvedPreset: vi.fn(async () => 'plain'),
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  callAIChatTurn_ACU: mockChatTurn,
  callAIWithResolvedPreset_ACU: mockResolvedPreset,
}));

import { agentNativeTools_ACU } from '../../../src/service/ai/native-tool';
import { callContinuationInternalAi_ACU } from '../../../src/service/continuation/internal-ai-call';

const preset = {
  presetName: 'route-preset', source: 'fixed', reason: 'fixed_preset', apiMode: 'custom', tavernProfile: '',
  apiConfig: { url: 'https://api.example.com/v1', apiKey: 'redacted', model: 'gpt-test', useMainApi: false },
} as any;

const identity = {
  source: 'agent_subagent', requestId: 'routing-test', chatIdentity: 'chat/test', taskId: 'task', stageId: 'stage', revision: 1,
};

describe('continuation native tool routing', () => {
  beforeEach(() => { mockChatTurn.mockClear(); mockResolvedPreset.mockClear(); });

  it('带原生工具时走 chat-turn 路径并透传工具定义', async () => {
    const tools = agentNativeTools_ACU(['read', 'search']);
    await callContinuationInternalAi_ACU(
      [{ role: 'user', content: '读取资料' }], preset, identity, null, { tools },
    );

    expect(mockChatTurn).toHaveBeenCalledOnce();
    expect(mockResolvedPreset).not.toHaveBeenCalled();
    const extras = mockChatTurn.mock.calls[0]?.[4] as { tools?: unknown };
    expect(extras.tools).toEqual(tools);
    expect((extras.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name)).toEqual(['read', 'search']);
  });
});
