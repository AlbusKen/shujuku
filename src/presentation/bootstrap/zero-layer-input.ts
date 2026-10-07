import { getHostWindow } from '../../shared/runtime-env';
import { getSendTextareaValue_ACU, setSendTextareaValue_ACU } from '../../shared/host-input';
import { captureZeroLayerCarrier_ACU, assertZeroLayerCarrier_ACU, readZeroLayerCarrier_ACU,
  hasZeroLayerCarrierField_ACU } from '../../service/zero-layer/carrier-context';
import { readOrdinaryZeroLayerState_ACU } from '../../service/zero-layer/ordinary-state';
import { isZeroLayerHostInvocation_ACU } from '../../service/zero-layer/host-generation';

/** 外层 emit 在任何监听器和物理入楼前分流；卸载后透传，不改普通发送语义。 */
export function installZeroLayerInputGate_ACU(
  source: { emit: (event: string, ...args: any[]) => any }, eventType: string,
  submit: (input: string) => Promise<unknown>, report: (error?: unknown) => void,
  invalidateEvents: readonly string[] = [],
): (() => void) & { cancel(): void } {
  const original = source.emit;
  let active = true;
  let queued: symbol | null = null;
  let sending = false;
  const reject = () => Promise.reject(Object.assign(new Error('零层已接管或拒绝本次生成；原发送不会入楼。'), { name: 'AbortError' }));
  const wrapper: typeof original = function (this: unknown, event, ...args) {
    if (invalidateEvents.includes(event)) queued = null;
    if (!active || event !== eventType || args[2] === true
      || isZeroLayerHostInvocation_ACU(args[1])) return original.call(this, event, ...args);
    // 其他 quiet 调用不是用户正文，保持内部生成入口，不从输入框认领。
    if (args[0] === 'quiet') return original.call(this, event, ...args);
    if (!hasZeroLayerCarrierField_ACU()) {
      // 同一聊天的首次保存可能未知且本地字段已回滚；仍不能放行。
      try { readOrdinaryZeroLayerState_ACU(); }
      catch (error) { report(error); return reject(); }
      return original.call(this, event, ...args);
    }
    try {
      const context = captureZeroLayerCarrier_ACU();
      const envelope = readZeroLayerCarrier_ACU(context);
      if (envelope?.exitManifest?.phase === 'committed') return original.call(this, event, ...args);
      if (!envelope?.enabled) throw new Error('zero-layer-recovery-required');
      const type = args[0];
      if (type !== undefined && type !== null && type !== 'normal') {
        throw new Error('zero-layer-entry-not-supported');
      }
      const textarea = getHostWindow().document.getElementById('send_textarea') as HTMLTextAreaElement | null;
      const input = textarea?.value ?? '';
      if (!input.trim()) throw new Error('zero-layer-input-required');
      if (queued || sending) throw new Error('zero-layer-busy');
      const ticket = Symbol();
      queued = ticket;
      // 发送期间保留输入框原文。宿主先退出原生成，再由逻辑发送口校验载体和持久化。
      setTimeout(() => {
        if (!active || queued !== ticket) return;
        queued = null;
        try {
          assertZeroLayerCarrier_ACU(context);
          const current = readZeroLayerCarrier_ACU(context);
          if (!current?.enabled || current.sessionId !== envelope.sessionId
            || current.activeBranchId !== envelope.activeBranchId || current.revision !== envelope.revision) {
            throw new Error('zero-layer-scope-changed');
          }
          sending = true;
          void Promise.resolve(submit(input)).then(() => {
            // 只清空仍是本轮原文的输入框；失败、停止或期间已改写的草稿保留，避免同一输入被再次按回车重发。
            if (getSendTextareaValue_ACU() === input) setSendTextareaValue_ACU('');
          }, report).finally(() => { sending = false; });
        } catch (error) { sending = false; report(error); }
      }, 0);
    } catch (error) { report(error); }
    return reject();
  };
  source.emit = wrapper;
  return Object.assign(() => {
    active = false;
    queued = null;
    if (source.emit === wrapper) source.emit = original;
  }, { cancel: () => { queued = null; } });
}
