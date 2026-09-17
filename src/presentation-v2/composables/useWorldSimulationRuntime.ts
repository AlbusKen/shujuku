import { computed, getCurrentScope, onScopeDispose, ref } from 'vue';
import { buildDefaultWorldSimulationSettings_ACU } from '../../service/simulation/defaults';
import { exportWorldSimulationPrompts_ACU, importWorldSimulationPrompts_ACU, restoreWorldSimulationPromptDefault_ACU } from '../../service/simulation/agent/prompt-template';
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

export function useWorldSimulationRuntime() {
  const runtime = getWorldSimulationRuntime_ACU();
  const snapshot = ref<WorldSimulationUiSnapshot_ACU | null>(null);
  const ready = ref(false);
  const busy = ref(false);
  const error = ref('');
  const settingsDraft = ref<WorldSimulationSettings_ACU | null>(null);
  let subscribedChatIdentity: string | null = null;
  let unsubscribeSession: (() => void) | null = null;

  function refresh(): boolean {
    try {
      const next = runtime.readUiSnapshot();
      snapshot.value = next;
      settingsDraft.value = cloneSettings_ACU(next.envelope?.settings ?? buildDefaultWorldSimulationSettings_ACU());
      error.value = '';
      ready.value = true;
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
