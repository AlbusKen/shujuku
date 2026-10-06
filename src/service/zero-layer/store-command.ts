import {
  ZERO_LAYER_SCHEMA_VERSION_ACU, ZeroLayerError_ACU,
  type ZeroLayerEnvelope_ACU, type ZeroLayerTurn_ACU, type ZeroLayerTurnPhase_ACU,
  type ZeroLayerEffectReceipt_ACU, type ZeroLayerTableInput_ACU, type ZeroLayerTableCandidate_ACU,
  type ZeroLayerPlotCandidate_ACU,
} from './model';
import type { ZeroLayerCarrierContext_ACU } from './carrier-context';
import type { TurnAttemptIdentity_ACU } from '../continuation/model';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import { transitionZeroLayerTurn_ACU, validateZeroLayerEnvelope_ACU, validateZeroLayerTableCandidate_ACU, validateZeroLayerPlotCandidate_ACU } from './validation';
import { applyZeroLayerCheckpointCommand_ACU, type ZeroLayerCheckpointCommand_ACU } from './checkpoint-command';
import { applyZeroLayerBridgeCommand_ACU, type ZeroLayerBridgeCommand_ACU } from './bridge-command';
import { assertBridgeSource_ACU, assertBridgeHostIdle_ACU } from './bridge-source';
import { applyZeroLayerBranchCommand_ACU, type ZeroLayerBranchCommand_ACU } from './branch-command';
import { suspendZeroLayerEnvelope_ACU } from './lifecycle-command';

export type ZeroLayerCommand_ACU =
  | { type: 'initialize'; apiPresetName: string }
  | { type: 'set-enabled'; enabled: boolean; apiPresetName?: string }
  | { type: 'prepare-turn'; turnId: string; attemptId: string; input: string;
      requiredEffects: ZeroLayerEffectReceipt_ACU['kind'][]; tableInput?: ZeroLayerTableInput_ACU;
      continuationIdentity?: TurnAttemptIdentity_ACU }
  | { type: 'transition-turn'; turnId: string; attemptId: string; phase: ZeroLayerTurnPhase_ACU;
      changes?: Pick<Partial<ZeroLayerTurn_ACU>, 'body' | 'effectReceipts' | 'errorCode'> }
  | { type: 'stage-table'; turnId: string; attemptId: string; candidate: ZeroLayerTableCandidate_ACU }
  | { type: 'prepare-plot'; turnId: string; attemptId: string; candidate: ZeroLayerPlotCandidate_ACU;
      receipt: ZeroLayerEffectReceipt_ACU }
  | { type: 'record-effect'; turnId: string; attemptId: string; receipt: ZeroLayerEffectReceipt_ACU;
      userData?: Record<string, unknown>; assistantData?: Record<string, unknown> }
  | ZeroLayerCheckpointCommand_ACU
  | ZeroLayerBridgeCommand_ACU
  | ZeroLayerBranchCommand_ACU;

function isPending_ACU(turn: ZeroLayerTurn_ACU): boolean {
  return !['published', 'cancelled', 'failed'].includes(turn.phase);
}

function containsEffectData_ACU(current: Record<string, unknown>, patch?: Record<string, unknown>): boolean {
  return patch === undefined || Object.entries(patch).every(([key, value]) =>
    Object.prototype.hasOwnProperty.call(current, key) && JSON.stringify(current[key]) === JSON.stringify(value));
}

