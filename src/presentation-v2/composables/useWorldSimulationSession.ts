import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  clearWorldSimulationSessionLog_ACU,
  hasWorldSimulationSessionEntries_ACU,
  hydrateWorldSimulationSessionLog_ACU,
  isWorldSimulationSessionRunning_ACU,
  logWorldSimulationSession_ACU,
  readWorldSimulationSessionLog_ACU,
  subscribeWorldSimulationSessionLog_ACU,
  type WorldSimulationSessionEntry_ACU,
  type WorldSimulationSessionEventInput_ACU,
} from '../../service/simulation/world-simulation-agent-session-log';
import { readWorldSimulationConversationTimelineWithDiagnostics_ACU, type WorldSimulationConversationMessage_ACU } from '../../service/simulation/world-simulation-agent-conversation';

function projectMessage_ACU(message: WorldSimulationConversationMessage_ACU): WorldSimulationSessionEventInput_ACU {
  if (message.kind === 'user') return { kind: 'user_message', title: message.title, detail: message.detail };
  if (message.kind === 'delegation') return { kind: 'delegation', title: message.title, detail: message.detail, agentName: message.agentName };
  if (message.kind === 'error') return { kind: 'run_failed', title: message.title, detail: message.detail, ok: false };
  if (message.kind === 'commit') return { kind: 'run_completed', title: message.title, detail: message.detail };
  return { kind: 'main_action', title: message.title, detail: message.detail, agentName: message.agentName };
}

export function useWorldSimulationSession() {
  const entries = ref<WorldSimulationSessionEntry_ACU[]>(readWorldSimulationSessionLog_ACU());
  const running = ref(isWorldSimulationSessionRunning_ACU());
  const notice = ref('');
  let unsubscribe: (() => void) | null = null;
  function sync(): void { entries.value = readWorldSimulationSessionLog_ACU(); running.value = isWorldSimulationSessionRunning_ACU(); }
  function hydrate(): void {
    if (!hasWorldSimulationSessionEntries_ACU()) {
      const timeline = readWorldSimulationConversationTimelineWithDiagnostics_ACU();
      if (timeline.messages.length) hydrateWorldSimulationSessionLog_ACU(timeline.messages.map(projectMessage_ACU));
      notice.value = timeline.invalidMessageIndexes.length ? `已跳过 ${timeline.invalidMessageIndexes.length} 条损坏的非权威会话记录；原始数据未被改写。` : '';
    }
    sync();
  }
  function rehydrate(): void { clearWorldSimulationSessionLog_ACU(); hydrate(); }
  function resyncAfterChatMutation(): void {
    clearWorldSimulationSessionLog_ACU({ keepRunning: true });
    hydrate();
    if (hasWorldSimulationSessionEntries_ACU()) logWorldSimulationSession_ACU({ kind: 'main_action', title: '楼层已变化，会话已按现存楼层重新加载', detail: '被删除或重新生成楼层上的非权威审计记录已随 active swipe 回退。' });
    sync();
  }
  onMounted(() => { unsubscribe = subscribeWorldSimulationSessionLog_ACU(sync); hydrate(); });
  onBeforeUnmount(() => { unsubscribe?.(); unsubscribe = null; });
  return { entries, running, notice, hydrate, rehydrate, resyncAfterChatMutation };
}
