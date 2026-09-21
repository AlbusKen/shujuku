import { onMounted, ref } from 'vue';
import {
  clearDanglingReference_ACU,
  collectDanglingApiPresetReferences_ACU,
  collectDanglingWorldbookReferences_ACU,
  type DanglingReferenceItem_ACU,
} from '../../service/settings/dangling-reference-audit-service';

export type DanglingReferenceScope_ACU = 'api' | 'worldbook';

export function useDanglingReferenceAudit(scope: DanglingReferenceScope_ACU) {
  const items = ref<DanglingReferenceItem_ACU[]>([]);
  const loading = ref(false);
  const clearingId = ref('');
  const error = ref('');

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      items.value = scope === 'api'
        ? collectDanglingApiPresetReferences_ACU()
        : await collectDanglingWorldbookReferences_ACU();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '校验失效引用失败';
      items.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function clear(item: DanglingReferenceItem_ACU): Promise<void> {
    clearingId.value = item.id;
    error.value = '';
    try {
      const result = await clearDanglingReference_ACU(item);
      if (!result.ok) {
        error.value = result.message || '清除失败';
        return;
      }
      await refresh();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '清除失败';
    } finally {
      clearingId.value = '';
    }
  }

  onMounted(() => {
    void refresh();
  });

  return {
    items,
    loading,
    clearingId,
    error,
    refresh,
    clear,
  };
}
