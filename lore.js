// lore.js
// 世界书处理模块
import { characters, this_chid } from '/script.js';

const extensionName = 'quick-response-force';
const blockedKeywords = ['规则', '思维链', 'cot', 'MVU', 'mvu', '变量', '状态', 'Status', 'Rule', 'rule', '检定', '判断', '叙事', '文风'];

function isEntryBlocked(entry) {
  const name = entry?.comment || entry?.name || '';
  return blockedKeywords.some(keyword => name.includes(keyword));
}

/**
 * [新增] 辅助函数：检查条目是否包含屏蔽词
 * @param {object} entry - 世界书条目对象
 * @returns {boolean} - 如果包含屏蔽词返回true
 */
function isEntryBlocked_ACU(entry) {
  if (!entry) return false;
  const blockedKeywords = ["规则", "思维链", "cot", "MVU", "mvu", "变量", "状态", "Status", "Rule", "rule", "检定", "判断", "叙事", "文风", "InitVar", "格式"];
  const name = entry.comment || entry.name || '';
  return blockedKeywords.some(keyword => name.includes(keyword));
}

/**
 * 获取合并后的世界书内容 (移植自数据库插件的先进逻辑)
 * @param {object} context - SillyTavern上下文
 * @param {object} apiSettings - API设置
 * @param {string} userMessage - 当前的用户输入
 * @param {string} extraBaseText - 额外用于触发关键词的上下文（如上轮剧情 $6）
 * @returns {Promise<string>} - 合并后的、经过递归和关键词处理的世界书内容
 */
