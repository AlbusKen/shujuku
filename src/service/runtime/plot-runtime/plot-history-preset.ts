/**
 * service/runtime/plot-runtime/plot-history-preset.ts
 * 剧情推进 — 预设加载/迁移 + 历史记录读写
 * 从 helpers-plot-runtime.ts 拆出（L1024-L1400）
 */
import { currentPlotTaskEditorId_ACU, _set_currentPlotTaskEditorId_ACU } from '../../plot/plot-state';
import { currentChatFileIdentifier_ACU, planningGuard_ACU, settings_ACU, tempPlotToSave_ACU, _set_tempPlotToSave_ACU } from '../state-manager';
import { getChatArray_ACU, saveChatToHost_ACU, saveChatToHostStrict_ACU } from '../../../data/gateways/chat-gateway';
import { saveSettings_ACU } from '../../settings/settings-service';
import { clearCurrentChatPlotScopeState_ACU, getCurrentChatPlotScopeState_ACU } from '../../template/chat-scope';
import { hashUserInput_ACU, logDebug_ACU, logWarn_ACU } from '../../../shared/utils';
import { applyPlotPresetToSettings_ACU, clearPlotPresetBindingForChat_ACU, ensurePlotPresetBindingsStore_ACU, ensurePlotTasksCompat_ACU, findPlotPresetByName_ACU, getCurrentRuntimePlotPresetName_ACU, getPlotPresetBindingForChat_ACU, isDefaultPlotPresetSelection_ACU, normalizePlotPresetSelectionValue_ACU, replaceCurrentPlotSettingsWithSnapshot_ACU, resetPlotSettingsToDefault_ACU, setPlotPresetBindingForChat_ACU, syncCurrentEditablePlotPresetState_ACU } from '../../plot/plot-logic';

  /**
   * 加载上次使用的预设到全局设置，并清除当前角色卡上冲突的陈旧设置。
   */
  export async function loadPresetAndCleanCharacterData_ACU() {
    const plotSettings = settings_ACU.plotSettings;
    if (!plotSettings) return;

    ensurePlotTasksCompat_ACU(plotSettings, { syncLegacy: true });
    ensurePlotPresetBindingsStore_ACU();

    const chatScopeState = getCurrentChatPlotScopeState_ACU();
    if (chatScopeState?.snapshot) {
      const snapshotPresetName = normalizePlotPresetSelectionValue_ACU(chatScopeState.presetName || '');
      const linkedPreset = snapshotPresetName ? findPlotPresetByName_ACU(snapshotPresetName) : null;
      if (linkedPreset) {
        logDebug_ACU(`[剧情推进] Migrating chat override snapshot to preset link for chat "${currentChatFileIdentifier_ACU || 'unknown'}": "${snapshotPresetName}".`);
        applyPlotPresetToSettings_ACU(plotSettings, linkedPreset);
        setPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU, linkedPreset.name, {
          source: 'migrate_chat_snapshot_link',
          isExplicit: true,
        });
        clearCurrentChatPlotScopeState_ACU();
        _set_currentPlotTaskEditorId_ACU('');
        syncCurrentEditablePlotPresetState_ACU({ source: 'migrate_chat_snapshot_link' });
        saveSettings_ACU();

        try {
          await saveChatToHost_ACU();
        } catch (error) {
          logWarn_ACU('[剧情推进] 保存旧聊天快照迁移结果失败:', error);
        }

        logDebug_ACU('[剧情推进] Chat override snapshot migrated to global preset link.');
        return;
      }

      logDebug_ACU(`[剧情推进] Applying legacy chat override snapshot for chat "${currentChatFileIdentifier_ACU || 'unknown'}" because no valid global preset link was found.`);
      replaceCurrentPlotSettingsWithSnapshot_ACU(plotSettings, chatScopeState.snapshot);
      _set_currentPlotTaskEditorId_ACU('');
      syncCurrentEditablePlotPresetState_ACU({ source: 'load_chat_override' });

      if (clearPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU)) {
        logDebug_ACU('[剧情推进] Cleared legacy plotPresetBindings entry because chat metadata override is authoritative.');
      }

      saveSettings_ACU();
      logDebug_ACU('[剧情推进] Chat override snapshot restored from chat history.');
      return;
    }

    let globalPresetName = normalizePlotPresetSelectionValue_ACU(plotSettings.lastUsedPresetName || '');
    let globalPresetToLoad = findPlotPresetByName_ACU(globalPresetName);
    if (globalPresetName && !globalPresetToLoad) {
      logWarn_ACU(`[剧情推进] Global preset "${globalPresetName}" no longer exists. Falling back to default preset.`);
      globalPresetName = '';
      plotSettings.lastUsedPresetName = '';
    }

    const legacyBinding = getPlotPresetBindingForChat_ACU();
    if (legacyBinding) {
      const legacyPresetName = normalizePlotPresetSelectionValue_ACU(legacyBinding.presetName || '');
      const bindingMatchesGlobal = legacyPresetName === globalPresetName;
      const bindingIsImplicitInherit = legacyBinding.isExplicit !== true || legacyBinding.source === 'inherit';

      if (bindingIsImplicitInherit || bindingMatchesGlobal) {
        if (clearPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU)) {
          logDebug_ACU('[剧情推进] Cleared legacy inherit-style plot preset binding for current chat.');
        }
      } else {
        const legacyPresetToLoad = findPlotPresetByName_ACU(legacyPresetName);
        if (legacyPresetToLoad) {
          logDebug_ACU(`[剧情推进] Applying explicit chat preset binding for chat "${currentChatFileIdentifier_ACU || 'unknown'}": "${legacyPresetName}"`);
          applyPlotPresetToSettings_ACU(plotSettings, legacyPresetToLoad);
          setPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU, legacyPresetToLoad.name, {
            source: legacyBinding.source || 'ui',
            isExplicit: true,
          });
          _set_currentPlotTaskEditorId_ACU('');
          syncCurrentEditablePlotPresetState_ACU({ source: 'load_chat_preset_binding' });
          saveSettings_ACU();
          logDebug_ACU('[剧情推进] Current chat is using a global preset link.');
          return;
        }

        if (isDefaultPlotPresetSelection_ACU(legacyPresetName)) {
          clearPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU);
          logDebug_ACU(`[剧情推进] Cleared default-style explicit binding for chat "${currentChatFileIdentifier_ACU || 'unknown'}".`);
        } else {
          logWarn_ACU(`[剧情推进] Legacy binding preset "${legacyPresetName}" no longer exists. Falling back to inherit global/default.`);
          clearPlotPresetBindingForChat_ACU(currentChatFileIdentifier_ACU);
        }
      }
    }

    if (globalPresetToLoad) {
      logDebug_ACU(`[剧情推进] Applying inherited global preset for chat "${currentChatFileIdentifier_ACU || 'unknown'}": "${globalPresetName}"`);
      applyPlotPresetToSettings_ACU(plotSettings, globalPresetToLoad);
    } else {
      logDebug_ACU(`[剧情推进] Applying inherited default preset for chat "${currentChatFileIdentifier_ACU || 'unknown'}".`);
      resetPlotSettingsToDefault_ACU(plotSettings);
    }

    _set_currentPlotTaskEditorId_ACU('');
    syncCurrentEditablePlotPresetState_ACU({ source: globalPresetToLoad ? 'load_inherit_global' : 'load_inherit_default' });
    saveSettings_ACU();

    logDebug_ACU('[剧情推进] Current chat is inheriting the active global plot preset state.');
  }

  // ═══ 历史记录读写 ═══
  // 身份契约：_qrf_plot_round_id 是推进结果附着到用户楼层后的稳定身份，
  // 仅供保存侧定位与失败重试使用；输入/最终消息哈希只用于首次认领。
  //
  // 注意：历史检索锚点不使用 roundId。本轮 roundId 在任务全部完成后才生成，
  // 而历史读取发生在任务开始前，此时无 roundId 可用。锚点的职责是定位
  // “当前用户层”，策略1 下由 _qrf_plot_pending_hash 提供，策略2 / hook 下
  // 当前层尚未入 chat，因此无需锚点。

  function findPlotHistoryAnchorIndex_ACU(chat: any[], options: any = {}) {
    if (!Array.isArray(chat) || chat.length === 0) return -1;
    const beforeUserInputHash = String(options?.beforeUserInputHash || '').trim();
    const beforeUserInputText = String(options?.beforeUserInputText || '');
    if (!beforeUserInputHash && !beforeUserInputText.trim()) return -1;

    for (let i = chat.length - 1; i >= 0; i--) {
      const message = chat[i];
      if (!message?.is_user) continue;
      if (beforeUserInputHash && message._qrf_plot_pending_hash === beforeUserInputHash) {
        return i;
      }
      const messageText = String(message.mes || '');
      if (beforeUserInputHash && hashUserInput_ACU(messageText) === beforeUserInputHash) {
        return i;
      }
      if (!beforeUserInputHash && beforeUserInputText && messageText === beforeUserInputText) {
        return i;
      }
    }

    return -1;
  }

  function getPlotHistorySearchUpperBound_ACU(chat: any[], options: any = {}) {
    if (!Array.isArray(chat) || chat.length === 0) return -1;

    if (Number.isFinite(options?.beforeIndex)) {
      return Math.min(chat.length - 1, Math.floor(options.beforeIndex) - 1);
    }

    const hasHistoryAnchor = Boolean(String(options?.beforeUserInputHash || '').trim() || String(options?.beforeUserInputText || '').trim());
    if (!hasHistoryAnchor) return chat.length - 1;

    const anchorIndex = findPlotHistoryAnchorIndex_ACU(chat, options);
    if (anchorIndex >= 0) {
      return anchorIndex - 1;
    }

    // 调用方明确给了锚点却匹配不上（如 swipe/重试：pending 标记已被消费、
    // mes 已被 finalMessage 覆盖）。此时末条带 plot 的用户层就是“当前层”，
    // 不能当作上一轮返回，否则会自读。
    const lastIndex = chat.length - 1;
    const lastMessage = chat[lastIndex];
    if (lastMessage?.is_user && lastMessage.qrf_plot) {
      return lastIndex - 1;
    }
    return lastIndex;
  }

  export function getPlotFromHistory_ACU(options: any = {}) {
    const chat = getChatArray_ACU();
    logDebug_ACU('[剧情推进] [Plot] getPlotFromHistory_ACU 被调用，聊天记录长度:', chat?.length || 0, '，检索选项:', options || {});
    if (!chat || chat.length === 0) {
      logDebug_ACU('[剧情推进] [Plot] 聊天记录为空');
      return '';
    }

    const currentPresetName = getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: true });
    logDebug_ACU('[剧情推进] [Plot] 当前聊天实际预设名称:', currentPresetName || '(默认预设)');

    const upperBound = getPlotHistorySearchUpperBound_ACU(chat, options);
    if (upperBound < 0) {
      logDebug_ACU('[剧情推进] [Plot] 当前楼层之前没有更早的用户消息或可检索范围为空，返回空字符串');
      return '';
    }

    // 如果指定了 taskId，优先从新结构 qrf_plot_tasks 中按任务维度读取
    const targetTaskId = String(options?.taskId || '').trim();
    if (targetTaskId) {
      for (let i = upperBound; i >= 0; i--) {
        const message = chat[i];
        if (message && message.qrf_plot_tasks && typeof message.qrf_plot_tasks === 'object') {
          const plotPresetName = message.qrf_plot_preset || '';
          if (currentPresetName !== '' && plotPresetName !== currentPresetName) {
            continue;
          }
          const taskContent = message.qrf_plot_tasks[targetTaskId];
          if (typeof taskContent === 'string' && taskContent.trim()) {
            logDebug_ACU(`[剧情推进] [Plot] ✓ 在消息 ${i} 找到任务 "${targetTaskId}" 的 qrf_plot_tasks 数据，长度: ${taskContent.length}`);
            return taskContent;
          }
        }
      }
      // 任务级新结构未找到，回退到旧结构
      logDebug_ACU(`[剧情推进] [Plot] 任务 "${targetTaskId}" 在 qrf_plot_tasks 中未找到，回退到旧 qrf_plot 结构。`);
    }

    let latestPlotContent = '';
    let latestPlotIndex = -1;

    for (let i = upperBound; i >= 0; i--) {
      const message = chat[i];
      if (message && message.qrf_plot) {
        const plotPresetName = message.qrf_plot_preset || '';

        if (currentPresetName === '') {
          latestPlotContent = message.qrf_plot;
          latestPlotIndex = i;
          logDebug_ACU(`[剧情推进] [Plot] (无预设模式) ✓ 在消息 ${i} 找到最新的plot数据，检索上界: ${upperBound}`);
          break;
        }

        if (plotPresetName === currentPresetName) {
          latestPlotContent = message.qrf_plot;
          latestPlotIndex = i;
          logDebug_ACU(`[剧情推进] [Plot] ✓ 在消息 ${i} (is_user=${message.is_user}) 找到精确匹配预设 "${currentPresetName}" 的plot数据，检索上界: ${upperBound}`);
          break;
        }
      }
    }

    if (!latestPlotContent && currentPresetName !== '') {
      logDebug_ACU(`[剧情推进] [Plot] 未找到精确匹配预设 "${currentPresetName}" 的数据，尝试在上界 ${upperBound} 之前寻找无标签旧数据...`);
      for (let i = upperBound; i >= 0; i--) {
        const message = chat[i];
        if (message && message.qrf_plot) {
          const plotPresetName = message.qrf_plot_preset || '';
          if (plotPresetName === '') {
            latestPlotContent = message.qrf_plot;
            latestPlotIndex = i;
            logDebug_ACU(`[剧情推进] [Plot] (兼容模式) ✓ 在消息 ${i} 找到无标签的旧plot数据作为回退，检索上界: ${upperBound}`);
            break;
          }
        }
      }
    }

    if (latestPlotContent) {
      logDebug_ACU(`[剧情推进] [Plot] 返回匹配预设 "${currentPresetName || '(无)'}" 的最新剧情规划数据，消息索引: ${latestPlotIndex}, 检索上界: ${upperBound}, 长度: ${latestPlotContent.length}`);
      return latestPlotContent;
    }

    const skippedPresetLayers = chat
      .slice(0, upperBound + 1)
      .map((message: any, index: number) => ({ message, index }))
      .filter(({ message }: any) => message?.qrf_plot && String(message.qrf_plot_preset || '') && String(message.qrf_plot_preset || '') !== currentPresetName)
      .map(({ message, index }: any) => `#${index}:${String(message.qrf_plot_preset)}`);
    if (currentPresetName && skippedPresetLayers.length > 0) {
      logWarn_ACU(`[剧情推进] [Plot] 未找到当前预设 "${currentPresetName}" 的历史数据；已跳过其他预设层: ${skippedPresetLayers.join(', ')}`);
    }
    logDebug_ACU(`[剧情推进] [Plot] 未找到匹配预设 "${currentPresetName || '(无)'}" 的plot数据，检索上界: ${upperBound}`);
    return '';
  }

  /**
   * Plot 保存结果（如实表达已完成动作，而非“已安排一个回调”）。
   *
   * 语义边界（重要）：
   * - `committed` 仅代表“已写入目标消息字段，且已请求宿主保存且未抛错”。
   *   宿主 `saveChat()` 不提供真实落盘确认，因此本状态不代表文件已写入磁盘。
   * - `deferred` 代表目标消息尚未出现在聊天数组中，已转入受管延迟提交（轮询），
   *   调用方不需要也不应该等待其最终结果（见 P2 时序约束）。
   * - `superseded` 代表本轮 pending 已被更新一轮或聊天切换取代，放弃本轮写入。
   * - `failed` 代表本轮内容未提交；pending 保留，供下一轮入口 flush 重试。
   */
  export type PlotSaveOutcome_ACU =
    | { status: 'committed'; targetIndex: number }
    | { status: 'deferred'; reason: 'target_not_found_yet' }
    | { status: 'superseded'; reason: 'newer_round_pending' | 'chat_changed' }
    | { status: 'failed'; reason: 'host_save_failed' | 'empty_content'; error?: unknown };

  // 真实入楼事件与兜底轮询共用同一轮提交，避免宿主保存尚未返回时重复写入。
  let plotCommitInFlight_ACU: {
    roundRef: unknown;
    chatId: string;
    promise: Promise<PlotSaveOutcome_ACU>;
  } | null = null;

  /**
   * 将 plot 附加到对应的用户消息上，并显式请求一次宿主保存。
   * roundId 是稳定身份；两类内容哈希仅用于首次认领宿主刚创建的用户楼层。
   *
   * 执行语义：
   * - 入口先做一次同步查找；命中则立即写入并提交，`await` 具备真实语义（策略 1 主路径）。
   * - 未命中则转入受管延迟提交（轮询），立即返回 `deferred`，不阻塞调用方
   *   （策略 2 下目标消息要等宿主 Generate 后续步骤才入数组）。
   */
  export async function savePlotToLatestMessage_ACU(
    force = false,
    options: { syncOnly?: boolean } = {},
  ): Promise<PlotSaveOutcome_ACU> {
    logDebug_ACU('[剧情推进] [Plot] savePlotToLatestMessage_ACU 被调用');
    logDebug_ACU('[剧情推进] [Plot] planningGuard_ACU.inProgress:', planningGuard_ACU.inProgress);
    logDebug_ACU('[剧情推进] [Plot] planningGuard_ACU.ignoreNextGenerationEndedCount:', planningGuard_ACU.ignoreNextGenerationEndedCount);
    logDebug_ACU('[剧情推进] [Plot] tempPlotToSave_ACU:', tempPlotToSave_ACU ? (typeof tempPlotToSave_ACU === 'string' ? `长度=${tempPlotToSave_ACU.length}` : `content长度=${tempPlotToSave_ACU.content?.length}, hash=${tempPlotToSave_ACU.userInputHash}`) : '(空)');

    // GENERATION_ENDED 驱动的调用仍保留门控；force=true 的推进内调用跳过门控。
    if (!force && planningGuard_ACU.inProgress) {
      logDebug_ACU('[剧情推进] [Plot] Planning in progress, ignoring GENERATION_ENDED.');
      return { status: 'deferred', reason: 'target_not_found_yet' };
    }
    if (!force && planningGuard_ACU.ignoreNextGenerationEndedCount > 0) {
      planningGuard_ACU.ignoreNextGenerationEndedCount--;
      logDebug_ACU(`[剧情推进] [Plot] Ignoring planning-triggered GENERATION_ENDED (${planningGuard_ACU.ignoreNextGenerationEndedCount} left).`);
      return { status: 'deferred', reason: 'target_not_found_yet' };
    }

    if (!tempPlotToSave_ACU) {
      logDebug_ACU('[剧情推进] [Plot] tempPlotToSave_ACU 为空，无需保存');
      return { status: 'deferred', reason: 'target_not_found_yet' };
    }

    // ── P1: 本轮 pending 快照化（对象引用防旧回调 + roundId 持久化身份）──
    const roundRef = tempPlotToSave_ACU;
    const roundChatId = currentChatFileIdentifier_ACU || '';
    const pendingChatId = typeof roundRef === 'object' ? String(roundRef.chatId || '') : '';
    if (pendingChatId && pendingChatId !== roundChatId) {
      logWarn_ACU('[剧情推进] [Plot] 待保存结果不属于当前聊天，停止提交');
      _set_tempPlotToSave_ACU(null);
      return { status: 'superseded', reason: 'chat_changed' };
    }
    // 新轮次捕获的边界仅用于首次认领；已附着的 roundId 仍是重试权威身份。
    const targetStartIndex = typeof roundRef === 'object'
      && Number.isInteger(roundRef.targetStartIndex) && roundRef.targetStartIndex >= 0
      ? roundRef.targetStartIndex
      : 0;
    let plotContent: string;
    let userInputHash: string | null;
    let finalMessageHash: string | null;
    let roundId: string | null;
    let userInputText: string | null;
    let taskResults: any[] | null;
    if (typeof roundRef === 'string') {
      plotContent = roundRef;
      userInputHash = null;
      finalMessageHash = null;
      roundId = null;
      userInputText = null;
      taskResults = null;
      logDebug_ACU('[剧情推进] [Plot] 检测到旧格式数据，使用回退匹配逻辑');
    } else {
      plotContent = roundRef?.content;
      userInputHash = roundRef?.userInputHash ?? null;
      finalMessageHash = roundRef?.finalMessageHash ?? null;
      roundId = String(roundRef?.roundId || '').trim() || null;
      userInputText = roundRef?.userInputText ?? null;
      taskResults = Array.isArray(roundRef?.taskResults) ? roundRef.taskResults : null;
      logDebug_ACU('[剧情推进] [Plot] 使用新格式，roundId:', roundId || '(兼容)', '，用户输入哈希:', userInputHash, '，原始文本长度:', userInputText?.length || 0);
    }

    if (!plotContent) {
      logWarn_ACU('[剧情推进] [Plot] plotContent 为空，无法保存');
      if (tempPlotToSave_ACU === roundRef) {
        _set_tempPlotToSave_ACU(null);
      }
      return { status: 'failed', reason: 'empty_content' };
    }

    // tryFindTarget 内部策略：
    // - 新格式：roundId 命中 > 策略1 标记 > 按最终/原始文本哈希首次认领。
    // - 无 roundId 的旧格式：完整保留原哈希/尾部回退语义。
    const tryFindTarget = () => {
      const chat = getChatArray_ACU();
      if (!chat || chat.length === 0) {
        return null;
      }

      if (roundId) {
        for (let i = chat.length - 1; i >= 0; i--) {
          const msg = chat[i];
          if (msg?.is_user && msg._qrf_plot_round_id === roundId) {
            logDebug_ACU(`[剧情推进] [Plot] ✓ 通过 roundId 命中目标用户消息（索引 ${i}，roundId: ${roundId}）`);
            return { msg, index: i };
          }
        }

        // 策略1 标记认领：要求未被其他轮次认领，且尚未附着 plot。
        // 失败重试无需依赖本分支（已写入 roundId，由上一分支精确命中），
        // 因此这里可以安全地拒绝覆盖任何已有 plot 的楼层：宁可不写，也不错层。
        for (let i = chat.length - 1; i >= targetStartIndex; i--) {
          const msg = chat[i];
          if (msg?.is_user && !msg._qrf_plot_round_id && !msg.qrf_plot && msg._qrf_plot_pending_hash === userInputHash) {
            msg._qrf_plot_round_id = roundId;
            logDebug_ACU(`[剧情推进] [Plot] ✓ 通过策略1待处理标记认领目标用户消息（索引 ${i}，roundId: ${roundId}）`);
            return { msg, index: i };
          }
        }

        // 策略2 首次认领：宿主已把 finalMessage 写入 msg.mes，因此同时接受
        // 最终注入文本哈希与用户原文哈希；只认未认领、未附着 plot 的用户层。
        for (let i = chat.length - 1; i >= targetStartIndex; i--) {
          const msg = chat[i];
          if (!msg?.is_user || msg._qrf_plot_round_id || msg.qrf_plot) continue;
          const messageHash = hashUserInput_ACU(msg.mes || '');
          if (messageHash !== finalMessageHash && messageHash !== userInputHash) continue;
          msg._qrf_plot_round_id = roundId;
          logDebug_ACU(`[剧情推进] [Plot] ✓ 通过内容哈希首次认领目标用户消息（索引 ${i}，roundId: ${roundId}）`);
          return { msg, index: i };
        }
        return null;
      }

      if (userInputHash) {
        // 旧对象格式：保留标记身份优先与文本哈希回退。
        for (let i = chat.length - 1; i >= 0; i--) {
          const msg = chat[i];
          if (msg && msg.is_user && msg._qrf_plot_pending_hash === userInputHash) {
            logDebug_ACU(`[剧情推进] [Plot] ✓ 通过消息对象上的哈希标记找到目标用户消息（索引 ${i}，哈希: ${userInputHash}）`);
            return { msg, index: i };
          }
        }
        // 阶段2：无标记（策略2）时按文本哈希精确匹配，仅接受未写入过的消息，
        // 避免把同一文本的旧楼层当作目标。
        for (let i = chat.length - 1; i >= 0; i--) {
          const msg = chat[i];
          if (msg && msg.is_user && !msg.qrf_plot && hashUserInput_ACU(msg.mes || '') === userInputHash) {
            logDebug_ACU(`[剧情推进] [Plot] ✓ 通过消息文本哈希精确匹配找到目标用户消息（索引 ${i}，哈希: ${userInputHash}）`);
            return { msg, index: i };
          }
        }
      } else {
        // 无 hash：仅旧字符串格式走回退（最近一条 is_user 且无 qrf_plot）
        for (let i = chat.length - 1; i >= 0; i--) {
          const msg = chat[i];
          if (msg && msg.is_user && !msg.qrf_plot) {
            logDebug_ACU(`[剧情推进] [Plot] 使用回退逻辑找到目标用户消息于索引 ${i}`);
            return { msg, index: i };
          }
        }
      }

      return null;
    };

    // ── P3: 写入并提交（立即 / 延迟共用）──
    const commitToHost = async (found: { msg: any; index: number }): Promise<PlotSaveOutcome_ACU> => {
      if (tempPlotToSave_ACU !== roundRef) {
        return { status: 'superseded', reason: 'newer_round_pending' };
      }
      if ((currentChatFileIdentifier_ACU || '') !== roundChatId) {
        return { status: 'superseded', reason: 'chat_changed' };
      }
      const target = found.msg;
      if (roundId) {
        target._qrf_plot_round_id = roundId;
      }
      target.qrf_plot = plotContent;
      const currentPresetName = getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: true });
      target.qrf_plot_preset = currentPresetName;

      // 同时写入任务级结果映射 qrf_plot_tasks（使用本轮快照，不重读全局）
      if (Array.isArray(taskResults) && taskResults.length > 0) {
        if (!target.qrf_plot_tasks || typeof target.qrf_plot_tasks !== 'object') {
          target.qrf_plot_tasks = {};
        }
        for (const result of taskResults) {
          if (result && result.success && result.taskId && typeof result.rawResponse === 'string' && result.rawResponse.trim()) {
            target.qrf_plot_tasks[result.taskId] = result.rawResponse.trim();
          }
        }
      }

      logDebug_ACU('[剧情推进] [Plot] ✓ Plot数据已精确附加到目标用户消息，长度:', plotContent.length, '，预设:', currentPresetName || '(默认预设)');

      // P3-T3.1: 显式请求宿主保存；失败保留 pending、标记与内存字段，不向上游抛错（D-5）。
      // 标记只有在宿主保存成功后才删除，否则下一轮 flush 无法重新定位目标（失败重试契约）。
      try {
        await saveChatToHostStrict_ACU();
      } catch (error) {
        logWarn_ACU('[剧情推进] [Plot] 请求宿主保存失败，保留 pending 待下一轮重试:', error);
        return { status: 'failed', reason: 'host_save_failed', error };
      }

      // P5-T5.1: 标记在宿主保存成功后才删除（身份已消费）
      if (target._qrf_plot_pending_hash) {
        delete target._qrf_plot_pending_hash;
      }

      // T1.2: 仅当全局 pending 仍是本轮同一对象时才清空
      if (tempPlotToSave_ACU === roundRef) {
        _set_tempPlotToSave_ACU(null);
      } else {
        logWarn_ACU('[剧情推进] [Plot] pending 已被其他轮次替换，跳过清空以保护新一轮数据');
      }

      return { status: 'committed', targetIndex: found.index };
    };

    const writeAndCommit = async (found: { msg: any; index: number }): Promise<PlotSaveOutcome_ACU> => {
      const inFlight = plotCommitInFlight_ACU;
      if (inFlight?.roundRef === roundRef && inFlight.chatId === roundChatId) {
        return await inFlight.promise;
      }
      const lease = {
        roundRef,
        chatId: roundChatId,
        // 先登记再执行，宿主同步派发事件也只能加入已有提交。
        promise: Promise.resolve().then(() => commitToHost(found)),
      };
      plotCommitInFlight_ACU = lease;
      try {
        return await lease.promise;
      } finally {
        if (plotCommitInFlight_ACU === lease) plotCommitInFlight_ACU = null;
      }
    };

    // ── P2-T2.1: 入口先做一次同步查找，命中走立即提交 ──
    const immediate = tryFindTarget();
    if (immediate) {
      return await writeAndCommit(immediate);
    }

    // ── 延迟提交（策略 2：目标消息待宿主加入）──
    if (options.syncOnly) {
      // flush 场景：只做同步查找 + 写入 + 提交，不注册定时器（P4）
      logDebug_ACU('[剧情推进] [Plot] syncOnly 模式：未同步命中，直接返回 deferred，不启动轮询');
      return { status: 'deferred', reason: 'target_not_found_yet' };
    }

    const MAX_POLL_ATTEMPTS = 20;
    const POLL_INTERVAL_MS = 100;
    let pollAttempts = 0;
    let delayedFinished = false;

    const pollForTarget = async () => {
      if (delayedFinished) return;
      pollAttempts++;

      // 已由入楼事件提交或被更新轮次取代时，旧轮询不再写入。
      if (tempPlotToSave_ACU !== roundRef) {
        logDebug_ACU('[剧情推进] [Plot] 本轮 pending 已完成或被替换，停止延迟提交');
        delayedFinished = true;
        return;
      }
      // T1.4: 聊天切换 → 终止本轮
      if (roundChatId && (currentChatFileIdentifier_ACU || '') !== roundChatId) {
        logWarn_ACU(`[剧情推进] [Plot] 聊天已切换（${roundChatId} → ${currentChatFileIdentifier_ACU || '(未知)'}），放弃本轮延迟提交`);
        if (tempPlotToSave_ACU === roundRef) {
          _set_tempPlotToSave_ACU(null);
        }
        delayedFinished = true;
        return;
      }

      const result = tryFindTarget();
      if (result) {
        delayedFinished = true;
        await writeAndCommit(result);
        return;
      }

      if (pollAttempts >= MAX_POLL_ATTEMPTS) {
        delayedFinished = true;
        logWarn_ACU(`[剧情推进] [Plot] 轮询 ${MAX_POLL_ATTEMPTS} 次后仍未找到目标用户消息。roundId: ${roundId || '(旧格式)'}，用户输入哈希: ${userInputHash || '(无)'}，原始文本: ${userInputText ? `长度=${userInputText.length}` : '(无)'}。pending 已保留，等待用户入楼、正文结束或下一轮入口补写。`);
        return;
      }

      setTimeout(() => { pollForTarget(); }, POLL_INTERVAL_MS);
    };

    setTimeout(() => { pollForTarget(); }, 100);
    return { status: 'deferred', reason: 'target_not_found_yet' };
  }

  /**
   * 用户入楼、正文结束及下一轮入口共用的 pending 补写。
   *
   * 只做一次同步查找 + 写入 + 提交，不起定时器。尚未入楼则保留 pending，
   * 不阻塞宿主继续创建真实楼层；同一轮已在提交时共用已有保存请求。
   *
   * 安全约束（P4-T4.2）：
   * - pending 绑定的聊天标识与当前不一致 → 丢弃并 warn，禁止跨聊天误写。
   * - 持 hash 时禁用尾部回退（savePlotToLatestMessage_ACU 内已实现），
   *   首次认领限定本轮范围，重试使用 roundId，避免补写错层。
   */
  export async function flushPlotPendingSave_ACU(): Promise<PlotSaveOutcome_ACU | null> {
    if (!tempPlotToSave_ACU) return null;
    const pendingChatId = typeof tempPlotToSave_ACU === 'object' && tempPlotToSave_ACU !== null
      ? String(tempPlotToSave_ACU.chatId || '')
      : '';
    const currentChatId = currentChatFileIdentifier_ACU || '';

    if (pendingChatId && pendingChatId !== currentChatId) {
      logWarn_ACU(`[剧情推进] [Plot] flush 检测到残留 pending 属于其他聊天（${pendingChatId}），丢弃以避免跨聊天误写`);
      _set_tempPlotToSave_ACU(null);
      return { status: 'superseded', reason: 'chat_changed' };
    }

    return await savePlotToLatestMessage_ACU(true, { syncOnly: true });
  }
