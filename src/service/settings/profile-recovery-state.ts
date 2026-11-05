/**
 * 配置档待选择状态：GlobalMeta 缺失但存储中仍有非默认配置档时，记录可选标识供界面提示。
 * 用户切换配置档后由设置服务清空。
 */

let codes_ACU: string[] | null = null;
const listeners_ACU = new Set<(codes: string[] | null) => void>();

export function getProfileRecoveryCodes_ACU(): string[] | null {
    return codes_ACU ? [...codes_ACU] : null;
}

export function setProfileRecoveryCodes_ACU(next: string[] | null): void {
    const value = next && next.length ? [...next] : null;
    if (JSON.stringify(value) === JSON.stringify(codes_ACU)) return;
    codes_ACU = value;
    for (const listener of [...listeners_ACU]) {
        try { listener(getProfileRecoveryCodes_ACU()); } catch { /* 提示通道异常不影响设置加载 */ }
    }
}

export function subscribeProfileRecovery_ACU(listener: (codes: string[] | null) => void): () => void {
    listeners_ACU.add(listener);
    return () => { listeners_ACU.delete(listener); };
}

/** 测试用：重置模块级状态。 */
export function _resetProfileRecoveryState_ACU(): void {
    codes_ACU = null;
    listeners_ACU.clear();
}
