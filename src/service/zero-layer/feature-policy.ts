import { ZeroLayerError_ACU } from './model';

/** 零层已停用；存档只保留，不再参与普通功能的运行路由。 */
export function isZeroLayerFeatureEnabled_ACU(): boolean {
  return false;
}

export function assertZeroLayerFeatureEnabled_ACU(): void {
  if (!isZeroLayerFeatureEnabled_ACU()) {
    throw new ZeroLayerError_ACU('mode-disabled', '零层功能已关闭，不能重新启用或执行零层操作。');
  }
}
