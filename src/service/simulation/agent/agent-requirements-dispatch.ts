/**
 * service/simulation/agent/agent-requirements-dispatch.ts — 主会话历史压缩（fail-closed 落标记）
 *
 * 用户要求清单不再由 AI 维护（requirements-maintainer 已退役，改由用户在资料面板手动维护）；
 * 本模块只保留压缩标记的写入与提示词上下文里的历史视图刷新。
 */

import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import type { WorldSimulationSettings_ACU } from '../model';
import { readWorldSimulationConversation_ACU, writeWorldSimulationConversationCompaction_ACU } from './agent-conversation-store';
import { planWorldSimulationHistoryCompaction_ACU } from './agent-history-compactor';
import type { WorldSimulationAnchorIdentity_ACU } from './agent-model';
import type { WorldSimulationPlaceholderContext_ACU } from './agent-placeholder-resolver';
import { countWorldSimulationTokens_ACU } from './agent-token-budget';

export async function compactWorldSimulationConversation_ACU(input: {
  anchor: WorldSimulationAnchorIdentity_ACU;
  settings: WorldSimulationSettings_ACU;
  promptContext: WorldSimulationPlaceholderContext_ACU;
  chat?: any[];
}): Promise<void> {
  const trigger = input.settings.agentHistoryTokenBudget;
  if (!Number.isFinite(trigger) || trigger <= 0) return;
  const messages = Array.isArray(input.chat) ? input.chat : getChatArray_ACU();
  const view = readWorldSimulationConversation_ACU(messages);
  const planned = await planWorldSimulationHistoryCompaction_ACU({
    view,
    triggerTokens: trigger,
    fixedPromptTokens: 0,
    countTokens: countWorldSimulationTokens_ACU,
  });
  if (!planned.mark) return;
  const persisted = await writeWorldSimulationConversationCompaction_ACU({
    anchor: input.anchor,
    compaction: planned.mark,
  }, messages);
  if (!persisted) return;
  input.promptContext.history = readWorldSimulationConversation_ACU(messages);
}
