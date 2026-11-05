/**
 * 酒馆设置保存确认。
 *
 * ST 与 TT 的 getContext() 只暴露无返回值的 saveSettingsDebounced；宿主只在 saveSettings 成功后发出
 * SETTINGS_UPDATED（ST script.js:8110，TT script.js:9572），失败不发，事件也不带请求身份。
 * 每次写入记录 confirmAfter：防抖保存为写入时刻 + 宿主防抖时长，直接保存为写入时刻。
 * 只有不早于 confirmAfter 的事件才确认写入；更早的事件可能来自写入前已发起的保存，
 * 或来自取消防抖的生命周期 flush，此时补发一次保存再等待。confirmAfter + 10 秒仍未确认即为未落盘。
 */
import { topLevelWindow_ACU } from '../../shared/env';
import { logWarn_ACU } from '../../shared/utils';

export type SettingsPersistenceState_ACU = 'confirmed' | 'pending' | 'unsaved' | 'unconfirmable';

export type SettingsPersistenceSnapshot_ACU = {
    state: SettingsPersistenceState_ACU;
    latestWriteSeq: number;
    confirmedWriteSeq: number;
    /** 最近一次同步失败（找不到保存函数、调用或补发抛错）对应的写入序号。 */
    lastFailedWriteSeq: number;
    lastWriteAt: number;
};

export type SettingsWriteOptions_ACU = {
    /** true：宿主 saveSettings 立即保存；false：saveSettingsDebounced 尾触发保存。 */
    direct: boolean;
    /** 收到早于 confirmAfter 的事件时补发保存。 */
    resave: () => void;
};

/** ST 与 TT 的 DEFAULT_SAVE_EDIT_TIMEOUT 均为 debounce_timeout.relaxed。 */
export const HOST_SETTINGS_DEBOUNCE_MS_ACU = 1000;
export const SETTINGS_CONFIRM_GRACE_MS_ACU = 10_000;
export const SETTINGS_MAX_RESAVES_ACU = 2;

let state_ACU: SettingsPersistenceState_ACU = 'confirmed';
let latestWriteSeq_ACU = 0;
let confirmedWriteSeq_ACU = 0;
let lastFailedWriteSeq_ACU = 0;
let lastWriteAt_ACU = 0;
let confirmAfter_ACU = 0;
let resaveCount_ACU = 0;
let pendingWrite_ACU: SettingsWriteOptions_ACU | null = null;
let timer_ACU: ReturnType<typeof setTimeout> | null = null;
let installedSource_ACU: any = null;
const listeners_ACU = new Set<(state: SettingsPersistenceState_ACU) => void>();
const writeListeners_ACU = new Set<(seq: number) => void>();

function setState_ACU(next: SettingsPersistenceState_ACU): void {
    if (state_ACU === next) return;
    state_ACU = next;
    for (const listener of [...listeners_ACU]) {
        try { listener(next); } catch (error) { logWarn_ACU('[设置保存确认] 状态订阅回调失败:', error); }
    }
}

function emitWrite_ACU(seq: number): void {
    for (const listener of [...writeListeners_ACU]) {
        try { listener(seq); } catch (error) { logWarn_ACU('[设置保存确认] 写入订阅回调失败:', error); }
    }
}

function clearTimer_ACU(): void {
    if (timer_ACU) clearTimeout(timer_ACU);
    timer_ACU = null;
}

function armTimeout_ACU(now: number): void {
    clearTimer_ACU();
    timer_ACU = setTimeout(() => {
        timer_ACU = null;
        if (!pendingWrite_ACU) return;
        logWarn_ACU('[设置保存确认] 宿主未确认设置保存，配置可能未写入磁盘。');
        setState_ACU('unsaved');
    }, Math.max(0, confirmAfter_ACU - now) + SETTINGS_CONFIRM_GRACE_MS_ACU);
}

function ensureInstalled_ACU(): boolean {
    try {
        const ctx = (topLevelWindow_ACU as any)?.SillyTavern?.getContext?.();
        const source = ctx?.eventSource;
        const eventType = ctx?.eventTypes?.SETTINGS_UPDATED ?? ctx?.event_types?.SETTINGS_UPDATED;
        if (!source || typeof source.on !== 'function' || !eventType) return false;
        if (installedSource_ACU !== source) {
            source.on(eventType, () => onSettingsUpdated_ACU());
            installedSource_ACU = source;
        }
        return true;
    } catch {
        return false;
    }
}

