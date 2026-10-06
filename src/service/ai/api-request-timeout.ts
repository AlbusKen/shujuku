import { normalizeApiRequestTimeout_ACU } from '../settings/api-preset-service';
import { runWithAbortSignal_ACU } from '../../shared/abort-signal';
import { pushLog } from '../../shared/log-buffer';

/** 单次发送至回复读取结束的期限；只取消本次请求，不中止上层重试任务。 */
export async function withApiRequestTimeout_ACU<T>(
    config: { requestTimeoutSeconds?: number },
    parentSignal: AbortSignal | null | undefined,
    run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    const seconds = normalizeApiRequestTimeout_ACU(config?.requestTimeoutSeconds);
    const controller = new AbortController();
    const cancel = () => controller.abort(new DOMException('请求已取消', 'AbortError'));
    if (parentSignal?.aborted) cancel();
    else parentSignal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
        const error = new Error(`API 请求超时（${seconds} 秒），本次按错误处理并交由调用方重试。`);
        error.name = 'TimeoutError';
        controller.abort(error);
        pushLog('error', ['[ACU]', '[API超时]', error.message]);
    }, seconds * 1000);
    try {
        return await runWithAbortSignal_ACU(controller.signal, () => run(controller.signal));
    } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw error;
    } finally {
        clearTimeout(timer);
        parentSignal?.removeEventListener('abort', cancel);
    }
}
