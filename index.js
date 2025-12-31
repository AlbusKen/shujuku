// 剧情规划大师 - 聊天优化插件
// 由Cline移植并重构

import { callInterceptionApi } from './api.js';
import { getCombinedWorldbookContent } from './lore.js';
import { createDrawer } from './ui/drawer.js';
import { defaultSettings } from './utils/settings.js';
import { characters, eventSource, event_types, getRequestHeaders, saveSettings, this_chid } from '/script.js';
import { extension_settings, getContext } from '/scripts/extensions.js';

console.log('[剧情优化大师] v3.5.1 Loading... (Timestamp: ' + Date.now() + ')');

const extension_name = 'quick-response-force';
let isProcessing = false;
let tempPlotToSave = null; // [架构重构] 用于在生成和消息创建之间临时存储plot
let currentAbortController_QRF = null; // [新增] 用于中止正在进行的AI请求（剧情规划）
let wasStoppedByUser_QRF = false; // [新增] 标记本次规划是否被用户手动终止

/**
 * [新增] 从世界书中直接提取数据库生成的 OutlineTable（总结大纲/总体大纲）条目内容，作为 $5 的兜底来源。
 * 注意：该条目会在 $1 的世界书注入中被屏蔽，但这里是“专门读取它”用于 $5。
 * @param {object} apiSettings - 当前API设置
 * @returns {Promise<string|null>} - 找到则返回条目内容，否则返回null
 */
async function getOutlineTableFromWorldbook_QRF(apiSettings) {
  try {
    let bookNames = [];
    const worldbookSource = apiSettings?.worldbookSource || 'character';

    if (worldbookSource === 'manual') {
      bookNames = apiSettings.selectedWorldbooks || [];
    } else {
      if (this_chid === -1 || !characters[this_chid]) return null;
      const charLorebooks = await window.TavernHelper.getCharLorebooks({ type: 'all' });
      if (charLorebooks?.primary) bookNames.push(charLorebooks.primary);
      if (charLorebooks?.additional?.length) bookNames.push(...charLorebooks.additional);
    }

    if (!bookNames.length) return null;

    for (const bookName of bookNames) {
      if (!bookName) continue;
      const entries = await window.TavernHelper.getLorebookEntries(bookName);
      if (!entries?.length) continue;

      for (const entry of entries) {
        const comment = entry?.comment || entry?.name || '';
        // 兼容隔离/外部导入前缀（与数据库插件逻辑一致）
        let normalizedComment = String(comment).replace(/^ACU-\[[^\]]+\]-/, '');
        normalizedComment = normalizedComment.replace(/^外部导入-(?:[^-]+-)?/, '');

        if (normalizedComment.startsWith('TavernDB-ACU-OutlineTable')) {
          const content = String(entry?.content || '').trim();
          if (!content) return null;
          // 如果条目本身不带表头标识，这里补一个更醒目的标题
          if (!content.startsWith('## 表格:')) {
            return `## 表格: 总体大纲\n${content}`;
          }
          return content;
        }
      }
    }

    return null;
  } catch (e) {
    console.warn(`[${extension_name}] 从世界书兜底读取 OutlineTable 失败:`, e);
    return null;
  }
}

// [新功能] 自动化循环状态管理
const loopState = {
  isLooping: false,
  isRetrying: false, // [新功能] 标记当前是否处于重试流程
  timerId: null,
  retryCount: 0,
  startTime: 0, // 循环开始时间
  totalDuration: 0, // 总时长(ms)
  tickInterval: null, // 倒计时更新定时器
  awaitingReply: false, // 是否正在等待本轮生成结果（用于 GENERATION_ENDED 检测）
};

// [健全性] 规划阶段防护：
// 规划阶段可能通过酒馆主API（TavernHelper.generateRaw）发起一次“非聊天”的生成请求，
// 从而触发酒馆的生成事件（如 GENERATION_ENDED / message_received 等）。
// 这些事件不应被当作“剧情生成结束”来处理（否则会误触发循环标签校验、或提前把 plot 附加到错误楼层）。
const planningGuard = {
  inProgress: false,
  // 规划阶段如果使用 useMainApi(generateRaw)，通常会触发一次 GENERATION_ENDED。用计数精确忽略。
  ignoreNextGenerationEndedCount: 0,
};

// [新功能] 规划任务中止控制器（已重命名为 currentAbortController_QRF）

/**
 * 将从 st-memory-enhancement 获取的原始表格JSON数据转换为更适合LLM读取的文本格式。
 * @param {object} jsonData - ext_exportAllTablesAsJson 返回的JSON对象。
 * @returns {string} - 格式化后的文本字符串。
 */
function formatTableDataForLLM(jsonData) {
  if (!jsonData || typeof jsonData !== 'object' || Object.keys(jsonData).length === 0) {
    return '当前无任何可用的表格数据。';
  }

  let output = '以下是当前角色聊天记录中，由st-memory-enhancement插件保存的全部表格数据：\n';

  for (const sheetId in jsonData) {
    if (Object.prototype.hasOwnProperty.call(jsonData, sheetId)) {
      const sheet = jsonData[sheetId];
      // 确保表格有名称，且内容至少包含表头和一行数据
      if (sheet && sheet.name && sheet.content && sheet.content.length > 1) {
        output += `\n## 表格: ${sheet.name}\n`;
        const headers = sheet.content[0].slice(1); // 第一行是表头，第一个元素通常为空
        const rows = sheet.content.slice(1);

        rows.forEach((row, rowIndex) => {
          const rowData = row.slice(1);
          let rowOutput = '';
          let hasContent = false;
          headers.forEach((header, index) => {
            const cellValue = rowData[index];
            if (cellValue !== null && cellValue !== undefined && String(cellValue).trim() !== '') {
              rowOutput += `  - ${header}: ${cellValue}\n`;
              hasContent = true;
            }
          });

          if (hasContent) {
            output += `\n### ${sheet.name} - 第 ${rowIndex + 1} 条记录\n${rowOutput}`;
          }
        });
      }
    }
  }
  output += '\n--- 表格数据结束 ---\n';
  return output;
}

/**
 * [剧情推进专用] $5 只注入"总体大纲"表（含表头）。不影响填表侧任何逻辑。
 * @param {object} allTablesJson - 所有表格数据的JSON对象
 * @returns {string} - 格式化后的总体大纲表内容
 */
