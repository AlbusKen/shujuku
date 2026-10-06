import { getHostWindow } from '../../shared/runtime-env';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import type { ZeroLayerRuntime_ACU } from '../../service/zero-layer/runtime';
import type { ZeroLayerBranchCommand_ACU } from '../../service/zero-layer/branch-command';

let runtime_ACU: ZeroLayerRuntime_ACU | null = null;
let loading_ACU: Promise<ZeroLayerRuntime_ACU> | null = null;
let installedSource_ACU: object | null = null;
let lifecycleEpoch_ACU = 0;

/** 两种入口共用；能力缺失时不改变普通发送，不创建聊天存档。 */
export function installZeroLayerBootstrap_ACU(): void {
  const api = SillyTavern_API_ACU;
  const source = api?.eventSource;
  const events = api?.eventTypes;
  if (!source || !events?.CHAT_COMPLETION_PROMPT_READY || !events.CHAT_COMPLETION_SETTINGS_READY
    || typeof getHostWindow().fetch !== 'function' || installedSource_ACU === source) return;
  installedSource_ACU = source;
  source.on(events.CHAT_COMPLETION_PROMPT_READY, data => runtime_ACU?.session.bindPrompt(data));
  // makeLast 的数据库模板监听随后注册；先将本请求绑定到独立逻辑快照。
  source.on(events.CHAT_COMPLETION_SETTINGS_READY, data => runtime_ACU?.session.bindSettings(data));
  const invalidate = () => {
    lifecycleEpoch_ACU += 1;
    runtime_ACU?.invalidate();
  };
  source.on(events.CHAT_CHANGED, invalidate);
  source.on(events.MESSAGE_DELETED, invalidate);
  source.on(events.MESSAGE_SWIPED, invalidate);
  // 不依赖编辑事件来推测新历史；事件只撤销租约，存储边界仍复核原前缀。
  const editEvents = events as unknown as Record<string, string>;
  if (editEvents.MESSAGE_EDITED) source.on(editEvents.MESSAGE_EDITED, invalidate);
  if (editEvents.MESSAGE_UPDATED) source.on(editEvents.MESSAGE_UPDATED, invalidate);
  source.on(events.GENERATION_STOPPED, () => runtime_ACU?.cancel());
  window.addEventListener('pagehide', () => {
    invalidate();
    runtime_ACU?.dispose();
  }, { once: true });
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
  return runtime.setEnabled(enabled, apiPresetName);
}

/** 未知保存仅由此显式回读，不在装配、聊天事件或错误处理里盲目重试。 */
export async function recoverZeroLayerBridgeForPage_ACU() {
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  return runtime.recoverBridge();
}

/** 页面显式选择逻辑切点；不接受物理下标换算成逻辑身份。 */
export async function changeZeroLayerBranchForPage_ACU(command: ZeroLayerBranchCommand_ACU) {
  const runtime = await loadZeroLayerRuntimeForPage_ACU();
  return runtime.changeBranch(command);
}