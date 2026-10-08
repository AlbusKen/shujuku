import { getHostWindow } from '../../shared/runtime-env';
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
import { installZeroLayerInputGate_ACU } from './zero-layer-input';
import { captureZeroLayerCarrier_ACU, assertZeroLayerCarrier_ACU, readZeroLayerCarrier_ACU,
  hasZeroLayerCarrierField_ACU } from '../../service/zero-layer/carrier-context';
import { ZeroLayerError_ACU } from '../../service/zero-layer/model';
import { getZeroLayerHostContext_ACU, requireZeroLayerHostGeneration_ACU } from '../../service/zero-layer/host-generation';
import { registerZeroLayerPageOperations_ACU } from '../../service/zero-layer/page-operations';

let runtime_ACU: ZeroLayerRuntime_ACU | null = null;
let releaseOrdinaryGate_ACU: (() => void) | null = null;
let loading_ACU: Promise<ZeroLayerRuntime_ACU> | null = null;
let installedSource_ACU: object | null = null;
let lifecycleEpoch_ACU = 0;
let releaseBootstrap_ACU: (() => void) | null = null;
let inputGate_ACU: ReturnType<typeof installZeroLayerInputGate_ACU> | null = null;
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

/** 宿主显式授权载体内的游戏 iframe；只读装配不创建或启用存档。 */
export async function bindZeroLayerGameFrameForPage_ACU(frame: HTMLIFrameElement, origin: string) {
  installZeroLayerBootstrap_ACU();
  if (!installedSource_ACU) throw new Error('宿主缺少零层生命周期能力。');
  const epoch = lifecycleEpoch_ACU;
  await resyncZeroLayerViewForPage_ACU();
  if (epoch !== lifecycleEpoch_ACU) throw new Error('scope-changed');
  return stableView_ACU.bindGameFrame(frame, origin);
}

function invalidateZeroLayerView_ACU(): void {
  stableView_ACU.dispose();
  mountingView_ACU = null;
}

/** 聊天导航、重载或租约撤销后只读恢复正文槽；普通/未启用聊天不挂载，也不触发读口撤销。 */
function restoreZeroLayerView_ACU(): void {
  if (stableView_ACU.isMounted || mountingView_ACU) return;
  try {
    if (!hasZeroLayerCarrierField_ACU()) return;
    if (!readZeroLayerCarrier_ACU(captureZeroLayerCarrier_ACU())?.enabled) return;
  } catch { return; }
  void resyncZeroLayerViewForPage_ACU().catch(() => { /* 载体未渲染或存档不可读时保持未挂载，由显式重同步报告。 */ });
}

const INPUT_NOTICES_ACU: Record<string, string> = {
  'zero-layer-busy': '零层回合仍在处理中；本次输入未发送，已保留在输入框。',
  'zero-layer-entry-not-supported': '零层只接管普通发送；重新生成、继续、滑动与代拟入口不受支持，原发送未执行。',
  'zero-layer-input-required': '零层发送需要本轮输入；原发送未执行。',
  'zero-layer-recovery-required': '当前聊天保留零层存档但未启用：请在数据库面板「零层卡模式」重新启用，或确认退出到普通模式后再发送；输入已保留。',
  'pending-turn': '零层仍有未闭合的回合或操作。请在数据库面板「零层卡模式」查看：正文已保存的可回读恢复，未保存的可确认放弃；输入已保留。',
};

