import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tableData: null as any,
  isolationKey: '',
  chatKey: 'fill-mode-test-chat',
  settings: { plotSettings: { enabled: true } } as any,
  pending: false,
  enable: vi.fn(),
  strictSave: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.tableData; },
  get settings_ACU() { return h.settings; },
  get currentChatFileIdentifier_ACU() { return h.chatKey; },
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));
vi.mock('../../../src/data/gateways/chat-gateway', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/data/gateways/chat-gateway')>()),
  saveChatToHostStrict_ACU: h.strictSave,
}));
vi.mock('../../../src/service/flight-mode/flight-mode-transition', () => ({
  enableFlightMode_ACU: h.enable,
  disableFlightMode_ACU: vi.fn(),
  hasPendingFlightModeEnable_ACU: () => h.pending,
}));

import { getChatArray_ACU } from '../../../src/data/gateways/chat-gateway';
import { normalizeChatScopedConfigContainer_ACU, peekChatScopedConfigContainer_ACU, setChatScopedConfigContainer_ACU } from '../../../src/data/storage/chat-history';
import { resolveCurrentChatFillMode_ACU } from '../../../src/service/fill-mode/fill-mode-chat-record';
import { isPlotAllowedForCurrentChat_ACU } from '../../../src/service/fill-mode/fill-mode-gate';
import {
  __resetFillModeReconcileForTests_ACU,
  getClassicReadinessForCurrentChat_ACU,
  reconcileCurrentChatFillModeOnOpen_ACU,
  retryClassicEnableForCurrentChat_ACU,
} from '../../../src/service/fill-mode/fill-mode-reconcile';
import { resetFillModeSeed_ACU, seedFillModeForTest_ACU } from '../../helpers/fill-mode-seed';

function emptyTable(): any {
  return { sheet_chronicle: { name: '纪要表', content: [['row_id', '纪要']] } };
}

function legacyTable(): any {
  return { sheet_chronicle: { name: '纪要表', content: [['row_id', '纪要'], ['1', 'a']] } };
}

/** 模拟启用成功：与真实实现一样，飞行开关与 classic 记录同次写入。 */
function enableSucceeds(): any {
  const chat = getChatArray_ACU();
  const container = normalizeChatScopedConfigContainer_ACU(peekChatScopedConfigContainer_ACU(chat));
  container.flightModeByIsolationKey = { [h.isolationKey]: { enabled: true, hiddenRowIds: [] } };
  container.fillModeByIsolationKey = { [h.isolationKey]: { mode: 'classic', recordedAt: 2 } };
  setChatScopedConfigContainer_ACU(chat, container);
  h.pending = false;
  return { ok: true };
}

