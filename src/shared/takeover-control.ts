import { runWithAbortSignal_ACU } from './abort-signal';

/** Independent of fill mode/API configuration: pausing never rewrites those settings. */
export interface TakeoverControlConfig_ACU { enabled: boolean }
let enabled_ACU = true;
let epoch_ACU = 0;
let controller_ACU = new AbortController();
const listeners_ACU = new Set<(enabled: boolean) => void>();

export function isTakeoverEnabled_ACU(): boolean { return enabled_ACU; }
export function setTakeoverRuntimeEnabled_ACU(enabled: boolean): void {
    if (enabled_ACU === enabled) return;
    enabled_ACU = enabled;
    ++epoch_ACU;
    controller_ACU.abort(new DOMException('数据库接管已暂停，本轮插件任务已作废。', 'AbortError'));
    controller_ACU = new AbortController();
    for (const listener of listeners_ACU) listener(enabled);
}
export function subscribeTakeoverControl_ACU(listener: (enabled: boolean) => void): () => void {
    listeners_ACU.add(listener);
    return () => { listeners_ACU.delete(listener); };
}
export function captureTakeoverLease_ACU(parent?: AbortSignal | null) {
    const epoch = epoch_ACU;
    const signal = parent ? AbortSignal.any([controller_ACU.signal, parent]) : controller_ACU.signal;
    const assertActive = () => {
        signal.throwIfAborted();
        if (!enabled_ACU || epoch !== epoch_ACU) {
            throw new DOMException('数据库接管已暂停，本轮插件任务已作废。', 'AbortError');
        }
    };
    return { signal, assertActive, isCurrent: () => enabled_ACU && epoch === epoch_ACU && !signal.aborted };
}
/** Only plugin-owned requests use this gate; ordinary host/MVU/combat traffic never enters it. */
export async function runTakeoverRequest_ACU<T>(run: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal | null): Promise<T> {
    const lease = captureTakeoverLease_ACU();
    lease.assertActive();
    parent?.throwIfAborted();
    const controller = new AbortController();
    const pause = () => controller.abort(lease.signal.reason);
    const cancel = () => controller.abort(parent?.reason);
    lease.signal.addEventListener('abort', pause, { once: true });
    parent?.addEventListener('abort', cancel, { once: true });
    try {
        // Preserve synchronous dispatch/abort timing of the existing gateways.
        const operation = run(controller.signal);
        // An immediate abort may win before runWithAbortSignal invokes its thunk.
        // Observe the already-dispatched promise even when its result is discarded.
        void operation.catch((): void => {});
        const result = await runWithAbortSignal_ACU(controller.signal, () => operation);
        lease.assertActive();
        return result;
    } finally {
        lease.signal.removeEventListener('abort', pause);
        parent?.removeEventListener('abort', cancel);
    }
}
