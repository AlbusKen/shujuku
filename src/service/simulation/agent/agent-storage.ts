import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import type { WorldSimulationAnchorIdentity_ACU, WorldSimulationRunResumeState_ACU } from './agent-model';
import { appendWorldSimulationDirectorHistory_ACU, readWorldSimulationDirectorCompactionSource_ACU, readWorldSimulationDirectorHistory_ACU, readWorldSimulationDirectorRunHistory_ACU, writeWorldSimulationConversationCompaction_ACU } from './agent-conversation-store';
import { clearWorldSimulationRunStateAtAnchor_ACU, persistWorldSimulationRunState_ACU, restoreWorldSimulationRunState_ACU } from './agent-run-state-store';

/** 每轮绑定完整存储来源；逻辑实现自行持有 FloorRef，不向主循环暴露物理写入坐标。 */
export interface WorldSimulationAgentStorage_ACU {
  readonly mode: 'host' | 'logical';
  readonly hasPersistentHistory: boolean;
  readonly canCompactHistory: boolean;
  readChat(): any[];
  restoreRunState(taskId: string, cursorKey: string): Promise<WorldSimulationRunResumeState_ACU | null>;
  persistRunState(state: WorldSimulationRunResumeState_ACU): Promise<void>;
  clearRunState(): Promise<void>;
  readDirectorHistory(): ReturnType<typeof readWorldSimulationDirectorHistory_ACU>;
  readDirectorRunHistory(runId: string): ReturnType<typeof readWorldSimulationDirectorRunHistory_ACU>;
  readCompactionSource(): ReturnType<typeof readWorldSimulationDirectorCompactionSource_ACU>;
  appendDirectorHistory(input: Omit<Parameters<typeof appendWorldSimulationDirectorHistory_ACU>[0], 'anchor'>): Promise<boolean>;
  writeCompaction(input: Omit<Parameters<typeof writeWorldSimulationConversationCompaction_ACU>[0], 'anchor'>): Promise<boolean>;
}

/** 普通模式保留既有楼层读写和无锚点调用语义。 */
export function createHostWorldSimulationAgentStorage_ACU(
  anchor?: WorldSimulationAnchorIdentity_ACU, chat?: any[],
): WorldSimulationAgentStorage_ACU {
  const readChat = () => chat ?? getChatArray_ACU();
  return {
    mode: 'host', hasPersistentHistory: !!anchor, canCompactHistory: !!anchor && !!chat,
    readChat,
    restoreRunState: (taskId, cursorKey) => anchor
      ? restoreWorldSimulationRunState_ACU(anchor, taskId, cursorKey, readChat()) : Promise.resolve(null),
    persistRunState: state => anchor
      ? persistWorldSimulationRunState_ACU(anchor, state, readChat()) : Promise.resolve(),
    clearRunState: () => clearWorldSimulationRunStateAtAnchor_ACU(anchor, readChat()),
    readDirectorHistory: () => readWorldSimulationDirectorHistory_ACU(readChat()),
    readDirectorRunHistory: runId => readWorldSimulationDirectorRunHistory_ACU(runId, readChat()),
    readCompactionSource: () => readWorldSimulationDirectorCompactionSource_ACU(readChat()),
    appendDirectorHistory: input => {
      if (!anchor) throw new Error('WORLD_SIMULATION_HISTORY_ANCHOR_REQUIRED');
      return appendWorldSimulationDirectorHistory_ACU({ ...input, anchor }, readChat());
    },
    writeCompaction: input => {
      if (!anchor) throw new Error('WORLD_SIMULATION_HISTORY_ANCHOR_REQUIRED');
      return writeWorldSimulationConversationCompaction_ACU({ ...input, anchor }, readChat());
    },
  };
}
