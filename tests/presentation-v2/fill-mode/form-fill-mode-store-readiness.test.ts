import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const h = vi.hoisted(() => ({
  tableData: { sheet_chronicle: { name: '纪要表', content: [['row_id', '纪要']] } } as any,
  settings: { plotSettings: { enabled: true } } as any,
  enable: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.tableData; },
  get settings_ACU() { return h.settings; },
  currentChatFileIdentifier_ACU: 'fill-mode-test-chat',
  getCurrentIsolationKey_ACU: () => '',
}));
vi.mock('../../../src/data/gateways/chat-gateway', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/data/gateways/chat-gateway')>()),
  saveChatToHostStrict_ACU: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/service/flight-mode/flight-mode-transition', () => ({
  enableFlightMode_ACU: h.enable,
  disableFlightMode_ACU: vi.fn(),
  hasPendingFlightModeEnable_ACU: () => false,
}));

import { getChatArray_ACU } from '../../../src/data/gateways/chat-gateway';
import { normalizeChatScopedConfigContainer_ACU, peekChatScopedConfigContainer_ACU, setChatScopedConfigContainer_ACU } from '../../../src/data/storage/chat-history';
import { __resetFillModeReconcileForTests_ACU, reconcileCurrentChatFillModeOnOpen_ACU } from '../../../src/service/fill-mode/fill-mode-reconcile';
import { useFormFillModeStore } from '../../../src/presentation-v2/stores/form-fill-mode-store';
import { resetFillModeSeed_ACU, seedFillModeForTest_ACU } from '../../helpers/fill-mode-seed';

function enableSucceeds(): any {
  const chat = getChatArray_ACU();
  const container = normalizeChatScopedConfigContainer_ACU(peekChatScopedConfigContainer_ACU(chat));
  container.flightModeByIsolationKey = { '': { enabled: true, hiddenRowIds: [] } };
  setChatScopedConfigContainer_ACU(chat, container);
  return { ok: true };
}

describe('form-fill-mode-store 经典就绪状态', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    __resetFillModeReconcileForTests_ACU();
    h.enable.mockReset().mockImplementation(async () => enableSucceeds());
  });

  afterEach(() => resetFillModeSeed_ACU());

  it('经典启用失败时显示 failed，重新启用成功后刷新为 ready', async () => {
    seedFillModeForTest_ACU({ record: 'classic' });
    h.enable.mockResolvedValueOnce({ ok: false, reason: 'state_persist_failed', error: '保存拒绝' });
    await reconcileCurrentChatFillModeOnOpen_ACU({ tableLoaded: true });

    const store = useFormFillModeStore();
    expect(store.selectedMode).toBe('classic');
    expect(store.classicReadiness).toEqual({ status: 'failed', reason: 'state_persist_failed', error: '保存拒绝' });

    await expect(store.retryClassicEnable()).resolves.toEqual({ status: 'ready' });
    expect(store.classicReadiness).toEqual({ status: 'ready' });
    expect(store.retryingClassic).toBe(false);
  });

  it('未协调的经典对话显示 pending，非经典对话显示 not_classic', () => {
    seedFillModeForTest_ACU({ record: 'classic' });
    const store = useFormFillModeStore();
    expect(store.classicReadiness).toEqual({ status: 'pending', reason: 'not_reconciled' });

    seedFillModeForTest_ACU({ record: 'llm' });
    store.refresh();
    expect(store.classicReadiness).toEqual({ status: 'not_classic' });
  });
});
