/**
 * 未落盘配置保全副本的查找、恢复与忽略。恢复只在用户确认后由界面调用。
 */
import { getLoadedTavernSettingsWrittenAt_ACU } from '../../data/storage/tavern-storage';
import {
    applySettingsRescueEntries_ACU,
    readSettingsRescue_ACU,
    selectSettingsRescueCandidates_ACU,
    updateSettingsRescue_ACU,
    type StoredSettingsRescue_ACU,
} from '../../data/storage/settings-rescue';
import { getSettingsPersistenceState_ACU, type SettingsPersistenceState_ACU } from '../../data/storage/settings-save-confirm';
import { loadSettings_ACU } from './settings-service';

export type SettingsRescueCandidate_ACU = {
    /** 最新的待恢复副本。 */
    latest: StoredSettingsRescue_ACU;
    /** 全部新于宿主且未被忽略的副本，忽略时一并标记。 */
    pending: StoredSettingsRescue_ACU[];
};

export type SettingsRescueLookup_ACU = {
    /** false：酒馆设置尚不可用，无法与宿主比较，稍后重查。 */
    ready: boolean;
    candidate: SettingsRescueCandidate_ACU | null;
    failures: string[];
};

export type SettingsRescueActionResult_ACU =
    | { ok: true; persistence: SettingsPersistenceState_ACU }
    | { ok: false; error: string };

function messageOf_ACU(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function findSettingsRescueCandidate_ACU(): Promise<SettingsRescueLookup_ACU> {
    const loaded = getLoadedTavernSettingsWrittenAt_ACU();
    if (loaded === null) return { ready: false, candidate: null, failures: [] };
    const { records, failures } = await readSettingsRescue_ACU();
    const pending = selectSettingsRescueCandidates_ACU(records, loaded);
    return {
        ready: true,
        candidate: pending.length ? { latest: pending[0], pending } : null,
        failures: failures.map(item => `${item.backend}：${item.message}`),
    };
}

/** 用最新副本覆盖插件命名空间中的同名键，请求宿主保存，再重新加载设置。 */
export function restoreSettingsRescue_ACU(candidate: SettingsRescueCandidate_ACU): SettingsRescueActionResult_ACU {
    try {
        applySettingsRescueEntries_ACU(candidate.latest.record.backup.entries);
    } catch (error) {
        return { ok: false, error: messageOf_ACU(error) };
    }
    try {
        loadSettings_ACU();
    } catch (error) {
        return { ok: false, error: `配置副本已写入，但重新加载设置失败：${messageOf_ACU(error)}` };
    }
    return { ok: true, persistence: getSettingsPersistenceState_ACU() };
}

/** 记录忽略：副本保留，相同写入标记的副本不再提示。 */
export async function declineSettingsRescue_ACU(candidate: SettingsRescueCandidate_ACU): Promise<SettingsRescueActionResult_ACU> {
    try {
        for (const item of candidate.pending) {
            await updateSettingsRescue_ACU({
                backend: item.backend,
                record: { ...item.record, declinedWrittenAt: item.record.writtenAt },
            });
        }
    } catch (error) {
        return { ok: false, error: `记录忽略失败：${messageOf_ACU(error)}` };
    }
    return { ok: true, persistence: getSettingsPersistenceState_ACU() };
}
