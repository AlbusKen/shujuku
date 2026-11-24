const abortReasons_ACU = new WeakMap<AbortSignal, unknown>();

function createDefaultAbortError_ACU(message = 'The operation was aborted.'): Error {
    if (typeof DOMException === 'function') {
        return new DOMException(message, 'AbortError');
    }
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

/**
 * 兼容旧版 WebView（Chrome < 98 / Safari < 15.4）：
 * 旧版 AbortController.abort() 会忽略 reason 参数且 signal.reason 恒为 undefined，
 * 这里用模块私有 WeakMap 补记自定义原因，不修改任何全局原型。
 */
export function abortWithReason_ACU(controller: AbortController, reason?: unknown): void {
    if (reason !== undefined && !controller.signal.aborted && !abortReasons_ACU.has(controller.signal)) {
        abortReasons_ACU.set(controller.signal, reason);
    }
    controller.abort(reason);
}

/** 读取信号中止原因；旧版 WebView 上 signal.reason 为 undefined 时回退到 WeakMap 记录或标准 AbortError。 */
export function getAbortReason_ACU(
    signal: AbortSignal | null | undefined,
    fallbackMessage = 'The operation was aborted.',
): unknown {
    if (signal) {
        if (signal.reason !== undefined) return signal.reason;
        if (abortReasons_ACU.has(signal)) return abortReasons_ACU.get(signal);
    }
    return createDefaultAbortError_ACU(fallbackMessage);
}

/**
 * 兼容旧版 WebView（Chrome < 100 / Safari < 15.4）的 AbortSignal.throwIfAborted。
 * 未中止时直接返回；已中止时在支持原生 throwIfAborted 且原因完整时走原生实现，否则抛出 getAbortReason_ACU(signal)。
 */
export function throwIfAborted_ACU(signal: AbortSignal | null | undefined): void {
    if (!signal || !signal.aborted) return;
    if (typeof signal.throwIfAborted === 'function' && (signal.reason !== undefined || !abortReasons_ACU.has(signal))) {
        signal.throwIfAborted();
        return;
    }
    throw getAbortReason_ACU(signal);
}

/** 等待可协作取消的任务；迟到 Promise 仍被观察，副作用由任务内信号/身份检查阻断。 */
export async function runWithAbortSignal_ACU<T>(
    signal: AbortSignal | undefined,
    run: () => Promise<T>,
): Promise<T> {
    throwIfAborted_ACU(signal);
    if (!signal) return run();
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(getAbortReason_ACU(signal, '本轮已停止。'));
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => {
            throwIfAborted_ACU(signal);
            return run();
        }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}
