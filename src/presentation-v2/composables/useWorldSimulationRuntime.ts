import { computed, getCurrentScope, onScopeDispose, ref } from 'vue';
import { buildDefaultWorldSimulationSettings_ACU } from '../../service/simulation/defaults';
import { exportWorldSimulationPrompts_ACU, importWorldSimulationPrompts_ACU, restoreWorldSimulationPromptDefault_ACU } from '../../service/simulation/agent/prompt-template';
import {
  WORLD_SIMULATION_SESSION_EVENT_KINDS_ACU,
  hydrateWorldSimulationSessionLog_ACU,
  isWorldSimulationSessionRunning_ACU,
  type WorldSimulationSessionInput_ACU,
} from '../../service/simulation/agent/agent-session-log';
import { subscribeWorldSimulationSessionLog_ACU } from '../../service/simulation/agent/agent-session-log';
import { getWorldSimulationRuntime_ACU, type WorldSimulationUiSnapshot_ACU } from '../../service/simulation/simulation-runtime';
import { WorldSimulationValidationError_ACU, type WorldSimulationSettings_ACU } from '../../service/simulation/model';

function messageOf(error: unknown): string {
  if (error instanceof WorldSimulationValidationError_ACU) return `${error.error.code}: ${error.error.message}`;
  return error instanceof Error ? error.message : '世界推演操作失败';
}

function cloneSettings_ACU(settings: WorldSimulationSettings_ACU): WorldSimulationSettings_ACU {
  return JSON.parse(JSON.stringify(settings)) as WorldSimulationSettings_ACU;
}

export function projectWorldSimulationSessionFromConversation_ACU(
  messages: WorldSimulationUiSnapshot_ACU['conversation']['messages'],
): WorldSimulationSessionInput_ACU[] {
  return messages
    .filter(message => message.kind !== 'handoff')
    .map(message => {
      const persistedKind = typeof message.eventKind === 'string'
        && (WORLD_SIMULATION_SESSION_EVENT_KINDS_ACU as readonly string[]).includes(message.eventKind)
        ? message.eventKind as WorldSimulationSessionInput_ACU['kind']
        : null;
      const fallbackKind: WorldSimulationSessionInput_ACU['kind'] = message.kind === 'user'
        ? 'user_message'
        : message.kind === 'turn'
          ? 'run_started'
          : message.kind === 'agent'
            ? 'main_action'
            : message.kind === 'runtime'
              ? 'thought'
              : 'tool_read';
      return {
        kind: persistedKind ?? fallbackKind,
        title: message.title || message.digest || (message.kind === 'user' ? '你的消息' : '历史会话'),
        detail: message.text,
        agentName: message.agentName,
        ok: message.ok,
        status: message.status,
        at: message.at,
      } satisfies WorldSimulationSessionInput_ACU;
    });
}

export function useWorldSimulationRuntime() {
  const runtime = getWorldSimulationRuntime_ACU();
  const snapshot = ref<WorldSimulationUiSnapshot_ACU | null>(null);
  const ready = ref(false);
  const busy = ref(false);
  const error = ref('');
  const settingsDraft = ref<WorldSimulationSettings_ACU | null>(null);
  let subscribedChatIdentity: string | null = null;
  let unsubscribeSession: (() => void) | null = null;

  /**
   * 从持久会话回灌会话流历史（与 useContinuationSession.hydrate 同语义）：
   * 会话流是内存态，脚本重载后为空；持久会话锚定在楼层上，是权威历史。
   * 只在会话流为空且 Agent 未在运行时回灌，避免覆盖实时通道与运行标记。
   */
  function hydrateSessionFromConversation(next: WorldSimulationUiSnapshot_ACU): void {
    const chatIdentity = next.session.chatIdentity;
    if (!chatIdentity || next.session.entries.length || isWorldSimulationSessionRunning_ACU(chatIdentity)) return;
    const projected = projectWorldSimulationSessionFromConversation_ACU(next.conversation.messages);
    if (projected.length) hydrateWorldSimulationSessionLog_ACU(chatIdentity, projected);
  }

  function refresh(): boolean {
    try {
      const next = runtime.readUiSnapshot();
      snapshot.value = next;
      settingsDraft.value = cloneSettings_ACU(next.envelope?.settings ?? buildDefaultWorldSimulationSettings_ACU());
      error.value = '';
      ready.value = true;
      hydrateSessionFromConversation(next);
      if (next.session.chatIdentity !== subscribedChatIdentity) {
        unsubscribeSession?.();
        subscribedChatIdentity = next.session.chatIdentity;
        unsubscribeSession = subscribedChatIdentity
          ? subscribeWorldSimulationSessionLog_ACU(subscribedChatIdentity, () => { if (ready.value) refresh(); })
          : null;
      }
      return true;
    } catch (cause) {
      snapshot.value = null;
      settingsDraft.value = null;
      error.value = messageOf(cause);
      ready.value = false;
      return false;
    }
  }

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    error.value = '';
    try { await action(); refresh(); return true; }
    catch (cause) { error.value = messageOf(cause); return false; }
    finally { busy.value = false; }
  }

  if (getCurrentScope()) onScopeDispose(() => unsubscribeSession?.());

  return {
    snapshot, ready, busy, error, settingsDraft,
    envelope: computed(() => snapshot.value?.envelope ?? null),
    task: computed(() => snapshot.value?.envelope?.task ?? null),
    activeStage: computed(() => { const e = snapshot.value?.envelope; return e?.stages.find(stage => stage.stageId === e.activeStageId) ?? null; }),
    activeRevision: computed(() => { const e = snapshot.value?.envelope; const s = e?.stages.find(stage => stage.stageId === e.activeStageId); return s?.revisions.find(item => item.revision === s.activeRevision) ?? null; }),
    refresh,
    send: (text: string) => run(() => runtime.sendAgentMessage(text)),
    resume: () => run(() => runtime.resume()),
    cancel: () => runtime.cancel(),
    saveSettings: () => settingsDraft.value ? run(() => runtime.saveSettings(cloneSettings_ACU(settingsDraft.value!))) : Promise.resolve(false),
    exportPrompts: () => settingsDraft.value ? exportWorldSimulationPrompts_ACU(settingsDraft.value.agentPrompts) : '',
    importPrompts: (text: string) => { if (!settingsDraft.value) return false; try { settingsDraft.value.agentPrompts = importWorldSimulationPrompts_ACU(text); error.value = ''; return true; } catch (cause) { error.value = messageOf(cause); return false; } },
    restorePrompt: (name: string) => { if (settingsDraft.value) settingsDraft.value = restoreWorldSimulationPromptDefault_ACU(settingsDraft.value, name as never); },
  };
}
