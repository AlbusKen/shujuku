// 剧情优化大师 - UI数据绑定模块
// 由Cline参照 '优化/' 插件的健壮性实践重构

import { fetchModels, testApiConnection } from '../api.js';
import { defaultSettings, extensionName } from '../utils/settings.js';

/**
 * [新增] 辅助函数：检查条目是否包含屏蔽词（与lore.js中的函数保持一致）
 * @param {object} entry - 世界书条目对象
 * @returns {boolean} - 如果包含屏蔽词返回true
 */
function isEntryBlocked_ACU(entry) {
  if (!entry) return false;
  const blockedKeywords = ["规则", "思维链", "cot", "MVU", "mvu", "变量", "状态", "Status", "Rule", "rule", "检定", "判断", "叙事", "文风", "InitVar", "格式"];
  const name = entry.comment || entry.name || '';
  return blockedKeywords.some(keyword => name.includes(keyword));
}
import {
  characters,
  eventSource,
  event_types,
  getRequestHeaders,
  saveSettingsDebounced,
  saveSettings as saveSettingsImmediate,
  this_chid,
} from '/script.js';
import { extension_settings, getContext } from '/scripts/extensions.js';

/**
 * 手动触发所有设置的保存。
 * 这对于在关闭面板等事件时确保数据被保存非常有用。
 */
export async function saveAllSettings() {
  const panel = $('#qrf_settings_panel');
  if (panel.length === 0) return;

  console.log(`[${extensionName}] 手动触发所有设置的保存...`);

  // 触发所有相关输入元素的change事件，以利用现有的保存逻辑
  panel
    .find('input[type="checkbox"], input[type="radio"], input[type="text"], input[type="password"], textarea, select')
    .trigger('change.qrf');

  // 对于滑块，input事件可能更合适，但change也应在值改变后触发
  panel.find('input[type="range"]').trigger('change.qrf');

  // 确保世界书条目也被保存
  await saveDisabledEntries();
  
  // 确保提示词列表被保存 (虽然它们会在change时自动保存)
  await savePrompts();

  toastr.info('设置已自动保存。');
}

/**
 * 将下划线或连字符命名的字符串转换为驼峰命名。
 * e.g., 'qrf_api_url' -> 'qrfApiUrl'
 * @param {string} str - 输入字符串。
 * @returns {string} - 驼峰格式字符串。
 */
function toCamelCase(str) {
  return str.replace(/[-_]([a-z])/g, g => g[1].toUpperCase());
}

const blockedKeywords = ['规则', '思维链', 'cot', 'MVU', 'mvu', '变量', '状态', 'Status', 'Rule', 'rule', '检定', '判断', '叙事', '文风'];
function isEntryBlocked(entry) {
  const name = entry?.comment || entry?.name || '';
  return blockedKeywords.some(keyword => name.includes(keyword));
}

/**
 * 根据选择的API模式，更新URL输入框的可见性并自动填充URL。
 * @param {JQuery} panel - 设置面板的jQuery对象。
 * @param {string} apiMode - 当前选择的API模式 ('backend', 'frontend', 或 'google')。
 */
function updateApiUrlVisibility(panel, apiMode) {
  const customApiSettings = panel.find('#qrf_custom_api_settings_block');
  const tavernProfileSettings = panel.find('#qrf_tavern_api_profile_block');
  const apiUrlInput = panel.find('#qrf_api_url');

  // Hide all blocks first
  customApiSettings.hide();
  tavernProfileSettings.hide();

  if (apiMode === 'tavern') {
    tavernProfileSettings.show();
  } else {
    customApiSettings.show();
    if (apiMode === 'google') {
      panel.find('#qrf_api_url_block').hide();
      const googleUrl = 'https://generativelanguage.googleapis.com';
      if (apiUrlInput.val() !== googleUrl) {
        apiUrlInput.val(googleUrl).trigger('change');
      }
    } else {
      panel.find('#qrf_api_url_block').show();
    }
  }
}

/**
 * 根据选择的世界书来源，显示或隐藏手动选择区域。
 * @param {JQuery} panel - 设置面板的jQuery对象。
 * @param {string} source - 当前选择的来源 ('character' or 'manual')。
 */
function updateWorldbookSourceVisibility(panel, source) {
  const manualSelectionWrapper = panel.find('#qrf_worldbook_select_wrapper');
  if (source === 'manual') {
    manualSelectionWrapper.show();
  } else {
    manualSelectionWrapper.hide();
  }
}

/**
 * 加载SillyTavern的API连接预设到下拉菜单。
 * @param {JQuery} panel - 设置面板的jQuery对象。
 */
async function loadTavernApiProfiles(panel) {
  const select = panel.find('#qrf_tavern_api_profile_select');
  const apiSettings = getMergedApiSettings();
  const currentProfileId = apiSettings.tavernProfile;

  // 保存当前值，清空并添加默认选项
  const currentValue = select.val();
  select.empty().append(new Option('-- 请选择一个酒馆预设 --', ''));

  try {
    const tavernProfiles = getContext().extensionSettings?.connectionManager?.profiles || [];
    if (!tavernProfiles || tavernProfiles.length === 0) {
      select.append($('<option>', { value: '', text: '未找到酒馆预设', disabled: true }));
      return;
    }

    let foundCurrentProfile = false;
    tavernProfiles.forEach(profile => {
      if (profile.api && profile.preset) {
        // 确保是有效的API预设
        const option = $('<option>', {
          value: profile.id,
          text: profile.name || profile.id,
          selected: profile.id === currentProfileId,
        });
        select.append(option);
        if (profile.id === currentProfileId) {
          foundCurrentProfile = true;
        }
      }
    });

    // 如果之前保存的ID无效了，给出提示
    if (currentProfileId && !foundCurrentProfile) {
      toastr.warning(`之前选择的酒馆预设 "${currentProfileId}" 已不存在，请重新选择。`);
      saveSetting('tavernProfile', '');
    } else if (foundCurrentProfile) {
      select.val(currentProfileId);
    }
  } catch (error) {
    console.error(`[${extensionName}] 加载酒馆API预设失败:`, error);
    toastr.error('无法加载酒馆API预设列表，请查看控制台。');
  }
}

/**
 * 根据选择的世界书来源，显示或隐藏手动选择区域。
 * @param {JQuery} panel - 设置面板的jQuery对象。
 * @param {string} source - 当前选择的来源 ('character' or 'manual')。
 */
// ---- 新的、支持角色卡独立配置的设置保存/加载逻辑 ----

// 需要保存到角色卡的设置项列表
const characterSpecificSettings = ['worldbookSource', 'selectedWorldbooks', 'disabledWorldbookEntries', '_legacyEntriesMigrated'];

/**
 * 保存单个设置项。
 * 根据设置项的键名，决定是保存到全局设置还是当前角色卡。
 * @param {string} key - 设置项的键（驼峰式）。
 * @param {*} value - 设置项的值。
 */
async function saveSetting(key, value) {
  if (characterSpecificSettings.includes(key)) {
    // --- 保存到角色卡 ---
    const character = characters[this_chid];
    if (!character) {
      // 在没有角色卡的情况下，静默失败，不保存角色特定设置
      return;
    }

    if (!character.data.extensions) character.data.extensions = {};
    if (!character.data.extensions[extensionName]) character.data.extensions[extensionName] = {};
    if (!character.data.extensions[extensionName].apiSettings)
      character.data.extensions[extensionName].apiSettings = {};

    character.data.extensions[extensionName].apiSettings[key] = value;

    // 使用SillyTavern的API来异步保存角色数据
    try {
      const response = await fetch('/api/characters/merge-attributes', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
          avatar: character.avatar,
          data: { extensions: { [extensionName]: character.data.extensions[extensionName] } },
        }),
      });

      if (!response.ok) {
        throw new Error(`API call failed with status: ${response.status}`);
      }
      console.log(`[${extensionName}] 角色卡设置已更新: ${key} ->`, value);
    } catch (error) {
      console.error(`[${extensionName}] 保存角色数据失败:`, error);
      toastr.error('无法保存角色卡设置，请检查控制台。');
    }
  } else {
    // --- 保存到全局设置 (旧逻辑) ---
    if (!extension_settings[extensionName]) {
      extension_settings[extensionName] = {};
    }

    const apiSettingKeys = Object.keys(defaultSettings.apiSettings);
    if (apiSettingKeys.includes(key)) {
      if (!extension_settings[extensionName].apiSettings) {
        extension_settings[extensionName].apiSettings = {};
      }
      extension_settings[extensionName].apiSettings[key] = value;
    } else {
      extension_settings[extensionName][key] = value;
    }

    console.log(`[${extensionName}] 全局设置已更新: ${key} ->`, value);
    saveSettingsDebounced();

    // [最终修复] 在保存全局设置时，主动、同步地清除角色卡上的同名陈旧设置
    const character = characters[this_chid];
    if (character?.data?.extensions?.[extensionName]?.apiSettings?.[key] !== undefined) {
      delete character.data.extensions[extensionName].apiSettings[key];

      // 使用 await 强制等待保存操作完成，彻底消除竞争条件
      try {
        const response = await fetch('/api/characters/merge-attributes', {
          method: 'POST',
          headers: getRequestHeaders(),
          body: JSON.stringify({
            avatar: character.avatar,
            data: { extensions: { [extensionName]: character.data.extensions[extensionName] } },
          }),
        });

        if (response.ok) {
          console.log(`[${extensionName}] 已成功从角色卡中同步清除陈旧设置: ${key}`);
        } else {
          throw new Error(`API call failed with status: ${response.status}`);
        }
      } catch (error) {
        console.error(`[${extensionName}] 同步清除角色卡陈旧设置失败:`, error);
      }
    }
  }
}

/**
 * 获取合并后的设置对象。
 * 以全局设置为基础，然后用当前角色卡的设置覆盖它。
 * @returns {object} - 合并后的apiSettings对象。
 */
