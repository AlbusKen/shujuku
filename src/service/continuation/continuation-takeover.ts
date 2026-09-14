import { ContinuationValidationError_ACU, createContinuationError_ACU, type ContinuationTakeoverAssessment_ACU } from './model';

const DISPOSITIONS_ACU = ['continue_current_stage', 'complete_current_stage', 'replace_current_stage'] as const;

function failTakeover_ACU(message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_PROTOCOL_INVALID', 'agent_loop', message, false, details));
}

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function indexes_ACU(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || !value.length) failTakeover_ACU(`${path} 必须是非空的正文楼层数组`);
  const result = value.map((item, index) => {
    if (!Number.isInteger(item) || item < 0) failTakeover_ACU(`${path}[${index}] 必须是非负整数`);
    return item as number;
  });
  if (new Set(result).size !== result.length) failTakeover_ACU(`${path} 不得重复`);
  return result;
}

function turnIds_ACU(value: unknown): string[] {
  if (!Array.isArray(value)) failTakeover_ACU('satisfiedTurnIds 必须是数组');
  const result = value.map((item, index) => {
    const id = typeof item === 'string' ? item.trim() : '';
    if (!id) failTakeover_ACU(`satisfiedTurnIds[${index}] 必须是非空字符串`);
    return id;
  });
  if (new Set(result).size !== result.length) failTakeover_ACU('satisfiedTurnIds 不得重复');
  return result;
}

/** 模型与 UI 都必须通过的接管评估闭合契约；连续前缀由持久化入口按当前大纲再次核验。 */
export function validateContinuationTakeoverAssessment_ACU(raw: unknown): ContinuationTakeoverAssessment_ACU {
  if (!isRecord_ACU(raw)) failTakeover_ACU('接管评估必须是 JSON 对象');
  const keys = ['targetMessageIndex', 'disposition', 'satisfiedTurnIds', 'evidenceMessageIndexes', 'requiresStoryArcRevision', 'reason'];
  for (const key of Object.keys(raw)) if (!keys.includes(key)) failTakeover_ACU(`接管评估包含未知字段：${key}`);
  for (const key of keys) if (!(key in raw)) failTakeover_ACU(`接管评估缺少字段：${key}`);
  const targetMessageIndex = typeof raw.targetMessageIndex === 'number' ? raw.targetMessageIndex : Number.NaN;
  if (!Number.isInteger(targetMessageIndex) || targetMessageIndex < 0) failTakeover_ACU('targetMessageIndex 必须是非负整数');
  const disposition = typeof raw.disposition === 'string' ? raw.disposition : '';
  if (!(DISPOSITIONS_ACU as readonly string[]).includes(disposition)) failTakeover_ACU('disposition 非法');
  const evidenceMessageIndexes = indexes_ACU(raw.evidenceMessageIndexes, 'evidenceMessageIndexes');
  if (evidenceMessageIndexes.some(index => index > targetMessageIndex)) failTakeover_ACU('证据楼层不得晚于目标楼');
  const satisfiedTurnIds = turnIds_ACU(raw.satisfiedTurnIds);
  if (disposition !== 'replace_current_stage' && !satisfiedTurnIds.length) failTakeover_ACU(`${disposition} 至少必须认领一个连续轮次`);
  const requiresStoryArcRevision = raw.requiresStoryArcRevision;
  if (typeof requiresStoryArcRevision !== 'boolean') failTakeover_ACU('requiresStoryArcRevision 必须是布尔值');
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (!reason) failTakeover_ACU('reason 必须说明正文证据与结论');
  return { targetMessageIndex, disposition: disposition as ContinuationTakeoverAssessment_ACU['disposition'], satisfiedTurnIds, evidenceMessageIndexes, requiresStoryArcRevision, reason };
}
