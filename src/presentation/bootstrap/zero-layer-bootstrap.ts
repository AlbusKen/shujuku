import { getHostWindow } from '../../shared/runtime-env';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import type { ZeroLayerRuntime_ACU } from '../../service/zero-layer/runtime';
import type { ZeroLayerBranchCommand_ACU } from '../../service/zero-layer/branch-command';
import type { ZeroLayerExitSelection_ACU } from '../../service/zero-layer/exit-model';
import { installHostGenerationInterceptor_ACU } from '../../data/gateways/host-generation-interceptor';
import { zeroLayerHistoryReader_ACU } from '../../service/zero-layer/history-read';
import { ZeroLayerStableView_ACU } from '../components/zero-layer-stable-view';
import { subscribeZeroLayerChanges_ACU } from '../../service/zero-layer/notifications';
import { showToastr_ACU } from '../theme/toast';
import { bindOrdinaryZeroLayerContext_ACU, assertOrdinaryZeroLayerRequest_ACU,
  invalidateOrdinaryZeroLayerRequests_ACU } from '../../service/zero-layer/ordinary-context';

let runtime_ACU: ZeroLayerRuntime_ACU | null = null;
let releaseOrdinaryGate_ACU: (() => void) | null = null;
let loading_ACU: Promise<ZeroLayerRuntime_ACU> | null = null;
let installedSource_ACU: object | null = null;
let lifecycleEpoch_ACU = 0;
let releaseBootstrap_ACU: (() => void) | null = null;
const stableView_ACU = new ZeroLayerStableView_ACU();
let mountingView_ACU: Promise<void> | null = null;

/** 展示失败保留已发布数据；重同步只回读，不重新生成或重载 shell。 */
export async function resyncZeroLayerViewForPage_ACU(): Promise<void> {
  if (stableView_ACU.isMounted) return stableView_ACU.resync();
  if (mountingView_ACU) return mountingView_ACU;
  const operation = stableView_ACU.mount();
  mountingView_ACU = operation;
  try { await operation; }
  finally { if (mountingView_ACU === operation) mountingView_ACU = null; }
}

function invalidateZeroLayerView_ACU(): void {
  stableView_ACU.dispose();
  mountingView_ACU = null;
}

/** 存档操作已成功；展示错误不得伪装成保存失败或触发再次提交。 */
async function syncConfirmedZeroLayerView_ACU(): Promise<void> {
  const epoch = lifecycleEpoch_ACU;
  try { await resyncZeroLayerViewForPage_ACU(); }
  catch {
    if (epoch !== lifecycleEpoch_ACU) return;
    try {
      showToastr_ACU('warning', '零层存档已确认，但正文显示未同步。请使用数据重同步，不要重新生成或重载游戏。');
    } catch { /* 通知失败不改变已确认存档。 */ }
  }
}