function getMergedApiSettings() {
  const character = characters[this_chid];
  const globalSettings = extension_settings[extensionName]?.apiSettings || defaultSettings.apiSettings;
  const characterSettings = character?.data?.extensions?.[extensionName]?.apiSettings || {};

  // [关键修复] 确保角色特定的设置（如 disabledWorldbookEntries）总是使用角色卡上的值
  const mergedSettings = { ...globalSettings, ...characterSettings };

  // 对于角色特定设置，确保角色卡设置优先
  characterSpecificSettings.forEach(key => {
    // [关键修复] 使用 hasOwnProperty 检查，确保即使是空对象 {} 也能被正确识别
    if (characterSettings.hasOwnProperty(key)) {
      mergedSettings[key] = characterSettings[key];
    }
  });
  
  // 确保 prompts 存在
  if (!mergedSettings.prompts || mergedSettings.prompts.length === 0) {
      // 尝试使用 globalSettings (如果 characterSettings 覆盖了 prompts 但为空)
      if (globalSettings.prompts && globalSettings.prompts.length > 0) {
          mergedSettings.prompts = globalSettings.prompts;
      } else {
          // 最后的 fallback
          mergedSettings.prompts = JSON.parse(JSON.stringify(defaultSettings.apiSettings.prompts));
      }
  }

  return mergedSettings;
}

/**
 * [新增] 清除当前角色卡上所有陈旧的、与提示词相关的设置。
 * 这是为了防止旧的角色卡数据覆盖新加载的全局预设。
 */
/**
 * [新增] 清除当前角色卡上所有陈旧的、本应是全局的设置。
 * 这是为了防止旧的角色卡数据覆盖新的全局设置。
 * @param {'prompts' | 'api'} type - 要清除的设置类型。
 */
async function clearCharacterStaleSettings(type) {
  const character = characters[this_chid];
  if (!character?.data?.extensions?.[extensionName]?.apiSettings) {
    return; // 没有角色或没有设置可清除。
  }

  const charApiSettings = character.data.extensions[extensionName].apiSettings;
  let keysToClear = [];
  let message = '';

  if (type === 'prompts') {
    keysToClear = [
      'mainPrompt',
      'systemPrompt',
      'finalSystemDirective',
      'prompts',
      'rateMain',
      'ratePersonal',
      'rateErotic',
      'rateCuckold',
    ];
    message = '陈旧提示词设置';
  } else if (type === 'api') {
    // 清除所有非角色特定的API设置
    const allApiKeys = Object.keys(defaultSettings.apiSettings);
    keysToClear = allApiKeys.filter(key => !characterSpecificSettings.includes(key));
    message = '陈旧API连接设置';
  }

  if (keysToClear.length === 0) return;

  let settingsCleared = false;
  keysToClear.forEach(key => {
    if (charApiSettings[key] !== undefined) {
      delete charApiSettings[key];
      settingsCleared = true;
    }
  });

  if (settingsCleared) {
    try {
      const response = await fetch('/api/characters/merge-attributes', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
          avatar: character.avatar,
          data: { extensions: { [extensionName]: { apiSettings: charApiSettings } } },
        }),
      });
      if (!response.ok) throw new Error(`API call failed with status: ${response.status}`);
      console.log(`[${extensionName}] 已成功清除当前角色卡的${message}。`);
    } catch (error) {
      console.error(`[${extensionName}] 清除角色${message}失败:`, error);
      toastr.error(`无法清除角色卡上的${message}。`);
    }
  }
}

// ---- 世界书逻辑 ----
async function loadWorldbooks(panel) {
  const select = panel.find('#qrf_selected_worldbooks');
  const apiSettings = getMergedApiSettings(); // 使用合并后的设置
  const currentSelection = apiSettings.selectedWorldbooks || [];
  select.empty();

  try {
    const lorebooks = await window.TavernHelper.getLorebooks();
    if (!lorebooks || lorebooks.length === 0) {
      select.append($('<option>', { value: '', text: '未找到世界书', disabled: true }));
      return;
    }

    lorebooks.forEach(name => {
      const option = $('<option>', {
        value: name,
        text: name,
        selected: currentSelection.includes(name),
      });
      select.append(option);
    });
  } catch (error) {
    console.error(`[${extensionName}] 加载世界书失败:`, error);
    toastr.error('无法加载世界书列表，请查看控制台。');
  }
}

// 导出 loadWorldbookEntries 供 drawer.js 动态导入使用
export async function loadWorldbookEntries(panel) {
  const container = panel.find('#qrf_worldbook_entry_list_container');
  const countDisplay = panel.find('#qrf_worldbook_entry_count');
  container.html('<p>加载条目中...</p>');
  countDisplay.text('');

  const apiSettings = getMergedApiSettings(); // 使用合并后的设置
  const currentSource = apiSettings.worldbookSource || 'character';
  let bookNames = [];

  if (currentSource === 'manual') {
    bookNames = apiSettings.selectedWorldbooks || [];
  } else {
    // 修复：在尝试获取角色世界书之前，先检查是否已加载角色
    if (this_chid === -1 || !characters[this_chid]) {
      container.html('<p class="notes">未选择角色。</p>');
      countDisplay.text('');
      return; // 没有角色，直接返回，不弹窗
    }
    try {
      const charLorebooks = await window.TavernHelper.getCharLorebooks({ type: 'all' });
      if (charLorebooks.primary) bookNames.push(charLorebooks.primary);
      if (charLorebooks.additional?.length) bookNames.push(...charLorebooks.additional);
    } catch (error) {
      // 只有在确实有角色但加载失败时才报错
      console.error(`[${extensionName}] 获取角色世界书失败:`, error);
      toastr.error('获取角色世界书失败。');
      container.html('<p class="notes" style="color:red;">获取角色世界书失败。</p>');
      return;
    }
  }

  const selectedBooks = bookNames;
  // [关键修复] 直接从角色卡获取最新的 disabledWorldbookEntries 设置，而不是使用合并后的设置
  // 这是因为 disabledWorldbookEntries 是角色特定设置，不应该被全局设置覆盖
  let disabledEntries = {};
  let isAllSelected = true; // 默认全选

  if (this_chid !== -1 && characters[this_chid]?.data?.extensions?.[extensionName]?.apiSettings) {
    const charSettings = characters[this_chid].data.extensions[extensionName].apiSettings;
    // [关键修复] 明确检查 disabledWorldbookEntries 是否存在，即使是空对象 {}
    if (charSettings.hasOwnProperty('disabledWorldbookEntries')) {
      const disabledValue = charSettings.disabledWorldbookEntries;
      // [关键修复] 检查是否是特殊符号标识的全选状态
      if (disabledValue === '__ALL_SELECTED__') {
        isAllSelected = true;
        disabledEntries = {}; // 使用空对象，但通过 isAllSelected 标识来处理
      } else {
        isAllSelected = false;
        disabledEntries = disabledValue || {};
      }
    }
  }
  let totalEntries = 0;
  let visibleEntries = 0;

  if (selectedBooks.length === 0) {
    container.html('<p class="notes">请选择一个或多个世界书以查看其条目。</p>');
    return;
  }

  try {
    const allEntries = [];
    for (const bookName of selectedBooks) {
      const entries = await window.TavernHelper.getLorebookEntries(bookName);
      entries.forEach(entry => {
        if (isEntryBlocked(entry)) return;
        allEntries.push({ ...entry, bookName });
      });
    }

    container.empty();
    totalEntries = allEntries.length;

    // [新功能] 迁移逻辑：首次加载时，将当前所有条目设为未选中（加入禁用列表），
    // 从而实现"默认全不勾选，新增条目自动勾选"的效果。
    if (this_chid !== -1 && characters[this_chid]) {
        const charSettings = characters[this_chid].data?.extensions?.[extensionName]?.apiSettings || {};
        
        // 检查是否已经迁移过
        if (!charSettings._legacyEntriesMigrated) {
            console.log(`[${extensionName}] 检测到首次运行新逻辑，正在将现有条目迁移为"未选中"状态...`);
            
            const newDisabledEntries = {};
            // 将所有找到的条目加入禁用列表，但排除被屏蔽的条目
            allEntries.forEach(entry => {
                // 检查是否被屏蔽
                const comment = entry?.comment || entry?.name || '';
                let normalizedComment = String(comment).replace(/^ACU-\[[^\]]+\]-/, '');
                normalizedComment = normalizedComment.replace(/^外部导入-(?:[^-]+-)?/, '');
                const isDbGenerated =
                  normalizedComment.startsWith('TavernDB-ACU-') ||
                  normalizedComment.startsWith('总结条目') ||
                  normalizedComment.startsWith('小总结条目') ||
                  normalizedComment.startsWith('重要人物条目');

                // 如果不是数据库生成条目且包含屏蔽词，则不加入禁用列表（因为这些条目不会在UI中显示）
                if (!isDbGenerated && isEntryBlocked_ACU(entry)) {
                  return;
                }

                if (!newDisabledEntries[entry.bookName]) {
                    newDisabledEntries[entry.bookName] = [];
                }
                newDisabledEntries[entry.bookName].push(entry.uid);
            });

            // 保存设置
            // 注意：这里需要await，但loadWorldbookEntries本身是async的
            await saveSetting('disabledWorldbookEntries', newDisabledEntries);
            await saveSetting('_legacyEntriesMigrated', true);

            // 更新当前内存中的变量，以便立即渲染正确状态
            disabledEntries = newDisabledEntries;
            isAllSelected = false;

            if (totalEntries > 0) {
                toastr.info('当前剧情推进插件已根据新策略将插件内部读取的所有世界书条目初始化为未选中状态。后续新增的条目将自动选中。（请同时使用数据库插件的用户在有旧对话的角色卡里及时重新勾选上3个索引条目！！）', '世界书状态重置', { timeOut: 10000, extendedTimeOut: 5000 });
            }
        }
    }

    if (totalEntries === 0) {
      container.html('<p class="notes">所选世界书没有条目。</p>');
      countDisplay.text('0 条目.');
      return;
    }

    // [内存优化] 使用文档片段减少DOM操作，避免内存泄漏
    const fragment = document.createDocumentFragment();

    allEntries
      .sort((a, b) => (a.comment || '').localeCompare(b.comment || ''))
      .forEach(entry => {
        // [核心优化] 如果条目在SillyTavern中是关闭的，则直接跳过，不在UI中显示
        if (!entry.enabled) return;

        // [新增] 屏蔽词过滤：在UI中隐藏被屏蔽的条目
        // 注意：UI屏蔽不同于运行时屏蔽，这里是让用户看不到这些条目
        const comment = entry?.comment || entry?.name || '';
        let normalizedComment = String(comment).replace(/^ACU-\[[^\]]+\]-/, '');
        normalizedComment = normalizedComment.replace(/^外部导入-(?:[^-]+-)?/, '');
        const isDbGenerated =
          normalizedComment.startsWith('TavernDB-ACU-') ||
          normalizedComment.startsWith('总结条目') ||
          normalizedComment.startsWith('小总结条目') ||
          normalizedComment.startsWith('重要人物条目');

        // 如果不是数据库生成条目且包含屏蔽词，则不在UI中显示
        if (!isDbGenerated && isEntryBlocked_ACU(entry)) {
          console.log(`[${extensionName}] UI中隐藏被屏蔽的条目: "${comment}"`);
          return;
        }

        const entryId = `qrf-entry-${entry.bookName.replace(/[^a-zA-Z0-9]/g, '-')}-${entry.uid}`;
        // [功能更新] 反向选择逻辑：默认全部勾选，只取消勾选那些被记录为"禁用"的条目。
        const isDisabled = disabledEntries[entry.bookName]?.includes(entry.uid);
        const isChecked = isAllSelected || !isDisabled;

        const item = document.createElement('div');
        item.className = 'qrf_worldbook_entry_item';
        item.setAttribute('data-book', entry.bookName);
        item.setAttribute('data-uid', entry.uid);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = entryId;
        checkbox.setAttribute('data-book', entry.bookName);
        checkbox.setAttribute('data-uid', entry.uid);
        if (isChecked) checkbox.checked = true;

        const label = document.createElement('label');
        label.htmlFor = entryId;
        label.title = `世界书: ${entry.bookName}\nUID: ${entry.uid}`;
        label.textContent = entry.comment || '无标题条目';

        item.appendChild(checkbox);
        item.appendChild(label);
        fragment.appendChild(item);
      });

    // [内存优化] 一次性添加所有元素，减少DOM操作
    container.empty().append(fragment);

    // [关键修复] 如果检测到全选状态，使用 requestAnimationFrame 确保DOM更新
    if (isAllSelected) {
      console.log(`[${extensionName}] 检测到全选状态，正在应用勾选...`);
      // 使用 requestAnimationFrame 替代 setTimeout，更高效且避免内存泄漏
      requestAnimationFrame(() => {
        container.find('input[type="checkbox"]').prop('checked', true);
        console.log(`[${extensionName}] 全选状态已应用，所有条目应该被勾选。`);
      });
    }

    visibleEntries = container.children().length;
    countDisplay.text(`显示 ${visibleEntries} / ${totalEntries} 条目.`);

    // 初始化筛选状态
    const filterInput = panel.find('#qrf_worldbook_entry_filter');
    if (filterInput.val().trim() !== '') {
      // 如果有筛选文本，触发筛选事件以更新显示
      filterInput.trigger('input');
    }
  } catch (error) {
    console.error(`[${extensionName}] 加载世界书条目失败:`, error);
    container.html('<p class="notes" style="color:red;">加载条目失败。</p>');
  }
}

