import { callAIWithPreset_ACU } from '../ai/api-call';
import { settings_ACU } from '../runtime/state-manager';
import { withSettingsWrite_ACU } from '../settings/settings-write-service';
import { getSortedSheetKeys_ACU } from '../template/chat-scope';
import { getGlobalInjectionConfigFromData_ACU } from '../worldbook/injection-engine';
import { safeJsonStringify_ACU } from '../../shared/json-helpers';
import { hashUserInput_ACU, logError_ACU } from '../../shared/utils';
import { buildTemplateAssistantCumulativeCompileResult_ACU, collectV3RowIdGuardFindings_ACU, compileTemplateAssistantDraft_ACU, type TemplateAssistantCompileResult_ACU } from './compiler';
import { preflightSchemaMigrations_ACU, type SchemaMigrationPreflightIntent_ACU } from '../table/schema-migration-preflight';
import { buildTemplateAssistantEmbeddedReferenceText_ACU } from './reference-docs';
import { SqliteRuntimeUnavailableError_ACU } from '../../data/sqlite/sqlite-engine';

type AnyRecord = Record<string, any>;

const TEMPLATE_ASSISTANT_SOURCE_DATA_ALLOWED_KEYS_ACU = ['note', 'initNode', 'insertNode', 'updateNode', 'deleteNode'] as const;
const TEMPLATE_ASSISTANT_SOURCE_DATA_ALLOWED_KEY_SET_ACU = new Set<string>(TEMPLATE_ASSISTANT_SOURCE_DATA_ALLOWED_KEYS_ACU);

export interface TemplateAssistantAddSheetOperation_ACU {
    op: 'add_sheet';
    sheetName: string;
    headers: string[];
    insertAfterSheetKey?: string;
    sourceData?: Record<string, any>;
    updateConfig?: Record<string, any>;
    exportConfig?: Record<string, any>;
}

export interface TemplateAssistantRenameSheetOperation_ACU {
    op: 'rename_sheet';
    sheetKey: string;
    newName: string;
}

export interface TemplateAssistantDeleteSheetOperation_ACU {
    op: 'delete_sheet';
    sheetKey: string;
}

export interface TemplateAssistantMoveSheetOperation_ACU {
    op: 'move_sheet';
    sheetKey: string;
    beforeSheetKey?: string;
    afterSheetKey?: string;
}

export interface TemplateAssistantPatchSheetSourceDataPatch_ACU {
    note?: string;
    initNode?: string;
    insertNode?: string;
    updateNode?: string;
    deleteNode?: string;
}

export interface TemplateAssistantPatchSheetUpdateConfigPatch_ACU {
    contextDepth?: number;
    updateFrequency?: number;
    batchSize?: number;
    groupId?: number;
    skipFloors?: number;
    sendLatestRows?: number;
}

export interface TemplateAssistantContentUpdateCell_ACU {
    rowNumber: number;
    columnName: string;
    value: any;
}

export interface TemplateAssistantContentAddRow_ACU {
    [columnName: string]: any;
}

export interface TemplateAssistantPatchSheetContentPatch_ACU {
    updateCells?: TemplateAssistantContentUpdateCell_ACU[];
    addRows?: TemplateAssistantContentAddRow_ACU[];
    deleteRows?: number[];
}

export interface TemplateAssistantSchemaRenameColumn_ACU {
    from: string;
    to: string;
}

export interface TemplateAssistantSchemaAddColumn_ACU {
    name: string;
    defaultValue?: any;
}

export interface TemplateAssistantPatchSheetSchemaPatch_ACU {
    renameColumns?: TemplateAssistantSchemaRenameColumn_ACU[];
    addColumns?: TemplateAssistantSchemaAddColumn_ACU[];
    deleteColumns?: string[];
    ddl?: string;
    migrationIntent?: SchemaMigrationPreflightIntent_ACU;
}

export interface TemplateAssistantLockRowPatch_ACU {
    rowNumber: number;
    locked: boolean;
}

export interface TemplateAssistantLockColumnPatch_ACU {
    columnName: string;
    locked: boolean;
}

export interface TemplateAssistantLockCellPatch_ACU {
    rowNumber: number;
    columnName: string;
    locked: boolean;
}

export interface TemplateAssistantPatchSheetLocksPatch_ACU {
    rows?: TemplateAssistantLockRowPatch_ACU[];
    columns?: TemplateAssistantLockColumnPatch_ACU[];
    cells?: TemplateAssistantLockCellPatch_ACU[];
    specialIndexLocked?: boolean;
}

export interface TemplateAssistantPatchSheetSourceDataOperation_ACU {
    op: 'patch_sheet_source_data';
    sheetKey: string;
    patch: TemplateAssistantPatchSheetSourceDataPatch_ACU;
}

export interface TemplateAssistantPatchSheetUpdateConfigOperation_ACU {
    op: 'patch_sheet_update_config';
    sheetKey: string;
    patch: TemplateAssistantPatchSheetUpdateConfigPatch_ACU;
}

export interface TemplateAssistantPatchSheetExportConfigOperation_ACU {
    op: 'patch_sheet_export_config';
    sheetKey: string;
    patch: Record<string, any>;
}

export interface TemplateAssistantPatchSheetContentOperation_ACU {
    op: 'patch_sheet_content';
    sheetKey: string;
    patch: TemplateAssistantPatchSheetContentPatch_ACU;
}

export interface TemplateAssistantPatchSheetSchemaOperation_ACU {
    op: 'patch_sheet_schema';
    sheetKey: string;
    patch: TemplateAssistantPatchSheetSchemaPatch_ACU;
}

export interface TemplateAssistantPatchSheetLocksOperation_ACU {
    op: 'patch_sheet_locks';
    sheetKey: string;
    patch: TemplateAssistantPatchSheetLocksPatch_ACU;
}

export interface TemplateAssistantPatchGlobalInjectionConfigOperation_ACU {
    op: 'patch_global_injection_config';
    patch: Record<string, any>;
}

export type TemplateAssistantOperation_ACU =
    | TemplateAssistantAddSheetOperation_ACU
    | TemplateAssistantRenameSheetOperation_ACU
    | TemplateAssistantDeleteSheetOperation_ACU
    | TemplateAssistantMoveSheetOperation_ACU
    | TemplateAssistantPatchSheetSourceDataOperation_ACU
    | TemplateAssistantPatchSheetUpdateConfigOperation_ACU
    | TemplateAssistantPatchSheetExportConfigOperation_ACU
    | TemplateAssistantPatchSheetContentOperation_ACU
    | TemplateAssistantPatchSheetSchemaOperation_ACU
    | TemplateAssistantPatchSheetLocksOperation_ACU
    | TemplateAssistantPatchGlobalInjectionConfigOperation_ACU;

type TemplateAssistantBaseDraft_ACU = {
    protocolVersion: 1 | 2;
    mode: 'modify_current_template_incremental';
    baseFingerprint: string;
    selectedSheetKey: string;
    summary: string;
    warnings: string[];
    operations: TemplateAssistantOperation_ACU[];
};

export interface TemplateAssistantDraftV1_ACU extends TemplateAssistantBaseDraft_ACU {
    protocolVersion: 1;
}

export interface TemplateAssistantDraftV2_ACU extends TemplateAssistantBaseDraft_ACU {
    protocolVersion: 2;
    requestId: string;
    atomic: true;
}

export type TemplateAssistantDraft_ACU = TemplateAssistantDraftV1_ACU | TemplateAssistantDraftV2_ACU | TemplateAssistantDraftV3_ACU;


/**
 * v3 完整 Sheet 契约（单表完整输出）。
 * 模型必须返回目标表修改后的完整对象；本地严格校验后整体替换。
 */
export interface TemplateAssistantFullSheetV3_ACU {
    name: string;
    domain: string;
    type: string;
    enable: boolean;
    required: boolean;
    content: any[][];
    sourceData: Record<string, any>;
    updateConfig: Record<string, any>;
    exportConfig: Record<string, any>;
    hiddenPhysicalColumns?: unknown;
    tableAliases?: unknown;
    columnAliases?: unknown;
}

/**
 * v3 单动作结果信封：每轮只能有一个 result、一个目标表。
 * - replace：完整替换一张已存在表（继承本地身份/顺序）。
 * - create：完整新增一张表（本地分配身份）。
 * - delete：显式删除一张已存在表（唯一不返回完整 Sheet 的动作）。
 */
export type TemplateAssistantV3Result_ACU =
    | { action: 'replace'; sheetKey: string; sheet: TemplateAssistantFullSheetV3_ACU }
    | { action: 'create'; insertAfterSheetKey?: string; sheet: TemplateAssistantFullSheetV3_ACU }
    | { action: 'delete'; sheetKey: string };

export interface TemplateAssistantDraftV3_ACU {
    protocolVersion: 3;
    mode: 'single_sheet_full_replace';
    requestId: string;
    baseFingerprint: string;
    atomic: true;
    selectedSheetKey: string;
    summary: string;
    warnings: string[];
    result: TemplateAssistantV3Result_ACU;
}

export function isTemplateAssistantV3Draft_ACU(draft: any): draft is TemplateAssistantDraftV3_ACU {
    return !!draft && draft.protocolVersion === 3;
}

export interface TemplateAssistantPriorTurn_ACU {
    user: string;
    assistant?: string;
}

export interface TemplateAssistantGenerateInput_ACU {
    tempData: AnyRecord;
    currentSheetKey: string | null;
    sheetOrder?: string[] | null;
    userRequest: string;
    protocolVersion?: 2 | 3;
    priorTurns?: TemplateAssistantPriorTurn_ACU[] | null;
    tableApiPreset?: string;
    guard?: TemplateAssistantSessionRunGuard_ACU | null;
}

export interface TemplateAssistantGenerateResult_ACU {
    draft: TemplateAssistantDraft_ACU;
    aiRawText: string;
    messages: Array<{ role: string; content: string }>;
    compileResult: TemplateAssistantCompileResult_ACU;
    originalBaseFingerprint?: string;
    rounds?: TemplateAssistantSessionRound_ACU[];
    session?: TemplateAssistantSessionMeta_ACU;
}

export type TemplateAssistantSessionStopReason_ACU =
    | 'success'
    | 'empty_operations'
    | 'repair_retry_capped'
    | 'environment_failure'
    | 'context_budget_failure';

export type TemplateAssistantSessionAbortReason_ACU = 'cancelled' | 'stale';

export interface TemplateAssistantSessionRound_ACU {
    round: number;
    userRequest: string;
    draft: TemplateAssistantDraft_ACU;
    aiRawText: string;
    messages: Array<{ role: string; content: string }>;
    perRoundCompileResult: TemplateAssistantCompileResult_ACU;
    workingFingerprint: string;
}

export interface TemplateAssistantSessionMeta_ACU {
    originalBaseFingerprint: string;
    finalWorkingFingerprint: string;
    stopReason: TemplateAssistantSessionStopReason_ACU;
    /**
     * 会话的最终失败信息。
     * - 会话最终成功（单轮产出可应用 draft）时为 null；
     * - 仅当会话以失败告终（如 repair_retry_capped 或最终 preflight 失败）时携带失败详情。
     * 面板据此决定是否展示失败横幅与「携带修改意见重试」入口。
     */
    lastFailure: TemplateAssistantFailureInfo_ACU | null;
    roundsExecuted: number;
    /** 固定为 1：改表助手是一问一答，不再自动多轮。 */
    maxRounds: number;
    repairRetriesUsed: number;
    maxRepairRetries: number;
    lastErrorMessage: string;
    /**
     * v3 row_id 集合守卫：仅当 replace 目标表出现「AI 未请求删行但 row_id 集合缩减」时非空。
     * 供 UI 展示确认；未确认前不得应用候选。
     */
    v3RowIdGuardFindings?: Array<{
        code: 'row_id_set_reduction';
        sheetKey: string;
        missingRowIds: string[];
    }>;
}

export interface TemplateAssistantV3RowIdGuardFinding_ACU {
    code: 'row_id_set_reduction';
    sheetKey: string;
    missingRowIds: string[];
}

export interface TemplateAssistantSessionResult_ACU extends TemplateAssistantGenerateResult_ACU {
    originalBaseFingerprint: string;
    rounds: TemplateAssistantSessionRound_ACU[];
    session: TemplateAssistantSessionMeta_ACU;
}

export interface TemplateAssistantSessionProgress_ACU {
    round: TemplateAssistantSessionRound_ACU;
    rounds: TemplateAssistantSessionRound_ACU[];
    maxRounds: number;
}

export interface TemplateAssistantSessionRunGuard_ACU {
    isCancelled?: () => boolean;
    isStale?: () => boolean;
    signal?: AbortSignal | null;
}

export interface TemplateAssistantSessionGuardController_ACU {
    createRunGuard: () => TemplateAssistantSessionRunGuard_ACU;
    invalidate: () => void;
    cancel: () => void;
    reset: () => void;
    getSignal: () => AbortSignal | null;
}

export interface TemplateAssistantSessionRunInput_ACU extends TemplateAssistantGenerateInput_ACU {
    /**
     * @deprecated 改表助手已固定为一问一答（恒 1 轮），此参数被接收但忽略，仅为兼容旧调用方保留。
     */
    maxRounds?: number;
    maxRepairRetries?: number;
    onRoundComplete?: (progress: TemplateAssistantSessionProgress_ACU) => void;
    guard?: TemplateAssistantSessionRunGuard_ACU | null;
}

export class TemplateAssistantSessionStoppedError_ACU extends Error {
    stopReason: TemplateAssistantSessionAbortReason_ACU;

    constructor(stopReason: TemplateAssistantSessionAbortReason_ACU) {
        super(stopReason === 'cancelled' ? '模板助手会话已取消' : '模板助手会话已过期');
        this.name = 'TemplateAssistantSessionStoppedError_ACU';
        this.stopReason = stopReason;
    }
}

const DEFAULT_TEMPLATE_ASSISTANT_MAX_REPAIR_RETRIES_ACU = 1;

/**
 * 可编辑提示词卡片段（设置键 templateAssistantPromptSegments 的元素）。
 * role 支持 SYSTEM / USER / assistant（复用 normalizeRole 规则）。
 */
export interface TemplateAssistantPromptSegment_ACU {
    role: string;
    content: string;
    deletable?: boolean;
    /**
     * 伪 role 提示词组标记。为 true 表示该卡属于「提前准备好的提示词组」。
     * 仅供代码识别（判定是否整体前置到真实历史之前），不会进入发送给 AI 的提示词内容。
     * 默认模板的卡全部为 true；用户新增卡片默认不带该标记。
     */
    pinned?: boolean;
}