/** 两种入口共用；能力缺失时不改变普通发送，不创建聊天存档。 */
export function installZeroLayerBootstrap_ACU(): void {
  const api = SillyTavern_API_ACU;
  const source = api?.eventSource;
  const events = api?.eventTypes;
  if (!source || !events?.CHAT_COMPLETION_PROMPT_READY || !events.CHAT_COMPLETION_SETTINGS_READY
    || typeof getHostWindow().fetch !== 'function' || installedSource_ACU === source) return;
  releaseBootstrap_ACU?.();
  installedSource_ACU = source;
  releaseOrdinaryGate_ACU = installHostGenerationInterceptor_ACU({
    isActive: () => false,
    claim: () => null,
    beforeForward: request => { assertOrdinaryZeroLayerRequest_ACU(request, runtime_ACU?.session.hasActiveTurn() === true); },
  });
  let active = true;
  const releases: Array<() => void> = [];
  const listen = (event: string, listener: (...args: any[]) => void) => {
    const guarded = (...args: any[]) => { if (active) return listener(...args); };
    source.on(event as Parameters<typeof source.on>[0], guarded);
    releases.push(() => source.removeListener?.(event as Parameters<typeof source.removeListener>[0], guarded));
  };
  listen(events.CHAT_COMPLETION_PROMPT_READY, data => runtime_ACU?.session.bindPrompt(data));
  // makeLast 的数据库模板监听随后注册；先将本请求绑定到独立逻辑快照。
  listen(events.CHAT_COMPLETION_SETTINGS_READY, data => {
    if (runtime_ACU?.session.hasActiveTurn()) runtime_ACU.session.bindSettings(data);
    else bindOrdinaryZeroLayerContext_ACU(data);
  });
  const invalidate = () => {
    lifecycleEpoch_ACU += 1;
    invalidateZeroLayerView_ACU();
    zeroLayerHistoryReader_ACU.invalidate();
    invalidateOrdinaryZeroLayerRequests_ACU();
    runtime_ACU?.invalidate();
  };
  listen(events.CHAT_CHANGED, invalidate);
  listen(events.MESSAGE_DELETED, invalidate);
  listen(events.MESSAGE_SWIPED, invalidate);
  // 不依赖编辑事件来推测新历史；事件只撤销租约，存储边界仍复核原前缀。
  const editEvents = events as unknown as Record<string, string>;
  if (editEvents.MESSAGE_EDITED) listen(editEvents.MESSAGE_EDITED, invalidate);
  if (editEvents.MESSAGE_UPDATED) listen(editEvents.MESSAGE_UPDATED, invalidate);
  listen(events.GENERATION_STOPPED, () => {
    invalidateOrdinaryZeroLayerRequests_ACU();
    runtime_ACU?.cancel();
  });
  releases.push(subscribeZeroLayerChanges_ACU(change => {
    if (!active || change.kind !== 'stored' && change.kind !== 'snapshot') return;
    // 普通模式和关闭状态不会创建正文槽；公开读口决定当前 scope 是否可读取。
    if (!stableView_ACU.isMounted) {
      void resyncZeroLayerViewForPage_ACU().catch(() => { /* 由显式重同步入口报告展示失败。 */ });
    }
  }));
  const release = () => {
    if (!active) return;
    active = false;
    invalidate();
    runtime_ACU?.dispose();
    releaseOrdinaryGate_ACU?.();
    releaseOrdinaryGate_ACU = null;
    for (const remove of releases) {
      try { remove(); } catch { /* 已失效回调不会继续执行；仍清理其他监听。 */ }
    }
    window.removeEventListener('pagehide', release);
    if (installedSource_ACU === source) installedSource_ACU = null;
    if (releaseBootstrap_ACU === release) releaseBootstrap_ACU = null;
  };
  releaseBootstrap_ACU = release;
  window.addEventListener('pagehide', release, { once: true });
}

/** 延迟装配避免启动时的 IO/默认值写回；未加载完成不能启动生成。 */
export async function loadZeroLayerRuntimeForPage_ACU(): Promise<ZeroLayerRuntime_ACU> {
  installZeroLayerBootstrap_ACU();
  if (!installedSource_ACU) throw new Error('宿主缺少零层 bootstrap 所需的事件或 fetch 能力。');
  const epoch = lifecycleEpoch_ACU;
  loading_ACU ??= import('../../service/zero-layer/runtime').then(module => module.getZeroLayerRuntime_ACU());
  const runtime = await loading_ACU;
  if (epoch !== lifecycleEpoch_ACU) throw new Error('零层装配期间聊天已切换，请重新读取。');
  runtime.install();
  runtime_ACU = runtime;
  return runtime;
}

/** 两种页面入口共用显式操作；装配本身不创建或启用存档。 */
export async function setZeroLayerEnabledForPage_ACU(enabled: boolean, apiPresetName?: string) {
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  const envelope = await runtime.setEnabled(enabled, apiPresetName);
  if (enabled) await syncConfirmedZeroLayerView_ACU();
  else invalidateZeroLayerView_ACU();
  return envelope;
}

/** 未知保存仅由此显式回读，不在装配、聊天事件或错误处理里盲目重试。 */
export async function recoverZeroLayerBridgeForPage_ACU() {
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  const envelope = await runtime.recoverBridge();
  if (envelope.enabled) await syncConfirmedZeroLayerView_ACU();
  return envelope;
}

/** 页面显式选择逻辑切点；不接受物理下标换算成逻辑身份。 */
export async function changeZeroLayerBranchForPage_ACU(command: ZeroLayerBranchCommand_ACU) {
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  const envelope = await runtime.changeBranch(command);
  if (envelope.enabled) await syncConfirmedZeroLayerView_ACU();
  return envelope;
}

/** 所选 head 和普通接入点必须由调用者传入原 FloorRef。 */
export async function exitZeroLayerForPage_ACU(selection: ZeroLayerExitSelection_ACU) {
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  return runtime.exitToOrdinary(selection);
}

export async function recoverZeroLayerExitForPage_ACU() {
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  return runtime.recoverExit();
}