describe('reconcileCurrentChatFillModeOnOpen_ACU', () => {
  beforeEach(() => {
    __resetFillModeReconcileForTests_ACU();
    h.tableData = emptyTable();
    h.isolationKey = '';
    h.chatKey = 'fill-mode-test-chat';
    h.pending = false;
    h.enable.mockReset().mockImplementation(async () => enableSucceeds());
    h.strictSave.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => resetFillModeSeed_ACU());

  it('新对话偏好 classic：写记录并启用，就绪', async () => {
    seedFillModeForTest_ACU({ preferred: 'classic' });
    const result = await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true });
    expect(result.record).toEqual({ recorded: true, mode: 'classic' });
    expect(h.enable).toHaveBeenCalledTimes(1);
    expect(result.readiness).toEqual({ status: 'ready' });
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'classic', recordStatus: 'recorded' });
    expect(getClassicReadinessForCurrentChat_ACU()).toEqual({ status: 'ready' });
  });

  it('记录 classic 且启用半完成：打开时补完', async () => {
    seedFillModeForTest_ACU({ record: 'classic', flightEnabled: true });
    h.pending = true;
    expect(getClassicReadinessForCurrentChat_ACU()).toEqual({ status: 'pending', reason: 'not_reconciled' });
    const result = await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true });
    expect(result.record).toEqual({ recorded: false, reason: 'already_recorded' });
    expect(h.enable).toHaveBeenCalledTimes(1);
    expect(result.readiness).toEqual({ status: 'ready' });
  });

  it('记录 classic 且已就绪：不重复启用', async () => {
    seedFillModeForTest_ACU({ record: 'classic', flightEnabled: true });
    const result = await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true });
    expect(h.enable).not.toHaveBeenCalled();
    expect(result.readiness).toEqual({ status: 'ready' });
  });

  it('纪要超窗口：failed，记录保持 classic，剧情门禁仍跳过', async () => {
    seedFillModeForTest_ACU({ record: 'classic' });
    h.enable.mockResolvedValueOnce({ ok: false, reason: 'too_many_visible_chronicle_rows', visibleChronicleRowCount: 40 });
    const result = await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true });
    expect(result.readiness).toMatchObject({ status: 'failed', reason: 'too_many_visible_chronicle_rows', error: expect.stringContaining('40') });
    expect(getClassicReadinessForCurrentChat_ACU()).toMatchObject({ status: 'failed', reason: 'too_many_visible_chronicle_rows' });
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'classic', recordStatus: 'recorded' });
    expect(isPlotAllowedForCurrentChat_ACU()).toBe(false);
  });

  it('状态保存失败：failed，重新启用成功后就绪', async () => {
    seedFillModeForTest_ACU({ record: 'classic' });
    h.enable.mockResolvedValueOnce({ ok: false, reason: 'state_persist_failed', error: '保存拒绝' });
    const failed = await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true });
    expect(failed.readiness).toEqual({ status: 'failed', reason: 'state_persist_failed', error: '保存拒绝' });
    await expect(retryClassicEnableForCurrentChat_ACU()).resolves.toEqual({ status: 'ready' });
    expect(h.enable).toHaveBeenCalledTimes(2);
    expect(getClassicReadinessForCurrentChat_ACU()).toEqual({ status: 'ready' });
  });

  it('启用抛异常：failed(enable_exception)', async () => {
    seedFillModeForTest_ACU({ record: 'classic' });
    h.enable.mockRejectedValueOnce(new Error('宿主不可用'));
    const result = await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true });
    expect(result.readiness).toEqual({ status: 'failed', reason: 'enable_exception', error: '宿主不可用' });
  });

  it('旧对话有表格无记录：迁移为 llm，不启用经典', async () => {
    seedFillModeForTest_ACU({ preferred: 'classic' });
    h.tableData = legacyTable();
    const result = await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true });
    expect(result.record).toEqual({ recorded: true, mode: 'llm' });
    expect(result.readiness).toEqual({ status: 'not_classic' });
    expect(h.enable).not.toHaveBeenCalled();
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'llm', source: 'chat' });
  });

  it('补记保存失败：不写记录，偏好 classic 仍尝试补完经典', async () => {
    seedFillModeForTest_ACU({ preferred: 'classic' });
    h.strictSave.mockRejectedValueOnce(new Error('记录保存拒绝'));
    const result = await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true });
    expect(result.record).toMatchObject({ recorded: false, reason: 'save_failed' });
    expect(h.enable).toHaveBeenCalledTimes(1);
    expect(result.readiness).toEqual({ status: 'ready' });
  });

  it('刷新降级：pending(table_not_loaded)，不写记录也不启用', async () => {
    seedFillModeForTest_ACU({ preferred: 'classic' });
    const result = await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: false });
    expect(result).toEqual({ record: null, readiness: { status: 'pending', reason: 'table_not_loaded' } });
    expect(h.enable).not.toHaveBeenCalled();
    expect(h.strictSave).not.toHaveBeenCalled();
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ recordStatus: 'absent' });
  });

  it('非经典记录：not_classic，不启用', async () => {
    seedFillModeForTest_ACU({ record: 'crossfire', preferred: 'classic' });
    const result = await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true });
    expect(result.readiness).toEqual({ status: 'not_classic' });
    expect(getClassicReadinessForCurrentChat_ACU()).toEqual({ status: 'not_classic' });
    expect(h.enable).not.toHaveBeenCalled();
  });

  it('同一对话并发调用只启用一次', async () => {
    seedFillModeForTest_ACU({ record: 'classic' });
    const [a, b] = await Promise.all([
      reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true }),
      reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true }),
    ]);
    expect(a).toBe(b);
    expect(h.enable).toHaveBeenCalledTimes(1);
  });
});
