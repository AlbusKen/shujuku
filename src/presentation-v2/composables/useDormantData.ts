/**
 * useDormantData — 休眠数据可见性与唤醒（S3-4）的 UI 编排。
 *
 * 职责：为 DormantDataPanel 提供休眠表/休眠列清单状态、刷新与唤醒动作。
 * 清单读取直连 dormant-data-service（presentation-v2 约定：composable 直连 service）；
 * 唤醒动作走 dialogStore.confirm 二次确认 → 服务调用 → toast 反馈 → 重新拉取清单。
 *
 * 错误语义：清单读取失败进入 error 态（区分「无休眠数据」与「历史读不出」）；
 * 唤醒失败 toast 透传服务层错误，不改任何本地状态。
 */
import { computed, ref } from 'vue';
import {
  type DormantColumnEntry_ACU,
  type DormantIntegrityIssue_ACU,
  type DormantTableEntry_ACU,
  auditDormantDataIntegrity_ACU,
  listDormantColumns_ACU,
  listDormantTables_ACU,
  wakeDormantColumn_ACU,
  wakeDormantTable_ACU,
} from '../../service/template/dormant-data-service';
import { useDialogStore } from '../stores/dialog-store';
import { useToastStore } from '../stores/toast-store';

export function useDormantData() {
  const dialogStore = useDialogStore();
  const toast = useToastStore();

  const dormantTables = ref<DormantTableEntry_ACU[]>([]);
  const dormantColumns = ref<DormantColumnEntry_ACU[]>([]);
  /** S3-3 休眠完整性问题（孤儿表等）；审计失败时置空——派生失败已由 listError 呈现，不重复报。 */
  const integrityIssues = ref<DormantIntegrityIssue_ACU[]>([]);
  /** 清单读取错误（null 表示读取成功）；表/列两个来源任一失败都会填充。 */
  const listError = ref<string | null>(null);
  /** 'refresh' | 'wake:<sheetKey>' | 'wake:<sheetKey>:<hiddenName>' | null */
  const busyAction = ref<string | null>(null);
  const loaded = ref(false);

  const isEmpty = computed(
    () => dormantTables.value.length === 0 && dormantColumns.value.length === 0,
  );

  function refresh(): void {
    busyAction.value = 'refresh';
    try {
      const tablesResult = listDormantTables_ACU();
      const columnsResult = listDormantColumns_ACU();
      const auditResult = auditDormantDataIntegrity_ACU();
      dormantTables.value = tablesResult.ok ? tablesResult.entries : [];
      dormantColumns.value = columnsResult.ok ? columnsResult.entries : [];
      integrityIssues.value = auditResult.ok ? auditResult.issues : [];
      const errors = [tablesResult, columnsResult]
        .filter(result => !result.ok)
        .map(result => result.error || '未知错误');
      listError.value = errors.length > 0 ? errors.join('；') : null;
      loaded.value = true;
    } finally {
      busyAction.value = null;
    }
  }

  async function wakeTable(entry: DormantTableEntry_ACU): Promise<boolean> {
    if (busyAction.value) return false;
    if (!entry.canWake) {
      toast.error(entry.wakeBlockedReason || '该休眠表当前不可唤醒。');
      return false;
    }
    const confirmed = await dialogStore.confirm({
      title: '唤醒休眠表',
      message: `将表「${entry.name}」（${entry.rowCount} 行 · ${entry.columnCount} 列）恢复到当前模板？其休眠前的数据将一并复原。`,
      confirmLabel: '唤醒',
      confirmVariant: 'primary',
    });
    if (!confirmed) return false;
    busyAction.value = `wake:${entry.sheetKey}`;
    try {
      const result = await wakeDormantTable_ACU(entry.sheetKey);
      if (!result.saved) {
        toast.error(result.error || `唤醒表「${entry.name}」失败。`);
        return false;
      }
      toast.success(`已唤醒表「${entry.name}」。`, { muteable: false });
      return true;
    } finally {
      busyAction.value = null;
      refresh();
    }
  }

  async function wakeColumn(entry: DormantColumnEntry_ACU): Promise<boolean> {
    if (busyAction.value) return false;
    const confirmed = await dialogStore.confirm({
      title: '唤醒休眠列',
      message: `将表「${entry.sheetName}」的列「${entry.header}」恢复为可见？该列的既有数据将一并复原。`,
      confirmLabel: '唤醒',
      confirmVariant: 'primary',
    });
    if (!confirmed) return false;
    busyAction.value = `wake:${entry.sheetKey}:${entry.hiddenName}`;
    try {
      const result = await wakeDormantColumn_ACU(entry.sheetKey, entry.hiddenName);
      if (!result.saved) {
        toast.error(result.error || `唤醒列「${entry.header}」失败。`);
        return false;
      }
      toast.success(`已唤醒表「${entry.sheetName}」的列「${entry.header}」。`, { muteable: false });
      return true;
    } finally {
      busyAction.value = null;
      refresh();
    }
  }

  return {
    dormantTables,
    dormantColumns,
    integrityIssues,
    listError,
    busyAction,
    loaded,
    isEmpty,
    refresh,
    wakeTable,
    wakeColumn,
  };
}
