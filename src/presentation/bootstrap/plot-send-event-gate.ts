/** 发送前处理接管原请求；事件返回后退出原发送，再执行成功后的重生成。 */
interface PlotEventSource_ACU {
  emit: (event: string, ...args: any[]) => any;
  on?: (event: string, listener: (...args: any[]) => any) => unknown;
  makeLast?: (event: string, listener: (...args: any[]) => any) => unknown;
}

const redirects_ACU = new WeakMap<object, (() => void) | null>();
const installed_ACU = new WeakMap<object, PlotEventSource_ACU['emit']>();

export function installPlotSendEventGate_ACU(source: PlotEventSource_ACU, eventType: string): void {
  if (source.emit === installed_ACU.get(source)) return;
  const original = source.emit;
  const wrapper: PlotEventSource_ACU['emit'] = function (this: unknown, event, ...args) {
    if (event !== eventType) return original.call(this, event, ...args);
    const params = args[1];
    return (async () => {
      const result = await original.call(this, event, ...args);
      if (!params || !redirects_ACU.has(params)) return result;
      const resume = redirects_ACU.get(params);
      redirects_ACU.delete(params);
      // 下一任务才启动重生成，确保宿主已从本次 await 退出，不再读取输入框。
      if (resume) setTimeout(resume, 0);
      const error = new Error('发送前处理已接管本次生成。');
      error.name = 'AbortError';
      throw error;
    })();
  };
  source.emit = wrapper;
  installed_ACU.set(source, wrapper);
}

/** null 表示失败后退出；回调表示成功保存后重生成。 */
export function redirectPlotSendEvent_ACU(params: object, resume: (() => void) | null = null): void {
  redirects_ACU.set(params, resume);
}

type HostEventWaitGate_ACU = {
  wait: (...args: any[]) => Promise<void>;
  /** 正经由外层 emit 派发的事件首参及其计数；兜底监听器据此让位。 */
  wrapped: Map<unknown, number>;
  listening: boolean;
};

export type HostEventWaitGateOptions_ACU = {
  /**
   * 宿主可能用安装前绑定的 emit 副本派发（TT chatSurface），绕过外层包裹。
   * 开启后另注册末位监听器，仅在本次派发未经外层包裹时等待；监听器异常会被吞掉，取消须由后续阶段的门阻断。
   */
  listenerFallback?: boolean;
};

const waitGates_ACU = new WeakMap<object, Map<string, HostEventWaitGate_ACU>>();

/** 宿主会吞掉监听器异常；在 emit 外层等待并传播取消，普通成功不改变宿主发送。 */
export function installHostEventWaitGate_ACU(
  source: PlotEventSource_ACU,
  eventType: string,
  wait: (...args: any[]) => Promise<void>,
  options: HostEventWaitGateOptions_ACU = {},
): void {
  const gates = waitGates_ACU.get(source) ?? new Map<string, HostEventWaitGate_ACU>();
  waitGates_ACU.set(source, gates);
  let gate = gates.get(eventType);
  if (gate) {
    gate.wait = wait;
  } else {
    const created: HostEventWaitGate_ACU = { wait, wrapped: new Map(), listening: false };
    gate = created;
    gates.set(eventType, created);
    const original = source.emit;
    source.emit = async function (this: unknown, event, ...args) {
      if (event !== eventType) return original.call(this, event, ...args);
      const key = args[0];
      created.wrapped.set(key, (created.wrapped.get(key) ?? 0) + 1);
      let result: any;
      try {
        result = await original.call(this, event, ...args);
      } finally {
        const count = (created.wrapped.get(key) ?? 1) - 1;
        if (count > 0) created.wrapped.set(key, count);
        else created.wrapped.delete(key);
      }
      await created.wait(...args);
      return result;
    };
  }
  if (!options.listenerFallback || gate.listening) return;
  const register = typeof source.makeLast === 'function' ? source.makeLast : source.on;
  if (typeof register !== 'function') return;
  const fallback = gate;
  register.call(source, eventType, async (...args: any[]) => {
    if (fallback.wrapped.has(args[0])) return;
    try {
      await fallback.wait(...args);
    } catch {
      // 取消状态保留在等待方，由后续阶段的门在正文边界阻断。
    }
  });
  fallback.listening = true;
}