function reportZeroLayerInputFailure_ACU(error?: unknown): void {
  const reason = error instanceof ZeroLayerError_ACU ? error.code : error instanceof Error ? error.message : '';
  try {
    if (INPUT_NOTICES_ACU[reason]) showToastr_ACU('warning', INPUT_NOTICES_ACU[reason]);
    else showToastr_ACU('error', `零层发送未完成${error instanceof ZeroLayerError_ACU ? `：${error.message.replace(/[。.]+$/, '')}` : ''}。输入已保留，请检查状态后显式恢复；不会退回普通发送。`);
  } catch { /* 提示失败不重新发送。 */ }
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
  const api = getZeroLayerHostContext_ACU();
  const source = api?.eventSource;
  const events = api?.eventTypes;
  if (!source || typeof source.emit !== 'function' || !events?.CHAT_COMPLETION_PROMPT_READY || !events.CHAT_COMPLETION_SETTINGS_READY
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
  let restoreTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRestore = () => {
    if (restoreTimer !== null) clearTimeout(restoreTimer);
    // 宿主在本次事件分发之后才完成重绘与聊天切换；下一任务再读取当前载体。
    restoreTimer = setTimeout(() => { restoreTimer = null; if (active) restoreZeroLayerView_ACU(); }, 0);
  };
  releases.push(() => { if (restoreTimer !== null) clearTimeout(restoreTimer); restoreTimer = null; });
  if (events.GENERATION_AFTER_COMMANDS) {
    inputGate_ACU = installZeroLayerInputGate_ACU(source, events.GENERATION_AFTER_COMMANDS,
      submitZeroLayerInputForPage_ACU, reportZeroLayerInputFailure_ACU,
      ['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'GENERATION_STOPPED']
        .map(name => (events as unknown as Record<string, string>)[name]).filter(Boolean));
    const gate = inputGate_ACU;
    releases.push(() => { gate(); if (inputGate_ACU === gate) inputGate_ACU = null; });
  }
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
    inputGate_ACU?.cancel();
    invalidateZeroLayerView_ACU();
    zeroLayerHistoryReader_ACU.invalidate();
    invalidateOrdinaryZeroLayerRequests_ACU();
    runtime_ACU?.invalidate();
    scheduleRestore();
  };
  listen(events.CHAT_CHANGED, invalidate);
  listen(events.MESSAGE_DELETED, invalidate);
  listen(events.MESSAGE_SWIPED, invalidate);
  // 不依赖编辑事件来推测新历史；只有已挂载正文槽与在途租约都确认物理源未变时才保留，存储边界仍复核原前缀。
  const revalidate = () => {
    if (stableView_ACU.isSourceCurrent() === true && runtime_ACU?.session.isSourceCurrent() !== false) return;
    invalidate();
  };
  const editEvents = events as unknown as Record<string, string>;
  if (editEvents.MESSAGE_EDITED) listen(editEvents.MESSAGE_EDITED, revalidate);
  if (editEvents.MESSAGE_UPDATED) listen(editEvents.MESSAGE_UPDATED, revalidate);
  listen(events.GENERATION_STOPPED, () => {
    inputGate_ACU?.cancel();
    invalidateOrdinaryZeroLayerRequests_ACU();
    runtime_ACU?.cancel();
  });
  releases.push(subscribeZeroLayerChanges_ACU(change => {
    if (!active || change.kind !== 'stored' && change.kind !== 'snapshot') return;
    // 普通模式和关闭状态不会创建正文槽；不在存储通知回调内同步读取载体。
    if (!stableView_ACU.isMounted) scheduleRestore();
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
  // 插件晚于聊天加载时不会再收到 CHAT_CHANGED；安装后也从权威快照初始化一次。
  scheduleRestore();
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
  if (typeof enabled !== 'boolean') throw new ZeroLayerError_ACU('invalid-transition', '开启意图必须为布尔值。');
  if (!enabled) inputGate_ACU?.cancel();
  else {
    const api = requireZeroLayerHostGeneration_ACU();
    if (!api.eventTypes.GENERATION_AFTER_COMMANDS) {
      throw new ZeroLayerError_ACU('invalid-transition', '宿主缺少入楼前输入分流事件，不能启用零层。');
    }
  }
  const context = captureZeroLayerCarrier_ACU();
  const epoch = lifecycleEpoch_ACU;
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  assertZeroLayerCarrier_ACU(context);
  if (epoch !== lifecycleEpoch_ACU) throw new ZeroLayerError_ACU('scope-changed', '启停准备期间聊天已变化。');
  const envelope = await runtime.setEnabled(enabled, apiPresetName);
  assertZeroLayerCarrier_ACU(context);
  if (enabled) await syncConfirmedZeroLayerView_ACU();
  else invalidateZeroLayerView_ACU();
  return envelope;
}

/** 未知保存仅由此显式回读，不在装配、聊天事件或错误处理里盲目重试。 */
export async function recoverZeroLayerBridgeForPage_ACU() {
  const context = captureZeroLayerCarrier_ACU();
  const epoch = lifecycleEpoch_ACU;
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  assertZeroLayerCarrier_ACU(context);
  if (epoch !== lifecycleEpoch_ACU) throw new ZeroLayerError_ACU('scope-changed', '恢复准备期间聊天已变化。');
  const envelope = await runtime.recoverBridge();
  assertZeroLayerCarrier_ACU(context);
  if (envelope.enabled) await syncConfirmedZeroLayerView_ACU();
  return envelope;
}

/** 页面显式选择逻辑切点；不接受物理下标换算成逻辑身份。 */
export async function changeZeroLayerBranchForPage_ACU(command: ZeroLayerBranchCommand_ACU) {
  const context = captureZeroLayerCarrier_ACU();
  const epoch = lifecycleEpoch_ACU;
  const selection = structuredClone(command);
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  assertZeroLayerCarrier_ACU(context);
  if (epoch !== lifecycleEpoch_ACU) throw new ZeroLayerError_ACU('scope-changed', '分支准备期间聊天已变化。');
  const envelope = await runtime.changeBranch(selection);
  assertZeroLayerCarrier_ACU(context);
  if (envelope.enabled) await syncConfirmedZeroLayerView_ACU();
  return envelope;
}

/** 所选 head 和普通接入点必须由调用者传入原 FloorRef。 */
export async function exitZeroLayerForPage_ACU(selection: ZeroLayerExitSelection_ACU) {
  const context = captureZeroLayerCarrier_ACU();
  const epoch = lifecycleEpoch_ACU;
  const frozen = structuredClone(selection);
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  assertZeroLayerCarrier_ACU(context);
  if (epoch !== lifecycleEpoch_ACU) throw new ZeroLayerError_ACU('scope-changed', '退出准备期间聊天已变化。');
  return runtime.exitToOrdinary(frozen);
}

export async function recoverZeroLayerExitForPage_ACU() {
  const context = captureZeroLayerCarrier_ACU();
  const epoch = lifecycleEpoch_ACU;
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  assertZeroLayerCarrier_ACU(context);
  if (epoch !== lifecycleEpoch_ACU) throw new ZeroLayerError_ACU('scope-changed', '退出恢复准备期间聊天已变化。');
  return runtime.recoverExit();
}

/** 用户/程序正文共用此入口；必需效果由生产运行时决定，不由公开调用方指定。 */
export async function submitZeroLayerInputForPage_ACU(input: string) {
  if (typeof input !== 'string' || !input.trim()) throw new ZeroLayerError_ACU('invalid-transition', '请输入本轮正文。');
  const context = captureZeroLayerCarrier_ACU();
  const epoch = lifecycleEpoch_ACU;
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  assertZeroLayerCarrier_ACU(context);
  if (epoch !== lifecycleEpoch_ACU) throw new ZeroLayerError_ACU('scope-changed', '发送准备期间聊天已变化。');
  // 剧情准备期间宿主尚未进入生成，聊天区只有自有正文槽能提示处理中；被在途操作拒绝的请求不改提示。
  const ownsBusy = !runtime.session.hasActiveTurn();
  if (ownsBusy) stableView_ACU.setBusy(context.key);
  let result: Awaited<ReturnType<typeof runtime.submit>>;
  try { result = await runtime.submit(input, ['table']); }
  finally { if (ownsBusy) stableView_ACU.setBusy(null); }
  assertZeroLayerCarrier_ACU(context);
  if (epoch === lifecycleEpoch_ACU) await syncConfirmedZeroLayerView_ACU();
  return { sessionId: result.sessionId, branchId: result.activeBranchId, revision: result.revision };
}

/** 只由用户显式确认；调用者传入已读取的原回合身份，放弃后才能发送新回合。 */
export async function abandonZeroLayerTurnForPage_ACU(turnId: string, attemptId: string) {
  const context = captureZeroLayerCarrier_ACU();
  const epoch = lifecycleEpoch_ACU;
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  assertZeroLayerCarrier_ACU(context);
  if (epoch !== lifecycleEpoch_ACU) throw new ZeroLayerError_ACU('scope-changed', '放弃准备期间聊天已变化。');
  const envelope = await runtime.abandonTurn(turnId, attemptId);
  assertZeroLayerCarrier_ACU(context);
  return envelope;
}

/** 停止不清理存档、不把未知发送升级为确定取消。 */
export function stopZeroLayerForPage_ACU(): void {
  inputGate_ACU?.cancel();
  runtime_ACU?.cancel();
}

/** 回读后按持久阶段恢复；正文已保存只补结算，未知发送绝不重发。 */
export async function recoverZeroLayerForPage_ACU() {
  const context = captureZeroLayerCarrier_ACU();
  const epoch = lifecycleEpoch_ACU;
  const assertCurrent = () => {
    assertZeroLayerCarrier_ACU(context);
    if (epoch !== lifecycleEpoch_ACU) throw new ZeroLayerError_ACU('scope-changed', '恢复期间聊天租约已撤销。');
  };
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  assertCurrent();
  if (runtime.session.hasActiveTurn()) throw new ZeroLayerError_ACU('pending-turn', '请先停止在途任务，再显式恢复。');
  let source = await runtime.store.recover();
  assertCurrent();
  if (!source) throw new ZeroLayerError_ACU('carrier-unavailable', '没有可恢复的零层存档。');
  if (source.exitManifest?.phase === 'prepared') return runtime.recoverExit();
  source = await runtime.recoverBridge();
  assertCurrent();
  const branch = source.branches.find(item => item.branchId === source!.activeBranchId)!;
  if (source.enabled && (branch.checkpoints?.pending || branch.checkpoints?.cleanupPending)) {
    source = await runtime.recoverCheckpoints();
    assertCurrent();
  }
  const turn = source.turns.find(item => item.branchId === source!.activeBranchId
    && !['published', 'failed', 'cancelled'].includes(item.phase));
  if (turn) {
    if (turn.continuationIdentity) throw new ZeroLayerError_ACU('pending-turn', '此回合属于续写任务，请从续写面板继续恢复。');
    if (!['response-durable', 'effects-durable'].includes(turn.phase)) {
      throw new ZeroLayerError_ACU('pending-turn', '正文尚未保存或发送结果未知；本入口不会重新请求模型。核对后可确认放弃该回合再重新发送。');
    }
    source = await runtime.recoverSettlement(turn.turnId, turn.attemptId);
    assertCurrent();
  }
  if (source.enabled) await syncConfirmedZeroLayerView_ACU();
  return source;
}

registerZeroLayerPageOperations_ACU({
  setEnabled: setZeroLayerEnabledForPage_ACU, submit: submitZeroLayerInputForPage_ACU,
  recover: recoverZeroLayerForPage_ACU, abandon: abandonZeroLayerTurnForPage_ACU,
  changeBranch: changeZeroLayerBranchForPage_ACU, exit: exitZeroLayerForPage_ACU,
  stop: stopZeroLayerForPage_ACU,
});