export async function getCombinedWorldbookContent(context, apiSettings, userMessage, extraBaseText = '') {
  if (!apiSettings.worldbookEnabled) {
    return '';
  }

  console.log(`[${extensionName}] Starting to get combined worldbook content...`);

  try {
    let bookNames = [];

    // 1. 确定要扫描的世界书
    if (apiSettings.worldbookSource === 'manual') {
      bookNames = apiSettings.selectedWorldbooks || [];
    } else {
      // 'character' mode
      if (this_chid === -1 || !characters[this_chid]) {
        console.warn(`[${extensionName}] 没有选择角色，无法获取角色世界书`);
        return '';
      }
      try {
        const charLorebooks = await window.TavernHelper.getCharLorebooks({ type: 'all' });
        if (charLorebooks.primary) bookNames.push(charLorebooks.primary);
        if (charLorebooks.additional?.length) bookNames.push(...charLorebooks.additional);
      } catch (error) {
        console.error(`[${extensionName}] 获取角色世界书失败:`, error);
        return '';
      }
    }

    if (bookNames.length === 0) {
      console.log(`[${extensionName}] No worldbooks selected or available for the character.`);
      return '';
    }

    // 2. 获取所有相关世界书的全部条目
    let allEntries = [];
    for (const bookName of bookNames) {
      if (bookName) {
        const entries = await window.TavernHelper.getLorebookEntries(bookName);
        if (entries?.length) {
          entries.forEach(entry => {
            if (isEntryBlocked(entry)) return;
            allEntries.push({ ...entry, bookName });
          });
        }
      }
    }

    // 3. 过滤掉在SillyTavern中被禁用的条目，以及用户在插件UI中取消勾选的条目
    const disabledEntriesFromSettings = apiSettings.disabledWorldbookEntries;

    // [修改] 支持默认全选和屏蔽词过滤（类似数据库插件逻辑）
    // [修复] 确保默认情况下是全选状态，防止设置加载问题
    const isAllSelected = disabledEntriesFromSettings === '__ALL_SELECTED__' ||
                         !disabledEntriesFromSettings ||
                         (typeof disabledEntriesFromSettings === 'object' && Object.keys(disabledEntriesFromSettings).length === 0);
    const disabledMap =
      typeof disabledEntriesFromSettings === 'object' && disabledEntriesFromSettings !== null
        ? disabledEntriesFromSettings
        : {};

    // 检查是否有任何选择配置
    const hasAnySelection = disabledMap && typeof disabledMap === 'object' && Object.keys(disabledMap).length > 0;

    const userEnabledEntries = allEntries.filter(entry => {
      // 1. 必须在SillyTavern本身是启用的
      if (!entry.enabled) return false;

      // 2. 屏蔽总体大纲条目（类似数据库插件的逻辑）
      const comment = entry?.comment || entry?.name || '';
      const isOutlineEntry = String(comment).startsWith('TavernDB-ACU-OutlineTable');
      if (isOutlineEntry) {
        return false; // 屏蔽总体大纲条目
      }

      // 3. 过滤屏蔽词条目（规则/思维链等），但允许数据库生成条目通过
      let normalizedComment = String(comment).replace(/^ACU-\[[^\]]+\]-/, '');
      normalizedComment = normalizedComment.replace(/^外部导入-(?:[^-]+-)?/, '');
      const isDbGenerated =
        normalizedComment.startsWith('TavernDB-ACU-') ||
        normalizedComment.startsWith('总结条目') ||
        normalizedComment.startsWith('小总结条目') ||
        normalizedComment.startsWith('重要人物条目');

      if (!isDbGenerated && isEntryBlocked_ACU(entry)) {
        return false;
      }

      // 4. 如果是全选状态，则通过
      if (isAllSelected) return true;

      // 5. 如果没有配置，则默认全选（支持自动勾选新增）
      if (!hasAnySelection) return true;

      // 6. 如果某本书没有配置列表，则默认全选该书（自动勾选新增）
      const disabledInBook = disabledMap[entry.bookName];
      if (typeof disabledInBook === 'undefined') return true;

      // 7. 检查是否在禁用列表中
      if (Array.isArray(disabledInBook) && disabledInBook.includes(entry.uid)) {
        return false;
      }

      // 默认为启用
      return true;
    });

    if (userEnabledEntries.length === 0) {
      console.log(`[${extensionName}] No entries are enabled in the plugin settings or available.`);
      return '';
    }

    const extraBaseLower = (extraBaseText || '').toLowerCase();
    // 4. 开始递归激活逻辑
    const getEntryKeywords = entry =>
      [...new Set([...(entry.key || []), ...(entry.keys || [])])].map(k => k.toLowerCase());

    const constantEntries = userEnabledEntries.filter(entry => entry.type === 'constant');
    let keywordEntries = userEnabledEntries.filter(entry => entry.type !== 'constant');

    // 仅允许可递归的常量条目参与触发，防止“防递归”条目触发关键词
    const recursionAllowedConstants = constantEntries.filter(e => !e.prevent_recursion);

    // 将「最近若干轮聊天上下文」+ 可递归常量内容 + 额外触发文本（如$6）一起作为基础触发文本
    // 为避免历史中过旧内容（例如早期所有 AM01-AM62 列表）导致大规模误触发，这里只取尾部若干条
    const historyLimit = Number.isFinite(apiSettings.contextTurnCount)
      ? Math.max(1, apiSettings.contextTurnCount)
      : 3;
    const chatArray = Array.isArray(context.chat) ? context.chat : [];
    const recentMessages = historyLimit > 0 ? chatArray.slice(-historyLimit) : chatArray;
    const historyAndUserText = `${recentMessages.map(message => message.mes).join('\n')}\n${
      userMessage || ''
    }`.toLowerCase();
    const recursionAllowedConstantText = recursionAllowedConstants.map(e => e.content || '').join('\n').toLowerCase();
    const initialScanText = [historyAndUserText, recursionAllowedConstantText, extraBaseLower].filter(Boolean).join('\n');

    const triggeredEntries = new Set([...constantEntries]);
    let recursionDepth = 0;
    const MAX_RECURSION_DEPTH = 10; // 防止无限递归的安全措施

    while (recursionDepth < MAX_RECURSION_DEPTH) {
      recursionDepth++;
      let hasChangedInThisPass = false;

      // 递归扫描源 = 初始文本（历史+用户输入） + 已触发且不阻止递归的条目内容
      const recursionSourceContent = Array.from(triggeredEntries)
        .filter(e => !e.prevent_recursion)
        .map(e => e.content)
        .join('\n')
        .toLowerCase();
      const fullSearchText = `${initialScanText}\n${recursionSourceContent}`;

      const remainingKeywordEntries = [];

      for (const entry of keywordEntries) {
        const keywords = getEntryKeywords(entry);
        // 如果条目有关键词，并且其中至少一个关键词能在扫描源中找到，则触发
        // 'exclude_recursion' 只在初始文本中搜索，否则在完整扫描源中搜索
        let isTriggered =
          keywords.length > 0 &&
          keywords.some(keyword =>
            entry.exclude_recursion ? initialScanText.includes(keyword) : fullSearchText.includes(keyword),
          );

        if (isTriggered) {
          triggeredEntries.add(entry);
          hasChangedInThisPass = true;
        } else {
          remainingKeywordEntries.push(entry);
        }
      }

      if (!hasChangedInThisPass) {
        console.log(`[${extensionName}] Worldbook recursion stabilized after ${recursionDepth} passes.`);
        break;
      }

      keywordEntries = remainingKeywordEntries;
    }

    if (recursionDepth >= MAX_RECURSION_DEPTH) {
      console.warn(
        `[${extensionName}] Worldbook recursion reached max depth of ${MAX_RECURSION_DEPTH}. Breaking loop.`,
      );
    }

    // 5. 格式化最终内容
    const triggeredArray = Array.from(triggeredEntries);

    // 排序逻辑：
    // - 不再区分是否参与递归，统一按照 depth(order) 从小到大排序
    // - 同一深度内按名称稳定排序
    // - 这样可以确保关键词触发的条目也能按照用户预设的顺序插入
    const sortByDepth = (a, b) => {
      const aOrder = Number.isFinite(a.order) ? a.order : Infinity;
      const bOrder = Number.isFinite(b.order) ? b.order : Infinity;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.comment || '').localeCompare(b.comment || '');
    };

    triggeredArray.sort(sortByDepth);
    const orderedEntries = triggeredArray;

    const limit = apiSettings.worldbookCharLimit || 60000;
    const assembled = [];
    let used = 0;

    for (const entry of orderedEntries) {
      if (!entry.content || !entry.content.trim()) continue;
      const chunk = entry.content.trim(); // 仅使用条目内容，不再附加名称
      const newLen = used + chunk.length + (assembled.length > 0 ? 2 : 0); // 2 for双换行
      if (newLen > limit) {
        // 如果还没放入任何内容且首条即超长，截断首条以保证优先级
        if (assembled.length === 0 && chunk.length > limit) {
          assembled.push(chunk.substring(0, limit));
          used = limit;
        }
        break;
      }
      assembled.push(chunk);
      used = newLen;
    }

    if (assembled.length === 0) {
      console.log(`[${extensionName}] No worldbook entries were ultimately triggered.`);
      return '';
    }

    const combinedContent = assembled.join('\n\n');
    console.log(
      `[${extensionName}] Combined worldbook content generated, length: ${combinedContent.length}. ${assembled.length} entries included.`,
    );

    return combinedContent;
  } catch (error) {
    console.error(`[${extensionName}] 处理世界书内容时发生错误:`, error);
    return ''; // 发生错误时返回空字符串，避免中断生成
  }
}
