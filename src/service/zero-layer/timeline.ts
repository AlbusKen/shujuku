import type { ZeroLayerEnvelope_ACU, ZeroLayerScope_ACU, ZeroLayerTurn_ACU } from './model';
import { ZeroLayerError_ACU } from './model';
import { validateZeroLayerEnvelope_ACU } from './validation';
import { carrierSwipeId_ACU } from './carrier-context';

/** 物理位置与逻辑身份不能互换；物理定位只在同一源快照中有效。 */
export type ZeroLayerFloorRef_ACU =
  | { kind: 'host'; scope: ZeroLayerScope_ACU; sourceFingerprint: string;
      messageIndex: number; swipeId: number }
  | { kind: 'logical'; sessionId: string; branchId: string; turnId: string;
      floorId: string; role: 'user' | 'assistant' };

export interface ZeroLayerTimelineFloor_ACU {
  ref: ZeroLayerFloorRef_ACU;
  role: 'system' | 'user' | 'assistant';
  body: string;
  /** 系统与用户层不占已完成 AI 序号，候选响应也不占。 */
  aiOrdinal: number | null;
  data: Record<string, unknown>;
}

export interface ZeroLayerTimelineSnapshot_ACU {
  scope: ZeroLayerScope_ACU;
  sessionId: string;
  revision: number;
  branchId: string;
  headTurnId: string | null;
  floors: ZeroLayerTimelineFloor_ACU[];
  completedAiCount: number;
}

/** 只沿 head 的父链读取；取消、失败、其他分支及尚未发布响应均不注入。 */
export function getPublishedZeroLayerPath_ACU(envelope: ZeroLayerEnvelope_ACU): ZeroLayerTurn_ACU[] {
  const source = validateZeroLayerEnvelope_ACU(envelope);
  const branch = source.branches.find(item => item.branchId === source.activeBranchId)!;
  const turns = new Map(source.turns.map(turn => [turn.turnId, turn]));
  const path: ZeroLayerTurn_ACU[] = [];
  const seen = new Set<string>();
  let cursor = branch.headTurnId;
  while (cursor !== null) {
    const turn = turns.get(cursor);
    if (!turn || turn.phase !== 'published' || seen.has(cursor)) {
      throw new ZeroLayerError_ACU('corrupt-data', '逻辑历史父链无效。');
    }
    seen.add(cursor);
    path.push(turn);
    cursor = turn.parentTurnId;
  }
  return path.reverse();
}

/** 兼容旧只读历史处理器的字段投影；不会复制载体 envelope 或其他模块私有字段。 */
function historyData_ACU(message: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of ['qrf_plot', 'qrf_plot_tasks', 'qrf_plot_preset']) {
    if (message[key] !== undefined) data[key] = structuredClone(message[key]);
  }
  return data;
}

/** 固定物理前缀 + 所选分支已发布后缀；不把逻辑序号写入宿主物理字段。 */
export function buildZeroLayerTimeline_ACU(
  envelope: ZeroLayerEnvelope_ACU,
  physicalMessages: readonly Record<string, unknown>[],
): ZeroLayerTimelineSnapshot_ACU {
  const source = validateZeroLayerEnvelope_ACU(envelope);
  if (physicalMessages.length !== source.activationMessageCount) {
    throw new ZeroLayerError_ACU('source-changed', '物理历史长度与启用边界不一致。');
  }
  let completedAiCount = 0;
  const floors: ZeroLayerTimelineFloor_ACU[] = physicalMessages.map((message, messageIndex) => {
    if (!message || typeof message.mes !== 'string') {
      throw new ZeroLayerError_ACU('source-changed', '物理历史正文无效。');
    }
    const role = message.is_user === true ? 'user' : message.is_system === true ? 'system' : 'assistant';
    return {
      ref: { kind: 'host', scope: { ...source.scope }, sourceFingerprint: source.activationFingerprint,
        messageIndex, swipeId: carrierSwipeId_ACU(message) },
      role, body: message.mes, aiOrdinal: role === 'assistant' ? ++completedAiCount : null,
      data: historyData_ACU(message),
    };
  });
  for (const turn of getPublishedZeroLayerPath_ACU(source)) {
    for (const floor of [turn.userFloor, turn.assistantFloor]) {
      floors.push({
        ref: { kind: 'logical', sessionId: source.sessionId, branchId: turn.branchId,
          turnId: turn.turnId, floorId: floor.floorId, role: floor.role },
        role: floor.role, body: floor.role === 'user' ? turn.input : turn.body!,
        aiOrdinal: floor.role === 'assistant' ? ++completedAiCount : null,
        data: structuredClone(floor.data),
      });
    }
  }
  const branch = source.branches.find(item => item.branchId === source.activeBranchId)!;
  return {
    scope: { ...source.scope }, sessionId: source.sessionId, revision: source.revision,
    branchId: branch.branchId, headTurnId: branch.headTurnId, floors, completedAiCount,
  };
}

/** 请求级只读历史，兼容现有 seed/plot 读取；当前输入不是已完成楼层。 */
export function projectZeroLayerPromptHistory_ACU(
  snapshot: ZeroLayerTimelineSnapshot_ACU,
  currentInput?: string,
): Record<string, unknown>[] {
  const messages = snapshot.floors.map(floor => ({
    ...historyData_ACU(floor.data), mes: floor.body,
    is_user: floor.role === 'user', is_system: floor.role === 'system',
  }));
  if (currentInput !== undefined) {
    messages.push({ mes: currentInput, is_user: true, is_system: false });
  }
  return messages;
}

/** 交给酒馆已有历史装配入口；不自行拼接角色卡、世界书或预设。 */
export function projectZeroLayerHostPrompts_ACU(
  snapshot: ZeroLayerTimelineSnapshot_ACU,
): { role: ZeroLayerTimelineFloor_ACU['role']; content: string }[] {
  return snapshot.floors.map(floor => ({ role: floor.role, content: floor.body }));
}
