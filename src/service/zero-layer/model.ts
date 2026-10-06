import type { TableDataObject_ACU } from '../../shared/models/table-data';
import type { ContinuationEnvelope_ACU, TurnAttemptIdentity_ACU } from '../continuation/model';
import type { AgentConversationFloorRecord_ACU, AgentModuleFloorFrame_ACU } from '../continuation/agent/agent-model';
import type { WorldSimulationEnvelope_ACU, WorldSimulationLedgerFieldSnapshot_ACU,
  WorldSimulationLogicalRef_ACU } from '../simulation/model';
import type { WorldChronicleArchiveSnapshot_ACU, WorldSimulationConversationFloorRecord_ACU,
  WorldSimulationRunStateRecord_ACU, WorldSimulationUserRequirementsSnapshot_ACU } from '../simulation/agent/agent-model';
import type { WorldSimulationRunWriteProof_ACU } from '../simulation/simulation-run-write-state';
import type { ZeroLayerCheckpointState_ACU } from './checkpoint-model';
import type { ZeroLayerBridgeState_ACU } from './bridge-model';
import type { ZeroLayerFloorRef_ACU } from './timeline';
import type { ZeroLayerExitManifest_ACU } from './exit-model';

/** 零层数据独占载体字段；正文与楼层 frame 不写入开场白 mes。 */
export const ZERO_LAYER_CARRIER_FIELD_ACU = '_acu_zero_layer_v1';
export const ZERO_LAYER_SCHEMA_VERSION_ACU = 1;

export type ZeroLayerTurnPhase_ACU = 'prepared' | 'dispatching' | 'response-durable'
  | 'effects-durable' | 'published' | 'cancelled' | 'failed' | 'delivery-unknown';

export interface ZeroLayerScope_ACU {
  chatId: string;
  characterKey: string;
}

export interface ZeroLayerEffectReceipt_ACU {
  effectId: string;
  kind: 'plot' | 'table' | 'continuation' | 'simulation';
  status: 'durable' | 'skipped-by-config';
  fingerprint: string;
}

export interface ZeroLayerFloor_ACU {
  floorId: string;
  role: 'user' | 'assistant';
  /** 楼层附属数据，后续由对应 frame Adapter 校验，不能冒充物理 messageIndex。 */
  data: Record<string, unknown>;
}

/** 可恢复的业务快照，不包含 API 凭据或 SQLite 请求级 schema descriptor。 */
export interface ZeroLayerTableInput_ACU {
  chatKey: string;
  isolationKey: string;
  storageMode: 'native' | 'sqlite';
  tableData: TableDataObject_ACU;
  templateData: TableDataObject_ACU;
  /** 已确认覆盖前沿；序号只用于逻辑时间线调度，不是物理下标。 */
  completedAiFloorBySheetKey: Record<string, number>;
  autoUpdateEnabled: boolean;
  /** 仅调度参数，不含 API 配置。 */
  scheduling?: { autoUpdateFrequency: number; skipUpdateFloors: number; autoUpdateThreshold: number; updateBatchSize: number };
}

export interface ZeroLayerTableResult_ACU {
  floorId: string;
  tableData: TableDataObject_ACU;
  completedAiFloorBySheetKey: Record<string, number>;
  filledSheetKeys: string[];
}

export interface ZeroLayerTableCandidate_ACU extends ZeroLayerTableResult_ACU {
  /** 每桶严格保存后登记；恢复时不得重复执行已确认的桶。 */
  completedBucketIds: string[];
}

/** 正文前确认的剧情结果；仅保存业务文本，不包含 API 配置。 */
export interface ZeroLayerPlotCandidate_ACU {
  floorId: string;
  presetName: string;
  outcome: 'generated' | 'no-tasks' | 'disabled';
  finalMessage: string | null;
  content: string;
  taskContents: Record<string, string>;
  /** 请求内装配好的正文世界书消息，不通过修改世界书启用状态注入。 */
  finalPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string; depth: number;
    position: 'before_character_definition' | 'after_character_definition' | 'at_depth' }>;
  /** 冻结原生提示词过滤目录；只用于请求内去重，不保存世界书状态。 */
  filterEntries: Array<{ content: string; comment: string }>;
  agentActive: boolean;
}

export interface ZeroLayerTurn_ACU {
  turnId: string;
  branchId: string;
  parentTurnId: string | null;
  attemptId: string;
  input: string;
  body: string | null;
  phase: ZeroLayerTurnPhase_ACU;
  createdAt: number;
  updatedAt: number;
  userFloor: ZeroLayerFloor_ACU;
  assistantFloor: ZeroLayerFloor_ACU;
  requiredEffects: ZeroLayerEffectReceipt_ACU['kind'][];
  effectReceipts: ZeroLayerEffectReceipt_ACU[];
  /** 正文开始前已确认的资料；在途工作状态不得作为公开资料展示。 */
  materialBaseline?: {
    continuation: ZeroLayerContinuationState_ACU | null;
    simulation: ZeroLayerSimulationState_ACU | null;
  };
  /** 发布提交中的不可变恢复素材；旧回合缺失时不得从当前工作状态推测。 */
  publishedMaterials?: ZeroLayerPublishedMaterialSnapshot_ACU;
  /** 旧回合缺失时不推测基底；表格补结算必须取得显式快照。 */
  tableInput?: ZeroLayerTableInput_ACU;
  tableCandidate?: ZeroLayerTableCandidate_ACU;
  plotCandidate?: ZeroLayerPlotCandidate_ACU;
  /** 与续写规划的完整尝试身份绑定；不是宿主生成序号或物理楼层号。 */
  continuationIdentity?: TurnAttemptIdentity_ACU;
  /** 仅错误码，不持久化上游载荷或鉴权信息。 */
  errorCode: string | null;
}

