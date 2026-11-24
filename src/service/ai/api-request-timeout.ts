import { normalizeApiRequestTimeout_ACU } from '../settings/api-preset-service';
import { abortWithReason_ACU, getAbortReason_ACU, runWithAbortSignal_ACU } from '../../shared/abort-signal';
import { pushLog } from '../../shared/log-buffer';
import { captureTakeoverLease_ACU } from '../../shared/takeover-control';

/** 单次发送至回复读取结束的期限；只取消本次请求，不中止上层重试任务。 */
export async function withApiRequestTimeout_ACU<T>(
    config: { requestTimeoutSeconds?: number },
    parentSignal: AbortSignal | null | undefined,
    run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    const takeover = captureTakeoverLease_ACU();
    takeover.assertActive();
    const seconds = normalizeApiRequestTimeout_ACU(config?.requestTimeoutSeconds);
    const controller = new AbortController();
    const pause = () => abortWithReason_ACU(controller, getAbortReason_ACU(takeover.signal));
    takeover.signal.addEventListener('abort', pause, { once: true });
    const cancel = () => abortWithReason_ACU(controller, new DOMException('请求已取消', 'AbortError'));
    if (parentSignal?.aborted) cancel();
    else parentSignal?.addEventListener('abort', cancel, { once: true }); // arch-ok: AbortSignal 传播请求取消，非 DOM 监听；finally 释放。
    const timer = setTimeout(() => {
        const error = new Error(`API 请求超时（${seconds} 秒），本次按错误处理并交由调用方重试。`);
        error.name = 'TimeoutError';
        abortWithReason_ACU(controller, error);
        pushLog('error', ['[ACU]', '[API超时]', error.message]);
    }, seconds * 1000);
    try {
        const result = await runWithAbortSignal_ACU(controller.signal, () => run(controller.signal));
        takeover.assertActive();
        return result;
    } catch (error) {
        if (controller.signal.aborted) throw getAbortReason_ACU(controller.signal);
        throw error;
    } finally {
        clearTimeout(timer);
        takeover.signal.removeEventListener('abort', pause);
        parentSignal?.removeEventListener('abort', cancel);
    }
}
