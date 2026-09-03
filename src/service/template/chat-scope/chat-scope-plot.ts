/**
 * service/template/chat-scope/chat-scope-plot.ts — Plot Scope 管理
 * 从 chat-scope.ts 拆出的 A 组：剧情作用域的读取、构建、设置、清除
 */
import { cloneScopedConfigData_ACU, getChatFirstLayerMessage_ACU } from '../../../shared/utils';
import { ensurePlotPromptsArray_ACU, ensurePlotTasksCompat_ACU, getPlotFinalDirectiveFromSource_ACU, normalizePlotPresetSelectionValue_ACU, setPlotPromptContentByIdForSettings_ACU, stripPlotTaskRuntimeApiPresetFields_ACU } from '../../plot/plot-logic';
import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import { CHAT_SCOPED_CONFIG_FIELD_ACU, getChatScopedConfigContainer_ACU, normalizeChatScopedConfigContainer_ACU } from '../../../data/storage/chat-history';
import { stripLegacyLoopPromptFieldsInPlace_ACU } from '../../../shared/legacy-loop-fields';
import { normalizeChatScopedConfigSource_ACU } from './chat-scope-base';

  function normalizePlotScopeMode_ACU(mode: any) {
      return mode === 'chat_override' ? 'chat_override' : 'inherit_global';
  }

  export function sanitizePlotSettingsSnapshotForChat_ACU(plotSettings: any) {
      if (!plotSettings || typeof plotSettings !== 'object') return null;
      const snapshot = cloneScopedConfigData_ACU(plotSettings, null);
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;

      delete snapshot.promptPresets;
      delete snapshot.lastUsedPresetName;
      delete snapshot.enabled;
      // 剧情世界书选择以角色卡为单位持久化（plotWorldbookConfigByCharacter），不进聊天快照。
      delete snapshot.plotWorldbookConfig;
      stripLegacyLoopPromptFieldsInPlace_ACU(snapshot);

      ensurePlotPromptsArray_ACU(snapshot);
      ensurePlotTasksCompat_ACU(snapshot, { syncLegacy: true });
      snapshot.plotTasks = stripPlotTaskRuntimeApiPresetFields_ACU(snapshot.plotTasks);
      snapshot.finalSystemDirective = getPlotFinalDirectiveFromSource_ACU(snapshot);
      setPlotPromptContentByIdForSettings_ACU(snapshot, 'finalSystemDirective', snapshot.finalSystemDirective || '');
      return snapshot;
  }

  function normalizeChatPlotScopeState_ACU(rawState: any) {
      const state = (rawState && typeof rawState === 'object' && !Array.isArray(rawState)) ? rawState : {};
      const snapshot = sanitizePlotSettingsSnapshotForChat_ACU(state.snapshot);
      return {
          mode: normalizePlotScopeMode_ACU(state.mode),
          presetName: normalizePlotPresetSelectionValue_ACU(state.presetName || ''),
          snapshot,
          originGlobalName: normalizePlotPresetSelectionValue_ACU(state.originGlobalName || ''),
          originGlobalRevision: Number.isFinite(state.originGlobalRevision) ? Math.max(0, Math.trunc(state.originGlobalRevision)) : 0,
          updatedAt: Number.isFinite(state.updatedAt) ? state.updatedAt : 0,
          source: normalizeChatScopedConfigSource_ACU(state.source, 'inherit'),
      };
  }

  export function getCurrentChatPlotScopeState_ACU(chat = getChatArray_ACU()) {
      const container = getChatScopedConfigContainer_ACU(chat);
      const rawState = container?.plot;
      if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return null;

      const normalizedState = normalizeChatPlotScopeState_ACU(rawState);
      if (normalizedState.mode !== 'chat_override' || !normalizedState.snapshot) {
          return null;
      }
      return normalizedState;
  }

  export function buildChatPlotScopeStateFromSettings_ACU(plotSettings: any, { presetName = '', source = 'ui', originGlobalName = '', originGlobalRevision = 0, updatedAt = Date.now() } = {}) {
      const snapshot = sanitizePlotSettingsSnapshotForChat_ACU(plotSettings);
      if (!snapshot) return null;

      return normalizeChatPlotScopeState_ACU({
          mode: 'chat_override',
          presetName,
          snapshot,
          originGlobalName,
          originGlobalRevision,
          updatedAt,
          source,
      });
  }

  export function setCurrentChatPlotScopeState_ACU(plotState: any, { reason = '' } = {}) {
      const chat = getChatArray_ACU();
      const first = getChatFirstLayerMessage_ACU(chat);
      if (!first) return null;

      const container = normalizeChatScopedConfigContainer_ACU(getChatScopedConfigContainer_ACU(chat));
      const normalizedState = normalizeChatPlotScopeState_ACU(plotState);

      if (normalizedState.mode === 'chat_override' && normalizedState.snapshot) {
          container.plot = {
              ...normalizedState,
              reason: String(reason || ''),
          };
      } else {
          delete container.plot;
      }

      const hasPayload = Object.keys(container).some(key => key !== 'version');
      if (hasPayload) {
          first[CHAT_SCOPED_CONFIG_FIELD_ACU] = container;
      } else {
          delete first[CHAT_SCOPED_CONFIG_FIELD_ACU];
      }

      return getCurrentChatPlotScopeState_ACU(chat);
  }

  export function clearCurrentChatPlotScopeState_ACU() {
      return setCurrentChatPlotScopeState_ACU({ mode: 'inherit_global' }, { reason: 'clear_plot_override' });
  }