/** 每个效果只增加自己的数据；禁止覆盖已确认的其他效果字段。 */
function mergeEffectData_ACU(current: Record<string, unknown>, patch?: Record<string, unknown>): Record<string, unknown> {
  const merged = structuredClone(current);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (Object.prototype.hasOwnProperty.call(merged, key) && JSON.stringify(merged[key]) !== JSON.stringify(value)) {
      throw new ZeroLayerError_ACU('revision-conflict', '效果数据与已保存字段冲突，拒绝覆盖。');
    }
    Object.defineProperty(merged, key, {
      value: structuredClone(value), enumerable: true, writable: true, configurable: true,
    });
  }
  return merged;
}
/** 只合并指定回合的效果；联合提交调用者必须随后校验完整 envelope。 */
export function mergeZeroLayerEffectReceipt_ACU(
  turn: ZeroLayerTurn_ACU,
  command: Extract<ZeroLayerCommand_ACU, { type: 'record-effect' }>,
): boolean {
  if (turn.turnId !== command.turnId || turn.attemptId !== command.attemptId || turn.phase !== 'response-durable') {
    throw new ZeroLayerError_ACU('invalid-transition', '效果只能提交到本次已保存正文的回合。');
  }
  const previous = turn.effectReceipts.find(item => item.kind === command.receipt.kind);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(command.receipt)
      || !containsEffectData_ACU(turn.userFloor.data, command.userData)
      || !containsEffectData_ACU(turn.assistantFloor.data, command.assistantData)) {
      throw new ZeroLayerError_ACU('revision-conflict', '已确认结算不能以不同回执或数据重复提交。');
    }
    return false;
  }
  const userData = mergeEffectData_ACU(turn.userFloor.data, command.userData);
  const assistantData = mergeEffectData_ACU(turn.assistantFloor.data, command.assistantData);
  turn.effectReceipts.push(structuredClone(command.receipt));
  turn.userFloor.data = userData;
  turn.assistantFloor.data = assistantData;
  turn.updatedAt = Math.max(Date.now(), turn.updatedAt);
  return true;
}
/** 纯命令处理；调用者不能整体替换 envelope 或改写旧 published 回合。 */
export function applyZeroLayerCommand_ACU(
  current: ZeroLayerEnvelope_ACU | null,
  command: ZeroLayerCommand_ACU,
  context: ZeroLayerCarrierContext_ACU,
  fingerprint: string,
): ZeroLayerEnvelope_ACU {
  if (command.type === 'initialize') {
    if (current) throw new ZeroLayerError_ACU('revision-conflict', '零层存档已存在，禁止覆盖初始化。');
    assertBridgeHostIdle_ACU();
    const branchId = crypto.randomUUID();
    return validateZeroLayerEnvelope_ACU({
      schemaVersion: ZERO_LAYER_SCHEMA_VERSION_ACU,
      sessionId: crypto.randomUUID(), carrierId: crypto.randomUUID(),
      scope: context.scope, carrierSwipeId: context.swipeId,
      seedBody: context.carrier.mes, activationFingerprint: fingerprint,
      activationMessageCount: context.chat.length, enabled: false,
      apiPresetName: command.apiPresetName, revision: 0,
      activeBranchId: branchId, branches: [{ branchId, headTurnId: null }], turns: [],
    });
  }
  if (!current) throw new ZeroLayerError_ACU('carrier-unavailable', '零层存档尚未初始化。');
  const candidate = validateZeroLayerEnvelope_ACU(current);
  if (command.type === 'fork-branch' || command.type === 'select-branch') {
    return validateZeroLayerEnvelope_ACU(applyZeroLayerBranchCommand_ACU(candidate, command));
  }
  if (command.type === 'begin-bridge' || command.type === 'advance-bridge') {
    return validateZeroLayerEnvelope_ACU(applyZeroLayerBridgeCommand_ACU(candidate, command, context));
  }
  if (command.type === 'stage-checkpoint' || command.type === 'activate-checkpoint' || command.type === 'clean-checkpoint') {
    return validateZeroLayerEnvelope_ACU(applyZeroLayerCheckpointCommand_ACU(candidate, command,
      context.chat as Record<string, unknown>[]));
  }
  if (command.type === 'set-enabled') {
    if (!command.enabled) return suspendZeroLayerEnvelope_ACU(candidate, command.apiPresetName);
    if (command.enabled) {
      const bridge = candidate.branches.find(branch => branch.branchId === candidate.activeBranchId)!.bridge;
      if (bridge?.phase !== 'reconciled') {
        throw new ZeroLayerError_ACU('effects-pending', '存量桥接尚未确认，禁止启用零层。');
      }
      // 显式重启保留 pending 原身份；prepare-turn 仍阻断新请求，只能恢复原持久阶段。
      assertBridgeSource_ACU(context.chat, bridge.sourceFingerprint);
    }
    candidate.enabled = command.enabled;
    if (command.apiPresetName !== undefined) candidate.apiPresetName = command.apiPresetName;
  } else {
    if (!candidate.enabled) throw new ZeroLayerError_ACU('mode-disabled', '零层模式未启用。');

    if (command.type === 'prepare-turn') {
      if (candidate.turns.some(isPending_ACU)) {
        throw new ZeroLayerError_ACU('pending-turn', '存在未结算回合，禁止启动另一次请求。');
      }
      const branch = candidate.branches.find(item => item.branchId === candidate.activeBranchId)!;
      const now = Date.now();
      candidate.turns.push({
        turnId: command.turnId, attemptId: command.attemptId,
        branchId: branch.branchId, parentTurnId: branch.headTurnId,
        input: command.input, body: null, phase: 'prepared', createdAt: now, updatedAt: now,
        userFloor: { floorId: crypto.randomUUID(), role: 'user', data: {} },
        assistantFloor: { floorId: crypto.randomUUID(), role: 'assistant', data: {} },
        requiredEffects: structuredClone(command.requiredEffects), effectReceipts: [], errorCode: null,
        materialBaseline: {
          continuation: structuredClone(branch.continuation ?? null),
          simulation: structuredClone(branch.simulation ?? null),
        },
        ...(command.tableInput ? { tableInput: structuredClone(command.tableInput) } : {}),
        ...(command.continuationIdentity ? { continuationIdentity: structuredClone(command.continuationIdentity) } : {}),
      });
    } else {
      const turn = candidate.turns.find(item => item.turnId === command.turnId);
      if (!turn || turn.attemptId !== command.attemptId || turn.branchId !== candidate.activeBranchId) {
        throw new ZeroLayerError_ACU('revision-conflict', '回合、尝试或活动分支身份不匹配。');
      }
      if (command.type === 'transition-turn') {
        const changes = command.changes ?? {};
        if (changes.body !== undefined && (command.phase !== 'response-durable' || turn.body !== null)) {
          throw new ZeroLayerError_ACU('invalid-transition', '正文只能在首次保存完整响应时写入。');
        }
        if (changes.effectReceipts !== undefined) {
          throw new ZeroLayerError_ACU('invalid-transition', '结算回执必须通过独立结算命令提交。');
        }
        return transitionZeroLayerTurn_ACU(candidate, turn.turnId, command.phase, changes);
      }
      if (command.type === 'prepare-plot') {
        validateZeroLayerPlotCandidate_ACU(command.candidate, turn.userFloor.floorId);
        const previous = turn.effectReceipts.find(item => item.kind === 'plot');
        if (turn.plotCandidate || previous) {
          if (!turn.plotCandidate || !previous
            || JSON.stringify(turn.plotCandidate) !== JSON.stringify(command.candidate)
            || JSON.stringify(previous) !== JSON.stringify(command.receipt)) {
            throw new ZeroLayerError_ACU('revision-conflict', '已保存剧情候选或回执不能被替换。');
          }
          return candidate;
        }
        if (turn.phase !== 'prepared' || command.receipt.kind !== 'plot'
          || command.receipt.status !== 'durable'
          || command.receipt.effectId !== `${turn.turnId}:${turn.attemptId}:plot`
          || command.receipt.fingerprint !== getTableDataFingerprint_ACU(command.candidate)) {
          throw new ZeroLayerError_ACU('invalid-transition', '剧情候选只能在正文发送前按本轮身份确认。');
        }
        turn.plotCandidate = structuredClone(command.candidate);
        turn.userFloor.data = mergeEffectData_ACU(turn.userFloor.data, {
          qrf_plot: command.candidate.content, qrf_plot_tasks: command.candidate.taskContents,
          qrf_plot_preset: command.candidate.presetName,
        });
        turn.effectReceipts.push(structuredClone(command.receipt));
        turn.updatedAt = Math.max(Date.now(), turn.updatedAt);
        candidate.revision += 1;
        return validateZeroLayerEnvelope_ACU(candidate);
      }
      if (turn.phase !== 'response-durable') {
        throw new ZeroLayerError_ACU('invalid-transition', '只允许对已保存完整响应的回合补结算。');
      }
      if (command.type === 'stage-table') {
        if (!turn.tableInput || turn.effectReceipts.some(receipt => receipt.kind === 'table')) {
          throw new ZeroLayerError_ACU('invalid-transition', '表格基底缺失或结算已确认，禁止改写候选。');
        }
        validateZeroLayerTableCandidate_ACU(command.candidate, turn.assistantFloor.floorId);
        const previous = turn.tableCandidate;
        if (previous && (previous.completedBucketIds.some(id => !command.candidate.completedBucketIds.includes(id))
          || Object.entries(previous.completedAiFloorBySheetKey).some(([key, floor]) =>
            (command.candidate.completedAiFloorBySheetKey[key] ?? -1) < floor))) {
          throw new ZeroLayerError_ACU('revision-conflict', '表格候选不能撤销已确认桶或覆盖前沿。');
        }
        if (previous && JSON.stringify(previous) === JSON.stringify(command.candidate)) return candidate;
        if (previous && command.candidate.completedBucketIds.length <= previous.completedBucketIds.length) {
          throw new ZeroLayerError_ACU('revision-conflict', '相同已确认桶集合不能提交不同候选。');
        }
        turn.tableCandidate = structuredClone(command.candidate);
        turn.updatedAt = Math.max(Date.now(), turn.updatedAt);
        candidate.revision += 1;
        return validateZeroLayerEnvelope_ACU(candidate);
      }
      if (!mergeZeroLayerEffectReceipt_ACU(turn, command)) return candidate;
    }
  }
  candidate.revision += 1;
  return validateZeroLayerEnvelope_ACU(candidate);
}
