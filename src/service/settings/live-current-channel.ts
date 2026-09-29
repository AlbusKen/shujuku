// service/settings/live-current-channel.ts — 「当前全局 API」的活引用解析
//
// 全局渠道的每一条写入路径都是替换引用而非就地改属性
// （api-preset-service.ts 的 reconcileApiBindingForCurrentChat_ACU /
// setActivePresetForCurrentChat_ACU / saveApiPreset_ACU / deleteApiPreset_ACU /
// restoreApiFields_ACU 均为 settings_ACU.apiConfig = clone(...)）。
//
// 智能续写与格林推演在一次 run/派工开始时解析一次渠道并整轮复用该对象，
// 因此按值/按引用拷出的 apiMode/apiConfig/tavernProfile 会永久指向被替换掉的旧对象，
// 表现为「全局 API 改了但这两个功能不跟随」。
//
// 这里让 source='current' 的解析结果在属性访问时回读权威配置，
// 使取值时机推进到真正发请求的那一刻；source='fixed' 仍按值固定，
// 因为用户显式钉住的预设不应随当前配置漂移。

import type { ApiPresetApiConfig_ACU, ApiPresetApiMode_ACU } from './api-preset-service';

/** 一次渠道解析中真正会被请求装配消费的三个字段。 */
export interface CurrentChannelFields_ACU {
  apiMode: ApiPresetApiMode_ACU;
  apiConfig: ApiPresetApiConfig_ACU;
  tavernProfile: string;
}

/**
 * 把渠道三字段改写为访问时回读的活引用，其余字段（presetName/source/reason）保持定值。
 * 字段保持 enumerable，序列化与 toMatchObject 断言行为与普通对象一致。
 * @param base 已解析的完整结果，用于承载 presetName/source/reason 等定值字段
 * @param readCurrent 回读当前权威渠道配置；每次属性访问都会调用
 * @returns 与入参同形的对象，但渠道三字段始终反映最新的当前配置
 */
export function withLiveCurrentChannel_ACU<T extends CurrentChannelFields_ACU>(
  base: T,
  readCurrent: () => CurrentChannelFields_ACU,
): T {
  return Object.defineProperties({ ...base }, {
    apiMode: { enumerable: true, configurable: true, get: (): ApiPresetApiMode_ACU => readCurrent().apiMode },
    apiConfig: { enumerable: true, configurable: true, get: (): ApiPresetApiConfig_ACU => readCurrent().apiConfig },
    tavernProfile: { enumerable: true, configurable: true, get: (): string => readCurrent().tavernProfile },
  }) as T;
}
