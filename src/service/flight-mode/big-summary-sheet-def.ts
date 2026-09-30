import type { Sheet_ACU, SheetExportConfig_ACU, SheetUpdateConfig_ACU } from '../../shared/models/table-data';
import {
  FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU,
  FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU,
} from '../../shared/models/flight-mode-model';
import { RECENT_CHRONICLE_ROWS_PLACEHOLDER_ACU as N_ACU } from '../fill-mode/fill-mode-preferences';

const FLIGHT_MODE_BIG_SUMMARY_ENTRY_PLACEMENT_ACU = {
  position: 'at_depth_as_system',
  depth: 1000,
  order: 10010,
};

function cloneValue_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nextOrderNo_ACU(template: Record<string, any>): number {
  const orderNumbers = Object.keys(template)
    .filter(key => key.startsWith('sheet_'))
    .map(key => Number(template[key]?.orderNo))
    .filter(Number.isFinite);
  return orderNumbers.length > 0 ? Math.max(...orderNumbers) + 1 : 0;
}

export function buildFlightModeBigSummarySheet_ACU(
  chronicleSheet: Sheet_ACU,
  template: Record<string, any>,
): Sheet_ACU {
  const updateConfig = cloneValue_ACU<SheetUpdateConfig_ACU>(chronicleSheet.updateConfig);
  const exportConfig: SheetExportConfig_ACU = {
    enabled: true,
    splitByRow: false,
    entryName: FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU,
    entryType: 'constant',
    keywords: '',
    preventRecursion: true,
    injectionTemplate: '<大总结>\n$1\n</大总结>',
    extraIndexEnabled: false,
    extraIndexEntryName: `${FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU}-索引`,
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: '',
    entryPlacement: { ...FLIGHT_MODE_BIG_SUMMARY_ENTRY_PLACEMENT_ACU },
    extraIndexPlacement: { ...FLIGHT_MODE_BIG_SUMMARY_ENTRY_PLACEMENT_ACU },
    fixedEntryPlacement: { ...FLIGHT_MODE_BIG_SUMMARY_ENTRY_PLACEMENT_ACU },
    fixedIndexPlacement: { ...FLIGHT_MODE_BIG_SUMMARY_ENTRY_PLACEMENT_ACU },
  };

  return {
    uid: FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU,
    name: FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU,
    sourceData: {
      note: `大总结是按阶段追加、不可变的历史记录：每一行总结对应一个已完成的纪要阶段，已有行只能读取用于承接上下文，禁止修改或删除。仅当当前仍可见的纪要达到 ${N_ACU} 条（含超过）时才允许新增一行大总结；少于 ${N_ACU} 条时禁止新增。新增行必须完整归纳当前纪要表中全部可见纪要，不得只总结最新若干条、不得只抽取重点、不得遗漏会改变整体脉络的事实；必须与此前已有大总结在时间顺序、因果、人物状态与阶段演进上保持逻辑连贯，不得与既有总结矛盾或割裂叙事。新增后系统会隐藏当时已归纳的纪要。不要填写纪要引用范围。`,
      initNode: `无需初始化；当前可见纪要未达到 ${N_ACU} 条时，不得以初始化为由插入首行。`,
      deleteNode: '禁止删除任何已有大总结。',
      updateNode: '禁止修改任何已有大总结；已有大总结是不可变的历史阶段记录。',
      insertNode: `仅当当前可见纪要达到 ${N_ACU} 条（含超过）时，基于当前纪要表全部可见内容新增一行完整总结，并确保与此前大总结逻辑连贯；少于 ${N_ACU} 条时禁止新增。无需写纪要引用范围。`,
      ddl: `CREATE TABLE flight_big_summary ( -- ${FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU}\n  row_id INTEGER PRIMARY KEY, -- 行号\n  summary_text TEXT NOT NULL -- 总结\n);`,
    },
    content: [['row_id', '总结']],
    updateConfig,
    exportConfig,
    orderNo: nextOrderNo_ACU(template),
  };
}
