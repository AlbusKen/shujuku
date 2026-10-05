/** 等待可协作取消的任务；迟到 Promise 仍被观察，副作用由任务内信号/身份检查阻断。 */
export async function runWithAbortSignal_ACU<T>(
    signal: AbortSignal | undefined,
    run: () => Promise<T>,
): Promise<T> {
    signal?.throwIfAborted();
    if (!signal) return run();
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException('本轮已停止。', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => {
            signal.throwIfAborted();
            return run();
        }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}
