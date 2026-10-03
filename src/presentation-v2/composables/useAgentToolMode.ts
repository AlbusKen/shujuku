import { computed, getCurrentScope, onScopeDispose, shallowRef } from 'vue';
import { settings_ACU } from '../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import { getNoticeHubSnapshot_ACU, notifyNoticeSettingsChanged_ACU, subscribeNoticeHub_ACU } from '../../shared/notice-hub';
import type { AgentToolModeFeature_ACU, AgentToolMode_ACU } from '../../service/ai/agent-tool-mode';
import { useToastStore } from '../stores/toast-store';

/** 全局协议开关的响应式投影；不读写对话信封，也不在初始化时保存。 */
export function useAgentToolMode(feature: AgentToolModeFeature_ACU) {
  const toast = useToastStore();
  const snapshot = shallowRef(getNoticeHubSnapshot_ACU());
  const unsubscribe = subscribeNoticeHub_ACU(() => { snapshot.value = getNoticeHubSnapshot_ACU(); });
  if (getCurrentScope()) onScopeDispose(unsubscribe);
  const key = feature === 'continuation' ? 'continuationNativeToolEnabled' : 'worldSimulationNativeToolEnabled';
  const enabled = computed(() => {
    void snapshot.value.settingsVersion;
    return settings_ACU[key] === true;
  });
  const mode = computed<AgentToolMode_ACU>(() => enabled.value ? 'tools' : 'json');

  function setEnabled(value: boolean): void {
    const previous = settings_ACU[key];
    settings_ACU[key] = value === true;
    const result = saveSettings_ACU();
    if (!result.saved) {
      settings_ACU[key] = previous;
      toast.error(result.error || result.warning || '工具调用开关保存失败。');
    } else if (result.warning) toast.warning(result.warning);
    notifyNoticeSettingsChanged_ACU();
  }
  return { enabled, mode, setEnabled };
}
