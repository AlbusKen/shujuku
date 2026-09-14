import {
  parseOptionalAgentRequirementSnapshot_ACU,
  replaceAgentRequirementsSnapshot_ACU,
} from '../agent-kernel/requirements-store';
import type {
  AgentRequirementSnapshot_ACU,
} from '../agent-kernel/requirements';
import { readAgentConversationTimeline_ACU } from './agent/agent-conversation-store';
import { FirstFloorContinuationStore_ACU } from './continuation-store';

export const CONTINUATION_REQUIREMENT_SOURCE_PREFIX_ACU = 'continuation-user:';

export function continuationRequirementSourceId_ACU(conversationId: number): string {
  if (!Number.isInteger(conversationId) || conversationId < 1) throw new Error('CONTINUATION_REQUIREMENTS_INVALID: 用户会话 id 非法');
  return `${CONTINUATION_REQUIREMENT_SOURCE_PREFIX_ACU}${conversationId}`;
}

/** Requirements are intentionally independent from the continuation envelope and task lifecycle. */
export class ContinuationRequirementsStore_ACU {
  constructor(
    private readonly store: FirstFloorContinuationStore_ACU = new FirstFloorContinuationStore_ACU(),
    private readonly readConversation: () => ReturnType<typeof readAgentConversationTimeline_ACU> = () => readAgentConversationTimeline_ACU(),
  ) {}

  read(): AgentRequirementSnapshot_ACU | null {
    return parseOptionalAgentRequirementSnapshot_ACU(this.store.readRequirementsSidecar(), 'continuation');
  }

  userSourceIds(): string[] {
    return this.readConversation()
      .filter(message => message.kind === 'user')
      .map(message => continuationRequirementSourceId_ACU(message.id));
  }

  pendingSourceIds(): string[] {
    const sourceIds = this.userSourceIds();
    const last = this.read()?.lastAppliedUserMessageId;
    if (last === null || last === undefined) return sourceIds;
    const position = sourceIds.indexOf(last);
    if (position < 0) throw new Error('CONTINUATION_REQUIREMENTS_CONFLICT: 最近已吸收用户消息不在当前会话');
    return sourceIds.slice(position + 1);
  }

  async replace(rawReplacement: unknown): Promise<AgentRequirementSnapshot_ACU> {
    let next: AgentRequirementSnapshot_ACU | null = null;
    const sourceIds = this.userSourceIds();
    await this.store.updateRequirementsSidecarAtomically(current => {
      next = replaceAgentRequirementsSnapshot_ACU(
        parseOptionalAgentRequirementSnapshot_ACU(current, 'continuation'),
        'continuation',
        rawReplacement,
        sourceIds,
      );
      return next;
    });
    if (!next) throw new Error('CONTINUATION_REQUIREMENTS_INVALID: 要求资料替换未产生快照');
    return next;
  }
}