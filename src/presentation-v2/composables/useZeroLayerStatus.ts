import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { subscribeChatRuntimeReloaded_ACU } from '../../shared/chat-runtime-reload-signal';
import { assertZeroLayerCarrier_ACU, captureZeroLayerCarrier_ACU } from '../../service/zero-layer/carrier-context';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU } from '../../service/zero-layer/model';
import { subscribeZeroLayerChanges_ACU } from '../../service/zero-layer/notifications';
import { ZeroLayerStore_ACU } from '../../service/zero-layer/store';
import { useChatChangedTick, useChatMutationTick } from './useChatChangedListener';
import { getZeroLayerPageOperations_ACU } from '../../service/zero-layer/page-operations';
import { buildZeroLayerTimeline_ACU, getPublishedZeroLayerPath_ACU } from '../../service/zero-layer/timeline';
import { zeroLayerHistoryReader_ACU } from '../../service/zero-layer/history-read';
import type { ZeroLayerHistoryApi_ACU, ZeroLayerHistoryItem_ACU } from '../../service/zero-layer/history-model';
import { ZERO_LAYER_WORLD_INFO_SCAN_MAX_ROUNDS_ACU, readZeroLayerWorldInfoScanRounds_ACU } from '../../service/zero-layer/world-info-scan';
import { settings_ACU } from '../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../service/settings/settings-service';

export interface ZeroLayerStatusView {
  status: 'loading' | 'disabled' | 'preparing' | 'unverified' | 'recovery-required' | 'incompatible' | 'storage-read-failed';
  intent: boolean | null;
  label: string;
  detail: string;
  revision: number | null;
  headTurnId: string | null;
}

const ABANDONABLE_PHASES_ACU = ['prepared', 'dispatching', 'delivery-unknown'] as const;
type AbandonablePhase = typeof ABANDONABLE_PHASES_ACU[number];

function findAbandonableTurn(source: ZeroLayerEnvelope_ACU | null) {
  return source?.turns.find(turn => turn.branchId === source.activeBranchId
    && (ABANDONABLE_PHASES_ACU as readonly string[]).includes(turn.phase)) ?? null;
}

interface ZeroLayerControls {
  apiPresetName: string;
  branches: Array<{ value: string; label: string }>;
  heads: Array<{ value: string; label: string }>;
  branchId: string;
  canSend: boolean;
  canExit: boolean;
  /** 正文未保存的未闭合回合；只能由用户显式放弃，不提供重发。 */
  pendingTurn: { turnId: string; phase: AbandonablePhase } | null;
}