/** 每次调用宿主保存后登记一次写入，返回写入序号。 */
export function noteSettingsWrite_ACU(options: SettingsWriteOptions_ACU): number {
    const seq = ++latestWriteSeq_ACU;
    if (!ensureInstalled_ACU()) {
        pendingWrite_ACU = null;
        clearTimer_ACU();
        if (state_ACU !== 'unsaved') setState_ACU('unconfirmable');
        emitWrite_ACU(seq);
        return seq;
    }
    const now = Date.now();
    lastWriteAt_ACU = now;
    confirmAfter_ACU = now + (options.direct ? 0 : HOST_SETTINGS_DEBOUNCE_MS_ACU);
    pendingWrite_ACU = options;
    resaveCount_ACU = 0;
    armTimeout_ACU(now);
    if (state_ACU !== 'unsaved') setState_ACU('pending');
    emitWrite_ACU(seq);
    return seq;
}

function markFailed_ACU(seq: number): void {
    lastFailedWriteSeq_ACU = seq;
    pendingWrite_ACU = null;
    clearTimer_ACU();
    setState_ACU('unsaved');
}

/** 宿主保存调用同步抛错，或找不到可用的保存函数。 */
export function noteSettingsWriteFailed_ACU(): number {
    const seq = ++latestWriteSeq_ACU;
    lastWriteAt_ACU = Date.now();
    markFailed_ACU(seq);
    emitWrite_ACU(seq);
    return seq;
}

/** SETTINGS_UPDATED：只有不早于 confirmAfter 的事件才确认最近一次写入。 */
export function onSettingsUpdated_ACU(now: number = Date.now()): void {
    const write = pendingWrite_ACU;
    if (!write) return;
    if (now >= confirmAfter_ACU) {
        confirmedWriteSeq_ACU = latestWriteSeq_ACU;
        pendingWrite_ACU = null;
        resaveCount_ACU = 0;
        clearTimer_ACU();
        setState_ACU('confirmed');
        return;
    }
    if (resaveCount_ACU >= SETTINGS_MAX_RESAVES_ACU) return;
    resaveCount_ACU += 1;
    try {
        write.resave();
    } catch (error) {
        logWarn_ACU('[设置保存确认] 补发设置保存失败:', error);
        markFailed_ACU(latestWriteSeq_ACU);
        return;
    }
    confirmAfter_ACU = Math.max(confirmAfter_ACU, now + (write.direct ? 0 : HOST_SETTINGS_DEBOUNCE_MS_ACU));
    armTimeout_ACU(now);
}

export function getSettingsPersistenceState_ACU(): SettingsPersistenceState_ACU {
    return state_ACU;
}

export function getSettingsPersistenceSnapshot_ACU(): SettingsPersistenceSnapshot_ACU {
    return {
        state: state_ACU,
        latestWriteSeq: latestWriteSeq_ACU,
        confirmedWriteSeq: confirmedWriteSeq_ACU,
        lastFailedWriteSeq: lastFailedWriteSeq_ACU,
        lastWriteAt: lastWriteAt_ACU,
    };
}

export function subscribeSettingsPersistence_ACU(listener: (state: SettingsPersistenceState_ACU) => void): () => void {
    listeners_ACU.add(listener);
    return () => { listeners_ACU.delete(listener); };
}

/** 每次登记写入（含同步失败）后回调，参数为写入序号。 */
export function subscribeSettingsWrites_ACU(listener: (seq: number) => void): () => void {
    writeListeners_ACU.add(listener);
    return () => { writeListeners_ACU.delete(listener); };
}

/** 测试用：重置模块级状态。 */
export function _resetSettingsSaveConfirm_ACU(): void {
    clearTimer_ACU();
    state_ACU = 'confirmed';
    latestWriteSeq_ACU = 0;
    confirmedWriteSeq_ACU = 0;
    lastFailedWriteSeq_ACU = 0;
    lastWriteAt_ACU = 0;
    confirmAfter_ACU = 0;
    resaveCount_ACU = 0;
    pendingWrite_ACU = null;
    installedSource_ACU = null;
    listeners_ACU.clear();
    writeListeners_ACU.clear();
}

