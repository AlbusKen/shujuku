import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    commit: vi.fn(), refresh: vi.fn(), notify: vi.fn(), summary: vi.fn(), queue: vi.fn(),
}));
vi.mock('../../src/shared/constants', () => ({ ACU_TOAST_CATEGORY_ACU: {} }));
vi.mock('../../src/shared/env', () => ({ topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: h.notify } } }));
vi.mock('../../src/shared/utils', () => ({
    isSummaryOrOutlineTable_ACU: h.summary, logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn(),
}));
vi.mock('../../src/shared/host-api', () => ({ SillyTavern_API_ACU: {} }));
vi.mock('../../src/service/runtime/state-manager', () => ({
    currentJsonTableData_ACU: {}, isAutoUpdatingCard_ACU: false, _set_isAutoUpdatingCard_ACU: vi.fn(),
}));
vi.mock('../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: vi.fn() }));
vi.mock('../../src/service/runtime/helpers-remaining', () => ({ getEffectiveAutoUpdateThreshold_ACU: vi.fn() }));
vi.mock('../../src/presentation/triggers/update-process', () => ({ proceedWithCardUpdate_ACU: vi.fn() }));
vi.mock('../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshMergedDataAndNotifyWithUI_ACU: h.refresh }));
vi.mock('../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../src/service/settings/settings-readers', () => ({ getCurrentWorldbookConfig_ACU: () => ({ summaryVectorIndexModeEnabled: true }) }));
vi.mock('../../src/service/vector/summary-vector-index-flush-queue', () => ({ enqueueSummaryVectorIndexFlush_ACU: h.queue }));
vi.mock('../../src/service/table/table-import-service', () => ({ importTableJsonThroughCommit_ACU: h.commit }));

import { createCoreDataApi } from '../../src/presentation/bootstrap/api-groups/core-data-api';

const json = '{"sheet_0":{"name":"T","content":[["row_id"],["1"]]}}';
const committed = () => ({ success: true, messageIndex: 3, tableData: { sheet_0: { name: 'T' } } });

beforeEach(() => {
    vi.resetAllMocks();
    h.commit.mockResolvedValue(committed()); h.refresh.mockResolvedValue(undefined);
    h.summary.mockReturnValue(false); h.queue.mockResolvedValue({ queued: true });
});

describe('importTableAsJson frontend readback option', () => {
    it.each([undefined, true, 'false', 0, null])('preserves default wait unless explicitly false: %j', async awaitFrontendReadback => {
        const api = createCoreDataApi({} as any);
        expect(await api.importTableAsJson(json, { awaitFrontendReadback })).toBe(true);
        expect(h.commit).toHaveBeenCalledWith(json, { persist: true });
        expect(h.refresh).toHaveBeenCalledWith({ awaitFrontendReadback: true });
    });
    it('passes explicit false without disabling persistence or notifications', async () => {
        const api = createCoreDataApi({} as any);
        expect(await api.importTableAsJson(json, { awaitFrontendReadback: false })).toBe(true);
        expect(h.commit).toHaveBeenCalledWith(json, { persist: true });
        expect(h.refresh).toHaveBeenCalledWith({ awaitFrontendReadback: false });
    });
    it('still waits for the import commit before refreshing or returning', async () => {
        let release!: (result: any) => void;
        h.commit.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        let settled = false;
        const pending = createCoreDataApi({} as any).importTableAsJson(json, { awaitFrontendReadback: false })
            .then((value: boolean) => { settled = true; return value; });
        await Promise.resolve();
        expect(settled).toBe(false); expect(h.refresh).not.toHaveBeenCalled();
        release(committed());
        expect(await pending).toBe(true);
        expect(h.refresh).toHaveBeenCalledWith({ awaitFrontendReadback: false });
    });
    it('preserves failed import results and does not notify success', async () => {
        h.commit.mockResolvedValue({ success: false, error: 'save failed' });
        expect(await createCoreDataApi({} as any).importTableAsJson(json, { awaitFrontendReadback: false })).toBe(false);
        expect(h.refresh).not.toHaveBeenCalled(); expect(h.notify).not.toHaveBeenCalled();
    });
    it('leaves runtime-only recovery behavior unchanged', async () => {
        expect(await createCoreDataApi({} as any).importTableAsJson(json, { persist: false, awaitFrontendReadback: false })).toBe(true);
        expect(h.commit).toHaveBeenCalledWith(json, { persist: false });
        expect(h.refresh).not.toHaveBeenCalled(); expect(h.notify).toHaveBeenCalledWith({ persisted: false });
    });
    it('keeps summary index work after a persisted import', async () => {
        h.summary.mockReturnValue(true);
        expect(await createCoreDataApi({} as any).importTableAsJson(json, { awaitFrontendReadback: false })).toBe(true);
        expect(h.queue).toHaveBeenCalledWith({ sourceTableKey: 'sheet_0', reason: 'importTableAsJson' });
    });
});