export type TemplateAssistantFailureKind_ACU =
    | 'parse'
    | 'validate'
    | 'fingerprint'
    | 'preflight'
    | 'environment'
    | 'context_budget'
    | 'unknown';

export interface TemplateAssistantFailureInfo_ACU {
    kind: TemplateAssistantFailureKind_ACU;
    message: string;
    rawText?: string;
}

export const TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU = '{{assistant.referenceDocs}}';

export const TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU = '$1';
export const TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU = '$2';
export const TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU = '$3';
export const TEMPLATE_ASSISTANT_PLACEHOLDER_PROTOCOL_ACU = '$4';

/**
 * 改表助手占位符扫描正则。
 *
 * **注意**：本常量带 `g` 标志，拥有 `lastIndex` 状态。
 * 仅允许通过 `String.prototype.replace` 使用（replace 内部会重置 lastIndex）；
 * **禁止**对本常量调用 `.test()` / `.exec()`，否则会因 lastIndex 泄漏产生非确定性结果。
 */
export const TEMPLATE_ASSISTANT_PLACEHOLDER_PATTERN_ACU = /\$[1-4]|\{\{assistant\.referenceDocs\}\}/g;

export interface TemplateAssistantPlaceholderDoc_ACU {
    token: string;
    label: string;
    description: string;
    /** data = 表格数据载荷；reference = 语法文档 */
    kind: 'data' | 'reference';
}

/**
 * 占位符元数据（单一事实来源，UI 清单据此渲染，不得在组件内硬编码占位符字面量）。
 * 顺序：$1 → $4 → referenceDocs。
 */
export const TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU: TemplateAssistantPlaceholderDoc_ACU[] = [
    {
        token: TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU,
        label: '用户输入',
        description:
            '本轮改表需求原文。删除后 AI 收不到需求，且历史上下文将追加到提示词末尾。',
        kind: 'data',
    },
    {
        token: TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU,
        label: '当前表格结构',
        description: '当前选中表的 sheetKey 与结构快照。',
        kind: 'data',
    },
    {
        token: TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU,
        label: '全局表格结构',
        description: '全部表格结构快照、表数量与全局注入配置。',
        kind: 'data',
    },
    {
        token: TEMPLATE_ASSISTANT_PLACEHOLDER_PROTOCOL_ACU,
        label: '表格结构协议（规则）',
        description: '表格结构指纹与协议约束。删除后 AI 拿不到结构指纹，草稿校验将失败。',
        kind: 'data',
    },
    {
        token: TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU,
        label: '语法参考文档',
        description: '两份本地语法文档原文嵌入。删除后系统会自动追加到最后一张 SYSTEM 卡末尾。',
        kind: 'reference',
    },
];


function clone_ACU<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

/**
 * 归一 AI 改表助手提示词段的 role：
 * - SYSTEM / USER 保持大写（与 AcuPromptSegments 的 roleOptions 及 FormFill 体系一致）；
 * - assistant 返回小写（酒馆 API / Chat Completions 对 assistant role 的大小写约定不统一，
 *   此处沿用 AcuPromptSegments DEFAULT_ROLE_OPTIONS 的 'assistant' 小写值）；
 * - 其余非法值一律归一为 SYSTEM。
 */
function normalizeAssistantPromptRole_ACU(raw: unknown) {
    const role = String(raw || 'SYSTEM').trim();
    if (role === 'assistant') return 'assistant';
    if (role.toUpperCase() === 'SYSTEM') return 'SYSTEM';
    if (role.toUpperCase() === 'USER') return 'USER';
    if (role.toUpperCase() === 'ASSISTANT') return 'assistant';
    return 'SYSTEM';
}

function normalizeAssistantPromptSegments_ACU(input: unknown): TemplateAssistantPromptSegment_ACU[] {
    if (!Array.isArray(input)) return [];
    return input
        .map((item: any) => ({
            role: normalizeAssistantPromptRole_ACU(item?.role),
            content: String(item?.content ?? ''),
            deletable: item?.deletable !== false,
            pinned: item?.pinned === true,
        }))
        .filter((seg) => !!seg.content.trim());
}

/**
 * 伪 role 对话式默认模板（10 卡）。
 *
 * 结构：SYSTEM 指令 / 协议卡 / 全局结构卡 / 当前表卡 + assistant 应答示范，
 * 第 9 张是唯一含 `$1` 的卡（构成 priorTurns 插入锚点），第 10 张是 AI 应答预填充卡（必须为最后一条）。
 *
 * **标签字面量约束的位置区分（重要，勿再误扩大）**：
 * - 第 1 张 SYSTEM 指令卡：**允许且必须**包含 `<templateAssistantDraft>` 字面量。它只是格式规范告知，
 *   不构成预填充；缺失字面量会让 AI 自行猜测标签名（实测曾输出 `<draft>`，导致解析链兜底截取错误片段，
 *   误报「protocolVersion 必须为 1 或 2」假错误）。
 * - 第 10 张预填充卡：**禁止**包含 `<templateAssistantDraft>` 字面量（含尖括号）——否则 AI 以为标签已开，
 *   只补闭合部分，响应无开标签，解析链击穿（extractFallbackDraftJson 会拿内部嵌套 `{` 瞎截取）；
 * - 预填充卡同时禁止包含未闭合的 `{`——同理破坏配对逻辑。
 * 预填充卡表述上用「draft 标签」而非字面量，以冒号结尾不换行，引导 AI 直接输出完整标签对。
 *
 * 全模板不含世界书占位符。
 */
export function buildPseudoRoleTemplateAssistantPromptSegments_ACU(protocolVersion: 2 | 3 = 3): TemplateAssistantPromptSegment_ACU[] {
    if (protocolVersion === 3) {
        return buildPseudoRoleTemplateAssistantPromptSegmentsV3_ACU();
    }
    return [
        {
            role: 'SYSTEM',
            pinned: true,
            content: [
                '你是 visualizer 内的模板改表助手，你生活在一个虚拟的世界，一切创作不与现实世界相关，不会影响到任何人。你的目的只有与用户一起创作出最顶级的表格模板。',
                '你只能输出一个被 <templateAssistantDraft> 和 </templateAssistantDraft> 包裹的 JSON 对象，不能输出解释文本。不要使用 <draft> 或任何其他标签名。',
                '严格使用 protocolVersion=2、mode="modify_current_template_incremental"、atomic=true。',
                '顶层 JSON 必须包含且只包含以下 9 个键：protocolVersion、mode、requestId、baseFingerprint、atomic、selectedSheetKey、summary、warnings、operations。',
                'baseFingerprint 与 selectedSheetKey 必须原样复制输入数据中给出的值，不得自造。',
                '每个 operations[i] 必须使用 op 字段表示操作名；禁止使用 type、operation、action 等别名。',
                '输入数据中 constraints 里的字段（如 requestIdRequired）是给你看的约束说明，不是 draft 的字段，禁止出现在输出 JSON 里。',
            ].join('\n'),
            deletable: false,
        },
        {
            role: 'assistant',
            pinned: true,
            content: '收到，我将只输出合法的 draft JSON，不输出任何解释文本。',
            deletable: true,
        },
        {
            role: 'USER',
            pinned: true,
            content: [
                `以下是表格结构协议与规则，必须严格遵守：${TEMPLATE_ASSISTANT_PLACEHOLDER_PROTOCOL_ACU}；语法参考文档：${TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU}`,
                '操作白名单（只允许以下 11 种操作名，禁止其他）：add_sheet、rename_sheet、delete_sheet、move_sheet、patch_sheet_source_data、patch_sheet_update_config、patch_sheet_export_config、patch_sheet_content、patch_sheet_schema、patch_sheet_locks、patch_global_injection_config。',
                '不存在 patch_sheet_ddl 操作；DDL 只能通过 patch_sheet_schema.patch.ddl 修改。',
                'add_sheet 必须同时提供非空 sheetName 和至少一个 headers 项；不要生成 sheetKey，本地会自动生成；应尽量同时提供 sourceData 的 note、initNode、insertNode、updateNode、deleteNode 五段。',
                'add_sheet.sourceData 与 patch_sheet_source_data.patch 只允许 note、initNode、insertNode、updateNode、deleteNode 五个字段；禁止出现 ddl、sql、schema、createTable 等字段。',
                '默认不主动输出 patch_sheet_schema.ddl；除非用户明确要求 DDL、字段类型、约束或 SQLite 建表语句。中文 headers 必须使用英文/ASCII 物理列名并配 `-- 中文表头` 注释按原顺序一一对应；第一列必须 row_id INTEGER PRIMARY KEY 并保留 `-- 行号` 注释。',
                '当用户对【已存在的表】明确要求 DDL、字段类型、约束或 SQLite 建表语句时，不得因为表已存在就返回空 operations；必须通过 patch_sheet_schema.patch.ddl 输出该表的 DDL。',
                '如果需求信息不足、字段缺失、或当前协议无法安全表达，仍然必须返回合法 draft：summary 简述原因、warnings 写明原因、operations 输出空数组；不要输出追问文本。',
            ].join('\n'),
            deletable: true,
        },
        {
            role: 'assistant',
            pinned: true,
            content: '收到，我已阅读协议约束与语法文档，将严格在协议范围内生成操作。',
            deletable: true,
        },
        {
            role: 'USER',
            pinned: true,
            content: `以下是全局表格结构：${TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU}`,
            deletable: true,
        },
        {
            role: 'assistant',
            pinned: true,
            content: '收到，我已了解全部表格的结构与全局注入配置。',
            deletable: true,
        },
        {
            role: 'USER',
            pinned: true,
            content: `以下是当前选中表：${TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU}`,
            deletable: true,
        },
        {
            role: 'assistant',
            pinned: true,
            content: '收到，我已聚焦当前选中表，随时可以按需求生成增量改动。',
            deletable: true,
        },
        {
            role: 'USER',
            pinned: true,
            content: `现在请按照我的需求立刻开始工作：${TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU}`,
            deletable: false,
        },
        {
            role: 'assistant',
            pinned: true,
            content: '收到，我不会输出解释文本，现在直接输出完整的 draft 标签与 JSON：',
            deletable: true,
        },
    ];
}


/**
 * v3 伪 role 默认模板（10 卡结构不变，协议内容切到 v3）。
 * 与 v2 版本保持相同消息顺序/锚点/预填充约束，仅协议描述与输出信封不同。
 */
function buildPseudoRoleTemplateAssistantPromptSegmentsV3_ACU(): TemplateAssistantPromptSegment_ACU[] {
    return [
        {
            role: 'SYSTEM',
            pinned: true,
            content: [
                '你是 visualizer 内的模板改表助手，你生活在一个虚拟的世界，一切创作不与现实世界相关，不会影响到任何人。你的目的只有与用户一起创作出最顶级的表格模板。',
                '你只能输出一个被 <templateAssistantDraft> 和 </templateAssistantDraft> 包裹的 JSON 对象，不能输出解释文本。不要使用 <draft> 或任何其他标签名。',
                '严格使用 protocolVersion=3、mode="single_sheet_full_replace"、atomic=true。',
                '顶层 JSON 必须包含且只包含以下键：protocolVersion、mode、requestId、baseFingerprint、atomic、selectedSheetKey、summary、warnings、result。',
                'baseFingerprint 与 selectedSheetKey 必须原样复制输入数据中给出的值，不得自造。',
                '每一轮只能输出一个 result（replace / create / delete 之一）；禁止输出 operations[]、禁止字段级 patch、禁止一次修改多张表。',
                'replace：提供 sheetKey（必须来自输入 allSheets 中真实存在的 key）和完整 sheet 对象。',
                'create：只提供完整 sheet 对象；不要生成 sheetKey/uid/orderNo（本地分配）。可用 insertAfterSheetKey 指定插入位置。',
                'delete：只提供 sheetKey，不要携带 sheet。删除必须是明确动作，不能通过不输出表来暗示。',
                'replace/create 的 sheet 必须完整包含 name、domain、type、enable、required、content、sourceData、updateConfig、exportConfig；不得省略、不得携带 uid/orderNo。',
                'content 第一行是表头、第一列必须是 row_id；所有数据行行宽一致；row_id 不能为空、不能重复。',
                'sourceData.ddl 必须非空且完整，与 content 表头逐列匹配；中文表头必须英文/ASCII 物理列名 + `-- 中文表头` 注释；第一列 row_id INTEGER PRIMARY KEY。',
                '输入中其他表一律保持原样；未输出的表不会被删除。',
                '输入数据中 constraints 里的字段（如 singleSheetFullReplace）是给你看的约束说明，不是 draft 的字段，禁止出现在输出 JSON 里。',
            ].join('\n'),
            deletable: false,
        },
        {
            role: 'assistant',
            pinned: true,
            content: '收到，我将只输出合法的 v3 draft JSON（单 result 信封），不输出任何解释文本。',
            deletable: true,
        },
        {
            role: 'USER',
            pinned: true,
            content: [
                `以下是表格结构协议与规则，必须严格遵守：${TEMPLATE_ASSISTANT_PLACEHOLDER_PROTOCOL_ACU}；语法参考文档：${TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU}`,
                'result.action 只允许 replace / create / delete 之一；禁止字段级 patch 与多表 operations。',
                'replace/create 必须返回完整 sheet（name/domain/type/enable/required/content/sourceData/updateConfig/exportConfig 全量），禁止省略字段或只给差异。',
                'sheet.content 第一列必须是 row_id，所有数据行行宽一致，row_id 非空且不重复。',
                'sourceData.ddl 必须非空且与 content 表头逐列匹配；中文表头必须英文/ASCII 物理列名 + `-- 中文表头` 注释按原顺序一一对应；第一列必须 row_id INTEGER PRIMARY KEY 并保留 `-- 行号` 注释。',
                'delete 必须显式给出要删除的 sheetKey；禁止通过不输出某张表来暗示删除，禁止修改未目标表。',
                'create 不要生成 sheetKey/uid/orderNo，本地会自动分配；insertAfterSheetKey 必须来自输入中真实存在的 key。',
                '禁止修改全局注入配置；禁止直接保存行为。',
                '如果需求信息不足、字段缺失、或当前协议无法安全表达，仍然必须返回合法 v3 draft：summary 简述原因、warnings 写明原因、result 输出 {action:"replace", sheetKey:"<真实key>", sheet:{...完整原样...}}；不要输出追问文本。',
            ].join('\n'),
            deletable: true,
        },
        {
            role: 'assistant',
            pinned: true,
            content: '收到，我已阅读 v3 协议约束与语法文档，将严格在协议范围内生成单表完整结果。',
            deletable: true,
        },
        {
            role: 'USER',
            pinned: true,
            content: `以下是全局表格结构：${TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU}`,
            deletable: true,
        },
        {
            role: 'assistant',
            pinned: true,
            content: '收到，我已了解全部表格的完整结构（含 DDL）。',
            deletable: true,
        },
        {
            role: 'USER',
            pinned: true,
            content: `以下是当前选中表：${TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU}`,
            deletable: true,
        },
        {
            role: 'assistant',
            pinned: true,
            content: '收到，我已聚焦当前选中表，随时可以按需求生成单表完整替换结果。',
            deletable: true,
        },
        {
            role: 'USER',
            pinned: true,
            content: `现在请按照我的需求立刻开始工作：${TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU}`,
            deletable: false,
        },
        {
            role: 'assistant',
            pinned: true,
            content: '收到，我不会输出解释文本，现在直接输出完整的 v3 draft 标签与 JSON：',
            deletable: true,
        },
    ];
}


