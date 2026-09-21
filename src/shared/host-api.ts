/**
 * shared/host-api.ts — 宿主平台 API 引用
 * SillyTavern、TavernHelper、jQuery、toastr 的运行时引用。
 * 属于 shared 层，任何层均可 import。
 */

/**
 * toastr 通知库的类型定义
 * 实际使用的方法：info/success/warning/error（通过动态 key 调用）和 clear
 */
export interface IToastrAPI_ACU {
    info(message: string, title?: string, options?: Record<string, unknown>): JQuery<HTMLElement> | null;
    success(message: string, title?: string, options?: Record<string, unknown>): JQuery<HTMLElement> | null;
    warning(message: string, title?: string, options?: Record<string, unknown>): JQuery<HTMLElement> | null;
    error(message: string, title?: string, options?: Record<string, unknown>): JQuery<HTMLElement> | null;
    clear(toast?: JQuery<HTMLElement> | null, options?: Record<string, unknown>): void;
}

/**
 * SillyTavern 全局常量的 ACU 扩展属性
 * 补充 @types/iframe/exported.sillytavern.d.ts 中未声明的、ACU 项目依赖的属性
 *
 * 注意：TS 不支持对 `declare const` 做 declaration merging，
 * 因此用独立 interface + 交叉类型的方式扩展 SillyTavern 的类型。
 */
export interface SillyTavernACUExtensions {
    /** SillyTavern 的 Chat 数组（大写 C，某些版本的 API 使用） */
    readonly Chat?: SillyTavern.ChatMessage[];
    /** 设置聊天消息 */
    readonly setChatMessages?: (messages: SillyTavern.ChatMessage[], options?: { refresh?: string; [key: string]: any }) => Promise<void>;
    /** 获取世界书列表 */
    readonly getWorldBooks?: () => Promise<string[]>;
    /** 当前角色 ID（数字索引） */
    readonly this_chid?: number;
}

/**
 * SillyTavern.ChatMessage 的 ACU 扩展属性
 *
 * 注意：iframe 中 ChatMessage 是 `type`（type alias），不是 `interface`，无法通过 declaration merging 扩展。
 * 使用时通过交叉类型 `SillyTavern.ChatMessage & ChatMessageACUExtensions` 获得完整类型。
 */
export interface ChatMessageACUExtensions {
    /** ACU 隔离数据（按标签分组） */
    TavernDB_ACU_IsolatedData?: Record<string, any>;
    /** ACU 身份标识 */
    TavernDB_ACU_Identity?: string | Record<string, unknown>;
    /** ACU 独立数据 */
    TavernDB_ACU_IndependentData?: Record<string, any>;
    /** ACU 摘要数据 */
    TavernDB_ACU_SummaryData?: Record<string, unknown>;
    /** ACU 数据 */
    TavernDB_ACU_Data?: Record<string, unknown>;
    /** ACU 修改的 key 列表 */
    TavernDB_ACU_ModifiedKeys?: string[];
    /** ACU 更新组 key 列表 */
    TavernDB_ACU_UpdateGroupKeys?: string[];
    /** 剧情处理标记 */
    _plot_processed?: boolean;
    /** QRF 来自规划标记 */
    _qrf_from_planning?: boolean;
    /** QRF 剧情待处理哈希 */
    _qrf_plot_pending_hash?: string;
    /** QRF 剧情推进轮次身份；用于精确定位与失败重试。 */
    _qrf_plot_round_id?: string;
    /** 世界推演权威状态；字段内部按冻结 assistant 楼层的 active swipe 身份分桶。 */
    _qrf_world_simulation_state?: Record<string, unknown>;
    /** 世界推演 Agent 会话分段；与 continuation 会话字段严格隔离。 */
    _qrf_world_simulation_agent_chat?: Record<string, unknown>;
    /** 世界推演材料快照；与 continuation 资料字段严格隔离。 */
    _qrf_world_simulation_agent_materials?: Record<string, unknown>;
    /** 世界推演用户要求清单；独立字段，随冻结 assistant 楼层 swipe 分桶回退。 */
    _qrf_world_user_requirements?: Record<string, unknown>;
    /** 世界推演编年总结详情归档桶；独立持久化字段，随冻结 assistant 楼层 swipe 分桶回退。 */
    _qrf_world_simulation_chronicle_archive?: Record<string, unknown>;
    /** 世界推演聊天级任务 envelope，仅使用于首楼。 */
    _qrf_world_simulation?: Record<string, unknown>;
    /** QRF 剧情推进任务级结果映射（key=taskId, value=该任务的推进内容） */
    qrf_plot_tasks?: Record<string, string>;
}

/** SillyTavern 主 API — 类型来自 @types/iframe/exported.sillytavern.d.ts + ACU 扩展 */
export type SillyTavernAPI_Type = typeof SillyTavern & SillyTavernACUExtensions;
/** TavernHelper 辅助 API — 类型来自 @types/function/index.d.ts (Window['TavernHelper']) */
export type TavernHelperAPI_Type = Window['TavernHelper'];
/** ACU 扩展后的 ChatMessage 类型 — 包含 TavernDB_ACU_* 等自定义属性 */
export type ACUMessage = SillyTavern.ChatMessage & ChatMessageACUExtensions;

export let SillyTavern_API_ACU: SillyTavernAPI_Type | undefined;
export let TavernHelper_API_ACU: TavernHelperAPI_Type | undefined;
export let jQuery_API_ACU: JQueryStatic | undefined;
export let toastr_API_ACU: IToastrAPI_ACU | undefined;

export function _set_SillyTavern_API_ACU(v: SillyTavernAPI_Type | undefined) { SillyTavern_API_ACU = v; }
export function _set_TavernHelper_API_ACU(v: TavernHelperAPI_Type | undefined) { TavernHelper_API_ACU = v; }
export function _set_jQuery_API_ACU(v: JQueryStatic | undefined) { jQuery_API_ACU = v; }
export function _set_toastr_API_ACU(v: IToastrAPI_ACU | undefined) { toastr_API_ACU = v; }
