/** 宿主会吞掉监听器异常；拒绝必须在 emit 返回边界传播，不能全局停止其他生成。 */
export class PlotSendRejectedError_ACU extends Error {
  constructor() {
    super('上一轮发送仍在处理中，本次请求未发送。');
    this.name = 'AbortError';
  }
}

interface PlotEventSource_ACU {
  emit: (event: string, ...args: any[]) => any;
}

const gates_ACU = new WeakMap<object, {
  eventType: string;
  rejected: WeakSet<object>;
  wrapper: PlotEventSource_ACU['emit'];
}>();

/** 仅包装指定事件；保留 this、参数与其他事件的返回值。重复初始化不叠加。 */
export function installPlotSendEventGate_ACU(source: PlotEventSource_ACU, eventType: string): void {
  const installed = gates_ACU.get(source);
  if (installed && source.emit === installed.wrapper && installed.eventType === eventType) return;
  const original = source.emit;
  const rejected = installed?.rejected || new WeakSet<object>();
  const wrapper: PlotEventSource_ACU['emit'] = function (this: unknown, event, ...args) {
    if (event !== eventType) return original.call(this, event, ...args);
    const params = args[1];
    return (async () => {
      try {
        const result = await original.call(this, event, ...args);
        if (params && typeof params === 'object' && rejected.has(params)) {
          throw new PlotSendRejectedError_ACU();
        }
        return result;
      } finally {
        if (params && typeof params === 'object') rejected.delete(params);
      }
    })();
  };
  source.emit = wrapper;
  gates_ACU.set(source, { eventType, rejected, wrapper });
}

/** 参数身份只用于本次派发；不改参数字段，不触碰宿主全局停止状态。 */
export function rejectPlotSendEvent_ACU(source: PlotEventSource_ACU, params: unknown): void {
  const gate = gates_ACU.get(source);
  if (!gate || source.emit !== gate.wrapper || !params || typeof params !== 'object') {
    throw new Error('剧情发送事件阻断不可用');
  }
  gate.rejected.add(params);
}