async function saveDisabledEntries() {
  const panel = $('#qrf_settings_panel');
  let disabledEntries = {};
  const allCheckboxes = panel.find('#qrf_worldbook_entry_list_container input[type="checkbox"]');
  const totalCheckboxes = allCheckboxes.length;
  const checkedCheckboxes = allCheckboxes.filter(':checked').length;

  // [关键修复] 如果所有条目都被勾选，使用特殊符号而不是空对象
  if (totalCheckboxes > 0 && checkedCheckboxes === totalCheckboxes) {
    await saveSetting('disabledWorldbookEntries', '__ALL_SELECTED__');
    console.log(`[${extensionName}] 所有条目已勾选，保存全选状态标识。`);
    return;
  }

  // [关键修复] 如果不是全选状态，确保清除特殊符号状态
  // 这处理了用户取消勾选任意条目或使用全不选按钮的情况
  console.log(`[${extensionName}] 检测到非全选状态，正在保存实际的禁用条目列表...`);

  // [原有逻辑] 只记录未勾选的条目
  allCheckboxes.each(function () {
    const bookName = $(this).data('book');
    const uid = parseInt($(this).data('uid'));

    if (!$(this).is(':checked')) {
      if (!disabledEntries[bookName]) {
        disabledEntries[bookName] = [];
      }
      disabledEntries[bookName].push(uid);
    }
  });

  // 清理空数组，保持数据整洁
  Object.keys(disabledEntries).forEach(bookName => {
    if (disabledEntries[bookName].length === 0) {
      delete disabledEntries[bookName];
    }
  });

  // [关键修复] 使用 await 确保保存操作完成
  // 这里保存实际的禁用条目列表，会自动覆盖之前的特殊符号状态
  await saveSetting('disabledWorldbookEntries', disabledEntries);
  console.log(`[${extensionName}] 已保存禁用条目状态：`, disabledEntries);
}

// ---- 提示词 UI 逻辑 ----

/**
 * 从 UI 中读取提示词列表
 */
function getPromptsFromUI() {
    const prompts = [];
    $('#qrf_prompts_container .qrf_prompt_segment').each(function() {
        const el = $(this);
        prompts.push({
            id: el.data('id'),
            role: el.find('.qrf_prompt_role').val(),
            content: el.find('.qrf_prompt_content').val(),
            name: el.find('.qrf_prompt_name').val(),
            deletable: el.data('deletable') !== false
        });
    });
    return prompts;
}

/**
 * 保存提示词列表
 */
async function savePrompts() {
    const prompts = getPromptsFromUI();
    await saveSetting('prompts', prompts);
}

/**
 * 渲染提示词列表到 UI
 * @param {JQuery} panel 
 * @param {Array} prompts 
 */
function renderPrompts(panel, prompts) {
    const container = panel.find('#qrf_prompts_container');
    container.empty();

    prompts.forEach((prompt, index) => {
        const isDeletable = prompt.deletable !== false;
        const isFinalDirective = prompt.id === 'finalSystemDirective';
        
        let extraClass = '';
        let roleDisabled = '';
        let extraNote = '';

        if (isFinalDirective) {
            extraClass = 'qrf_special_prompt_directive';
            roleDisabled = 'disabled style="visibility: hidden;"'; // 隐藏角色选择
            extraNote = '<div class="qrf_prompt_note" style="color: #ff9800; font-size: 0.8em; margin-top: 5px;"><i class="fa-solid fa-triangle-exclamation"></i> 注意：此提示词不会发送给规划AI。它是注入给主AI的最终指令。</div>';
        }

        const segment = $(`
            <div class="qrf_prompt_segment ${extraClass}" data-id="${prompt.id}" data-deletable="${isDeletable}">
                <div class="qrf_prompt_header">
                    <input type="text" class="text_pole qrf_prompt_name" placeholder="Prompt Name" value="${prompt.name || 'Prompt ' + (index + 1)}" />
                    <select class="text_pole qrf_prompt_role" ${roleDisabled}>
                        <option value="system" ${prompt.role === 'system' ? 'selected' : ''}>System</option>
                        <option value="user" ${prompt.role === 'user' ? 'selected' : ''}>User</option>
                        <option value="assistant" ${prompt.role === 'assistant' ? 'selected' : ''}>Assistant</option>
                    </select>
                    <div class="qrf_prompt_controls">
                        <button class="menu_button qrf_prompt_up_btn" title="Move Up" ${index === 0 || isFinalDirective ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                        <button class="menu_button qrf_prompt_down_btn" title="Move Down" ${index === prompts.length - 1 || isFinalDirective ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                        <button class="menu_button qrf_prompt_delete_btn" title="Delete" ${!isDeletable ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <textarea class="text_pole qrf_prompt_content" rows="4"></textarea>
                ${extraNote}
            </div>
        `);
        
        // 使用 .val() 设置 textarea 内容以处理特殊字符
        segment.find('.qrf_prompt_content').val(prompt.content || '');

        container.append(segment);
    });
}

// ---- 接力思考流程 UI 逻辑 ----

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function normalizeRelayFlows(rawFlows) {
  const flows = Array.isArray(rawFlows) ? rawFlows : [];
  const usedKeys = new Set();
  const out = flows
    .filter(f => f && typeof f === 'object')
    .map((f, idx) => {
      const id = String(f.id ?? `${Date.now()}_${idx}`);
      const name = String(f.name ?? `流程 ${idx + 1}`);
      let injectKey = String(f.injectKey ?? '');
      if (!injectKey || !/^\$A\d+$/.test(injectKey)) {
        injectKey = `$A${idx + 1}`;
      }
      // 避免重复注入符
      if (usedKeys.has(injectKey)) {
        // 简单递增找空位
        let n = 1;
        while (usedKeys.has(`$A${n}`)) n++;
        injectKey = `$A${n}`;
      }
      usedKeys.add(injectKey);

      return {
        id,
        name,
        injectKey,
        enabled: f.enabled !== false,
        prompts: Array.isArray(f.prompts) ? f.prompts : [],
        lastOutput: String(f.lastOutput ?? ''),
        extractTags: String(f.extractTags ?? ''), // 每个流程独立的标签摘取
        apiProfileId: String(f.apiProfileId ?? ''), // 流程单独选择API配置；空=使用当前
      };
    });
  return out;
}

function getApiProfilesFromSettings() {
  const s = extension_settings[extensionName] || {};
  const profiles = Array.isArray(s.apiProfiles) ? s.apiProfiles : [];
  return profiles
    .filter(p => p && typeof p === 'object')
    .map(p => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      settings: p.settings && typeof p.settings === 'object' ? p.settings : {},
    }))
    .filter(p => p.id && p.name);
}

function loadApiProfiles(panel) {
  const select = panel.find('#qrf_api_profile_select');
  if (!select.length) return;
  const profiles = getApiProfilesFromSettings();
  const currentValue = select.val();
  select.empty().append(new Option('-- 选择一个配置 --', ''));
  profiles.forEach(p => select.append(new Option(p.name, p.id)));
  if (currentValue && profiles.some(p => p.id === currentValue)) {
    select.val(currentValue);
  } else {
    select.val('');
  }
}