/**
 * 将占位符值序列化为字符串，供替换进提示词。
 * - string 原样返回；
 * - number / boolean 走 String()；
 * - 其余（对象/数组等）走 safeJsonStringify，失败回退 '{}'。
 */
export function stringifyPlaceholderValue_ACU(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return safeJsonStringify_ACU(value, '{}');
}

/**
 * 单次扫描替换占位符。
 *
 * **禁止**改回以下两种写法：
 * 1. `content.replace('$1', value)` —— value 含 `$&` / `` $` `` / `$'` / `$1` / `$<name>` 时会被当替换模式展开；
 * 2. 逐 token 顺序替换（无论 replace 还是 split/join）—— 前一个 token 的值里若含后一个 token 字面量，会被二次替换（跨 token 污染）。
 *
 * 反面参照：`src/service/ai/prompt-builder/prompt-api-call.ts:125-132` 的顺序 replace 缺陷。
 *
 * 两个安全性质：
 * - 回调形式的 replace 不解释返回值中的 `$` 序列（ECMAScript 规范：仅当 replacement 为字符串时才执行 GetSubstitution）；
 * - 单次扫描：正则 lastIndex 持续前进，已替换内容不再被扫描，值内 token 不会被误替换。
 *
 * valueMap 中不存在的 key 保留原 token 字面量，不替换为空串——用户能从提示词直观看到「这个占位符没生效」。
 */
export function applyTemplateAssistantPlaceholders_ACU(
    content: string,
    valueMap: Record<string, string>,
): string {
    return String(content || '').replace(
        TEMPLATE_ASSISTANT_PLACEHOLDER_PATTERN_ACU,
        (matched) => (Object.prototype.hasOwnProperty.call(valueMap, matched) ? valueMap[matched] : matched),
    );
}


function normalizePositiveInteger_ACU(value: any, fallback: number) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return fallback;
    const integer = Math.floor(normalized);
    return integer > 0 ? integer : fallback;
}

function normalizeNonNegativeInteger_ACU(value: any, fallback: number) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return fallback;
    const integer = Math.floor(normalized);
    return integer >= 0 ? integer : fallback;
}

function asObject_ACU(value: any, fallback: AnyRecord = {}) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function trimAssistantMessage_ACU(value: any) {
    return String(value ?? '').trim();
}

function normalizePriorTurns_ACU(priorTurns: TemplateAssistantPriorTurn_ACU[] | null | undefined) {
    if (!Array.isArray(priorTurns)) return [];
    return priorTurns
        .map((turn) => ({
            user: trimAssistantMessage_ACU(turn?.user),
            assistant: trimAssistantMessage_ACU(turn?.assistant),
        }))
        .filter((turn) => !!turn.user || !!turn.assistant);
}

/**
 * v3 上下文预算守卫：v3 全表 DDL 全量注入可能让 payload 极大。
 * 超过预算必须**阻止请求**（fail-closed），绝不静默截断——截断会让 AI 拿到
 * 不完整的表结构，反而制造不一致的 replace 结果。
 * 阈值按字符近似 token（中文 1 字符 ≈ 1 token，保守取 2 字符/token）。
 */
const TEMPLATE_ASSISTANT_V3_CONTEXT_BUDGET_CHARS_ACU = 40_000;

function assertV3ContextBudget_ACU(payloadText: string) {
    const chars = String(payloadText || '').length;
    if (chars > TEMPLATE_ASSISTANT_V3_CONTEXT_BUDGET_CHARS_ACU) {
        const wrapped = new Error(
            `v3 全表上下文预算超限：payload ${chars} 字符（上限 ${TEMPLATE_ASSISTANT_V3_CONTEXT_BUDGET_CHARS_ACU}）。`
            + '请减少表数量/行数，或改用 v2 增量协议。',
        );
        (wrapped as any).failureKind = 'context_budget';
        throw wrapped;
    }
}


export function buildTemplateAssistantMessages_ACU(input: TemplateAssistantGenerateInput_ACU, baseFingerprint: string) {
    const protocolVersion = input.protocolVersion === 3 ? 3 : (input.protocolVersion === 2 ? 2 : 3);
    const payload = buildUserPromptPayload_ACU(input, baseFingerprint, protocolVersion);
    const normalized = normalizeAssistantPromptSegments_ACU(settings_ACU.templateAssistantPromptSegments);
    const referenceText = buildTemplateAssistantEmbeddedReferenceText_ACU();
    const valueMap = buildAssistantPlaceholderContext_ACU(payload, referenceText);
    const resolved = resolveAssistantSystemPrompt_ACU(normalized, valueMap, protocolVersion);
    const fullPayloadText = safeJsonStringify_ACU(payload, '{}');
    if (protocolVersion === 3) {
        assertV3ContextBudget_ACU(fullPayloadText);
    }

    const messages: Array<{ role: string; content: string }> = [];

    if (normalized.length === 0) {
        // 存量路径：与旧版字节级一致（role 小写 system 单条 + priorTurns + 完整 payload）。
        messages.push(...resolved);
        normalizePriorTurns_ACU(input.priorTurns).forEach((turn) => {
            if (turn.user) messages.push({ role: 'user', content: turn.user });
            if (turn.assistant) messages.push({ role: 'assistant', content: turn.assistant });
        });
        messages.push({ role: 'user', content: fullPayloadText });
        return messages;
    }

    // 伪 role 提示词组标记：存在任意 pinned 卡即视为「提前准备好的提示词组」。
    // 判定在 resolved 之前用 normalized 完成；pinned 仅用于消息排序，不进入发送给 AI 的内容。
    const hasPinned = normalized.some((seg) => seg.pinned === true);
    // 锚点：最后一张「含 $1 的卡」。必须在替换前（normalized）判定，
    // 因为 resolved 中的 $1 已被替换成 userRequest 值，若该值本身含 "$1" 会污染判定。
    const anchorIndex = normalized.reduce<number>(
        (last, seg, i) =>
            String(seg.content || '').includes(TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU) ? i : last,
        -1,
    );
    // 是否出现任一数据占位符（$1-$4）；出现任一即视为用户接管数据注入，不再自动追加 payload。
    const hasAnyDataToken = normalized.some((seg) => /\$[1-4]/.test(String(seg.content || '')));

    const pushPriorTurns = () => {
        normalizePriorTurns_ACU(input.priorTurns).forEach((turn) => {
            if (turn.user) messages.push({ role: 'user', content: turn.user });
            if (turn.assistant) messages.push({ role: 'assistant', content: turn.assistant });
        });
    };

    if (hasPinned) {
        // 伪 role 提示词组：整体（含卡9 包装语与卡10 预填充）固定放最前，
        // 首轮无历史时即完整提示词组；后续轮真实历史与本轮需求紧随其后。
        messages.push(...resolved);
        const priorTurns = normalizePriorTurns_ACU(input.priorTurns);
        priorTurns.forEach((turn) => {
            if (turn.user) messages.push({ role: 'user', content: turn.user });
            if (turn.assistant) messages.push({ role: 'assistant', content: turn.assistant });
        });
        if (priorTurns.length > 0) {
            messages.push({ role: 'USER', content: String(input.userRequest || '').trim() });
        }
    } else if (anchorIndex >= 0) {
        const priorTurns = normalizePriorTurns_ACU(input.priorTurns);
        // 存量路径（无 pinned 标记）：首轮完整伪 role 结构。
        if (priorTurns.length === 0) {
            messages.push(...resolved);
        } else {
            // 存量后续轮：含 $1 模板整体前置，历史与本轮需求紧随其后。
            messages.push(...resolved);
            priorTurns.forEach((turn) => {
                if (turn.user) messages.push({ role: 'user', content: turn.user });
                if (turn.assistant) messages.push({ role: 'assistant', content: turn.assistant });
            });
            messages.push({ role: 'USER', content: String(input.userRequest || '').trim() });
        }
    } else {
        messages.push(...resolved);
        pushPriorTurns();
        // 无任何数据占位符 → 追加完整 payload user 消息，与现状等价。
        if (!hasAnyDataToken) {
            messages.push({ role: 'user', content: fullPayloadText });
        }
    }
    return messages;
}

export function setTemplateAssistantPrompt_ACU(
    segments: TemplateAssistantPromptSegment_ACU[],
): { ok: boolean; message?: string } {
    const normalized = normalizeAssistantPromptSegments_ACU(segments);
    const result = withSettingsWrite_ACU(['templateAssistantPromptSegments'], () => {
        settings_ACU.templateAssistantPromptSegments = normalized;
    });
    if (!result.ok) {
        return { ok: false, message: result.message || '提示词保存失败。' };
    }
    return { ok: true };
}

const TEMPLATE_ASSISTANT_PERSISTED_AUX_KEYS_ACU = [
    'hiddenPhysicalColumns',
    'tableAliases',
    'columnAliases',
] as const;

function sanitizeSourceDataSnapshotForAssistant_ACU(value: any, includeDdl = false) {
    const sourceData = asObject_ACU(value);
    const sanitized: AnyRecord = {};
    TEMPLATE_ASSISTANT_SOURCE_DATA_ALLOWED_KEYS_ACU.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(sourceData, key)) {
            sanitized[key] = clone_ACU(sourceData[key]);
        }
    });
    if (includeDdl && typeof sourceData?.ddl === 'string' && sourceData.ddl.trim()) {
        sanitized.ddl = clone_ACU(sourceData.ddl);
    }
    return sanitized;
}

function copyPersistedAuxFields_ACU(sheet: AnyRecord, snapshot: AnyRecord) {
    TEMPLATE_ASSISTANT_PERSISTED_AUX_KEYS_ACU.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(sheet, key) && sheet[key] !== undefined) {
            snapshot[key] = clone_ACU(sheet[key]);
        }
    });
    return snapshot;
}

