import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tableData: { sheet_a: { name: 'A' } } as any,
}));

vi.mock('../../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mocks.tableData; },
}));
vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

import { createCallbackApi, type ApiGroupContext } from '../../../../src/presentation/bootstrap/api-groups/callback-api';

function makeContext(): { ctx: ApiGroupContext; api: Record<string, Function> } {
  const ctx: ApiGroupContext = {
    tableUpdateCallbacks: [],
    tableFillStartCallbacks: [],
    getApi: () => api,
  };
  const api = createCallbackApi(ctx);
  return { ctx, api };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tableData = { sheet_a: { name: 'A' } };
});

describe('_notifyTableUpdate persisted 契约（S2-1）', () => {
  it('默认通知：回调收到 (data, { persisted: true })', () => {
    const { api } = makeContext();
    const callback = vi.fn();
    api.registerTableUpdateCallback(callback);

    api._notifyTableUpdate();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(mocks.tableData, { persisted: true });
  });

  it('显式 persisted:false：回调收到 { persisted: false }', () => {
    const { api } = makeContext();
    const callback = vi.fn();
    api.registerTableUpdateCallback(callback);

    api._notifyTableUpdate({ persisted: false });

    expect(callback).toHaveBeenCalledWith(mocks.tableData, { persisted: false });
  });

  it('currentJsonTableData 为 null 时回调收到空对象而非 null', () => {
    const { api } = makeContext();
    mocks.tableData = null;
    const callback = vi.fn();
    api.registerTableUpdateCallback(callback);

    api._notifyTableUpdate();

    expect(callback).toHaveBeenCalledWith({}, { persisted: true });
  });

  it('重入合并：通知期间收到 persisted:false 请求时，跟发通知按 persisted:false 保守告知', () => {
    const { api } = makeContext();
    const received: Array<{ persisted: boolean }> = [];
    let reentered = false;
    const callback = vi.fn((_data: any, meta: any) => {
      received.push(meta);
      if (!reentered) {
        reentered = true;
        // 通知进行中先来一次未落盘请求、再来一次已落盘请求：合并窗口出现过 false 则跟发 false
        api._notifyTableUpdate({ persisted: false });
        api._notifyTableUpdate({ persisted: true });
      }
    });
    api.registerTableUpdateCallback(callback);

    api._notifyTableUpdate();

    expect(received).toEqual([{ persisted: true }, { persisted: false }]);
  });

  it('重入合并：窗口内全部为已落盘请求时，跟发通知保持 persisted:true，且窗口结束后状态重置', () => {
    const { api } = makeContext();
    const received: Array<{ persisted: boolean }> = [];
    let reentered = false;
    const callback = vi.fn((_data: any, meta: any) => {
      received.push(meta);
      if (!reentered) {
        reentered = true;
        api._notifyTableUpdate({ persisted: true });
      }
    });
    api.registerTableUpdateCallback(callback);

    api._notifyTableUpdate();
    expect(received).toEqual([{ persisted: true }, { persisted: true }]);

    // 上一窗口的合并状态不得泄漏到下一次独立通知
    api._notifyTableUpdate();
    expect(received[2]).toEqual({ persisted: true });
  });

  it('某个回调抛错不影响其余回调收到通知', () => {
    const { api } = makeContext();
    const bad = vi.fn(() => { throw new Error('third-party callback exploded'); });
    const good = vi.fn();
    api.registerTableUpdateCallback(bad);
    api.registerTableUpdateCallback(good);

    api._notifyTableUpdate({ persisted: false });

    expect(good).toHaveBeenCalledWith(mocks.tableData, { persisted: false });
  });
});