function formatOutlineTableForPlot_ACU(allTablesJson) {
  try {
    if (!allTablesJson || typeof allTablesJson !== 'object') {
      return '总体大纲表：未获取到表格数据。';
    }
    const sheets = Object.values(allTablesJson).filter(x => x && typeof x === 'object' && x.name && x.content);
    // 兼容：部分用户/版本可能把表命名为“总结大纲”
    const outline = sheets.find(s => {
      const n = String(s.name || '').trim();
      return n === '总体大纲' || n === '总结大纲';
    });
    if (!outline || !Array.isArray(outline.content) || outline.content.length === 0) {
      return '总体大纲表：未找到该表或表结构为空。';
    }

    const headerRow = Array.isArray(outline.content[0]) ? outline.content[0] : [];
    const headers = headerRow.slice(1).map(h => String(h ?? '').trim()).filter(Boolean);
    const tableTitle = String(outline.name || '').trim() || '总体大纲';
    let out = `## 表格: ${tableTitle}\n`;
    out += headers.length ? `Columns: ${headers.join(', ')}\n` : 'Columns: (无表头)\n';

    const rows = outline.content.slice(1).filter(r => Array.isArray(r));
    if (rows.length === 0) {
      out += '(无数据行)\n';
      return out;
    }

    rows.forEach((row, idx) => {
      const cells = row.slice(1);
      // 只输出非空单元格，避免噪声；但保留行号便于引用
      const parts = [];
      for (let i = 0; i < headers.length; i++) {
        const v = cells[i];
        if (v !== null && v !== undefined && String(v).trim() !== '') {
          parts.push(`${headers[i]}: ${String(v)}`);
        }
      }
      out += parts.length ? `- [${idx}] ${parts.join(' | ')}\n` : `- [${idx}] (空行)\n`;
    });
    return out;
  } catch (e) {
    return '总体大纲表：格式化时发生错误。';
  }
}

/**
 * [新增] 转义正则表达式特殊字符。
 * @param {string} string - 需要转义的字符串.
 * @returns {string} - 转义后的字符串.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& 表示匹配到的整个字符串
}

/**
 * [新增] 加载上次使用的预设到全局设置，并清除当前角色卡上冲突的陈旧设置。
 * 这是为了确保在切换角色或新开对话时，预设能够被正确应用，而不是被角色卡上的“幽灵数据”覆盖。
 */
async function loadPresetAndCleanCharacterData() {
  const settings = extension_settings[extension_name];
  if (!settings) return;

  const lastUsedPresetName = settings.lastUsedPresetName;
  const presets = settings.promptPresets || [];

  if (lastUsedPresetName && presets.length > 0) {
    const presetToLoad = presets.find(p => p.name === lastUsedPresetName);
    if (presetToLoad) {
      console.log(`[${extension_name}] Applying last used preset: "${lastUsedPresetName}"`);

      // 步骤1: 将预设内容加载到全局设置中
      // [架构重构] 支持新旧格式预设
      const newApiSettings = {};

      // 迁移基本速率设置
      if (presetToLoad.rateMain !== undefined) newApiSettings.rateMain = presetToLoad.rateMain;
      if (presetToLoad.ratePersonal !== undefined) newApiSettings.ratePersonal = presetToLoad.ratePersonal;
      if (presetToLoad.rateErotic !== undefined) newApiSettings.rateErotic = presetToLoad.rateErotic;
      if (presetToLoad.rateCuckold !== undefined) newApiSettings.rateCuckold = presetToLoad.rateCuckold;

      // 迁移提示词
      if (presetToLoad.prompts && Array.isArray(presetToLoad.prompts)) {
        newApiSettings.prompts = JSON.parse(JSON.stringify(presetToLoad.prompts));
      } else {
        // [新功能] 旧预设兼容：使用默认的新提示词组，并仅覆盖三个基础提示词的内容
        newApiSettings.prompts = JSON.parse(JSON.stringify(defaultSettings.apiSettings.prompts));

        const legacyContentMap = {
          mainPrompt: presetToLoad.mainPrompt,
          systemPrompt: presetToLoad.systemPrompt,
          finalSystemDirective: presetToLoad.finalSystemDirective,
        };

        newApiSettings.prompts.forEach(p => {
          if (legacyContentMap[p.id] !== undefined) {
            p.content = legacyContentMap[p.id] || '';
          }
        });
      }

      Object.assign(settings.apiSettings, newApiSettings);

      // 步骤2: 清除当前角色卡上的陈旧提示词数据
      const character = characters[this_chid];
      if (character?.data?.extensions?.[extension_name]?.apiSettings) {
        const charApiSettings = character.data.extensions[extension_name].apiSettings;
        const keysToClear = [
          'mainPrompt',
          'systemPrompt',
          'finalSystemDirective',
          'prompts', // 清除角色卡上的 prompts，优先使用全局/预设
          'rateMain',
          'ratePersonal',
          'rateErotic',
          'rateCuckold',
        ];
        let settingsCleared = false;
        keysToClear.forEach(key => {
          if (charApiSettings[key] !== undefined) {
            delete charApiSettings[key];
            settingsCleared = true;
          }
        });

        if (settingsCleared) {
          console.log(
            `[${extension_name}] Cleared stale prompt data from character card to ensure preset is applied. Saving...`,
          );
          // [最终修复] 必须等待保存操作完成，以避免竞争条件
          try {
            const response = await fetch('/api/characters/merge-attributes', {
              method: 'POST',
              headers: getRequestHeaders(),
              body: JSON.stringify({
                avatar: character.avatar,
                data: { extensions: { [extension_name]: { apiSettings: charApiSettings } } },
              }),
            });
            if (!response.ok) {
              throw new Error(`API call failed with status: ${response.status}`);
            }
            console.log(`[${extension_name}] Character card updated successfully.`);
          } catch (error) {
            console.error(`[${extension_name}] Failed to clear stale character settings on chat change:`, error);
          }
        }
      }
    }
  }

  // [最终修复] 立即将加载了预设的全局设置保存到磁盘，防止在程序重载时被旧的磁盘数据覆盖。
  saveSettings();
  console.log(`[${extension_name}] Global settings persisted to disk after applying preset.`);
}

/**
 * [新功能] 开始自动化循环
 */
async function startAutoLoop() {
  const settings = extension_settings[extension_name];
  const loopDuration = (settings.loopSettings.loopTotalDuration || 0) * 60 * 1000;

  if (!settings || !settings.loopSettings || !settings.loopSettings.quickReplyContent) {
    toastr.error('请先设置快速回复内容 (Quick Reply Content)', '无法启动循环');
    stopAutoLoop();
    return;
  }

  if (loopDuration <= 0) {
      toastr.error('请设置有效的总倒计时 (大于0分钟)', '无法启动循环');
      stopAutoLoop();
      return;
  }

  loopState.isLooping = true;
  loopState.isRetrying = false; // 初始状态非重试
  loopState.startTime = Date.now();
  loopState.totalDuration = loopDuration;
  loopState.retryCount = 0; // 重置重试计数
  
  eventSource.emit('qrf-loop-status-changed', true);
  console.log(`[${extension_name}] Auto Loop Started. Duration: ${loopDuration}ms`);

  // 启动倒计时更新
  loopState.tickInterval = setInterval(() => {
      const elapsed = Date.now() - loopState.startTime;
      const remaining = Math.max(0, loopState.totalDuration - elapsed);
      
      if (remaining <= 0) {
          stopAutoLoop();
          toastr.info('总倒计时结束，自动化循环已停止。', '循环结束');
          return;
      }

      // 格式化剩余时间 mm:ss
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      eventSource.emit('qrf-loop-timer-tick', formatted);
  }, 1000);

  // 立即触发一次生成
  triggerLoopGeneration();
}

/**
 * [新功能] 停止自动化循环
 */
