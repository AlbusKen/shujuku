import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  clearAgentSessionLog_ACU,
  hasAgentSessionEntries_ACU,
  hydrateAgentSessionLog_ACU,
  isAgentSessionRunning_ACU,
  logAgentSession_ACU,
  readAgentSessionLog_ACU,
  subscribeAgentSessionLog_ACU,
  type AgentSessionEntry_ACU,
  type AgentSessionEventInput_ACU,
} from '../../service/continuation/agent/agent-session-log';
import { readAgentConversationTimeline_ACU } from '../../service/continuation/agent/agent-conversation-store';
import type { AgentConversationMessage_ACU } from '../../service/continuation/agent/agent-model';

/**
 * 把一条持久会话消息映射成会话流条目。
 *
 * 会话流是展示通道，持久会话是模型通道，两者字段不同源：这里只做单向投影，
 * 让页面重载后仍能看到既往对话，而不是把持久会话当成 UI 状态直接渲染。
 * @param message 持久会话消息
 * @returns 会话流条目输入
 */
function projectMessage_ACU(message: AgentConversationMessage_ACU): AgentSessionEventInput_ACU {
  if (message.kind === 'user') return { kind: 'user_message', title: message.digest || '你的消息', detail: message.text };
  if (message.kind === 'turn') return { kind: 'run_started', title: message.digest || '新的一轮', detail: message.text };
  if (message.kind === 'handoff') return { kind: 'handoff', title: message.digest || '早期会话交接报告', detail: message.text };
  if (message.kind === 'tool') return { kind: 'delegation', title: message.digest || '运行时结果', detail: message.text };
  if (message.kind === 'runtime') return { kind: 'delegation', title: message.digest || '运行时快照', detail: message.text };
  return { kind: 'main_action', title: message.digest || '主 Agent 输出', detail: message.text };
}

/**
 * 订阅智能续写 Agent 的会话日志。
 *
 * 挂载时若会话流为空，先从楼层锚定的持久会话回灌历史；随后订阅内存事件通道实时更新。
 * 组件卸载时自动退订。
 */
export function useContinuationSession() {
  const entries = ref<AgentSessionEntry_ACU[]>(readAgentSessionLog_ACU());
  const running = ref(isAgentSessionRunning_ACU());
  let unsubscribe: (() => void) | null = null;

  function sync(): void {
    entries.value = readAgentSessionLog_ACU();
    running.value = isAgentSessionRunning_ACU();
  }

  /**
   * 从持久会话回灌历史条目。切换聊天后也应调用：不同聊天的会话记录互不相干。
   * 回灌用完整时间线而不是模型投影视图：压缩不删原始消息，用户在界面上仍能
   * 回看交接文件之前的历史；交接文件本身按发生位置插在时间线里。
   * 读取失败不影响页面可用性——回灌只是历史展示，实时通道仍然工作。
   */
  function hydrate(): void {
    if (hasAgentSessionEntries_ACU()) return;
    try {
      const timeline = readAgentConversationTimeline_ACU();
      if (timeline.length) hydrateAgentSessionLog_ACU(timeline.map(projectMessage_ACU));
    } catch { /* 持久会话不可读时保持空会话流，实时事件仍会显示。 */ }
    sync();
  }

  /**
   * 切换聊天后调用：会话流是全局内存，不清空就会把上一个聊天的记录带进当前聊天。
   * 先清空再从当前聊天的持久会话重新回灌。
   */
  function rehydrate(): void {
    clearAgentSessionLog_ACU();
    hydrate();
  }

  /**
   * 当前聊天内楼层被删除 / swipe 后调用。持久会话按楼层分段存储，删楼即回退；
   * 但会话流是内存日志，不重灌就会一直显示已被删掉那几楼上的记录，看起来像"没有跟着回退"。
   * 与 rehydrate 的区别：运行标记保留——楼层变动时 Agent 循环可能仍在跑，不能把「停止」切回「发送」。
   * 回灌后追加一条说明，让用户知道界面是按现存楼层重新加载的，而不是记录凭空消失。
   */
  function resyncAfterChatMutation(): void {
    clearAgentSessionLog_ACU({ keepRunning: true });
    hydrate();
    if (hasAgentSessionEntries_ACU()) {
      logAgentSession_ACU({
        kind: 'thought',
        title: '楼层已变化，会话已按现存楼层重新加载',
        detail: '被删除或重新生成的楼层上的 Agent 记录已随楼层一起回退；阶段进度也按仍存在的正文楼层重算。',
      });
    }
    sync();
  }

  onMounted(() => {
    unsubscribe = subscribeAgentSessionLog_ACU(sync);
    hydrate();
    sync();
  });
  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return { entries, running, hydrate, rehydrate, resyncAfterChatMutation };
}
