export type MaterialCompletionState_ACU =
  | 'complete_changed'
  | 'complete_no_change'
  | 'partial'
  | 'failed'
  | 'legacy_unknown';

export type MaterialDisplayState_ACU =
  | 'complete'
  | 'valid_empty'
  | 'pending'
  | 'legacy_unknown'
  | 'load_failed';

export interface MaterialCompletionCard_ACU {
  module: string;
  state: MaterialDisplayState_ACU;
  label: string;
  detail: string;
}

const DISPLAY_ACU: Record<MaterialDisplayState_ACU, { label: string; detail: string }> = {
  complete: { label: '已完成', detail: '该模块已有经校验的资料变更。' },
  valid_empty: { label: '合法为空', detail: '该模块已完成检查，本轮确认无需新增资料。' },
  pending: { label: '待补足', detail: '该模块存在未完成或被拒绝的资料缺口。' },
  legacy_unknown: { label: '历史状态未知', detail: '旧资料没有模块级完成记录；不会自动回填。' },
  load_failed: { label: '加载失败', detail: '资料读取失败，不能按空资料处理。' },
};

function displayState_ACU(
  state: MaterialCompletionState_ACU | undefined,
  pending: boolean,
): MaterialDisplayState_ACU {
  if (pending || state === 'partial' || state === 'failed') return 'pending';
  if (state === 'complete_changed') return 'complete';
  if (state === 'complete_no_change') return 'valid_empty';
  return 'legacy_unknown';
}

/**
 * 读取诊断只有在没有任何可采用快照时才表示加载失败。
 * 找到较早合法快照时，诊断仅解释被跳过的损坏候选，不能覆盖已成功读取的资料状态。
 */
export function resolveMaterialLoadError_ACU(input: {
  snapshotPresent: boolean;
  diagnostics?: readonly string[];
}): string | null {
  if (input.snapshotPresent) return null;
  const diagnostics = (input.diagnostics ?? []).map(item => item.trim()).filter(Boolean);
  return diagnostics.length ? diagnostics.join('；') : null;
}

export function buildMaterialCompletionCards_ACU(input: {
  overallState?: MaterialCompletionState_ACU;
  expectedModules?: readonly string[];
  modules?: Readonly<Record<string, MaterialCompletionState_ACU | undefined>>;
  pendingModules?: readonly string[];
  loadError?: string | null;
}): MaterialCompletionCard_ACU[] {
  if (input.loadError) {
    return [{
      module: '*',
      state: 'load_failed',
      label: DISPLAY_ACU.load_failed.label,
      detail: `${DISPLAY_ACU.load_failed.detail} ${input.loadError}`.trim(),
    }];
  }
  const pending = new Set(input.pendingModules ?? []);
  const modules = [...new Set([
    ...(input.expectedModules ?? []),
    ...Object.keys(input.modules ?? {}),
    ...pending,
  ])];
  if (!modules.length) modules.push('*');
  return modules.map(module => {
    const state = displayState_ACU(
      module === '*' ? input.overallState : input.modules?.[module],
      pending.has(module),
    );
    return { module, state, ...DISPLAY_ACU[state] };
  });
}
