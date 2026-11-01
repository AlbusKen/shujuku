import { getZeroLayerHostContext_ACU } from '../../service/zero-layer/host-generation';
import { assertZeroLayerCarrier_ACU, captureZeroLayerCarrier_ACU,
  hasZeroLayerCarrierField_ACU } from '../../service/zero-layer/carrier-context';
import { ZeroLayerStore_ACU } from '../../service/zero-layer/store';
import { showToastr_ACU } from '../theme/toast';

let releaseRetirement_ACU: (() => void) | null = null;
let installedSource_ACU: object | null = null;

/** 当前聊天首次加载时显式关闭旧存档；不安装生成接管，也不清除逻辑历史。 */
export function installZeroLayerRetirement_ACU(): void {
  const api = getZeroLayerHostContext_ACU();
  const source = api?.eventSource;
  const event = api?.eventTypes?.CHAT_CHANGED;
  if (!source || typeof source.on !== 'function' || !event || installedSource_ACU === source) return;
  releaseRetirement_ACU?.();
  installedSource_ACU = source;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const attempted = new WeakSet<object>();
  const closeCurrent = async () => {
    if (!active || !hasZeroLayerCarrierField_ACU()) return;
    const context = captureZeroLayerCarrier_ACU();
    if (attempted.has(context.carrier)) return;
    attempted.add(context.carrier);
    const store = new ZeroLayerStore_ACU();
    const envelope = await store.readPersisted();
    if (!active) return;
    assertZeroLayerCarrier_ACU(context);
    if (envelope?.enabled) {
      await store.commit({ type: 'set-enabled', enabled: false }, envelope.revision);
    }
  };
  const schedule = () => {
    if (!active) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void closeCurrent().catch(() => {
        if (!active) return;
        showToastr_ACU('warning', '零层功能已停用，但旧存档关闭未能确认；历史数据已保留，本次不会自动重试。');
      });
    }, 0);
  };
  const release = () => {
    active = false;
    if (timer !== null) clearTimeout(timer);
    source.removeListener?.(event, schedule);
    window.removeEventListener('pagehide', release);
    if (installedSource_ACU === source) installedSource_ACU = null;
    if (releaseRetirement_ACU === release) releaseRetirement_ACU = null;
  };
  source.on(event, schedule);
  window.addEventListener('pagehide', release, { once: true });
  releaseRetirement_ACU = release;
  schedule();
}