function readApiSettingsFromUI(panel) {
  const apiMode = panel.find('input[name="qrf_api_mode"]:checked').val() || 'custom';
  return {
    apiMode,
    useMainApi: panel.find('#qrf_use_main_api').is(':checked'),
    apiUrl: String(panel.find('#qrf_api_url').val() || ''),
    apiKey: String(panel.find('#qrf_api_key').val() || ''),
    model: String(panel.find('#qrf_model').val() || ''),
    tavernProfile: String(panel.find('#qrf_tavern_api_profile_select').val() || ''),
    maxTokens: parseInt(panel.find('#qrf_max_tokens').val(), 10),
    temperature: parseFloat(panel.find('#qrf_temperature').val()),
    topP: parseFloat(panel.find('#qrf_top_p').val()),
    presencePenalty: parseFloat(panel.find('#qrf_presence_penalty').val()),
    frequencyPenalty: parseFloat(panel.find('#qrf_frequency_penalty').val()),
  };
}

async function applyApiProfileToCurrent(panel, profileSettings) {
  // 更新UI
  const apiMode = profileSettings.apiMode || 'custom';
  panel.find(`input[name="qrf_api_mode"][value="${apiMode}"]`).prop('checked', true);
  panel.find('#qrf_use_main_api').prop('checked', !!profileSettings.useMainApi);
  panel.find('#qrf_api_url').val(profileSettings.apiUrl ?? '');
  panel.find('#qrf_api_key').val(profileSettings.apiKey ?? '');
  panel.find('#qrf_model').val(profileSettings.model ?? '');
  panel.find('#qrf_tavern_api_profile_select').val(profileSettings.tavernProfile ?? '');
  panel.find('#qrf_max_tokens').val(profileSettings.maxTokens ?? '');
  panel.find('#qrf_temperature').val(profileSettings.temperature ?? '');
  panel.find('#qrf_top_p').val(profileSettings.topP ?? '');
  panel.find('#qrf_presence_penalty').val(profileSettings.presencePenalty ?? '');
  panel.find('#qrf_frequency_penalty').val(profileSettings.frequencyPenalty ?? '');

  // 保存到当前生效的 apiSettings
  const keys = [
    'apiMode',
    'useMainApi',
    'apiUrl',
    'apiKey',
    'model',
    'tavernProfile',
    'maxTokens',
    'temperature',
    'topP',
    'presencePenalty',
    'frequencyPenalty',
  ];
  for (const k of keys) {
    await saveSetting(k, profileSettings[k]);
  }
}

function getNextRelayInjectKey(flows) {
  const used = new Set((flows || []).map(f => String(f.injectKey || '')).filter(Boolean));
  let n = 1;
  while (used.has(`$A${n}`)) n++;
  return `$A${n}`;
}

function renderRelayFlows(panel, flows) {
  const container = panel.find('#qrf_relay_flows_container');
  if (container.length === 0) return;
  container.empty();

  const normalized = normalizeRelayFlows(flows);
  if (normalized.length === 0) {
    container.html('<div class="notes">暂无流程。点击“新增流程”创建第一套流程提示词。</div>');
    return;
  }

  const apiProfiles = getApiProfilesFromSettings();
  const apiOptionsHtml = [
    '<option value="">使用当前（跟随主设置）</option>',
    ...apiProfiles.map(p => `<option value="${p.id}">${p.name}</option>`),
  ].join('');

  normalized.forEach((flow, idx) => {
    const item = $(`
      <div class="qrf_relay_flow_item" data-id="${flow.id}">
        <div class="qrf_relay_flow_row">
          <label style="display:flex; align-items:center; gap:8px; margin:0;">
            <input type="checkbox" class="qrf_relay_flow_enabled" ${flow.enabled ? 'checked' : ''}/>
            <span class="notes">启用</span>
          </label>
          <input type="text" class="text_pole qrf_relay_flow_name" placeholder="流程名称" />
          <span class="qrf_relay_flow_badge"><code>${flow.injectKey}</code></span>
          <div class="qrf_relay_flow_controls">
            <button class="menu_button qrf_relay_flow_up" title="上移" ${idx === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
            <button class="menu_button qrf_relay_flow_down" title="下移" ${idx === normalized.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
            <button class="menu_button qrf_relay_flow_edit" title="编辑提示词"><i class="fa-solid fa-pen-to-square"></i> 编辑</button>
            <button class="menu_button qrf_relay_flow_clear" title="清空输出"><i class="fa-solid fa-eraser"></i> 清空输出</button>
            <button class="menu_button qrf_danger_btn qrf_relay_flow_delete" title="删除流程"><i class="fa-solid fa-trash"></i> 删除</button>
          </div>
        </div>
        <div class="qrf_relay_flow_row">
          <input type="text" class="text_pole qrf_relay_flow_extract_tags" placeholder="标签摘取（逗号分隔，例如 think,plot；留空=全量注入）" />
          <select class="text_pole qrf_relay_flow_api_profile_select" style="max-width: 360px;">
            ${apiOptionsHtml}
          </select>
        </div>
        <div class="qrf_relay_flow_preview"></div>
      </div>
    `);

    item.find('.qrf_relay_flow_name').val(flow.name);
    item.find('.qrf_relay_flow_extract_tags').val(flow.extractTags || '');
    item.find('.qrf_relay_flow_api_profile_select').val(flow.apiProfileId || '');
    item.find('.qrf_relay_flow_preview').text(flow.lastOutput ? flow.lastOutput : '(暂无输出)');

    container.append(item);
  });
}

function openRelayFlowEditor(flowId) {
  const url = `scripts/extensions/third-party/${extensionName}/flow-editor.html?flowId=${encodeURIComponent(flowId)}`;
  window.open(`/${url}`, `qrf_relay_flow_${flowId}`, 'width=980,height=760,resizable=yes,scrollbars=yes');
}

async function saveRelayFlows(flows) {
  const normalized = normalizeRelayFlows(flows);
  await saveSetting('relayFlows', normalized);

  // 同步写回当前激活的预设（如果有），避免重载/切换时把旧输出带回来
  try {
    const s = extension_settings[extensionName] || {};
    const presetName = s.lastUsedPresetName;
    const presets = s.promptPresets;
    if (presetName && Array.isArray(presets)) {
      const idx = presets.findIndex(p => p && p.name === presetName);
      if (idx !== -1) {
        presets[idx].relayFlows = deepClone(normalized);
        await saveSetting('promptPresets', presets);
      }
    }
  } catch (e) {
    console.warn(`[${extensionName}] 同步写回预设 relayFlows 失败:`, e);
  }

  // 立即刷新UI
  const panel = $('#qrf_settings_panel');
  if (panel.length) {
    renderRelayFlows(panel, normalized);
  }
}

function getRelayFlowsFromSettings() {
  const apiSettings = getMergedApiSettings();
  return normalizeRelayFlows(apiSettings.relayFlows || []);
}

function updateRelayFlowById(flowId, updater) {
  const flows = getRelayFlowsFromSettings();
  const idx = flows.findIndex(f => f.id === flowId);
  if (idx === -1) return null;
  const next = deepClone(flows);
  const updated = updater(next[idx]);
  next[idx] = updated || next[idx];
  return next;
}

/**
 * 加载并填充提示词预设到下拉菜单。
 * @param {JQuery} panel - 设置面板的jQuery对象。
 */
function loadPromptPresets(panel) {
  const presets = extension_settings[extensionName]?.promptPresets || [];
  const select = panel.find('#qrf_prompt_preset_select');

  const currentValue = select.val();
  select.empty().append(new Option('-- 选择一个预设 --', ''));

  presets.forEach(preset => {
    select.append(new Option(preset.name, preset.name));
  });

  // 仅恢复选择，不触发change或显示按钮，这些由其他逻辑处理
  if (currentValue && presets.some(p => p.name === currentValue)) {
    select.val(currentValue);
  }
}

/**
 * 交互式地保存一个新的或覆盖一个现有的提示词预设 (用于“另存为”功能)。
 * @param {JQuery} panel - 设置面板的jQuery对象。
 */
function saveAsNewPreset(panel) {
  const presetName = prompt('请输入新预设的名称：');
  if (!presetName) return;

  const presets = extension_settings[extensionName]?.promptPresets || [];
  const existingPresetIndex = presets.findIndex(p => p.name === presetName);

  // 获取当前提示词列表
  const currentPrompts = getPromptsFromUI();

  const newPresetData = {
    name: presetName,
    prompts: currentPrompts, // 使用新的 prompts 数组
    // 兼容旧字段，虽然可能不再使用
    mainPrompt: '', 
    systemPrompt: '',
    finalSystemDirective: '',
    
    rateMain: parseFloat(panel.find('#qrf_rate_main').val()),
    ratePersonal: parseFloat(panel.find('#qrf_rate_personal').val()),
    rateErotic: parseFloat(panel.find('#qrf_rate_erotic').val()),
    rateCuckold: parseFloat(panel.find('#qrf_rate_cuckold').val()),
    // [新增] 接力思考流程（包含每个流程的提示词与最新输出）
    relayFlows: deepClone(getMergedApiSettings().relayFlows || []),
    // [新功能] 导出时包含新增的设置
    extractTags: panel.find('#qrf_extract_tags').val(),
    minLength: parseInt(panel.find('#qrf_min_length').val(), 10),
    contextTurnCount: parseInt(panel.find('#qrf_context_turn_count').val(), 10),
    worldbookCharLimit: parseInt(panel.find('#qrf_worldbook_char_limit').val(), 10),
  };

  if (existingPresetIndex !== -1) {
    if (confirm(`名为 "${presetName}" 的预设已存在。是否要覆盖它？`)) {
      presets[existingPresetIndex] = newPresetData;
      toastr.success(`预设 "${presetName}" 已被覆盖。`);
    } else {
      toastr.info('保存操作已取消。');
      return;
    }
  } else {
    presets.push(newPresetData);
    toastr.success(`新预设 "${presetName}" 已保存。`);
  }
  saveSetting('promptPresets', presets);

  loadPromptPresets(panel);
  setTimeout(() => {
    panel.find('#qrf_prompt_preset_select').val(presetName).trigger('change');
  }, 0);
}

/**
 * 覆盖当前选中的提示词预设 (用于“保存”功能)。
 * 如果没有预设被选中，则行为与“另存为”相同。
 * @param {JQuery} panel - 设置面板的jQuery对象。
 */
