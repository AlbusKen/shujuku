/**
 * data/storage/config-storage.ts — 统一配置存储门面
 *
 * 对应初版设计 plans/three_layer_refactor_plan.md §3.1 的 config-storage.js。
 * 提供统一的配置存储接口，封装自动降级策略：
 *   酒馆设置 → IndexedDB 缓存 → localStorage（如未禁用）
 *
 * 实际实现在 tavern-storage.ts 的 getConfigStorage_ACU 中。
 * 本文件作为门面层，为未来解耦提供接口稳定性。
 */

import { logError_ACU } from '../../shared/utils';
import { getProfileSettingsKey_ACU } from '../../shared/data-constants';
import { sanitizeSettingsForProfileSave_ACU } from '../repositories/profile-repo';

import { getConfigStorage_ACU } from './tavern-storage';


/**
 * 纯数据层的 settings 持久化（只做写存储，不做业务编排）
 * @param settingsObj 要持久化的 settings 对象（由调用方传入）
 * @param isolationCode 已规范化的隔离码（由 service 层传入）
 */
export function persistSettingsToStorage_ACU(settingsObj?: any, isolationCode?: string): boolean {
    try {
        if (!settingsObj) return false;
        const store = getConfigStorage_ACU();
        const code = isolationCode ?? '';
        const payloadObj = sanitizeSettingsForProfileSave_ACU(settingsObj);
        payloadObj.dataIsolationCode = code;
        const payload = JSON.stringify(payloadObj);
        store.setItem(getProfileSettingsKey_ACU(code), payload);
        return true;
    } catch (error) {
        logError_ACU('Failed to persist settings to storage:', error);
        return false;
    }
}