function validateSourceDataPayload_ACU(value: any, label: string) {
    if (value == null) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} 必须是对象`);
    }
    Object.keys(value).forEach((key) => {
        if (TEMPLATE_ASSISTANT_SOURCE_DATA_ALLOWED_KEY_SET_ACU.has(key)) return;
        if (key === 'ddl') {
            throw new Error(`${label} 不能直接修改 ddl，请改用 patch_sheet_schema.ddl`);
        }
        throw new Error(`${label} 包含未知字段: ${key}`);
    });
}

function extractHeaders_ACU(sheet: any) {
    return Array.isArray(sheet?.content?.[0]) ? sheet.content[0].slice(1).map((item: any) => String(item ?? '')) : [];
}

function getSheetSnapshot_ACU(tempData: AnyRecord, sheetKey: string, options?: { includeDdl?: boolean }) {
    const sheet = tempData?.[sheetKey] || {};
    const snapshot: AnyRecord = {
        sheetKey,
        name: String(sheet?.name || ''),
        domain: typeof sheet?.domain === 'string' ? sheet.domain : 'chat',
        type: typeof sheet?.type === 'string' ? sheet.type : 'dynamic',
        enable: sheet?.enable !== false,
        required: sheet?.required === true,
        orderNo: Number.isFinite(sheet?.orderNo) ? sheet.orderNo : null,
        headers: extractHeaders_ACU(sheet),
        content: clone_ACU(Array.isArray(sheet?.content) ? sheet.content : []),
        sourceData: sanitizeSourceDataSnapshotForAssistant_ACU(sheet?.sourceData, options?.includeDdl === true),
        updateConfig: clone_ACU(asObject_ACU(sheet?.updateConfig)),
        exportConfig: clone_ACU(asObject_ACU(sheet?.exportConfig)),
    };
    if (options?.includeDdl === true) {
        copyPersistedAuxFields_ACU(sheet, snapshot);
    }
    return snapshot;
}

function getSelectedSheetSnapshot_ACU(tempData: AnyRecord, sheetKey: string | null, options?: { includeDdl?: boolean }) {
    if (!sheetKey || !tempData?.[sheetKey]) return null;
    return getSheetSnapshot_ACU(tempData, sheetKey, options);
}

function buildSheetSummary_ACU(tempData: AnyRecord) {
    const sheetKeys = getSortedSheetKeys_ACU(tempData, { ignoreChatGuide: true });
    return sheetKeys.map((sheetKey) => {
        const sheet = tempData[sheetKey] || {};
        return {
            sheetKey,
            name: String(sheet.name || ''),
            orderNo: Number.isFinite(sheet.orderNo) ? sheet.orderNo : null,
            headers: extractHeaders_ACU(sheet),
            rowCount: Math.max(0, (Array.isArray(sheet?.content) ? sheet.content.length : 0) - 1),
        };
    });
}

function buildDetailedSheetSnapshots_ACU(tempData: AnyRecord, options?: { includeDdl?: boolean }) {
    return buildSheetSummary_ACU(tempData).map((item) => getSheetSnapshot_ACU(tempData, item.sheetKey, options));
}

export function buildTemplateAssistantFingerprint_ACU(tempData: AnyRecord) {
    const normalized = asObject_ACU(tempData);
    const sheetKeys = getSortedSheetKeys_ACU(normalized, { ignoreChatGuide: true });
    const snapshot = {
        globalInjectionConfig: getGlobalInjectionConfigFromData_ACU(normalized, { ensureWriteBack: false }),
        sheets: sheetKeys.map((sheetKey) => {
            const sheet = normalized[sheetKey] || {};
            return {
                sheetKey,
                uid: sheet.uid ?? '',
                name: sheet.name ?? '',
                orderNo: sheet.orderNo ?? null,
                content: Array.isArray(sheet?.content) ? sheet.content : [],
                sourceData: asObject_ACU(sheet.sourceData),
                updateConfig: asObject_ACU(sheet.updateConfig),
                exportConfig: asObject_ACU(sheet.exportConfig),
            };
        }),
    };
    return `acu-struct:${hashUserInput_ACU(safeJsonStringify_ACU(snapshot, '{}'))}`;
}

/**
 * 取 AI 文本中最后一个 <templateAssistantDraft> 标签对内的内容。
 * 注意：若最后一个标签对内的 JSON 本身损坏，不会向前回退到更早的标签对——
 * 由调用方（parseTemplateAssistantDraft_ACU）走 stripCodeFences / 兜底大括号截取链处理。
 * @throws 未找到任何标签对时抛出定位错误
 */
function getLastTaggedDraftText_ACU(aiText: string) {
    const tagPattern = /<templateAssistantDraft>([\s\S]*?)<\/templateAssistantDraft>/g;
    const matches = Array.from(String(aiText || '').matchAll(tagPattern));
    if (!matches.length) {
        throw new Error('AI 响应中未找到 <templateAssistantDraft> 标签');
    }
    return String(matches[matches.length - 1][1] || '').trim();
}

function stripCodeFences_ACU(aiText: string) {
    // 剥离 ```json / ``` 围栏（含开头 ```json 行与结尾 ``` 行），仅用于标签与兜底 JSON 提取
    return String(aiText || '')
        .replace(/^[\s\S]*?```(?:json)?\s*/i, '')
        .replace(/\s*```[\s\S]*$/i, '');
}

/**
 * 容错兜底：从 AI 文本中截取"最后一个 { 到与之配对的最后一个 }"之间的子串尝试解析。
 * 仅作 JSON.parse 的兜底输入；解析成功仍须通过 validateTemplateAssistantDraft_ACU 的完整协议校验，
 * 不放宽任何协议闸门。为避免"最后一个 {" 落在字符串字面量内部导致误切，
 * 从后往前枚举所有候选起始点，取第一个能配对闭合且 JSON.parse 成功的子串。
 */
function extractFallbackDraftJson_ACU(aiText: string) {
    const text = String(aiText || '');
    const candidates: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '{') candidates.push(i);
    }
    for (let k = candidates.length - 1; k >= 0; k -= 1) {
        const start = candidates[k];
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < text.length; i += 1) {
            const ch = text[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') {
                inString = true;
            } else if (ch === '{') {
                depth += 1;
            } else if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    const candidate = text.slice(start, i + 1);
                    try {
                        JSON.parse(candidate);
                        return candidate;
                    } catch {
                        break; // 该候选解析失败，尝试更早的 {
                    }
                }
            }
        }
    }
    throw new Error('AI 响应中的 JSON 对象未闭合（缺少匹配的 } ）');
}

export function parseTemplateAssistantDraft_ACU(aiText: string): TemplateAssistantDraft_ACU {
    let jsonText: string;
    try {
        jsonText = getLastTaggedDraftText_ACU(aiText);
    } catch (tagError: any) {
        // 容错链：先剥离 ```json 围栏再找标签；仍未找到则尝试截取首尾大括号 JSON。
        // 无论哪条路径成功，后续仍走 validateTemplateAssistantDraft_ACU 完整协议校验。
        try {
            jsonText = getLastTaggedDraftText_ACU(stripCodeFences_ACU(aiText));
        } catch (fenceError: any) {
            jsonText = extractFallbackDraftJson_ACU(aiText);
        }
    }
    let parsed: any = null;
    try {
        parsed = JSON.parse(jsonText);
    } catch (error: any) {
        const wrapped = new Error(`assistant draft JSON 解析失败: ${error?.message || '未知错误'}`);
        (wrapped as any).failureKind = 'parse';
        throw wrapped;
    }
    try {
        return validateTemplateAssistantDraft_ACU(parsed);
    } catch (error: any) {
        const wrapped = new Error(error?.message || 'assistant draft 校验失败');
        (wrapped as any).failureKind = 'validate';
        throw wrapped;
    }
}

function validatePatchSheetBoundary_ACU(op: any, selectedSheetKey: string, currentSheetKey: string | null, protocolVersion: 1 | 2) {
    if (protocolVersion !== 1) return;
    if (op.sheetKey !== selectedSheetKey) {
        throw new Error(`${op.op} 的 sheetKey 必须与 draft.selectedSheetKey 一致`);
    }
    if (currentSheetKey && op.sheetKey !== currentSheetKey) {
        throw new Error(`${op.op} 只能修改当前选中表`);
    }
}

function validateTemplateAssistantContentPatch_ACU(op: any) {
    const patch = op?.patch;
    const allowedKeys = new Set(['updateCells', 'addRows', 'deleteRows']);
    Object.keys(patch).forEach((key) => {
        if (!allowedKeys.has(key)) {
            throw new Error(`patch_sheet_content.patch 包含未知字段: ${key}`);
        }
    });

    const updateCells = patch?.updateCells;
    const addRows = patch?.addRows;
    const deleteRows = patch?.deleteRows;
    const hasAnyOperation =
        (Array.isArray(updateCells) && updateCells.length > 0)
        || (Array.isArray(addRows) && addRows.length > 0)
        || (Array.isArray(deleteRows) && deleteRows.length > 0);
    if (!hasAnyOperation) {
        throw new Error('patch_sheet_content 至少需要 updateCells、addRows、deleteRows 之一');
    }

    if (updateCells != null) {
        if (!Array.isArray(updateCells)) {
            throw new Error('patch_sheet_content.patch.updateCells 必须是数组');
        }
        updateCells.forEach((item: any, index: number) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`patch_sheet_content.patch.updateCells[${index}] 必须是对象`);
            }
            if (!Number.isInteger(item.rowNumber) || item.rowNumber <= 0) {
                throw new Error(`patch_sheet_content.patch.updateCells[${index}].rowNumber 必须是正整数`);
            }
            if (typeof item.columnName !== 'string' || !item.columnName.trim()) {
                throw new Error(`patch_sheet_content.patch.updateCells[${index}].columnName 必须是非空字符串`);
            }
            if (!Object.prototype.hasOwnProperty.call(item, 'value')) {
                throw new Error(`patch_sheet_content.patch.updateCells[${index}].value 缺失`);
            }
        });
    }

    if (addRows != null) {
        if (!Array.isArray(addRows)) {
            throw new Error('patch_sheet_content.patch.addRows 必须是数组');
        }
        addRows.forEach((item: any, index: number) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`patch_sheet_content.patch.addRows[${index}] 必须是对象`);
            }
        });
    }

    if (deleteRows != null) {
        if (!Array.isArray(deleteRows)) {
            throw new Error('patch_sheet_content.patch.deleteRows 必须是数组');
        }
        deleteRows.forEach((rowNumber: any, index: number) => {
            if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
                throw new Error(`patch_sheet_content.patch.deleteRows[${index}] 必须是正整数`);
            }
        });
    }
}

function assertTemplateAssistantPlainObject_ACU(value: unknown, path: string): asserts value is Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error(`${path} 必须是普通对象`);
    }
}

function assertTemplateAssistantAllowedKeys_ACU(value: Record<string, any>, allowedKeys: string[], path: string) {
    const allowedKeySet = new Set(allowedKeys);
    Object.keys(value).forEach((key) => {
        if (!allowedKeySet.has(key)) {
            throw new Error(`${path} 包含未知字段: ${key}`);
        }
    });
}