function emptyControls(): ZeroLayerControls {
  return { apiPresetName: '', branches: [], heads: [], branchId: '', canSend: false, canExit: false, pendingTurn: null };
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
  return { ...base, status: 'unverified', label: '已开启 · 待实机验证',
    detail: '启用存档已确认；宿主请求、保存恢复与游戏连续运行仍需实机验证。关闭保留历史，恢复不盲目重发正文。' };
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
  const controls = ref<ZeroLayerControls>(emptyControls());
  const working = ref(false);
  const actionError = ref('');
  const history = shallowRef<ZeroLayerHistoryItem_ACU[]>([]);
  const historyHasMore = ref(false);
  const historyLoading = ref(false);
  const historyError = ref('');
  const worldInfoScanRounds = ref(readZeroLayerWorldInfoScanRounds_ACU());
  let historyEpoch = 0;
  const store = new ZeroLayerStore_ACU();

  /** 全局设置，不随聊天保存；下一回合准备时冻结读取。保存失败回滚到原值。 */
  function setWorldInfoScanRounds(value: unknown): boolean {
    const next = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(next) || next < 0 || next > ZERO_LAYER_WORLD_INFO_SCAN_MAX_ROUNDS_ACU) {
      worldInfoScanRounds.value = readZeroLayerWorldInfoScanRounds_ACU();
      return false;
    }
    const previous = settings_ACU.zeroLayerWorldInfoScanRounds;
    settings_ACU.zeroLayerWorldInfoScanRounds = next;
    try {
      if (saveSettings_ACU()?.saved === false) settings_ACU.zeroLayerWorldInfoScanRounds = previous;
    } catch {
      settings_ACU.zeroLayerWorldInfoScanRounds = previous;
    }
    worldInfoScanRounds.value = readZeroLayerWorldInfoScanRounds_ACU();
    return worldInfoScanRounds.value === next;
  }
  const releases: Array<() => void> = [];
  let confirmed: ZeroLayerEnvelope_ACU | null | undefined;
  let actionEpoch = 0;
  let releaseHistory: (() => void) | null = null;
  let unsubscribeHistory: (() => void) | null = null;
  let historyPage: { api: Readonly<ZeroLayerHistoryApi_ACU>; token: string; cursor: string | null } | null = null;
  let epoch = 0;
  let disposed = false;
  let pendingChat: string | null = null;
  let boundKey: string | null = null;

  function invalidate(): void {
    epoch++;
    actionEpoch++;
    boundKey = null;
    confirmed = undefined;
    controls.value = emptyControls();
    clearHistory();
    actionError.value = '';
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
      confirmed = source;
      view.value = projectStatus(source);
      const path = source ? getPublishedZeroLayerPath_ACU(source) : [];
      const pending = findAbandonableTurn(source);
      controls.value = source ? {
        apiPresetName: source.apiPresetName, branchId: source.activeBranchId,
        branches: source.branches.map(branch => ({ value: branch.branchId, label: branch.branchId })),
        heads: [{ value: '', label: '启用切点' }, ...path.map(turn => ({ value: turn.turnId, label: turn.turnId }))],
        canSend: source.enabled && view.value.status === 'unverified',
        canExit: !source.enabled && !source.exitManifest && path.length > 0 && view.value.status === 'disabled',
        pendingTurn: pending && !source.exitManifest
          ? { turnId: pending.turnId, phase: pending.phase as AbandonablePhase } : null,
      } : emptyControls();
    } catch (error) {
      if (!disposed && lease === epoch && pendingChat === null) {
        confirmed = undefined;
        controls.value = emptyControls();
        view.value = failedStatus(error);
      }
    }
  }

  function clearHistory(): void {
    historyEpoch++;
    const revoke = releaseHistory;
    const unsubscribe = unsubscribeHistory;
    releaseHistory = null;
    unsubscribeHistory = null;
    // 先解绑回调再撤销，避免同步撤销通知重入清理。
    unsubscribe?.();
    revoke?.();
    historyPage = null;
    history.value = [];
    historyHasMore.value = false;
    historyLoading.value = false;
    historyError.value = '';
  }

  /** 宿主面板显式选择分支/诊断权限；公开游戏读口不获得此授权。 */
  async function loadHistory(branchId: string, diagnostic = false, more = false): Promise<void> {
    if (disposed || pendingChat !== null || historyLoading.value || working.value || confirmed === undefined) return;
    if (!more) clearHistory();
    const lease = historyEpoch;
    const scopeLease = actionEpoch;
    historyLoading.value = true;
    historyError.value = '';
    try {
      if (!more) {
        const authorized = await zeroLayerHistoryReader_ACU.authorize({ branchId, diagnostic });
        if (disposed || lease !== historyEpoch || scopeLease !== actionEpoch) { authorized.revoke(); return; }
        releaseHistory = authorized.revoke;
        const result = await authorized.api.getSnapshot({ version: 1 });
        if (disposed || lease !== historyEpoch || scopeLease !== actionEpoch) return;
        if (result.ok === false) throw new Error(result.error.message);
        historyPage = { api: authorized.api, token: result.value.snapshotToken, cursor: null };
        unsubscribeHistory = authorized.api.subscribe(change => {
          if (change.kind !== 'scope-invalidated' || lease !== historyEpoch) return;
          clearHistory();
          historyError.value = '历史授权已撤销，请重新选择当前分支读取。';
        });
      }
      const page = historyPage;
      if (!page || more && !page.cursor) return;
      const result = await page.api.readHistory({ version: 1, snapshotToken: page.token,
        direction: 'older', limit: 20, ...(page.cursor ? { cursor: page.cursor } : {}) });
      if (disposed || lease !== historyEpoch || scopeLease !== actionEpoch) return;
      if (result.ok === false) throw new Error(result.error.message);
      history.value = more ? [...result.value.items, ...history.value] : [...result.value.items];
      page.cursor = result.value.nextCursor;
      historyHasMore.value = result.value.hasMore;
    } catch (error) {
      if (!disposed && lease === historyEpoch && scopeLease === actionEpoch) {
        clearHistory();
        historyError.value = error instanceof Error ? error.message : '历史读取失败，请重新取得快照。';
      }
    } finally {
      if (lease === historyEpoch) historyLoading.value = false;
    }
  }

  async function operate(work: (source: ZeroLayerEnvelope_ACU | null) => Promise<unknown>, recover = false): Promise<boolean> {
    if (disposed || working.value || pendingChat !== null || !recover && confirmed === undefined) return false;
    const lease = actionEpoch;
    working.value = true;
    actionError.value = '';
    try {
      const context = captureZeroLayerCarrier_ACU();
      let source = confirmed ?? null;
      if (!recover) {
        source = await store.readPersistedSnapshot();
        assertZeroLayerCarrier_ACU(context);
        if (disposed || lease !== actionEpoch || JSON.stringify(source) !== JSON.stringify(confirmed)) {
          throw new ZeroLayerError_ACU('revision-conflict', '存档已变化，请刷新后重新选择操作。');
        }
      }
      if (disposed || lease !== actionEpoch) throw new ZeroLayerError_ACU('scope-changed', '操作已撤销。');
      await work(source);
      assertZeroLayerCarrier_ACU(context);
      if (disposed || lease !== actionEpoch) return false;
      await refresh();
      return true;
    } catch (error) {
      if (!disposed && lease === actionEpoch) {
        actionError.value = error instanceof ZeroLayerError_ACU ? error.message
          : '操作未完成；请检查宿主能力、API 预设或游戏绑定后重试，不会退回普通发送。';
        await refresh();
      }
      return false;
    } finally { working.value = false; }
  }

  const setEnabled = (enabled: boolean, preset?: string) => operate(source => {
    if (!enabled && !source) return Promise.resolve();
    return getZeroLayerPageOperations_ACU().setEnabled(enabled, enabled ? preset : undefined);
  });
  const submit = (input: string) => operate(() => getZeroLayerPageOperations_ACU().submit(input));
  const recover = () => operate(() => getZeroLayerPageOperations_ACU().recover(), true);
  const abandon = () => operate(source => {
    const turn = findAbandonableTurn(source);
    if (!turn) throw new ZeroLayerError_ACU('invalid-transition', '当前没有可放弃的未保存回合。');
    return getZeroLayerPageOperations_ACU().abandon(turn.turnId, turn.attemptId);
  });
  const selectBranch = (branchId: string) => operate(() =>
    getZeroLayerPageOperations_ACU().changeBranch({ type: 'select-branch', branchId }));
  const forkBranch = (branchId: string, turnId: string) => operate(source => {
    if (!source) throw new ZeroLayerError_ACU('mode-disabled', '当前聊天没有逻辑历史。');
    const turn = getPublishedZeroLayerPath_ACU(source).find(item => item.turnId === turnId);
    if (turnId && !turn) throw new ZeroLayerError_ACU('history-unavailable', '所选切点已不可用。');
    return getZeroLayerPageOperations_ACU().changeBranch({ type: 'fork-branch', branchId,
      head: turn ? { kind: 'logical', sessionId: source.sessionId, branchId: turn.branchId,
        turnId: turn.turnId, floorId: turn.assistantFloor.floorId, role: 'assistant' } : null });
  });
  const exit = () => operate(source => {
    if (!source) throw new ZeroLayerError_ACU('mode-disabled', '当前聊天没有退出素材。');
    const context = captureZeroLayerCarrier_ACU();
    const floors = buildZeroLayerTimeline_ACU(source, context.chat as Record<string, unknown>[]).floors;
    const head = floors[floors.length - 1]?.ref;
    const target = floors[source.activationMessageCount - 1];
    if (head?.kind !== 'logical' || head.role !== 'assistant' || target?.ref.kind !== 'host' || target.role !== 'assistant') {
      throw new ZeroLayerError_ACU('history-unavailable', '退出需要已发布 head 和原物理前缀末尾的 assistant 接入点。');
    }
    return getZeroLayerPageOperations_ACU().exit({ expectedRevision: source.revision, head, target: target.ref });
  });
  const stop = () => {
    try { getZeroLayerPageOperations_ACU().stop(); }
    catch { /* 页面操作未装配时没有在途零层任务。 */ }
  };

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
    actionEpoch++;
    clearHistory();
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

  return { view, controls, working, actionError, history, historyHasMore, historyLoading, historyError,
    loadHistory, refresh, setEnabled,
    submit, recover, abandon, selectBranch, forkBranch, exit, stop,
    worldInfoScanRounds, setWorldInfoScanRounds };
}
