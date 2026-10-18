/**
 * service/runtime/plot-runtime/plot-data-format.ts
 * 剧情推进 — 表格数据格式化（LLM 可读文本 / 大纲表 / 纪要索引）
 * 从 helpers-plot-runtime.ts 拆出（L26-L219）
 */
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../shared/utils';
import { getCharLorebooks_ACU } from '../../../data/gateways/character-gateway';
import { createStrictLorebookReadError_ACU, getLorebookEntriesStrict_ACU } from '../../worldbook/pipeline';
import { createPlotWorldbookReadContext_ACU, type PlotWorldbookReadContext_ACU } from './plot-worldbook-read-context';
import { getIsolationPrefix_ACU } from '../../worldbook/injection-engine';

  export function formatTableDataForLLM_ACU(jsonData: any) {
    if (!jsonData || typeof jsonData !== 'object' || Object.keys(jsonData).length === 0) {
      return '当前无任何可用的表格数据。';
    }

    let output = '以下是当前角色聊天记录中，由st-memory-enhancement插件保存的全部表格数据：\n';

    for (const sheetId in jsonData) {
      if (Object.prototype.hasOwnProperty.call(jsonData, sheetId)) {
        const sheet = jsonData[sheetId];
        if (sheet && sheet.name && sheet.content && sheet.content.length > 1) {
          output += `\n## 表格: ${sheet.name}\n`;
          const headers = sheet.content[0].slice(1);
          const rows = sheet.content.slice(1);

          rows.forEach((row: any, rowIndex: number) => {
            const rowData = row.slice(1);
            let rowOutput = '';
            let hasContent = false;
            headers.forEach((header: any, index: number) => {
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

  /** 从世界书获取"纪要索引"条目内容（用于$5优先替换） */
  export async function getSummaryIndexContentForPlot_ACU(plotSettings: any, readContext?: PlotWorldbookReadContext_ACU) {
    if (!plotSettings) return null;
    const context = readContext ?? createPlotWorldbookReadContext_ACU({
      resolveCharacterLorebookNames: async () => {
        const binding = await getCharLorebooks_ACU({ type: 'all' });
        return [binding?.primary, binding?.secondary, ...(binding?.additional || [])]
          .filter((name): name is string => typeof name === 'string' && !!name.trim());
      },
    });
    try {
      const plotCfg = plotSettings?.plotWorldbookConfig;
      const worldbookSource = plotCfg?.source || plotSettings.worldbookSource || 'character';
      const candidates = worldbookSource === 'manual'
        ? (plotCfg?.manualSelection ?? plotSettings.selectedWorldbooks ?? [])
        : await context.characterLorebookNamesPromise;
      const bookNames = [...new Set<string>((Array.isArray(candidates) ? candidates : [])
        .filter((name): name is string => typeof name === 'string' && !!name.trim()))];
      const result = await getLorebookEntriesStrict_ACU(bookNames, {
        source: 'plot_runtime',
        validationPolicy: worldbookSource === 'manual' ? 'validate_list' : 'trusted_direct',
        runId: context.runId,
        context,
      });
      if (result.status !== 'success') throw createStrictLorebookReadError_ACU(result);
      const baseComment = 'TavernDB-ACU-CustomExport-纪要索引';
      const targetComment = getIsolationPrefix_ACU() + baseComment;
      for (const bookName of bookNames) {
          const indexEntry = result.entriesByBook[bookName]?.find((entry: any) => {
            const comment = String(entry?.comment || '').trim();
            return comment === targetComment || comment.endsWith(baseComment);
          });
          if (indexEntry?.content) {
            logDebug_ACU('[剧情推进] $5 从世界书纪要索引条目获取成功' + (indexEntry.enabled ? '' : '(条目已禁用)'));
            return indexEntry.content;
          }
      }
      return null;
    } finally {
      if (!readContext) context.dispose();
    }
  }

  /** [剧情推进专用] $5 只注入"总体大纲"表（含表头） */
  export function formatOutlineTableForPlot_ACU(allTablesJson: any) {
    try {
      if (!allTablesJson || typeof allTablesJson !== 'object') {
        return '总体大纲表：未获取到表格数据。';
      }
      const sheets: any[] = Object.values(allTablesJson).filter((x: any) => x && typeof x === 'object' && x.name && x.content);
      const outline = sheets.find(s => String(s.name || '').trim() === '总体大纲');
      if (!outline || !Array.isArray(outline.content) || outline.content.length === 0) {
        return '总体大纲表：未找到该表或表结构为空。';
      }

      const headerRow = Array.isArray(outline.content[0]) ? outline.content[0] : [];
      const headers = headerRow.slice(1).map((h: any) => String(h ?? '').trim()).filter(Boolean);
      let out = `## 表格: 总体大纲\n`;
      out += headers.length ? `Columns: ${headers.join(', ')}\n` : 'Columns: (无表头)\n';

      const rows = outline.content.slice(1).filter((r: any) => Array.isArray(r));
      if (rows.length === 0) {
        out += '(无数据行)\n';
        return out;
      }

      rows.forEach((row: any, idx: number) => {
        const cells = row.slice(1);
        const parts: string[] = [];
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

  /** [剧情推进专用] $5 从纪要表本地数据读取概要和编码索引两列 */
  export function formatSummaryIndexForPlot_ACU(allTablesJson: any) {
    try {
      if (!allTablesJson || typeof allTablesJson !== 'object') {
        logDebug_ACU('[剧情推进] formatSummaryIndexForPlot_ACU: 未获取到表格数据');
        return { success: false, content: '纪要索引：未获取到表格数据。' };
      }
      const sheets: any[] = Object.values(allTablesJson).filter((x: any) => x && typeof x === 'object' && x.name && x.content);
      const summaryTable = sheets.find(s => {
        const name = String(s.name || '').trim();
        return name === '纪要表' || name === '总结表';
      });

      if (!summaryTable) {
        logDebug_ACU('[剧情推进] formatSummaryIndexForPlot_ACU: 未找到纪要表，可用表格:', sheets.map(s => s.name));
        return { success: false, content: '纪要索引：未找到纪要表。' };
      }

      if (!Array.isArray(summaryTable.content) || summaryTable.content.length <= 1) {
        logDebug_ACU('[剧情推进] formatSummaryIndexForPlot_ACU: 纪要表为空，content长度:', summaryTable.content?.length);
        return { success: false, content: '纪要索引：纪要表为空。' };
      }

      const headerRow = Array.isArray(summaryTable.content[0]) ? summaryTable.content[0] : [];
      logDebug_ACU('[剧情推进] formatSummaryIndexForPlot_ACU: 纪要表表头:', JSON.stringify(headerRow));

      const summaryColIdx = headerRow.findIndex((h: any) => {
        const name = String(h ?? '').trim();
        return name === '概览' || name === '概要';
      });
      const indexColIdx = headerRow.findIndex((h: any) => String(h ?? '').trim() === '编码索引');

      if (summaryColIdx === -1 || indexColIdx === -1) {
        logWarn_ACU('[剧情推进] formatSummaryIndexForPlot_ACU: 未找到概要列或编码索引列，概要列索引=', summaryColIdx, ', 编码索引列索引=', indexColIdx);
        return { success: false, content: '纪要索引：未找到概要列或编码索引列。' };
      }

      let out = `## 表格: 纪要索引\n`;
      out += `Columns: 概要, 编码索引\n`;

      const rows = summaryTable.content.slice(1).filter((r: any) => Array.isArray(r));
      if (rows.length === 0) {
        out += '(无数据行)\n';
        return { success: true, content: out };
      }

      rows.forEach((row: any, idx: number) => {
        const summary = row[summaryColIdx] ? String(row[summaryColIdx]).trim() : '';
        const indexCode = row[indexColIdx] ? String(row[indexColIdx]).trim() : '';
        if (summary || indexCode) {
          out += `- [${idx}] 概要: ${summary} | 编码索引: ${indexCode}\n`;
        }
      });
      logDebug_ACU('[剧情推进] formatSummaryIndexForPlot_ACU: 成功生成纪要索引，行数=', rows.length);
      return { success: true, content: out };
    } catch (e) {
      logError_ACU('[剧情推进] 格式化纪要索引时出错:', e);
      return { success: false, content: '纪要索引：格式化时发生错误。' };
    }
  }
