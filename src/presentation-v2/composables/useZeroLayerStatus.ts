import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { subscribeChatRuntimeReloaded_ACU } from '../../shared/chat-runtime-reload-signal';
import { assertZeroLayerCarrier_ACU, captureZeroLayerCarrier_ACU } from '../../service/zero-layer/carrier-context';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU } from '../../service/zero-layer/model';
import { subscribeZeroLayerChanges_ACU } from '../../service/zero-layer/notifications';
import { ZeroLayerStore_ACU } from '../../service/zero-layer/store';
import { useChatChangedTick, useChatMutationTick } from './useChatChangedListener';

export interface ZeroLayerStatusView {
  status: 'loading' | 'disabled' | 'preparing' | 'recovery-required' | 'incompatible' | 'storage-read-failed';
  intent: boolean | null;
  label: string;
  detail: string;
  revision: number | null;
  headTurnId: string | null;
}

function loadingStatus(): ZeroLayerStatusView {
  return { status: 'loading', intent: null, label: '读取中',
    detail: '正在读取当前聊天存档；不会保存设置或自动恢复。', revision: null, headTurnId: null };
}

/** 仅投影已校验存档；尚未通过完整生产准入，不对外声明 ready。 */
function projectStatus(source: ZeroLayerEnvelope_ACU | null): ZeroLayerStatusView {
  const branch = source?.branches.find(item => item.branchId === source.activeBranchId);
  const base = { intent: source?.enabled ?? false, revision: source?.revision ?? null,
    headTurnId: branch?.headTurnId ?? null };
  if (source?.exitManifest?.phase === 'prepared'
    || branch?.checkpoints?.pending || branch?.checkpoints?.cleanupPending
    || source?.turns.some(turn => turn.branchId === source.activeBranchId
      && !['published', 'cancelled', 'failed'].includes(turn.phase))) {
    return { ...base, status: 'recovery-required', label: '待恢复',
      detail: '存档有未闭合回合、checkpoint 或退出意图。只读刷新不恢复、不重发正文；关闭也不等于取得普通发送资格。' };
  }
  if (branch?.bridge && branch.bridge.phase !== 'reconciled') {
    return { ...base, status: 'preparing', label: '桥接未完成',
      detail: '已保存的启用桥接尚未确认完成。请通过受控恢复入口处理；此处不会推进保存阶段。' };
  }
  if (!source?.enabled) return { ...base, status: 'disabled', label: '已关闭',
    detail: source?.exitManifest?.phase === 'committed' ? '已关闭并保存普通模式退出归档；逻辑历史保留。'
      : source ? '已保存关闭意图；逻辑历史保留，不自动退出到普通模式。'
        : '服务器确认当前聊天尚未启用；默认关闭，不创建存档。' };
  return { ...base, status: 'incompatible', label: '尚未开放',
    detail: '已保存开启意图，但完整宿主与游戏适配验收尚未闭合；这里不提供启用、发送或就绪资格。' };
}

function failedStatus(error: unknown): ZeroLayerStatusView {
  const code = error instanceof ZeroLayerError_ACU ? error.code : 'storage-read-failed';
  const recovery = code === 'persist-unknown';
  const incompatible = ['source-changed', 'scope-changed', 'corrupt-data', 'unsupported-version',
    'chat-unavailable', 'carrier-unavailable'].includes(code);
  return { status: recovery ? 'recovery-required' : incompatible ? 'incompatible' : 'storage-read-failed',
    intent: null, label: recovery ? '保存待确认' : incompatible ? '当前不可用' : '读取失败',
    detail: recovery ? '保存结果未知，开启意图也未确认。只读刷新不能解除门禁，请使用显式恢复入口。'
      : incompatible ? `当前聊天身份、源历史或存档无法确认（${code}）；不会按默认关闭处理。`
        : '当前聊天存档读取失败，开启意图未知；可重试只读刷新，不会保存或重新生成。',
    revision: null, headTurnId: null };
}

export function useZeroLayerStatus() {
  const view = ref<ZeroLayerStatusView>(loadingStatus());
  const store = new ZeroLayerStore_ACU();
  const releases: Array<() => void> = [];
  let epoch = 0;
  let disposed = false;
  let pendingChat: string | null = null;
  let boundKey: string | null = null;

  function invalidate(): void {
    epoch++;
    boundKey = null;
    view.value = loadingStatus();
  }

  async function refresh(): Promise<void> {
    if (disposed || pendingChat !== null) return;
    const lease = ++epoch;
    view.value = loadingStatus();
    try {
      const context = captureZeroLayerCarrier_ACU();
      boundKey = context.key;
      const source = await store.readPersistedSnapshot();
      if (disposed || lease !== epoch || pendingChat !== null) return;
      assertZeroLayerCarrier_ACU(context);
      view.value = projectStatus(source);
    } catch (error) {
      if (!disposed && lease === epoch && pendingChat === null) view.value = failedStatus(error);
    }
  }

  watch(useChatChangedTick(), () => {
    pendingChat = null;
    invalidate();
    void refresh();
  });
  watch(useChatMutationTick(), () => {
    invalidate();
    void refresh();
  });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    epoch++;
    boundKey = null;
    for (const release of releases.splice(0)) {
      try { release(); } catch { /* 已撤销的回调不能回填，继续解绑其他监听。 */ }
    }
  }

  onMounted(() => {
    const source = SillyTavern_API_ACU?.eventSource;
    const events = SillyTavern_API_ACU?.eventTypes;
    if (!source || !events?.CHAT_CHANGED) {
      view.value = { ...failedStatus(new ZeroLayerError_ACU('chat-unavailable', '聊天生命周期不可用。')),
        detail: '宿主聊天生命周期不可用，无法安全绑定当前聊天；开启意图未知。' };
      return;
    }
    const listen = (event: string, callback: (...args: any[]) => void) => {
      const guarded = (...args: any[]) => { if (!disposed) callback(...args); };
      source.on(event as Parameters<typeof source.on>[0], guarded);
      releases.push(() => source.removeListener(event as Parameters<typeof source.removeListener>[0], guarded));
    };
    try {
      listen(events.CHAT_CHANGED, name => {
        pendingChat = String(name ?? '');
        invalidate();
      });
      for (const name of ['MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED']) {
        const event = (events as unknown as Record<string, string | undefined>)[name];
        if (event) listen(event, () => { invalidate(); void refresh(); });
      }
      releases.push(subscribeChatRuntimeReloaded_ACU(name => {
        if (disposed || pendingChat === null || name !== pendingChat) return;
        pendingChat = null;
        void refresh();
      }));
      releases.push(subscribeZeroLayerChanges_ACU(change => {
        if (disposed || pendingChat !== null || !boundKey
          || JSON.stringify([change.scope.characterKey, change.scope.chatId]) !== boundKey) return;
        if (change.kind === 'scope-invalidated') { invalidate(); return; }
        if (change.kind === 'stored' || change.kind === 'snapshot') void refresh();
      }));
      window.addEventListener('pagehide', dispose, { once: true });
      releases.push(() => window.removeEventListener('pagehide', dispose));
      void refresh();
    } catch {
      dispose();
      view.value = { ...failedStatus(new ZeroLayerError_ACU('chat-unavailable', '监听装配失败。')),
        detail: '聊天状态监听装配失败，未开放操作；请重新打开页面。' };
    }
  });
  onBeforeUnmount(dispose);

  return { view, refresh };
}