/** 分支独占的续写工作状态；只通过零层保存链提交，不写普通模式私有字段。 */
export interface ZeroLayerContinuationState_ACU {
  schemaVersion: 1;
  envelope: ContinuationEnvelope_ACU | null;
  /** 规划先于下一回合；工作基底独占当前分支，anchor 仅证明来源，不授予历史帧写权限。 */
  workingFrame?: {
    branchId: string;
    anchor: ZeroLayerFloorRef_ACU;
    payload: AgentModuleFloorFrame_ACU;
  };
  /** 复用资料帧的纯折叠格式；键为逻辑/宿主只读引用，不是物理写入位置。 */
  moduleFrames: Record<string, unknown>;
  conversation: AgentConversationFloorRecord_ACU;
  /** 已确认正文的完整引用，用于幂等确认与重载恢复。 */
  confirmed: Array<{ turnId: string; attemptId: string; floorId: string; continuationAttemptId: string }>;
}

/** 每轮不可变的推演交付；投影不改写正文或宿主消息。 */
export interface ZeroLayerSimulationResult_ACU {
  schemaVersion: 1;
  ref: WorldSimulationLogicalRef_ACU;
  outcome: 'commit' | 'no_change' | 'skipped-by-config';
  summary: string;
  ledger: WorldSimulationEnvelope_ACU['ledger'] | null;
  fields: WorldSimulationLedgerFieldSnapshot_ACU;
  archive: WorldChronicleArchiveSnapshot_ACU;
  projection: string | null;
}

/** 分支独占的推演权威快照；不存宿主分桶或物理下标。 */
export interface ZeroLayerSimulationState_ACU {
  schemaVersion: 1;
  envelope: WorldSimulationEnvelope_ACU | null;
  fields: WorldSimulationLedgerFieldSnapshot_ACU;
  archive: WorldChronicleArchiveSnapshot_ACU;
  conversation: WorldSimulationConversationFloorRecord_ACU;
  userRequirements: WorldSimulationUserRequirementsSnapshot_ACU;
  runState: WorldSimulationRunStateRecord_ACU | null;
  runProof: WorldSimulationRunWriteProof_ACU | null;
  /** 每个已结算逻辑正文的快照；恢复不靠物理历史推测。 */
  confirmed: Array<{ ref: WorldSimulationLogicalRef_ACU; ledgerRevision: number }>;
}

export interface ZeroLayerPublishedMaterialSnapshot_ACU {
  schemaVersion: 1;
  ref: Extract<ZeroLayerFloorRef_ACU, { kind: 'logical' }>;
  sourceRevision: number;
  table: ZeroLayerTableResult_ACU;
  continuation: ZeroLayerContinuationState_ACU;
  simulation: ZeroLayerSimulationState_ACU;
  /** 与工作帧分开保留，不能让未来 compaction 替代目标切点。 */
  checkpoints: ZeroLayerCheckpointState_ACU | null;
  fingerprint: string;
}

export interface ZeroLayerBranch_ACU {
  branchId: string;
  headTurnId: string | null;
  /** 共享前缀保留原身份；分支 lineage 不赋予旧回合新的 FloorRef。 */
  fork?: { sourceBranchId: string; headTurnId: string | null; sourceRevision: number };
  continuation?: ZeroLayerContinuationState_ACU;
  simulation?: ZeroLayerSimulationState_ACU;
  /** 逻辑位置、三类成员及唯一 active manifest 均在独立 carrier 内。 */
  checkpoints?: ZeroLayerCheckpointState_ACU;
  /** 存量首基线绑定启用切点，不属于任何新增正文回合。 */
  bridge?: ZeroLayerBridgeState_ACU;
}

export interface ZeroLayerEnvelope_ACU {
  schemaVersion: typeof ZERO_LAYER_SCHEMA_VERSION_ACU;
  sessionId: string;
  scope: ZeroLayerScope_ACU;
  carrierId: string;
  carrierSwipeId: number;
  seedBody: string;
  /** 启用时原物理历史的内容/角色/swipe 快照指纹，不含数据库私有字段。 */
  activationFingerprint: string;
  activationMessageCount: number;
  enabled: boolean;
  apiPresetName: string;
  revision: number;
  activeBranchId: string;
  branches: ZeroLayerBranch_ACU[];
  turns: ZeroLayerTurn_ACU[];
  /** 显式退出的保存意图与普通接入证明；不删除逻辑历史。 */
  exitManifest?: ZeroLayerExitManifest_ACU;
}

export type ZeroLayerErrorCode_ACU = 'chat-unavailable' | 'carrier-unavailable'
  | 'scope-changed' | 'source-changed' | 'corrupt-data' | 'unsupported-version'
  | 'revision-conflict' | 'invalid-transition' | 'mode-disabled'
  | 'pending-turn' | 'persist-failed' | 'persist-unknown' | 'effects-pending' | 'migration-conflict'
  | 'history-unavailable';

export class ZeroLayerError_ACU extends Error {
  constructor(readonly code: ZeroLayerErrorCode_ACU, message: string) {
    super(message);
    this.name = 'ZeroLayerError_ACU';
  }
}