function overwriteSelectedPreset(panel) {
  const select = panel.find('#qrf_prompt_preset_select');
  const selectedName = select.val();

  if (!selectedName) {
    // 如果没有选择预设，则“保存”应等同于“另存为”
    saveAsNewPreset(panel);
    return;
  }

  if (!confirm(`确定要用当前设置覆盖预设 "${selectedName}" 吗？`)) {
    return;
  }

  const presets = extension_settings[extensionName]?.promptPresets || [];
  const existingPresetIndex = presets.findIndex(p => p.name === selectedName);

  if (existingPresetIndex === -1) {
    toastr.error('找不到要覆盖的预设，它可能已被删除。');
    return;
  }

  const currentPrompts = getPromptsFromUI();

  const updatedPresetData = {
    name: selectedName,
    prompts: currentPrompts,
    rateMain: parseFloat(panel.find('#qrf_rate_main').val()),
    ratePersonal: parseFloat(panel.find('#qrf_rate_personal').val()),
    rateErotic: parseFloat(panel.find('#qrf_rate_erotic').val()),
    rateCuckold: parseFloat(panel.find('#qrf_rate_cuckold').val()),
    // [新增] 接力思考流程（包含每个流程的提示词与最新输出）
    relayFlows: deepClone(getMergedApiSettings().relayFlows || []),
    // [新功能] 覆盖时包含新增的设置
    extractTags: panel.find('#qrf_extract_tags').val(),
    minLength: parseInt(panel.find('#qrf_min_length').val(), 10),
    contextTurnCount: parseInt(panel.find('#qrf_context_turn_count').val(), 10),
    worldbookCharLimit: parseInt(panel.find('#qrf_worldbook_char_limit').val(), 10),
  };

  presets[existingPresetIndex] = updatedPresetData;
  saveSetting('promptPresets', presets);
  toastr.success(`预设 "${selectedName}" 已被成功覆盖。`);
}

/**
 * 删除当前选中的提示词预设。
 * @param {JQuery} panel - 设置面板的jQuery对象。
 */
function deleteSelectedPreset(panel) {
  const select = panel.find('#qrf_prompt_preset_select');
  const selectedName = select.val();

  if (!selectedName) {
    toastr.warning('没有选择任何预设。');
    return;
  }

  if (!confirm(`确定要删除预设 "${selectedName}" 吗？`)) {
    return;
  }

  const presets = extension_settings[extensionName]?.promptPresets || [];
  // 修正: 使用 splice 直接修改原数组，而不是创建新数组，以确保UI能正确更新
  const indexToDelete = presets.findIndex(p => p.name === selectedName);

  if (indexToDelete > -1) {
    presets.splice(indexToDelete, 1);
    saveSetting('promptPresets', presets);
    toastr.success(`预设 "${selectedName}" 已被删除。`);
  } else {
    toastr.error('找不到要删除的预设，操作可能已过期。');
  }

  // 刷新UI
  loadPromptPresets(panel);
  // 触发change以更新删除按钮状态并清除lastUsed
  select.trigger('change');
}

/**
 * 导出当前选中的提示词预设到一个JSON文件。
 */
