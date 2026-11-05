import { getChatArray_ACU } from '../../service/chat/chat-service';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU, settings_ACU } from '../../service/runtime/state-manager';
import { getSortedSheetKeys_ACU } from '../../service/template/chat-scope';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { isSummaryOrOutlineTable_ACU, logDebug_ACU, logError_ACU } from '../../shared/utils';
import { getActiveTemplatePresetMeta_ACU } from '../../service/template/template-preset-service';
import { resolveTableHistoryStateFromChat_ACU } from '../../service/table/table-history';
import { isNonFillAiFloor_ACU, selectFillEligibleIndices_ACU } from '../../service/runtime/message-handler';
import { $popupInstance_ACU, $cardUpdateStatusDisplay_ACU } from '../state/ui-refs';
/**
 * presentation/components/update-status-display.ts — 运行时状态/更新显示 UI
 * 从 features/runtime/01_runtime_state.js 迁移而来
 */
  export async function updateCardUpdateStatusDisplay_ACU() {
    const $totalMessagesDisplay = $popupInstance_ACU
      ? $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-total-messages-display`)
      : null;
    const $statusTableBody = $popupInstance_ACU
      ? $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-granular-status-table-body`)
      : null;
    const $nextUpdateDisplay = $popupInstance_ACU
      ? $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-next-update-display`)
      : null;

    if (
      !$popupInstance_ACU ||
      !$cardUpdateStatusDisplay_ACU ||
      !$cardUpdateStatusDisplay_ACU.length ||
      !$totalMessagesDisplay ||
      !$totalMessagesDisplay.length ||
      !$statusTableBody ||
      !$statusTableBody.length
    ) {
      logDebug_ACU('updateCardUpdateStatusDisplay_ACU: UI elements not ready.');
      return;
    }

    const chatHistory = getChatArray_ACU();
    const totalMessages = chatHistory.filter(msg => !msg.is_user).length;
    $totalMessagesDisplay.text(`上下文总层数: ${totalMessages} (仅计算AI回复楼层)`);

    const totalAiMessages = totalMessages;
    const allAiMessageIndices = chatHistory
      .map((msg: any, index: number) => msg && !msg.is_user ? index : -1)
      .filter((index: number) => index !== -1);
    const fillEligibleIndexSet = new Set(allAiMessageIndices.filter(index => !isNonFillAiFloor_ACU(chatHistory[index])));
    const isFillEligibleIndex = (index: number): boolean => fillEligibleIndexSet.has(index);

    if (!currentJsonTableData_ACU) {
      $cardUpdateStatusDisplay_ACU.text('数据库状态：未加载或初始化失败。');
      $statusTableBody.html('<tr><td colspan="5" style="text-align: center;">暂无数据</td></tr>');
      return;
    }

    try {
      const sheetKeys = getSortedSheetKeys_ACU(currentJsonTableData_ACU);
      const tableCount = sheetKeys.length;
      let totalRowCount = 0;
      let nextUpdates: any[] = [];
      let tableStatusRows = "";

      sheetKeys.forEach(key => {
        const table = currentJsonTableData_ACU[key];
        if (!table) return;
        
        if (table.content && Array.isArray(table.content)) {
            totalRowCount += table.content.length > 1 ? table.content.length - 1 : 0;
        }

        // 计算每个表的状态
        const tableConfig = table.updateConfig || {};
        const isSummary = isSummaryOrOutlineTable_ACU(table.name);
        
        // 确定参数
        const globalFrequency = settings_ACU.autoUpdateFrequency || 1;
        const globalSkip = settings_ACU.skipUpdateFloors || 0;

        // -1 = 沿用UI全局；0 = 禁用该表自动更新（不参与预测）
        const rawFreq = Number.isFinite(tableConfig.updateFrequency) ? tableConfig.updateFrequency : -1;
        const rawSkip = Number.isFinite(tableConfig.skipFloors) ? tableConfig.skipFloors : -1;
        const frequency = (rawFreq === -1) ? globalFrequency : rawFreq;
        
        // [重构] 上次更新楼层计算：扫描聊天记录
        // 寻找该表格在历史记录中最后一次被更新的楼层
        // 支持合并更新逻辑：只要合并更新组内有任意表被修改，整组表都视为已更新
        const currentIsolationKey = getCurrentIsolationKey_ACU();
        const history = resolveTableHistoryStateFromChat_ACU(chatHistory, {
            sheetKey: key,
            isSummaryTable: isSummary,
            isolationKey: currentIsolationKey,
            settings: settings_ACU,
        });
        const lastUpdatedAiFloor = history.lastTrackedUpdateAiFloor;
        const foundInHistory = history.hasTrackedUpdate;
        
        const skipFloors = Math.max(0, (rawSkip === -1) ? globalSkip : rawSkip);

        // 下次触发 (包含skip)
        let triggerFloor = "N/A";
        let unrecorded = "N/A";
        let effectiveUnrecorded = "N/A"; // [修复] 在外部作用域声明变量
        let isReady = false;

        const isAutoUpdateDisabledForThisTable = (frequency <= 0);

        // 待填可填楼数与自动调度同口径（selectFillEligibleIndices_ACU）：排除工具楼与旁白，前沿仍是 !is_user 序号。
        const pendingFillCount = selectFillEligibleIndices_ACU(chatHistory, allAiMessageIndices, lastUpdatedAiFloor, 0, isFillEligibleIndex).length;
        const effectiveFillCount = selectFillEligibleIndices_ACU(chatHistory, allAiMessageIndices, lastUpdatedAiFloor, skipFloors, isFillEligibleIndex).length;

        if (isAutoUpdateDisabledForThisTable) {
            // 频率=0：不参与自动更新，UI显示“无”
            triggerFloor = '无';
            // 仍可展示“未记录楼层/上次更新”，便于用户观察数据变化
            if (foundInHistory) {
                unrecorded = String(pendingFillCount);
                effectiveUnrecorded = '—';
            } else {
                unrecorded = '—';
                effectiveUnrecorded = '—';
            }
            isReady = false;
        } else if (foundInHistory) {
            // 触发楼层按 !is_user 序号预测（假设后续楼层均可填）：当前总数 + 频率 + 跳过 - 已积累可填楼；无工具楼时等于 上次更新楼层 + 频率 + 跳过楼层。
            triggerFloor = String(totalAiMessages + frequency + skipFloors - pendingFillCount);
            // 未记录楼层：前沿之后的可填楼数
            unrecorded = String(pendingFillCount);
            // 有效积累楼层（用于判断进度）：再去掉跳过楼层
            effectiveUnrecorded = String(effectiveFillCount);
            isReady = effectiveFillCount >= frequency;
            // 将数值存入预测数组
            nextUpdates.push({ name: table.name, floor: triggerFloor, isReady });
        }


        // 显示文本处理
        let lastUpdatedDisplay = foundInHistory ? lastUpdatedAiFloor : '<span style="color: grey;">未初始</span>';
        
        // 高亮显示当前层更新的表，并显示变更数量
        const isUpdatedThisFloor = foundInHistory && (lastUpdatedAiFloor === totalAiMessages);
        
        if (isUpdatedThisFloor) {
            const changes = table._lastUpdateStats ? table._lastUpdateStats.changes : 0;
            const changeText = changes > 0 ? `(+${changes})` : '(无变更)';
            lastUpdatedDisplay = `<span style="color: lightgreen; font-weight: bold;">${lastUpdatedAiFloor} ${changeText}</span>`;
        }

        tableStatusRows += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="text-align: left; padding: 5px;">${escapeHtml_ACU(table.name)}</td>
                <td style="text-align: center; padding: 5px;">${frequency}</td>
                <td style="text-align: center; padding: 5px;" title="有效未记录: ${effectiveUnrecorded}">${unrecorded}</td>
                <td style="text-align: center; padding: 5px;">${lastUpdatedDisplay}</td>
                <td style="text-align: center; padding: 5px;">${triggerFloor}</td>
            </tr>
        `;
      });

      $statusTableBody.html(tableStatusRows);
 
      const activeTemplateMeta_ACU = getActiveTemplatePresetMeta_ACU();
      $cardUpdateStatusDisplay_ACU.html(
        `数据库状态: <b style="color:lightgreen;">已加载</b> (${tableCount}个表格, ${totalRowCount}条记录)；当前生效模板预设：<b style="color:var(--accent-primary);">${escapeHtml_ACU(activeTemplateMeta_ACU.displayName)}</b><span style="color: var(--text-secondary);">（${activeTemplateMeta_ACU.scopeLabel}）</span>`,
      );
      
      // 更新下次预测显示
      if ($nextUpdateDisplay.length && nextUpdates.length > 0) {
          nextUpdates.sort((a, b) => a.floor - b.floor);
          const readyList = nextUpdates.filter(u => u.isReady);
          const upcomingList = nextUpdates.filter(u => !u.isReady);
          
          let statusText = "";
          if (readyList.length > 0) {
               statusText += `<span style="color: lightgreen;">[就绪] ${readyList.map(u => u.name).join(', ')}</span> `;
          }
          
          if (upcomingList.length > 0) {
              const next = upcomingList[0];
              const othersSameFloor = upcomingList.filter(u => u.floor === next.floor && u !== next);
              let names = next.name;
              if (othersSameFloor.length > 0) names += ", " + othersSameFloor.map(u => u.name).join(", ");
              
              if (statusText) statusText += " | ";
              statusText += `下一次: <b>${names}</b> (AI楼层 ${next.floor})`;
          } else if (readyList.length === 0) {
               statusText = "下一次: <b>无</b>";
          }
          
          $nextUpdateDisplay.html(statusText);
      } else if ($nextUpdateDisplay.length) {
          // 所有表都禁用自动更新 / 没有可参与预测的表
          $nextUpdateDisplay.html("下一次: <b>无</b>");
      }

    } catch (e) {
      logError_ACU('ACU: Failed to parse database for UI status:', e);
      $cardUpdateStatusDisplay_ACU.text('解析数据库状态时出错。');
    }
  }
