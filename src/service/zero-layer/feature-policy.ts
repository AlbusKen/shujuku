import { ZeroLayerError_ACU } from './model';

/** 零层功能总开关；关闭时存档只保留，不参与普通功能的运行路由。 */
export function isZeroLayerFeatureEnabled_ACU(): boolean {
  return true;
}

export function assertZeroLayerFeatureEnabled_ACU(): void {
  if (!isZeroLayerFeatureEnabled_ACU()) {
    throw new ZeroLayerError_ACU('mode-disabled', '零层功能已关闭，不能重新启用或执行零层操作。');
  }
}
