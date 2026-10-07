import { exitZeroLayerForPage_ACU, recoverZeroLayerExitForPage_ACU,
  resyncZeroLayerViewForPage_ACU, bindZeroLayerGameFrameForPage_ACU,
  submitZeroLayerInputForPage_ACU, stopZeroLayerForPage_ACU } from '../zero-layer-bootstrap';
import type { ZeroLayerExitSelection_ACU } from '../../../service/zero-layer/exit-model';
import { zeroLayerHistoryReader_ACU } from '../../../service/zero-layer/history-read';
import type { ZeroLayerHistoryApi_ACU } from '../../../service/zero-layer/history-model';

/** 显式操作入口；调用者必须提供已读取的原 FloorRef 与 revision。 */
export function createZeroLayerExitApi_ACU() {
  return {
    zeroLayer: createZeroLayerHistoryApi_ACU(),
    exitZeroLayerToOrdinary: (selection: ZeroLayerExitSelection_ACU) => exitZeroLayerForPage_ACU(selection),
    recoverZeroLayerExit: () => recoverZeroLayerExitForPage_ACU(),
    resyncZeroLayerView: () => resyncZeroLayerViewForPage_ACU(),
    bindZeroLayerGameFrame: (frame: HTMLIFrameElement, origin: string) =>
      bindZeroLayerGameFrameForPage_ACU(frame, origin),
    submitZeroLayerInput: (input: string) => submitZeroLayerInputForPage_ACU(input),
    stopZeroLayer: () => stopZeroLayerForPage_ACU(),
  };
}

/** 只暴露绑定方法，不把内部 reader、存储或撤销权限交给公开调用者。 */
export function createZeroLayerHistoryApi_ACU(): Readonly<ZeroLayerHistoryApi_ACU> {
  return Object.freeze({
    getSnapshot: query => zeroLayerHistoryReader_ACU.getSnapshot(query),
    readHistory: query => zeroLayerHistoryReader_ACU.readHistory(query),
    subscribe: listener => zeroLayerHistoryReader_ACU.subscribe(listener),
  } satisfies ZeroLayerHistoryApi_ACU);
}
