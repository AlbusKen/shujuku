import type { ZeroLayerBranchCommand_ACU } from './branch-command';
import type { ZeroLayerExitSelection_ACU } from './exit-model';
import { ZeroLayerError_ACU } from './model';

/** 页面级零层操作端口：展示层 bootstrap 注册实现，presentation-v2 只经此调用。 */
export interface ZeroLayerPageOperations_ACU {
  setEnabled(enabled: boolean, apiPresetName?: string): Promise<unknown>;
  submit(input: string): Promise<unknown>;
  recover(): Promise<unknown>;
  abandon(turnId: string, attemptId: string): Promise<unknown>;
  changeBranch(command: ZeroLayerBranchCommand_ACU): Promise<unknown>;
  exit(selection: ZeroLayerExitSelection_ACU): Promise<unknown>;
  stop(): void;
}

let operations_ACU: ZeroLayerPageOperations_ACU | null = null;

export function registerZeroLayerPageOperations_ACU(operations: ZeroLayerPageOperations_ACU): void {
  operations_ACU = operations;
}

export function getZeroLayerPageOperations_ACU(): ZeroLayerPageOperations_ACU {
  if (!operations_ACU) throw new ZeroLayerError_ACU('mode-disabled', '零层页面操作尚未装配。');
  return operations_ACU;
}