function exportPromptPresets() {
  const select = $('#qrf_prompt_preset_select');
  const selectedName = select.val();

  if (!selectedName) {
    toastr.info('请先从下拉菜单中选择一个要导出的预设。');
    return;
  }

  const presets = extension_settings[extensionName]?.promptPresets || [];
  const selectedPreset = presets.find(p => p.name === selectedName);

  if (!selectedPreset) {
    toastr.error('找不到选中的预设，请刷新页面后重试。');
    return;
  }

  // 为了兼容导入逻辑，我们始终导出一个包含单个对象的数组
  const dataToExport = [selectedPreset];
  const dataStr = JSON.stringify(dataToExport, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  // 使用预设名作为文件名
  a.download = `qrf_preset_${selectedName.replace(/[^a-z0-9]/gi, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  toastr.success(`预设 "${selectedName}" 已成功导出。`);
}

/**
 * 从一个JSON文件导入提示词预设。
 * @param {File} file - 用户选择的JSON文件。
 * @param {JQuery} panel - 设置面板的jQuery对象。
 */
function importPromptPresets(file, panel) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const importedPresets = JSON.parse(e.target.result);

      if (!Array.isArray(importedPresets)) {
        throw new Error('JSON文件格式不正确，根节点必须是一个数组。');
      }

      let currentPresets = extension_settings[extensionName]?.promptPresets || [];
      let importedCount = 0;
      let overwrittenCount = 0;

      importedPresets.forEach(preset => {
        if (preset && typeof preset.name === 'string' && preset.name.length > 0) {
            
          // 迁移逻辑
          let importedPrompts = [];
          if (preset.prompts && Array.isArray(preset.prompts)) {
              importedPrompts = preset.prompts;
          } else {
              // [新功能] 旧预设兼容：使用默认的新提示词组，并仅覆盖三个基础提示词的内容
              importedPrompts = JSON.parse(JSON.stringify(defaultSettings.apiSettings.prompts));
              
              const legacyContentMap = {
                  'mainPrompt': preset.mainPrompt,
                  'systemPrompt': preset.systemPrompt,
                  'finalSystemDirective': preset.finalSystemDirective
              };

              importedPrompts.forEach(p => {
                  if (legacyContentMap[p.id] !== undefined) {
                      p.content = legacyContentMap[p.id] || '';
                  }
              });
          }

          const presetData = {
            name: preset.name,
            prompts: importedPrompts,
            rateMain: preset.rateMain ?? 1.0,
            ratePersonal: preset.ratePersonal ?? 1.0,
            rateErotic: preset.rateErotic ?? 1.0,
            rateCuckold: preset.rateCuckold ?? 1.0,
            // [新增] 接力思考流程：兼容缺省/旧格式
            relayFlows: normalizeRelayFlows(preset.relayFlows || []),
            // [新功能] 导入时识别新设置，并提供默认值以兼容旧预设
            extractTags: preset.extractTags || '',
            minLength: preset.minLength ?? defaultSettings.minLength,
            contextTurnCount: preset.contextTurnCount ?? defaultSettings.apiSettings.contextTurnCount,
            worldbookCharLimit: preset.worldbookCharLimit ?? defaultSettings.apiSettings.worldbookCharLimit,
          };

          const existingIndex = currentPresets.findIndex(p => p.name === preset.name);

          if (existingIndex !== -1) {
            // 覆盖现有预设
            currentPresets[existingIndex] = presetData;
            overwrittenCount++;
          } else {
            // 添加新预设
            currentPresets.push(presetData);
            importedCount++;
          }
        }
      });

      if (importedCount > 0 || overwrittenCount > 0) {
        const selectedPresetBeforeImport = panel.find('#qrf_prompt_preset_select').val();

        saveSetting('promptPresets', currentPresets);
        loadPromptPresets(panel);

        // 重新选中导入前选中的预设（如果它还存在的话），并强制触发change事件来刷新UI
        panel.find('#qrf_prompt_preset_select').val(selectedPresetBeforeImport);
        panel.find('#qrf_prompt_preset_select').trigger('change');

        let messages = [];
        if (importedCount > 0) messages.push(`成功导入 ${importedCount} 个新预设。`);
        if (overwrittenCount > 0) messages.push(`成功覆盖 ${overwrittenCount} 个同名预设。`);
        toastr.success(messages.join(' '));
      } else {
        toastr.warning('未找到可导入的有效预设。');
      }
    } catch (error) {
      console.error(`[${extensionName}] 导入预设失败:`, error);
      toastr.error(`导入失败: ${error.message}`, '错误');
    } finally {
      // 清空文件输入框的值，以便可以再次选择同一个文件
      panel.find('#qrf_preset_file_input').val('');
    }
  };
  reader.readAsText(file);
}

/**
 * 加载设置到UI界面。
 * @param {JQuery} panel - 设置面板的jQuery对象。
 */
function loadSettings(panel) {
  // 全局设置只用于非角色绑定的部分
  const globalSettings = extension_settings[extensionName] || defaultSettings;
  // API设置从合并后的来源获取
  const apiSettings = getMergedApiSettings();

  // 加载总开关 (全局)
  panel.find('#qrf_enabled').prop('checked', globalSettings.enabled);
  panel.find('#qrf_min_length').val(globalSettings.minLength ?? 500);

  // 加载API和模型设置 (大部分是全局，但世界书相关是角色卡)
  panel.find(`input[name="qrf_api_mode"][value="${apiSettings.apiMode}"]`).prop('checked', true);
  panel.find('#qrf_tavern_api_profile_select').val(apiSettings.tavernProfile); // 加载酒馆预设选择
  panel
    .find(`input[name="qrf_worldbook_source"][value="${apiSettings.worldbookSource || 'character'}"]`)
    .prop('checked', true);
  panel.find('#qrf_worldbook_enabled').prop('checked', apiSettings.worldbookEnabled);
  panel.find('#qrf_api_url').val(apiSettings.apiUrl);
  panel.find('#qrf_api_key').val(apiSettings.apiKey);

  const modelInput = panel.find('#qrf_model');
  const modelSelect = panel.find('#qrf_model_select');

  modelInput.val(apiSettings.model);
  modelSelect.empty();
  if (apiSettings.model) {
    modelSelect.append(new Option(apiSettings.model, apiSettings.model, true, true));
  } else {
    modelSelect.append(new Option('<-请先获取模型', '', true, true));
  }

  panel.find('#qrf_max_tokens').val(apiSettings.maxTokens);
  panel.find('#qrf_temperature').val(apiSettings.temperature);
  panel.find('#qrf_top_p').val(apiSettings.topP);
  panel.find('#qrf_presence_penalty').val(apiSettings.presencePenalty);
  panel.find('#qrf_frequency_penalty').val(apiSettings.frequencyPenalty);
  panel.find('#qrf_context_turn_count').val(apiSettings.contextTurnCount);
  panel.find('#qrf_worldbook_char_limit').val(apiSettings.worldbookCharLimit);

  // 加载标签摘取设置
  panel.find('#qrf_extract_tags').val(apiSettings.extractTags || '');

  // [新功能] 加载自动化循环设置
  // Defensive coding: Ensure loopSettings is an object even if defaults are missing/cached
  const loopSettings = globalSettings.loopSettings || (defaultSettings && defaultSettings.loopSettings) || {};
  panel.find('#qrf_quick_reply_content').val(loopSettings.quickReplyContent || '');
  panel.find('#qrf_loop_tags').val(loopSettings.loopTags || '');
  panel.find('#qrf_loop_delay').val(loopSettings.loopDelay ?? 5);
  panel.find('#qrf_loop_total_duration').val(loopSettings.loopTotalDuration ?? 0);
  panel.find('#qrf_max_retries').val(loopSettings.maxRetries ?? 3);

  // 加载匹配替换速率
  panel.find('#qrf_rate_main').val(apiSettings.rateMain);
  panel.find('#qrf_rate_personal').val(apiSettings.ratePersonal);
  panel.find('#qrf_rate_erotic').val(apiSettings.rateErotic);
  panel.find('#qrf_rate_cuckold').val(apiSettings.rateCuckold);

  // 加载提示词 (新的渲染逻辑)
  renderPrompts(panel, apiSettings.prompts || []);
  // 加载接力思考流程
  renderRelayFlows(panel, apiSettings.relayFlows || []);

  // 加载API配置库（全局）
  loadApiProfiles(panel);

  updateApiUrlVisibility(panel, apiSettings.apiMode);
  updateWorldbookSourceVisibility(panel, apiSettings.worldbookSource || 'character');

  // 加载提示词预-设
  loadPromptPresets(panel);

  // 自动选择上次使用的预设 (全局)
  const lastUsedPresetName = globalSettings.lastUsedPresetName;
  if (lastUsedPresetName && (globalSettings.promptPresets || []).some(p => p.name === lastUsedPresetName)) {
    // 使用setTimeout确保下拉列表已完全填充
    setTimeout(() => {
      // 传递一个额外参数来标记这是自动触发的，以避免显示通知
      panel.find('#qrf_prompt_preset_select').val(lastUsedPresetName).trigger('change', { isAutomatic: true });
    }, 0);
  }

  // 加载世界书和条目 (使用角色卡设置)
  loadWorldbooks(panel).then(() => {
    loadWorldbookEntries(panel).then(() => {
      // 确保筛选框在加载后被正确初始化
      const filterInput = panel.find('#qrf_worldbook_entry_filter');
      if (filterInput.val().trim() !== '') {
        // 如果有筛选文本，触发筛选事件以更新显示
        setTimeout(() => filterInput.trigger('input'), 100);
      }
    });
  });

  // 加载酒馆API预设
  loadTavernApiProfiles(panel);
}

/**
 * 为设置面板绑定所有事件。
 */
export function initializeBindings() {
  console.log('[剧情优化大师] Bindings Initializing... v2.1.0');
  const panel = $('#qrf_settings_panel');
  if (panel.length === 0 || panel.data('events-bound')) {
    return;
  }

  // 暴露给“流程编辑器”窗口调用的桥接API（只初始化一次）
  if (!window.QRFRelayFlowApi) {
    window.QRFRelayFlowApi = {
      getFlow(flowId) {
        const flows = getRelayFlowsFromSettings();
        return flows.find(f => f.id === flowId) || null;
      },
      async saveFlow(flowData) {
        const flows = getRelayFlowsFromSettings();
        const idx = flows.findIndex(f => f.id === String(flowData?.id || ''));
        if (idx === -1) return false;
        const next = deepClone(flows);
        next[idx] = {
          ...next[idx],
          ...deepClone(flowData),
          // 固定字段保护
          id: next[idx].id,
          injectKey: next[idx].injectKey,
        };
        await saveRelayFlows(next);
        return true;
      },
    };
  }

  loadSettings(panel);

  // 监听角色切换事件，刷新UI
  eventSource.on(event_types.CHAT_CHANGED, () => {
    console.log(`[${extensionName}] 检测到角色/聊天切换，正在刷新设置UI...`);
    loadSettings(panel);
  });

  // [功能更新 & 修复] 监听插件核心功能触发事件，刷新世界书
  eventSource.on('qrf-plugin-triggered', () => {
    // 重新获取panel引用以确保稳健性
    const currentPanel = $('#qrf_settings_panel');
    // 只要面板存在于DOM中就刷新，不再检查可见性，确保数据在需要时总是最新的。
    if (currentPanel.length > 0) {
      console.log(`[${extensionName}] 插件核心功能已触发，正在刷新世界书条目...`);
      // 直接调用 loadWorldbookEntries，它会处理所有加载逻辑
      loadWorldbookEntries(currentPanel);
    }
  });

  // --- 事件绑定区域 (智能保存) ---

  // 优化1: 创建一个统一的保存处理器，以避免代码重复
  const handleSettingChange = function (element) {
    const el = $(element);
    
    // 忽略动态提示词的输入框，它们由专门的逻辑处理
    if (el.closest('.qrf_prompt_segment').length > 0) {
        savePrompts();
        return;
    }

    let key;

    if (element.name === 'qrf_worldbook_source') {
      key = 'worldbookSource';
    } else {
      key = toCamelCase((element.name || element.id).replace('qrf_', ''));
    }

    let value = element.type === 'checkbox' ? element.checked : el.val();

    if (key === 'selectedWorldbooks' && !Array.isArray(value)) {
      value = el.val() || [];
    }

    const floatKeys = [
      'temperature',
      'top_p',
      'presence_penalty',
      'frequency_penalty',
      'rateMain',
      'ratePersonal',
      'rateErotic',
      'rateCuckold',
    ];

    // [新功能] 处理循环设置的特殊保存逻辑
    if (['quickReplyContent', 'loopTags', 'loopDelay', 'loopTotalDuration', 'maxRetries'].includes(key)) {
        if (!extension_settings[extensionName].loopSettings) {
            extension_settings[extensionName].loopSettings = {};
        }
        
        let valToSave = value;
        if (key === 'loopDelay' || key === 'loopTotalDuration' || key === 'maxRetries') valToSave = parseInt(value, 10);
        
        extension_settings[extensionName].loopSettings[key] = valToSave;
        console.log(`[${extensionName}] Loop setting updated: ${key} ->`, valToSave);
        saveSettingsDebounced();
        return; // Skip the rest of the generic saving logic
    }
    if (floatKeys.includes(key) && value !== '') {
      value = parseFloat(value);
    } else if (element.type === 'range' || element.type === 'number') {
      if (value !== '') value = parseInt(value, 10);
    }

    if (value !== '' || element.type === 'checkbox') {
      saveSetting(key, value);
    }

    if (element.name === 'qrf_api_mode') {
      updateApiUrlVisibility(panel, value);
      // [核心修复] 切换API模式时，清除所有旧的、非角色特定的API设置
      clearCharacterStaleSettings('api');
    }
    if (element.name === 'qrf_worldbook_source') {
      updateWorldbookSourceVisibility(panel, value);
      loadWorldbookEntries(panel);
    }
  };

  // 优化2: 统一所有输入控件的事件绑定，实现更简洁、更一致的实时保存
  const allInputSelectors = [
    'input[type="checkbox"]',
    'input[type="radio"]',
    'select:not(#qrf_model_select)',
    'input[type="text"]',
    'input[type="password"]',
    'textarea',
    'input[type="range"]',
    'input[type="number"]',
  ].join(', ');

  // 使用 'input' 和 'change' 事件确保覆盖所有交互场景：
  // - 'input' 实时捕捉打字、拖动等操作。
  // - 'change' 捕捉点击选择、粘贴、自动填充等操作。
  panel.on('input.qrf change.qrf', allInputSelectors, function () {
    handleSettingChange(this);
  });

  // 特殊处理模型选择下拉框
  panel.on('change.qrf', '#qrf_model_select', function () {
    const selectedModel = $(this).val();
    if (selectedModel) {
      // 手动触发模型输入框的change，会由上面的监听器捕获并保存
      panel.find('#qrf_model').val(selectedModel).trigger('change');
    }
  });

  // --- 提示词列表事件 ---
  
  panel.on('click', '#qrf_add_prompt_btn', function() {
      const container = $('#qrf_prompts_container');
      
      const newPrompt = {
          id: Date.now().toString(),
          name: 'New Prompt',
          role: 'system',
          content: '',
          deletable: true
      };
      
      // 获取当前所有，添加新的，然后重绘
      const prompts = getPromptsFromUI();
      prompts.push(newPrompt);
      renderPrompts(panel, prompts);
      savePrompts();
  });

  panel.on('click', '.qrf_prompt_delete_btn', function() {
      const segment = $(this).closest('.qrf_prompt_segment');
      if (segment.data('deletable') === false) return;
      
      if (confirm('确定要删除这个提示词吗？')) {
          segment.remove();
          savePrompts();
      }
  });

  panel.on('click', '.qrf_prompt_up_btn', function() {
      const segment = $(this).closest('.qrf_prompt_segment');
      const prev = segment.prev();
      if (prev.length) {
          segment.insertBefore(prev);
          savePrompts();
          // 重新渲染以更新按钮状态 (up/down disabled)
          renderPrompts(panel, getPromptsFromUI());
      }
  });

  panel.on('click', '.qrf_prompt_down_btn', function() {
      const segment = $(this).closest('.qrf_prompt_segment');
      const next = segment.next();
      if (next.length) {
          segment.insertAfter(next);
          savePrompts();
          renderPrompts(panel, getPromptsFromUI());
      }
  });

  // --- 接力思考流程事件 ---

  panel.on('click', '#qrf_add_relay_flow_btn', async function () {
    const flows = getRelayFlowsFromSettings();
    const injectKey = getNextRelayInjectKey(flows);
    const now = Date.now();
    const newFlow = {
      id: `${now}_${Math.random().toString(16).slice(2)}`,
      name: `流程 ${flows.length + 1}`,
      injectKey,
      enabled: true,
      prompts: deepClone(getMergedApiSettings().prompts || []), // 默认复制当前基础提示词
      lastOutput: '',
      extractTags: '',
    };
    const next = [...flows, newFlow];
    await saveRelayFlows(next);
    openRelayFlowEditor(newFlow.id);
  });

  // 每个流程独立标签摘取
  panel.on('change', '.qrf_relay_flow_extract_tags', async function () {
    const flowId = $(this).closest('.qrf_relay_flow_item').data('id');
    const val = String($(this).val() || '');
    const next = updateRelayFlowById(String(flowId), f => ({ ...f, extractTags: val }));
    if (next) await saveRelayFlows(next);
  });

  // 每个流程选择API配置
  panel.on('change', '.qrf_relay_flow_api_profile_select', async function () {
    const flowId = $(this).closest('.qrf_relay_flow_item').data('id');
    const val = String($(this).val() || '');
    const next = updateRelayFlowById(String(flowId), f => ({ ...f, apiProfileId: val }));
    if (next) await saveRelayFlows(next);
  });

  // --- API配置库事件 ---
  panel.on('click', '#qrf_save_api_profile_new', async function () {
    const name = prompt('请输入要保存的API配置名称：');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const s = extension_settings[extensionName] || (extension_settings[extensionName] = {});
    const profiles = Array.isArray(s.apiProfiles) ? s.apiProfiles : [];
    const existingIdx = profiles.findIndex(p => p && p.name === trimmed);

    const newProfile = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name: trimmed,
      settings: readApiSettingsFromUI(panel),
    };

    if (existingIdx !== -1) {
      if (!confirm(`已存在同名配置 "${trimmed}"，是否覆盖？`)) return;
      profiles[existingIdx] = { ...profiles[existingIdx], name: trimmed, settings: newProfile.settings };
    } else {
      profiles.push(newProfile);
    }

    await saveSetting('apiProfiles', profiles);
    loadApiProfiles(panel);
    panel.find('#qrf_api_profile_select').val(existingIdx !== -1 ? profiles[existingIdx].id : newProfile.id);
    toastr.success(`已保存API配置 "${trimmed}"。`);
    // 触发流程列表重绘以刷新下拉选项
    renderRelayFlows(panel, getMergedApiSettings().relayFlows || []);
  });

  panel.on('click', '#qrf_overwrite_api_profile', async function () {
    const select = panel.find('#qrf_api_profile_select');
    const id = String(select.val() || '');
    if (!id) {
      toastr.info('请先选择一个要覆盖的API配置。');
      return;
    }
    if (!confirm('确定要用当前API设置覆盖该配置吗？')) return;
    const s = extension_settings[extensionName] || (extension_settings[extensionName] = {});
    const profiles = Array.isArray(s.apiProfiles) ? s.apiProfiles : [];
    const idx = profiles.findIndex(p => p && String(p.id) === id);
    if (idx === -1) {
      toastr.error('找不到选中的API配置，请刷新后重试。');
      return;
    }
    profiles[idx] = { ...profiles[idx], settings: readApiSettingsFromUI(panel) };
    await saveSetting('apiProfiles', profiles);
    toastr.success('已覆盖保存该API配置。');
    renderRelayFlows(panel, getMergedApiSettings().relayFlows || []);
  });

  panel.on('click', '#qrf_delete_api_profile', async function () {
    const select = panel.find('#qrf_api_profile_select');
    const id = String(select.val() || '');
    if (!id) {
      toastr.info('请先选择一个要删除的API配置。');
      return;
    }
    if (!confirm('确定要删除该API配置吗？')) return;
    const s = extension_settings[extensionName] || (extension_settings[extensionName] = {});
    const profiles = Array.isArray(s.apiProfiles) ? s.apiProfiles : [];
    const nextProfiles = profiles.filter(p => String(p?.id || '') !== id);
    await saveSetting('apiProfiles', nextProfiles);
    loadApiProfiles(panel);

    // 如果流程引用了被删的 profile，自动回退为“使用当前”
    const flows = (getMergedApiSettings().relayFlows || []).map(f => {
      if (String(f?.apiProfileId || '') === id) return { ...f, apiProfileId: '' };
      return f;
    });
    await saveRelayFlows(flows);
    toastr.success('已删除API配置，并已将引用它的流程回退为“使用当前”。');
  });

  panel.on('change', '#qrf_api_profile_select', async function () {
    const id = String($(this).val() || '');
    if (!id) return;
    const profiles = getApiProfilesFromSettings();
    const p = profiles.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`要将配置 "${p.name}" 应用到当前API设置吗？`)) {
      // 回退选择为空，不应用
      $(this).val('');
      return;
    }
    await applyApiProfileToCurrent(panel, p.settings || {});
    toastr.success(`已应用API配置 "${p.name}"。`);
  });

  panel.on('click', '#qrf_clear_all_relay_outputs_btn', async function () {
    const flows = getRelayFlowsFromSettings();
    if (flows.length === 0) {
      toastr.info('当前没有任何流程。');
      return;
    }
    if (!confirm('确定要清空所有 $A* 注入输出吗？这不会删除流程提示词，只会把已保存的输出重置为空。')) {
      return;
    }
    const next = flows.map(f => ({ ...f, lastOutput: '' }));
    await saveRelayFlows(next);
    toastr.success('已清空所有注入输出。');
  });

  panel.on('click', '.qrf_relay_flow_edit', function () {
    const flowId = $(this).closest('.qrf_relay_flow_item').data('id');
    if (!flowId) return;
    openRelayFlowEditor(String(flowId));
  });

  panel.on('change', '.qrf_relay_flow_enabled', async function () {
    const flowId = $(this).closest('.qrf_relay_flow_item').data('id');
    const checked = $(this).is(':checked');
    const next = updateRelayFlowById(String(flowId), f => ({ ...f, enabled: checked }));
    if (next) await saveRelayFlows(next);
  });

  // 使用 change 而非 input：避免每次敲字都触发保存+重渲染导致焦点丢失
  panel.on('change', '.qrf_relay_flow_name', async function () {
    const flowId = $(this).closest('.qrf_relay_flow_item').data('id');
    const val = String($(this).val() || '');
    const next = updateRelayFlowById(String(flowId), f => ({ ...f, name: val }));
    if (next) await saveRelayFlows(next);
  });

  panel.on('click', '.qrf_relay_flow_clear', async function () {
    const flowId = $(this).closest('.qrf_relay_flow_item').data('id');
    if (!confirm('确定要清空该流程的最新输出吗？（不会删除提示词）')) return;
    const next = updateRelayFlowById(String(flowId), f => ({ ...f, lastOutput: '' }));
    if (next) await saveRelayFlows(next);
  });

  panel.on('click', '.qrf_relay_flow_delete', async function () {
    const flowId = $(this).closest('.qrf_relay_flow_item').data('id');
    if (!confirm('确定要删除该流程吗？')) return;
    const flows = getRelayFlowsFromSettings().filter(f => f.id !== String(flowId));
    await saveRelayFlows(flows);
  });

  panel.on('click', '.qrf_relay_flow_up', async function () {
    const item = $(this).closest('.qrf_relay_flow_item');
    const flowId = String(item.data('id'));
    const flows = getRelayFlowsFromSettings();
    const idx = flows.findIndex(f => f.id === flowId);
    if (idx <= 0) return;
    const next = deepClone(flows);
    const tmp = next[idx - 1];
    next[idx - 1] = next[idx];
    next[idx] = tmp;
    await saveRelayFlows(next);
  });

  panel.on('click', '.qrf_relay_flow_down', async function () {
    const item = $(this).closest('.qrf_relay_flow_item');
    const flowId = String(item.data('id'));
    const flows = getRelayFlowsFromSettings();
    const idx = flows.findIndex(f => f.id === flowId);
    if (idx === -1 || idx >= flows.length - 1) return;
    const next = deepClone(flows);
    const tmp = next[idx + 1];
    next[idx + 1] = next[idx];
    next[idx] = tmp;
    await saveRelayFlows(next);
  });

  // --- 功能按钮事件 ---

  panel.find('#qrf_fetch_models').on('click', async function () {
    const button = $(this);
    // 修正: 从UI实时获取apiMode，以进行正确的逻辑判断
    const apiMode = panel.find('input[name="qrf_api_mode"]:checked').val();

    if (apiMode === 'tavern') {
      toastr.info('在“使用酒馆连接预设”模式下，模型已在预设中定义，无需单独获取。');
      return;
    }

    button.prop('disabled', true).find('i').addClass('fa-spin');

    // 修正: 确保传递给fetchModels的设置是最新的
    const apiSettings = getMergedApiSettings();
    const currentApiSettings = {
      ...apiSettings,
      apiUrl: panel.find('#qrf_api_url').val(),
      apiKey: panel.find('#qrf_api_key').val(),
      model: panel.find('#qrf_model').val(),
      apiMode: apiMode, // 传递实时获取的apiMode
    };

    const models = await fetchModels(currentApiSettings);
    const modelSelect = panel.find('#qrf_model_select');
    modelSelect.empty().append(new Option('请选择一个模型', ''));

    if (models && models.length > 0) {
      models.forEach(model => modelSelect.append(new Option(model, model)));
      if (currentApiSettings.model && modelSelect.find(`option[value="${currentApiSettings.model}"]`).length > 0) {
        modelSelect.val(currentApiSettings.model);
      }
    } else {
      toastr.info('未能获取到模型列表，您仍然可以手动输入模型名称。');
    }

    button.prop('disabled', false).find('i').removeClass('fa-spin');
  });

  panel.find('#qrf_test_api').on('click', async function () {
    const button = $(this);
    button.prop('disabled', true).find('i').addClass('fa-spin');
    const apiSettings = getMergedApiSettings();
    // 修正: 直接从UI读取最新的API URL, Key和模型, 避免因设置未保存导致测试失败的问题
    const currentApiSettings = {
      ...apiSettings,
      apiUrl: panel.find('#qrf_api_url').val(),
      apiKey: panel.find('#qrf_api_key').val(),
      model: panel.find('#qrf_model').val(),
      apiMode: panel.find('input[name="qrf_api_mode"]:checked').val(), // 实时获取当前API模式
      // 确保测试时也传递 tavernProfile
      tavernProfile: panel.find('#qrf_tavern_api_profile_select').val(),
    };
    await testApiConnection(currentApiSettings);
    button.prop('disabled', false).find('i').removeClass('fa-spin');
  });

  // 绑定酒馆API预设刷新按钮
  panel.on('click.qrf', '#qrf_refresh_tavern_api_profiles', () => {
    loadTavernApiProfiles(panel);
  });

  // 绑定酒馆API预设选择事件
  panel.on('change.qrf', '#qrf_tavern_api_profile_select', function () {
    const value = $(this).val();
    saveSetting('tavernProfile', value);
  });

  // --- 提示词预设功能 ---

  panel.find('#qrf_import_prompt_presets').on('click', () => panel.find('#qrf_preset_file_input').click());
  panel.find('#qrf_export_prompt_presets').on('click', () => exportPromptPresets());
  panel.find('#qrf_save_prompt_preset').on('click', () => overwriteSelectedPreset(panel));
  panel.find('#qrf_save_as_new_prompt_preset').on('click', () => saveAsNewPreset(panel));
  panel.find('#qrf_delete_prompt_preset').on('click', () => deleteSelectedPreset(panel));

  panel.on('change.qrf', '#qrf_preset_file_input', function (e) {
    importPromptPresets(e.target.files[0], panel);
  });

  panel.on('change.qrf', '#qrf_prompt_preset_select', async function (event, data) {
    const selectedName = $(this).val();
    const deleteBtn = panel.find('#qrf_delete_prompt_preset');
    const isAutomatic = data && data.isAutomatic; // 检查是否是自动触发

    // 保存当前选择
    await saveSetting('lastUsedPresetName', selectedName);

    if (!selectedName) {
      deleteBtn.hide();
      // 如果取消选择，也清空上次选择的记录
      saveSetting('lastUsedPresetName', '');
      return;
    }

    const presets = extension_settings[extensionName]?.promptPresets || [];
    const selectedPreset = presets.find(p => p.name === selectedName);

    if (selectedPreset) {
      // [增强] 当选择预设时，直接、原子性地更新UI和设置
      
      let presetPrompts = [];
      if (selectedPreset.prompts && Array.isArray(selectedPreset.prompts)) {
          presetPrompts = selectedPreset.prompts;
      } else {
           // [新功能] 旧预设兼容：使用默认的新提示词组，并仅覆盖三个基础提示词的内容
           presetPrompts = JSON.parse(JSON.stringify(defaultSettings.apiSettings.prompts));
           
           const legacyContentMap = {
               'mainPrompt': selectedPreset.mainPrompt,
               'systemPrompt': selectedPreset.systemPrompt,
               'finalSystemDirective': selectedPreset.finalSystemDirective
           };

           presetPrompts.forEach(p => {
               if (legacyContentMap[p.id] !== undefined) {
                   p.content = legacyContentMap[p.id] || '';
               }
           });
      }

      const presetData = {
        prompts: presetPrompts,
        rateMain: selectedPreset.rateMain ?? 1.0,
        ratePersonal: selectedPreset.ratePersonal ?? 1.0,
        rateErotic: selectedPreset.rateErotic ?? 1.0,
        rateCuckold: selectedPreset.rateCuckold ?? 1.0,
        relayFlows: normalizeRelayFlows(selectedPreset.relayFlows || []),
        // [新功能] 加载预设时应用新设置
        extractTags: selectedPreset.extractTags || '',
        minLength: selectedPreset.minLength ?? defaultSettings.minLength,
        contextTurnCount: selectedPreset.contextTurnCount ?? defaultSettings.apiSettings.contextTurnCount,
        worldbookCharLimit: selectedPreset.worldbookCharLimit ?? defaultSettings.apiSettings.worldbookCharLimit,
      };

      // 1. 更新UI界面
      renderPrompts(panel, presetData.prompts);
      panel.find('#qrf_rate_main').val(presetData.rateMain);
      panel.find('#qrf_rate_personal').val(presetData.ratePersonal);
      panel.find('#qrf_rate_erotic').val(presetData.rateErotic);
      panel.find('#qrf_rate_cuckold').val(presetData.rateCuckold);
      panel.find('#qrf_extract_tags').val(presetData.extractTags);
      panel.find('#qrf_min_length').val(presetData.minLength);
      panel.find('#qrf_context_turn_count').val(presetData.contextTurnCount);
      panel.find('#qrf_worldbook_char_limit').val(presetData.worldbookCharLimit);
      renderRelayFlows(panel, presetData.relayFlows);

      // 2. 直接、同步地覆盖apiSettings中的内容
      // saveSetting现在是异步的，我们需要等待它完成
      for (const [key, value] of Object.entries(presetData)) {
        await saveSetting(key, value);
      }

      // [核心修复] 清除角色卡上可能存在的、会覆盖全局预设的陈旧设置
      await clearCharacterStaleSettings('prompts');

      // [最终修复] 强制立即将更新后的全局设置写入磁盘，彻底消除异步竞争条件
      saveSettingsImmediate();

      // 只有在非自动触发时才显示通知
      if (!isAutomatic) {
        toastr.success(`已加载预设 "${selectedName}"。`);
      }
      deleteBtn.show();
    } else {
      deleteBtn.hide();
    }
  });

  // --- 重置按钮事件 ---
  
  // The old reset buttons are removed from HTML, but if we want to support resetting specific prompts, 
  // we can add "Reset" button to the segment header for basic prompts?
  // Or just leave it as is (users can reload preset).

  panel.data('events-bound', true);
  console.log(`[${extensionName}] UI事件已成功绑定，自动保存已激活。`);

  // ---- 世界书事件绑定 ----
  panel.on('click.qrf', '#qrf_refresh_worldbooks', () => {
    loadWorldbooks(panel).then(() => {
      loadWorldbookEntries(panel);
    });
  });

  panel.on('change.qrf', '#qrf_selected_worldbooks', async function () {
    const selected = $(this).val() || [];
    // 强制等待设置保存完成，再执行加载，避免竞态条件
    await saveSetting('selectedWorldbooks', selected);
    await loadWorldbookEntries(panel);
  });

  panel.on('change.qrf', '#qrf_worldbook_entry_list_container input[type="checkbox"]', async () => {
    await saveDisabledEntries();
  });

  panel.on('click.qrf', '#qrf_worldbook_entry_select_all', async () => {
    // 只选择当前筛选结果中可见的条目
    panel
      .find('#qrf_worldbook_entry_list_container .qrf_worldbook_entry_item:not(.filtered-out) input[type="checkbox"]')
      .prop('checked', true);

    // [关键修复] 使用特殊符号标识全选状态，而不是空对象
    // 确保使用 await 等待保存完成
    await saveSetting('disabledWorldbookEntries', '__ALL_SELECTED__');

    // 再次保存以确保UI状态与数据一致
    // 这里不再需要调用 saveDisabledEntries，因为我们已经通过 saveSetting 设置了特殊符号
    // saveDisabledEntries(); // 注释掉这行，避免重复操作
  });

  panel.on('click.qrf', '#qrf_worldbook_entry_deselect_all', async () => {
    // 只取消选择当前筛选结果中可见的条目
    panel
      .find('#qrf_worldbook_entry_list_container .qrf_worldbook_entry_item:not(.filtered-out) input[type="checkbox"]')
      .prop('checked', false);
    await saveDisabledEntries();
  });

  // 世界书条目筛选功能
  panel.on('input.qrf', '#qrf_worldbook_entry_filter', function () {
    const filterText = $(this).val().toLowerCase().trim();
    const container = panel.find('#qrf_worldbook_entry_list_container');
    const allItems = container.find('.qrf_worldbook_entry_item');
    let visibleCount = 0;

    if (filterText === '') {
      // 清除筛选，显示所有条目
      allItems.removeClass('filtered-out highlighted');
      visibleCount = allItems.length;
    } else {
      allItems.each(function () {
        const item = $(this);
        const label = item.find('label').text().toLowerCase();
        const bookName = item.data('book').toLowerCase();

        if (label.includes(filterText) || bookName.includes(filterText)) {
          item.removeClass('filtered-out').addClass('highlighted');
          visibleCount++;
        } else {
          item.addClass('filtered-out').removeClass('highlighted');
        }
      });
    }

    // 更新计数显示
    const totalCount = allItems.length;
    const countDisplay = panel.find('#qrf_worldbook_entry_count');
    if (filterText === '') {
      countDisplay.text(`显示 ${totalCount} / ${totalCount} 条目.`);
    } else {
      countDisplay.text(`筛选结果: ${visibleCount} / ${totalCount} 条目.`);
    }
  });

  // 清除筛选按钮
  panel.on('click.qrf', '#qrf_worldbook_entry_clear_filter', function () {
    panel.find('#qrf_worldbook_entry_filter').val('').trigger('input');
  });

  // --- 自动化循环控制事件 ---
  panel.on('click.qrf', '#qrf_start_loop_btn', function() {
      const duration = parseInt(panel.find('#qrf_loop_total_duration').val(), 10);
      if (!duration || duration <= 0) {
          toastr.warning('请设置一个大于0的总倒计时 (分钟) 才能启动循环。');
          return;
      }

      // 触发开始事件，index.js 会监听此事件
      eventSource.emit('qrf-start-loop');
      $(this).hide();
      panel.find('#qrf_stop_loop_btn').show();
      panel.find('#qrf_loop_status_text').text('运行中').css('color', 'var(--green)');
      toastr.success('自动化循环已启动。');
  });

  panel.on('click.qrf', '#qrf_stop_loop_btn', function() {
      // 触发停止事件
      eventSource.emit('qrf-stop-loop');
      $(this).hide();
      panel.find('#qrf_start_loop_btn').show();
      panel.find('#qrf_loop_status_text').text('已停止').css('color', 'var(--red)');
      toastr.info('自动化循环已停止。');
  });

  // [UI状态同步] 监听循环状态变化事件，以便在面板重新打开或其他原因导致UI重置时恢复状态
  eventSource.on('qrf-loop-status-changed', (isRunning) => {
      const panel = $('#qrf_settings_panel');
      const timerDisplay = panel.find('#qrf_loop_timer_display');
      if (isRunning) {
          panel.find('#qrf_start_loop_btn').hide();
          panel.find('#qrf_stop_loop_btn').show();
          panel.find('#qrf_loop_status_text').text('运行中').css('color', 'var(--green)');
          timerDisplay.show();
      } else {
          panel.find('#qrf_stop_loop_btn').hide();
          panel.find('#qrf_start_loop_btn').show();
          panel.find('#qrf_loop_status_text').text('已停止').css('color', 'var(--red)');
          timerDisplay.hide().text('');
      }
  });

  // 监听循环计时器更新
  eventSource.on('qrf-loop-timer-tick', (timeLeftFormatted) => {
      $('#qrf_loop_timer_display').text(`(剩余: ${timeLeftFormatted})`);
  });

  // --- 折叠面板逻辑 ---
  panel.on('click.qrf', '.qrf-collapsible legend', function() {
      const fieldset = $(this).closest('.settings-group');
      fieldset.toggleClass('collapsed');
  });
}