function stopAutoLoop() {
  loopState.isLooping = false;
  loopState.isRetrying = false; // 确保停止时重置重试状态
  loopState.awaitingReply = false;
  if (loopState.timerId) {
    clearTimeout(loopState.timerId);
    loopState.timerId = null;
  }
  if (loopState.tickInterval) {
      clearInterval(loopState.tickInterval);
      loopState.tickInterval = null;
  }
  eventSource.emit('qrf-loop-status-changed', false);
  console.log(`[${extension_name}] Auto Loop Stopped.`);
}

/**
 * [新功能] 触发循环中的单次生成
 */
async function triggerLoopGeneration() {
  if (!loopState.isLooping) return;

  const settings = extension_settings[extension_name];
  const quickReplyContent = settings.loopSettings.quickReplyContent;

  if (!quickReplyContent) {
    console.warn(`[${extension_name}] Loop content is empty, stopping loop.`);
    stopAutoLoop();
    return;
  }

  // 模拟用户输入并发送
  // 注意：这里我们直接设置输入框并触发点击，以便复用现有的 intercept 逻辑 (Strategy 2)
  loopState.awaitingReply = true;
  $('#send_textarea').val(quickReplyContent);
  $('#send_textarea').trigger('input');
  
  // 给一点时间让UI更新，然后点击发送
  setTimeout(() => {
    if (loopState.isLooping) {
        $('#send_but').click();
    }
  }, 100);
}

/**
 * [新功能] 验证AI回复是否包含所需标签
 * @param {string} content - AI回复内容
 * @param {string} tags - 逗号分隔的标签列表
 * @returns {boolean} - 是否验证通过
 */
function validateLoopTags(content, tags) {
    if (!tags || !tags.trim()) return true; // 如果未设置标签，默认通过
    
    const tagList = tags.split(/[,，]/).map(t => t.trim()).filter(t => t);
    if (tagList.length === 0) return true;

    for (const tag of tagList) {
        if (!content.includes(tag)) {
            console.log(`[${extension_name}] Loop validation failed: missing tag "${tag}"`);
            return false;
        }
    }
    return true;
}

// =========================
// [新流程] 循环检测：基于 GENERATION_ENDED + 规划标记
// =========================

async function triggerDirectRegenerateForLoop(loopSettings) {
  // 标记：本轮依然在等待回复（重试）
  loopState.awaitingReply = true;

  // 使用酒馆正规生成入口触发回复，确保消息入库+渲染
  if (window.TavernHelper?.triggerSlash) {
    await window.TavernHelper.triggerSlash('/trigger await=true');
    return;
  }
  if (window.original_TavernHelper_generate) {
    window.original_TavernHelper_generate({ user_input: '' });
    return;
  }
  window.TavernHelper?.generate?.({ user_input: '' });
}

async function enterLoopRetryFlow({ loopSettings, shouldDeleteAiReply }) {
  loopState.isRetrying = true;
  loopState.retryCount++;
  const maxRetries = loopSettings.maxRetries ?? 3;

  console.log(`[${extension_name}] 进入重试流程: ${loopState.retryCount}/${maxRetries}。`);

  if (loopState.retryCount > maxRetries) {
    toastr.error(`连续失败超过 ${maxRetries} 次，自动化循环已停止。`, '循环中止');
    stopAutoLoop();
    return;
  }

  // 需要删除AI楼层时，先删最后一条（仅当最后一条确实是AI）
  if (shouldDeleteAiReply) {
    const ctx = getContext();
    const last = ctx?.chat?.length ? ctx.chat[ctx.chat.length - 1] : null;
    if (last && !last.is_user) {
      console.log(`[${extension_name}] [重试] 删除缺失标签的AI楼层...`);
      try {
        if (typeof ctx.deleteLastMessage === 'function') {
          await ctx.deleteLastMessage();
        } else if (window.SillyTavern?.deleteLastMessage) {
          await window.SillyTavern.deleteLastMessage();
        }
      } catch (e) {
        console.error(`[${extension_name}] 删除楼层失败:`, e);
      }
    } else {
      console.log(`[${extension_name}] [重试] 不需要删除：最新楼层不是AI。`);
    }
  }

  // 延迟后重试生成
  loopState.timerId = setTimeout(async () => {
    // 等待系统空闲
    let busyWait = 0;
    while (window.SillyTavern?.generating && busyWait < 20) {
      await new Promise(r => setTimeout(r, 500));
      busyWait++;
    }
    try {
      await triggerDirectRegenerateForLoop(loopSettings);
    } catch (err) {
      console.error(`[${extension_name}] [重试] 触发生成失败:`, err);
      // 如果仍在循环中，则按重试逻辑继续（不删除楼层，因为没有生成成功）
      if (loopState.isLooping) {
        await enterLoopRetryFlow({ loopSettings, shouldDeleteAiReply: false });
      }
    }
  }, (loopSettings.retryDelay || 3) * 1000);
}

/**
 * [新功能] 循环逻辑的核心事件监听器：生成结束时触发
 */
