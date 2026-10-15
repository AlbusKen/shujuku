/**
 * useWorldbookSelector — D8 业务组件配套数据层（阶段 2 / D21.3）
 *
 * 列出宿主全部世界书 + 当前角色卡主世界书。`.vue` 不直接 import service。
 */
import { getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { getCurrentCharacterCardKey_ACU, getCurrentCharacterId_ACU } from '../../data/gateways/host-state-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../data/storage/chat-history';
import { getWorldbookNames_ACU } from '../../service/worldbook/pipeline';
import { getCurrentCharPrimaryLorebook_ACU } from '../../service/worldbook/worldbook-service';
import { logError_ACU } from '../../shared/utils';

export type WorldbookLoadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseWorldbookSelector {
  names: ReturnType<typeof shallowRef<string[]>>;
  charPrimary: ReturnType<typeof ref<string | null>>;
  status: ReturnType<typeof ref<WorldbookLoadStatus>>;
  error: ReturnType<typeof ref<string>>;
  refresh(): Promise<void>;
}

export function useWorldbookSelector(): UseWorldbookSelector {
  const names = shallowRef<string[]>([]);
  const charPrimary = ref<string | null>(null);
  const status = ref<WorldbookLoadStatus>('idle');
  const error = ref<string>('');
  let generation = 0;
  let disposed = false;

  function captureScope() {
    const chat = getChatArray_ACU();
    return {
      chat: chat.length ? chat : null,
      chatId: getActiveChatStorageIdentity_ACU(chat),
      characterKey: getCurrentCharacterCardKey_ACU(),
      characterId: getCurrentCharacterId_ACU(),
    };
  }

  if (getCurrentScope()) onScopeDispose(() => {
    disposed = true;
    generation++;
  });

  async function refresh(): Promise<void> {
    if (disposed) return;
    const requestGeneration = ++generation;
    const scope = captureScope();
    const isCurrent = () => {
      if (disposed || requestGeneration !== generation) return false;
      const current = captureScope();
      return current.chat === scope.chat && current.chatId === scope.chatId
        && current.characterKey === scope.characterKey && current.characterId === scope.characterId;
    };
    status.value = 'loading';
    error.value = '';
    try {
      const [list, primary] = await Promise.all([
        getWorldbookNames_ACU(),
        getCurrentCharPrimaryLorebook_ACU(),
      ]);
      if (!isCurrent()) return;
      names.value = Array.isArray(list) ? list.slice() : [];
      charPrimary.value = typeof primary === 'string' && primary ? primary : null;
      status.value = 'success';
    } catch (e: any) {
      if (!isCurrent()) return;
      logError_ACU('[ACU-V2] useWorldbookSelector refresh failed', e);
      error.value = e?.message ?? '世界书列表加载失败';
      status.value = 'error';
    }
  }

  return { names, charPrimary, status, error, refresh };
}
