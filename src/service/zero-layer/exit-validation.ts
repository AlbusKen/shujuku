import type { ZeroLayerEnvelope_ACU } from './model';
import { ZeroLayerError_ACU } from './model';
import type { ZeroLayerExitManifest_ACU } from './exit-model';
import { ZERO_LAYER_EXIT_FIELDS_ACU } from './exit-fields';
import { checkpointFingerprint_ACU as fingerprint, checkpointTurnRef_ACU } from './checkpoint-payload';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const requireValue: (value: unknown, message: string) => asserts value = (value, message) => {
  if (!value) throw new ZeroLayerError_ACU('corrupt-data', message);
};
export function exitCandidateFingerprint_ACU(manifest: ZeroLayerExitManifest_ACU): string {
  const { phase: _phase, candidateFingerprint: _fingerprint, ...candidate } = manifest;
  return fingerprint(candidate);
}

/** 只校验 journal 自身与原逻辑身份；不把物理位置解释为逻辑身份。 */
export function validateZeroLayerExitManifest_ACU(source: ZeroLayerEnvelope_ACU): void {
  const raw = source.exitManifest;
  if (raw === undefined) return;
  requireValue(record(raw) && raw.schemaVersion === 1 && ['prepared', 'committed'].includes(raw.phase)
    && typeof raw.exitId === 'string' && raw.exitId.trim() && !source.enabled, '退出 journal 版本或阶段无效。');
  requireValue(raw.sessionId === source.sessionId && raw.branchId === source.activeBranchId
    && fingerprint(raw.scope) === fingerprint(source.scope)
    && raw.activationMessageCount === source.activationMessageCount
    && raw.activationFingerprint === source.activationFingerprint
    && integer(raw.sourceRevision) && raw.sourceRevision < source.revision && integer(raw.createdAt), '退出来源与载体不一致。');
  const branch = source.branches.find(item => item.branchId === raw.branchId);
  const turn = source.turns.find(item => item.turnId === branch?.headTurnId);
  requireValue(turn?.phase === 'published' && fingerprint(raw.head) === fingerprint(checkpointTurnRef_ACU(source, turn)), '退出 head 不是所选已发布逻辑前沿。');
  requireValue(record(raw.target) && raw.target.kind === 'host' && integer(raw.target.messageIndex)
    && raw.target.messageIndex < source.activationMessageCount && integer(raw.target.swipeId)
    && fingerprint(raw.target.scope) === fingerprint(source.scope)
    && raw.target.sourceFingerprint === source.activationFingerprint, '退出物理接入引用无效。');
  requireValue(Array.isArray(raw.assignments) && raw.assignments.length > 0, '退出缺少完整写集。');
  const keys = new Set<string>();
  for (const item of raw.assignments) {
    requireValue(record(item) && integer(item.messageIndex)
      && item.messageIndex < source.activationMessageCount
      && ZERO_LAYER_EXIT_FIELDS_ACU.includes(item.field), '退出写集位置或字段非法。');
    const key = JSON.stringify([item.messageIndex, item.field]);
    requireValue(!keys.has(key), '退出写集存在重复字段。');
    keys.add(key);
    for (const value of [item.before, item.after]) {
      requireValue(record(value) && typeof value.exists === 'boolean'
        && Object.keys(value).every(key => ['exists', 'value'].includes(key))
        && (value.exists ? Object.prototype.hasOwnProperty.call(value, 'value') && value.value !== undefined
          : !Object.prototype.hasOwnProperty.call(value, 'value')), '退出字段快照无效。');
    }
  }
  requireValue(typeof raw.configFingerprint === 'string' && raw.configFingerprint.trim()
    && typeof raw.materialFingerprint === 'string' && raw.materialFingerprint.trim()
    && raw.candidateFingerprint === exitCandidateFingerprint_ACU(raw), '退出候选指纹无效。');
}
