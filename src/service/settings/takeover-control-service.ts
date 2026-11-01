import { globalMeta_ACU, saveGlobalMeta_ACU } from '../../data/repositories/profile-repo';
import { setTakeoverRuntimeEnabled_ACU } from '../../shared/takeover-control';

/** Persist one independent global flag; never save/mutate individual feature configurations. */
export function setTakeoverEnabled_ACU(enabled: boolean): void {
    const previous = globalMeta_ACU.takeoverEnabledGlobal;
    globalMeta_ACU.takeoverEnabledGlobal = enabled;
    if (!saveGlobalMeta_ACU()) {
        globalMeta_ACU.takeoverEnabledGlobal = previous;
        throw new Error('接管开关保存失败，开关状态未改变。');
    }
    setTakeoverRuntimeEnabled_ACU(enabled);
}
