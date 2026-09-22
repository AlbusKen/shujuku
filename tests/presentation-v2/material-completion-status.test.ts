import { describe, expect, it } from 'vitest';
import { buildMaterialCompletionCards_ACU, resolveMaterialLoadError_ACU } from '../../src/presentation-v2/material-completion-status';

describe('资料完成状态适配', () => {
  it('区分已完成、合法为空与待补足，pending 优先于完成记录', () => {
    expect(buildMaterialCompletionCards_ACU({
      expectedModules: ['dimensions', 'seeds', 'actors'],
      modules: {
        dimensions: 'complete_changed',
        seeds: 'complete_no_change',
        actors: 'complete_changed',
      },
      pendingModules: ['actors'],
    })).toEqual([
      expect.objectContaining({ module: 'dimensions', state: 'complete', label: '已完成' }),
      expect.objectContaining({ module: 'seeds', state: 'valid_empty', label: '合法为空' }),
      expect.objectContaining({ module: 'actors', state: 'pending', label: '待补足' }),
    ]);
  });

  it('无模块记录时保留 legacy_unknown，不把历史 0 条伪装成合法为空', () => {
    expect(buildMaterialCompletionCards_ACU({ overallState: 'legacy_unknown' }))
      .toEqual([expect.objectContaining({ module: '*', state: 'legacy_unknown', label: '历史状态未知' })]);
  });

  it('读取失败覆盖空状态并保留错误原因', () => {
    const cards = buildMaterialCompletionCards_ACU({
      overallState: 'complete_no_change',
      loadError: 'snapshot invalid',
    });
    expect(cards).toEqual([expect.objectContaining({ state: 'load_failed', label: '加载失败' })]);
    expect(cards[0].detail).toContain('snapshot invalid');
  });

  it('已有合法快照时诊断只解释被跳过候选，不误标为加载失败', () => {
    expect(resolveMaterialLoadError_ACU({
      snapshotPresent: true,
      diagnostics: ['楼层 9: 新候选损坏', '楼层 4: 已采用较早快照'],
    })).toBeNull();
    expect(resolveMaterialLoadError_ACU({
      snapshotPresent: false,
      diagnostics: ['楼层 9: 新候选损坏', '当前有效分支没有候选通过严格校验'],
    })).toBe('楼层 9: 新候选损坏；当前有效分支没有候选通过严格校验');
    expect(resolveMaterialLoadError_ACU({ snapshotPresent: false, diagnostics: [] })).toBeNull();
  });
});