async function onLoopGenerationEnded() {
  if (!loopState.isLooping) return;
  if (!loopState.awaitingReply) return;

  // [健全性] 忽略规划阶段触发的生成结束事件
  if (planningGuard.inProgress) {
    console.log(`[${extension_name}] [Loop] Planning in progress, ignoring GENERATION_ENDED.`);
    return;
  }
  if (planningGuard.ignoreNextGenerationEndedCount > 0) {
    planningGuard.ignoreNextGenerationEndedCount--;
    console.log(`[${extension_name}] [Loop] Ignoring planning-triggered GENERATION_ENDED (${planningGuard.ignoreNextGenerationEndedCount} left).`);
    return;
  }

  // 等待一下让消息同步
  await new Promise(resolve => setTimeout(resolve, 1500));

  if (!loopState.isLooping || !loopState.awaitingReply) return;

  const settings = extension_settings[extension_name];
  const loopSettings = settings.loopSettings || defaultSettings.loopSettings;
  const ctx = getContext();

  if (!ctx?.chat || ctx.chat.length === 0) return;

  // 获取最新消息
  let lastMessage = ctx.chat[ctx.chat.length - 1];

  // [关键] 如果最新消息是用户消息，且带有规划标记，说明这是规划层，应该忽略
  if (lastMessage.is_user && lastMessage._qrf_from_planning) {
    console.log(`[${extension_name}] [Loop] 检测到规划层(user with _qrf_from_planning)，忽略，继续等待AI回复。`);
    // 仍然在等待回复，不清空 awaitingReply
    return;
  }

  // 如果依然是用户消息（但没有规划标记），说明生成未产生有效AI回复，视为验证失败
  if (lastMessage.is_user) {
    console.warn(`[${extension_name}] [Loop] 生成结束但最后一条是用户消息（无规划标记），等待2s后重试检测...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const updatedCtx = getContext();
    lastMessage = updatedCtx?.chat?.length ? updatedCtx.chat[updatedCtx.chat.length - 1] : null;
  }

  // 如果还是没有AI回复，进入重试
  if (!lastMessage || lastMessage.is_user) {
    console.warn(`[${extension_name}] [Loop] 未找到AI回复楼层，进入重试。`);
    loopState.awaitingReply = false; // 本次检测结束
    await enterLoopRetryFlow({ loopSettings, shouldDeleteAiReply: false });
    return;
  }

  // [健全性] 忽略来自其他扩展 / 虚拟角色（如数据库插件）的 AI 回复：
  // 仅当最新 AI 回复的说话人名称与当前聊天角色名称匹配时，才进行标签检测。
  const activeChar = characters?.[this_chid];
  const activeCharName = activeChar?.name;
  if (activeCharName && lastMessage.name && lastMessage.name !== activeCharName) {
    console.log(
      `[${extension_name}] [Loop] 检测到来自其他角色/扩展的AI回复(name=${lastMessage.name})，与当前角色(${activeCharName})不符，忽略本次 GENERATION_ENDED。`
    );
    // 继续等待真正属于当前角色的AI回复
    return;
  }

  // 进行标签检测
  const ok = validateLoopTags(lastMessage.mes, loopSettings.loopTags);
  if (ok) {
    console.log(`[${extension_name}] 标签检测通过。继续循环。`);
    loopState.isRetrying = false;
    loopState.retryCount = 0;
    loopState.awaitingReply = false;
    // 通过后等待 loopDelay 再进入下一轮
    loopState.timerId = setTimeout(() => {
      triggerLoopGeneration();
    }, (loopSettings.loopDelay || 5) * 1000);
    return;
  }

  // 标签检测未通过，进入重试
  console.log(`[${extension_name}] 标签检测未通过。进入重试。`);
  loopState.awaitingReply = false; // 本次检测结束
  await enterLoopRetryFlow({ loopSettings, shouldDeleteAiReply: true });
}


/**
 * [架构重构] 从聊天记录中反向查找最新的plot。
 * @returns {string} - 返回找到的plot文本，否则返回空字符串。
 */
function getPlotFromHistory() {
  const context = getContext();
  if (!context || !context.chat || context.chat.length === 0) {
    return '';
  }

  // 从后往前遍历查找
  for (let i = context.chat.length - 1; i >= 0; i--) {
    const message = context.chat[i];
    if (message.qrf_plot) {
      console.log(`[${extension_name}] Found plot in message ${i}`);
      return message.qrf_plot;
    }
  }
  return '';
}

/**
 * [架构重构] 将plot附加到最新的AI消息上。
 */
async function savePlotToLatestMessage() {
  // [健全性] 忽略规划阶段触发的生成结束事件，避免把 plot 附加到错误楼层 / 或提前清空 tempPlotToSave
  if (planningGuard.inProgress) {
    console.log(`[${extension_name}] [Plot] Planning in progress, ignoring GENERATION_ENDED.`);
    return;
  }
  if (planningGuard.ignoreNextGenerationEndedCount > 0) {
    planningGuard.ignoreNextGenerationEndedCount--;
    console.log(`[${extension_name}] [Plot] Ignoring planning-triggered GENERATION_ENDED (${planningGuard.ignoreNextGenerationEndedCount} left).`);
    return;
  }

  if (tempPlotToSave) {
    const context = getContext();
    // 在SillyTavern的事件触发时，chat数组应该已经更新
    if (context.chat.length > 0) {
      const lastMessage = context.chat[context.chat.length - 1];
      // 确保是AI消息，然后覆盖或附加plot数据
      if (lastMessage && !lastMessage.is_user) {
        lastMessage.qrf_plot = tempPlotToSave;
        console.log(`[${extension_name}] Plot data attached/overwritten on the latest AI message.`);
        // SillyTavern should handle saving automatically after generation ends.
      }
    }
    // 无论成功或失败，都清空临时变量，避免污染下一次生成
    tempPlotToSave = null;
  }
}

/**
 * [重构] 核心优化逻辑，可被多处调用。
 * @param {string} userMessage - 需要被优化的用户输入文本。
 * @returns {Promise<string|null>} - 返回优化后的完整消息体，如果失败或跳过则返回null。
 */
async function runOptimizationLogic(userMessage) {
  // [核心修复] 如果当前处于重试流程，绝对禁止触发剧情规划
  if (loopState.isRetrying) {
      console.log(`[${extension_name}] 当前处于重试流程，跳过剧情规划逻辑。`);
      return null;
  }

  // [功能更新] 触发插件时，发射一个事件，以便UI可以按需刷新
  eventSource.emit('qrf-plugin-triggered');

  let $toast = null;
  try {
    // [健全性] 标记进入规划阶段：用于忽略规划触发的生成事件（GENERATION_ENDED / message_received 等）
    planningGuard.inProgress = true;

    // 在每次执行前，都重新进行一次深度合并，以获取最新、最完整的设置状态
    const currentSettings = extension_settings[extension_name] || {};
    // 确保 prompts 数组存在
    const baseApiSettings = { ...defaultSettings.apiSettings, ...currentSettings.apiSettings };
    if (!baseApiSettings.prompts || baseApiSettings.prompts.length === 0) {
      baseApiSettings.prompts = JSON.parse(JSON.stringify(defaultSettings.apiSettings.prompts));
    }

    const settings = {
      ...defaultSettings,
      ...currentSettings,
      apiSettings: baseApiSettings,
    };

    if (!settings.enabled || (settings.apiSettings.apiMode !== 'tavern' && !settings.apiSettings.apiUrl)) {
      return null; // 插件未启用，直接返回
    }

// 重置中止控制器与标志（参考数据库版本的终止按钮行为）
    wasStoppedByUser_QRF = false;
    currentAbortController_QRF = new AbortController();

    // 创建带"终止"按钮的 Toast
    const toastMsg = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <span class="toastr-message">正在规划剧情...</span>
        <button class="qrf-abort-btn" title="终止本次规划">
          <i class="fa-solid fa-stop"></i>
          <span>终止</span>
        </button>
      </div>
    `;
    $toast = toastr.info(toastMsg, '剧情规划大师', {
      timeOut: 0,
      extendedTimeOut: 0,
      escapeHtml: false,
      tapToDismiss: false,
      closeButton: false,
      progressBar: false,
    });

    // 绑定终止按钮（优先绑定当前 toast 内按钮，避免误绑到旧 toast）
    setTimeout(() => {
      const $abortBtn = ($toast && $toast.find) ? $toast.find('.qrf-abort-btn') : $('.qrf-abort-btn');
      if ($abortBtn.length > 0) {
        $abortBtn.off('click').on('click', function (e) {
          e.preventDefault();
          e.stopPropagation();

          wasStoppedByUser_QRF = true;
          if (currentAbortController_QRF) currentAbortController_QRF.abort();

          try {
            if ($toast) toastr.clear($toast);
            const $toastDom = $(this).closest('.toast');
            if ($toastDom && $toastDom.length) $toastDom.remove();
          } catch (err) {}

          // 强制释放锁，避免卡死
          isProcessing = false;

          // 用户主动终止属于正常流程，不弹"错误"
          setTimeout(() => toastr.info('规划任务已被用户中止。', '提示', { timeOut: 1500 }), 300);
        });
      }
    }, 0);

    const context = getContext();
    const character = characters[this_chid];
    const characterSettings = character?.data?.extensions?.[extension_name]?.apiSettings || {};
    let apiSettings = { ...settings.apiSettings, ...characterSettings };

    // [最终修复] 检查是否有激活的预设。如果有，则强制使用预设的提示词，覆盖任何来自角色卡的“幽灵数据”。
    const lastUsedPresetName = settings.lastUsedPresetName;
    const presets = settings.promptPresets || [];
    if (lastUsedPresetName && presets.length > 0) {
      const presetToApply = presets.find(p => p.name === lastUsedPresetName);
      if (presetToApply) {
        console.log(`[${extension_name}] Active preset "${lastUsedPresetName}" found. Forcing prompt override.`);
        // 处理预设数据迁移
        let presetPrompts = [];
        if (presetToApply.prompts && Array.isArray(presetToApply.prompts)) {
          presetPrompts = JSON.parse(JSON.stringify(presetToApply.prompts));
        } else {
          // [新功能] 旧预设兼容：使用默认的新提示词组，并仅覆盖三个基础提示词的内容
          presetPrompts = JSON.parse(JSON.stringify(defaultSettings.apiSettings.prompts));

          const legacyContentMap = {
            mainPrompt: presetToApply.mainPrompt,
            systemPrompt: presetToApply.systemPrompt,
            finalSystemDirective: presetToApply.finalSystemDirective,
          };

          presetPrompts.forEach(p => {
            if (legacyContentMap[p.id] !== undefined) {
              p.content = legacyContentMap[p.id] || '';
            }
          });
        }

        apiSettings = {
          ...apiSettings,
          prompts: presetPrompts,
          rateMain: presetToApply.rateMain,
          ratePersonal: presetToApply.ratePersonal,
          rateErotic: presetToApply.rateErotic,
          rateCuckold: presetToApply.rateCuckold,
          // [新增] 接力思考流程（预设中保存的流程链）
          relayFlows: Array.isArray(presetToApply.relayFlows) ? JSON.parse(JSON.stringify(presetToApply.relayFlows)) : apiSettings.relayFlows,
        };
      }
    }

    const contextTurnCount = apiSettings.contextTurnCount ?? 1;
    let slicedContext = [];
    if (contextTurnCount > 0) {
      // [修复] 修正上下文逻辑，确保只包含AI的回复，且数量由`contextTurnCount`控制。
      // 1. 从整个聊天记录中筛选出所有AI的回复。
      const aiHistory = context.chat.filter(msg => !msg.is_user);
      // 2. 从筛选后的历史中，截取最后N条AI的回复。
      const slicedAiHistory = aiHistory.slice(-contextTurnCount);

      slicedContext = slicedAiHistory.map(msg => ({ role: 'assistant', content: msg.mes }));
    }

    // [架构重构] 读取上一轮优化结果，用于$6占位符
    const lastPlotContent = getPlotFromHistory();

    let worldbookContent = '';
    if (apiSettings.worldbookEnabled) {
      worldbookContent = await getCombinedWorldbookContent(context, apiSettings, userMessage, lastPlotContent);
    }

    let tableDataContent = '';
    let tableDataJson = null; // 初始化表格数据变量
    try {
      if (window.stMemoryEnhancement && typeof window.stMemoryEnhancement.ext_exportAllTablesAsJson === 'function') {
        // 兼容：该接口在不同版本中可能是同步或异步（Promise）
        tableDataJson = await Promise.resolve(window.stMemoryEnhancement.ext_exportAllTablesAsJson());
        tableDataContent = formatTableDataForLLM(tableDataJson);
      } else {
        tableDataContent = '依赖的“记忆增强”插件未加载或版本不兼容。';
      }
    } catch (error) {
      console.error(`[${extension_name}] 处理记忆增强插件数据时出错:`, error);
      tableDataContent = '{"error": "加载表格数据时发生错误"}';
    }

    // $5：总体/总结大纲表内容（优先取表格JSON，取不到则从世界书 OutlineTable 条目兜底）
    let outlineTableContent = formatOutlineTableForPlot_ACU(tableDataJson);
    if (
      typeof outlineTableContent === 'string' &&
      outlineTableContent.startsWith('总体大纲表：') &&
      (outlineTableContent.includes('未获取到表格数据') || outlineTableContent.includes('未找到该表'))
    ) {
      const outlineFromWb = await getOutlineTableFromWorldbook_QRF(apiSettings);
      if (outlineFromWb) {
        outlineTableContent = outlineFromWb;
      }
    }

    const replacements = {
      sulv1: apiSettings.rateMain,
      sulv2: apiSettings.ratePersonal,
      sulv3: apiSettings.rateErotic,
      sulv4: apiSettings.rateCuckold,
      $5: outlineTableContent, // [升级] $5专门用于总体/总结大纲表内容（含表头）
      $6: lastPlotContent, // [新增] 添加$6占位符及其内容
      $7: '', // [新增] $7用于前文上下文注入，稍后填充
    };

    // ---- 接力思考流程（$A1/$A2...）----
    const deepClone = obj => JSON.parse(JSON.stringify(obj));
    // 多标签提取规则：对每个标签分别取“最后一个匹配到的完整标签块”，再按标签顺序拼接
    const extractLastBlocksPerTag = (text, tagNames) => {
      if (!text || !Array.isArray(tagNames) || tagNames.length === 0) return null;
      const parts = [];
      for (const tagNameRaw of tagNames) {
        const tagName = String(tagNameRaw || '').trim();
        if (!tagName) continue;
        const safeTagName = escapeRegExp(tagName);
        const regex = new RegExp(`(<${safeTagName}[^>]*>[\\s\\S]*?<\\/${safeTagName}>)`, 'gi');
        const matches = Array.from(text.matchAll(regex));
        if (matches.length > 0) {
          const last = matches[matches.length - 1];
          const block = last?.[1] || last?.[0];
          if (block) parts.push(block);
        }
      }
      return parts.length > 0 ? parts.join('\n\n') : null;
    };
    const normalizeRelayFlows = rawFlows => {
      const flows = Array.isArray(rawFlows) ? rawFlows : [];
      const used = new Set();
      const out = [];
      for (let i = 0; i < flows.length; i++) {
        const f = flows[i];
        if (!f || typeof f !== 'object') continue;
        const id = String(f.id ?? `${Date.now()}_${i}`);
        const name = String(f.name ?? `流程 ${i + 1}`);
        let injectKey = String(f.injectKey ?? '');
        if (!injectKey || !/^\$A\d+$/.test(injectKey)) injectKey = `$A${i + 1}`;
        if (used.has(injectKey)) {
          let n = 1;
          while (used.has(`$A${n}`)) n++;
          injectKey = `$A${n}`;
        }
        used.add(injectKey);
        out.push({
          id,
          name,
          injectKey,
          enabled: f.enabled !== false,
          prompts: Array.isArray(f.prompts) ? f.prompts : [],
          lastOutput: String(f.lastOutput ?? ''),
          extractTags: String(f.extractTags ?? ''),
          apiProfileId: String(f.apiProfileId ?? ''),
        });
      }
      return out;
    };

    // 辅助函数：替换文本中的占位符
    const performReplacements = text => {
      if (!text) return '';
      let processed = text;

      // 替换 $1 (Worldbook)
      const worldbookReplacement =
        apiSettings.worldbookEnabled && worldbookContent
          ? `\n<worldbook_context>\n${worldbookContent}\n</worldbook_context>\n`
          : '';
      processed = processed.replace(/(?<!\\)\$1/g, worldbookReplacement);

      // 替换其他
      for (const key in replacements) {
        const value = replacements[key] ?? '';
        // 允许对所有以 $ 开头的占位符使用 "\$X" 进行转义（保持字面量）
        const regex = key.startsWith('$')
          ? new RegExp(`(?<!\\\\)${escapeRegExp(key)}`, 'g')
          : new RegExp(escapeRegExp(key), 'g');
        processed = processed.replace(regex, value);
      }
      return processed;
    };

    // 构建 API 消息列表
    const messages = [];
    let finalSystemDirectiveContent =
      '[SYSTEM_DIRECTIVE: You are a storyteller. The following <plot> block is your absolute script for this turn. You MUST follow the <directive> within it to generate the story.]';

    // 格式化历史记录用于注入
    const sanitizeHtml = htmlString => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlString;
      return tempDiv.textContent || tempDiv.innerText || '';
    };

    let fullHistory = [];
    if (slicedContext && Array.isArray(slicedContext)) {
      fullHistory = [...slicedContext];
    }
    if (userMessage) {
      fullHistory.push({ role: 'user', content: userMessage });
    }
    const formattedHistory = fullHistory.map(msg => `${msg.role}："${sanitizeHtml(msg.content)}"`).join(' \n ');

    // 构建$7上下文注入内容（前文上下文 + 用户输入）
    const contextInjectionText = formattedHistory && formattedHistory.trim()
      ? `以下是前文的用户记录和故事发展，给你用作参考：\n ${formattedHistory}`
      : '';
    replacements.$7 = contextInjectionText; // 设置$7的值

    // 预先载入已保存的 $A* 输出（即使本轮流程不启用，也允许基础提示词引用旧输出）
    let relayFlows = normalizeRelayFlows(apiSettings.relayFlows || []);
    relayFlows.forEach(f => {
      if (f && f.injectKey) replacements[f.injectKey] = f.lastOutput || '';
    });

    // 先执行“接力流程”，再构建基础 prompts 的 messages
    const persistRelayFlows = updatedFlows => {
      try {
        if (!extension_settings[extension_name]) extension_settings[extension_name] = {};
        if (!extension_settings[extension_name].apiSettings) extension_settings[extension_name].apiSettings = {};
        extension_settings[extension_name].apiSettings.relayFlows = deepClone(updatedFlows);

        // 如果当前启用了预设，同时把输出写回预设，以便切换预设时仍保留
        const s = extension_settings[extension_name];
        const presetName = s?.lastUsedPresetName;
        const presetsAll = s?.promptPresets;
        if (presetName && Array.isArray(presetsAll)) {
          const idx = presetsAll.findIndex(p => p && p.name === presetName);
          if (idx !== -1) {
            presetsAll[idx].relayFlows = deepClone(updatedFlows);
          }
        }
        saveSettings();
      } catch (e) {
        console.warn(`[${extension_name}] 保存接力流程输出失败:`, e);
      }
    };

    if (relayFlows.some(f => f.enabled)) {
      // 复用相同 abortSignal；API 参数允许按流程选择 profile 覆盖
      const getApiProfileOverrides = profileId => {
        try {
          const s = extension_settings[extension_name] || {};
          const list = Array.isArray(s.apiProfiles) ? s.apiProfiles : [];
          const found = list.find(p => p && String(p.id) === String(profileId));
          const overrides = found?.settings && typeof found.settings === 'object' ? found.settings : null;
          return overrides;
        } catch (e) {
          return null;
        }
      };

      for (let i = 0; i < relayFlows.length; i++) {
        const flow = relayFlows[i];
        if (!flow.enabled) continue;
        if (wasStoppedByUser_QRF) throw new Error('TaskAbortedByUser');

        $toast.find('.toastr-message').text(`正在规划剧情... (接力流程：${flow.injectKey})`);

        const flowMessages = [];
        const flowPrompts = Array.isArray(flow.prompts) ? flow.prompts : [];
        for (const p of flowPrompts) {
          // 与基础提示词一致：finalSystemDirective 仅用于主AI注入，不发送给规划AI
          if (p && p.id === 'finalSystemDirective') continue;
          // flow-editor 不需要 finalSystemDirective 特例；这里按普通消息发送
          const content = performReplacements(p.content);
          flowMessages.push({ role: p.role || 'system', content });
        }

        const overrides = flow.apiProfileId ? getApiProfileOverrides(flow.apiProfileId) : null;
        const flowApiSettings = { ...apiSettings, ...(overrides || {}), extractTags: '' };
        const flowResult = await callInterceptionApi(flowMessages, flowApiSettings, currentAbortController_QRF?.signal);
        // null 表示中止或错误：不覆盖旧输出
        if (flowResult !== null && flowResult !== undefined) {
          // 每个流程可配置独立的标签摘取：注入/保存的是提取后的内容；留空则保存全量
          let injected = String(flowResult);
          const flowTagsToExtract = String(flow.extractTags || '').trim();
          if (flowTagsToExtract) {
            const tagNames = flowTagsToExtract
              .split(',')
              .map(t => t.trim())
              .filter(Boolean);
            const extracted = extractLastBlocksPerTag(injected, tagNames);
            if (extracted) {
              injected = extracted;
            }
          }

          relayFlows[i].lastOutput = injected;
          // 写入占位符，供后续流程 / 基础提示词使用
          replacements[flow.injectKey] = relayFlows[i].lastOutput;
          persistRelayFlows(relayFlows);
        }
      }
    }

    const prompts = apiSettings.prompts || [];

    // 遍历提示词列表构建消息
    for (const prompt of prompts) {
      const processedContent = performReplacements(prompt.content);

      // 特殊处理: finalSystemDirective 仅用于提取，不发送给API
      if (prompt.id === 'finalSystemDirective') {
        finalSystemDirectiveContent = processedContent;
        continue;
      }

      // [修改] 移除硬编码的上下文注入，现在通过$7占位符在提示词中自由控制位置
      messages.push({
        role: prompt.role || 'system', // 默认为 system
        content: processedContent,
      });
    }

    const finalApiSettings = { ...apiSettings, extractTags: apiSettings.extractTags };
    const minLength = settings.minLength || 0;
    let processedMessage = null;
    const maxRetries = 3;

    // 检查中止信号的帮助函数
    const checkAbort = () => {
        if (currentAbortController_QRF && currentAbortController_QRF.signal.aborted) {
            throw new Error('TaskAbortedByUser');
        }
    };

    // 如果规划走“酒馆主API(generateRaw)”路径，会触发一次 GENERATION_ENDED，需要精确忽略
    const willUseMainApiGenerateRaw = finalApiSettings.apiMode !== 'tavern' && !!finalApiSettings.useMainApi;

    if (minLength > 0) {
      for (let i = 0; i < maxRetries; i++) {
        if (wasStoppedByUser_QRF) {
          throw new Error('TaskAbortedByUser');
        }
        $toast.find('.toastr-message').text(`正在规划剧情... (尝试 ${i + 1}/${maxRetries})`);
        
        if (willUseMainApiGenerateRaw) {
          planningGuard.ignoreNextGenerationEndedCount++;
        }

        // 直接传递构建好的 messages 数组
        const tempMessage = await callInterceptionApi(messages, finalApiSettings, currentAbortController_QRF?.signal);
        if (tempMessage && tempMessage.length >= minLength) {
          processedMessage = tempMessage;
          if ($toast) toastr.clear($toast);
          toastr.success(`剧情规划成功 (第 ${i + 1} 次尝试)。`, '成功');
          break;
        }
        if (i < maxRetries - 1) {
          toastr.warning(`回复过短，准备重试...`, '剧情规划大师', { timeOut: 2000 });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } else {
      if (wasStoppedByUser_QRF) {
        throw new Error('TaskAbortedByUser');
      }
      if (willUseMainApiGenerateRaw) {
        planningGuard.ignoreNextGenerationEndedCount++;
      }
      processedMessage = await callInterceptionApi(messages, finalApiSettings, currentAbortController_QRF?.signal);
    }

    if (processedMessage) {
      // [架构重构] 将本次优化结果暂存（保存完整回复）
      tempPlotToSave = processedMessage;

      // [新功能] 标签摘取逻辑
      let messageForTavern = processedMessage; // 默认使用完整回复
      const tagsToExtract = (finalApiSettings.extractTags || '').trim();

      if (tagsToExtract) {
        const tagNames = tagsToExtract
          .split(',')
          .map(t => t.trim())
          .filter(t => t);
        if (tagNames.length > 0) {
          const extracted = extractLastBlocksPerTag(processedMessage, tagNames);
          if (extracted) {
            messageForTavern = extracted;
            console.log(`[${extension_name}] 成功按标签分别摘取最后一次匹配: ${tagNames.join(', ')}`);
            toastr.info(`已成功按标签分别摘取最后一次匹配并注入。`, '标签摘取');
          } else {
            console.log(`[${extension_name}] 在回复中未找到指定标签: ${tagNames.join(', ')}`);
          }
        }
      }

      // 使用可能被处理过的 messageForTavern 构建最终消息
      const finalMessage = `${userMessage}\n\n${finalSystemDirectiveContent}\n${messageForTavern}`;

      if ($toast) toastr.clear($toast);
      if (minLength <= 0) {
        toastr.success('剧情规划大师已完成规划。', '规划成功');
      }
      return finalMessage;
    } else {
      if ($toast) toastr.clear($toast);
      if (minLength > 0) {
        toastr.error(`重试 ${maxRetries} 次后回复依然过短，操作已取消。`, '规划失败');
      }
      return null;
    }
  } catch (error) {
    if (error?.message === 'TaskAbortedByUser') {
      // 用户主动终止：正常流程，不提示"规划失败"
      if ($toast) toastr.clear($toast);
      return null;
    }
    console.error(`[${extension_name}] 在核心优化逻辑中发生错误:`, error);
    if ($toast) toastr.clear($toast);
    toastr.error('剧情规划大师在处理时发生错误。', '规划失败');
    return null;
  } finally {
      planningGuard.inProgress = false;
      currentAbortController_QRF = null;
  }
}

async function onGenerationAfterCommands(type, params, dryRun) {
  // 如果消息已被TavernHelper钩子处理，则跳过
  if (params?._qrf_processed_by_hook) {
    return;
  }

  const settings = extension_settings[extension_name] || {};
  if (type === 'regenerate' || isProcessing || dryRun || !settings.enabled) {
    return;
  }

  const context = getContext();

  // [策略1] 检查最新的聊天消息 (主要用于 /send 等命令，这些命令会先创建消息再触发生成)
  if (context && context.chat && context.chat.length > 0) {
    const lastMessageIndex = context.chat.length - 1;
    const lastMessage = context.chat[lastMessageIndex];

    // If the last message is a new user message, process it.
    if (lastMessage && lastMessage.is_user && !lastMessage._qrf_processed) {
      lastMessage._qrf_processed = true; // Prevent reprocessing

      const messageToProcess = lastMessage.mes;
      if (messageToProcess && messageToProcess.trim().length > 0) {
        isProcessing = true;
        try {
          // [关键] 如果是在循环模式下，给消息打上规划标记，以便循环检测时忽略
          const isLoopTriggered = loopState.isLooping && loopState.awaitingReply;
          if (isLoopTriggered) {
            lastMessage._qrf_from_planning = true;
            console.log(`[${extension_name}] [Loop] 标记规划层消息: _qrf_from_planning=true`);
          }

          const finalMessage = await runOptimizationLogic(messageToProcess);
          
          if (finalMessage && finalMessage.aborted) {
            // [策略1] 如果被中止，我们应该怎么做？
            // 此时消息已经发送到聊天记录了（lastMessage），我们可能无法"撤回"它，
            // 除非我们删除它。但通常 /send 已经发生了。
            // 对于 Strategy 1，abort 可能只能停止生成，但消息保留。
            // 或者我们可以尝试不做任何替换，让其自然结束。
            console.log(`[${extension_name}] Generation aborted by user in Strategy 1.`);
            return;
          }

          if (finalMessage && typeof finalMessage === 'string') {
            params.prompt = finalMessage; // Inject into generation
            lastMessage.mes = finalMessage; // Update chat history

            // [UI修复] 发送消息更新事件以刷新UI
            eventSource.emit(event_types.MESSAGE_UPDATED, lastMessageIndex);

            // Clean the textarea if it contains the original text
            if ($('#send_textarea').val() === messageToProcess) {
              $('#send_textarea').val('');
              $('#send_textarea').trigger('input');
            }
          }
        } catch (error) {
          console.error(`[${extension_name}] Error processing last chat message:`, error);
          delete lastMessage._qrf_processed; // Allow retry on error
        } finally {
          isProcessing = false;
        }
        return; // Strategy 1 was successful, so we stop here.
      }
    }
  }

  // [策略2] 检查主输入框 (用于用户在UI中直接输入并点击发送)
  const textInBox = $('#send_textarea').val();
  if (textInBox && textInBox.trim().length > 0) {
    isProcessing = true;
    try {
      const finalMessage = await runOptimizationLogic(textInBox);
      
      if (finalMessage && finalMessage.aborted) {
          console.log(`[${extension_name}] Generation aborted by user in Strategy 2.`);
          return;
      }

      if (finalMessage && typeof finalMessage === 'string') {
        $('#send_textarea').val(finalMessage);
        $('#send_textarea').trigger('input');
      }
    } catch (error) {
      console.error(`[${extension_name}] Error processing textarea input:`, error);
    } finally {
      isProcessing = false;
    }
  }
}

function loadPluginStyles() {
  const styleId = `${extension_name}-style`;
  if (document.getElementById(styleId)) return;
  const styleUrl = `scripts/extensions/third-party/${extension_name}/style.css?v=${Date.now()}`;
  const linkElement = document.createElement('link');
  linkElement.id = styleId;
  linkElement.rel = 'stylesheet';
  linkElement.type = 'text/css';
  linkElement.href = styleUrl;
  document.head.appendChild(linkElement);
}

jQuery(async () => {
  // [彻底修复] 执行一个健壮的、非破坏性的设置初始化。
  // 此方法会保留所有用户已保存的设置，仅当设置项不存在时才从默认值中添加。
  if (!extension_settings[extension_name]) {
    extension_settings[extension_name] = {};
  }
  const settings = extension_settings[extension_name];

  // 确保 apiSettings 子对象存在
  if (!settings.apiSettings) {
    settings.apiSettings = {};
  }

  // 1. 遍历并应用顶层设置的默认值
  for (const key in defaultSettings) {
    if (key !== 'apiSettings' && settings[key] === undefined) {
      settings[key] = defaultSettings[key];
    }
  }

  // 2. 遍历并应用 apiSettings 的默认值
  const defaultApiSettings = defaultSettings.apiSettings;
  for (const key in defaultApiSettings) {
    if (settings.apiSettings[key] === undefined) {
      settings.apiSettings[key] = defaultApiSettings[key];
    }
  }

  // [新功能] 迁移旧设置到新的 prompts 数组
  if (!settings.apiSettings.prompts || settings.apiSettings.prompts.length === 0) {
    console.log(`[${extension_name}] Migrating legacy prompts to new format...`);
    // 检查旧设置是否存在
    const oldMain = settings.apiSettings.mainPrompt;

    // 如果连 mainPrompt 都没有，就使用默认值
    if (!oldMain) {
      settings.apiSettings.prompts = JSON.parse(JSON.stringify(defaultSettings.apiSettings.prompts));
    } else {
      // 使用现有设置构建
      settings.apiSettings.prompts = [
        {
          id: 'mainPrompt',
          name: '主系统提示词 (通用)',
          role: 'system',
          content: settings.apiSettings.mainPrompt || '',
          deletable: false,
        },
        {
          id: 'systemPrompt',
          name: '拦截任务详细指令',
          role: 'user',
          content: settings.apiSettings.systemPrompt || '',
          deletable: false,
        },
        {
          id: 'finalSystemDirective',
          name: '最终注入指令 (Storyteller Directive)',
          role: 'system',
          content: settings.apiSettings.finalSystemDirective || '',
          deletable: false,
        },
      ];
    }
    saveSettings();
  }

  // 确保新增的顶层设置有默认值
  if (settings.minLength === undefined) {
    settings.minLength = 0;
  }

  // 首次加载时，执行一次预设加载和数据清理
  loadPresetAndCleanCharacterData();

  const intervalId = setInterval(async () => {
    // 确保UI和TavernHelper都已加载
    if ($('#extensions_settings').length > 0 && window.TavernHelper) {
      clearInterval(intervalId);
      try {
        loadPluginStyles();
        await createDrawer();

        // [并行方案1] 恢复猴子补丁以拦截直接的JS调用
        if (!window.original_TavernHelper_generate) {
          window.original_TavernHelper_generate = TavernHelper.generate;
        }
        TavernHelper.generate = async function (...args) {
          const options = args[0] || {};
          const settings = extension_settings[extension_name] || {};

          if (!settings.enabled || isProcessing || options.should_stream) {
            return window.original_TavernHelper_generate.apply(this, args);
          }

          let userMessage = options.user_input || options.prompt;
          if (options.injects?.[0]?.content) {
            userMessage = options.injects[0].content;
          }

          if (userMessage) {
            isProcessing = true;
            try {
              const finalMessage = await runOptimizationLogic(userMessage);

              // [新增] 如果处于自动循环且规划未返回有效字符串，视为规划失败，按循环重试次数重试
              if (loopState.isLooping && loopState.awaitingReply && (!finalMessage || typeof finalMessage !== 'string')) {
                console.warn(`[${extension_name}] [Loop] 规划未产生有效回复，按循环重试规则重试。`);
                const loopSettings = (extension_settings[extension_name] || {}).loopSettings || defaultSettings.loopSettings;
                loopState.awaitingReply = false; // 结束本轮等待
                await enterLoopRetryFlow({ loopSettings, shouldDeleteAiReply: false });
                return; // 不调用原始生成
              }

              // 检查是否被中止 (返回了带有 aborted: true 的对象)
              if (finalMessage && finalMessage.aborted) {
                 console.log(`[${extension_name}] Generation aborted by user.`);
                 return; // 直接返回，不调用原始生成，从而保留用户输入
              }

              if (finalMessage && typeof finalMessage === 'string') {
                // 根据来源写回
                if (options.injects?.[0]?.content) {
                  options.injects[0].content = finalMessage;
                } else if (options.prompt) {
                  options.prompt = finalMessage;
                } else {
                  options.user_input = finalMessage;
                }
                // 添加标志，防止 GENERATION_AFTER_COMMANDS 重复处理
                options._qrf_processed_by_hook = true;
              }
            } catch (error) {
              console.error(`[${extension_name}] Error in TavernHelper.generate hook:`, error);
            } finally {
              isProcessing = false;
            }
          }

          return window.original_TavernHelper_generate.apply(this, args);
        };

        // [并行方案2] 注册事件监听器
        if (!window.qrfEventsRegistered) {
          // 核心拦截点：处理主输入框和 /send 命令
          eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onGenerationAfterCommands);

          // 辅助功能
          eventSource.on(event_types.GENERATION_ENDED, savePlotToLatestMessage);
          
          // [新功能] 循环检测：使用 GENERATION_ENDED 事件，通过规划标记来区分规划层和AI回复层
          eventSource.on(event_types.GENERATION_ENDED, onLoopGenerationEnded);

          eventSource.on(event_types.CHAT_CHANGED, () => {
              loadPresetAndCleanCharacterData();
              // 切换聊天时停止循环
              if (loopState.isLooping) {
                  stopAutoLoop();
                  toastr.info('切换聊天，自动化循环已停止。');
              }
          });
          
          // [新功能] 监听来自 bindings.js 的控制事件
          eventSource.on('qrf-start-loop', startAutoLoop);
          eventSource.on('qrf-stop-loop', stopAutoLoop);

          window.qrfEventsRegistered = true;
          console.log(`[${extension_name}] Parallel event listeners registered.`);
        }

        // [修复] 全局委托绑定中止按钮点击事件，确保按钮始终可点击
        $(document).off('click', '.qrf-abort-btn').on('click', '.qrf-abort-btn', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (currentAbortController_QRF) {
                currentAbortController_QRF.abort();
                console.log(`[${extension_name}] 用户手动中止了规划任务。`);
                
                // [新增] 尝试发送停止指令给后端
                if (window.SillyTavern && window.SillyTavern.stopGeneration) {
                     window.SillyTavern.stopGeneration();
                } else {
                     // Fallback slash command
                     window.TavernHelper.triggerSlash('/stop');
                }

                // 强制移除特定的 toast 元素
                const $abortToast = $('.toast-info:has(.qrf-abort-btn)');
                if ($abortToast.length > 0) {
                    toastr.remove(); // 移除当前显示的 toast，无动画
                    $abortToast.remove(); // 双重保险：直接从 DOM 移除
                } else {
                    toastr.remove();
                }
                
                isProcessing = false; // 强制释放锁
                // 延迟显示中止提示，确保之前的 toast 已消失
                setTimeout(() => {
                    toastr.warning('规划任务已中止。');
                }, 100);
            }
        });
      } catch (error) {
        console.error(`[${extension_name}] Initialization failed:`, error);
        if (window.original_TavernHelper_generate) {
          TavernHelper.generate = window.original_TavernHelper_generate;
        }
      }
    }
  }, 100);
});