function assertTemplateAssistantNonEmptyString_ACU(value: unknown, path: string) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${path} 必须是非空字符串`);
    }
}

function validateTemplateAssistantMigrationLiteral_ACU(value: unknown, path: string) {
    assertTemplateAssistantPlainObject_ACU(value, path);
    assertTemplateAssistantAllowedKeys_ACU(value, ['kind', 'sql', 'value'], path);
    const kind = value.kind;
    if (!['null', 'integer', 'real', 'string', 'blob', 'boolean'].includes(kind)) {
        throw new Error(`${path}.kind 不受支持: ${String(kind)}`);
    }
    if (kind === 'null') {
        if (value.sql !== 'NULL' || value.value !== null) {
            throw new Error(`${path} 的 null literal 必须使用 sql="NULL" 且 value=null`);
        }
        return;
    }
    if (kind === 'boolean') {
        if ((value.sql !== 'TRUE' && value.sql !== 'FALSE') || typeof value.value !== 'boolean') {
            throw new Error(`${path} 的 boolean literal 必须使用 TRUE/FALSE SQL 和 boolean value`);
        }
        return;
    }
    if (typeof value.sql !== 'string' || !value.sql.trim()) {
        throw new Error(`${path}.sql 必须是非空字符串`);
    }
    if ((kind === 'integer' || kind === 'real') && (typeof value.value !== 'number' || !Number.isFinite(value.value))) {
        throw new Error(`${path}.${kind} literal 的 value 必须是有限数字`);
    }
    if ((kind === 'string' || kind === 'blob') && typeof value.value !== 'string') {
        throw new Error(`${path}.${kind} literal 的 value 必须是字符串`);
    }
}

function validateTemplateAssistantMigrationIntent_ACU(value: unknown, path: string) {
    assertTemplateAssistantPlainObject_ACU(value, path);
    assertTemplateAssistantAllowedKeys_ACU(value, ['physicalColumnMappings', 'fills', 'conversions', 'migrationPolicy'], path);
    if (!Array.isArray(value.physicalColumnMappings)) {
        throw new Error(`${path}.physicalColumnMappings 必须是数组`);
    }
    value.physicalColumnMappings.forEach((mapping: unknown, index: number) => {
        const mappingPath = `${path}.physicalColumnMappings[${index}]`;
        assertTemplateAssistantPlainObject_ACU(mapping, mappingPath);
        assertTemplateAssistantAllowedKeys_ACU(mapping, ['fromPhysicalName', 'toPhysicalName'], mappingPath);
        assertTemplateAssistantNonEmptyString_ACU(mapping.fromPhysicalName, `${mappingPath}.fromPhysicalName`);
        assertTemplateAssistantNonEmptyString_ACU(mapping.toPhysicalName, `${mappingPath}.toPhysicalName`);
    });
    assertTemplateAssistantPlainObject_ACU(value.fills, `${path}.fills`);
    Object.entries(value.fills).forEach(([physicalName, fill]) => {
        const fillPath = `${path}.fills.${physicalName}`;
        assertTemplateAssistantNonEmptyString_ACU(physicalName, `${path}.fills 的 physical column key`);
        assertTemplateAssistantPlainObject_ACU(fill, fillPath);
        assertTemplateAssistantAllowedKeys_ACU(fill, ['kind', 'literal'], fillPath);
        if (fill.kind !== 'literal' && fill.kind !== 'ddl_literal_default') {
            throw new Error(`${fillPath}.kind 不受支持: ${String(fill.kind)}`);
        }
        validateTemplateAssistantMigrationLiteral_ACU(fill.literal, `${fillPath}.literal`);
    });
    if (!Array.isArray(value.conversions)) {
        throw new Error(`${path}.conversions 必须是数组`);
    }
    value.conversions.forEach((conversion: unknown, index: number) => {
        const conversionPath = `${path}.conversions[${index}]`;
        assertTemplateAssistantPlainObject_ACU(conversion, conversionPath);
        assertTemplateAssistantAllowedKeys_ACU(conversion, ['fromPhysicalName', 'toPhysicalName', 'policy'], conversionPath);
        assertTemplateAssistantNonEmptyString_ACU(conversion.fromPhysicalName, `${conversionPath}.fromPhysicalName`);
        assertTemplateAssistantNonEmptyString_ACU(conversion.toPhysicalName, `${conversionPath}.toPhysicalName`);
        assertTemplateAssistantPlainObject_ACU(conversion.policy, `${conversionPath}.policy`);
        assertTemplateAssistantAllowedKeys_ACU(conversion.policy, ['kind'], `${conversionPath}.policy`);
        if (!['identity', 'stringify', 'integer_strict', 'real_strict'].includes(conversion.policy.kind)) {
            throw new Error(`${conversionPath}.policy.kind 不受支持: ${String(conversion.policy.kind)}`);
        }
    });
    assertTemplateAssistantPlainObject_ACU(value.migrationPolicy, `${path}.migrationPolicy`);
    assertTemplateAssistantAllowedKeys_ACU(value.migrationPolicy, ['destructiveChangeConfirmed', 'lossyConversionConfirmed'], `${path}.migrationPolicy`);
    if (typeof value.migrationPolicy.destructiveChangeConfirmed !== 'boolean' || typeof value.migrationPolicy.lossyConversionConfirmed !== 'boolean') {
        throw new Error(`${path}.migrationPolicy 必须提供 destructiveChangeConfirmed 和 lossyConversionConfirmed 两个 boolean`);
    }
}

function validateTemplateAssistantSchemaPatch_ACU(op: any) {
    const patch = op?.patch;
    const allowedKeys = new Set(['renameColumns', 'addColumns', 'deleteColumns', 'ddl', 'migrationIntent']);
    Object.keys(patch).forEach((key) => {
        if (!allowedKeys.has(key)) {
            throw new Error(`patch_sheet_schema.patch 包含未知字段: ${key}`);
        }
    });

    const renameColumns = patch?.renameColumns;
    const addColumns = patch?.addColumns;
    const deleteColumns = patch?.deleteColumns;
    const ddl = patch?.ddl;
    const hasAnyOperation =
        (Array.isArray(renameColumns) && renameColumns.length > 0)
        || (Array.isArray(addColumns) && addColumns.length > 0)
        || (Array.isArray(deleteColumns) && deleteColumns.length > 0)
        || (typeof ddl === 'string' && !!ddl.trim());
    if (!hasAnyOperation) {
        throw new Error('patch_sheet_schema 至少需要 renameColumns、addColumns、deleteColumns、ddl 之一');
    }

    if (renameColumns != null) {
        if (!Array.isArray(renameColumns)) {
            throw new Error('patch_sheet_schema.patch.renameColumns 必须是数组');
        }
        renameColumns.forEach((item: any, index: number) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`patch_sheet_schema.patch.renameColumns[${index}] 必须是对象`);
            }
            if (typeof item.from !== 'string' || !item.from.trim()) {
                throw new Error(`patch_sheet_schema.patch.renameColumns[${index}].from 必须是非空字符串`);
            }
            if (typeof item.to !== 'string' || !item.to.trim()) {
                throw new Error(`patch_sheet_schema.patch.renameColumns[${index}].to 必须是非空字符串`);
            }
        });
    }

    if (addColumns != null) {
        if (!Array.isArray(addColumns)) {
            throw new Error('patch_sheet_schema.patch.addColumns 必须是数组');
        }
        addColumns.forEach((item: any, index: number) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`patch_sheet_schema.patch.addColumns[${index}] 必须是对象`);
            }
            if (typeof item.name !== 'string' || !item.name.trim()) {
                throw new Error(`patch_sheet_schema.patch.addColumns[${index}].name 必须是非空字符串`);
            }
        });
    }

    if (deleteColumns != null) {
        if (!Array.isArray(deleteColumns)) {
            throw new Error('patch_sheet_schema.patch.deleteColumns 必须是数组');
        }
        deleteColumns.forEach((item: any, index: number) => {
            if (typeof item !== 'string' || !item.trim()) {
                throw new Error(`patch_sheet_schema.patch.deleteColumns[${index}] 必须是非空字符串`);
            }
        });
    }

    if (ddl != null && (typeof ddl !== 'string' || !ddl.trim())) {
        throw new Error('patch_sheet_schema.patch.ddl 必须是非空字符串');
    }
    if (patch?.migrationIntent != null) {
        validateTemplateAssistantMigrationIntent_ACU(patch.migrationIntent, 'patch_sheet_schema.patch.migrationIntent');
    }
}

function validateTemplateAssistantLockPatch_ACU(op: any) {
    const patch = op?.patch;
    const allowedKeys = new Set(['rows', 'columns', 'cells', 'specialIndexLocked']);
    Object.keys(patch).forEach((key) => {
        if (!allowedKeys.has(key)) {
            throw new Error(`patch_sheet_locks.patch 包含未知字段: ${key}`);
        }
    });

    const rows = patch?.rows;
    const columns = patch?.columns;
    const cells = patch?.cells;
    const hasAnyOperation =
        (Array.isArray(rows) && rows.length > 0)
        || (Array.isArray(columns) && columns.length > 0)
        || (Array.isArray(cells) && cells.length > 0)
        || typeof patch?.specialIndexLocked === 'boolean';
    if (!hasAnyOperation) {
        throw new Error('patch_sheet_locks 至少需要 rows、columns、cells、specialIndexLocked 之一');
    }

    if (rows != null) {
        if (!Array.isArray(rows)) {
            throw new Error('patch_sheet_locks.patch.rows 必须是数组');
        }
        rows.forEach((item: any, index: number) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`patch_sheet_locks.patch.rows[${index}] 必须是对象`);
            }
            if (!Number.isInteger(item.rowNumber) || item.rowNumber <= 0) {
                throw new Error(`patch_sheet_locks.patch.rows[${index}].rowNumber 必须是正整数`);
            }
            if (typeof item.locked !== 'boolean') {
                throw new Error(`patch_sheet_locks.patch.rows[${index}].locked 必须是布尔值`);
            }
        });
    }

    if (columns != null) {
        if (!Array.isArray(columns)) {
            throw new Error('patch_sheet_locks.patch.columns 必须是数组');
        }
        columns.forEach((item: any, index: number) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`patch_sheet_locks.patch.columns[${index}] 必须是对象`);
            }
            if (typeof item.columnName !== 'string' || !item.columnName.trim()) {
                throw new Error(`patch_sheet_locks.patch.columns[${index}].columnName 必须是非空字符串`);
            }
            if (typeof item.locked !== 'boolean') {
                throw new Error(`patch_sheet_locks.patch.columns[${index}].locked 必须是布尔值`);
            }
        });
    }

    if (cells != null) {
        if (!Array.isArray(cells)) {
            throw new Error('patch_sheet_locks.patch.cells 必须是数组');
        }
        cells.forEach((item: any, index: number) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`patch_sheet_locks.patch.cells[${index}] 必须是对象`);
            }
            if (!Number.isInteger(item.rowNumber) || item.rowNumber <= 0) {
                throw new Error(`patch_sheet_locks.patch.cells[${index}].rowNumber 必须是正整数`);
            }
            if (typeof item.columnName !== 'string' || !item.columnName.trim()) {
                throw new Error(`patch_sheet_locks.patch.cells[${index}].columnName 必须是非空字符串`);
            }
            if (typeof item.locked !== 'boolean') {
                throw new Error(`patch_sheet_locks.patch.cells[${index}].locked 必须是布尔值`);
            }
        });
    }

    if (patch?.specialIndexLocked != null && typeof patch.specialIndexLocked !== 'boolean') {
        throw new Error('patch_sheet_locks.patch.specialIndexLocked 必须是布尔值');
    }
}

export function validateTemplateAssistantDraft_ACU(draft: any): TemplateAssistantDraft_ACU {
    if (!draft || typeof draft !== 'object') {
        throw new Error('assistant draft 必须是对象');
    }
    if (draft.protocolVersion !== 1 && draft.protocolVersion !== 2 && draft.protocolVersion !== 3) {
        throw new Error('assistant draft.protocolVersion 必须为 1、2 或 3');
    }
    if (draft.protocolVersion === 3 && draft.mode !== 'single_sheet_full_replace') {
        throw new Error('assistant draft.mode 非法（v3 必须为 single_sheet_full_replace）');
    }
    if (draft.protocolVersion !== 3 && draft.mode !== 'modify_current_template_incremental') {
        throw new Error('assistant draft.mode 非法');
    }
    if (typeof draft.baseFingerprint !== 'string' || !draft.baseFingerprint.trim()) {
        throw new Error('assistant draft.baseFingerprint 缺失');
    }
    if (typeof draft.selectedSheetKey !== 'string' || !draft.selectedSheetKey.trim()) {
        throw new Error('assistant draft.selectedSheetKey 必须是非空字符串');
    }
    if (typeof draft.summary !== 'string') {
        throw new Error('assistant draft.summary 必须是字符串');
    }
    if (!Array.isArray(draft.warnings)) {
        throw new Error('assistant draft.warnings 必须是数组');
    }

    if (draft.protocolVersion === 3) {
        return validateTemplateAssistantDraftV3_ACU(draft);
    }

    const protocolVersion = draft.protocolVersion as 1 | 2;
    if (!Array.isArray(draft.operations)) {
        throw new Error('assistant draft.operations 必须是数组');
    }
    if (protocolVersion === 2) {
        if (typeof draft.requestId !== 'string' || !draft.requestId.trim()) {
            throw new Error('assistant draft.requestId 必须是非空字符串');
        }
        if (draft.atomic !== true) {
            throw new Error('assistant draft.atomic 目前必须为 true');
        }
    }

    draft.operations.forEach((op: any, index: number) => {
        if (!op || typeof op !== 'object') {
            throw new Error(`operations[${index}] 必须是对象`);
        }
        const opName = String(op.op || '');
        const allowedOps = new Set([
            'add_sheet',
            'rename_sheet',
            'delete_sheet',
            'move_sheet',
            'patch_sheet_source_data',
            'patch_sheet_update_config',
            'patch_sheet_export_config',
            'patch_global_injection_config',
            ...(protocolVersion === 2 ? ['patch_sheet_content', 'patch_sheet_schema', 'patch_sheet_locks'] : []),
        ]);
        if (!allowedOps.has(opName)) {
            throw new Error(`operations[${index}] 包含当前协议不支持的操作: ${opName}`);
        }
        if (opName === 'replace_sheet_schema') {
            throw new Error('当前协议禁止 replace_sheet_schema');
        }
        if (opName.startsWith('patch_sheet_')) {
            if (typeof op.sheetKey !== 'string' || !op.sheetKey) {
                throw new Error(`${opName} 缺少 sheetKey`);
            }
            if (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch)) {
                throw new Error(`${opName} 缺少合法 patch 对象`);
            }
        }
        if (opName === 'add_sheet') {
            validateSourceDataPayload_ACU(op.sourceData, 'add_sheet.sourceData');
        }
        if (opName === 'patch_sheet_source_data') {
            validateSourceDataPayload_ACU(op.patch, 'patch_sheet_source_data.patch');
        }
        if (opName === 'patch_sheet_content') {
            validateTemplateAssistantContentPatch_ACU(op);
        }
        if (opName === 'patch_sheet_schema') {
            validateTemplateAssistantSchemaPatch_ACU(op);
        }
        if (opName === 'patch_sheet_locks') {
            validateTemplateAssistantLockPatch_ACU(op);
        }
    });

    const normalizedBase = {
        protocolVersion,
        mode: 'modify_current_template_incremental' as const,
        baseFingerprint: draft.baseFingerprint,
        selectedSheetKey: String(draft.selectedSheetKey || ''),
        summary: String(draft.summary || ''),
        warnings: draft.warnings.map((item: any) => String(item ?? '')),
        operations: draft.operations.map((item: any) => clone_ACU(item)),
    };

    if (protocolVersion === 2) {
        return {
            ...normalizedBase,
            protocolVersion: 2,
            requestId: String(draft.requestId || ''),
            atomic: true,
        };
    }

    return {
        ...normalizedBase,
        protocolVersion: 1,
    };
}


/**
 * v3 draft 校验：单结果信封，禁止 operations[]、禁止多 action、禁止混用协议字段。
 * 只校验信封结构与字段类型；完整 Sheet 归一（content/DDL/row_id/行宽等）由 compiler 执行。
 */
function validateTemplateAssistantDraftV3_ACU(draft: any): TemplateAssistantDraftV3_ACU {
    if (draft.atomic !== true) {
        throw new Error('assistant draft.atomic 目前必须为 true');
    }
    if (typeof draft.requestId !== 'string' || !draft.requestId.trim()) {
        throw new Error('assistant draft.requestId 必须是非空字符串');
    }
    if (draft.operations !== undefined && !Array.isArray(draft.operations)) {
        throw new Error('v3 禁止 operations[]，必须使用单个 result');
    }
    if (draft.operations !== undefined && Array.isArray(draft.operations) && draft.operations.length > 0) {
        throw new Error('v3 禁止字段级 patch / operations[]，必须返回单个 result（replace/create/delete）');
    }
    if (draft.result === undefined || draft.result === null || typeof draft.result !== 'object' || Array.isArray(draft.result)) {
        throw new Error('assistant draft.result 必须存在且为对象');
    }
    const action = String(draft.result.action || '');
    if (action !== 'replace' && action !== 'create' && action !== 'delete') {
        throw new Error('v3 result.action 必须为 replace / create / delete 之一');
    }
    if (action === 'replace') {
        if (typeof draft.result.sheetKey !== 'string' || !draft.result.sheetKey.trim()) {
            throw new Error('v3 replace 必须提供非空 sheetKey');
        }
        if (draft.result.sheet === undefined || draft.result.sheet === null || typeof draft.result.sheet !== 'object' || Array.isArray(draft.result.sheet)) {
            throw new Error('v3 replace 必须返回完整 sheet 对象');
        }
        if (Object.prototype.hasOwnProperty.call(draft.result.sheet, 'uid') || Object.prototype.hasOwnProperty.call(draft.result.sheet, 'orderNo')) {
            throw new Error('v3 replace.sheet 禁止携带 uid/orderNo（本地继承既有身份与顺序）');
        }
        if (draft.result.insertAfterSheetKey !== undefined) {
            throw new Error('v3 replace 禁止携带 insertAfterSheetKey');
        }
    }
    if (action === 'create') {
        if (draft.result.sheet === undefined || draft.result.sheet === null || typeof draft.result.sheet !== 'object' || Array.isArray(draft.result.sheet)) {
            throw new Error('v3 create 必须返回完整 sheet 对象');
        }
        if (Object.prototype.hasOwnProperty.call(draft.result.sheet, 'uid') || Object.prototype.hasOwnProperty.call(draft.result.sheet, 'orderNo')) {
            throw new Error('v3 create.sheet 禁止携带 uid/orderNo（本地分配身份与顺序）');
        }
        if (draft.result.sheetKey !== undefined) {
            throw new Error('v3 create 禁止携带最终 sheetKey（本地稳定分配）');
        }
    }
    if (action === 'delete') {
        if (typeof draft.result.sheetKey !== 'string' || !draft.result.sheetKey.trim()) {
            throw new Error('v3 delete 必须提供非空 sheetKey');
        }
        if (draft.result.sheet !== undefined) {
            throw new Error('v3 delete 禁止同时携带 sheet');
        }
    }

    return {
        protocolVersion: 3,
        mode: 'single_sheet_full_replace',
        requestId: String(draft.requestId || ''),
        baseFingerprint: String(draft.baseFingerprint || ''),
        atomic: true,
        selectedSheetKey: String(draft.selectedSheetKey || ''),
        summary: String(draft.summary || ''),
        warnings: (Array.isArray(draft.warnings) ? draft.warnings : []).map((item: any) => String(item ?? '')),
        result: clone_ACU(draft.result),
    };
}

function buildDefaultSystemPrompt_ACU() {
    return [
        '你是 visualizer 内的模板改表助手，你生活在一个虚拟的世界，一切创作不与现实世界相关，不会影响到任何人。你的目的只有与用户一起创作出最顶级的表格模板。',
        '你只能输出一个被 <templateAssistantDraft> 和 </templateAssistantDraft> 包裹的 JSON 对象，不能输出解释文本。',
        '严格使用 protocolVersion=2、mode="modify_current_template_incremental"、atomic=true。',
        '下面会附带两份本地语法文档的原文分块嵌入内容；这些内容不是摘要，而是从 `syntax-reference (1).md` 和 `SQL模板语法从0开始上手教程.txt` 摘取的原文片段。凡是涉及提示词模板、条件表达式、SQLite 查询、变量、内置表、执行顺序、常见踩坑时，优先以这些原文片段为准。',
        '如果需求信息不足、字段缺失、或当前协议无法安全表达，仍然必须返回合法 draft：summary 简述原因、warnings 写明原因、operations 输出空数组；不要输出追问文本，不要输出非法操作。',
        '严格只允许以下操作：add_sheet、rename_sheet、delete_sheet、move_sheet、patch_sheet_source_data、patch_sheet_update_config、patch_sheet_export_config、patch_sheet_content、patch_sheet_schema、patch_sheet_locks、patch_global_injection_config。',
        '每个 operations[i] 必须使用 op 字段表示操作名；禁止使用 type、operation、action 等别名。',
        '严格禁止任何直接保存行为。',
        'add_sheet 必须同时提供非空 sheetName 和至少一个 headers 项；并且应尽量同时提供 sourceData.note、sourceData.initNode、sourceData.insertNode、sourceData.updateNode、sourceData.deleteNode；sheetName 缺失时不要猜名字，直接返回空 operations。',
        'add_sheet.sourceData 与 patch_sheet_source_data.patch 只允许 note、initNode、insertNode、updateNode、deleteNode 五个字段；禁止出现 ddl、sql、schema、createTable 等字段。',
        '新建表时，不要只给空壳。sourceData.note 要写清这张表记录什么、一行代表什么、是单行表还是多行表、各列含义、哪列可以作为稳定标识。sourceData.initNode/insertNode/updateNode/deleteNode 要写清何时初始化、何时新增、何时更新、何时删除。',
        '当用户只表达“新增某某表”但没有给出表头时，可以根据表名语义生成一组最小、合理、通用、可直接用于后续剧情更新的 headers；自定义表头尽量避免使用带 / 的列名；不要伪造数据行。',
        '物品/战利品/库存类表，优先考虑“物品名称、数量、描述/效果、类别、备注、来源/掉落来源”等能直接支撑后续更新的列；其中应至少包含一个稳定标识列。',
        '默认优先 add_sheet + 完整 sourceData，让新表立刻具备初始化/新增/更新/删除指引；除非用户明确要求 DDL、字段类型、约束或 SQLite 建表语句，否则不要主动输出 patch_sheet_schema.ddl。',
        '当用户对【已存在的表】明确要求 DDL、字段类型、约束或 SQLite 建表语句时，不得因为表已存在就返回空 operations；必须通过 patch_sheet_schema.patch.ddl 输出该表的 DDL。',
        '即使用户要求“顺便写 SQL/DDL”，也不要把 ddl 或 sql 塞进 add_sheet.sourceData；新建表时优先输出 headers + 合法的五段 sourceData。',
        '如果当前 headers 主要是中文，自定义 ddl 只有在你能提供英文/ASCII 物理列名，并用 `-- 中文表头` 注释按原顺序一一对应时才安全；除非用户明确要求并且已经给出可直接落地的列名方案，否则不要生成 ddl。',
        '示例 add_sheet：{"op":"add_sheet","sheetName":"角色关系表","headers":["角色A","角色B","关系","备注"]}。',
        '示例（库存/战利品类）add_sheet：{"op":"add_sheet","sheetName":"战利品表","headers":["物品名称","数量","描述/效果","类别"],"sourceData":{"note":"记录战利品条目，一行代表一种物品。","initNode":"当剧情或设定已经明确存在初始战利品时初始化。","insertNode":"出现新的战利品时新增。","updateNode":"已有战利品数量或状态变化时更新。","deleteNode":"战利品被清空、移除或失效时删除。"}}。',
        'patch_sheet_source_data 不能修改 ddl；DDL 只能通过 patch_sheet_schema.patch.ddl 修改。',
        '当前协议校验会逐列对比 patch_sheet_schema.patch.ddl 与当前 headers：ASCII/英文 headers 必须由同名物理列匹配；中文 headers 必须使用英文/ASCII 物理列名，并用 `-- 中文表头` 注释匹配。第一列必须是 row_id INTEGER PRIMARY KEY。',
        '正确示例（中文 headers）：CREATE TABLE loot_table ( -- 战利品表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT, -- 物品名称\n  quantity INTEGER, -- 数量\n  time_span TEXT NOT NULL, -- 时间跨度\n  remarks TEXT -- 备注\n);',
        '即使是 row_id INTEGER PRIMARY KEY 这一行，也必须保留 `-- 行号` 注释，不能省略。',
        '错误示例：CREATE TABLE loot_table (\n  row_id INTEGER PRIMARY KEY,\n  物品名称 TEXT,\n  数量 INTEGER\n); 这种把中文表头直接写成物理列名的 ddl 会被拒绝；即使再写 `-- 物品名称` 这类同名注释也不合法。',
        '不要为刚 add_sheet 的新表生成依赖真实 sheetKey 的 follow-up patch 来补 DDL 或 starter rows；当前同一份 draft 无法可靠引用尚未落地的新表。',
        'patch_sheet_content.patch 只允许使用 updateCells、addRows、deleteRows；其中 rowNumber 必须使用 1-based 行号，列使用 columnName。',
        'patch_sheet_schema.patch 只允许使用 renameColumns、addColumns、deleteColumns、ddl、migrationIntent；migrationIntent 仅用于明确声明无法由 V1 安全子集表达的 schema migration 契约，不能替代实际 schema 修改。',
        'migrationIntent 必须完整提供 physicalColumnMappings（每项 {fromPhysicalName,toPhysicalName}）、fills、conversions、migrationPolicy（{destructiveChangeConfirmed,lossyConversionConfirmed}）。physical rename 示例：{"physicalColumnMappings":[{"fromPhysicalName":"name","toPhysicalName":"item_name"}],"fills":{},"conversions":[],"migrationPolicy":{"destructiveChangeConfirmed":false,"lossyConversionConfirmed":false}}。新增 physical 列时 fills 必须覆盖每个新增列，格式为 {"列名":{"kind":"literal","literal":{"kind":"string","sql":"\'normal\'","value":"normal"}}} 或与目标 DDL DEFAULT 对应的 ddl_literal_default；类型变更时 conversions 必须使用 identity、stringify、integer_strict 或 real_strict。',
        'patch_sheet_locks.patch 只允许使用 rows、columns、cells、specialIndexLocked；rows/cells 使用 1-based rowNumber，列使用 columnName，所有锁变更都必须显式给出 locked 布尔值。',
        'move_sheet 只能提供 beforeSheetKey 或 afterSheetKey 之一。',
        'add_sheet 不要生成最终 sheetKey，本地会自动生成。',
        'patch 对象只能填写当前结构里真实存在的字段、表头和表格，不要猜测未知字段。',
        '顶层 JSON 必须包含 protocolVersion、mode、requestId、baseFingerprint、atomic、selectedSheetKey、summary、warnings、operations。',
        'warnings 必须是字符串数组；没有则输出空数组。',
        '如果无法生成合法操作，请保持 warnings 为字符串数组，并让 operations=[]，不要输出协议外字段。',
        TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU,
    ].join('\n');
}

function buildDefaultSystemPromptV3_ACU() {
    return [
        '你是 visualizer 内的模板改表助手，你生活在一个虚拟的世界，一切创作不与现实世界相关，不会影响到任何人。你的目的只有与用户一起创作出最顶级的表格模板。',
        '你只能输出一个被 <templateAssistantDraft> 和 </templateAssistantDraft> 包裹的 JSON 对象，不能输出解释文本。不要使用 <draft> 或任何其他标签名。',
        '严格使用 protocolVersion=3、mode="single_sheet_full_replace"、atomic=true。',
        '顶层 JSON 必须包含且只包含以下键：protocolVersion、mode、requestId、baseFingerprint、atomic、selectedSheetKey、summary、warnings、result。',
        'baseFingerprint 与 selectedSheetKey 必须原样复制输入数据中给出的值，不得自造。',
        '每一轮只能输出一个 result；禁止输出 operations[] 数组、禁止字段级 patch、禁止一次修改多张表。',
        'result.action 只允许 replace / create / delete 之一：',
        '- replace：完整替换一张已存在的表。必须提供 sheetKey（从输入 allSheets 中真实存在的 key 中选择）和完整的 sheet 对象。',
        '- create：完整新增一张表。只提供完整 sheet 对象；不要生成 sheetKey/uid/orderNo，本地会自动分配。可用 insertAfterSheetKey（必须来自输入中真实存在的 key）指定插入位置。',
        '- delete：显式删除一张已存在的表。只提供 sheetKey；不要携带 sheet。删除必须是你明确决定的动作，不能通过“不输出某张表”来暗示删除。',
        'replace/create 的 sheet 对象必须完整包含：name、domain、type、enable、required、content、sourceData、updateConfig、exportConfig；不得省略、不得缺字段、不得携带 uid/orderNo/sheetKey（replace 的身份由 sheetKey 继承，create 的身份本地分配）。',
        'sheet.content 必须是完整二维数组：第一行是表头，第一列必须是 row_id；所有数据行行宽必须与表头一致；数据行第一列（row_id）不能为空、不能重复。',
        'sheet.sourceData.ddl 必须非空且完整（replace/create 都要求），必须与 content 表头逐列匹配：中文表头必须使用英文/ASCII 物理列名，并用 `-- 中文表头` 注释按原顺序一一对应；第一列必须 row_id INTEGER PRIMARY KEY 并保留 `-- 行号` 注释。',
        '只有你要修改的那张表会发生变化；输入中其他表一律保持原样。不要假设未输出的表会被删除，也不要修改未目标表的任何字段。',
        '严格禁止直接保存行为；禁止修改全局注入配置（globalInjectionConfig）；禁止删除/重建 row_id 列。',
        '如果需求信息不足、字段缺失、或当前协议无法安全表达，仍然必须返回合法 draft：summary 简述原因、warnings 写明原因、result 输出 {action:"replace", sheetKey:"<真实存在的key>", sheet:{...完整原样...}}；不要输出追问文本，不要输出非法操作。',
        'warnings 必须是字符串数组；没有则输出空数组。',
        TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU,
    ].join('\n');
}

/**
 * AI 改表助手「核心协议卡」：短路由表 + 防误操作边界。
 *
 * 与 buildDefaultSystemPrompt_ACU 的区别：默认提示词面向「无自定义 segments」
 * 的存量路径（字节级兼容），核心协议卡面向「已保存自定义提示词」的兼容注入——
 * 旧自定义提示词缺新协议规则时，由 resolveAssistantSystemPrompt_ACU 自动追加，
 * 不覆盖用户内容、不改变 pinned 消息顺序。
 *
 * 能力标记：以固定文本指纹 `[ACU 改表助手核心协议]` 判定是否已注入，
 * 已注入则跳过追加（幂等）。该标记不进入 AI 上下文（追加时保留在内容中，
 * 作为可读锚点，模型可据此理解协议边界）。
 */
export const TEMPLATE_ASSISTANT_CORE_PROTOCOL_MARKER_ACU = '[ACU 改表助手核心协议]';

export function buildCoreProtocolCard_ACU(): string {
    return [
        TEMPLATE_ASSISTANT_CORE_PROTOCOL_MARKER_ACU,
        '【操作路由】按用户意图选择唯一操作，不要跨层混写：',
        '- 只改更新频率/上下文深度/批处理/分组/跳层 → patch_sheet_update_config（只填变更字段，不生成 content/schema/sourceData）',
        '- 改 Note/Init/Insert/Update/Delete 说明 → patch_sheet_source_data（只允许 note/initNode/insertNode/updateNode/deleteNode 五字段，禁止 ddl/sql/schema/createTable）',
        '- 改单元格/行数据 → patch_sheet_content（updateCells/addRows/deleteRows，rowNumber 1-based，列用 columnName）',
        '- 改显示表头/列结构 → patch_sheet_schema（renameColumns/addColumns/deleteColumns；只改中文显示表头用 renameColumns，不输出 headers 字段）',
        '- DDL → 仅在用户明确要求字段类型/约束/SQLite 建表语句时用 patch_sheet_schema.patch.ddl；中文表头必须英文/ASCII 物理列名 + `-- 中文表头` 注释一一对应，第一列 row_id INTEGER PRIMARY KEY',
        '- 锁/全局注入 → patch_sheet_locks / patch_global_injection_config',
        '',
        '【防误操作边界】',
        '- 只改更新频率时，禁止顺带输出 updateNode、headers、DDL 或 content patch（示例：仅 {"op":"patch_sheet_update_config","sheetKey":"<目标表 sheetKey>","patch":{"updateFrequency":60}}）',
        '- 只改显示表头时，用 renameColumns，禁止输出 headers 字段；本地会自动同步既有 DDL 注释',
        '- 同时改表头与 Note 时，输出两个独立 operation（一个 patch_sheet_schema.renameColumns + 一个 patch_sheet_source_data.note）',
        '- 物理列名迁移与显示名改名是两件事：只有明确要求物理迁移才输出 migrationIntent，且必须完整提供 physicalColumnMappings/fills/conversions/migrationPolicy',
        '- 涉及未知表/未知列/删除/类型转换/物理迁移/row_id/DDL 不一致时，不猜测；返回 warnings 说明 + operations=[]',
        '- 需求信息不足时仍必须返回合法 draft：summary 简述、warnings 写明、operations=[]，禁止输出追问文本',
    ].join('\n');
}

export function buildCoreProtocolCardV3_ACU(): string {
    return [
        TEMPLATE_ASSISTANT_CORE_PROTOCOL_MARKER_ACU,
        '【v3 单表完整替换协议】默认协议，每轮只输出一个 result：',
        '- 顶层 JSON 只含 protocolVersion=3、mode="single_sheet_full_replace"、requestId、baseFingerprint、atomic、selectedSheetKey、summary、warnings、result。',
        '- result.action 只允许 replace / create / delete 之一；禁止 operations[]、禁止字段级 patch、禁止一次改多张表。',
        '- replace：完整替换一张已存在表。必须提供 sheetKey（输入中真实存在的 key）和完整 sheet（name/domain/type/enable/required/content/sourceData/updateConfig/exportConfig 全量）。',
        '- create：完整新增一张表。只提供完整 sheet；不要生成 sheetKey/uid/orderNo（本地分配）。可用 insertAfterSheetKey（真实存在的 key）指定插入位置。',
        '- delete：显式删除一张已存在表。只提供 sheetKey；禁止通过「不输出某张表」暗示删除。',
        '- content 首列必须 row_id 且非空不重复；sourceData.ddl 必须非空并与表头逐列匹配（中文表头用英文/ASCII 物理列名 + `-- 中文表头` 注释）。',
        '- 未目标表保持原样；禁止修改全局注入配置；禁止删除/重建 row_id 列。',
        '- 信息不足时仍返回合法 draft：summary 简述、warnings 写明、result 输出完整原样 replace；禁止输出追问文本或非法操作。',
    ].join('\n');
}


/**
 * 解析 assistant 系统提示词：
 * - segments 为空（settings 无自定义或全空）→ 使用默认提示词（与旧硬编码一致，含占位符）。
 * - 每个卡片按 {role, content} 生成消息；content 中的占位符在运行时替换为签名映射的值。
 * - 若没有任何卡片包含占位符，则在最后一个 SYSTEM 卡末尾自动追加引用文档（防呆，避免用户删掉占位符后引用静默丢失）。
 * - 默认回退路径的 role 输出小写 'system'，与旧版 buildTemplateAssistantMessages_ACU 的消息结构字节级一致，
 *   保证存量用户（settings 无 templateAssistantPromptSegments）发送给 AI 的 messages 完全不变。
 *   自定义 segments 路径保留用户选择的 role 大小写（SYSTEM/USER/assistant），
 *   该路径仅被主动编辑过提示词的用户触发，不涉及存量兼容。
 *
 * 占位符 `$1`-`$4` 语义见 TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU。valueMap 缺失的 key
 * 保留原 token 字面量（不替换为空串），用户可从提示词直观看到「这个占位符没生效」。
 */
export function resolveAssistantSystemPrompt_ACU(
    segments?: TemplateAssistantPromptSegment_ACU[] | null,
    valueMap?: Record<string, string> | null,
    protocolVersion: 2 | 3 = 3,
): Array<{ role: string; content: string }> {
    const normalized = normalizeAssistantPromptSegments_ACU(segments);
    if (normalized.length === 0) {
        const referenceText = buildTemplateAssistantEmbeddedReferenceText_ACU();
        const defaultPrompt = protocolVersion === 3 ? buildDefaultSystemPromptV3_ACU() : buildDefaultSystemPrompt_ACU();
        const defaultContent = defaultPrompt.replace(
            TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU,
            referenceText,
        );
        return [{ role: 'system', content: defaultContent }];
    }
    const cards = normalized;
    const referenceText = buildTemplateAssistantEmbeddedReferenceText_ACU();
    const effectiveValueMap =
        valueMap && typeof valueMap === 'object'
            ? valueMap
            : { [TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU]: referenceText };
    const resolved = cards.map((seg) => ({
        role: seg.role,
        content: applyTemplateAssistantPlaceholders_ACU(seg.content, effectiveValueMap),
    }));
    const hasPlaceholder = cards.some((seg) =>
        String(seg.content || '').includes(TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU),
    );
    if (!hasPlaceholder && resolved.length > 0) {
        const lastSystemIndex = resolved.map((item) => item.role).lastIndexOf('SYSTEM');
        const targetIndex = lastSystemIndex >= 0 ? lastSystemIndex : resolved.length - 1;
        resolved[targetIndex] = {
            ...resolved[targetIndex],
            content: `${resolved[targetIndex].content}\n\n${referenceText}`,
        };
    }
    // 核心协议卡自动追加（兼容旧自定义提示词）：任何自定义 segments 若未包含
    // 核心协议标记，则把路由表追加到最后一个 SYSTEM 卡末尾。不改变用户消息顺序
    // （仅追加到 SYSTEM 卡内容），不覆盖用户编辑内容，幂等（已含标记则跳过）。
    // v2（含 v1 存量）追加 v2 路由卡；v3 追加 v3 单表完整替换卡。
    // 绝不能把 v2 的 patch_sheet_*/operations 术语注入 v3 上下文，反之亦然。
    if (resolved.length > 0) {
        const hasCoreProtocol = cards.some((seg) =>
            String(seg.content || '').includes(TEMPLATE_ASSISTANT_CORE_PROTOCOL_MARKER_ACU),
        );
        if (!hasCoreProtocol) {
            const lastSystemIndex = resolved.map((item) => item.role).lastIndexOf('SYSTEM');
            const targetIndex = lastSystemIndex >= 0 ? lastSystemIndex : resolved.length - 1;
            const coreCard = protocolVersion === 3
                ? buildCoreProtocolCardV3_ACU()
                : buildCoreProtocolCard_ACU();
            resolved[targetIndex] = {
                ...resolved[targetIndex],
                content: `${resolved[targetIndex].content}\n\n${coreCard}`,
            };
        }
    }
    return resolved;
}

/**
 * 产出改表助手 user payload 对象（8 个顶层键，constraints 内容冻结）。
 * 占位符 `$1`-`$4` 是这 8 个键的完备划分（见 TEMPLATE_ASSISTANT_PAYLOAD_PARTITION_ACU）。
 */
export function buildUserPromptPayload_ACU(
    input: TemplateAssistantGenerateInput_ACU,
    baseFingerprint: string,
    protocolVersion: 2 | 3 = 2,
): AnyRecord {
    const tempData = input.tempData;
    const includeDdl = protocolVersion === 3;
    return {
        userRequest: String(input.userRequest || '').trim(),
        baseFingerprint,
        selectedSheetKey: input.currentSheetKey || '',
        selectedSheet: getSelectedSheetSnapshot_ACU(tempData, input.currentSheetKey, { includeDdl }),
        sheetCount: buildSheetSummary_ACU(tempData).length,
        allSheets: buildDetailedSheetSnapshots_ACU(tempData, { includeDdl }),
        globalInjectionConfig: getGlobalInjectionConfigFromData_ACU(tempData, { ensureWriteBack: false }),
        constraints: {
            protocolVersion,
            requestIdRequired: protocolVersion === 2,
            atomicOnly: true,
            allowCrossSheetPatch: protocolVersion === 2,
            patchSourceDataForbidDdl: protocolVersion === 2,
            sourceDataAllowedKeys: [...TEMPLATE_ASSISTANT_SOURCE_DATA_ALLOWED_KEYS_ACU],
            addSheetSourceDataForbidDdl: protocolVersion === 2,
            allowStructuredContentPatch: protocolVersion === 2,
            allowStructuredSchemaPatch: protocolVersion === 2,
            allowStructuredLockPatch: protocolVersion === 2,
            contentPatchRowNumberBase: 1,
            lockPatchRowNumberBase: 1,
            preferRichSourceDataForAddSheet: protocolVersion === 2,
            defaultNoDdlForNewSheetUnlessExplicitlyRequested: protocolVersion === 2,
            ddlMustPreserveHeaderOrder: true,
            ddlChineseHeadersRequireCommentMapping: true,
            ddlChineseHeadersForbidChinesePhysicalNames: true,
            ddlPhysicalColumnNamesShouldBeAsciiWhenHeadersAreChinese: true,
            avoidSlashInNewCustomHeaders: protocolVersion === 2,
            cannotPatchNewSheetAfterAddInSameDraft: protocolVersion === 2,
            redactExistingSourceDataDdlFromSnapshots: protocolVersion === 2,
            ...(protocolVersion === 3
                ? {
                    singleSheetFullReplace: true,
                    singleResultEnvelope: true,
                    forbidFieldLevelPatch: true,
                    forbidGlobalConfigModification: true,
                    replaceRequiresCompleteSheetAndDdl: true,
                    createRequiresCompleteSheetAndDdl: true,
                    deleteRequiresExplicitAction: true,
                    missingUntargetedSheetsKeptUnchanged: true,
                    rowIdSetGuardEnabled: true,
                    rowIdReductionRequiresHighRiskConfirmation: true,
                    contextBudgetEnabled: true,
                }
                : {}),
        },
    };
}

/**
 * 占位符 → payload 键的完备划分（无重复、无遗漏）。
 * 测试据此断言四组字段名并集 === payload 键集，防止未来 payload 新增字段静默丢失。
 */
export const TEMPLATE_ASSISTANT_PAYLOAD_PARTITION_ACU = {
    [TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU]: ['userRequest'],
    [TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU]: ['selectedSheetKey', 'selectedSheet'],
    [TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU]: ['sheetCount', 'allSheets', 'globalInjectionConfig'],
    [TEMPLATE_ASSISTANT_PLACEHOLDER_PROTOCOL_ACU]: ['baseFingerprint', 'constraints'],
} as const;

/**
 * 由 payload 与语法参考文本构建占位符 valueMap。
 * 键为占位符 token，值为待替换进提示词的字符串。
 */
export function buildAssistantPlaceholderContext_ACU(
    payload: AnyRecord,
    referenceText: string,
): Record<string, string> {
    return {
        [TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU]: stringifyPlaceholderValue_ACU(payload.userRequest),
        [TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU]: stringifyPlaceholderValue_ACU({
            selectedSheetKey: payload.selectedSheetKey,
            selectedSheet: payload.selectedSheet,
        }),
        [TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU]: stringifyPlaceholderValue_ACU({
            sheetCount: payload.sheetCount,
            allSheets: payload.allSheets,
            globalInjectionConfig: payload.globalInjectionConfig,
        }),
        [TEMPLATE_ASSISTANT_PLACEHOLDER_PROTOCOL_ACU]: stringifyPlaceholderValue_ACU({
            baseFingerprint: payload.baseFingerprint,
            constraints: payload.constraints,
        }),
        [TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU]: referenceText,
    };
}

function buildUserPrompt_ACU(input: TemplateAssistantGenerateInput_ACU, baseFingerprint: string) {
    const protocolVersion = input.protocolVersion === 3 ? 3 : (input.protocolVersion === 2 ? 2 : 3);
    return safeJsonStringify_ACU(buildUserPromptPayload_ACU(input, baseFingerprint, protocolVersion), '{}');
}

function buildSessionRoundUserRequest_ACU(options: {
    userRequest: string;
    repairReason: string;
    protocolVersion?: 2 | 3;
}) {
    const chunks = [String(options.userRequest || '').trim()];
    if (options.repairReason) {
        const isV3 = options.protocolVersion === 3;
        chunks.push(
            '修复要求：上一轮 assistant 草稿未通过本地校验，原因是：'
            + `${options.repairReason}。`
            + '请只修复校验失败的那个 operation，不要重新生成整份复杂草稿；'
            + '不得改变需求中未提及的表与字段。'
            + (isV3
                ? '仍然只能输出合法 v3 draft JSON（protocolVersion=3、mode="single_sheet_full_replace"、atomic=true、含 requestId/baseFingerprint/selectedSheetKey，且只能有单个 result：replace/create/delete）。'
                : '只改更新频率时输出 patch_sheet_update_config；'
                + '只改显示表头时输出 patch_sheet_schema.renameColumns，不输出 headers 字段。'
                + '仍然只能输出合法 draft JSON（protocolVersion=2、atomic=true、含 requestId/baseFingerprint/selectedSheetKey）。'),
        );
    }
    return chunks.filter(Boolean).join('\n\n');
}

function getTemplateAssistantSessionAbortReason_ACU(guard?: TemplateAssistantSessionRunGuard_ACU | null): TemplateAssistantSessionAbortReason_ACU | null {
    if (guard?.isCancelled?.()) return 'cancelled';
    if (guard?.isStale?.()) return 'stale';
    return null;
}

function assertTemplateAssistantSessionActive_ACU(guard?: TemplateAssistantSessionRunGuard_ACU | null) {
    const stopReason = getTemplateAssistantSessionAbortReason_ACU(guard);
    if (stopReason) {
        throw new TemplateAssistantSessionStoppedError_ACU(stopReason);
    }
}

export function createTemplateAssistantSessionGuard_ACU(): TemplateAssistantSessionGuardController_ACU {
    let version = 0;
    let cancelled = false;
    let abortController: AbortController | null = null;
    return {
        createRunGuard() {
            const capturedVersion = version;
            return {
                isCancelled: () => cancelled,
                isStale: () => !cancelled && capturedVersion !== version,
                get signal() { return abortController?.signal ?? null; },
            };
        },
        invalidate() {
            version += 1;
            abortController?.abort();
            abortController = null;
        },
        cancel() {
            cancelled = true;
            version += 1;
            abortController?.abort();
            abortController = null;
        },
        reset() {
            cancelled = false;
            version += 1;
            abortController = null;
        },
        getSignal() {
            if (!abortController) {
                abortController = new AbortController();
            }
            return abortController.signal;
        },
    };
}

function buildTemplateAssistantNoopDraft_ACU(baseFingerprint: string, selectedSheetKey: string | null, summary = '', warnings: string[] = []): TemplateAssistantDraft_ACU {
    return {
        protocolVersion: 2,
        mode: 'modify_current_template_incremental',
        requestId: 'template-assistant-noop',
        baseFingerprint,
        atomic: true,
        selectedSheetKey: String(selectedSheetKey || ''),
        summary,
        warnings: warnings.map((item) => String(item ?? '')),
        operations: [],
    };
}

/**
 * v3 noop draft：与 v3 信封协议一致的空结果（无 result 时表示「无可应用变更」）。
 * 仅在 v3 会话全部失败、回退到空 diff 时使用，保证 finalDraft 的协议版本与输入一致。
 */
function buildTemplateAssistantNoopDraftV3_ACU(baseFingerprint: string, selectedSheetKey: string | null, summary = '', warnings: string[] = []): TemplateAssistantDraft_ACU {
    return {
        protocolVersion: 3,
        mode: 'single_sheet_full_replace',
        requestId: 'template-assistant-noop',
        baseFingerprint,
        atomic: true,
        selectedSheetKey: String(selectedSheetKey || ''),
        summary,
        warnings: warnings.map((item) => String(item ?? '')),
        // v3「无可应用变更」= 不携带 result；hasTemplateAssistantApplicableDraft_ACU 据此判定不可应用。
        // 该 draft 不会进入 validator（validator 只作用于 AI 输出），类型按信封宽限处理。
        result: undefined as unknown as TemplateAssistantV3Result_ACU,
    } as TemplateAssistantDraft_ACU;
}

/**
 * 判断 draft 是否包含「可应用的变更」，兼容 v1/v2 的 operations 与 v3 的 result 信封。
 * - v1/v2：operations 非空即视为有变更（与既有语义一致）。
 * - v3：必须有对象 result，且 action 是 replace/create/delete 之一；delete 是显式动作，同样视为可应用。
 * 供 generate/session/apply 链路统一使用，避免各调用点直接读 draft.operations 而破坏 v3。
 */
export function hasTemplateAssistantApplicableDraft_ACU(draft: any): boolean {
    if (!draft || typeof draft !== 'object') return false;
    if (draft.protocolVersion === 3) {
        const action = String(draft?.result?.action || '');
        return action === 'replace' || action === 'create' || action === 'delete';
    }
    return Array.isArray(draft.operations) && draft.operations.length > 0;
}

function assertTemplateAssistantDraftApplicable_ACU(draft: any) {
    if (!hasTemplateAssistantApplicableDraft_ACU(draft)) {
        throw new Error('assistant draft 不包含可应用的变更');
    }
}


export function getTemplateAssistantApplyBaselineFingerprint_ACU(result: TemplateAssistantGenerateResult_ACU | null | undefined) {
    const originalBaseFingerprint = String(result?.originalBaseFingerprint || '').trim();
    if (originalBaseFingerprint) {
        return originalBaseFingerprint;
    }
    if (Array.isArray(result?.rounds) || !!result?.session) {
        return '';
    }
    return String(result?.draft?.baseFingerprint || '').trim();
}

function emitTemplateAssistantRoundComplete_ACU(
    onRoundComplete: TemplateAssistantSessionRunInput_ACU['onRoundComplete'],
    round: TemplateAssistantSessionRound_ACU,
    rounds: TemplateAssistantSessionRound_ACU[],
    maxRounds: number,
) {
    if (typeof onRoundComplete !== 'function') return;
    try {
        onRoundComplete({
            round: clone_ACU(round),
            rounds: clone_ACU(rounds),
            maxRounds,
        });
    } catch (error: any) {
        logError_ACU('[TemplateAssistant] onRoundComplete 执行失败', {
            errorMessage: error?.message || '未知错误',
            round: round.round,
        });
    }
}

export async function generateTemplateAssistantDraft_ACU(input: TemplateAssistantGenerateInput_ACU): Promise<TemplateAssistantGenerateResult_ACU> {
    const tempData = asObject_ACU(input?.tempData);
    const userRequest = String(input?.userRequest || '').trim();
    if (!userRequest) {
        throw new Error('请输入改表需求');
    }
    if (!String(input?.currentSheetKey || '').trim()) {
        throw new Error('请先选中一个表后再使用 AI 改表助手');
    }
    const baseFingerprint = buildTemplateAssistantFingerprint_ACU(tempData);
    const messages = buildTemplateAssistantMessages_ACU({ ...input, tempData }, baseFingerprint);

    const overridePreset = String(input?.tableApiPreset || '').trim();
    let effectivePreset = overridePreset;
    if (!effectivePreset) {
        effectivePreset = settings_ACU.tableApiPreset || '';
        const currentSheet = input.currentSheetKey ? tempData[input.currentSheetKey] : null;
        const currentTableName = String(currentSheet?.name || '').trim();
        if (currentTableName) {
            const overrides = settings_ACU.tableApiPresetOverridesByName;
            if (overrides && typeof overrides === 'object' && typeof overrides[currentTableName] === 'string' && overrides[currentTableName].trim()) {
                effectivePreset = overrides[currentTableName].trim();
            }
        }
    }

    const aiRawText = input.guard?.signal
        ? await callAIWithPreset_ACU(messages, effectivePreset, undefined, input.guard.signal)
        : await callAIWithPreset_ACU(messages, effectivePreset);
    if (!aiRawText) {
        throw new Error('AI 未返回有效内容');
    }

    let draft: TemplateAssistantDraft_ACU;
    try {
        draft = parseTemplateAssistantDraft_ACU(aiRawText);
    } catch (error: any) {
        logError_ACU('[TemplateAssistant] draft 解析失败', {
            currentSheetKey: input.currentSheetKey,
            baseFingerprint,
            userRequest,
            errorMessage: error?.message || '未知错误',
            aiRawText,
        });
        const wrapped = new Error(error?.message || 'assistant draft 解析失败');
        // 转发内部已有的分类（validate 在 parseTemplateAssistantDraft_ACU 内部抛出），未标记则按 parse
        (wrapped as any).failureKind = error?.failureKind === 'validate' ? 'validate' : 'parse';
        (wrapped as any).failureRawText = aiRawText;
        throw wrapped;
    }

    // 协议一致性门禁：请求协议与 AI 输出协议必须一致。
    // 默认新会话为 v3；若 AI 在 v3 请求下返回 v2 草稿（或反之），说明提示词/模型未遵守信封，
    // 直接拒绝并归类为 validate，绝不静默混用两种协议的语义。
    const requestedProtocolVersion = input.protocolVersion === 2 ? 2 : 3;
    // 存量兼容：显式 v2 请求允许 v1 输出（v1/v2 共用 operations 语义），v3 请求只接受 v3。
    const protocolAccepted = requestedProtocolVersion === 3
        ? draft.protocolVersion === 3
        : draft.protocolVersion === 1 || draft.protocolVersion === 2;
    if (!protocolAccepted) {
        const wrapped = new Error(
            `AI 返回的协议版本 (${draft.protocolVersion}) 与请求的协议版本 (${requestedProtocolVersion}) 不一致`,
        );
        (wrapped as any).failureKind = 'validate';
        (wrapped as any).failureRawText = aiRawText;
        throw wrapped;
    }

    if (draft.baseFingerprint !== baseFingerprint) {
        const wrapped = new Error('AI 返回的 baseFingerprint 与当前结构不一致');
        (wrapped as any).failureKind = 'fingerprint';
        (wrapped as any).failureRawText = aiRawText;
        throw wrapped;
    }
    if (isTemplateAssistantV3Draft_ACU(draft)) {
        // v3 信封必须携带可应用的 result；validator 已保证 action 为 replace/create/delete 之一，这里兜底防御。
        assertTemplateAssistantDraftApplicable_ACU(draft);
    } else {
        draft.operations.forEach((op) => {
            if (String(op?.op || '').startsWith('patch_sheet_')) {
                validatePatchSheetBoundary_ACU(op, draft.selectedSheetKey, input.currentSheetKey, draft.protocolVersion);
            }
        });
        // v1/v2 空 operations 是合法结论（empty_operations），不在此抛错。
    }

    const compileResult = compileTemplateAssistantDraft_ACU({
        tempData,
        sheetOrder: input.sheetOrder,
        currentSheetKey: input.currentSheetKey,
        draft,
    });
    const preflight = await preflightSchemaMigrations_ACU({
        baselineData: tempData as any,
        candidateData: compileResult.candidateData as any,
        intents: compileResult.schemaMigrationIntents,
    });
    if (preflight.blockers.length > 0) {
        const wrapped = new Error(`schema migration preflight 失败：${preflight.blockers.join('；')}`);
        (wrapped as any).failureKind = 'preflight';
        (wrapped as any).failureRawText = aiRawText;
        throw wrapped;
    }

    return {
        draft,
        aiRawText,
        messages,
        compileResult,
    };
}

export async function runTemplateAssistantSession_ACU(input: TemplateAssistantSessionRunInput_ACU): Promise<TemplateAssistantSessionResult_ACU> {
    const tempData = asObject_ACU(input?.tempData);
    const currentSheetKey = String(input?.currentSheetKey || '').trim();
    const userRequest = String(input?.userRequest || '').trim();
    if (!userRequest) {
        throw new Error('请输入改表需求');
    }
    if (!currentSheetKey) {
        throw new Error('请先选中一个表后再使用 AI 改表助手');
    }

    const basePriorTurns = normalizePriorTurns_ACU(input?.priorTurns);
    // 改表助手是一问一答：无论有无历史，固定只跑 1 轮，不自动多轮续跑。
    // 用户每次提交需求只触发一次 AI 生成；AI 输出解析/校验失败时由 repairRetries 修正重试。
    const maxRounds = 1;
    const maxRepairRetries = normalizeNonNegativeInteger_ACU(input?.maxRepairRetries, DEFAULT_TEMPLATE_ASSISTANT_MAX_REPAIR_RETRIES_ACU);
    const originalTempData = clone_ACU(tempData);
    const originalSheetOrder = Array.isArray(input?.sheetOrder) ? [...input.sheetOrder] : null;
    const originalBaseFingerprint = buildTemplateAssistantFingerprint_ACU(originalTempData);
    const protocolVersion: 2 | 3 = input.protocolVersion === 2 ? 2 : 3;
    const rounds: TemplateAssistantSessionRound_ACU[] = [];
    const onRoundComplete = input?.onRoundComplete;

    let stopReason: TemplateAssistantSessionStopReason_ACU = 'success';
    let repairRetriesUsed = 0;
    let lastErrorMessage = '';
    let lastResult: TemplateAssistantGenerateResult_ACU | null = null;
    let lastFailure: TemplateAssistantFailureInfo_ACU | null = null;

    // 单轮执行：最多 maxRepairRetries 次「解析/校验失败 → 携带错误信息重试」。
    let repairReason = '';
    while (true) {
        assertTemplateAssistantSessionActive_ACU(input.guard);
        const roundUserRequest = buildSessionRoundUserRequest_ACU({
            userRequest,
            repairReason,
            protocolVersion,
        });
        try {
            const historyForRound = [
                ...basePriorTurns,
                ...rounds.map((item) => ({
                    user: item.userRequest,
                    assistant: item.aiRawText,
                })),
            ];
            const result = await generateTemplateAssistantDraft_ACU({
                tempData: originalTempData,
                currentSheetKey,
                sheetOrder: originalSheetOrder,
                userRequest: roundUserRequest,
                priorTurns: historyForRound,
                tableApiPreset: input.tableApiPreset,
                protocolVersion,
                guard: input.guard,
            });
            assertTemplateAssistantSessionActive_ACU(input.guard);
            lastResult = result;

            const roundRecord: TemplateAssistantSessionRound_ACU = {
                round: 1,
                userRequest: roundUserRequest,
                draft: result.draft,
                aiRawText: result.aiRawText,
                messages: result.messages,
                perRoundCompileResult: result.compileResult,
                workingFingerprint: buildTemplateAssistantFingerprint_ACU(result.compileResult.candidateData || originalTempData),
            };
            rounds.push(roundRecord);
            emitTemplateAssistantRoundComplete_ACU(onRoundComplete, roundRecord, rounds, maxRounds);
            // 单轮没有下一轮检查点：onRoundComplete 回调期间可能触发 cancel/stale，
            // 必须在收尾前显式确认会话仍然活动，否则停止按钮语义会退化。
            assertTemplateAssistantSessionActive_ACU(input.guard);

            // 单轮成功（无论是否产出可应用 operations）：一问一答结束。
            // 空 operations 表示 AI 认为无需修改，同样视为成功结论。
            lastFailure = null;
            lastErrorMessage = '';
            stopReason = hasTemplateAssistantApplicableDraft_ACU(result.draft) ? 'success' : 'empty_operations';
            break;
        } catch (error: any) {
            assertTemplateAssistantSessionActive_ACU(input.guard);
            lastErrorMessage = error?.message || '未知错误';
            // 环境失败（sql.js/wasm 引擎不可用，SqliteRuntimeUnavailableError_ACU）由
            // preflight/hydrate 直接上抛（见 schema-migration-preflight.ts T5）。
            // 它不是 AI 输出问题：重试不会改善、回喂 AI 无意义，必须单独分类并终止。
            const isEnvironmentFailure =
                error instanceof SqliteRuntimeUnavailableError_ACU
                || error?.failureKind === 'environment';
            const isContextBudgetFailure = error?.failureKind === 'context_budget';
            const failureKind: TemplateAssistantFailureKind_ACU =
                error?.failureKind === 'parse'
                || error?.failureKind === 'validate'
                || error?.failureKind === 'fingerprint'
                || error?.failureKind === 'preflight'
                || error?.failureKind === 'context_budget'
                    ? error.failureKind
                    : isEnvironmentFailure
                        ? 'environment'
                        : 'unknown';
            lastFailure = { kind: failureKind, message: lastErrorMessage, rawText: error?.failureRawText };
            if (isEnvironmentFailure) {
                // 环境失败：不可重试、不消耗 repairRetriesUsed、不把 sql.js 错误当修复上下文回喂 AI。
                stopReason = 'environment_failure';
                repairReason = '';
                break;
            }
            if (isContextBudgetFailure) {
                // 上下文预算超限：payload 本身超出协议上限，属于输入侧问题。
                // 重试只会再次超限、回喂 AI 无意义，必须不可重试、不消耗 repairRetriesUsed。
                stopReason = 'context_budget_failure';
                repairReason = '';
                break;
            }
            if (repairRetriesUsed >= maxRepairRetries) {
                stopReason = 'repair_retry_capped';
                break;
            }
            repairRetriesUsed += 1;
            repairReason = lastErrorMessage;
        }
    }

    // 单轮会话：rounds 恒为 0 或 1。
    // - 成功（rounds=1）：compileResult 直接取该轮结果，与 generateTemplateAssistantDraft_ACU 的语义一致。
    // - 全部失败（rounds=0）：无可用候选，回退到原始数据的空 diff。
    const compileResult = lastResult?.compileResult
        || buildTemplateAssistantCumulativeCompileResult_ACU({
            baselineData: originalTempData,
            baselineSheetOrder: originalSheetOrder,
            candidateData: originalTempData,
            candidateSheetOrder: originalSheetOrder,
            focusSheetKey: currentSheetKey,
        });
    const finalPreflight = await preflightSchemaMigrations_ACU({
        baselineData: originalTempData as any,
        candidateData: compileResult.candidateData as any,
        intents: compileResult.schemaMigrationIntents,
    });
    // 最终 preflight 为异步操作，返回后同样需要再次确认会话未被取消，才能提交成功结果。
    assertTemplateAssistantSessionActive_ACU(input.guard);
    if (finalPreflight.blockers.length > 0) throw new Error(`schema migration 最终 preflight 失败：${finalPreflight.blockers.join('；')}`);
    const v3RowIdGuardFindings = lastResult?.draft && isTemplateAssistantV3Draft_ACU(lastResult.draft)
        ? collectV3RowIdGuardFindings_ACU(originalTempData, compileResult.candidateData, currentSheetKey, String(input.userRequest || ''))
        : [];
    const finalDraft = lastResult?.draft
        || (protocolVersion === 3 ? buildTemplateAssistantNoopDraftV3_ACU(originalBaseFingerprint, currentSheetKey) : buildTemplateAssistantNoopDraft_ACU(originalBaseFingerprint, currentSheetKey));
    const finalWorkingFingerprint = buildTemplateAssistantFingerprint_ACU(compileResult.candidateData || originalTempData);

    return {
        draft: finalDraft,
        aiRawText: lastResult?.aiRawText || '',
        messages: lastResult?.messages || [],
        compileResult,
        originalBaseFingerprint,
        rounds,
        session: {
            originalBaseFingerprint,
            finalWorkingFingerprint,
            stopReason,
            roundsExecuted: rounds.length,
            maxRounds,
            repairRetriesUsed,
            maxRepairRetries,
            lastErrorMessage,
            lastFailure,
            ...(v3RowIdGuardFindings.length > 0 ? { v3RowIdGuardFindings } : {}),
        },
    };
}
