/** 发送前处理接管原请求；事件返回后退出原发送，再执行成功后的重生成。 */
interface PlotEventSource_ACU {
  emit: (event: string, ...args: any[]) => any;
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
