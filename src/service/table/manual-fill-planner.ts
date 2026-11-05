export interface ManualCatchUpSheetPlanInput_ACU {
  sheetKey: string;
  lastCompletedAiFloor: number;
  groupId: number;
  batchSize: number;
  requestOptions?: Record<string, unknown> | null;
  updateMode?: string;
  executionKind?: 'sql' | 'standard';
}

export interface ManualCatchUpGroup_ACU {
  key: string;
  groupId: number;
  batchSize: number;
  sheetKeys: string[];
  requestOptions: Record<string, unknown> | null;
  updateMode: string;
  executionKind: 'sql' | 'standard';
}

export interface ManualCatchUpWave_ACU {
  startAiFloor: number;
  endAiFloor: number;
  messageIndices: number[];
  sheetKeys: string[];
  groups: ManualCatchUpGroup_ACU[];
}

export interface ManualCatchUpPlan_ACU {
  targetAiFloor: number;
  targetMessageIndex: number | null;
  waves: ManualCatchUpWave_ACU[];
  planSignature: string;
}

function normalizedPositiveInteger_ACU(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function normalizedFloor_ACU(value: unknown): number {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : 0;
}

function stableValue_ACU(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue_ACU);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, stableValue_ACU(child)]));
}

function stableStringify_ACU(value: unknown): string {
  return JSON.stringify(stableValue_ACU(value));
}

function normalizedAiMessageIndices_ACU(indices: number[]): number[] {
  return indices.filter(index => Number.isInteger(index) && index >= 0);
}

function compatibilityKey_ACU(input: ManualCatchUpSheetPlanInput_ACU): string {
  return stableStringify_ACU({
    groupId: Math.trunc(Number(input.groupId) || -1),
    batchSize: normalizedPositiveInteger_ACU(input.batchSize, 1),
    requestOptions: input.requestOptions || null,
    updateMode: input.updateMode || 'manual_independent',
    executionKind: input.executionKind || 'standard',
  });
}

function buildGroup_ACU(key: string, inputs: ManualCatchUpSheetPlanInput_ACU[]): ManualCatchUpGroup_ACU {
  const first = inputs[0];
  return {
    key,
    groupId: Math.trunc(Number(first.groupId) || -1),
    batchSize: normalizedPositiveInteger_ACU(first.batchSize, 1),
    sheetKeys: inputs.map(input => input.sheetKey).sort(),
    requestOptions: first.requestOptions || null,
    updateMode: first.updateMode || 'manual_independent',
    executionKind: first.executionKind || 'standard',
  };
}

/**
 * 为“追平已选表”生成后缀缺口计划。
 *
 * lastCompletedAiFloor 是已提交的最高连续前沿，不用于推断此前是否存在内部空洞；
 * 这种事实当前没有持久化表示，不能伪装成 planner 已经检查过。
 * aiMessageIndices 是 !is_user 序列，楼层序号与存储前沿同口径；isEligible 剔除工具楼等不可填楼，
 * 只影响各 wave 的实际填表楼层与终点楼，不改变序号。
 */
export function planManualCatchUpWaves_ACU(
  aiMessageIndices: number[],
  inputs: ManualCatchUpSheetPlanInput_ACU[],
  isEligible: (messageIndex: number) => boolean = () => true,
): ManualCatchUpPlan_ACU {
  const normalizedIndices = normalizedAiMessageIndices_ACU(aiMessageIndices);
  const targetAiFloor = normalizedIndices.length;
  const eligibleInputs = inputs
    .filter(input => typeof input.sheetKey === 'string' && input.sheetKey.length > 0)
    .sort((left, right) => left.sheetKey.localeCompare(right.sheetKey));

  const ranges = eligibleInputs
    .map(input => ({ input, start: normalizedFloor_ACU(input.lastCompletedAiFloor) + 1, end: targetAiFloor }))
    .filter(range => range.start <= range.end);
  const boundaries = [...new Set(ranges.flatMap(range => [range.start, range.end + 1]))].sort((left, right) => left - right);
  const waves: ManualCatchUpWave_ACU[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startAiFloor = boundaries[index];
    const endAiFloor = boundaries[index + 1] - 1;
    const active = ranges.filter(range => range.start <= startAiFloor && range.end >= endAiFloor);
    if (!active.length) continue;
    const messageIndices = normalizedIndices.slice(startAiFloor - 1, endAiFloor).filter(isEligible);
    if (!messageIndices.length) continue;
    const byCompatibility = new Map<string, ManualCatchUpSheetPlanInput_ACU[]>();
    active.forEach(({ input }) => {
      const key = compatibilityKey_ACU(input);
      const group = byCompatibility.get(key) || [];
      group.push(input);
      byCompatibility.set(key, group);
    });
    const groups = [...byCompatibility.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, groupInputs]) => buildGroup_ACU(key, groupInputs));
    waves.push({
      startAiFloor,
      endAiFloor,
      messageIndices,
      sheetKeys: active.map(range => range.input.sheetKey).sort(),
      groups,
    });
  }

  let targetMessageIndex: number | null = null;
  for (let index = normalizedIndices.length - 1; index >= 0; index -= 1) {
    if (isEligible(normalizedIndices[index])) {
      targetMessageIndex = normalizedIndices[index];
      break;
    }
  }
  return {
    targetAiFloor,
    targetMessageIndex,
    waves,
    planSignature: stableStringify_ACU({
      targetAiFloor,
      targetMessageIndex,
      waves: waves.map(wave => ({ startAiFloor: wave.startAiFloor, endAiFloor: wave.endAiFloor, sheetKeys: wave.sheetKeys, groups: wave.groups })),
    }),
  };
}
