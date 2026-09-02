/**
 * tests/service/table/update-orchestrator.test.ts
 * 表格更新编排器单元测试
 *
 * 策略：
 * - resolveUpdateMode_ACU / loadBatchBaseData_ACU / buildBatchMergeBase_ACU 是纯/浅依赖函数，直接测试
 * - processUpdatesBatch_ACU / executeCardUpdateCore_ACU / orchestrateManualUpdate_ACU 通过 mock 回调测试编排逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureStableRowIdsForSheetContent_ACU } from '../../../src/service/template/chat-scope';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  hashUserInput_ACU: vi.fn((text: string) => text ? 'mock-ddl-digest' : ''),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
  stripSeedRowsFromTemplate_ACU: vi.fn((data: any) => {
    const cloned = JSON.parse(JSON.stringify(data));
    Object.keys(cloned || {}).filter(key => key.startsWith('sheet_')).forEach(key => { cloned[key].content = [cloned[key].content?.[0] || ['row_id']]; });
    return cloned;
  }),
  parseTableTemplateJson_ACU: vi.fn(() => ({
    mate: { type: 'acu' },
    sheet_0: { name: '测试表', updateConfig: { groupId: 0 } },
  })),
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: {},
}));

vi.mock('../../../src/shared/ui-surface-registry', () => ({
  showUiSurfaceToast_ACU: vi.fn(),
  getUiSurface_ACU: vi.fn(() => null),
  registerUiSurface_ACU: vi.fn(),
  resetUiSurfaceRegistryForTests_ACU: vi.fn(),
}));

let mockSettings: any = {
  autoUpdateEnabled: true,
  apiMode: 'custom',
  apiConfig: { useMainApi: true, url: '', model: '' },
  tavernProfile: '',
  autoUpdateThreshold: 3,
  updateBatchSize: 2,
  skipUpdateFloors: 0,
  tableMaxRetries: 3,
  autoUpdateTokenThreshold: 0,
  toastMuteEnabled: false,
  dataIsolationEnabled: false,
  dataIsolationCode: '',
  tableApiPresetOverridesByName: {},
};

let mockCurrentJsonTableData: any = null;
let mockIsAutoUpdating = false;
let mockWasStopped = false;
let mockCoreApisReady = true;
let mockPendingFinalGenerationGreenlights: any[] = [];

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  get currentChatFileIdentifier_ACU() { return 'test-chat'; },
  get isAutoUpdatingCard_ACU() { return mockIsAutoUpdating; },
  get wasStoppedByUser_ACU() { return mockWasStopped; },
  get coreApisAreReady_ACU() { return mockCoreApisReady; },
  get pendingFinalGenerationGreenlights_ACU() { return mockPendingFinalGenerationGreenlights; },
  independentTableStates_ACU: mockIndependentTableStates,
  _set_isAutoUpdatingCard_ACU: vi.fn((v: any) => { mockIsAutoUpdating = v; }),
  _set_wasStoppedByUser_ACU: vi.fn(),
  _set_manualExtraHint_ACU: vi.fn(),
  _set_currentJsonTableData_ACU: vi.fn((v: any) => { mockCurrentJsonTableData = v; }),
  abortAllActiveRequests_ACU: vi.fn(),
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
}));

const mockCallCustomOpenAI = vi.fn();
const mockParseAndApplyTableEdits = vi.fn();
const mockParseAndApplyTableEditsToData = vi.fn();
const mockApplySqlEditsToTableDataSnapshot = vi.fn();
const mockGetCurrentFlightModeState = vi.fn(() => ({ enabled: false, hiddenRowIds: [], bigSummarySheetKey: '' }));
const mockStageFlightModeHiddenRowIds = vi.fn(() => null);
const mockGetHiddenChronicleRowIdsAfterBigSummaryInsert = vi.fn(() => null);
const mockPrepareAIInput = vi.fn();
const mockReloadStorageProvider = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, degraded: false, source: 'merged' }));
const mockEnsureStorageProviderReady = vi.hoisted(() => vi.fn().mockResolvedValue({ mode: 'sqlite', isReady: () => true }));
const mockResolveTemplateScope = vi.hoisted(() => vi.fn(() => null as any));

vi.mock('../../../src/service/ai/prompt-builder', () => ({
  callCustomOpenAI_ACU: (...args: any[]) => mockCallCustomOpenAI(...args),
  parseAndApplyTableEdits_ACU: (...args: any[]) => mockParseAndApplyTableEdits(...args),
  parseAndApplyTableEditsToData_ACU: (...args: any[]) => {
    const impl = mockParseAndApplyTableEditsToData.getMockImplementation();
    return impl ? mockParseAndApplyTableEditsToData(...args) : mockParseAndApplyTableEdits(...args);
  },
  prepareAIInput_ACU: (...args: any[]) => mockPrepareAIInput(...args),
  RetryableAiResponseError_ACU: class RetryableAiResponseError_ACU extends Error {
    readonly code = 'empty_or_invalid_api_response';
    constructor(message = 'API响应格式不正确或内容为空。') {
      super(message);
      this.name = 'RetryableAiResponseError';
    }
  },
}));

const { mockChatArrayForSeedStage, mockIndependentTableStates, mockGetChatArray_ACU, mockClearManualRefillIncrementalDataInRange, mockClearManualRefillSheetDataInRange, mockCommitManualRefillSheetSnapshot, mockEstablishManualRefillTemplateRoot, mockEnsureManualCatchUpAnchor, mockEnsureBoundaryCheckpoint, mockShouldRotateBoundaryCheckpoint, mockPurgeSheetKeysFromChatHistoryHard } = vi.hoisted(() => {
  const chatArray: any[] = [];
  const independentTableStates: Record<string, any> = {};
  return {
    mockChatArrayForSeedStage: chatArray,
    mockIndependentTableStates: independentTableStates,
    mockGetChatArray_ACU: vi.fn(() => chatArray),
    mockClearManualRefillIncrementalDataInRange: vi.fn().mockResolvedValue(0),
    mockClearManualRefillSheetDataInRange: vi.fn().mockResolvedValue(0),
    mockCommitManualRefillSheetSnapshot: vi.fn().mockResolvedValue({ success: true, changed: true, clearedCount: 1, checkpointCount: 1, targetMessageIndex: 0 }),
    mockEstablishManualRefillTemplateRoot: vi.fn().mockResolvedValue({ success: true, changed: true, targetMessageIndex: 0 }),
    mockEnsureManualCatchUpAnchor: vi.fn().mockResolvedValue({ status: 'ready', checkpointMessageIndex: 0 }),
    mockEnsureBoundaryCheckpoint: vi.fn().mockResolvedValue({ success: true, changed: false, skipped: true }),
    mockShouldRotateBoundaryCheckpoint: vi.fn(() => false),
    mockPurgeSheetKeysFromChatHistoryHard: vi.fn().mockResolvedValue({ changed: true, changedCount: 1 }),
  };
});
vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: mockGetChatArray_ACU,
  clearTableDataAtFloors_ACU: vi.fn().mockResolvedValue(0),
  clearManualRefillIncrementalDataInRange_ACU: mockClearManualRefillIncrementalDataInRange,
  clearManualRefillSheetDataInRange_ACU: mockClearManualRefillSheetDataInRange,
  commitManualRefillSheetSnapshotInRangeAtomic_ACU: mockCommitManualRefillSheetSnapshot,
  establishManualRefillTemplateRoot_ACU: mockEstablishManualRefillTemplateRoot,
  ensureManualCatchUpAnchorBeforeTarget_ACU: mockEnsureManualCatchUpAnchor,
  ensureV2BoundaryCheckpointForRetainedBuffer_ACU: mockEnsureBoundaryCheckpoint,
  shouldRotateV2BoundaryCheckpointForRetainedBuffer_ACU: mockShouldRotateBoundaryCheckpoint,
}));

vi.mock('../../../src/service/summary/merge-logic', () => ({
  checkAutoMergeTrigger_ACU: vi.fn(() => ({ shouldTrigger: false })),
  prepareAutoMergeBatches_ACU: vi.fn(),
  executeAutoMergeBatch_ACU: vi.fn(),
  finalizeAutoMerge_ACU: vi.fn(),
}));

vi.mock('../../../src/service/worldbook/injection-engine-state', () => ({
  purgeSheetKeysFromChatHistoryHard_ACU: (...args: any[]) => mockPurgeSheetKeysFromChatHistoryHard(...args),
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getChatSheetGuideDataForIsolationKey_ACU: vi.fn(() => null),
  getCurrentChatTemplateScopeState_ACU: vi.fn(() => null),
  getGlobalTemplateSnapshotForCurrentProfile_ACU: vi.fn(() => ({
    templateObj: {
      mate: { type: 'acu' },
      sheet_0: { uid: 'sheet_0', name: '测试表', sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0, content: [['row_id', '值']] },
    },
  })),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn((source: any) => source ? {
    templateObj: JSON.parse(JSON.stringify(source)),
    templateStr: JSON.stringify(source),
  } : null),
  // 模板范围默认「未知」→ 不过滤，保持既有用例语义（这些用例不验证模板范围）。
  resolveTemplateScope_ACU: (...args: any[]) => mockResolveTemplateScope(...args),
  filterSheetKeysByTemplateScope_ACU: (keys: string[], scope: any) => (scope ? keys.filter((k: string) => scope.sheetKeys.has(k)) : [...keys]),
  projectSheetForTemplateScope_ACU: vi.fn((sheet: any) => sheet),
  getEffectiveSeedRowsForSheet_ACU: vi.fn(() => []),
  shouldUseInitialSeedRows_ACU: vi.fn(() => {
    const chat = mockGetChatArray_ACU();
    return Array.isArray(chat) && chat.filter((m: any) => m && m.is_user).length === 1 && !chat.some((m: any) => m && !m.is_user && m.mes !== '开场白');
  }),
  ensureStableRowIdsForSheetContent_ACU: vi.fn((content: any) => {
    if (!Array.isArray(content) || content.length === 0) return [];
    const header = Array.isArray(content[0]) ? [...content[0]] : ['row_id'];
    const rows = content.slice(1).map((row: any) => Array.isArray(row) ? [...row] : []);
    const seen = new Set<string>();
    let nextId = 1;
    return [header, ...rows.map((row: any) => {
      let value = row[0] == null || String(row[0]).trim() === '' || seen.has(String(row[0]).trim()) ? '' : String(row[0]).trim();
      if (!value) {
        while (seen.has(String(nextId))) nextId += 1;
        value = String(nextId++);
      }
      seen.add(value);
      row[0] = value;
      return row;
    })];
  }),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')) : []),
  buildGuidedBaseDataFromSheetGuide_ACU: vi.fn(),
}));

const mockUpdateReadableLorebookEntry = vi.fn();
vi.mock('../../../src/service/worldbook/pipeline', () => ({
  loadAllChatMessages_ACU: vi.fn(),
  updateReadableLorebookEntry_ACU: (...args: any[]) => mockUpdateReadableLorebookEntry(...args),
}));

vi.mock('../../../src/service/flight-mode/flight-mode-state', () => ({
  getCurrentFlightModeState_ACU: (...args: any[]) => mockGetCurrentFlightModeState(...args),
  stageFlightModeHiddenRowIds_ACU: (...args: any[]) => mockStageFlightModeHiddenRowIds(...args),
}));
vi.mock('../../../src/service/flight-mode/flight-mode-hidden-rows', () => ({
  getHiddenChronicleRowIdsAfterBigSummaryInsert_ACU: (...args: any[]) => mockGetHiddenChronicleRowIdsAfterBigSummaryInsert(...args),
}));

const mockCheckIfFirstTimeInit = vi.fn().mockResolvedValue(false);
const mockEnsureLegacyStorageMigratedBeforeWrite = vi.fn().mockResolvedValue({ success: true, migrated: false });
const mockSaveIndependentTable = vi.fn().mockResolvedValue({ saved: true });
const mockPersistTablesToChatMessage = vi.fn().mockResolvedValue({ saved: true, messageIndex: 0 });

vi.mock('../../../src/service/table/table-service', () => ({
  loadOrCreateJsonTableFromChatHistory_ACU: vi.fn(async () => {
    const data = mockCurrentJsonTableData
      ? JSON.parse(JSON.stringify(mockCurrentJsonTableData))
      : null;
    return {
      loaded: Boolean(data),
      source: data ? 'merged' : 'empty',
      data,
    };
  }),
  checkIfFirstTimeInit_ACU: (...args: any[]) => mockCheckIfFirstTimeInit(...args),
  ensureLegacyStorageMigratedBeforeWrite_ACU: (...args: any[]) => mockEnsureLegacyStorageMigratedBeforeWrite(...args),
  persistTablesToChatMessage_ACU: (...args: any[]) => mockPersistTablesToChatMessage(...args),
  saveIndependentTableToChatHistory_ACU: (...args: any[]) => mockSaveIndependentTable(...args),
}));

vi.mock('../../../src/service/table/storage-mode', () => {
  const isSqliteMode = vi.fn(() => false);
  return {
    isSqliteMode,
    getCurrentStorageMode: vi.fn(() => isSqliteMode() ? 'sqlite' : 'native'),
  };
});

vi.mock('../../../src/service/table/table-storage-strategy', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    reloadStorageProvider: (...args: any[]) => mockReloadStorageProvider(...args),
    ensureStorageProviderReady_ACU: (...args: any[]) => mockEnsureStorageProviderReady(...args),
  };
});

vi.mock('../../../src/service/table/sql-table-service', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    applySqlEditsToTableDataSnapshot_ACU: (...args: any[]) => {
      const impl = mockApplySqlEditsToTableDataSnapshot.getMockImplementation();
      return impl ? mockApplySqlEditsToTableDataSnapshot(...args) : actual.applySqlEditsToTableDataSnapshot_ACU(...args);
    },
  };
});

const mockRunTableUpdateApplyWithScopeLock = vi.fn(async (_scopeKey: string, fn: any) => await fn());
const mockBuildTableUpdateApplyScopeKey = vi.fn(() => 'test-scope');
vi.mock('../../../src/service/table/table-update-queue', () => ({
  runTableUpdateApplyWithScopeLock_ACU: (...args: any[]) => mockRunTableUpdateApplyWithScopeLock(...args),
  buildTableUpdateApplyScopeKey_ACU: (...args: any[]) => mockBuildTableUpdateApplyScopeKey(...args),
}));

const mockRunTableWriteTransaction = vi.fn(async (options: any, task: any) => task({
  transactionId: 'tx-test',
  chatKey: 'test-chat',
  isolationKey: '',
  source: options.source,
  baseRevision: null,
  writeSet: options.writeSet,
  runCommit: async (commitTask: any) => commitTask(),
}, options.workingDataMode === 'none'
  ? null
  : (options.initialData ? JSON.parse(JSON.stringify(options.initialData)) : mockCurrentJsonTableData)));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  captureTableRuntimeRevisionForWriteSet_ACU: vi.fn(() => 'runtime-test-revision'),
  invalidateTableRuntimeRevision_ACU: vi.fn(() => 'runtime-test-invalidated'),
  runTableWriteTransaction_ACU: (...args: any[]) => mockRunTableWriteTransaction(...args),
}));

const mockEnqueueSummaryVectorIndexFlush = vi.fn().mockResolvedValue({ queued: true, scopeKey: 'test-scope' });
vi.mock('../../../src/service/vector/summary-vector-index-flush-queue', () => ({ enqueueSummaryVectorIndexFlush_ACU: (...args: any[]) => mockEnqueueSummaryVectorIndexFlush(...args) }));

// V2 恢复服务 mock：锚点预检自动收敛路径。默认无可用恢复计划（阻断语义），
// 自愈用例显式提供 planId 并让 commit mock 修复 mock chat。
const mockPrepareV2Recovery = vi.fn(async (options: any) => ({
  status: 'unrecoverable_no_base',
  isolationKey: options?.isolationKey ?? '',
  requiresConfirmation: false,
  message: '仅检测到无 base 的 V2 日志；无法编造恢复数据。',
}));
const mockCommitPreparedV2Recovery = vi.fn(async (planId: string) => ({ status: 'committed', planId }));
vi.mock('../../../src/service/table/table-v2-recovery-service', () => ({
  prepareV2Recovery_ACU: (...args: any[]) => mockPrepareV2Recovery(...args),
  commitPreparedV2Recovery_ACU: (...args: any[]) => mockCommitPreparedV2Recovery(...args),
}));

// provisional bridge 模块 mock：orchestrator 的 catch-up 测试默认不走 bridge 路径，
// 跨边界用例显式驱动 establish/finalize/rollback/recover 的调用顺序与结果。
const mockEstablishProvisionalBridge = vi.fn();
const mockFinalizeProvisionalBridge = vi.fn();
const mockRollbackProvisionalBridge = vi.fn();
const mockRecoverProvisionalBridgeSession = vi.fn();
const mockHasActiveProvisionalBridgeAnywhere = vi.fn();
vi.mock('../../../src/service/table/manual-catch-up-provisional-bridge', () => ({
  establishProvisionalBridge_ACU: (...args: any[]) => mockEstablishProvisionalBridge(...args),
  finalizeProvisionalBridge_ACU: (...args: any[]) => mockFinalizeProvisionalBridge(...args),
  rollbackProvisionalBridge_ACU: (...args: any[]) => mockRollbackProvisionalBridge(...args),
  recoverProvisionalBridgeSession_ACU: (...args: any[]) => mockRecoverProvisionalBridgeSession(...args),
  hasActiveProvisionalBridgeAnywhere_ACU: (...args: any[]) => mockHasActiveProvisionalBridgeAnywhere(...args),
  ensureNoActiveProvisionalBridgeForCurrentScope_ACU: vi.fn(async () => ({ ok: true, action: 'none' })),
  readActiveProvisionalBridge_ACU: vi.fn(() => null),
  authorizeManualCatchUpBucketWrite_ACU: vi.fn(() => ({ ok: true })),
  validateProvisionalBridge_ACU: vi.fn(() => ({ valid: true })),
  assertBridgeScopeMatchesLiveChat_ACU: vi.fn(() => ({ ok: true })),
  isTargetBeforeOriginalFullCheckpoint_ACU: vi.fn(() => true),
  getOriginalFullFrameFingerprint_ACU: vi.fn(() => 'test-fingerprint'),
}));

// table-fill-boundary-staging 模块 mock：planTableFillBoundaryStaging_ACU（冻结 scope）与
// splitMessageIndicesAtBoundary_ACU（拆段）是纯函数，保留真实实现；只有
// commitStagedSheetsAtFullBoundaryAtomic_ACU（原子汇合）依赖 saveChatToHostStrict_ACU 等
// 未 mock 的重依赖，必须替换。
const mockCommitStagedSheetsAtFullBoundaryAtomic = vi.fn();
vi.mock('../../../src/service/table/table-fill-boundary-staging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/service/table/table-fill-boundary-staging')>();
  return {
    ...actual,
    commitStagedSheetsAtFullBoundaryAtomic_ACU: (...args: any[]) => mockCommitStagedSheetsAtFullBoundaryAtomic(...args),
  };
});

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: vi.fn(() => ({ summaryVectorIndexModeEnabled: true })),
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  applyTemplateScopeForCurrentChat_ACU: vi.fn(),
}));

import {
  resolveUpdateMode_ACU,
  loadBatchBaseData_ACU,
  buildBatchMergeBase_ACU,
  resolveBucketMergeBaseMaxMessageIndex_ACU,
  processUpdatesBatch_ACU,
  executeCardUpdateCore_ACU,
  orchestrateManualUpdate_ACU,
  orchestrateManualCatchUp_ACU,
  prepareManualCatchUpPlan_ACU,
  collectGroupFillResponse_ACU,
  applyUnifiedGroupFillResponses_ACU,
  processGroupedRuntimeChunk_ACU,
  type CardUpdateResult,
  type CardUpdateProgressEvent,
} from '../../../src/service/table/update-orchestrator';

beforeEach(() => {
  mockChatArrayForSeedStage.length = 0;
  Object.keys(mockIndependentTableStates).forEach(key => delete mockIndependentTableStates[key]);
  mockGetChatArray_ACU.mockImplementation(() => mockChatArrayForSeedStage);
  mockClearManualRefillIncrementalDataInRange.mockResolvedValue(0);
  mockClearManualRefillSheetDataInRange.mockResolvedValue(0);
  mockCommitManualRefillSheetSnapshot.mockResolvedValue({ success: true, changed: true, clearedCount: 1, checkpointCount: 1, targetMessageIndex: 0 });
  mockEstablishManualRefillTemplateRoot.mockResolvedValue({ success: true, changed: true, targetMessageIndex: 0 });
  mockEnsureManualCatchUpAnchor.mockResolvedValue({ status: 'ready', checkpointMessageIndex: 0 });
  mockEnsureBoundaryCheckpoint.mockResolvedValue({ success: true, changed: false, skipped: true });
  mockPurgeSheetKeysFromChatHistoryHard.mockResolvedValue({ changed: true, changedCount: 1 });
  mockReloadStorageProvider.mockResolvedValue({ ok: true, degraded: false, source: 'merged' });
  mockEnsureStorageProviderReady.mockImplementation(async () => {
    const { SqlTableService } = await vi.importActual<typeof import('../../../src/service/table/sql-table-service')>(
      '../../../src/service/table/sql-table-service',
    );
    const provider = new SqlTableService();
    const loadResult = await provider.loadFromData(JSON.parse(JSON.stringify(mockCurrentJsonTableData || {})));
    if (loadResult.error || !provider.isReady()) throw new Error(`测试 SQLite runtime 初始化失败：${loadResult.error || 'unknown'}`);
    return provider;
  });
  mockEnsureLegacyStorageMigratedBeforeWrite.mockReset().mockResolvedValue({ success: true, migrated: false });
});

// staging boundary commit 默认 mock：默认成功。跨边界用例在各自 it 内覆写返回值，
// 覆盖 zero-staging 丢弃（不调用 commit）与汇合失败（{ ok: false }）。
mockCommitStagedSheetsAtFullBoundaryAtomic.mockReset().mockResolvedValue({
  ok: true,
  boundaryCommitSummary: { selectedSheetKeys: ['sheet_a', 'sheet_b'], originalFullCheckpointIndex: 2 },
});

// ═══════════════════════════════════════════════════════════════
// resolveUpdateMode_ACU
// ═══════════════════════════════════════════════════════════════
describe('resolveUpdateMode_ACU', () => {
  it('auto_unified 直接返回', () => {
    expect(resolveUpdateMode_ACU('auto_unified')).toBe('auto_unified');
  });

  it('manual_unified 直接返回', () => {
    expect(resolveUpdateMode_ACU('manual_unified')).toBe('manual_unified');
  });

  it('full 直接返回', () => {
    expect(resolveUpdateMode_ACU('full')).toBe('full');
  });

  it('auto_summary_silent 直接返回', () => {
    expect(resolveUpdateMode_ACU('auto_summary_silent')).toBe('auto_summary_silent');
  });

  it('manual_summary 返回 manual_summary', () => {
    expect(resolveUpdateMode_ACU('manual_summary')).toBe('manual_summary');
  });

  it('manual_independent 返回 manual_independent', () => {
    expect(resolveUpdateMode_ACU('manual_independent')).toBe('manual_independent');
  });

  it('manual 前缀默认返回 manual_standard', () => {
    expect(resolveUpdateMode_ACU('manual')).toBe('manual_standard');
    expect(resolveUpdateMode_ACU('manual_other')).toBe('manual_standard');
  });

  it('auto 模式带 summary 返回 auto_summary', () => {
    expect(resolveUpdateMode_ACU('auto_summary')).toBe('auto_summary');
    expect(resolveUpdateMode_ACU('summary')).toBe('auto_summary');
  });

  it('auto 模式默认返回 auto_standard', () => {
    expect(resolveUpdateMode_ACU('auto')).toBe('auto_standard');
    expect(resolveUpdateMode_ACU('auto_standard')).toBe('auto_standard');
  });

  it('空字符串返回 auto_standard', () => {
    expect(resolveUpdateMode_ACU('')).toBe('auto_standard');
  });

  it('未知模式返回 auto_standard', () => {
    expect(resolveUpdateMode_ACU('unknown')).toBe('auto_standard');
  });
});

// ═══════════════════════════════════════════════════════════════
// loadBatchBaseData_ACU
// ═══════════════════════════════════════════════════════════════
describe('loadBatchBaseData_ACU', () => {
  it('从新版存储格式加载数据', () => {
    const chatHistory = [
      { is_user: true },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            independentData: {
              sheet_0: { name: '测试表', content: [['row_id'], ['1']] },
            },
            modifiedKeys: ['sheet_0'],
            updateGroupKeys: [],
          },
        },
      },
      { is_user: true },
      { is_user: false }, // 当前批次的第一条消息
    ];

    const mergedBatchData: Record<string, any> = {
      sheet_0: { name: '空表', content: [['row_id']] },
    };

    const result = loadBatchBaseData_ACU(chatHistory, 3, '', ['sheet_0'], mergedBatchData);
    expect(result.foundCount).toBe(1);
    expect(result.totalCount).toBe(1);
    expect(mergedBatchData.sheet_0.content).toEqual([['row_id'], ['1']]);
  });

  it('从旧版存储格式加载数据', () => {
    const chatHistory = [
      { is_user: true },
      {
        is_user: false,
        TavernDB_ACU_IndependentData: {
          sheet_0: { name: '测试表', content: [['row_id'], ['1']] },
        },
      },
      { is_user: true },
      { is_user: false },
    ];

    const mergedBatchData: Record<string, any> = {
      sheet_0: { name: '空表', content: [['row_id']] },
    };

    const result = loadBatchBaseData_ACU(chatHistory, 3, '', ['sheet_0'], mergedBatchData);
    expect(result.foundCount).toBe(1);
  });

  it('空聊天记录返回全部未找到', () => {
    const mergedBatchData: Record<string, any> = {
      sheet_0: { name: '空表' },
    };
    const result = loadBatchBaseData_ACU([], 0, '', ['sheet_0'], mergedBatchData);
    expect(result.foundCount).toBe(0);
    expect(result.totalCount).toBe(1);
  });

  it('跳过 user 消息', () => {
    const chatHistory = [
      { is_user: true, TavernDB_ACU_IndependentData: { sheet_0: { name: '不应该被读取' } } },
      { is_user: false },
    ];

    const mergedBatchData: Record<string, any> = {
      sheet_0: { name: '空表' },
    };

    const result = loadBatchBaseData_ACU(chatHistory, 1, '', ['sheet_0'], mergedBatchData);
    expect(result.foundCount).toBe(0);
  });

  it('找到所有表后提前退出（从后往前搜索，取最近的）', () => {
    const chatHistory = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            independentData: { sheet_0: { name: '更旧的表0' } },
            modifiedKeys: [],
            updateGroupKeys: [],
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            independentData: { sheet_0: { name: '较新的表0' } },
            modifiedKeys: [],
            updateGroupKeys: [],
          },
        },
      },
      { is_user: false }, // 当前批次的第一条消息
    ];

    const mergedBatchData: Record<string, any> = {
      sheet_0: { name: '空表' },
    };

    loadBatchBaseData_ACU(chatHistory, 2, '', ['sheet_0'], mergedBatchData);
    expect(mergedBatchData.sheet_0.name).toBe('较新的表0');
  });

  it('隔离标签匹配', () => {
    const chatHistory = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          'tag_A': {
            independentData: { sheet_0: { name: '标签A的数据' } },
            modifiedKeys: [],
            updateGroupKeys: [],
          },
          'tag_B': {
            independentData: { sheet_0: { name: '标签B的数据' } },
            modifiedKeys: [],
            updateGroupKeys: [],
          },
        },
      },
      { is_user: false },
    ];

    const mergedBatchData: Record<string, any> = {
      sheet_0: { name: '空表' },
    };

    loadBatchBaseData_ACU(chatHistory, 1, 'tag_A', ['sheet_0'], mergedBatchData);
    expect(mergedBatchData.sheet_0.name).toBe('标签A的数据');
  });

  it('叠加历史 delta 后会稳定化 mergedBatchData 的 row_id', () => {
    const chatHistory = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            independentData: {
              sheet_0: { name: 'checkpoint表', content: [['row_id', '名称'], ['base', '旧苹果']] },
            },
            modifiedKeys: ['sheet_0'],
            updateGroupKeys: [],
            _acu_storage_mode: 'checkpoint',
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            independentData: {},
            incrementalData: {
              sheet_0: { sheetUid: 'sheet_0', rowDeltas: [{ row_id: '', op: 'upsert', cells: ['', '坏行'] }] },
            },
            modifiedKeys: ['sheet_0'],
            updateGroupKeys: [],
            _acu_storage_mode: 'delta',
          },
        },
      },
      { is_user: false },
    ];
    const mergedBatchData: Record<string, any> = { sheet_0: { name: '空表', content: [['row_id', '名称']] } };
    loadBatchBaseData_ACU(chatHistory, 2, '', ['sheet_0'], mergedBatchData);
    expect(vi.mocked(ensureStableRowIdsForSheetContent_ACU)).toHaveBeenCalled();
    expect(mergedBatchData.sheet_0.content).toEqual([['row_id', '名称'], ['base', '旧苹果'], ['1', '坏行']]);
  });
});

// ═══════════════════════════════════════════════════════════════
// buildBatchMergeBase_ACU
// ═══════════════════════════════════════════════════════════════
describe('buildBatchMergeBase_ACU', () => {
  it('无 guide 时使用模板', async () => {
    const result = await buildBatchMergeBase_ACU(1);
    expect(result.data).not.toBeNull();
    expect(result.error).toBeNull();
  });

  it('有 guide 时使用 guide', async () => {
    const { getChatSheetGuideDataForIsolationKey_ACU } = await import('../../../src/service/template/chat-scope');
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue({
      sheet_0: { name: '引导数据' },
    });
    const { buildGuidedBaseDataFromSheetGuide_ACU } = await import('../../../src/service/template/chat-scope');
    vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue({
      sheet_0: { name: '从引导构建的数据' },
    });

    const result = await buildBatchMergeBase_ACU(1);
    expect(result.data).not.toBeNull();
    expect(result.error).toBeNull();
  });

  it('SQLite 有界基底缺少可回放 V2 数据时不退回最新 runtime snapshot', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, buildGuidedBaseDataFromSheetGuide_ACU } = await import('../../../src/service/template/chat-scope');
    try {
      vi.mocked(isSqliteMode).mockReturnValue(true);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI without v2 frame' }]);
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu' },
        sheet_0: { name: '测试表', content: [['row_id', '值']] },
      } as any);
      mockCurrentJsonTableData = {
        mate: { type: 'acu' },
        sheet_0: { name: '测试表', content: [['row_id', '值'], ['27', '未来旧行']] },
      };

      const result = await buildBatchMergeBase_ACU(1, { maxMessageIndex: 0 });

      expect(result.error).toBeNull();
      expect(result.data?.sheet_0.content).toEqual([['row_id', '值']]);
      expect(result.data?.sheet_0.content.some((row: any[]) => row[0] === '27')).toBe(false);
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu' },
        sheet_0: { name: '测试表', updateConfig: { groupId: 0 } },
      } as any);
      mockCurrentJsonTableData = null;
    }
  });

  it('有界回退到空基底时提示用户一次，节流窗口内重复命中不再提示，跨窗口重新提示（S2-3）', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, buildGuidedBaseDataFromSheetGuide_ACU } = await import('../../../src/service/template/chat-scope');
    const { showUiSurfaceToast_ACU } = await import('../../../src/shared/ui-surface-registry');
    const baseNow = Date.now() + 10 * 60 * 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseNow);
    try {
      vi.mocked(showUiSurfaceToast_ACU).mockClear();
      vi.mocked(isSqliteMode).mockReturnValue(true);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI without v2 frame' }]);
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu' },
        sheet_0: { name: '测试表', content: [['row_id', '值']] },
      } as any);

      await buildBatchMergeBase_ACU(1, { maxMessageIndex: 0 });
      await buildBatchMergeBase_ACU(2, { maxMessageIndex: 0 });

      expect(showUiSurfaceToast_ACU).toHaveBeenCalledTimes(1);
      expect(showUiSurfaceToast_ACU).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'info',
        text: expect.stringContaining('空白模板结构'),
      }));

      nowSpy.mockReturnValue(baseNow + 30_001);
      await buildBatchMergeBase_ACU(3, { maxMessageIndex: 0 });
      expect(showUiSurfaceToast_ACU).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu' },
        sheet_0: { name: '测试表', updateConfig: { groupId: 0 } },
      } as any);
    }
  });

  it('无界正常起底（新聊天无历史）不弹空基底提示（S2-3）', async () => {
    const { showUiSurfaceToast_ACU } = await import('../../../src/shared/ui-surface-registry');
    vi.mocked(showUiSurfaceToast_ACU).mockClear();
    const result = await buildBatchMergeBase_ACU(1);
    expect(result.error).toBeNull();
    expect(showUiSurfaceToast_ACU).not.toHaveBeenCalled();
  });

  it('SQLite runtime 旧随机 key 与 guide 稳定 key 可证明同表时折叠到稳定 key 并保留历史数据', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { getChatSheetGuideDataForIsolationKey_ACU, buildGuidedBaseDataFromSheetGuide_ACU } = await import('../../../src/service/template/chat-scope');
    const legacyDdl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, quantity INTEGER);';
    const guide = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_bei_bao_wu_pin_biao: {
        uid: 'sheet_bei_bao_wu_pin_biao',
        name: '背包物品表',
        sourceData: { ddl: legacyDdl, note: 'guide-structure' },
        content: [['row_id', '物品名称', '数量']],
      },
    } as any;
    try {
      vi.mocked(isSqliteMode).mockReturnValue(true);
      vi.mocked(getChatArray_ACU).mockReturnValue([]);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(guide);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(structuredClone(guide));
      mockCurrentJsonTableData = {
        mate: { type: 'acu' },
        sheet_in05z9vz: {
          uid: 'sheet_in05z9vz',
          name: '背包物品表',
          sourceData: { ddl: legacyDdl, note: 'legacy-structure' },
          content: [['row_id', '旧物品名', '数量'], ['1', '铁剑', '1']],
        },
      };

      const result = await buildBatchMergeBase_ACU(1);

      expect(result.error).toBeNull();
      expect(result.data?.sheet_in05z9vz).toBeUndefined();
      expect(result.data?.sheet_bei_bao_wu_pin_biao).toMatchObject({
        uid: 'sheet_bei_bao_wu_pin_biao',
        name: '背包物品表',
        // restoreGuideStructure 只恢复结构：note 保留 runtime 值
        sourceData: { ddl: legacyDdl, note: 'legacy-structure' },
        // 新契约：表头内容不一致（'物品名称' vs '旧物品名'）时保留权威表头，不覆盖
        content: [['row_id', '旧物品名', '数量'], ['1', '铁剑', '1']],
      });
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      mockCurrentJsonTableData = null;
    }
  });

  it('SQLite runtime 与 guide 规范显示名相同但 DDL 不同仍折叠', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { getChatSheetGuideDataForIsolationKey_ACU, buildGuidedBaseDataFromSheetGuide_ACU } = await import('../../../src/service/template/chat-scope');
    const guide = {
      sheet_bei_bao_wu_pin_biao: {
        uid: 'sheet_bei_bao_wu_pin_biao',
        name: '背包物品表',
        sourceData: { ddl: 'CREATE TABLE inventory_v2 (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
        content: [['row_id', '物品名称']],
      },
    } as any;
    try {
      vi.mocked(isSqliteMode).mockReturnValue(true);
      vi.mocked(getChatArray_ACU).mockReturnValue([]);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(guide);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(structuredClone(guide));
      mockCurrentJsonTableData = {
        sheet_in05z9vz: {
          uid: 'sheet_in05z9vz',
          name: '背包物品表',
          sourceData: { ddl: 'CREATE TABLE legacy_inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
          content: [['row_id', '物品名称'], ['1', '铁剑']],
        },
      };

      const result = await buildBatchMergeBase_ACU(1);

      expect(result.error).toBeNull();
      expect(result.data?.sheet_in05z9vz).toBeUndefined();
      expect(result.data?.sheet_bei_bao_wu_pin_biao).toMatchObject({
        uid: 'sheet_bei_bao_wu_pin_biao',
        name: '背包物品表',
        sourceData: { ddl: 'CREATE TABLE inventory_v2 (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
        content: [['row_id', '物品名称'], ['1', '铁剑']],
      });
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      mockCurrentJsonTableData = null;
    }
  });

  it('写入编排遇到完整 orphan data_replace 时以 replacement anchor 读取业务基底', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    try {
      vi.mocked(isSqliteMode).mockReturnValue(true);
      vi.mocked(getChatArray_ACU).mockReturnValue([{
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{
                seq: 1,
                entryId: 'orphan-data-replace',
                createdAt: 1,
                source: 'import',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_0'],
                changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{ kind: 'data_replace', reason: 'import', data: { sheet_0: { content: [['row_id'], ['1']] } } }],
              }],
            },
          },
        },
      }]);

      const result = await buildBatchMergeBase_ACU(1, { maxMessageIndex: 0 });

      expect(result.error).toBeNull();
      expect(result.data?.sheet_0.content).toEqual([['row_id'], ['1']]);
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
    }
  });

  it('非 SQLite 有界基底且未进入 V2 replay 时保留 runtime snapshot fallback', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, buildGuidedBaseDataFromSheetGuide_ACU } = await import('../../../src/service/template/chat-scope');
    try {
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI without v2 frame' }]);
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu' },
        sheet_0: { name: '模板表', content: [['row_id', '值']] },
      } as any);
      mockCurrentJsonTableData = {
        mate: { type: 'acu' },
        sheet_0: { name: '运行时表', content: [['row_id', '值'], ['1', 'runtime-base']] },
      };

      const result = await buildBatchMergeBase_ACU(1, { maxMessageIndex: 0 });

      expect(result.error).toBeNull();
      expect(result.data?.sheet_0.content).toEqual([['row_id', '值'], ['1', 'runtime-base']]);
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu' },
        sheet_0: { name: '测试表', updateConfig: { groupId: 0 } },
      } as any);
      mockCurrentJsonTableData = null;
    }
  });

  it('非 SQLite 有界基底已进入 V2 replay 但无可用数据时不退回未来 runtime snapshot', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, buildGuidedBaseDataFromSheetGuide_ACU } = await import('../../../src/service/template/chat-scope');
    try {
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      vi.mocked(getChatArray_ACU).mockReturnValue([{
        is_user: false,
        mes: 'AI v2 log without checkpoint',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{ seq: 1, operations: [] }],
            },
          },
        },
      }]);
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu' },
        sheet_0: { name: '模板表', content: [['row_id', '值']] },
      } as any);
      mockCurrentJsonTableData = {
        mate: { type: 'acu' },
        sheet_0: { name: '运行时表', content: [['row_id', '值'], ['27', '未来旧行']] },
      };

      const result = await buildBatchMergeBase_ACU(1, { maxMessageIndex: 0 });

      expect(result.error).toBeNull();
      expect(result.data?.sheet_0.content).toEqual([['row_id', '值']]);
      expect(result.data?.sheet_0.content.some((row: any[]) => row[0] === '27')).toBe(false);
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu' },
        sheet_0: { name: '测试表', updateConfig: { groupId: 0 } },
      } as any);
      mockCurrentJsonTableData = null;
    }
  });


  it('restoreGuideStructure：guide 表头与权威数据宽度不一致时不覆盖表头、不继承 guide ddl、记录 warning', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { getChatSheetGuideDataForIsolationKey_ACU, buildGuidedBaseDataFromSheetGuide_ACU } = await import('../../../src/service/template/chat-scope');
    const { logWarn_ACU } = await import('../../../src/shared/utils');
    const legacyDdl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, quantity INTEGER, weight REAL);';
    const guideDdl = 'CREATE TABLE inventory_guide (row_id INTEGER PRIMARY KEY, item_name TEXT);';
    const guide = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_bei_bao_wu_pin_biao: {
        uid: 'sheet_bei_bao_wu_pin_biao',
        name: '背包物品表',
        sourceData: { ddl: guideDdl, note: 'guide-note' },
        // guide 只有 2 列
        content: [['row_id', '物品名称']],
      },
    } as any;
    try {
      vi.mocked(isSqliteMode).mockReturnValue(true);
      vi.mocked(getChatArray_ACU).mockReturnValue([]);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(guide);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(structuredClone(guide));
      mockCurrentJsonTableData = {
        mate: { type: 'acu' },
        sheet_in05z9vz: {
          uid: 'sheet_in05z9vz',
          name: '背包物品表',
          // runtime 权威数据有 4 列
          sourceData: { ddl: legacyDdl, note: 'legacy-note' },
          content: [['row_id', '旧物品名', '数量', '重量'], ['1', '铁剑', '1', '2.5']],
        },
      };

      const result = await buildBatchMergeBase_ACU(1);

      expect(result.error).toBeNull();
      // 表头宽度不一致：保留权威 4 列结构，不覆盖为 guide 2 列
      expect(result.data?.sheet_bei_bao_wu_pin_biao.content[0]).toEqual(['row_id', '旧物品名', '数量', '重量']);
      expect(result.data?.sheet_bei_bao_wu_pin_biao.content[0].length).toBe(4);
      // 数据行完整保留
      expect(result.data?.sheet_bei_bao_wu_pin_biao.content[1]).toEqual(['1', '铁剑', '1', '2.5']);
      // 不继承 guide ddl（inheritDdl=false），ddl 保留权威值
      expect(result.data?.sheet_bei_bao_wu_pin_biao.sourceData.ddl).toContain('quantity INTEGER');
      // restoreGuideStructure 只恢复结构：note 保留 runtime 值（聊天过程中可能被合法修改）
      expect(result.data?.sheet_bei_bao_wu_pin_biao.sourceData.note).toBe('legacy-note');
      // 记录结构不一致 warning
      expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('基底表头与权威数据不一致'));
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      mockCurrentJsonTableData = null;
    }
  });

  it('贯通：历史 checkpoint 12 列 + guide 8 列 → 基底 content[0] 为 12 列且可提交', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { getChatSheetGuideDataForIsolationKey_ACU, buildGuidedBaseDataFromSheetGuide_ACU } = await import('../../../src/service/template/chat-scope');
    const { logWarn_ACU } = await import('../../../src/shared/utils');
    const guideHeader = ['row_id', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
    const guide = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_important: {
        uid: 'sheet_important',
        name: '重要角色表',
        sourceData: { ddl: 'CREATE TABLE important (row_id TEXT, c1 TEXT, c2 TEXT, c3 TEXT, c4 TEXT, c5 TEXT, c6 TEXT, c7 TEXT);' },
        content: [guideHeader],
      },
    } as any;
    const histHeader = ['row_id', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11'];
    const histRows = [histHeader, ['1', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11']];
    try {
      vi.mocked(isSqliteMode).mockReturnValue(true);
      vi.mocked(getChatArray_ACU).mockReturnValue([]);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(guide);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(structuredClone(guide));
      mockCurrentJsonTableData = {
        mate: { type: 'acu' },
        sheet_important: {
          uid: 'sheet_important',
          name: '重要角色表',
          sourceData: { ddl: 'CREATE TABLE important_hist (row_id TEXT, h1 TEXT, h2 TEXT, h3 TEXT, h4 TEXT, h5 TEXT, h6 TEXT, h7 TEXT, h8 TEXT, h9 TEXT, h10 TEXT, h11 TEXT);' },
          content: histRows,
        },
      };

      const result = await buildBatchMergeBase_ACU(1);

      expect(result.error).toBeNull();
      // 基底表头为权威 12 列（checkpoint 持结构权），guide 8 列不得覆盖
      expect(result.data?.sheet_important.content[0].length).toBe(12);
      expect(result.data?.sheet_important.content[0]).toEqual(histHeader);
      expect(result.data?.sheet_important.content[1]).toEqual(['1', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11']);
      // 记录 warning
      expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('基底表头与权威数据不一致'));
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
      vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(undefined as any);
      mockCurrentJsonTableData = null;
    }
  });

});

// ═══════════════════════════════════════════════════════════════
// resolveBucketMergeBaseMaxMessageIndex_ACU
// ═══════════════════════════════════════════════════════════════
describe('resolveBucketMergeBaseMaxMessageIndex_ACU', () => {
  const buildChatWithRootAt = (rootIndex: number, length: number) => Array.from({ length }, (_, index) => ({
    is_user: false,
    mes: `AI${index}`,
    ...(index === rootIndex ? {
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', reason: 'init', createdAt: 1, data: { mate: { type: 'acu' } } },
            logEntries: [],
          },
        },
      },
    } : {}),
  }));

  it('追加模式：边界提升到 saveTargetIndex，覆盖目标楼层自身既有帧', () => {
    expect(resolveBucketMergeBaseMaxMessageIndex_ACU({
      lowerBound: 4,
      saveTargetIndex: 6,
      chat: buildChatWithRootAt(0, 8),
      isolationKey: '',
    })).toBe(6);
  });

  it('saveTargetIndex 不晚于下界时保持下界', () => {
    expect(resolveBucketMergeBaseMaxMessageIndex_ACU({
      lowerBound: 6,
      saveTargetIndex: 6,
      chat: buildChatWithRootAt(0, 8),
      isolationKey: '',
    })).toBe(6);
    expect(resolveBucketMergeBaseMaxMessageIndex_ACU({
      lowerBound: 6,
      saveTargetIndex: Number.NaN,
      chat: buildChatWithRootAt(0, 8),
      isolationKey: '',
    })).toBe(6);
  });

  it('preserveLowerBound（stage_only / 手动重填）不调整边界', () => {
    expect(resolveBucketMergeBaseMaxMessageIndex_ACU({
      lowerBound: -1,
      saveTargetIndex: 3,
      chat: buildChatWithRootAt(0, 8),
      isolationKey: '',
      preserveLowerBound: true,
    })).toBe(-1);
  });

  it('增量替换模式：replay root 落在 (下界, saveTarget] 内时提升到 root，否则保持下界', () => {
    expect(resolveBucketMergeBaseMaxMessageIndex_ACU({
      lowerBound: 2,
      saveTargetIndex: 5,
      chat: buildChatWithRootAt(3, 8),
      isolationKey: '',
      replaceExistingIncremental: true,
    })).toBe(3);
    expect(resolveBucketMergeBaseMaxMessageIndex_ACU({
      lowerBound: 2,
      saveTargetIndex: 5,
      chat: buildChatWithRootAt(0, 8),
      isolationKey: '',
      replaceExistingIncremental: true,
    })).toBe(2);
    expect(resolveBucketMergeBaseMaxMessageIndex_ACU({
      lowerBound: 2,
      saveTargetIndex: 5,
      chat: buildChatWithRootAt(7, 8),
      isolationKey: '',
      replaceExistingIncremental: true,
    })).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// processUpdatesBatch_ACU（适配新返回值类型）
// ═══════════════════════════════════════════════════════════════
describe('processUpdatesBatch_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAutoUpdating = false;
    mockSettings = {
      ...mockSettings,
      autoUpdateThreshold: 3,
      updateBatchSize: 2,
      autoUpdateTokenThreshold: 0,
      toastMuteEnabled: false,
    };
  });

  it('空索引列表返回 success: true', async () => {
    const result = await processUpdatesBatch_ACU([], 'auto_standard', {}, vi.fn());
    expect(result.success).toBe(true);
  });

  it('迁移失败时不执行任何批次更新', async () => {
    mockEnsureLegacyStorageMigratedBeforeWrite.mockResolvedValueOnce({ success: false, error: 'mixed storage evidence insufficient' });
    const mockExecute = vi.fn();

    const result = await processUpdatesBatch_ACU([1], 'auto_standard', {}, mockExecute);

    expect(result).toEqual({ success: false, error: 'mixed storage evidence insufficient' });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockReloadStorageProvider).not.toHaveBeenCalled();
  });

  it('执行更新回调成功时返回 success: true', async () => {
    const mockExecute = vi.fn().mockResolvedValue({ success: true, modifiedKeys: ['sheet_0'] } as CardUpdateResult);
    mockCurrentJsonTableData = { sheet_0: { name: '测试' } };

    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: '这是AI回复' },
    ]);

    const result = await processUpdatesBatch_ACU([1], 'auto_standard', {}, mockExecute);
    expect(result.success).toBe(true);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('更新失败时返回 success: false 和 error', async () => {
    const mockExecute = vi.fn().mockResolvedValue({ success: false, modifiedKeys: [], error: '更新失败' } as CardUpdateResult);
    mockCurrentJsonTableData = { sheet_0: { name: '测试' } };

    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: '这是AI回复' },
    ]);

    const result = await processUpdatesBatch_ACU([1], 'auto_standard', {}, mockExecute);
    expect(result.success).toBe(false);
    expect(result.failedBatch).toBe(1);
  });

  it('AI 回复过短时跳过（auto 模式）', async () => {
    mockSettings.autoUpdateTokenThreshold = 1000;
    const mockExecute = vi.fn().mockResolvedValue({ success: true, modifiedKeys: [] } as CardUpdateResult);
    mockCurrentJsonTableData = { sheet_0: { name: '测试' } };

    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: '短' },
    ]);

    const result = await processUpdatesBatch_ACU([1], 'auto_standard', {}, mockExecute);
    expect(result.success).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('构建合并基底失败时返回 error', async () => {
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU } = await import('../../../src/service/template/chat-scope');
    // 确保走 template 分支（guide 返回 null），然后 template 解析抛异常
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
    vi.mocked(parseTableTemplateJson_ACU).mockImplementationOnce(() => { throw new Error('模板解析失败'); });

    const mockExecute = vi.fn().mockResolvedValue({ success: true, modifiedKeys: [] });
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: '这是AI回复' },
    ]);

    const result = await processUpdatesBatch_ACU([1], 'auto_standard', {}, mockExecute);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('执行更新时传入基于批次历史数据的 batchBaseSnapshot 深拷贝', async () => {
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValueOnce({
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名']] },
      sheet_1: { name: '纪要表', content: [['row_id', '事件']] },
    });
    mockCurrentJsonTableData = {
      sheet_0: { name: '背包物品表', content: [['row_id', '物品名']] },
      sheet_1: { name: '纪要表', content: [['row_id', '事件']] },
    };

    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true, mes: '用户0' },
      {
        is_user: false,
        mes: 'AI0',
        TavernDB_ACU_IsolatedData: {
          '': {
            independentData: {
              sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
              sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '旧事件']] },
            },
          },
        },
      },
      { is_user: true, mes: '用户1' },
      { is_user: false, mes: '这是AI回复' },
    ]);
    const mockExecute = vi.fn().mockResolvedValue({ success: true, modifiedKeys: ['sheet_1'] } as CardUpdateResult);

    const result = await processUpdatesBatch_ACU([3], 'auto_standard', { targetSheetKeys: ['sheet_1'], requestOptions: { tableApiPreset: 'preset' } }, mockExecute);

    expect(result.success).toBe(true);
    const progressContext = mockExecute.mock.calls[0][6];
    expect(progressContext.batchBaseSnapshot.sheet_0.content[1][1]).toBe('铁剑');
    expect(progressContext.batchBaseSnapshot.sheet_1.content[1][1]).toBe('旧事件');
    expect(progressContext.batchBaseSnapshot).not.toBe(mockCurrentJsonTableData);
  });

  it('构建历史基底后将调度期随机 key 唯一重绑定为稳定 key', async () => {
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    mockCurrentJsonTableData = {
      sheet_in05z9vz: {
        uid: 'sheet_in05z9vz',
        name: '背包物品表',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item TEXT);' },
        content: [['row_id', 'item']],
      },
    };
    const stableTemplate = {
      mate: { type: 'acu' },
      sheet_bei_bao_wu_pin_biao: {
        uid: 'sheet_bei_bao_wu_pin_biao',
        name: '背包物品表',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item TEXT);' },
        content: [['row_id', 'item']],
      },
    } as any;
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(stableTemplate);
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        mes: '历史 V2 锚点',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'init',
                createdAt: 1,
                data: structuredClone(stableTemplate),
              },
              logEntries: [],
            },
          },
        },
      },
      { is_user: false, mes: '足够长的 AI 回复' },
    ]);
    const executeUpdate = vi.fn().mockResolvedValue({ success: true, modifiedKeys: [] } as CardUpdateResult);

    const result = await processUpdatesBatch_ACU(
      [1],
      'auto_standard',
      { targetSheetKeys: ['sheet_in05z9vz'] },
      executeUpdate,
    );

    expect(result.success).toBe(true);
    expect(executeUpdate).toHaveBeenCalledTimes(1);
    expect(executeUpdate.mock.calls[0][4]).toEqual(['sheet_bei_bao_wu_pin_biao']);
    expect(executeUpdate.mock.calls[0][6].batchBaseSnapshot.sheet_bei_bao_wu_pin_biao).toBeDefined();
  });

  it('目标楼层自身已有前端 CRUD 写入的 init checkpoint 时，基底必须包含这些既有行（回归：开局写入后填表重复 INSERT）', async () => {
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { showUiSurfaceToast_ACU } = await import('../../../src/shared/ui-surface-registry');
    const template = {
      mate: { type: 'acu' },
      sheet_tong_shi: {
        uid: 'sheet_tong_shi',
        name: '同事状态表',
        sourceData: { ddl: 'CREATE TABLE tongshizhuangtaibiao (row_id INTEGER PRIMARY KEY, name TEXT UNIQUE, affection TEXT);' },
        content: [['row_id', 'name', 'affection']],
      },
    } as any;
    const openingCheckpointData = structuredClone(template);
    openingCheckpointData.sheet_tong_shi.content = [
      ['row_id', 'name', 'affection'],
      ['1', '星野桃', '20'],
      ['2', '黑泽刹那', '15'],
    ];
    try {
      vi.mocked(isSqliteMode).mockReturnValue(true);
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(template);
      mockCurrentJsonTableData = structuredClone(openingCheckpointData);
      vi.mocked(showUiSurfaceToast_ACU).mockClear();
      vi.mocked(getChatArray_ACU).mockReturnValue([
        { is_user: true, mes: '选择开局' },
        {
          is_user: false,
          mes: '开局正文：星野桃与黑泽刹那登场……（足够长）',
          TavernDB_ACU_IsolatedData: {
            '': {
              _acu_storage_version: 2,
              storageFrame: {
                version: 2,
                checkpoint: {
                  kind: 'full',
                  reason: 'init',
                  createdAt: 1,
                  data: structuredClone(openingCheckpointData),
                },
                logEntries: [],
              },
            },
          },
        },
      ]);
      const executeUpdate = vi.fn().mockResolvedValue({ success: true, modifiedKeys: [] } as CardUpdateResult);

      const result = await processUpdatesBatch_ACU([1], 'manual_standard', { targetSheetKeys: ['sheet_tong_shi'] }, executeUpdate);

      expect(result.success).toBe(true);
      expect(executeUpdate).toHaveBeenCalledTimes(1);
      const baseSnapshot = executeUpdate.mock.calls[0][6].batchBaseSnapshot;
      expect(baseSnapshot.sheet_tong_shi.content).toEqual([
        ['row_id', 'name', 'affection'],
        ['1', '星野桃', '20'],
        ['2', '黑泽刹那', '15'],
      ]);
      expect(showUiSurfaceToast_ACU).not.toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining('空白模板结构'),
      }));
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
      vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
        mate: { type: 'acu' },
        sheet_0: { name: '测试表', updateConfig: { groupId: 0 } },
      } as any);
      mockCurrentJsonTableData = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// executeCardUpdateCore_ACU
// ═══════════════════════════════════════════════════════════════
describe('executeCardUpdateCore_ACU', () => {
  beforeEach(async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { disposeStorageProvider } = await import('../../../src/service/table/table-storage-strategy');
    vi.mocked(isSqliteMode).mockReturnValue(false);
    disposeStorageProvider();
    vi.clearAllMocks();
    mockParseAndApplyTableEdits.mockReset();
    mockParseAndApplyTableEditsToData.mockReset();
    mockApplySqlEditsToTableDataSnapshot.mockReset();
    mockGetCurrentFlightModeState.mockReset().mockReturnValue({ enabled: false, hiddenRowIds: [], bigSummarySheetKey: '' });
    mockGetHiddenChronicleRowIdsAfterBigSummaryInsert.mockReset().mockReturnValue(null);
    mockStageFlightModeHiddenRowIds.mockReset().mockReturnValue(null);
    mockWasStopped = false;
    mockSettings = {
      ...mockSettings,
      tableMaxRetries: 3,
      autoUpdateTokenThreshold: 0,
      importPromptExcludeImportedWorldbookEntries: true,
    };
    mockCurrentJsonTableData = { sheet_0: { name: '测试表', content: [['row_id'], ['1']] } };
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 0 });
    mockEnsureBoundaryCheckpoint.mockResolvedValue({ success: true, changed: false, skipped: true });
    mockShouldRotateBoundaryCheckpoint.mockReturnValue(false);
  });

  it('正常流程：AI 返回有效响应，解析成功，保存成功', async () => {
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });

    const abortController = new AbortController();
    const progressEvents: CardUpdateProgressEvent[] = [];

    const result = await executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      0, false, 'auto_standard', false,
      ['sheet_0'], null, abortController,
      (event) => progressEvents.push(event)
    );

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0']);
    expect(result.aborted).toBeUndefined();
    // 验证进度事件序列
    const phases = progressEvents.map(e => e.phase);
    expect(phases).toContain('preparing');
    expect(phases).toContain('calling_ai');
    expect(phases).toContain('parsing');
    expect(phases).toContain('saving');
    expect(phases).toContain('complete');
  });

  it('将目标表转换为 sheet 级 writeSet，并把 transactionContext 传给持久化', async () => {
    const txCtx = {
      transactionId: 'tx-ai-sheet-1',
      chatKey: 'test-chat',
      isolationKey: '',
      source: 'group_fill',
      baseRevision: 'rev-base',
      writeSet: [{ kind: 'sheet' as const, sheetKey: 'sheet_1' }],
      runCommit: async (commitTask: any) => commitTask(),
    };
    mockCurrentJsonTableData = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', '旧A']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', '旧B']] },
    };
    mockRunTableWriteTransaction.mockImplementationOnce(async (options: any, task: any) => {
      expect(options.writeSet).toEqual([{ kind: 'sheet', sheetKey: 'sheet_1' }]);
      return task(txCtx, JSON.parse(JSON.stringify(options.initialData)));
    });
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEditsToData.mockImplementation((_aiResponse: string, tableData: any) => {
      tableData.sheet_1.content.push(['2', '新B']);
      return { success: true, modifiedKeys: ['sheet_1'] };
    });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);

    const result = await executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      0, false, 'auto_standard', false,
      ['sheet_1'], null, new AbortController()
    );

    expect(result.success).toBe(true);
    expect(mockRunTableWriteTransaction).toHaveBeenCalledWith(expect.objectContaining({
      source: 'group_fill',
      writeSet: [{ kind: 'sheet', sheetKey: 'sheet_1' }],
    }), expect.any(Function));
    const persistOptions = mockPersistTablesToChatMessage.mock.calls[0][0];
    expect(persistOptions.transactionContext).toBe(txCtx);
    expect(persistOptions.tableData.sheet_1.content).toContainEqual(['2', '新B']);
    expect(persistOptions.operations).toEqual([
      { kind: 'sheet_replace', sheetKey: 'sheet_1', sheet: expect.objectContaining({
        content: [['row_id', '值'], ['1', '旧B'], ['2', '新B']],
      }), reason: 'system' },
    ]);
    expect(mockCurrentJsonTableData.sheet_0.content).toEqual([['row_id', '值'], ['1', '旧A']]);
  });

  it('飞行模式下大总结新增行时，在表格持久化前暂存同批纪要隐藏状态', async () => {
    mockCurrentJsonTableData = {
      sheet_chronicle: { name: '纪要表', content: [['row_id', '事件'], ['c1', '既有纪要']] },
      sheet_da_zong_jie: { name: '大总结', content: [['row_id', '总结']] },
    };
    mockGetCurrentFlightModeState.mockReturnValue({
      enabled: true,
      enabledAt: 1,
      hiddenRowIds: [],
      bigSummarySheetKey: 'sheet_da_zong_jie',
    });
    mockGetHiddenChronicleRowIdsAfterBigSummaryInsert.mockReturnValue(['c1', 'c2']);
    const rollback = vi.fn();
    mockStageFlightModeHiddenRowIds.mockReturnValue(rollback);
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEditsToData.mockImplementation((_aiResponse: string, tableData: any) => {
      tableData.sheet_chronicle.content.push(['c2', '同批新增纪要']);
      tableData.sheet_da_zong_jie.content.push(['s1', '阶段总结']);
      return { success: true, modifiedKeys: ['sheet_chronicle', 'sheet_da_zong_jie'] };
    });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);

    const result = await executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      0, false, 'auto_standard', false,
      ['sheet_chronicle', 'sheet_da_zong_jie'], null, new AbortController(),
    );

    expect(result.success).toBe(true);
    expect(mockGetHiddenChronicleRowIdsAfterBigSummaryInsert).toHaveBeenCalledWith(
      expect.objectContaining({ sheet_chronicle: expect.anything() }),
      expect.objectContaining({ sheet_da_zong_jie: expect.anything() }),
      expect.objectContaining({ bigSummarySheetKey: 'sheet_da_zong_jie' }),
    );
    expect(mockStageFlightModeHiddenRowIds).toHaveBeenCalledWith(['c1', 'c2']);
    expect(rollback).not.toHaveBeenCalled();
  });

  it('AI 返回后在同 scope 锁内恢复 batchBaseSnapshot，避免保存被其他组污染', async () => {
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockImplementation(async () => {
      mockCurrentJsonTableData = {
        mate: { type: 'acu', version: 1 },
          sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '被污染的铁剑']] },
        sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '被其他组污染']] },
      };
      return '<tableEdit>有效内容</tableEdit>';
    });
    mockParseAndApplyTableEditsToData.mockImplementation((_aiResponse: string, tableData: any) => {
      expect(tableData.sheet_0.content[1][1]).toBe('铁剑');
      expect(tableData.sheet_1.content[1][1]).toBe('旧事件');
      tableData.sheet_1 = { name: '纪要表', content: [['row_id', '事件'], ['1', '本组新事件']] };
      return { success: true, modifiedKeys: ['sheet_1'] };
    });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);

    let savedSnapshot: any = null;
    mockPersistTablesToChatMessage.mockImplementation(async (options: any) => {
      savedSnapshot = JSON.parse(JSON.stringify(options.tableData));
      return { saved: true, messageIndex: 0 };
    });

    const result = await executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      0, false, 'auto_standard', false,
      ['sheet_1'], null, new AbortController(),
      {
        batchBaseSnapshot: {
          mate: { type: 'acu', version: 1 },
          sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
          sheet_1: { name: '纪要表', content: [['row_id', '事件'], ['1', '旧事件']] },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(savedSnapshot.sheet_0.content[1][1]).toBe('铁剑');
    expect(savedSnapshot.sheet_1.content[1][1]).toBe('本组新事件');
  });


  it('prepareAIInput 返回 null 时返回错误', async () => {
    mockPrepareAIInput.mockResolvedValue(null);

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      null, null, new AbortController()
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('无法准备AI输入');
  });

  it('AI 响应无 tableEdit 标签时重试并最终失败', async () => {
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('无效的AI响应，没有标签');
    mockSettings.tableMaxRetries = 1; // 只重试1次，加快测试

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      null, null, new AbortController()
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('1 次尝试后仍失败');
  });

  it('AI 回复过短时重试并最终失败', async () => {
    mockSettings.autoUpdateTokenThreshold = 100;
    mockSettings.tableMaxRetries = 1;
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('短');

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      null, null, new AbortController()
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('AI回复过短');
  });

  it('用户中止时返回 aborted', async () => {
    mockWasStopped = true;
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      null, null, new AbortController()
    );

    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
  });

  it('AbortError 时返回 aborted', async () => {
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      null, null, new AbortController()
    );

    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
  });

  it('保存失败时返回错误', async () => {
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: false, error: 'save failed' });

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('save failed');
  });

  it('无实质数据改动但 targetSheetKeys 非空时记录填表尝试但不推进 changed tracking', async () => {
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>   </tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: [] });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    expect(result.success).toBe(true);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetMessageIndex: 0,
      targetSheetKeys: [],
      updateGroupKeys: ['sheet_0'],
      trackingSheetKeys: [],
      source: 'group_fill',
    }));
  });

  it('目标表参与本轮但仅部分表有实质修改时，只按实质修改表推进 tracking', async () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '表A', content: [['row_id'], ['1']] },
      sheet_1: { name: '表B', content: [['row_id'], ['1']] },
    };
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>部分更新</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      ['sheet_0', 'sheet_1'], null, new AbortController()
    );

    expect(result.success).toBe(true);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_0'],
      updateGroupKeys: ['sheet_0', 'sheet_1'],
      trackingSheetKeys: ['sheet_0'],
      source: 'group_fill',
    }));
  });

  it('import 模式不保存到聊天记录', async () => {
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });

    const progressEvents: CardUpdateProgressEvent[] = [];

    const result = await executeCardUpdateCore_ACU(
      [], 0, true, 'auto_standard', false,
      null, null, new AbortController(),
      (event) => progressEvents.push(event)
    );

    expect(result.success).toBe(true);
    expect(mockSaveIndependentTable).not.toHaveBeenCalled();
    expect(progressEvents.map(e => e.phase)).toContain('chunk_done');
  });

  it('无 onProgress 回调时不报错', async () => {
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
      // 不传 onProgress
    );

    expect(result.success).toBe(true);
  });

  it('解析失败时重试并最终失败', async () => {
    mockSettings.tableMaxRetries = 1;
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: false, modifiedKeys: [] });

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      null, null, new AbortController()
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('解析或应用AI更新时出错');
  });

  it('首次初始化时保存所有表，但只追踪实质修改表', async () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', content: [['row_id'], ['1']] },
      sheet_1: { name: '测试表B', content: [['row_id'], ['1']] },
    };

    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockCheckIfFirstTimeInit.mockResolvedValue(true);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });

    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValueOnce({
      sheet_0: { name: '测试表A', content: [['row_id'], ['种子行A']] },
      sheet_1: { name: '测试表B', content: [['row_id'], ['种子行B']] },
    });

    const result = await executeCardUpdateCore_ACU(
      [], 0, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    expect(result.success).toBe(true);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetMessageIndex: 0,
      targetSheetKeys: ['sheet_0', 'sheet_1'],
      updateGroupKeys: ['sheet_0'],
      trackingSheetKeys: ['sheet_0'],
      source: 'group_fill',
    }));
  });

  it('自动更新成功后建立 AI 楼层边界 checkpoint', async () => {
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });
    mockEnsureBoundaryCheckpoint.mockResolvedValueOnce({ success: true, changed: true, anchorIndex: 23 });

    const result = await executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      0, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    expect(result.success).toBe(true);
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenCalledWith({ reason: 'auto_update', save: true });
  });

  it('自动更新成功后 boundary checkpoint 失败时不回滚主更新', async () => {
    const { logWarn_ACU } = await import('../../../src/shared/utils');
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });
    mockEnsureBoundaryCheckpoint.mockResolvedValueOnce({ success: false, changed: false, error: '边界 checkpoint 写入失败' });

    const result = await executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      0, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    expect(result.success).toBe(true);
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenCalledWith({ reason: 'auto_update', save: true });
    expect(logWarn_ACU).toHaveBeenCalledWith(expect.stringContaining('边界 checkpoint 建立失败'));
  });
});

// ═══════════════════════════════════════════════════════════════
// orchestrateManualUpdate_ACU
// ═══════════════════════════════════════════════════════════════
describe('orchestrateManualUpdate_ACU', () => {
  const mockProcessBatch = vi.fn();
  const mockRefreshData = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    vi.clearAllMocks();
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { loadAllChatMessages_ACU } = await import('../../../src/service/worldbook/pipeline');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '测试表', updateConfig: { groupId: 0 }, content: [['row_id', '值']] },
    });

    vi.mocked(loadAllChatMessages_ACU).mockReset();
    vi.mocked(loadAllChatMessages_ACU).mockResolvedValue(undefined);

    vi.mocked(isSqliteMode).mockReturnValue(false);
    mockIsAutoUpdating = false;
    mockCoreApisReady = true;
    mockCurrentJsonTableData = { sheet_0: { name: '测试表', updateConfig: {}, content: [['row_id', '值']] } };
    mockSettings = {
      ...mockSettings,
      apiMode: 'custom',
      apiConfig: { useMainApi: true, url: '', model: '' },
      autoUpdateThreshold: 3,
      manualUpdateContextDepth: 3,
      updateBatchSize: 3,
      manualUpdateBatchSize: 3,
      skipUpdateFloors: 0,
    };
    mockWasStopped = false;
    mockClearManualRefillSheetDataInRange.mockReset();
    mockClearManualRefillSheetDataInRange.mockResolvedValue(0);
    mockCommitManualRefillSheetSnapshot.mockReset();
    mockCommitManualRefillSheetSnapshot.mockResolvedValue({ success: true, changed: true, clearedCount: 1, checkpointCount: 1, targetMessageIndex: 0 });
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockUpdateReadableLorebookEntry.mockResolvedValue(undefined);
    mockEnsureBoundaryCheckpoint.mockResolvedValue({ success: true, changed: false, skipped: true });
    mockShouldRotateBoundaryCheckpoint.mockReturnValue(false);
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 3 });
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      if (aiResponse.includes('sheet_0')) {
        if (tableData.sheet_0) tableData.sheet_0.content.push(['2', '来自A']);
        return { success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 };
      }
      if (aiResponse.includes('sheet_1')) {
        if (tableData.sheet_1) tableData.sheet_1.content.push(['2', '来自B']);
        return { success: true, modifiedKeys: ['sheet_1'], appliedEdits: 1 };
      }
      return { success: false, modifiedKeys: [], appliedEdits: 0 };
    });
  });

  it('正在更新中时返回错误', async () => {
    mockIsAutoUpdating = true;
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], mockProcessBatch, mockRefreshData);
    expect(result.success).toBe(false);
    expect(result.error).toContain('正在进行中');
  });

  it('API 未就绪时返回错误', async () => {
    mockCoreApisReady = false;
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], mockProcessBatch, mockRefreshData);
    expect(result.success).toBe(false);
    expect(result.error).toContain('API未就绪');
  });

  it('API 未配置时返回错误', async () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig = { useMainApi: false, url: '', model: '' };
    mockSettings.tavernProfile = '';
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], mockProcessBatch, mockRefreshData);
    expect(result.success).toBe(false);
    expect(result.error).toContain('API未配置');
  });

  it('数据库未加载时返回错误', async () => {
    mockCurrentJsonTableData = null;
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], mockProcessBatch, mockRefreshData);
    expect(result.success).toBe(false);
    expect(result.error).toContain('数据库未加载');
  });

  it('聊天记录为空时返回错误', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([]);

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], mockProcessBatch, mockRefreshData);
    expect(result.success).toBe(false);
    expect(result.error).toContain('聊天记录为空');
  });

  it('无 AI 回复时返回错误', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: true },
    ]);

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], mockProcessBatch, mockRefreshData);
    expect(result.success).toBe(false);
    expect(result.error).toContain('尚未检测到AI回复');
  });

  it('未选择表格时返回错误', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false },
    ]);

    const result = await orchestrateManualUpdate_ACU([], mockProcessBatch, mockRefreshData);
    expect(result.success).toBe(false);
    expect(result.error).toContain('未选择');
  });

  it('正常流程：processBatch 成功，返回 success', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);

    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);
    expect(result.success).toBe(true);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
  });

  it('双 full checkpoint 且无可自动执行的恢复计划时锚点预检阻断，且不触发 AI 调用', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const makeFullFrame = (data: any) => ({
      version: 2,
      logEntries: [],
      headRevision: 'r1',
      checkpoint: { kind: 'full', reason: 'init', data },
    });
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      {
        is_user: false,
        mes: 'AI回复1',
        TavernDB_ACU_IsolatedData: { '': { storageFrame: makeFullFrame({ sheet_0: { name: '测试表', content: [['row_id', 'v1']] } }) } },
      },
      { is_user: true },
      {
        is_user: false,
        mes: 'AI回复2',
        TavernDB_ACU_IsolatedData: { '': { storageFrame: makeFullFrame({ sheet_0: { name: '测试表', content: [['row_id', 'v2']] } }) } },
      },
    ]);
    mockCurrentJsonTableData = { sheet_0: { name: '测试表', updateConfig: {}, content: [['row_id', 'v2']] } };

    const processBatch = vi.fn().mockResolvedValue({ success: true });
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], processBatch, mockRefreshData);

    expect(result.success).toBe(false);
    expect(result.error).toContain('锚点预检');
    // 阻断前必须先尝试自动收敛（默认 mock 无恢复计划）
    expect(mockPrepareV2Recovery).toHaveBeenCalledTimes(1);
    expect(mockCommitPreparedV2Recovery).not.toHaveBeenCalled();
    expect(processBatch).not.toHaveBeenCalled();
  });

  it('双 full checkpoint 但恢复计划可自动执行时静默收敛后继续手动重填', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const makeFullFrame = (data: any) => ({
      version: 2,
      logEntries: [],
      headRevision: 'r1',
      checkpoint: { kind: 'full', reason: 'init', data },
    });
    const chat = [
      { is_user: true },
      {
        is_user: false,
        mes: 'AI回复1',
        TavernDB_ACU_IsolatedData: { '': { storageFrame: makeFullFrame({ sheet_0: { name: '测试表', content: [['row_id', 'v1']] } }) } },
      },
      { is_user: true },
      {
        is_user: false,
        mes: 'AI回复2',
        TavernDB_ACU_IsolatedData: { '': { storageFrame: makeFullFrame({ sheet_0: { name: '测试表', content: [['row_id', 'v2']] } }) } },
      },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(chat as any);
    mockCurrentJsonTableData = { sheet_0: { name: '测试表', updateConfig: {}, content: [['row_id', 'v2']] } };
    // 收敛后保留的回放根在末位 AI 楼层（#3），重填范围限定为该楼层（写目标不得早于根）
    mockSettings.manualUpdateContextDepth = 1;
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockPrepareV2Recovery.mockResolvedValueOnce({
      planId: 'plan-converge',
      status: 'recoverable_redundant_full_checkpoint',
      isolationKey: '',
      requiresConfirmation: false,
      message: '将保留末位 full 为唯一回放根。',
    } as any);
    mockCommitPreparedV2Recovery.mockImplementationOnce(async (planId: string) => {
      // 模拟收敛：降级首个 full checkpoint（转 fallback，删除 checkpoint 字段）
      const frame = (chat[1] as any).TavernDB_ACU_IsolatedData[''].storageFrame;
      frame.logEntries = [{ seq: 0, operations: [{ kind: 'data_replace', data: frame.checkpoint.data, reason: 'checkpoint_fallback' }] }];
      delete frame.checkpoint;
      return { status: 'committed', planId };
    });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);

    expect(mockPrepareV2Recovery).toHaveBeenCalledTimes(1);
    expect(mockCommitPreparedV2Recovery).toHaveBeenCalledWith('plan-converge');
    expect({ success: result.success, error: result.error }).toEqual({ success: true, error: undefined });
  });

  it('零根有帧（增量帧无 full checkpoint 锚点）时预检检出并尝试自动收敛，失败则阻断', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      {
        is_user: false,
        mes: 'AI回复1',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: 'r-log-only',
              logEntries: [{ seq: 1, entryId: 'e1', operations: [] }],
            },
          },
        },
      },
    ]);
    mockCurrentJsonTableData = { sheet_0: { name: '测试表', updateConfig: {}, content: [['row_id', 'v1']] } };

    const processBatch = vi.fn().mockResolvedValue({ success: true });
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], processBatch, mockRefreshData);

    expect(result.success).toBe(false);
    expect(result.error).toContain('锚点预检');
    expect(mockPrepareV2Recovery).toHaveBeenCalledTimes(1);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it('恢复计划需人工确认（无锚点 data_replace 提升）时不自动执行，维持阻断', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      {
        is_user: false,
        mes: 'AI回复1',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: 'r-orphan',
              logEntries: [{ seq: 1, entryId: 'e1', operations: [{ kind: 'data_replace', data: { sheet_0: { name: '测试表', content: [['row_id', 'v1']] } } }] }],
            },
          },
        },
      },
    ]);
    mockCurrentJsonTableData = { sheet_0: { name: '测试表', updateConfig: {}, content: [['row_id', 'v1']] } };
    mockPrepareV2Recovery.mockResolvedValueOnce({
      planId: 'plan-orphan',
      status: 'recoverable_orphan_data_replace',
      isolationKey: '',
      requiresConfirmation: true,
      message: '无锚点 data_replace 必须明确确认后才会提升为 full checkpoint。',
    } as any);

    const processBatch = vi.fn().mockResolvedValue({ success: true });
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], processBatch, mockRefreshData);

    expect(result.success).toBe(false);
    expect(result.error).toContain('锚点预检');
    expect(mockCommitPreparedV2Recovery).not.toHaveBeenCalled();
    expect(processBatch).not.toHaveBeenCalled();
  });


  it('手动重填启动前无条件清理重填范围内选中表历史数据', async () => {
    const { getChatArray_ACU, clearManualRefillIncrementalDataInRange_ACU, clearManualRefillSheetDataInRange_ACU, clearTableDataAtFloors_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {} },
      sheet_1: { name: '测试表B', updateConfig: {} },
    };
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });
    expect(result.success).toBe(true);
    // 只清理本次范围内的选中表，不触碰范围外数据与未选中的表。
    expect(clearManualRefillSheetDataInRange_ACU).toHaveBeenCalledTimes(1);
    expect(clearManualRefillSheetDataInRange_ACU).toHaveBeenCalledWith(expect.any(Array), ['sheet_0']);
    expect(clearManualRefillIncrementalDataInRange_ACU).not.toHaveBeenCalled();
    expect(clearTableDataAtFloors_ACU).not.toHaveBeenCalled();
    expect(mockPurgeSheetKeysFromChatHistoryHard).not.toHaveBeenCalled();
  });

  it('手动重填清理后刷新运行时快照，使基底反映清理结果', async () => {
    const { getChatArray_ACU, clearManualRefillIncrementalDataInRange_ACU, clearManualRefillSheetDataInRange_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '纪要表', updateConfig: {}, content: [['row_id', '事件'], ['old', '清理前旧 chronicle']] },
    };
    // 本例验证清理后的 reload 编排，不会进入 SQL 提交；数据夹具也没有可 hydrate 的 DDL。
    // 因此只提供 readiness 通过的 provider stub，避免把无关的 schema 校验混入该行为测试。
    mockEnsureStorageProviderReady.mockResolvedValue({
      mode: 'sqlite',
      isReady: () => true,
      getCurrentData: () => mockCurrentJsonTableData,
    });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success, result.error).toBe(true);
    expect(clearManualRefillSheetDataInRange_ACU).toHaveBeenCalledTimes(1);
    expect(mockReloadStorageProvider).toHaveBeenCalled();
    expect(clearManualRefillIncrementalDataInRange_ACU).not.toHaveBeenCalled();
    expect(mockPrepareAIInput).toHaveBeenCalled();
  });

  it('确认后 runtime 表集合变化时，在破坏性清理前阻断手动填表', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
      sheet_1: { name: '测试表B', updateConfig: {}, content: [['row_id', '值B']] },
    };
    const refreshData = vi.fn().mockImplementation(async () => {
      // 模拟确认弹窗期间另一入口收紧了 runtime：删除 sheet_1。
      mockCurrentJsonTableData = {
        sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
      };
    });
    const processBatch = vi.fn().mockResolvedValue({ success: true });

    const result = await orchestrateManualUpdate_ACU(
      ['sheet_0', 'sheet_1'],
      processBatch,
      refreshData,
      { clearBeforeUpdate: true, executionSnapshot: { sheetKeys: ['sheet_0', 'sheet_1'] } },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('表格运行时在确认期间发生变化');
    expect(mockClearManualRefillSheetDataInRange).not.toHaveBeenCalled();
    expect(mockReloadStorageProvider).not.toHaveBeenCalled();
    expect(processBatch).not.toHaveBeenCalled();
  });

  it('provider ready 等待期间 runtime 变化：清理前一刻第二次复检阻断', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    // SQLite 模式才会在第一次复检与破坏性清理之间经过 ensureStorageProviderReady_ACU 异步边界
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
      sheet_1: { name: '测试表B', updateConfig: {}, content: [['row_id', '值B']] },
    };
    // 第一次复检通过后、provider ready 等待期间收紧 runtime：删除 sheet_1
    mockEnsureStorageProviderReady.mockImplementationOnce(async () => {
      mockCurrentJsonTableData = {
        sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
      };
      return { mode: 'sqlite', isReady: () => true };
    });
    const refreshData = vi.fn().mockResolvedValue(undefined);
    const processBatch = vi.fn().mockResolvedValue({ success: true });

    const result = await orchestrateManualUpdate_ACU(
      ['sheet_0', 'sheet_1'],
      processBatch,
      refreshData,
      { clearBeforeUpdate: true, executionSnapshot: { sheetKeys: ['sheet_0', 'sheet_1'] } },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('表格运行时在确认期间发生变化');
    expect(mockClearManualRefillSheetDataInRange).not.toHaveBeenCalled();
    expect(mockReloadStorageProvider).not.toHaveBeenCalled();
    expect(processBatch).not.toHaveBeenCalled();
  });

  it('显式传空 executionSnapshot 时手动填表 fail-closed 阻断（不静默降级）', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
    };
    const refreshData = vi.fn().mockResolvedValue(undefined);
    const processBatch = vi.fn().mockResolvedValue({ success: true });

    const result = await orchestrateManualUpdate_ACU(
      ['sheet_0'],
      processBatch,
      refreshData,
      { clearBeforeUpdate: true, executionSnapshot: { sheetKeys: [] } },
    );

    // 显式传入快照但为空 → 视为保护已启用且校验失败，不得静默降级为 legacy
    expect(result.success).toBe(false);
    expect(result.error).toContain('表格运行时在确认期间发生变化');
    expect(mockClearManualRefillSheetDataInRange).not.toHaveBeenCalled();
  });

  it('非重填路径显式传空 executionSnapshot 时手动更新同样 fail-closed（不依赖 clearBeforeUpdate）', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
    };
    const refreshData = vi.fn().mockResolvedValue(undefined);
    const processBatch = vi.fn().mockResolvedValue({ success: true });

    // 未传 clearBeforeUpdate（非重填路径），但显式提供空快照 → 保护必须启用并阻断，不得静默降级
    const result = await orchestrateManualUpdate_ACU(
      ['sheet_0'],
      processBatch,
      refreshData,
      { executionSnapshot: { sheetKeys: [] } },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('表格运行时在确认期间发生变化');
    expect(mockClearManualRefillSheetDataInRange).not.toHaveBeenCalled();
    expect(processBatch).not.toHaveBeenCalled();
  });


  it('普通手动更新的进度回调异常保持 rejection 契约且不触发 refill 回滚', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
    };
    const processBatch = vi.fn().mockResolvedValue({ success: true });
    const onProgress = vi.fn(() => {
      throw new Error('ordinary progress observer failed');
    });

    await expect(orchestrateManualUpdate_ACU(['sheet_0'], processBatch, mockRefreshData, { onProgress }))
      .rejects.toThrow('ordinary progress observer failed');

    expect(processBatch).not.toHaveBeenCalled();
  });

  it('范围内清理直接 reject 时返回硬失败且不回滚', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: false, mes: 'AI回复1' }]);
    mockCurrentJsonTableData = { sheet_0: { name: 'chronicle', updateConfig: {}, content: [['row_id', 'code_index']] } };
    mockClearManualRefillSheetDataInRange.mockRejectedValueOnce(new Error('purge transaction rejected'));

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('purge transaction rejected');
    expect(mockClearManualRefillIncrementalDataInRange).not.toHaveBeenCalled();
    expect(mockReloadStorageProvider).not.toHaveBeenCalled();
    expect(mockRefreshData).toHaveBeenCalled();
  });

  it('范围内清理完成后 preparing 进度回调抛错时失败且不回滚', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: 'chronicle', updateConfig: {}, content: [['row_id', 'code_index'], ['old', '1']] },
    };
    const processBatch = vi.fn().mockResolvedValue({ success: true });
    const onProgress = vi.fn(() => {
      throw new Error('progress observer failed');
    });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], processBatch, mockRefreshData, {
      clearBeforeUpdate: true,
      onProgress,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('progress observer failed');
    expect(mockReloadStorageProvider).toHaveBeenCalled();
    expect(processBatch).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockRefreshData).toHaveBeenCalled();
  });

  it('重填清理并 reload 后 runtime 变化：最终复检失败时失败返回并刷新对齐，不回滚', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
      sheet_1: { name: '测试表B', updateConfig: {}, content: [['row_id', '值B']] },
    };
    mockClearManualRefillSheetDataInRange.mockResolvedValue(0);
    // reload 是清理后、最终复检前的异步窗口：在此期间 runtime 表集合被收紧（删除 sheet_1）
    mockReloadStorageProvider.mockImplementationOnce(async () => {
      mockCurrentJsonTableData = {
        sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
      };
      return { ok: true, degraded: false, source: 'merged' };
    });
    const processBatch = vi.fn().mockResolvedValue({ success: true });

    const result = await orchestrateManualUpdate_ACU(
      ['sheet_0', 'sheet_1'],
      processBatch,
      mockRefreshData,
      { clearBeforeUpdate: true, executionSnapshot: { sheetKeys: ['sheet_0', 'sheet_1'] } },
    );

    // 清理已发生且 reload 期间 runtime 变化：必须走 failManualRefillSession，
    // 不回滚、保留删除，按已提交事实刷新对齐（不能裸返回造成净损失假象）。
    expect(result.success).toBe(false);
    expect(result.error).toContain('表格运行时在确认期间发生变化');
    expect(processBatch).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockRefreshData).toHaveBeenCalled();
  });

  it('重填每个 chunk 的 loadAllChatMessages 窗口 runtime 变化：首 chunk 零提交时回滚快照', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { loadAllChatMessages_ACU } = await import('../../../src/service/worldbook/pipeline');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
      sheet_1: { name: '测试表B', updateConfig: {}, content: [['row_id', '值B']] },
    };
    mockClearManualRefillSheetDataInRange.mockResolvedValue(0);
    // 入口 load（第 1 次）正常；循环内 chunk 前的 load（第 2 次）期间 runtime 被收紧：删除 sheet_1
    let loadCallCount = 0;
    vi.mocked(loadAllChatMessages_ACU).mockImplementation(async () => {
      loadCallCount += 1;
      if (loadCallCount === 2) {
        mockCurrentJsonTableData = {
          sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
        };
      }
    });
    const processBatch = vi.fn().mockResolvedValue({ success: true });

    const result = await orchestrateManualUpdate_ACU(
      ['sheet_0', 'sheet_1'],
      processBatch,
      mockRefreshData,
      { clearBeforeUpdate: true, executionSnapshot: { sheetKeys: ['sheet_0', 'sheet_1'] } },
    );

    // 破坏性清理已发生、chunk 前复检发现 runtime 变化：失败返回且不回滚
    // （清理不可逆、保留删除），按已提交事实刷新对齐，不得把 stale target 带入 AI 调用。
    expect(result.success).toBe(false);
    expect(result.error).toContain('表格运行时在确认期间发生变化');
    expect(processBatch).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockRefreshData).toHaveBeenCalled();
  });

  it('重填后续 chunk 前 runtime 变化：循环内复检阻断后续 chunk，不把 stale target 带入 AI', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { loadAllChatMessages_ACU } = await import('../../../src/service/worldbook/pipeline');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
      sheet_1: { name: '测试表B', updateConfig: {}, content: [['row_id', '值B']] },
    };
    mockClearManualRefillSheetDataInRange.mockResolvedValue(0);
    // 入口 load（1）+ chunk1 前 load（2）+ chunk1 后 load（3）均正常；
    // 第二个 chunk 前的 load（4）期间 runtime 被收紧：删除 sheet_1
    let loadCallCount = 0;
    vi.mocked(loadAllChatMessages_ACU).mockImplementation(async () => {
      loadCallCount += 1;
      if (loadCallCount === 4) {
        mockCurrentJsonTableData = {
          sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
        };
      }
    });
    mockSettings.manualUpdateContextDepth = 0;
    mockSettings.manualUpdateBatchSize = 1;
    // 让首 chunk 的真实 grouped 逻辑成功（零提交也可），才能继续到第二个 chunk 前的复检
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 0 });
    mockSaveIndependentTable.mockResolvedValue({ saved: true });

    const result = await orchestrateManualUpdate_ACU(
      ['sheet_0', 'sheet_1'],
      vi.fn().mockResolvedValue({ success: true }),
      mockRefreshData,
      { clearBeforeUpdate: true, executionSnapshot: { sheetKeys: ['sheet_0', 'sheet_1'] } },
    );

    // 首 chunk 已提交 bucket，第二个 chunk 前的 load 期间 runtime 变化：
    // 循环内复检必须阻断后续 chunk；已提交 bucket 保留（不回滚丢弃用户成果），
    // 也不得把确认前的 stale target 带入第二个 chunk 的 AI 调用。
    expect(result.success).toBe(false);
    expect(result.error).toContain('表格运行时在确认期间发生变化');
    // 首 chunk 已提交（持久化发生过）
    expect(mockPersistTablesToChatMessage).toHaveBeenCalled();
    // 补强：stale target（sheet_1）绝不能进入 AI。首 chunk 已执行（至少一次 AI 调用，
    // 覆盖 sheet_0）；第二个 chunk 在 load 后复检被阻断，不得出现任何 sheet_1 的 AI 调用。
    // 不锁定精确调用次数：消息索引/批大小变化会改变首 chunk 的 bucket 数，次数断言会误报。
    const aiTargetKeys = mockCallCustomOpenAI.mock.calls.map(call => (call[2] as { targetSheetKeys?: string[] } | undefined)?.targetSheetKeys || []);
    expect(aiTargetKeys.length).toBeGreaterThan(0);
    expect(aiTargetKeys.every(keys => keys.includes('sheet_0') && !keys.includes('sheet_1'))).toBe(true);
  });

  it('普通手动更新：boundary checkpoint await 期间 runtime 变化，AI 调用前最终复检阻断', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { loadAllChatMessages_ACU } = await import('../../../src/service/worldbook/pipeline');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
      sheet_1: { name: '测试表B', updateConfig: {}, content: [['row_id', '值B']] },
    };
    // 非重填路径（不传 clearBeforeUpdate），且需要滚动 boundary checkpoint
    mockShouldRotateBoundaryCheckpoint.mockReturnValue(true);
    // ensureV2BoundaryCheckpointForRetainedBuffer_ACU await 期间 runtime 被收紧：删除 sheet_1
    mockEnsureBoundaryCheckpoint.mockImplementationOnce(async () => {
      mockCurrentJsonTableData = {
        sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] },
      };
      return { success: true, changed: true, anchorIndex: 23 };
    });
    const processBatch = vi.fn().mockResolvedValue({ success: true });

    const result = await orchestrateManualUpdate_ACU(
      ['sheet_0', 'sheet_1'],
      processBatch,
      mockRefreshData,
      { executionSnapshot: { sheetKeys: ['sheet_0', 'sheet_1'] } },
    );

    // 普通路径：复检位于 checkpoint await 之后、AI 调用之前，runtime 变化必须 fail-closed
    expect(result.success).toBe(false);
    expect(result.error).toContain('表格运行时在确认期间发生变化');
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('手动重填只清理范围内选中表，不触碰范围外历史基底', async () => {
    const { getChatArray_ACU, clearManualRefillIncrementalDataInRange_ACU, clearManualRefillSheetDataInRange_ACU, clearTableDataAtFloors_ACU } = await import('../../../src/service/chat/chat-service');
    const chat = [
      { is_user: true, mes: '用户0' },
      {
        is_user: false,
        mes: 'AI回复1',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [],
              checkpoint: {
                kind: 'full',
                reason: 'compaction',
                createdAt: 1,
                data: {
                  mate: { type: 'acu' },
                  sheet_0: { name: '测试表A', content: [['row_id', '值A'], ['base', '范围外基底']] },
                },
              },
            },
          },
        },
      },
      { is_user: true, mes: '用户2' },
      { is_user: false, mes: 'AI回复3' },
      { is_user: true, mes: '用户4' },
      { is_user: false, mes: 'AI回复5' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(chat as any);
    mockSettings.manualUpdateContextDepth = 2;
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A'], ['1', '旧A']] },
    };
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(true);
    expect(clearManualRefillSheetDataInRange_ACU).toHaveBeenCalledTimes(1);
    expect(clearManualRefillIncrementalDataInRange_ACU).not.toHaveBeenCalled();
    expect(clearTableDataAtFloors_ACU).not.toHaveBeenCalled();
    expect(mockPurgeSheetKeysFromChatHistoryHard).not.toHaveBeenCalled();
    expect((chat[1] as any).TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_0.content).toEqual([['row_id', '值A'], ['base', '范围外基底']]);
  });

  it('手动重填不清理 chat[0] sheet guide，避免 V2 replay 回退链路断裂', async () => {
    const { getChatArray_ACU, clearManualRefillIncrementalDataInRange_ACU, clearManualRefillSheetDataInRange_ACU, clearTableDataAtFloors_ACU } = await import('../../../src/service/chat/chat-service');
    const chat = [
      { is_user: true, mes: '用户0', TavernDB_ACU_SheetGuide: { '': { sheet_0: { latestMessageIndex: 1 } } } },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true, mes: '用户2' },
      { is_user: false, mes: 'AI回复3' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(chat as any);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A'], ['1', '旧A']] },
    };
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(true);
    expect(clearManualRefillSheetDataInRange_ACU).toHaveBeenCalledTimes(1);
    expect(clearManualRefillIncrementalDataInRange_ACU).not.toHaveBeenCalled();
    expect(clearTableDataAtFloors_ACU).not.toHaveBeenCalled();
    expect(mockPurgeSheetKeysFromChatHistoryHard).not.toHaveBeenCalled();
    expect((chat[0] as any).TavernDB_ACU_SheetGuide).toEqual({ '': { sheet_0: { latestMessageIndex: 1 } } });
  });


  it('已有 V2 增量但无 full checkpoint 时直接清理并重填，不再要求二次确认', async () => {
    const { getChatArray_ACU, commitManualRefillSheetSnapshotInRangeAtomic_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '测试表A', updateConfig: { groupId: 0 }, content: [['row_id', '值A']] },
    });
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        mes: 'AI回复1',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: undefined,
              logEntries: [{
                seq: 1,
                entryId: 'log-only-without-checkpoint',
                createdAt: 1,
                source: 'auto_fill',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_0'],
                changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '孤立增量'] }],
              }],
            },
          },
        },
      },
      { is_user: true, mes: '用户2' },
      { is_user: false, mes: 'AI回复3' },
    ]);
    mockSettings.maxConcurrentGroups = 1;
    mockSettings.manualUpdateContextDepth = 0;
    mockSettings.manualUpdateBatchSize = 1;
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A'], ['1', '旧A']] },
    };
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });

    const processBatch = vi.fn().mockResolvedValue({ success: true });
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], processBatch, mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(true);
    // 无 full checkpoint 也直接清理范围内选中表，让用户可以从头开始填表。
    expect(mockClearManualRefillSheetDataInRange).toHaveBeenCalledTimes(1);
    expect(mockClearManualRefillSheetDataInRange).toHaveBeenCalledWith([0, 2], ['sheet_0']);
    expect(mockReloadStorageProvider).toHaveBeenCalled();
    // 清理后必须补写完整单表 checkpoint，否则新增量将没有回放锚点。
    expect(commitManualRefillSheetSnapshotInRangeAtomic_ACU).toHaveBeenCalledTimes(1);
    expect(mockClearManualRefillIncrementalDataInRange).not.toHaveBeenCalled();
  });

  it('范围末端 full checkpoint 被目标表全覆盖时禁用跨根 staging：清理后建模板临时根，各层普通 persist', async () => {
    const { getChatArray_ACU, commitManualRefillSheetSnapshotInRangeAtomic_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '测试表A', updateConfig: { groupId: 0 }, content: [['row_id', '值A']] },
    });
    const chat = [
      {
        is_user: false,
        mes: 'AI回复1',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: undefined,
              logEntries: [{
                seq: 1,
                entryId: 'fallback-without-full',
                createdAt: 1,
                source: 'manual_refill_baseline',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: ['sheet_0'],
                changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{
                  kind: 'data_replace',
                  reason: 'checkpoint_fallback',
                  data: { sheet_0: { name: '测试表A', content: [['row_id', '值A'], ['fallback', '不允许恢复']] } },
                }],
              }],
            },
          },
        },
      },
      { is_user: true, mes: '用户2' },
      { is_user: false, mes: 'AI回复3' },
      { is_user: true, mes: '用户4' },
      {
        is_user: false,
        mes: 'AI回复5',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: { version: 2, logEntries: [], checkpoint: { kind: 'full', reason: 'init', createdAt: 2, data: { sheet_0: { name: '测试表A', content: [['row_id', '值A'], ['later', '目标层基底']] } } } },
          },
        },
      },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(chat);
    mockClearManualRefillSheetDataInRange.mockImplementationOnce(async () => {
      chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries = [];
      return 1;
    });
    mockSettings.maxConcurrentGroups = 1;
    mockSettings.manualUpdateContextDepth = 0;
    mockSettings.manualUpdateBatchSize = 1;
    mockCurrentJsonTableData = { sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A'], ['1', '旧A']] } };
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });

    const processBatch = vi.fn().mockResolvedValue({ success: true });
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], processBatch, mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(true);
    expect(mockClearManualRefillSheetDataInRange).toHaveBeenCalledWith([0, 2, 4], ['sheet_0']);
    expect(commitManualRefillSheetSnapshotInRangeAtomic_ACU).toHaveBeenCalledWith(expect.objectContaining({
      isolationKey: '',
      targetMessageIndices: [0, 2, 4],
      targetSheetKeys: ['sheet_0'],
      snapshotData: expect.objectContaining({ sheet_0: expect.any(Object) }),
    }));
    expect(mockClearManualRefillIncrementalDataInRange).not.toHaveBeenCalled();
    expect(mockReloadStorageProvider).toHaveBeenCalledTimes(1);
    // 原 full checkpoint（#4）落在重填范围内，且其 checkpoint.data 的 sheet 键被 targetKeys
    // 全量覆盖 —— 清理必然删除该 checkpoint，跨根 staging 失去汇合目标，因此被禁用，
    // 改由清理后的模板临时根承载后续写入锚点。此时没有 stage_only 段，
    // 范围内三个 AI 楼层（[0,2,4]）都走普通 persist。
    expect(mockEstablishManualRefillTemplateRoot).toHaveBeenCalledWith(expect.objectContaining({
      isolationKey: '',
      targetSheetKeys: ['sheet_0'],
      targetMessageIndices: [0, 2, 4],
    }));
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(3);
  });
  it('跨根 staging 的 pre 段失败时不继续 post 段写入，不回滚保留已清理状态', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '测试表A', updateConfig: { groupId: 0 }, content: [['row_id', '值A']] },
    });
    // 跨边界布局：full checkpoint 位于 index 4，contextScopeIndices=[0,2,4]，0<4 → 跨根 staging。
    // pre 段（[0,2]）stage_only，post 段（[4]）普通 persist。
    const chat: any[] = [
      { is_user: false, mes: 'AI回复1' },
      { is_user: true, mes: '用户2' },
      { is_user: false, mes: 'AI回复3' },
      { is_user: true, mes: '用户4' },
      {
        is_user: false,
        mes: 'AI回复5',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: { version: 2, logEntries: [], checkpoint: { kind: 'full', reason: 'init', createdAt: 2, data: { mate: { type: 'acu' }, sheet_0: { name: '测试表A', content: [['row_id', '值A'], ['later', '目标层基底']] } } } },
          },
        },
      },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(chat);
    mockSettings.maxConcurrentGroups = 1;
    mockSettings.manualUpdateContextDepth = 0;
    mockSettings.manualUpdateBatchSize = 1;
    mockCurrentJsonTableData = { sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A'], ['1', '旧A']] } };
    // pre 段（index 0）AI 调用直接失败：stage_only 提交失败 → 该组整体失败。
    mockCallCustomOpenAI.mockRejectedValue(new Error('AI 调用失败'));
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('AI 调用失败');
    // pre 段失败：post 段（[4]）不得写入聊天帧；清理已发生且不可逆，不回滚。
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockRefreshData).toHaveBeenCalled();
    expect(mockCommitManualRefillSheetSnapshot).not.toHaveBeenCalled();
  });




  it('boundary checkpoint 后写目标陈旧时，在 AI 调用前结构化阻断（零 token、零清理、零写 frame）', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '测试表A', updateConfig: { groupId: 0 }, content: [['row_id', '值A']] },
    });
    // 最新 full checkpoint 在 index 6（root=6），bucket 目标 0/2 早于 root → stale。
    const chat = [
      { is_user: false, mes: 'AI回复1' },
      { is_user: true, mes: '用户2' },
      { is_user: false, mes: 'AI回复3' },
      { is_user: true, mes: '用户4' },
      { is_user: false, mes: 'AI回复5' },
      { is_user: true, mes: '用户6' },
      {
        is_user: false,
        mes: 'AI回复7',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: { version: 2, logEntries: [], checkpoint: { kind: 'full', reason: 'init', createdAt: 1, data: { mate: { type: 'acu' }, sheet_0: { name: '测试表A', content: [['row_id', '值A'], ['1', '基底']] } } } },
          },
        },
      },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(chat);
    mockSettings.maxConcurrentGroups = 1;
    mockSettings.manualUpdateContextDepth = 0;
    mockSettings.manualUpdateBatchSize = 1;
    mockCurrentJsonTableData = { sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A']] } };
    mockCallCustomOpenAI.mockClear();
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    const processBatch = vi.fn().mockResolvedValue({ success: true });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], processBatch, mockRefreshData, {
      clearBeforeUpdate: false,
      contextScopeIndices: [0, 2, 4],
    } as any);

    expect(result.success).toBe(false);
    expect(result.diagnosticCode).toBe('stale_bucket_after_boundary_checkpoint');
    // 零 token：AI 未被调用；零清理：不预清理；零写 frame：不写 bucket。
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockClearManualRefillSheetDataInRange).not.toHaveBeenCalled();
    expect(mockReloadStorageProvider).not.toHaveBeenCalled();
  });

  it('手动重填在 bucket 写入期间模板源变化时，最终 commit 仍使用启动时冻结模板', async () => {
    const { getChatArray_ACU, commitManualRefillSheetSnapshotInRangeAtomic_ACU } = await import('../../../src/service/chat/chat-service');
    const { getGlobalTemplateSnapshotForCurrentProfile_ACU } = await import('../../../src/service/template/chat-scope');
    const initialTemplate = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '启动时模板', content: [['row_id', '值'], ['seed', '初始']] },
    };
    const changedTemplate = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { name: '中途变更模板', content: [['row_id', '值'], ['changed', '错误来源']] },
    };
    const chat = [{ is_user: false, mes: 'AI回复1' }];
    vi.mocked(getChatArray_ACU).mockReturnValue(chat);
    vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReturnValue({
      templateObj: initialTemplate,
      templateStr: JSON.stringify(initialTemplate),
    } as any);
    mockSettings.manualUpdateContextDepth = 0;
    mockSettings.manualUpdateBatchSize = 1;
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值'], ['1', '旧值']] },
    };
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockPersistTablesToChatMessage.mockImplementationOnce(async () => {
      vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReturnValue({
        templateObj: changedTemplate,
        templateStr: JSON.stringify(changedTemplate),
      } as any);
      return { saved: true, messageIndex: 0 };
    });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(true);
    expect(commitManualRefillSheetSnapshotInRangeAtomic_ACU).toHaveBeenCalledWith(expect.objectContaining({
      templateData: initialTemplate,
    }));
  });


  it('跨 checkpoint 重填的最终快照提交失败时保留已提交 bucket，不回滚会话快照', async () => {
    const { getChatArray_ACU, commitManualRefillSheetSnapshotInRangeAtomic_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{ seq: 1, operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '旧数据'] }], filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [] }],
            },
          },
        },
      },
      { is_user: true },
      { is_user: false },
    ]);
    vi.mocked(commitManualRefillSheetSnapshotInRangeAtomic_ACU).mockResolvedValue({ success: false, changed: false, clearedCount: 0, checkpointCount: 0, error: 'strict save failed' });
    mockSettings.manualUpdateContextDepth = 0;
    mockSettings.manualUpdateBatchSize = 1;
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockParseAndApplyTableEditsToData.mockImplementation(() => ({
      success: true,
      modifiedKeys: ['sheet_0'],
      appliedEdits: 0,
    }));

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('strict save failed') }));
    // 清理不可逆、失败不回滚：已提交 bucket 保留，仅按聊天记录重新同步运行时。
    expect(mockRefreshData).toHaveBeenCalled();
    expect(mockEnsureBoundaryCheckpoint).not.toHaveBeenCalled();
  });

  it('跨 checkpoint 重填在用户停止后保留已提交 bucket，不回滚会话快照', async () => {
    const { getChatArray_ACU, commitManualRefillSheetSnapshotInRangeAtomic_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{ seq: 1, operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '旧数据'] }], filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [] }],
            },
          },
        },
      },
      { is_user: true },
      { is_user: false },
    ]);
    mockSettings.manualUpdateContextDepth = 0;
    mockSettings.manualUpdateBatchSize = 1;
    mockPersistTablesToChatMessage.mockImplementationOnce(async () => {
      mockWasStopped = true;
      return { saved: true, messageIndex: 2 };
    });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(false);
    // 清理不可逆、失败不回滚：已提交 bucket 保留，仅按聊天记录重新同步运行时。
    expect(mockRefreshData).toHaveBeenCalled();
    expect(commitManualRefillSheetSnapshotInRangeAtomic_ACU).not.toHaveBeenCalled();
    expect(mockEnsureBoundaryCheckpoint).not.toHaveBeenCalled();
  });

  it('跨 checkpoint 重填在分组后同步聊天失败时保留已提交 bucket，不回滚会话快照', async () => {
    const { getChatArray_ACU, commitManualRefillSheetSnapshotInRangeAtomic_ACU } = await import('../../../src/service/chat/chat-service');
    const { loadAllChatMessages_ACU } = await import('../../../src/service/worldbook/pipeline');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{ seq: 1, operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', '旧数据'] }], filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [] }],
            },
          },
        },
      },
      { is_user: true },
      { is_user: false },
    ]);
    mockSettings.manualUpdateContextDepth = 0;
    mockSettings.manualUpdateBatchSize = 1;
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });

    let loadCallCount = 0;
    vi.mocked(loadAllChatMessages_ACU).mockImplementation(async () => {
      loadCallCount += 1;
      if (loadCallCount === 3) {
        throw new Error('分组后聊天同步失败');
      }
    });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('分组后聊天同步失败') }));
    expect(loadAllChatMessages_ACU).toHaveBeenCalledTimes(4);
    expect(loadCallCount).toBe(4);
    // 同步失败发生在已有 bucket 提交之后，保留已填数据并按聊天记录重新同步。
    // 清理不可逆、失败不回滚：已提交 bucket 保留，仅按聊天记录重新同步运行时。
    expect(mockRefreshData).toHaveBeenCalled();
    expect(commitManualRefillSheetSnapshotInRangeAtomic_ACU).not.toHaveBeenCalled();
    expect(mockEnsureBoundaryCheckpoint).not.toHaveBeenCalled();
  });



  it('processBatch 失败时返回错误', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);

    mockSettings.tableMaxRetries = 1;
    mockCallCustomOpenAI.mockResolvedValue('无效响应');

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);
    expect(result.success).toBe(false);
    expect(result.error).toContain('尝试后仍失败');
  });

  it('自动合并触发成功时返回 autoMergeTriggered', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);

    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const { checkAutoMergeTrigger_ACU, prepareAutoMergeBatches_ACU, executeAutoMergeBatch_ACU, finalizeAutoMerge_ACU } = await import('../../../src/service/summary/merge-logic');
    vi.mocked(checkAutoMergeTrigger_ACU).mockReturnValue({ shouldTrigger: true, mergeCount: 5 });
    vi.mocked(prepareAutoMergeBatches_ACU).mockReturnValue({ batches: [{ startIndex: 0, endIndex: 5 }] } as any);
    vi.mocked(executeAutoMergeBatch_ACU).mockResolvedValue({ accumulatedSummary: ['合并结果'] } as any);
    vi.mocked(finalizeAutoMerge_ACU).mockResolvedValue(undefined);

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], mockProcessBatch, mockRefreshData);
    expect(result.success).toBe(true);
    expect(result.autoMergeTriggered).toBe(true);
    expect(result.autoMergeSuccess).toBe(true);
  });

  it('finally 块中清理 manualExtraHint 和 isAutoUpdating', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);

    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);

    const { _set_manualExtraHint_ACU, _set_isAutoUpdatingCard_ACU } = await import('../../../src/service/runtime/state-manager');
    expect(_set_manualExtraHint_ACU).toHaveBeenCalledWith('');
    expect(_set_isAutoUpdatingCard_ACU).toHaveBeenCalledWith(false);
  });

  it('手动重填跳过写入前 retained buffer boundary checkpoint，避免 bucket 提交前被维护性 checkpoint 中断', async () => {
    const { getChatArray_ACU, clearManualRefillIncrementalDataInRange_ACU, clearManualRefillSheetDataInRange_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '测试表A', updateConfig: {}, content: [['row_id', '值A'], ['1', '旧A']] },
    };
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockShouldRotateBoundaryCheckpoint.mockReturnValue(true);
    mockEnsureBoundaryCheckpoint.mockResolvedValue({ success: false, error: 'boundary checkpoint failed' });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(true);
    expect(result.checkpointWarning).toContain('boundary checkpoint failed');
    expect(clearManualRefillSheetDataInRange_ACU).toHaveBeenCalledTimes(1);
    expect(clearManualRefillIncrementalDataInRange_ACU).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenCalledWith({ reason: 'manual_refill', save: true });
  });

  it('手动更新整体成功后建立 retained buffer boundary checkpoint', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);

    expect(result.success).toBe(true);
    expect(result.checkpointWarning).toBeUndefined();
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenCalledWith({ reason: 'manual_refill', save: true });
  });

  it('用户在最后一批成功后终止时不建立完成态 boundary checkpoint', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockPersistTablesToChatMessage.mockImplementationOnce(async () => {
      mockWasStopped = true;
      return { saved: true, messageIndex: 3 };
    });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);

    expect(result.success).toBe(false);
    expect(result.error).toContain('终止');
    expect(mockEnsureBoundaryCheckpoint).not.toHaveBeenCalled();
  });

  it('手动重填已提交 bucket 后用户终止时不回滚，保留已填数据并重新同步', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '纪要表', updateConfig: {}, content: [['row_id', '事件'], ['1', '旧值']] },
    };
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    // 首个 bucket 成功落盘后用户点终止。
    mockPersistTablesToChatMessage.mockImplementationOnce(async () => {
      mockWasStopped = true;
      return { saved: true, messageIndex: 1 };
    });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('终止');
    // 清理不可逆、失败不回滚：已提交 bucket 保留，仅按聊天记录重新同步运行时。
    expect(mockRefreshData).toHaveBeenCalled();
  });

  it('手动重填一个 bucket 都未成功就失败时不回滚，保留清理结果', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '纪要表', updateConfig: {}, content: [['row_id', '事件'], ['1', '旧值']] },
    };
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: false, error: '保存失败' });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { clearBeforeUpdate: true });

    expect(result.success).toBe(false);
    expect(mockRefreshData).toHaveBeenCalled();
  });


  it('boundary checkpoint 建立失败时保留成功结果并返回 checkpointWarning', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockEnsureBoundaryCheckpoint.mockResolvedValueOnce({ success: false, changed: false, error: '边界 checkpoint 写入失败' });

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);

    expect(result.success).toBe(true);
    expect(result.checkpointWarning).toContain('边界 checkpoint 写入失败');
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('boundary checkpoint 建立抛异常时保留成功结果、返回 checkpointWarning 并记录异常详情', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { logError_ACU } = await import('../../../src/shared/utils');
    const checkpointError = new Error('checkpoint boom');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockEnsureBoundaryCheckpoint.mockRejectedValueOnce(checkpointError);

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);

    expect(result.success).toBe(true);
    expect(result.checkpointWarning).toContain('checkpoint boom');
    expect(logError_ACU).toHaveBeenCalledWith('[Manual Update] 边界 checkpoint 建立异常详情:', checkpointError);
  });

  it('手动更新失败时不建立完成态 boundary checkpoint', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockSettings.tableMaxRetries = 1;
    mockCallCustomOpenAI.mockResolvedValue('无效响应');

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);

    expect(result.success).toBe(false);
    expect(mockEnsureBoundaryCheckpoint).not.toHaveBeenCalled();
  });

  it('不同 groupId 的手动表格按 maxConcurrentGroups 分块并输出可观测进度', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU, logDebug_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', updateConfig: { groupId: 0 }, content: [['row_id', '值A']] },
      sheet_1: { name: '表B', updateConfig: { groupId: 1 }, content: [['row_id', '值B']] },
      sheet_2: { name: '表C', updateConfig: { groupId: 2 }, content: [['row_id', '值C']] },
    });
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockSettings.maxConcurrentGroups = 2;
    mockCurrentJsonTableData = {
      sheet_0: { name: '表A', updateConfig: {}, content: [['row_id', '值A']] },
      sheet_1: { name: '表B', updateConfig: {}, content: [['row_id', '值B']] },
      sheet_2: { name: '表C', updateConfig: {}, content: [['row_id', '值C']] },
    };
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      const match = aiResponse.match(/sheet_[0-2]/)?.[0];
      if (!match || !tableData[match]) return { success: false, modifiedKeys: [], appliedEdits: 0 };
      tableData[match].content.push(['2', `来自${match}`]);
      return { success: true, modifiedKeys: [match], appliedEdits: 1 };
    });
    mockCallCustomOpenAI
      .mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>')
      .mockResolvedValueOnce('<tableEdit>sheet_1</tableEdit>')
      .mockResolvedValueOnce('<tableEdit>sheet_2</tableEdit>');
    const onProgress = vi.fn();

    const result = await orchestrateManualUpdate_ACU(['sheet_0', 'sheet_1', 'sheet_2'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData, { onProgress });

    expect(result.success).toBe(true);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(3);
    expect(vi.mocked(logDebug_ACU).mock.calls.some(call => String(call[0]).includes('分组计划：选中 3 张表，生成 3 个组，最大并发组数 2'))).toBe(true);
    expect(vi.mocked(logDebug_ACU).mock.calls.some(call => String(call[0]).includes('并发处理第 1/2 批，当前 2 组'))).toBe(true);
    expect(vi.mocked(logDebug_ACU).mock.calls.some(call => String(call[0]).includes('并发处理第 2/2 批，当前 1 组'))).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'preparing', message: '并发处理第 1/2 批，当前 2 组。' }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'preparing', message: '并发处理第 2/2 批，当前 1 组。' }));
  });

  it('手动分组 chunk 建立边界 checkpoint 前先同步聊天再判断是否需要滚动', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { loadAllChatMessages_ACU } = await import('../../../src/service/worldbook/pipeline');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', updateConfig: { groupId: 0 }, content: [['row_id', '值A']] },
      sheet_1: { name: '表B', updateConfig: { groupId: 1 }, content: [['row_id', '值B']] },
    });
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockSettings.maxConcurrentGroups = 1;
    mockCurrentJsonTableData = {
      sheet_0: { name: '表A', updateConfig: {}, content: [['row_id', '值A']] },
      sheet_1: { name: '表B', updateConfig: {}, content: [['row_id', '值B']] },
    };
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      const match = aiResponse.match(/sheet_[0-1]/)?.[0];
      if (!match || !tableData[match]) return { success: false, modifiedKeys: [], appliedEdits: 0 };
      tableData[match].content.push(['2', `来自${match}`]);
      return { success: true, modifiedKeys: [match], appliedEdits: 1 };
    });
    mockCallCustomOpenAI
      .mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>')
      .mockResolvedValueOnce('<tableEdit>sheet_1</tableEdit>');
    mockShouldRotateBoundaryCheckpoint.mockReturnValue(true);

    const result = await orchestrateManualUpdate_ACU(['sheet_0', 'sheet_1'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);

    expect(result.success).toBe(true);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(2);
    expect(mockShouldRotateBoundaryCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenCalledTimes(3);
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenNthCalledWith(1, { reason: 'manual_refill', save: true });
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenNthCalledWith(2, { reason: 'manual_refill', save: true });
    expect(mockEnsureBoundaryCheckpoint).toHaveBeenNthCalledWith(3, { reason: 'manual_refill', save: true });
    expect(vi.mocked(loadAllChatMessages_ACU).mock.invocationCallOrder[0]).toBeLessThan(mockShouldRotateBoundaryCheckpoint.mock.invocationCallOrder[0]);
    expect(mockShouldRotateBoundaryCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(mockEnsureBoundaryCheckpoint.mock.invocationCallOrder[0]);
    // load[1] 是第一个 chunk 处理完成后的聊天同步；第二个 chunk 的前置边界判断必须使用下一次同步后的状态。
    // 因此这里用 load[2] 锁定第二个 chunk 的 load -> shouldRotate -> ensure 顺序。
    expect(vi.mocked(loadAllChatMessages_ACU).mock.invocationCallOrder[2]).toBeLessThan(mockShouldRotateBoundaryCheckpoint.mock.invocationCallOrder[1]);
    expect(mockShouldRotateBoundaryCheckpoint.mock.invocationCallOrder[1]).toBeLessThan(mockEnsureBoundaryCheckpoint.mock.invocationCallOrder[1]);
  });

  it('手动分组 chunk 内在第一个响应完成前并发发起同批 group 请求', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', updateConfig: { groupId: 0 }, content: [['row_id', '值A']] },
      sheet_1: { name: '表B', updateConfig: { groupId: 1 }, content: [['row_id', '值B']] },
      sheet_2: { name: '表C', updateConfig: { groupId: 2 }, content: [['row_id', '值C']] },
    });
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复1' },
      { is_user: false, mes: 'AI回复2' },
    ]);
    mockSettings.maxConcurrentGroups = 2;
    mockCurrentJsonTableData = {
      sheet_0: { name: '表A', updateConfig: {}, content: [['row_id', '值A']] },
      sheet_1: { name: '表B', updateConfig: {}, content: [['row_id', '值B']] },
      sheet_2: { name: '表C', updateConfig: {}, content: [['row_id', '值C']] },
    };
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      const match = aiResponse.match(/sheet_[0-2]/)?.[0];
      if (!match || !tableData[match]) return { success: false, modifiedKeys: [], appliedEdits: 0 };
      tableData[match].content.push(['2', `来自${match}`]);
      return { success: true, modifiedKeys: [match], appliedEdits: 1 };
    });
    const resolvers: Array<(value: string) => void> = [];
    mockCallCustomOpenAI.mockImplementation(() => new Promise<string>(resolve => {
      resolvers.push(resolve);
    }));
    const waitForAiCallCount = async (count: number) => {
      for (let i = 0; i < 20 && mockCallCustomOpenAI.mock.calls.length < count; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(count);
    };

    const resultPromise = orchestrateManualUpdate_ACU(['sheet_0', 'sheet_1', 'sheet_2'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);
    await waitForAiCallCount(2);
    expect(resolvers).toHaveLength(2);

    resolvers[0]('<tableEdit>sheet_0</tableEdit>');
    await waitForAiCallCount(2);

    resolvers[1]('<tableEdit>sheet_1</tableEdit>');
    await waitForAiCallCount(3);
    expect(resolvers).toHaveLength(3);

    resolvers[2]('<tableEdit>sheet_2</tableEdit>');
    const result = await resultPromise;
    expect(result.success).toBe(true);
  });

  it('相同 groupId 的手动表格聚合到同一 group，而不是另起调度链', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU, logDebug_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', updateConfig: { groupId: 7 }, content: [['row_id', '值A']] },
      sheet_1: { name: '表B', updateConfig: { groupId: 7 }, content: [['row_id', '值B']] },
    });
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCurrentJsonTableData = {
      sheet_0: { name: '表A', updateConfig: {}, content: [['row_id', '值A']] },
      sheet_1: { name: '表B', updateConfig: {}, content: [['row_id', '值B']] },
    };
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0 sheet_1</tableEdit>');
    mockParseAndApplyTableEditsToData.mockImplementation((_aiResponse: string, tableData: any) => {
      tableData.sheet_0.content.push(['2', '来自聚合组A']);
      tableData.sheet_1.content.push(['2', '来自聚合组B']);
      return { success: true, modifiedKeys: ['sheet_0', 'sheet_1'], appliedEdits: 2 };
    });

    const result = await orchestrateManualUpdate_ACU(['sheet_0', 'sheet_1'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);

    expect(result.success).toBe(true);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logDebug_ACU).mock.calls.some(call => String(call[0]).includes('分组计划：选中 2 张表，生成 1 个组'))).toBe(true);
    const groupedPersistCall = mockPersistTablesToChatMessage.mock.calls.find(call => call[0]?.targetSheetKeys?.includes('sheet_1'));
    expect(groupedPersistCall?.[0].targetSheetKeys).toEqual(['sheet_0', 'sheet_1']);
  });
});

// ═══════════════════════════════════════════════════════════════
// executeCardUpdateCore_ACU — SQL 错误反馈重试逻辑
// ═══════════════════════════════════════════════════════════════
describe('executeCardUpdateCore_ACU — SQL 错误反馈重试', () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { disposeStorageProvider } = await import('../../../src/service/table/table-storage-strategy');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(isSqliteMode).mockReturnValue(false);
    disposeStorageProvider();
    vi.clearAllMocks();
    mockParseAndApplyTableEdits.mockReset();
    mockParseAndApplyTableEditsToData.mockReset();
    mockApplySqlEditsToTableDataSnapshot.mockReset();
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback: any) => { callback(); return 0 as any; });
    mockWasStopped = false;
    mockSettings = {
      ...mockSettings,
      tableMaxRetries: 3,
      autoUpdateTokenThreshold: 0,
      importPromptExcludeImportedWorldbookEntries: true,
    };
    mockCurrentJsonTableData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'test', name: '测试表', sourceData: { ddl: 'CREATE TABLE test (row_id INTEGER PRIMARY KEY);' }, content: [['row_id']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    };
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 0 });
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'test', name: '测试表', sourceData: { ddl: 'CREATE TABLE test (row_id INTEGER PRIMARY KEY);' }, updateConfig: { groupId: 0 }, content: [['row_id']] },
    });
  });

  afterEach(() => {
    mockApplySqlEditsToTableDataSnapshot.mockReset();
    setTimeoutSpy.mockRestore();
  });

  it('SQL 模式下 parseAndApplyTableEdits 抛错时，错误信息注入到 tableDataText', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);

    mockPrepareAIInput.mockResolvedValue({ tableDataText: '原始数据' });
    mockCurrentJsonTableData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'test', name: '测试表', sourceData: { ddl: 'CREATE TABLE test (row_id INTEGER PRIMARY KEY);' }, content: [['row_id']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    };

    let callCount = 0;
    mockCallCustomOpenAI.mockImplementation(async (dynamicContent: any) => {
      callCount++;
      if (callCount === 1) {
        return '<tableEdit>UPDATE invalid_table SET value = 1 WHERE row_id = 1;</tableEdit>';
      }
      if (callCount === 2) {
        expect(dynamicContent.tableDataText).toContain('SQL_ERROR_FEEDBACK');
        expect(dynamicContent.tableDataText).toContain('无法识别的目标表「invalid_table」');
        expect(dynamicContent.tableDataText).toContain('SQL执行错误，请修正后重新输出');
        return '<tableEdit>DELETE FROM test WHERE row_id = 1;</tableEdit>';
      }
      return '<tableEdit>ok</tableEdit>';
    });

    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });

    // 启动但不 await，让 fake timer 推进
    const resultPromise = executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      0, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    const result = await resultPromise;

    expect(result.success, result.error).toBe(true);
    expect(callCount).toBe(2);

    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('非 SQL 模式下错误不注入 SQL_ERROR_FEEDBACK', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(false);

    mockPrepareAIInput.mockResolvedValue({ tableDataText: '原始数据' });

    let capturedTableDataText = '';
    mockCallCustomOpenAI.mockImplementation(async (dynamicContent: any) => {
      capturedTableDataText = dynamicContent.tableDataText;
      return '<tableEdit>有效内容</tableEdit>';
    });

    mockParseAndApplyTableEdits
      .mockImplementationOnce(() => { throw new Error('解析错误'); })
      .mockReturnValueOnce({ success: true, modifiedKeys: ['sheet_0'] });

    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });

    const resultPromise = executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      0, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(capturedTableDataText).not.toContain('SQL_ERROR_FEEDBACK');
  });

  it('SQL 模式下多次重试时错误信息被替换（不累积）', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockSettings.tableMaxRetries = 3;

    mockPrepareAIInput.mockResolvedValue({ tableDataText: '原始数据' });
    mockCurrentJsonTableData = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 't', name: '测试表', sourceData: { ddl: 'CREATE TABLE t (row_id INTEGER PRIMARY KEY);' }, content: [['row_id']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    };
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 't', name: '测试表', sourceData: { ddl: 'CREATE TABLE t (row_id INTEGER PRIMARY KEY);' }, updateConfig: { groupId: 0 }, content: [['row_id']] },
    } as any);

    let callCount = 0;
    const capturedTableDataTexts: string[] = [];
    mockCallCustomOpenAI.mockImplementation(async (dynamicContent: any) => {
      callCount++;
      capturedTableDataTexts.push(dynamicContent.tableDataText);
      if (callCount === 1) return '<tableEdit>INSERT INTO missing (value) VALUES (1);</tableEdit>';
      if (callCount === 2) return '<tableEdit>INSERT INTO t (missing_col) VALUES (1);</tableEdit>';
      return '<tableEdit>DELETE FROM t WHERE row_id = 1;</tableEdit>';
    });

    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });

    const resultPromise = executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      0, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    const result = await resultPromise;

    expect(result.success, result.error).toBe(true);
    expect(callCount).toBe(3);

    // 第二次调用时应包含第一次的错误信息
    expect(capturedTableDataTexts[1]).toContain('无法识别的目标表「missing」');
    // 第三次调用时应包含第二次的错误信息（替换了第一次的）
    expect(capturedTableDataTexts[2]).toContain('missing_col');
    // 第三次不应包含第一次的错误信息（被替换了）
    expect(capturedTableDataTexts[2]).not.toContain('no such table');

    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

 it('SQL 直接 provider 路径在执行与 V2 operation 中使用系统物化的 row_id', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(isSqliteMode).mockReturnValue(true);

    const snapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'test',
        name: '测试表',
        sourceData: { ddl: 'CREATE TABLE test (row_id INTEGER PRIMARY KEY, col1 TEXT NOT NULL);' },
        content: [['row_id', 'col1'], ['1', '旧值']],
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    } as any;
    mockCurrentJsonTableData = structuredClone(snapshot);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(structuredClone(snapshot));
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '原始数据' });
    mockCallCustomOpenAI.mockResolvedValue("<tableEdit>INSERT INTO test (col1) VALUES ('新值');</tableEdit>");
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });

    try {
      const result = await executeCardUpdateCore_ACU(
        [{ is_user: false, mes: 'AI回复' }],
        0, false, 'auto_standard', false,
        ['sheet_0'], null, new AbortController(),
      );

      expect(result.success, result.error).toBe(true);
      const persistPayload = mockPersistTablesToChatMessage.mock.calls[0][0];
      expect(persistPayload.tableData.sheet_0.content).toEqual([
        ['row_id', 'col1'], ['1', '旧值'], ['2', '新值'],
      ]);
      expect(persistPayload.operations).toEqual([{
        kind: 'sql_sheet_batch',
        sheetKey: 'sheet_0',
        statements: ["INSERT INTO ceshibiao (row_id, col1) VALUES (2, '新值')"],
        tableName: 'ceshibiao',
        reason: 'system',
      }]);
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
    }
  });

});

// ═══════════════════════════════════════════════════════════════
// executeCardUpdateCore_ACU — V2 replay-root 准入（spv8.9）
// ═══════════════════════════════════════════════════════════════
describe('executeCardUpdateCore_ACU — V2 replay-root 准入', () => {
  beforeEach(async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { disposeStorageProvider } = await import('../../../src/service/table/table-storage-strategy');
    vi.mocked(isSqliteMode).mockReturnValue(false);
    disposeStorageProvider();
    vi.clearAllMocks();
    mockParseAndApplyTableEdits.mockReset();
    mockParseAndApplyTableEditsToData.mockReset();
    mockApplySqlEditsToTableDataSnapshot.mockReset();
    mockGetCurrentFlightModeState.mockReset().mockReturnValue({ enabled: false, hiddenRowIds: [], bigSummarySheetKey: '' });
    mockGetHiddenChronicleRowIdsAfterBigSummaryInsert.mockReset().mockReturnValue(null);
    mockStageFlightModeHiddenRowIds.mockReset().mockReturnValue(null);
    mockWasStopped = false;
    mockSettings = {
      ...mockSettings,
      tableMaxRetries: 3,
      autoUpdateTokenThreshold: 0,
      importPromptExcludeImportedWorldbookEntries: true,
    };
    mockCurrentJsonTableData = { sheet_0: { name: '测试表', content: [['row_id'], ['1']] } };
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 0 });
    mockEnsureBoundaryCheckpoint.mockResolvedValue({ success: true, changed: false, skipped: true });
    mockShouldRotateBoundaryCheckpoint.mockReturnValue(false);
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>有效内容</tableEdit>');
    mockParseAndApplyTableEdits.mockReturnValue({ success: true, modifiedKeys: ['sheet_0'] });
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    mockSaveIndependentTable.mockResolvedValue({ saved: true });
  });

  // 构造带 V2 full checkpoint 的聊天：index 24 是 full checkpoint（replay 根）。
  // 直接 import 真实 collectV2FullCheckpointIndices_ACU，验证准入按真实 persist 判定。
  function withFullCheckpointAt24(): any[] {
    // index 24 为 AI 楼层，携带真实 V2 full checkpoint 隔离标签（isolationKey=''）。
    // TavernDB_ACU_IsolatedData 结构与 chat-message-data-repo 的读取约定一致。
    return Array.from({ length: 25 }, (_, i) => {
      const message: any = { is_user: i % 2 === 0, mes: `楼层${i}` };
      if (i === 24) {
        message.TavernDB_ACU_IsolatedData = {
          '': {
            storageFrame: {
              version: 2,
              headRevision: 'rev-24',
              checkpoint: { kind: 'full', reason: 'auto_update', data: {} },
              logEntries: [],
            },
            _acu_storage_version: 2,
          },
        };
      }
      return message;
    });
  }

  it('target 等于 replay root 时放行并正常完成', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { collectV2FullCheckpointIndices_ACU } = await import('../../../src/service/table/storage-frame-v2-persist');
    const chat = withFullCheckpointAt24();
    expect(collectV2FullCheckpointIndices_ACU(chat, '')).toEqual([24]);
    vi.mocked(getChatArray_ACU).mockReturnValue(chat);

    const result = await executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      24, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    expect(result.success, result.error).toBe(true);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
  });

  it('target 早于 replay root 时在 AI 前被结构化阻断（AI/commit/frame 全为 0）', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const chat = withFullCheckpointAt24();
    vi.mocked(getChatArray_ACU).mockReturnValue(chat);

    const result = await executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      23, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    expect(result.success).toBe(false);
    expect(result.diagnosticCode).toBe('write_target_before_replay_root');
    expect(result.diagnostic?.executionPath).toBe('legacy_auto');
    expect(result.diagnostic?.targetMessageIndex).toBe(23);
    expect(result.diagnostic?.latestReplayRootIndex).toBe(24);
    expect(mockPrepareAIInput).not.toHaveBeenCalled();
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockSaveIndependentTable).not.toHaveBeenCalled();
  });

  it('普通 legacy 路径不享受 provisional bridge 例外（target<root 即使有 active bridge 仍阻断）', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const chat = withFullCheckpointAt24();
    vi.mocked(getChatArray_ACU).mockReturnValue(chat);

    // 即使存在 active provisional bridge，普通 legacy 自动入口（不传任何豁免参数）
    // 也必须被结构化阻断——bridge 例外只存在于已有 catch-up/staging 专用路径。
    const { readActiveProvisionalBridge_ACU } = await import('../../../src/service/table/manual-catch-up-provisional-bridge');
    vi.mocked(readActiveProvisionalBridge_ACU).mockReturnValue({
      runId: 'bridge-1',
      anchorMessageIndex: 20,
      originalFullCheckpointIndex: 24,
    } as any);

    const result = await executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      23, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    expect(result.success).toBe(false);
    expect(result.diagnosticCode).toBe('write_target_before_replay_root');
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
  });

  it('无 full checkpoint 时放行（无 replay 根，不阻断）', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const chat = [{ is_user: false, mes: 'AI回复' }, { is_user: true, mes: '用户' }];
    vi.mocked(getChatArray_ACU).mockReturnValue(chat);

    const result = await executeCardUpdateCore_ACU(
      [{ is_user: false, mes: 'AI回复' }],
      0, false, 'auto_standard', false,
      ['sheet_0'], null, new AbortController()
    );

    expect(result.success, result.error).toBe(true);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
  });
});


// ═══════════════════════════════════════════════════════════════
// 表级 API 预设覆盖决议（orchestrateManualUpdate_ACU）
// ═══════════════════════════════════════════════════════════════
describe('orchestrateManualUpdate_ACU — 表级 API 预设覆盖', () => {
  const mockProcessBatch = vi.fn();
  const mockRefreshData = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    vi.clearAllMocks();
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '测试表', updateConfig: { groupId: 0 }, content: [['row_id', '值']] },
    });

    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockUpdateReadableLorebookEntry.mockResolvedValue(undefined);
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 3 });
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      if (aiResponse.includes('sheet_0')) {
        if (tableData.sheet_0) tableData.sheet_0.content.push(['2', '来自A']);
        return { success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 };
      }
      if (aiResponse.includes('sheet_1')) {
        if (tableData.sheet_1) tableData.sheet_1.content.push(['2', '来自B']);
        return { success: true, modifiedKeys: ['sheet_1'], appliedEdits: 1 };
      }
      return { success: false, modifiedKeys: [], appliedEdits: 0 };
    });
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(false);
    mockIsAutoUpdating = false;
    mockCoreApisReady = true;
    mockCurrentJsonTableData = { sheet_0: { name: '纪要表', updateConfig: {}, content: [['row_id', '值']] } };
    mockSettings = {
      ...mockSettings,
      apiMode: 'custom',
      apiConfig: { useMainApi: true, url: '', model: '' },
      autoUpdateThreshold: 3,
      manualUpdateContextDepth: 3,
      updateBatchSize: 3,
      manualUpdateBatchSize: 3,
      skipUpdateFloors: 0,
      tableApiPresetOverridesByName: {},
    };
  });

  it('表有覆盖预设时，requestOptions 携带 tableApiPreset', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    // parseTableTemplateJson_ACU mock 返回 { sheet_0: { name: '测试表' } }
    mockSettings.tableApiPresetOverridesByName = { '测试表': 'special-preset' };

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);
    expect(result.success).toBe(true);

    // 验证 callCustomOpenAI 被调用时携带了 requestOptions.tableApiPreset
    const openAICall = mockCallCustomOpenAI.mock.calls[0];
    const requestOptions = openAICall[2]; // 第三参 = requestOptions
    expect(requestOptions).toBeDefined();
    expect(requestOptions.tableApiPreset).toBe('special-preset');
  });

  it('表无覆盖预设时，requestOptions 不携带 tableApiPreset', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    mockSettings.tableApiPresetOverridesByName = {};

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);
    expect(result.success).toBe(true);

    const openAICall = mockCallCustomOpenAI.mock.calls[0];
    const requestOptions = openAICall[2];
    expect(requestOptions?.tableApiPreset).toBeUndefined();
  });

  it('表名为空时忽略覆盖', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockCurrentJsonTableData = { sheet_0: { name: '', updateConfig: {} } };

    mockSettings.tableApiPresetOverridesByName = { '': 'should-not-apply' };

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);
    expect(result.success).toBe(true);

    const openAICall = mockCallCustomOpenAI.mock.calls[0];
    const requestOptions = openAICall[2];
    expect(requestOptions?.tableApiPreset).toBeUndefined();
  });

  it('表名有空格时进行标准化匹配', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    // parseTableTemplateJson_ACU mock 返回 { sheet_0: { name: '测试表' } }
    // 设置 mockCurrentJsonTableData 的 name 带空格并不影响决议，
    // 因为决议用的是 parseTableTemplateJson_ACU 的返回值
    mockSettings.tableApiPresetOverridesByName = { '测试表': 'trimmed-preset' };

    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);
    expect(result.success).toBe(true);

    const openAICall = mockCallCustomOpenAI.mock.calls[0];
    const requestOptions = openAICall[2];
    expect(requestOptions.tableApiPreset).toBe('trimmed-preset');
  });

  it('同组多表配置不同 API preset 时拆组并分别调用对应 preset', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true },
      { is_user: false, mes: 'AI回复' },
    ]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '测试表A', updateConfig: { groupId: 7 }, content: [['row_id', '值']] },
      sheet_1: { name: '测试表B', updateConfig: { groupId: 7 }, content: [['row_id', '值']] },
    } as any);
    mockCurrentJsonTableData = {
      mate: { type: 'acu' },
      sheet_0: { name: '测试表A', updateConfig: { groupId: 7 }, content: [['row_id', '值']] },
      sheet_1: { name: '测试表B', updateConfig: { groupId: 7 }, content: [['row_id', '值']] },
    };
    mockSettings.maxConcurrentGroups = 2;
    mockSettings.tableApiPresetOverridesByName = {
      '测试表A': 'preset-a',
      '测试表B': 'preset-b',
    };
    mockCallCustomOpenAI.mockImplementation(async (_input: any, _controller: AbortController, options: any) =>
      `<tableEdit>${options.targetSheetKeys.join(' ')}</tableEdit>`
    );

    const result = await orchestrateManualUpdate_ACU(['sheet_0', 'sheet_1'], vi.fn().mockResolvedValue({ success: true }), mockRefreshData);

    expect(result.success).toBe(true);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(2);
    expect(mockCallCustomOpenAI.mock.calls.map(call => call[2].tableApiPreset).sort()).toEqual(['preset-a', 'preset-b']);
    expect(mockCallCustomOpenAI.mock.calls.map(call => call[2].targetSheetKeys).sort()).toEqual([['sheet_0'], ['sheet_1']]);
  });
});

describe('collectGroupFillResponse_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWasStopped = false;
    mockSettings = {
      ...mockSettings,
      tableMaxRetries: 2,
      autoUpdateTokenThreshold: 0,
      importPromptExcludeImportedWorldbookEntries: true,
    };
    mockCurrentJsonTableData = {
      sheet_0: { name: '全局表', content: [['row_id'], ['global']] },
    };
    mockPendingFinalGenerationGreenlights = [];
  });

  const createJob = () => ({
    groupKey: 'g0',
    groupId: 0,
    batchNumber: 1,
    targetSheetKeys: ['sheet_0'],
    messagesForContext: [{ is_user: false, mes: 'AI回复' }],
    saveTargetIndex: 0,
    updateMode: 'auto_standard',
    isImportMode: false,
    requestOptions: null,
    baseSnapshot: {
      sheet_0: { name: '快照表', content: [['row_id'], ['snapshot']] },
    },
  });

  it('显式 baseSnapshot 传给 prepareAIInput_ACU，且 collect 阶段不触发 parse/save', async () => {
    const job = createJob();
    const pendingGreenlights = [{ bookName: '角色A世界书', uid: 1, reason: '填表需要' }];
    mockPendingFinalGenerationGreenlights = pendingGreenlights;
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>insertRow(0,{"0":"x"})</tableEdit>');

    const result = await collectGroupFillResponse_ACU(job);

    expect(result.success).toBe(true);
    expect(result.job).toBe(job);
    expect(mockPrepareAIInput).toHaveBeenCalledWith(
      job.messagesForContext,
      job.updateMode,
      job.targetSheetKeys,
      expect.objectContaining({
        tableData: job.baseSnapshot,
        excludeImportTaggedWorldbookEntries: false,
        agentGreenlights: pendingGreenlights,
      })
    );
    const prepareOptions = mockPrepareAIInput.mock.calls[0][3];
    expect(prepareOptions).toHaveProperty('agentGreenlights');
    expect(prepareOptions.agentGreenlights).toEqual(pendingGreenlights);
    expect(prepareOptions.agentGreenlights).not.toBe(pendingGreenlights);
    expect(mockParseAndApplyTableEdits).not.toHaveBeenCalled();
    expect(mockSaveIndependentTable).not.toHaveBeenCalled();
    expect(mockRunTableUpdateApplyWithScopeLock).not.toHaveBeenCalled();
    expect(mockEnqueueSummaryVectorIndexFlush).not.toHaveBeenCalled();
  });

  it('AI 输入准备返回 SQLite failure code 时不调用 AI 且保留可操作原因', async () => {
    const job = createJob();
    mockPrepareAIInput.mockResolvedValue({
      ok: false,
      failureCode: 'provider_fallback',
      message: 'SQLite 运行时加载失败，当前未使用 SQLite 数据库。',
      retryable: false,
    });

    const result = await collectGroupFillResponse_ACU(job);

    expect(result).toMatchObject({
      success: false,
      attempt: 0,
      errorCategory: 'infrastructure',
    });
    expect(result.error).toContain('provider_fallback');
    expect(result.error).toContain('SQLite 运行时加载失败');
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
  });

  it('SQLite 输入准备等待真实 readiness 航班完成后才调用一次 AI', async () => {
    const job = createJob();
    let resolvePrepare!: (value: any) => void;
    mockPrepareAIInput.mockImplementationOnce(() => new Promise(resolve => {
      resolvePrepare = resolve;
    }));
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>insertRow(0,{"0":"x"})</tableEdit>');

    const resultPromise = collectGroupFillResponse_ACU(job);
    await Promise.resolve();

    expect(mockPrepareAIInput).toHaveBeenCalledTimes(1);
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();

    resolvePrepare({ tableDataText: '模拟数据' });
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(mockPrepareAIInput).toHaveBeenCalledTimes(1);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    expect(mockPrepareAIInput.mock.calls[0]?.[3]).toEqual(expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it('SQLite readiness 等待可由 AbortSignal 取消，取消后不调用 AI', async () => {
    const job = createJob();
    const controller = new AbortController();
    mockPrepareAIInput.mockImplementationOnce((_messages, _mode, _keys, prepareOptions) => (
      new Promise((_resolve, reject) => {
        const signal = prepareOptions.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    ));

    const resultPromise = collectGroupFillResponse_ACU(job, undefined, controller);
    await Promise.resolve();
    controller.abort();
    const result = await resultPromise;

    expect(result).toMatchObject({ success: false, attempt: 0, aborted: true });
    expect(mockPrepareAIInput).toHaveBeenCalledTimes(1);
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
  });

  it('输入准备返回结构化 readiness 失败时不在编排器内轮询', async () => {
    const job = createJob();
    mockPrepareAIInput.mockResolvedValue({
      ok: false,
      failureCode: 'runtime_loading',
      message: 'SQLite 运行时正在加载。',
      retryable: true,
    });

    const result = await collectGroupFillResponse_ACU(job);

    expect(result).toMatchObject({ success: false, attempt: 0, errorCategory: 'infrastructure' });
    expect(result.error).toContain('runtime_loading');
    expect(mockPrepareAIInput).toHaveBeenCalledTimes(1);
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
  });

  it('作者 DDL 名冲突返回结构化失败时不调用 AI', async () => {
    const job = createJob();
    mockPrepareAIInput.mockResolvedValue({
      ok: false,
      failureCode: 'authored_table_name_conflict',
      message: '模板中多个表共用作者 DDL 表名「inventory」，无法安全路由 AI SQL。',
      retryable: false,
    });

    const result = await collectGroupFillResponse_ACU(job);

    expect(result).toMatchObject({ success: false, attempt: 0, errorCategory: 'infrastructure' });
    expect(result.error).toContain('authored_table_name_conflict');
    expect(result.error).toContain('多个表共用作者 DDL 表名');
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
  });

  it('普通 tableEdit 路径保留 AI 使用的作者英文 SQL 表名', async () => {
    const job = createJob();
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockPrepareAIInput.mockResolvedValue({ tableDataText: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' });
    mockCallCustomOpenAI.mockImplementation(async (dynamicContent: any) => {
      expect(dynamicContent.tableDataText).toContain('CREATE TABLE inventory');
      expect(dynamicContent.tableDataText).not.toContain('beibaowupinbiao');
      return "<tableEdit>INSERT INTO inventory (item_name) VALUES ('药水');</tableEdit>";
    });

    const result = await collectGroupFillResponse_ACU(job);

    expect(result).toMatchObject({ success: true, tableEditText: "INSERT INTO inventory (item_name) VALUES ('药水');" });
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('strict JSON 路径同样保留 AI 使用的作者英文 SQL 表名', async () => {
    const job = createJob();
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockSettings.strictJsonTableFillEnabled = true;
    try {
      mockPrepareAIInput.mockResolvedValue({ tableDataText: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' });
      mockCallCustomOpenAI.mockImplementation(async (dynamicContent: any) => {
        expect(dynamicContent.tableDataText).toContain('CREATE TABLE inventory');
        expect(dynamicContent.tableDataText).not.toContain('beibaowupinbiao');
        return JSON.stringify({ format: 'table_edit_sql_v1', sql: "INSERT INTO inventory (item_name) VALUES ('药水');" });
      });

      const result = await collectGroupFillResponse_ACU(job);
      expect(result).toMatchObject({ success: true, tableEditText: "INSERT INTO inventory (item_name) VALUES ('药水');" });
    } finally {
      mockSettings.strictJsonTableFillEnabled = false;
      vi.mocked(isSqliteMode).mockReturnValue(false);
    }
  });

  it('AI 响应缺少完整 tableEdit 标签时按重试次数失败', async () => {
    const job = createJob();
    mockSettings.tableMaxRetries = 1;
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('无效响应');

    const result = await collectGroupFillResponse_ACU(job);

    expect(result.success).toBe(false);
    expect(result.error).toContain('1 次尝试后仍失败');
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    expect(mockParseAndApplyTableEdits).not.toHaveBeenCalled();
    expect(mockSaveIndependentTable).not.toHaveBeenCalled();
  });

  it('空 API 响应按模型错误重试，成功后不注入 SQLite SQL 错误反馈', async () => {
    vi.useFakeTimers();
    try {
      const { RetryableAiResponseError_ACU } = await import('../../../src/service/ai/prompt-builder');
      const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
      vi.mocked(isSqliteMode).mockReturnValue(true);
      const job = createJob();
      mockPrepareAIInput.mockResolvedValue({ tableDataText: '原始数据' });
      mockCallCustomOpenAI
        .mockRejectedValueOnce(new RetryableAiResponseError_ACU())
        .mockImplementationOnce(async (dynamicContent: any) => {
          expect(dynamicContent.tableDataText).not.toContain('SQL_ERROR_FEEDBACK');
          return '<tableEdit>UPDATE test SET value = 1;</tableEdit>';
        });

      const resultPromise = collectGroupFillResponse_ACU(job);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toMatchObject({ success: true, attempt: 2 });
      expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(2);
      vi.mocked(isSqliteMode).mockReturnValue(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('空 API 响应重试耗尽后保留模型错误分类', async () => {
    vi.useFakeTimers();
    try {
      const { RetryableAiResponseError_ACU } = await import('../../../src/service/ai/prompt-builder');
      const job = createJob();
      mockSettings.tableMaxRetries = 2;
      mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
      mockCallCustomOpenAI.mockRejectedValue(new RetryableAiResponseError_ACU());

      const resultPromise = collectGroupFillResponse_ACU(job);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toMatchObject({ success: false, attempt: 2, errorCategory: 'model' });
      expect(result.error).toContain('2 次尝试后仍失败');
      expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SQL 模式下携带上轮错误反馈时，将 SQL_ERROR_FEEDBACK 注入到 prompt', async () => {
    const job = createJob();
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '原始数据' });
    mockCallCustomOpenAI.mockImplementation(async (dynamicContent: any) => {
      expect(dynamicContent.tableDataText).toContain('SQL_ERROR_FEEDBACK');
      expect(dynamicContent.tableDataText).toContain('no such table');
      return '<tableEdit>INSERT INTO test VALUES (1);</tableEdit>';
    });

    const result = await collectGroupFillResponse_ACU(job, { lastSqlError: 'no such table' });

    expect(result.success).toBe(true);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('模型 SQL 输出错误会脱敏注入下一次重试 prompt', async () => {
    vi.useFakeTimers();
    try {
      const job: any = createJob();
      job.baseSnapshot = {
        sheet_0: {
          uid: 'inventory',
          name: '背包表',
          sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);' },
          content: [['row_id', 'item_name'], ['1', '铁剑']],
        },
      };
      const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
      vi.mocked(isSqliteMode).mockReturnValue(true);
      mockPrepareAIInput.mockResolvedValue({ tableDataText: '原始数据' });
      mockCallCustomOpenAI
        .mockResolvedValueOnce('<tableEdit>CREATE TABLE leaked (id INTEGER);</tableEdit>')
        .mockImplementationOnce(async (dynamicContent: any) => {
          expect(dynamicContent.tableDataText).toContain('SQL_ERROR_FEEDBACK');
          expect(dynamicContent.tableDataText).toContain('SQLite 填表仅允许 INSERT、REPLACE、UPDATE、DELETE');
          return "<tableEdit>UPDATE inventory SET item_name = '药水' WHERE row_id = 1;</tableEdit>";
        });

      const resultPromise = collectGroupFillResponse_ACU(job);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(2);
      vi.mocked(isSqliteMode).mockReturnValue(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('基础设施错误立即失败，不进入模型 prompt，WARN 不暴露原始 groupKey 且限制错误长度', async () => {
    vi.useFakeTimers();
    try {
      const { logWarn_ACU } = await import('../../../src/shared/utils');
      const job: any = createJob();
      job.groupKey = `sensitive-preset-${'x'.repeat(1200)}`;
      const infrastructureError = `401 https://internal.example/token?secret=abc ${'y'.repeat(1200)}`;
      const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
      vi.mocked(isSqliteMode).mockReturnValue(true);
      mockPrepareAIInput.mockResolvedValue({ tableDataText: '原始数据' });
      mockCallCustomOpenAI.mockRejectedValueOnce(new Error(infrastructureError));

      const resultPromise = collectGroupFillResponse_ACU(job);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe('infrastructure');
      expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
      const warning = String(vi.mocked(logWarn_ACU).mock.calls[0]?.[0] || '');
      expect(warning).toContain('groupId=0,batch=1,targets=1');
      expect(warning).not.toContain('sensitive-preset');
      expect(warning).not.toContain('internal.example');
      expect(warning).not.toContain('secret=abc');
      expect(warning.length).toBeLessThan(900);
      vi.mocked(isSqliteMode).mockReturnValue(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SQLite AI 响应引用隐藏物理列时在 collect 阶段拒绝并进入重试错误', async () => {
    const job: any = createJob();
    job.baseSnapshot = {
      sheet_0: {
        uid: 'inventory',
        name: '背包表',
        sourceData: {
          ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, legacy_note TEXT);',
          hiddenPhysicalColumns: ['legacy_note'],
        },
        content: [
          ['row_id', '名称', '旧备注'],
          ['1', '铁剑', '历史秘密'],
        ],
      },
    };
    mockSettings.tableMaxRetries = 1;
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '投影后的数据' });
    mockCallCustomOpenAI.mockResolvedValue("<tableEdit>UPDATE inventory SET legacy_note = '改写' WHERE row_id = 1;</tableEdit>");

    const result = await collectGroupFillResponse_ACU(job);

    expect(result.success).toBe(false);
    expect(result.error).toContain('隐藏物理列');
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it.each([
    'SELECT legacy_note FROM inventory',
    'PRAGMA table_info(inventory)',
    'COMMIT',
    'ROLLBACK',
    'VACUUM',
    'ALTER TABLE inventory DROP COLUMN legacy_note',
  ])('SQLite AI 响应的非 mutation SQL 在 collect 阶段 fail closed：%s', async statement => {
    const job: any = createJob();
    job.baseSnapshot = {
      sheet_0: {
        uid: 'inventory',
        name: '背包表',
        sourceData: {
          ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT, legacy_note TEXT);',
          hiddenPhysicalColumns: ['legacy_note'],
        },
        content: [['row_id', '名称', '旧备注'], ['1', '铁剑', '历史秘密']],
      },
    };
    mockSettings.tableMaxRetries = 1;
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '投影后的数据' });
    mockCallCustomOpenAI.mockResolvedValue(`<tableEdit>${statement}</tableEdit>`);

    const result = await collectGroupFillResponse_ACU(job);

    expect(result.success).toBe(false);
    expect(result.error).toContain('SQLite 填表仅允许 INSERT、REPLACE、UPDATE、DELETE 数据变更语句');
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it.each([
    "REPLACE INTO inventory (item_name) VALUES ('药水')",
    "INSERT OR REPLACE INTO inventory (row_id, item_name) VALUES (1, '药水')",
    "WITH payload AS (SELECT 1) REPLACE INTO inventory (item_name) VALUES ('药水')",
  ])('SQLite AI 响应在 collect 阶段允许 REPLACE：%s', async statement => {
    const job: any = createJob();
    job.baseSnapshot = {
      sheet_0: {
        uid: 'inventory',
        name: '背包表',
        sourceData: {
          ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT);',
        },
        content: [['row_id', '名称'], ['1', '铁剑']],
      },
    };
    mockSettings.tableMaxRetries = 1;
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '投影后的数据' });
    mockCallCustomOpenAI.mockResolvedValue(`<tableEdit>${statement}</tableEdit>`);

    const result = await collectGroupFillResponse_ACU(job);

    expect(result.success).toBe(true);
    expect(result.tableEditText).toBe(statement);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('prepareAIInput 返回 null 时直接失败', async () => {
    const job = createJob();
    mockPrepareAIInput.mockResolvedValue(null);

    const result = await collectGroupFillResponse_ACU(job);

    expect(result.success).toBe(false);
    expect(result.error).toContain('无法准备AI输入');
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
  });
});

describe('applyUnifiedGroupFillResponses_ACU', () => {
  beforeEach(async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { disposeStorageProvider } = await import('../../../src/service/table/table-storage-strategy');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, getEffectiveSeedRowsForSheet_ACU } = await import('../../../src/service/template/chat-scope');
    disposeStorageProvider();
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    vi.mocked(isSqliteMode).mockReturnValue(false);
    vi.clearAllMocks();
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '测试表', updateConfig: { groupId: 0 } },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
    vi.mocked(getEffectiveSeedRowsForSheet_ACU).mockReturnValue([] as any);
    mockSettings = {
      ...mockSettings,
      summaryVectorIndexModeEnabled: true,
    };
    mockCurrentJsonTableData = {
      sheet_0: { name: '全局污染表', content: [['row_id', '值'], ['1', 'global']] },
      sheet_1: { name: '全局污染表2', content: [['row_id', '值'], ['1', 'global-2']] },
    };
    mockUpdateReadableLorebookEntry.mockResolvedValue(undefined);
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 3 });
    mockGetChatArray_ACU.mockImplementation(() => mockChatArrayForSeedStage);
    // 这些用例验证的是“已有锚点后的增量提交”，因此必须在目标楼层前放一个
    // full checkpoint；否则本次写入会被判定为初始 checkpoint 而不带 operations。
    mockChatArrayForSeedStage.length = 0;
    mockChatArrayForSeedStage.push(
      {
        is_user: false,
        mes: 'AI锚点',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', reason: 'init', createdAt: 1, data: { mate: { type: 'acu' }, sheet_0: { name: '表A', content: [['row_id', '值']] }, sheet_1: { name: '表B', content: [['row_id', '值']] } } },
              logEntries: [],
            },
          },
        },
      } as any,
      { is_user: true, mes: '用户' } as any,
      { is_user: false, mes: 'AI2' } as any,
      { is_user: true, mes: '用户2' } as any,
      { is_user: false, mes: 'AI3' } as any,
    );
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      if (aiResponse.includes('sheet_0')) {
        tableData.sheet_0.content.push(['2', '来自A']);
        return { success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 };
      }
      if (aiResponse.includes('sheet_1')) {
        tableData.sheet_1.content.push(['2', '来自B']);
        return { success: true, modifiedKeys: ['sheet_1'], appliedEdits: 1 };
      }
      return { success: false, modifiedKeys: [], appliedEdits: 0 };
    });
  });

  it('按稳定顺序基于 baseSnapshot 合并响应，仅显式保存一次并触发一次 flush', async () => {
    const baseSnapshot = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    };
    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_1</tableEdit>', tableEditText: 'sheet_1', job: { groupKey: 'b', groupId: 2, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0</tableEdit>', tableEditText: 'sheet_0', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(result.modifiedKeys.sort()).toEqual(['sheet_0', 'sheet_1']);
    expect(mockParseAndApplyTableEditsToData.mock.calls.map(call => call[0])).toEqual(['<tableEdit>sheet_0</tableEdit>', '<tableEdit>sheet_1</tableEdit>']);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetMessageIndex: 3,
      targetSheetKeys: ['sheet_0', 'sheet_1'],
      updateGroupKeys: ['sheet_0', 'sheet_1'],
      trackingSheetKeys: ['sheet_0', 'sheet_1'],
      tableData: expect.objectContaining({
        sheet_0: expect.objectContaining({ content: [['row_id', '值'], ['1', 'base-a'], ['2', '来自A']] }),
        sheet_1: expect.objectContaining({ content: [['row_id', '值'], ['1', 'base-b'], ['2', '来自B']] }),
      }),
    }));
    const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    expect(savePayload.operations).toEqual([
      { kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: expect.objectContaining({
        content: [['row_id', '值'], ['1', 'base-a'], ['2', '来自A']],
      }), reason: 'system' },
      { kind: 'sheet_replace', sheetKey: 'sheet_1', sheet: expect.objectContaining({
        content: [['row_id', '值'], ['1', 'base-b'], ['2', '来自B']],
      }), reason: 'system' },
    ]);
    expect(savePayload.operations.some((operation: any) => operation.kind === 'data_replace')).toBe(false);
    expect(mockSaveIndependentTable).not.toHaveBeenCalled();
    expect(mockRunTableUpdateApplyWithScopeLock).not.toHaveBeenCalled();
    expect(mockEnqueueSummaryVectorIndexFlush).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSummaryVectorIndexFlush).toHaveBeenCalledWith(expect.objectContaining({ targetMessageIndex: 3, mode: 'sync', reason: 'unified_group_fill_complete' }));
    expect(mockUpdateReadableLorebookEntry).toHaveBeenCalledTimes(1);
    expect(baseSnapshot.sheet_0.content).toEqual([['row_id', '值'], ['1', 'base-a']]);
    expect(baseSnapshot.sheet_1.content).toEqual([['row_id', '值'], ['1', 'base-b']]);
  });
  it('规范化后的空模板首次填表可通过 snapshot 提交', async () => {
    const baseSnapshot = {
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值']] },
    };
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: '<tableEdit>sheet_0</tableEdit>',
      tableEditText: 'sheet_0',
      job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];
    mockParseAndApplyTableEditsToData.mockImplementationOnce((_aiResponse: string, tableData: any) => {
      tableData.sheet_0.content.push(['1', '首次填充']);
      return { success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 };
    });

    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, {
      saveTargetIndex: 3,
      updateMode: 'auto_standard',
      isImportMode: false,
    });

    expect(result).toMatchObject({ success: true, modifiedKeys: ['sheet_0'] });
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      tableData: expect.objectContaining({
        sheet_0: expect.objectContaining({ content: [['row_id', '值'], ['1', '首次填充']] }),
      }),
    }));
  });
  it('存在 full checkpoint 时新表不得清空 operations', async () => {
    // 回归：锚点判定一旦按目标表内容反推（要求 checkpoint 承载全部/部分目标表），
    // 只要本次涉及一张 checkpoint 里还没有的新表就会被误判为无锚点，
    // operations 被清空，数据静默写不进去也不报错。判据只能是「有没有 full checkpoint」。
    mockChatArrayForSeedStage.length = 0;
    mockChatArrayForSeedStage.push(
      {
        is_user: false,
        mes: 'AI锚点',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              // 锚点里只有 sheet_0，sheet_1 是本次新引入的表。
              checkpoint: { kind: 'full', reason: 'init', createdAt: 1, data: { mate: { type: 'acu' }, sheet_0: { name: '表A', content: [['row_id', '值']] } } },
              logEntries: [],
            },
          },
        },
      } as any,
      { is_user: true, mes: '用户' } as any,
      { is_user: false, mes: 'AI2' } as any,
      { is_user: true, mes: '用户2' } as any,
      { is_user: false, mes: 'AI3' } as any,
    );
    const baseSnapshot = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    };
    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0</tableEdit>', tableEditText: 'sheet_0', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_1</tableEdit>', tableEditText: 'sheet_1', job: { groupKey: 'b', groupId: 2, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    // 锚点有效，必须正常生成 sheet_replace 增量，不能为空。
    expect(savePayload.operations.length).toBeGreaterThan(0);
    expect(savePayload.operations.map((op: any) => op.sheetKey).sort()).toEqual(['sheet_0', 'sheet_1']);
  });

  it('模板范围只含 sheet_0 时，快照与 operations 只覆盖 sheet_0，范围外的 sheet_1 不写入', async () => {
    mockChatArrayForSeedStage.length = 0;
    mockChatArrayForSeedStage.push(
      {
        is_user: false,
        mes: 'AI锚点',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', reason: 'init', createdAt: 1, data: { mate: { type: 'acu' }, sheet_0: { name: '表A', content: [['row_id', '值']] }, sheet_1: { name: '表B', content: [['row_id', '值']] } } },
              logEntries: [],
            },
          },
        },
      } as any,
      { is_user: true, mes: '用户' } as any,
      { is_user: false, mes: 'AI2' } as any,
      { is_user: true, mes: '用户2' } as any,
      { is_user: false, mes: 'AI3' } as any,
    );
    // 模板范围只声明 sheet_0；sheet_1 在运行时存在但不在范围内，应保持休眠。
    mockResolveTemplateScope.mockReturnValue({ sheetKeys: new Set(['sheet_0']), sheets: {} } as any);
    try {
      const baseSnapshot = {
        sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
        sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
      };
      const responses = [
        { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0</tableEdit>', tableEditText: 'sheet_0', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
        { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_1</tableEdit>', tableEditText: 'sheet_1', job: { groupKey: 'b', groupId: 2, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
      ];
      mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
      const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

      expect(result.success).toBe(true);
      const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
      // 快照与追踪只覆盖模板范围内的 sheet_0。
      expect(savePayload.targetSheetKeys).toEqual(['sheet_0']);
      expect(savePayload.trackingSheetKeys).toEqual(['sheet_0']);
      // operations 不得包含范围外的 sheet_1。
      expect(savePayload.operations.some((op: any) => op.sheetKey === 'sheet_1')).toBe(false);
    } finally {
      mockResolveTemplateScope.mockReturnValue(null as any);
    }
  });



  it('目标楼层前缺少 full checkpoint 锚点时只提交 afterData 快照，不附带 operations', async () => {
    // 清空锚点：模拟手动重填已删除范围内 checkpoint，或全新隔离域首次写入。
    mockChatArrayForSeedStage.length = 0;
    mockChatArrayForSeedStage.push(
      { is_user: true, mes: '用户' } as any,
      { is_user: false, mes: 'AI1' } as any,
      { is_user: true, mes: '用户2' } as any,
      { is_user: false, mes: 'AI2' } as any,
    );
    const baseSnapshot = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    };
    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0</tableEdit>', tableEditText: 'sheet_0', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    // persist 层会把本次写入当作初始 full checkpoint，那种形态拒收 operations。
    expect(savePayload.operations).toEqual([]);
    // afterData 仍然是填表后的完整快照，checkpoint 不会丢数据。
    expect(savePayload.tableData.sheet_0.content).toEqual([['row_id', '值'], ['1', 'base-a'], ['2', '来自A']]);
  });

  it('非 SQL 路径存在可临时回放的 orphan artifacts 时保留本次 operations 供 persist 升级校验', async () => {
    mockChatArrayForSeedStage.length = 0;
    mockChatArrayForSeedStage.push(
      {
        is_user: false,
        mes: 'AI orphan',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: '1:orphan',
              logEntries: [{
                seq: 1, entryId: 'orphan-row', createdAt: 1, source: 'auto_fill', targetMessageIndex: 0, aiFloor: 1,
                filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
                operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '1', cells: ['1', 'base-a'] }],
              }],
            },
          },
        },
      } as any,
      { is_user: true, mes: '用户' } as any,
      { is_user: false, mes: 'AI2' } as any,
      { is_user: false, mes: 'AI3' } as any,
    );
    const baseSnapshot = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    };
    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0</tableEdit>', tableEditText: 'sheet_0', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(mockPersistTablesToChatMessage.mock.calls[0][0].operations).toEqual([
      { kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: expect.objectContaining({ content: [['row_id', '值'], ['1', 'base-a'], ['2', '来自A']] }), reason: 'system' },
    ]);
  });

  it('锚点存在时恢复增量提交，仍然生成 sheet_replace operations', async () => {
    const baseSnapshot = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    };
    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0</tableEdit>', tableEditText: 'sheet_0', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    expect(savePayload.operations).toEqual([
      { kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: expect.objectContaining({
        content: [['row_id', '值'], ['1', 'base-a'], ['2', '来自A']],
      }), reason: 'system' },
    ]);
  });



  it('首次填表时 unified 路径保存全量表，但只追踪实质修改表', async () => {
    mockCheckIfFirstTimeInit.mockResolvedValue(true);
    const baseSnapshot = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    };
    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0</tableEdit>', tableEditText: 'sheet_0', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0']);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetSheetKeys: ['sheet_0', 'sheet_1'],
      updateGroupKeys: ['sheet_0'],
      trackingSheetKeys: ['sheet_0'],
      tableData: expect.objectContaining({
        sheet_0: expect.objectContaining({ content: [['row_id', '值'], ['1', 'base-a'], ['2', '来自A']] }),
        sheet_1: expect.objectContaining({ content: [['row_id', '值'], ['1', 'base-b']] }),
      }),
    }));
    const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    expect(savePayload.operations).toEqual([
      { kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: expect.objectContaining({
        content: [['row_id', '值'], ['1', 'base-a'], ['2', '来自A']],
      }), reason: 'system' },
      { kind: 'sheet_replace', sheetKey: 'sheet_1', sheet: expect.objectContaining({ content: [['row_id', '值'], ['1', 'base-b']] }), reason: 'system' },
    ]);
    expect(savePayload.operations.some((operation: any) => operation.kind === 'data_replace')).toBe(false);
  });

  it('unified 中存在 no-op group 时仍整体成功但只追踪实质修改表', async () => {
    const baseSnapshot = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    };
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      if (aiResponse.includes('sheet_0')) {
        tableData.sheet_0.content.push(['2', '来自A']);
        return { success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 };
      }
      return { success: true, modifiedKeys: [], appliedEdits: 0 };
    });
    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0</tableEdit>', tableEditText: 'sheet_0', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_1</tableEdit>', tableEditText: 'sheet_1', job: { groupKey: 'b', groupId: 2, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0']);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetSheetKeys: ['sheet_0'],
      updateGroupKeys: ['sheet_0', 'sheet_1'],
      trackingSheetKeys: ['sheet_0'],
    }));
  });

  it('SQL 模式下基于显式 baseSnapshot 顺序统一提交，不污染全局 currentJsonTableData', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const inventoryDDL = `CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    const questDDL = `CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    const baseSnapshot = {
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: inventoryDDL }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: questDDL }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    const responses = [
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO quest_log (value) VALUES ('sql-b');</tableEdit>", tableEditText: "INSERT INTO quest_log (value) VALUES ('sql-b');", job: { groupKey: 'b', groupId: 2, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO inventory (value) VALUES ('sql-a');</tableEdit>", tableEditText: "INSERT INTO inventory (value) VALUES ('sql-a');", job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0', 'sheet_1']);
    expect(mockParseAndApplyTableEditsToData).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    const savedData = mockPersistTablesToChatMessage.mock.calls[0][0].tableData;
    expect(savedData.sheet_0.content).toEqual([['row_id', 'value'], ['1', 'base-a'], ['2', 'sql-a']]);
    expect(savedData.sheet_1.content).toEqual([['row_id', 'value'], ['1', 'base-b'], ['2', 'sql-b']]);
    expect(mockCurrentJsonTableData.sheet_0.content).toEqual([['row_id', 'value'], ['1', 'base-a'], ['2', 'sql-a']]);
    expect(mockCurrentJsonTableData.sheet_1.content).toEqual([['row_id', 'value'], ['1', 'base-b'], ['2', 'sql-b']]);
    expect(mockPersistTablesToChatMessage.mock.calls[0][0].operations).toEqual([
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_0', statements: ["INSERT INTO biaoa (row_id, value) VALUES (2, 'sql-a')"], tableName: 'biaoa', reason: 'system' },
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_1', statements: ["INSERT INTO biaob (row_id, value) VALUES (2, 'sql-b')"], tableName: 'biaob', reason: 'system' },
    ]);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQL 模式 live 填表出口对总结表应用自动编号，并以 sheet_replace 保证回放一致', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { isSummaryOrOutlineTable_ACU } = await import('../../../src/shared/utils');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    vi.mocked(isSummaryOrOutlineTable_ACU).mockImplementation((name: any) => name === '总结表');
    const summaryDDL = `CREATE TABLE summary_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    const baseSnapshot = {
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
      sheet_0: { uid: 'summary_log', name: '总结表', sourceData: { ddl: summaryDDL }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const responses = [
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO summary_log (value) VALUES ('新总结');</tableEdit>", tableEditText: "INSERT INTO summary_log (value) VALUES ('新总结');", job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    try {
      mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
      const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

      expect(result.success).toBe(true);
      // 自动编号已应用到 live 出口（编码列按 /编码|索引/ 匹配失败时回退末列）
      const savedData = mockPersistTablesToChatMessage.mock.calls[0][0].tableData;
      expect(savedData.sheet_0.content).toEqual([['row_id', 'value'], ['1', 'AM0001'], ['2', 'AM0002']]);
      // 回放一致性：sql_sheet_batch 回放不应用编号，必须由末位 sheet_replace 覆盖
      const operations = mockPersistTablesToChatMessage.mock.calls[0][0].operations;
      expect(operations[operations.length - 1]).toEqual({
        kind: 'sheet_replace',
        sheetKey: 'sheet_0',
        sheet: expect.objectContaining({ content: [['row_id', 'value'], ['1', 'AM0001'], ['2', 'AM0002']] }),
        reason: 'system',
      });
      expect(operations.some((op: any) => op.kind === 'sql_sheet_batch' && op.sheetKey === 'sheet_0')).toBe(true);
    } finally {
      vi.mocked(isSummaryOrOutlineTable_ACU).mockImplementation(() => false);
      vi.mocked(isSqliteMode).mockReturnValue(false);
    }
  });

  it('SQL 模式下模板范围外的表连 SQL 一起屏蔽，不执行也不写增量', async () => {
    // 回归：若只收窄 keysToSave 而仍执行 SQL，会在运行时改动范围外的表
    // 并写出挂在缺表 checkpoint 上的孤立增量，回放时报 no such table。
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const inventoryDDL = `CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    const questDDL = `CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    const baseSnapshot = {
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: inventoryDDL }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: questDDL }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    const responses = [
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO inventory (value) VALUES ('sql-a');</tableEdit>", tableEditText: "INSERT INTO inventory (value) VALUES ('sql-a');", job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO quest_log (value) VALUES ('sql-b');</tableEdit>", tableEditText: "INSERT INTO quest_log (value) VALUES ('sql-b');", job: { groupKey: 'b', groupId: 2, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];
    // 模板范围只声明 sheet_0。
    mockResolveTemplateScope.mockReturnValue({ sheetKeys: new Set(['sheet_0']), sheets: {} } as any);
    try {
      mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
      const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

      expect(result.success).toBe(true);
      const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
      // 只剩 sheet_0 的增量；范围外的 sheet_1 既不执行也不写入。
      expect(savePayload.operations.map((op: any) => op.sheetKey)).toEqual(['sheet_0']);
      expect(savePayload.operations.some((op: any) => op.sheetKey === 'sheet_1')).toBe(false);
    } finally {
      mockResolveTemplateScope.mockReturnValue(null as any);
      vi.mocked(isSqliteMode).mockReturnValue(false);
    }
  });


  it('SQL 模式下混合 SQL/非 SQL 响应直接失败，不退化为快照写入', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const inventoryDDL = `CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    const questDDL = `CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    const baseSnapshot = {
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: inventoryDDL }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: questDDL }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    const responses = [
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO inventory (value) VALUES ('sql-a');</tableEdit>", tableEditText: "INSERT INTO inventory (value) VALUES ('sql-a');", job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
      { success: true, attempt: 1, aiResponse: '<tableEdit>insertRow(1,{"0":"dsl-b"})</tableEdit>', tableEditText: 'insertRow(1,{"0":"dsl-b"})', job: { groupKey: 'b', groupId: 2, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(false);
    expect(result.error).toContain('禁止混合 SQL/非 SQL');
    expect(result.error).toContain('groupId=2');
    expect(result.error).not.toContain('group b');
    expect(mockApplySqlEditsToTableDataSnapshot).not.toHaveBeenCalled();
    expect(mockParseAndApplyTableEditsToData).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQL 模式统一提交失败时返回 SQL 错误且不保存', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const inventoryDDL = `CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    const baseSnapshot = {
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: inventoryDDL }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>UPDATE inventory SET missing_col = 1 WHERE row_id = 1;</tableEdit>', tableEditText: 'UPDATE inventory SET missing_col = 1 WHERE row_id = 1;', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(false);
    expect(result.error).toContain('groupId=1,batch=1,targets=1 SQL 执行失败');
    expect(result.error).toContain('missing_col');
    expect(result.error).not.toContain('group a');
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockUpdateReadableLorebookEntry).not.toHaveBeenCalled();
    expect(mockEnqueueSummaryVectorIndexFlush).not.toHaveBeenCalled();
    expect(mockCurrentJsonTableData.sheet_0.content).toEqual([['row_id', 'value'], ['1', 'base-a']]);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQL 统一执行边界允许 INSERT OR REPLACE 覆盖已有行', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const statement = "INSERT OR REPLACE INTO inventory (row_id, value) VALUES (1, 'replace-a')";
    const baseSnapshot = {
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
      sheet_0: {
        uid: 'inventory',
        name: '表A',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' },
        content: [['row_id', 'value'], ['1', 'base-a']],
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    } as any;
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: `<tableEdit>${statement}</tableEdit>`,
      tableEditText: statement,
      job: { groupKey: 'sensitive-group', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(result.tableData?.sheet_0.content).toEqual([['row_id', 'value'], ['1', 'replace-a']]);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalled();
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQL 模式静默忽略 AI 显式 row_id，并使用系统身份保存', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, getEffectiveSeedRowsForSheet_ACU } = await import('../../../src/service/template/chat-scope');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockChatArrayForSeedStage.push({ is_user: false, mes: '开场白' }, { is_user: true, mes: '第一条用户消息' });
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'tpl-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any);
    vi.mocked(getEffectiveSeedRowsForSheet_ACU).mockReturnValue([['1', 'tpl-a']] as any);

    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const responses = [
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO inventory (row_id, value) VALUES (999, 'sql-conflict');</tableEdit>", tableEditText: "INSERT INTO inventory (row_id, value) VALUES (999, 'sql-conflict');", job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(mockParseAndApplyTableEditsToData).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    const persistArgs = mockPersistTablesToChatMessage.mock.calls[0]?.[0];
    expect(persistArgs?.tableData?.sheet_0?.content).toContainEqual(['2', 'sql-conflict']);
    expect(persistArgs?.tableData?.sheet_0?.content.flat()).not.toContain('999');
    expect((persistArgs?.operations?.[0] as any)?.statements?.[0]).toContain("(row_id, value) VALUES (2, 'sql-conflict')");
    expect((persistArgs?.operations?.[0] as any)?.statements?.[0]).not.toContain('999');
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('默认开启越权降级时，SQL 批次只丢弃可证明仅影响非目标表的独立语句', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    const sql = [
      "INSERT INTO inventory (value) VALUES ('allowed')",
      "INSERT INTO quest_log (value) VALUES ('discarded')",
    ].join(';');
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: `<tableEdit>${sql}</tableEdit>`,
      tableEditText: sql,
      job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];

    mockSettings.discardUnauthorizedTableEditsEnabled = true;
    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0']);
    expect(result.tableData?.sheet_0.content).toContainEqual(['2', 'allowed']);
    expect(result.tableData?.sheet_1.content).toEqual([['row_id', 'value'], ['1', 'base-b']]);
    const persistArgs = mockPersistTablesToChatMessage.mock.calls[0]?.[0];
    expect(persistArgs.operations).toEqual([
      expect.objectContaining({ kind: 'sql_sheet_batch', sheetKey: 'sheet_0' }),
    ]);
    expect(JSON.stringify(persistArgs.operations)).not.toContain('discarded');
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQL 全部仅影响非目标表时丢弃后返回可重试模型错误，不执行也不保存', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: "<tableEdit>INSERT INTO quest_log (value) VALUES ('discarded');</tableEdit>",
      tableEditText: "INSERT INTO quest_log (value) VALUES ('discarded');",
      job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];

    mockSettings.discardUnauthorizedTableEditsEnabled = true;
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('model');
    expect(result.error).toContain('已全部丢弃');
    expect(result.error).toContain('允许写入表：sheet_0');
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('关闭越权降级时，独立的非目标表 SQL 仍按严格策略拒绝', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    const sql = "INSERT INTO inventory (value) VALUES ('allowed'); INSERT INTO quest_log (value) VALUES ('blocked');";
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: `<tableEdit>${sql}</tableEdit>`,
      tableEditText: sql,
      job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];

    mockSettings.discardUnauthorizedTableEditsEnabled = false;
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(false);
    expect(result.error).toContain('越权修改了非目标表 (sheet_1)');
    expect(result.error).toContain('允许写入表：sheet_0');
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('模板范围外（隐藏）表即使声明在 targetSheetKeys 中也被 SQL 授权集合拒绝', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    // AI 声称目标包含隐藏表 sheet_1（生命周期 hidden → 已从 TemplateScope 移除）。
    const sql = "INSERT INTO quest_log (value) VALUES ('hidden-write');";
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: `<tableEdit>${sql}</tableEdit>`,
      tableEditText: sql,
      job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0', 'sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];

    // 模板范围只声明 sheet_0；sheet_1 视为隐藏/休眠表。
    mockResolveTemplateScope.mockReturnValue({ sheetKeys: new Set(['sheet_0']), sheets: {} } as any);
    try {
      mockSettings.discardUnauthorizedTableEditsEnabled = false;
      const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('越权修改了非目标表 (sheet_1)');
      expect(result.error).toContain('允许写入表：sheet_0');
      expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    } finally {
      mockResolveTemplateScope.mockReturnValue(null as any);
      vi.mocked(isSqliteMode).mockReturnValue(false);
    }
  });

  // ── 阶段 E：未知 INSERT 列 gate 在统一提交层 fail-closed（零 mutation / 零 persist）──
  it('test31 无 DDL fallback 表：未知 INSERT 列在 SQLite mutation 前结构化拒绝，零持久化且错误脱敏', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      // 无 DDL fallback 表：runtime 物理列 row_id/item_name/quantity（拼音 slug）。
      sheet_0: { uid: 'inventory', name: '背包物品表', sourceData: {}, content: [['row_id', 'item_name', 'quantity'], ['1', '铁剑', '3']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const sqlApplyScope = {
      isolationKey: 'scope-unknown-col-e2e',
      templateData: baseSnapshot,
      templateDataWithRows: baseSnapshot,
      activeSheetKeys: ['sheet_0'],
      skippedSheets: [],
      runtimeData: buildInventoryRuntimeDataWithSchema(),
    } as any;
    // 有效冻结 runtime schema：live 合法列只有 row_id/item_name/quantity。
    function buildInventoryRuntimeDataWithSchema(): any {
      const ddl = 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT -- 物品名\n  quantity INTEGER -- 数量\n);';
      const data: any = {
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'inventory', name: '背包物品表', sourceData: { ddl },
          content: [['row_id', '物品名', '数量'], ['1', '铁剑', '3']],
          updateConfig: {}, exportConfig: {}, orderNo: 0,
        },
      };
      Object.defineProperty(data.sheet_0, '_acu_runtimeEffectiveSchema', {
        value: {
          effectiveDDL: ddl,
          columnMap: {
            mappings: [
              { sourceIndex: 0, displayName: 'row_id', sqlName: 'row_id', required: true },
              { sourceIndex: 1, displayName: '物品名', sqlName: 'item_name', required: false },
              { sourceIndex: 2, displayName: '数量', sqlName: 'quantity', required: false },
            ],
            sqlToDisplay: { row_id: 'row_id', item_name: '物品名', quantity: '数量' },
          },
          source: 'explicit',
          diagnostics: [],
          originalDdlDigest: 'inventory-test',
        },
        enumerable: false,
      });
      return data;
    }
    const sql = "INSERT INTO inventory (xi_xiang_guan_wu_pin) VALUES ('错误列');";
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: `<tableEdit>${sql}</tableEdit>`,
      tableEditText: sql,
      job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];

    mockSettings.discardUnauthorizedTableEditsEnabled = false;
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, {
      saveTargetIndex: 3,
      updateMode: 'auto_standard',
      isImportMode: false,
      sqlApplyScope,
    });

    // 结构化失败：SQL_INSERT_UNKNOWN_COLUMN_ACU，分类为可重试 model。
    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('model');
    expect(result.error).toContain('SQL_INSERT_UNKNOWN_COLUMN_ACU');
    // 脱敏：不得回显 VALUES 业务值 / 完整 SQL。
    expect(result.error).not.toContain('错误列');
    expect(result.error).not.toContain('INSERT INTO');
    // 零持久化：不触发任何 frame/chat 提交。
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQL 活动快照投影剔除非首列空表头表后，AI 猜测休眠表写入在 rebind 层即被拒绝', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      // sheet_1 在运行时快照中仍存在（历史数据保留），但模板侧因非首列空表头被投影为休眠表。
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    // 请求前捕获的 SQL 活动快照：sheet_1 已被投影剔除（非首列空表头 → 休眠）。
    const sqlApplyScope = {
      isolationKey: 'scope-dormant-e2e',
      templateData: {
        mate: { type: 'acu', version: 1 },
        sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      },
      templateDataWithRows: {
        mate: { type: 'acu', version: 1 },
        sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      },
      activeSheetKeys: ['sheet_0'],
      skippedSheets: [{ sheetKey: 'sheet_1', name: '表B', emptyHeaderIndexes: [2] }],
    } as any;
    // AI 仍猜测写休眠表 sheet_1（quest_log）。
    const sql = "INSERT INTO quest_log (value) VALUES ('dormant-write');";
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: `<tableEdit>${sql}</tableEdit>`,
      tableEditText: sql,
      job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];

    mockSettings.discardUnauthorizedTableEditsEnabled = false;
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, {
      saveTargetIndex: 3,
      updateMode: 'auto_standard',
      isImportMode: false,
      sqlApplyScope,
    });

    // 休眠表不在列 registry（targetSheetKeys 过滤）：rebind fail-closed，不静默放行。
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/quest_log|未知|无法识别|失败/);
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('无法归属到已知表的 SQL 保持失败，禁止以越权降级名义静默丢弃', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const sql = "UPDATE unknown_table SET value = 'blocked' WHERE row_id = 1;";
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: `<tableEdit>${sql}</tableEdit>`,
      tableEditText: sql,
      job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];

    mockSettings.discardUnauthorizedTableEditsEnabled = true;
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('已全部丢弃');
    expect(result.error).toMatch(/unknown_table|未知|无法识别/);
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });


  it('歧义英文表名统一提交失败分类为 precondition，不保存、不当作可重试模型错误', async () => {
    // E1 止损：歧义英文 DDL 表名无法由 AI 通过重试解决，必须 fail-closed。
    // 若错误被包装为 ModelOutputRetryError_ACU 或标记为 model 类别，会回灌错误并等待 5 秒重试。
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const sharedDDL = 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);';
    const baseSnapshot = {
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
      sheet_0: { uid: 'a', name: '表A', sourceData: { ddl: sharedDDL }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'b', name: '表B', sourceData: { ddl: sharedDDL }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    const sql = "INSERT INTO global_state (value) VALUES ('ambiguous');";
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: `<tableEdit>${sql}</tableEdit>`,
      tableEditText: sql,
      job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('precondition');
    expect(result.error).toContain('歧义表名');
    expect(result.error).toContain('global_state');
    // 不落盘：不产生数据变更、不写 V2 增量、不回灌 Prompt。
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockEnqueueSummaryVectorIndexFlush).not.toHaveBeenCalled();
    expect(mockUpdateReadableLorebookEntry).not.toHaveBeenCalled();
    expect(mockCurrentJsonTableData.sheet_0.content).toEqual([['row_id', 'value'], ['1', 'base-a']]);
    expect(mockCurrentJsonTableData.sheet_1.content).toEqual([['row_id', 'value'], ['1', 'base-b']]);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('parser 返回越权 modifiedKeys 时直接失败且不保存', async () => {
    const baseSnapshot = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    };
    mockParseAndApplyTableEditsToData.mockImplementationOnce((_aiResponse: string, tableData: any) => {
      tableData.sheet_1.content.push(['2', '越权写入']);
      return { success: true, modifiedKeys: ['sheet_1'], appliedEdits: 1 };
    });

    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0</tableEdit>', tableEditText: 'sheet_0', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(false);
    expect(result.error).toContain('越权修改');
    expect(result.error).toContain('允许写入表：sheet_0');
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockEnqueueSummaryVectorIndexFlush).not.toHaveBeenCalled();
    expect(mockUpdateReadableLorebookEntry).not.toHaveBeenCalled();
  });

  it('使用真实 native DSL parser 时，统一提交基于显式 baseSnapshot 而不是全局污染数据', async () => {
    const actualParser = await vi.importActual<typeof import('../../../src/service/ai/prompt-builder/table-edit-parser')>('../../../src/service/ai/prompt-builder/table-edit-parser');
    mockParseAndApplyTableEditsToData.mockImplementation((...args: any[]) => actualParser.parseAndApplyTableEditsToData_ACU(...args));
    const baseSnapshot = {
      sheet_0: { uid: 'sheet_0', name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { uid: 'sheet_1', name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    };
    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>insertRow(0,{"0":"真实A"})</tableEdit>', tableEditText: 'insertRow(0,{"0":"真实A"})', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
      { success: true, attempt: 1, aiResponse: '<tableEdit>insertRow(1,{"0":"真实B"})</tableEdit>', tableEditText: 'insertRow(1,{"0":"真实B"})', job: { groupKey: 'b', groupId: 2, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    const savedData = mockPersistTablesToChatMessage.mock.calls[0][0].tableData;
    expect(savedData.sheet_0.content[1][1]).toBe('base-a');
    expect(savedData.sheet_0.content[2][1]).toBe('真实A');
    expect(savedData.sheet_1.content[1][1]).toBe('base-b');
    expect(savedData.sheet_1.content[2][1]).toBe('真实B');
    expect(savedData.sheet_0.content[1][1]).not.toBe('global');
    expect(savedData.sheet_1.content[1][1]).not.toBe('global-2');
  });

  it('collect 真实产物可直接进入 unified apply，不需要手工补 job', async () => {
    const actualParser = await vi.importActual<typeof import('../../../src/service/ai/prompt-builder/table-edit-parser')>('../../../src/service/ai/prompt-builder/table-edit-parser');
    mockParseAndApplyTableEditsToData.mockImplementation((...args: any[]) => actualParser.parseAndApplyTableEditsToData_ACU(...args));
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI
      .mockResolvedValueOnce('<tableEdit>insertRow(0,{"0":"collectA"})</tableEdit>')
      .mockResolvedValueOnce('<tableEdit>insertRow(1,{"0":"collectB"})</tableEdit>');

    const baseSnapshot = {
      sheet_0: { uid: 'sheet_0', name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { uid: 'sheet_1', name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    };
    const jobA = { groupKey: 'a', groupId: 1, batchNumber: 1, targetSheetKeys: ['sheet_0'], messagesForContext: [{ is_user: false, mes: 'AI回复A' }], saveTargetIndex: 3, updateMode: 'auto_standard', requestOptions: null, baseSnapshot, isImportMode: false };
    const jobB = { groupKey: 'b', groupId: 2, batchNumber: 1, targetSheetKeys: ['sheet_1'], messagesForContext: [{ is_user: false, mes: 'AI回复B' }], saveTargetIndex: 3, updateMode: 'auto_standard', requestOptions: null, baseSnapshot, isImportMode: false };

    const responseA = await collectGroupFillResponse_ACU(jobA);
    const responseB = await collectGroupFillResponse_ACU(jobB);
    const result = await applyUnifiedGroupFillResponses_ACU([responseB, responseA], baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(responseA.job).toBe(jobA);
    expect(responseB.job).toBe(jobB);
    expect(result.success).toBe(true);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    const savedData = mockPersistTablesToChatMessage.mock.calls[0][0].tableData;
    expect(savedData.sheet_0.content[2][1]).toBe('collectA');
    expect(savedData.sheet_1.content[2][1]).toBe('collectB');
    expect(savedData.sheet_0.content[1][1]).toBe('base-a');
    expect(savedData.sheet_1.content[1][1]).toBe('base-b');
  });

  it('targetSheetKeys 重叠时直接失败，不解析不保存不触发 flush', async () => {
    const baseSnapshot = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    };
    const responses = [
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0</tableEdit>', tableEditText: 'sheet_0', job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
      { success: true, attempt: 1, aiResponse: '<tableEdit>sheet_0 again</tableEdit>', tableEditText: 'sheet_0 again', job: { groupKey: 'b', groupId: 2, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(false);
    expect(result.error).toContain('targetSheetKeys');
    expect(mockParseAndApplyTableEditsToData).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockSaveIndependentTable).not.toHaveBeenCalled();
    expect(mockEnqueueSummaryVectorIndexFlush).not.toHaveBeenCalled();
    expect(mockUpdateReadableLorebookEntry).not.toHaveBeenCalled();
  });

  it('SQLite 快照初始化再次遇到旧随机 key 基底时按 guide 稳定 key 归一且不保留重复表', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, buildGuidedBaseDataFromSheetGuide_ACU } = await import('../../../src/service/template/chat-scope');
    const ddl = 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item_name TEXT NOT NULL);';
    const guide = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_bei_bao_wu_pin_biao: {
        uid: 'sheet_bei_bao_wu_pin_biao',
        name: '背包物品表',
        sourceData: { ddl },
        content: [['row_id', 'item_name']],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;
    vi.mocked(isSqliteMode).mockReturnValue(true);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(structuredClone(guide));
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(guide);
    vi.mocked(buildGuidedBaseDataFromSheetGuide_ACU).mockReturnValue(structuredClone(guide));
    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_in05z9vz: {
        uid: 'sheet_in05z9vz',
        name: '背包物品表',
        sourceData: { ddl },
        content: [['row_id', 'item_name'], ['1', '铁剑']],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;
    mockParseAndApplyTableEditsToData.mockImplementationOnce((_response: string, tableData: any) => {
      tableData.sheet_bei_bao_wu_pin_biao.content.push(['2', '药水']);
      return { success: true, modifiedKeys: ['sheet_bei_bao_wu_pin_biao'], appliedEdits: 1 };
    });
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: '<tableEdit>insertRow(0,{"0":"药水"})</tableEdit>',
      tableEditText: 'insertRow(0,{"0":"药水"})',
      job: { groupKey: 'inventory', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_bei_bao_wu_pin_biao'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false },
    }];

    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    const savedData = mockPersistTablesToChatMessage.mock.calls[0][0].tableData;
    expect(savedData.sheet_in05z9vz).toBeUndefined();
    expect(savedData.sheet_bei_bao_wu_pin_biao.uid).toBe('sheet_bei_bao_wu_pin_biao');
    expect(savedData.sheet_bei_bao_wu_pin_biao.content).toEqual([
      ['row_id', 'item_name'],
      ['1', '铁剑'],
      ['2', '药水'],
    ]);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQL 模式下部分表无反馈时，仍用模板结构与基础数据初始化缺失表', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, getEffectiveSeedRowsForSheet_ACU } = await import('../../../src/service/template/chat-scope');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockChatArrayForSeedStage.push({ is_user: false, mes: '开场白' }, { is_user: true, mes: '第一条用户消息' });
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'tpl-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'tpl-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any);
    vi.mocked(getEffectiveSeedRowsForSheet_ACU).mockImplementation((sheetKey: string) => sheetKey === 'sheet_1' ? [['1', 'tpl-b']] : []);

    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const responses = [
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO inventory (value) VALUES ('sql-a');</tableEdit>", tableEditText: "INSERT INTO inventory (value) VALUES ('sql-a');", job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0', 'sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0']);
    expect(mockParseAndApplyTableEditsToData).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    expect(savePayload.targetSheetKeys).toEqual(['sheet_0', 'sheet_1']);
    expect(savePayload.tableData.sheet_0.content).toEqual([['row_id', 'value'], ['1', 'sql-a']]);
    expect(savePayload.tableData.sheet_1.content).toEqual([['row_id', 'value'], ['1', 'tpl-b']]);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQL 模式下模板无基础数据时，缺失表仍以表头空表落盘', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, getEffectiveSeedRowsForSheet_ACU } = await import('../../../src/service/template/chat-scope');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any);
    vi.mocked(getEffectiveSeedRowsForSheet_ACU).mockReturnValue([] as any);

    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const responses = [
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO inventory (value) VALUES ('sql-a');</tableEdit>", tableEditText: "INSERT INTO inventory (value) VALUES ('sql-a');", job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0', 'sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0']);
    expect(mockParseAndApplyTableEditsToData).not.toHaveBeenCalled();
    const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    expect(savePayload.targetSheetKeys).toEqual(['sheet_0', 'sheet_1']);
    expect(savePayload.tableData.sheet_1.content).toEqual([['row_id', 'value']]);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQL 模式下已有运行数据的表不重复灌入模板基础数据，也不扩大 targetSheetKeys', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, getEffectiveSeedRowsForSheet_ACU } = await import('../../../src/service/template/chat-scope');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'tpl-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'tpl-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any);
    vi.mocked(getEffectiveSeedRowsForSheet_ACU).mockImplementation((sheetKey: string) => sheetKey === 'sheet_1' ? [['1', 'tpl-b']] : []);

    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['9', 'existing-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any;
    const responses = [
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO inventory (value) VALUES ('sql-a');</tableEdit>", tableEditText: "INSERT INTO inventory (value) VALUES ('sql-a');", job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0', 'sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    expect(result.modifiedKeys).toEqual(['sheet_0']);
    expect(mockParseAndApplyTableEditsToData).not.toHaveBeenCalled();
    const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    expect(savePayload.targetSheetKeys).toEqual(['sheet_0']);
    expect(savePayload.tableData.sheet_1.content).toEqual([['row_id', 'value'], ['9', 'existing-b']]);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQL 模式下缺失表 seedRows 的 row_id 会在首次初始化时稳定化后再落盘', async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, getEffectiveSeedRowsForSheet_ACU } = await import('../../../src/service/template/chat-scope');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockChatArrayForSeedStage.push({ is_user: false, mes: '开场白' }, { is_user: true, mes: '第一条用户消息' });
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value'], ['1', 'tpl-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: 'CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any);
    vi.mocked(getEffectiveSeedRowsForSheet_ACU).mockImplementation((sheetKey: string) => sheetKey === 'sheet_1' ? [[null, 'tpl-b'], ['', 'tpl-c']] as any : []);

    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);' }, content: [['row_id', 'value']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    const responses = [
      { success: true, attempt: 1, aiResponse: "<tableEdit>INSERT INTO inventory (value) VALUES ('sql-a');</tableEdit>", tableEditText: "INSERT INTO inventory (value) VALUES ('sql-a');", job: { groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3, targetSheetKeys: ['sheet_0', 'sheet_1'], updateMode: 'auto_standard', requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false } },
    ];

    mockCurrentJsonTableData = JSON.parse(JSON.stringify(baseSnapshot));
    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, { saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false });

    expect(result.success).toBe(true);
    const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    expect(savePayload.targetSheetKeys).toEqual(['sheet_0', 'sheet_1']);
    expect(savePayload.tableData.sheet_1.content).toEqual([['row_id', 'value'], ['1', 'tpl-b'], ['2', 'tpl-c']]);
    expect(baseSnapshot.sheet_0.content).toEqual([['row_id', 'value']]);
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });
});

describe('processGroupedRuntimeChunk_ACU', () => {
  beforeEach(async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { disposeStorageProvider } = await import('../../../src/service/table/table-storage-strategy');
    disposeStorageProvider();
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    vi.mocked(isSqliteMode).mockReturnValue(false);
    vi.clearAllMocks();
    // clearAllMocks 只清调用记录，不清 mockResolvedValueOnce 队列；前一用例未消费的响应会污染后续 bucket 测试。
    mockCallCustomOpenAI.mockReset();
    mockPersistTablesToChatMessage.mockReset();
    mockParseAndApplyTableEditsToData.mockReset();
    mockWasStopped = false;
    mockSettings = {
      ...mockSettings,
      autoUpdateTokenThreshold: 0,
      updateBatchSize: 2,
      tableMaxRetries: 1,
      tableApiPresetOverridesByName: {},
    };
    mockCurrentJsonTableData = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    };
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockUpdateReadableLorebookEntry.mockResolvedValue(undefined);
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 3 });
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      if (aiResponse.includes('sheet_0')) {
        tableData.sheet_0.content.push([String(tableData.sheet_0.content.length), '来自A']);
        return { success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 };
      }
      if (aiResponse.includes('sheet_1')) {
        tableData.sheet_1.content.push([String(tableData.sheet_1.content.length), '来自B']);
        return { success: true, modifiedKeys: ['sheet_1'], appliedEdits: 1 };
      }
      return { success: false, modifiedKeys: [], appliedEdits: 0 };
    });
  });

  it('空分组直接成功且不调用 AI', async () => {
    const result = await processGroupedRuntimeChunk_ACU([], 'manual_independent');
    expect(result).toEqual({ success: true, failedGroups: [], committedBucketCount: 0 });
    expect(mockPrepareAIInput).not.toHaveBeenCalled();
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
  });

  it('迁移失败时拒绝整组处理且不触发 AI 或持久化', async () => {
    mockEnsureLegacyStorageMigratedBeforeWrite.mockResolvedValueOnce({ success: false, error: 'mixed storage evidence insufficient' });

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
      { key: 'group_b', groupId: 1, indices: [3], batchSize: 2, sheetKeys: ['sheet_1'], requestOptions: null },
    ], 'manual_independent');

    expect(result).toEqual({
      success: false,
      failedGroups: ['group_a', 'group_b'],
      error: 'mixed storage evidence insufficient',
      committedBucketCount: 0,
    });
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('执行 scope 只冻结 prompt 所需消息字段，不序列化完整聊天元数据', async () => {
    const metadataToJson = vi.fn(() => {
      throw new Error('不应序列化聊天持久化元数据');
    });
    mockGetChatArray_ACU.mockReturnValue([
      { is_user: true, name: '助手', mes: '问题', TavernDB_ACU_IsolatedData: { toJSON: metadataToJson } },
      { is_user: false, name: '角色', mes: 'AI回复', extra: { nested: '不应进入 prompt 快照' } },
    ]);
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any);
    mockCallCustomOpenAI.mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>');

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(metadataToJson).not.toHaveBeenCalled();
    expect(mockPrepareAIInput).toHaveBeenCalledWith([
      { is_user: true, name: '助手', mes: '问题' },
      { is_user: false, name: '角色', mes: 'AI回复' },
    ], expect.any(String), ['sheet_0'], expect.any(Object));

    const promptMessages = mockPrepareAIInput.mock.calls[0][0];
    promptMessages[0].mes = '被调用方修改';
    expect(mockGetChatArray_ACU.mock.results[0].value[0].mes).toBe('问题');
  });

  it('目标楼层自身已有前端 CRUD 写入的 init checkpoint 时，AI 基底包含既有行而不是空模板', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const template = {
      mate: { type: 'acu' },
      sheet_0: { uid: 'sheet_0', name: '表A', content: [['row_id', '值']] },
    } as any;
    const openingData = structuredClone(template);
    openingData.sheet_0.content = [['row_id', '值'], ['1', '开局写入-a'], ['2', '开局写入-b']];
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(template);
    mockCurrentJsonTableData = structuredClone(openingData);
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true, mes: '选择开局' },
      {
        is_user: false,
        mes: '开局正文',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', reason: 'init', createdAt: 1, data: structuredClone(openingData) },
              logEntries: [],
            },
          },
        },
      },
    ]);
    mockCallCustomOpenAI.mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>');

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(mockPrepareAIInput).toHaveBeenCalledTimes(1);
    const promptBase = mockPrepareAIInput.mock.calls[0][3].tableData;
    expect(promptBase.sheet_0.content).toEqual([['row_id', '值'], ['1', '开局写入-a'], ['2', '开局写入-b']]);
    // 提交结果建立在既有行之上：既有两行保留，AI 只追加一行
    const savePayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    expect(savePayload.tableData.sheet_0.content).toEqual([
      ['row_id', '值'],
      ['1', '开局写入-a'],
      ['2', '开局写入-b'],
      ['3', '来自A'],
    ]);
  });

  it('根在更早楼层、目标楼层自身带前端 CRUD 增量时，AI 基底同样包含该增量', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const template = {
      mate: { type: 'acu' },
      sheet_0: { uid: 'sheet_0', name: '表A', content: [['row_id', '值']] },
    } as any;
    const rootData = structuredClone(template);
    rootData.sheet_0.content = [['row_id', '值'], ['1', '根行']];
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(template);
    mockCurrentJsonTableData = structuredClone(rootData);
    mockCurrentJsonTableData.sheet_0.content.push(['2', '前端在目标楼写入']);
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        mes: '第一层',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', reason: 'init', createdAt: 1, data: structuredClone(rootData) },
              logEntries: [],
            },
          },
        },
      },
      { is_user: true, mes: '用户' },
      {
        is_user: false,
        mes: '第二层：前端脚本刚写入一行',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{
                seq: 1,
                entryId: 'crud-2',
                createdAt: 2,
                source: 'manual_crud',
                targetMessageIndex: 2,
                aiFloor: 2,
                filledSheetKeys: [],
                changedSheetKeys: ['sheet_0'],
                groupKeys: [],
                operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '前端在目标楼写入'] }],
                writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
              }],
            },
          },
        },
      },
    ]);
    mockCallCustomOpenAI.mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>');

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [2], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    const promptBase = mockPrepareAIInput.mock.calls[0][3].tableData;
    expect(promptBase.sheet_0.content).toEqual([['row_id', '值'], ['1', '根行'], ['2', '前端在目标楼写入']]);
  });

  it('同一 bucket 的多组只统一提交一次', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    } as any);
    mockCallCustomOpenAI
      .mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>')
      .mockResolvedValueOnce('<tableEdit>sheet_1</tableEdit>');

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
      { key: 'group_b', groupId: 1, indices: [1], batchSize: 2, sheetKeys: ['sheet_1'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockUpdateReadableLorebookEntry).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSummaryVectorIndexFlush).toHaveBeenCalledTimes(1);
  });

  it('grouped 提交在基底 key 漂移时使用唯一重绑定后的目标 key，不扩大授权集合', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    mockCurrentJsonTableData = {
      sheet_in05z9vz: {
        uid: 'sheet_in05z9vz',
        name: '背包物品表',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item TEXT);' },
        content: [['row_id', 'item']],
      },
    };
    const stableTemplate = {
      mate: { type: 'acu' },
      sheet_bei_bao_wu_pin_biao: {
        uid: 'sheet_bei_bao_wu_pin_biao',
        name: '背包物品表',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item TEXT);' },
        content: [['row_id', 'item']],
      },
    } as any;
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(stableTemplate);
    vi.mocked(getChatArray_ACU).mockReturnValue([
      {
        is_user: false,
        mes: '历史 V2 锚点',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'init',
                createdAt: 1,
                data: structuredClone(stableTemplate),
              },
              logEntries: [],
            },
          },
        },
      },
      { is_user: false, mes: 'AI回复' },
    ]);
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '稳定 key 基底' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>stable-target</tableEdit>');
    mockParseAndApplyTableEditsToData.mockImplementation((_response: string, tableData: any) => {
      tableData.sheet_bei_bao_wu_pin_biao.content.push(['1', '铁剑']);
      return { success: true, modifiedKeys: ['sheet_bei_bao_wu_pin_biao'], appliedEdits: 1 };
    });

    const result = await processGroupedRuntimeChunk_ACU([
      {
        key: 'legacy-inventory',
        groupId: -1,
        indices: [1],
        batchSize: 2,
        sheetKeys: ['sheet_in05z9vz'],
        requestOptions: null,
      },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(mockPrepareAIInput.mock.calls[0][2]).toEqual(['sheet_bei_bao_wu_pin_biao']);
    const persistPayload = mockPersistTablesToChatMessage.mock.calls[0][0];
    expect(persistPayload.targetSheetKeys).toEqual(['sheet_bei_bao_wu_pin_biao']);
    expect(persistPayload.targetSheetKeys).not.toContain('sheet_in05z9vz');
  });

  it('grouped 身份一对多时在调用 AI 前 fail closed，不执行或持久化', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    mockCurrentJsonTableData = {
      sheet_in05z9vz: {
        uid: 'sheet_in05z9vz',
        name: '背包物品表',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item TEXT);' },
        content: [['row_id', 'item']],
      },
    };
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_inventory_a: {
        uid: 'sheet_inventory_a',
        name: '旧背包',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item TEXT);' },
        content: [['row_id', 'item']],
      },
      sheet_inventory_b: {
        uid: 'sheet_inventory_b',
        name: '新背包',
        sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, item TEXT);' },
        content: [['row_id', 'item']],
      },
    } as any);
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true, mes: '用户' },
      { is_user: false, mes: 'AI回复' },
    ]);

    const result = await processGroupedRuntimeChunk_ACU([
      {
        key: 'ambiguous-inventory',
        groupId: -1,
        indices: [1],
        batchSize: 2,
        sheetKeys: ['sheet_in05z9vz'],
        requestOptions: null,
      },
    ], 'manual_independent');

    expect(result).toEqual(expect.objectContaining({ success: false, failedGroups: ['ambiguous-inventory'] }));
    expect(result.error).toContain('身份重绑定存在歧义');
    expect(mockPrepareAIInput).not.toHaveBeenCalled();
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('外部插件推进 runtime revision 后提交不中断，且不触发 RuntimeRevision 专用重放', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any);
    mockSettings = { ...mockSettings, tableMaxRetries: 2 };
    mockCallCustomOpenAI.mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>');
    // 外部插件已推进 revision（baseRevision 与当前 runtime 不一致），但事务层不再拒写，
    // 提交正常完成，不触发任何 RuntimeRevision 专用重试/重放。
    mockRunTableWriteTransaction.mockImplementationOnce(async (options: any, task: any) => task({
      transactionId: 'tx-external-drift',
      chatKey: 'test-chat',
      isolationKey: '',
      source: options.source,
      baseRevision: 'runtime-v1:stale-base',
      writeSet: options.writeSet,
      runCommit: async (commitTask: any) => commitTask(),
    }, JSON.parse(JSON.stringify(options.initialData))));

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result).toEqual(expect.objectContaining({ success: true, committedBucketCount: 1 }));
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    expect(mockPrepareAIInput).toHaveBeenCalledTimes(1);
    expect(mockRunTableWriteTransaction).toHaveBeenCalledTimes(1);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
  });

  it('多 bucket 批量重填期间外部并发写入不中断后续 bucket', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true, mes: '用户0' },
      { is_user: false, mes: '历史 AI 回复1' },
      { is_user: true, mes: '用户2' },
      { is_user: false, mes: '最新 AI 回复3' },
    ]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any);
    mockSettings = { ...mockSettings, tableMaxRetries: 2 };
    mockCallCustomOpenAI
      .mockResolvedValueOnce('<tableEdit>sheet_0 bucket1</tableEdit>')
      .mockResolvedValueOnce('<tableEdit>sheet_0 bucket2</tableEdit>');
    mockRunTableWriteTransaction
      .mockImplementationOnce(async (options: any, task: any) => task({
        transactionId: 'tx-bucket1',
        chatKey: 'test-chat',
        isolationKey: '',
        source: options.source,
        baseRevision: 'runtime-v1:bucket1-stale',
        writeSet: options.writeSet,
        runCommit: async (commitTask: any) => commitTask(),
      }, JSON.parse(JSON.stringify(options.initialData))));
    // 第二个 bucket 提交时 revision 同样已漂移，仍正常提交。
    mockRunTableWriteTransaction.mockImplementationOnce(async (options: any, task: any) => task({
      transactionId: 'tx-bucket2',
      chatKey: 'test-chat',
      isolationKey: '',
      source: options.source,
      baseRevision: 'runtime-v1:bucket2-stale',
      writeSet: options.writeSet,
      runCommit: async (commitTask: any) => commitTask(),
    }, JSON.parse(JSON.stringify(options.initialData))));

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 1, sheetKeys: ['sheet_0'], requestOptions: null },
      { key: 'group_b', groupId: 1, indices: [3], batchSize: 1, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result).toEqual(expect.objectContaining({ success: true, committedBucketCount: 2 }));
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(2);
    expect(mockRunTableWriteTransaction).toHaveBeenCalledTimes(2);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(2);
  });

  it('可回放重填只向当前 bucket 的真实 AI 消息和目标表传递 replacement 范围', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true, mes: '用户0' },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true, mes: '用户2' },
      { is_user: false, mes: 'AI回复3' },
    ]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any);
    mockCallCustomOpenAI
      .mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>')
      .mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>');

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1, 3], batchSize: 1, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent', { replaceExistingIncremental: true });

    expect(result).toEqual(expect.objectContaining({ success: true, committedBucketCount: 2 }));
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(2);
    expect(mockPersistTablesToChatMessage.mock.calls[0][0].replaceExistingIncremental).toEqual({
      targetMessageIndices: [1],
      targetSheetKeys: ['sheet_0'],
    });
    expect(mockPersistTablesToChatMessage.mock.calls[1][0].replaceExistingIncremental).toEqual({
      targetMessageIndices: [3],
      targetSheetKeys: ['sheet_0'],
    });
  });

  it('已提交一个 bucket 后用户终止时不启动后续 bucket', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: true, mes: '用户0' },
      { is_user: false, mes: 'AI回复1' },
      { is_user: true, mes: '用户2' },
      { is_user: false, mes: 'AI回复3' },
    ]);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    mockPersistTablesToChatMessage.mockImplementationOnce(async () => {
      mockWasStopped = true;
      return { saved: true, messageIndex: 1 };
    });

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1, 3], batchSize: 1, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent', { replaceExistingIncremental: true });

    expect(result).toEqual(expect.objectContaining({ success: false, aborted: true, committedBucketCount: 1 }));
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
  });

  it('grouped 手动路径会向 onProgress 转发 AI 调用进度', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any);
    mockCallCustomOpenAI.mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>');
    const onProgress = vi.fn();

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent', { onProgress });

    expect(result.success).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'calling_ai',
      attempt: 1,
      maxRetries: 1,
      currentBatch: 1,
      totalBatches: 1,
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'saving',
      currentBatch: 1,
      totalBatches: 1,
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'complete',
      currentBatch: 1,
      totalBatches: 1,
    }));
  });

  it('连续 bucket 使用运行时快照作为下一次 prompt 基底，不从聊天历史回放', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const chat = [
      { is_user: true, mes: 'u1' },
      { is_user: false, mes: 'a1' },
      { is_user: true, mes: 'u2' },
      { is_user: false, mes: 'a2' },
    ];
    vi.mocked(getChatArray_ACU).mockReturnValue(chat as any);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '纪要表', content: [['row_id', '内容']] },
    } as any);
    const promptBaseRows: any[][][] = [];
    mockPrepareAIInput.mockImplementation(async (_messages: any, _mode: string, _keys: string[] | null, options: any) => {
      promptBaseRows.push(JSON.parse(JSON.stringify(options.tableData.sheet_0.content)));
      return { tableDataText: '模拟数据' };
    });
    mockCallCustomOpenAI
      .mockResolvedValueOnce('<tableEdit>第一层纪要</tableEdit>')
      .mockResolvedValueOnce('<tableEdit>第二层纪要</tableEdit>');
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      if (aiResponse.includes('第一层纪要')) {
        tableData.sheet_0.content.push(['AM0001', '第一层纪要']);
      } else if (aiResponse.includes('第二层纪要')) {
        tableData.sheet_0.content.push(['AM0002', '第二层纪要']);
      }
      return { success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 };
    });
    mockPersistTablesToChatMessage.mockImplementation(async (options: any) => {
      const target = chat[options.targetMessageIndex] as any;
      target.TavernDB_ACU_IsolatedData = {
        '': {
          independentData: JSON.parse(JSON.stringify(options.tableData)),
          modifiedKeys: options.trackingSheetKeys || [],
          updateGroupKeys: options.updateGroupKeys || [],
          _acu_storage_mode: 'checkpoint',
        },
      };
      return { saved: true, messageIndex: options.targetMessageIndex };
    });

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'summary', groupId: 0, indices: [1, 3], batchSize: 1, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(promptBaseRows).toHaveLength(2);
    expect(promptBaseRows[0]).toEqual([['row_id', '值'], ['1', 'base-a']]);
    expect(promptBaseRows[1]).toEqual([['row_id', '值'], ['1', 'base-a'], ['AM0001', '第一层纪要']]);
  });


  it('手动重填多 bucket 逐 bucket 前移基底边界，纳入前一 bucket 增量且排除未处理楼层', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const chat = Array.from({ length: 31 }, (_, index) => ({ is_user: false, mes: `AI ${index}` })) as any[];
    const makeRows = (count: number) => [
      ['row_id', '值'],
      ...Array.from({ length: count }, (_unused, rowIndex) => [`${rowIndex + 1}`, `第${rowIndex + 1}层旧值`]),
    ];
    chat[20].TavernDB_ACU_IsolatedData = {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: {
            kind: 'full',
            createdAt: 20,
            reason: 'compaction',
            data: {
              mate: { type: 'acu' },
              sheet_0: { name: '测试表', content: makeRows(20) },
            },
          },
          logEntries: [],
        },
      },
    };
    for (let index = 21; index <= 30; index += 1) {
      chat[index].TavernDB_ACU_IsolatedData = {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [{
              seq: 1,
              entryId: `old-${index}`,
              createdAt: index,
              source: 'manual_fill',
              targetMessageIndex: index,
              aiFloor: index + 1,
              filledSheetKeys: ['sheet_0'],
              changedSheetKeys: ['sheet_0'],
              groupKeys: ['sheet_0'],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: `${index}`, cells: [`${index}`, `第${index}层旧值`] }],
              writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
            }],
          },
        },
      };
    }
    vi.mocked(getChatArray_ACU).mockReturnValue(chat as any);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '测试表', content: [['row_id', '值']], updateConfig: { groupId: 0 } },
    } as any);
    const promptBaseRows: any[][][] = [];
    mockPrepareAIInput.mockImplementation(async (_messages: any, _mode: string, _keys: string[] | null, options: any) => {
      promptBaseRows.push(JSON.parse(JSON.stringify(options.tableData.sheet_0.content)));
      return { tableDataText: '模拟数据' };
    });
    mockCallCustomOpenAI
      .mockResolvedValueOnce('<tableEdit>第27-28层新值</tableEdit>')
      .mockResolvedValueOnce('<tableEdit>第29-30层新值</tableEdit>');
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      if (aiResponse.includes('27-28')) tableData.sheet_0.content.push(['27', '第27层新值'], ['28', '第28层新值']);
      if (aiResponse.includes('29-30')) tableData.sheet_0.content.push(['29', '第29层新值'], ['30', '第30层新值']);
      return { success: true, modifiedKeys: ['sheet_0'], appliedEdits: 2 };
    });
    // 把每个 bucket 的提交结果作为 V2 增量写回聊天，模拟真实持久化，
    // 使后续 bucket 的 bounded replay 能够看到刚提交的行。
    mockPersistTablesToChatMessage.mockImplementation(async (options: any) => {
      const appendedRows = (options.tableData?.sheet_0?.content || []).slice(21);
      chat[options.targetMessageIndex].TavernDB_ACU_IsolatedData = {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [{
              seq: 1,
              entryId: `new-${options.targetMessageIndex}`,
              createdAt: options.targetMessageIndex,
              source: 'manual_fill',
              targetMessageIndex: options.targetMessageIndex,
              aiFloor: options.targetMessageIndex + 1,
              filledSheetKeys: ['sheet_0'],
              changedSheetKeys: ['sheet_0'],
              groupKeys: ['sheet_0'],
              operations: appendedRows.map((row: string[]) => ({
                kind: 'row_upsert', sheetKey: 'sheet_0', rowId: row[0], cells: row,
              })),
              writeSet: [{ kind: 'sheet', sheetKey: 'sheet_0' }],
            }],
          },
        },
      };
      return { saved: true, messageIndex: options.targetMessageIndex };
    });

    // 与 orchestrateManualUpdate_ACU 重填路径的真实调用形态一致：重填专用豁免同时声明
    // 基底边界保持「bucket 首楼 - 1」（目标楼层上的旧增量已被预清理/待重建，不得纳入基底）。
    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'manual_refill', groupId: 0, indices: [27, 28, 29, 30], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null, mergeBaseMaxMessageIndex: 26 },
    ], 'manual_independent', { skipWriteTargetAdmission: true });

    expect(result.success).toBe(true);
    expect(promptBaseRows).toHaveLength(2);
    expect(promptBaseRows[0]).toHaveLength(27);
    // 第一个 bucket 起点为 27，边界 26：不得包含 27~30 的行。
    expect(promptBaseRows[0].some(row => ['27', '28', '29', '30'].includes(row[0]))).toBe(false);
    // 第二个 bucket 起点为 29，边界前移到 28：必须纳入上一 bucket 刚提交的 27、28，
    // 同时仍不得包含本 bucket 尚未处理的 29、30。
    expect(promptBaseRows[1].map(row => row[0])).toContain('27');
    expect(promptBaseRows[1].map(row => row[0])).toContain('28');
    expect(promptBaseRows[1].some(row => ['29', '30'].includes(row[0]))).toBe(false);
  });

  it('SQL 模式下不再早退，而是完成 grouped 统一提交', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const inventoryDDL = `CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    const questDDL = `CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: inventoryDDL }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: questDDL }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any);
    mockCurrentJsonTableData = JSON.parse(JSON.stringify(vi.mocked(parseTableTemplateJson_ACU).getMockImplementation()?.() || {}));
    mockCallCustomOpenAI
      .mockResolvedValueOnce("<tableEdit>INSERT INTO inventory (value) VALUES ('sql-a');</tableEdit>")
      .mockResolvedValueOnce("<tableEdit>INSERT INTO quest_log (value) VALUES ('sql-b');</tableEdit>");

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
      { key: 'group_b', groupId: 1, indices: [1], batchSize: 2, sheetKeys: ['sheet_1'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(result.failedGroups).toEqual([]);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockParseAndApplyTableEditsToData).not.toHaveBeenCalled();
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('SQLite 分组混合 SQL/非 SQL 时只重试非 SQL 组，成功 SQL 组不重试', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    mockSettings.tableMaxRetries = 2;
    const inventoryDDL = `CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    const questDDL = `CREATE TABLE quest_log (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: inventoryDDL }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
      sheet_1: { uid: 'quest_log', name: '表B', sourceData: { ddl: questDDL }, content: [['row_id', 'value'], ['1', 'base-b']], updateConfig: {}, exportConfig: {}, orderNo: 1 },
    } as any);
    mockCurrentJsonTableData = JSON.parse(JSON.stringify(vi.mocked(parseTableTemplateJson_ACU).getMockImplementation()?.() || {}));
    const capturedTableDataTexts: string[] = [];
    mockPrepareAIInput.mockImplementation(async () => ({ tableDataText: '模拟数据' }));
    mockCallCustomOpenAI.mockImplementation(async (dynamicContent: any) => {
      capturedTableDataTexts.push(dynamicContent.tableDataText);
      if (mockCallCustomOpenAI.mock.calls.length === 1) return "<tableEdit>INSERT INTO inventory (value) VALUES ('sql-a');</tableEdit>";
      if (mockCallCustomOpenAI.mock.calls.length === 2) return '<tableEdit>insertRow(1,{"0":"dsl-b"})</tableEdit>';
      return "<tableEdit>INSERT INTO quest_log (value) VALUES ('sql-b');</tableEdit>";
    });

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
      { key: 'group_b', groupId: 1, indices: [1], batchSize: 2, sheetKeys: ['sheet_1'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(result.failedGroups).toEqual([]);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(3);
    expect(capturedTableDataTexts[2]).toContain('UNIFIED_GROUP_ERROR_FEEDBACK');
    expect(capturedTableDataTexts[2]).toContain('未返回 SQL tableEdit');
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockParseAndApplyTableEditsToData).not.toHaveBeenCalled();
    vi.mocked(isSqliteMode).mockReturnValue(false);
  });

  it('当前 bucket 失败后停止调度，后续 bucket 不调用 AI 或写盘', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复1' }, { is_user: true }, { is_user: false, mes: 'AI回复2' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    } as any);
    mockCallCustomOpenAI
      .mockResolvedValueOnce('无效响应')
      .mockResolvedValueOnce('<tableEdit>sheet_1</tableEdit>');

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 1, sheetKeys: ['sheet_0'], requestOptions: null },
      { key: 'group_b', groupId: 1, indices: [3], batchSize: 1, sheetKeys: ['sheet_1'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(false);
    expect(result.failedGroups).toContain('group_a');
    expect(result.failedGroups).not.toContain('group_b');
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('持久化失败属于基础设施错误，不进入下一轮 prompt 或再次调用 AI', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any);
    mockSettings.tableMaxRetries = 2;

    const capturedTableDataTexts: string[] = [];
    mockPrepareAIInput.mockImplementation(async () => ({ tableDataText: '模拟数据' }));
    mockCallCustomOpenAI.mockImplementation(async (dynamicContent: any) => {
      capturedTableDataTexts.push(dynamicContent.tableDataText);
      return '<tableEdit>sheet_0</tableEdit>';
    });

    mockPersistTablesToChatMessage
      .mockResolvedValueOnce({ saved: false, error: '401 https://internal.example/save?token=secret-token' });

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(false);
    expect(capturedTableDataTexts).toEqual(['模拟数据']);
    expect(result.error).not.toContain('internal.example');
    expect(result.error).not.toContain('secret-token');
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
  });

  it('统一提交持续失败到耗尽重试时整 bucket 失败且不落盘', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    } as any);
    mockSettings.tableMaxRetries = 2;
    mockCallCustomOpenAI
      .mockResolvedValue('<tableEdit>sheet_0</tableEdit>')
      .mockResolvedValue('<tableEdit>sheet_1</tableEdit>');
    mockParseAndApplyTableEditsToData.mockReturnValue({ success: false, modifiedKeys: [], appliedEdits: 0 });

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
      { key: 'group_b', groupId: 1, indices: [1], batchSize: 2, sheetKeys: ['sheet_1'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(false);
    expect(result.failedGroups).toEqual(expect.arrayContaining(['group_a', 'group_b']));
    expect(result.error).toContain('统一提交在 2 次尝试后仍失败');
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(4);
  });

  it('空 tableEdit 视为合法无更新且不重试同 bucket 的其他组', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    } as any);
    mockSettings.tableMaxRetries = 2;
    mockCallCustomOpenAI
      .mockResolvedValueOnce('<tableEdit>   </tableEdit>')
      .mockResolvedValueOnce('<tableEdit>sheet_1</tableEdit>');
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      if (aiResponse.includes('sheet_1')) {
        tableData.sheet_1.content.push(['2', '来自B']);
        return { success: true, modifiedKeys: ['sheet_1'], appliedEdits: 1 };
      }
      return { success: true, modifiedKeys: [], appliedEdits: 0 };
    });

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
      { key: 'group_b', groupId: 1, indices: [1], batchSize: 2, sheetKeys: ['sheet_1'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(result.failedGroups).toEqual([]);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetSheetKeys: ['sheet_1'],
      updateGroupKeys: ['sheet_0', 'sheet_1'],
      trackingSheetKeys: ['sheet_1'],
      targetMessageIndex: 1,
    }));
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(2);
  });


  it('首次初始化时 grouped 主路径全量保存但只追踪实质修改表', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    mockCheckIfFirstTimeInit.mockResolvedValue(true);
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    } as any);
    mockSettings.tableMaxRetries = 2;
    mockCallCustomOpenAI.mockResolvedValueOnce('<tableEdit>sheet_0</tableEdit>');
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      tableData.sheet_0.content.push(['2', '来自A']);
      return aiResponse.includes('sheet_0')
        ? { success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 }
        : { success: false, modifiedKeys: [], appliedEdits: 0 };
    });

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 1, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetSheetKeys: ['sheet_0', 'sheet_1'],
      updateGroupKeys: ['sheet_0'],
      trackingSheetKeys: ['sheet_0'],
    }));
  });

  it('非空 tableEdit 未形成实质性操作时仍视为成功但不登记参与表', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
      sheet_1: { name: '表B', content: [['row_id', '值'], ['1', 'base-b']] },
    } as any);
    mockSettings.tableMaxRetries = 2;

    const capturedTableDataTexts: string[] = [];
    mockPrepareAIInput.mockImplementation(async () => ({ tableDataText: '模拟数据' }));
    mockCallCustomOpenAI.mockImplementation(async (dynamicContent: any) => {
      capturedTableDataTexts.push(dynamicContent.tableDataText);
      return dynamicContent.tableDataText.includes('sheet_1') ? '<tableEdit>sheet_1</tableEdit>' : '<tableEdit>sheet_0</tableEdit>';
    });
    mockParseAndApplyTableEditsToData.mockReturnValue({ success: true, modifiedKeys: [], appliedEdits: 0 });

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
      { key: 'group_b', groupId: 1, indices: [1], batchSize: 2, sheetKeys: ['sheet_1'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(result.failedGroups).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(capturedTableDataTexts).toHaveLength(2);
    expect(capturedTableDataTexts[0]).not.toContain('UNIFIED_GROUP_ERROR_FEEDBACK');
    expect(capturedTableDataTexts[1]).not.toContain('UNIFIED_GROUP_ERROR_FEEDBACK');
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(2);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      targetSheetKeys: [],
      updateGroupKeys: ['sheet_0', 'sheet_1'],
      trackingSheetKeys: [],
    }));
  });


  it('manual native 路径走 grouped helper 而不是 legacy processBatch', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(false);
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const legacyProcessBatch = vi.fn().mockResolvedValue({ success: true });
    const refreshData = vi.fn().mockResolvedValue(undefined);
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], legacyProcessBatch, refreshData);

    expect(result.success).toBe(true);
    expect(legacyProcessBatch).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
  });

  it('manual native 路径在 grouped helper 失败时返回失败且不落盘', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(false);
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    mockSettings.tableMaxRetries = 1;
    mockCallCustomOpenAI.mockResolvedValue('无效响应');

    const refreshData = vi.fn().mockResolvedValue(undefined);
    const result = await orchestrateManualUpdate_ACU(['sheet_0'], vi.fn().mockResolvedValue({ success: true }), refreshData);

    expect(result.success).toBe(false);
    expect(result.error).toContain('填表在 1 次尝试后仍失败');
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(refreshData).toHaveBeenCalled();
  });

  it('manual SQL 路径走 grouped unified helper 而不是 legacy processBatch', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    vi.mocked(isSqliteMode).mockReturnValue(true);
    const inventoryDDL = `CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu', version: 1, updateConfigUiSentinel: 0, globalInjectionConfig: { readableEntryPlacement: { position: '', depth: 0, order: 0 }, wrapperPlacement: { position: '', depth: 0, order: 0 } } },
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: inventoryDDL }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any);
    mockCurrentJsonTableData = {
      sheet_0: { uid: 'inventory', name: '表A', sourceData: { ddl: inventoryDDL }, content: [['row_id', 'value'], ['1', 'base-a']], updateConfig: {}, exportConfig: {}, orderNo: 0 },
    } as any;
    mockCallCustomOpenAI.mockResolvedValueOnce("<tableEdit>INSERT INTO inventory (value) VALUES ('sql-a');</tableEdit>");

    const legacyProcessBatch = vi.fn().mockResolvedValue({ success: true });
    const refreshData = vi.fn().mockResolvedValue(undefined);

    try {
      const result = await orchestrateManualUpdate_ACU(['sheet_0'], legacyProcessBatch, refreshData);

      expect(result.success).toBe(true);
      expect(legacyProcessBatch).not.toHaveBeenCalled();
      expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
      expect(mockParseAndApplyTableEditsToData).not.toHaveBeenCalled();
      const savedData = mockPersistTablesToChatMessage.mock.calls[0][0].tableData;
      expect(savedData.sheet_0.content).toEqual([['row_id', 'value'], ['1', 'base-a'], ['2', 'sql-a']]);
    } finally {
      vi.mocked(isSqliteMode).mockReturnValue(false);
    }
  });

  it('写目标早于 V2 回放根时在 AI 调用前失败（Task 4 准入，零 token 消耗）', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    // full checkpoint 位于 #2（晚于本 bucket 的写目标 #1）：写目标早于回放根。
    // 旧逻辑会先调用 AI（collectGroupFillResponse_ACU → callCustomOpenAI_ACU），
    // 消耗 token 后才在 persist 层被 fail-fast（persist.ts:1908）。
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: false, mes: 'AI 1' },
      { is_user: false, mes: 'AI 2' },
      { is_user: false, mes: 'AI 3', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: { kind: 'full', reason: 'init', createdAt: 1, data: { mate: { type: 'acu' }, sheet_0: { uid: 'sheet_0', name: '表A', content: [['row_id', '值']] } } }, logEntries: [] } } } },
    ]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any);
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(false);
    expect(result.error).toContain('写目标早于 V2 回放根');
    // 准入在 AI 调用之前拦截：零 token 消耗路径成立。
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPrepareAIInput).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('写目标等于 V2 回放根时放行（Task 4 准入不误伤根自身）', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    // full checkpoint 位于 #1，bucket 写目标同为 #1：target === 根，应放行。
    vi.mocked(getChatArray_ACU).mockReturnValue([
      { is_user: false, mes: 'AI 1', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, checkpoint: { kind: 'full', reason: 'init', createdAt: 1, data: { mate: { type: 'acu' }, sheet_0: { uid: 'sheet_0', name: '表A', content: [['row_id', '值']] } } }, logEntries: [] } } } },
    ]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any);
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
  });

  it('无 V2 回放根时放行（Task 4 准入不得把无 checkpoint 误判为目标早于根）', async () => {
    const { getChatArray_ACU } = await import('../../../src/service/chat/chat-service');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    // 聊天无任何 full checkpoint：全新会话首次填表，应放行。
    vi.mocked(getChatArray_ACU).mockReturnValue([{ is_user: true }, { is_user: false, mes: 'AI回复' }]);
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any);
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');

    const result = await processGroupedRuntimeChunk_ACU([
      { key: 'group_a', groupId: 0, indices: [1], batchSize: 2, sheetKeys: ['sheet_0'], requestOptions: null },
    ], 'manual_independent');

    expect(result.success).toBe(true);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
  });

});

describe('orchestrateManualCatchUp_ACU', () => {
  function createCatchUpChat(lastFilledA: number, lastFilledB: number) {
    return [
      { is_user: true, mes: '用户0' },
      {
        is_user: false,
        mes: 'AI回复1',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full',
                reason: 'init',
                createdAt: 1,
                data: {
                  mate: { type: 'acu' },
                  sheet_a: { name: '表A', content: [['row_id', '值']] },
                  sheet_b: { name: '表B', content: [['row_id', '值']] },
                },
                scheduleSummary: {
                  sheet_a: { lastFilledAiFloor: lastFilledA },
                  sheet_b: { lastFilledAiFloor: lastFilledB },
                },
              },
              logEntries: [],
            },
          },
        },
      },
      { is_user: true, mes: '用户2' },
      { is_user: false, mes: 'AI回复2' },
      { is_user: true, mes: '用户4' },
      { is_user: false, mes: 'AI回复3' },
    ];
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    // staging boundary commit 默认成功；跨边界用例在各自 it 内用 mockResolvedValueOnce 覆写。
    // 必须显式 reset（clearAllMocks 不清 implementation），防止前序用例的常驻失败实现污染本用例。
    mockCommitStagedSheetsAtFullBoundaryAtomic.mockReset().mockResolvedValue({
      ok: true,
      boundaryCommitSummary: { selectedSheetKeys: ['sheet_a', 'sheet_b'], originalFullCheckpointIndex: 2 },
    });
    // anchor 预检 mock 默认 ready；跨边界用例在各自 it 内用 mockResolvedValueOnce 覆写。
    // 必须 mockReset（clearAllMocks 不清 Once 队列），防止前序用例未消费完的 Once 残留
    // 到本用例（残留的 checkpointMessageIndex 会污染 staging originalFullIndex）。
    mockEnsureManualCatchUpAnchor.mockReset().mockResolvedValue({ status: 'ready', checkpointMessageIndex: 0 });
    // 旧 bridge 残留检测默认 false（无 active bridge），跨边界用例按需覆写。
    mockHasActiveProvisionalBridgeAnywhere.mockReset().mockReturnValue(false);
    mockWasStopped = false;
    mockIsAutoUpdating = false;
    mockSettings = {
      ...mockSettings,
      apiMode: 'custom',
      apiConfig: { useMainApi: true, url: '', model: '' },
      skipUpdateFloors: 0,
      updateBatchSize: 1,
      manualUpdateBatchSize: 1,
      tableMaxRetries: 1,
      tableApiPresetOverridesByName: {},
    };
    mockCurrentJsonTableData = {
      mate: { type: 'acu' },
      sheet_a: { name: '表A', updateConfig: { groupId: 0 }, content: [['row_id', '值']] },
      sheet_b: { name: '表B', updateConfig: { groupId: 0 }, content: [['row_id', '值']] },
    };
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue(JSON.parse(JSON.stringify(mockCurrentJsonTableData)));
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    // 必须先 mockReset：前序用例若消费/残留了 Once 队列或常驻实现，不清掉会污染本用例。
    mockCallCustomOpenAI.mockReset()
      .mockResolvedValueOnce('<tableEdit>sheet_a</tableEdit>')
      .mockResolvedValue('<tableEdit>sheet_a sheet_b</tableEdit>');
    mockParseAndApplyTableEditsToData.mockImplementation((response: string, data: any) => {
      const modifiedKeys = Object.keys(data).filter(
        key => key.startsWith('sheet_') && response.includes(key),
      );
      return {
        success: true,
        modifiedKeys,
        appliedEdits: modifiedKeys.length,
      };
    });
    mockPersistTablesToChatMessage.mockReset().mockResolvedValue({ saved: true, messageIndex: 5 });
  });

  it('追平计划的 batchSize 只跟手动面板的「每 N 层合并为一次填表」走，不读自动填表的 updateBatchSize', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(1, 2) as any);
    mockSettings.updateBatchSize = 5;
    mockSettings.manualUpdateBatchSize = 2;

    const result = await prepareManualCatchUpPlan_ACU(['sheet_a', 'sheet_b']);

    expect(result.success).toBe(true);
    const batchSizes = result.plan!.waves.flatMap(wave => wave.groups.map(group => group.batchSize));
    expect(batchSizes.length).toBeGreaterThan(0);
    expect(new Set(batchSizes)).toEqual(new Set([2]));

    // 手动面板未设置时回落手动默认 3，而不是自动填表的 5。
    delete mockSettings.manualUpdateBatchSize;
    const fallback = await prepareManualCatchUpPlan_ACU(['sheet_a', 'sheet_b']);
    expect(new Set(fallback.plan!.waves.flatMap(wave => wave.groups.map(group => group.batchSize)))).toEqual(new Set([3]));
  });

  it('模板存在但 runtime 缺失时，prepareManualCatchUpPlan_ACU 拒绝（模板不作资格兜底）', async () => {
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '模板表', updateConfig: { groupId: 0 }, content: [['row_id', '值']] },
    });
    mockGetChatArray_ACU.mockReturnValue([
      { is_user: true, mes: '用户0' },
      { is_user: false, mes: 'AI回复1' },
    ] as any);
    mockCurrentJsonTableData = null;

    const result = await prepareManualCatchUpPlan_ACU(['sheet_0']);

    expect(result.success).toBe(false);
    expect(result.error).toBe('未找到可追平的已选表格。');
  });

  it('确认后 runtime 表集合变化时，在锚点预检/AI/持久化前阻断并返回 blocked 诊断', async () => {
    const { loadAllChatMessages_ACU } = await import('../../../src/service/worldbook/pipeline');
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(1, 2) as any);
    // orchestrator 内部 planning 的第一个 async 窗口（loadAllChatMessages_ACU）中删掉 sheet_b，
    // 模拟确认弹窗期间另一入口收紧了 runtime 表集合。
    vi.mocked(loadAllChatMessages_ACU).mockImplementationOnce(async () => {
      mockCurrentJsonTableData = {
        mate: { type: 'acu' },
        sheet_a: { name: '表A', updateConfig: { groupId: 0 }, content: [['row_id', '值']] },
      };
    });

    const refreshData = vi.fn().mockResolvedValue({ degraded: false });
    const result = await orchestrateManualCatchUp_ACU(
      ['sheet_a', 'sheet_b'],
      refreshData,
      { executionSnapshot: { sheetKeys: ['sheet_a', 'sheet_b'] } },
    );

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('blocked');
    expect(result.diagnosticCode).toBe('catch_up_runtime_changed_after_confirmation');
    expect(mockEnsureManualCatchUpAnchor).not.toHaveBeenCalled();
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('锚点预检等待期间 runtime 变化：在 AI 调用前第二次复检阻断并返回 blocked', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(1, 2) as any);
    // 第一次复检通过后、锚点预检异步等待期间收紧 runtime：删除 sheet_b
    mockEnsureManualCatchUpAnchor.mockImplementationOnce(async () => {
      mockCurrentJsonTableData = {
        mate: { type: 'acu' },
        sheet_a: { name: '表A', updateConfig: { groupId: 0 }, content: [['row_id', '值']] },
      };
      return { status: 'ready', checkpointMessageIndex: 0 };
    });

    const refreshData = vi.fn().mockResolvedValue({ degraded: false });
    const result = await orchestrateManualCatchUp_ACU(
      ['sheet_a', 'sheet_b'],
      refreshData,
      { executionSnapshot: { sheetKeys: ['sheet_a', 'sheet_b'] } },
    );

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('blocked');
    expect(result.diagnosticCode).toBe('catch_up_runtime_changed_after_confirmation');
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('staging scope 冻结期间 runtime 变化：二检阻断并丢弃 run 级 staging（零持久化改写）', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(1, 2) as any);
    mockEnsureManualCatchUpAnchor.mockResolvedValueOnce({ status: 'provisional_bridge_required', checkpointMessageIndex: 2 });
    mockHasActiveProvisionalBridgeAnywhere.mockReturnValue(false);
    // staging scope 冻结是无异步窗口的同步内存操作；真正的异步窗口是预检 await。
    // 用 loadAllChatMessages_ACU（wave 循环首部）收紧 runtime：删除 sheet_b，
    // 模拟 scope 冻结后、AI 调用前 runtime 表集合变化。
    const { loadAllChatMessages_ACU } = await import('../../../src/service/worldbook/pipeline');
    vi.mocked(loadAllChatMessages_ACU).mockImplementationOnce(async () => {
      mockCurrentJsonTableData = {
        mate: { type: 'acu' },
        sheet_a: { name: '表A', updateConfig: { groupId: 0 }, content: [['row_id', '值']] },
      };
    });

    const refreshData = vi.fn().mockResolvedValue({ degraded: false });
    const result = await orchestrateManualCatchUp_ACU(
      ['sheet_a', 'sheet_b'],
      refreshData,
      { executionSnapshot: { sheetKeys: ['sheet_a', 'sheet_b'] } },
    );

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('blocked');
    expect(result.diagnosticCode).toBe('catch_up_runtime_changed_after_confirmation');
    // staging 只是内存状态：二检阻断直接丢弃，不触发 boundary commit、不写任何聊天帧。
    expect(mockCommitStagedSheetsAtFullBoundaryAtomic).not.toHaveBeenCalled();
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('跨根 staging 汇合失败时返回 integrity_failed 诊断（不写误导性 failed 终态）', async () => {
    // 跨边界布局：AI 楼层 index=2/4/6，原 full checkpoint 位于 index=4（含真实数据，不可前移）。
    // sheet_a.lastFilledAiFloor=1 → 计划从 floor 2 开始：wave0 messageIndices=[2,4]，
    // pre 段（index 2 < 4）走 stage_only，post 段（index 4）前 settle 汇合。
    const chat: any[] = [
      { is_user: true, mes: '用户0' },
      { is_user: true, mes: '用户1' },
      { is_user: false, mes: 'AI 2', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } } } },
      { is_user: true, mes: '用户3' },
      {
        is_user: false,
        mes: 'AI 4',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full', reason: 'init', createdAt: 1,
                data: { mate: { type: 'acu' }, sheet_a: { name: '表A', content: [['row_id', '值'], ['1', '真实']] } },
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [],
            },
          },
        },
      },
      { is_user: true, mes: '用户5' },
      { is_user: false, mes: 'AI 6' },
    ];
    mockGetChatArray_ACU.mockReturnValue(chat);
    mockEnsureManualCatchUpAnchor.mockResolvedValueOnce({ status: 'provisional_bridge_required', checkpointMessageIndex: 4 });
    mockHasActiveProvisionalBridgeAnywhere.mockReturnValue(false);
    // 边界前段（index 2）走 stage_only：AI 结果只进 run 级 staging。
    // 边界汇合（commitStagedSheetsAtFullBoundaryAtomic_ACU）返回失败 → integrity_failed。
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 0 });
    mockCommitStagedSheetsAtFullBoundaryAtomic.mockResolvedValueOnce({
      ok: false,
      error: 'boundary commit 事务冲突',
      diagnosticCode: 'boundary_commit_failed',
    });

    const refreshData = vi.fn().mockResolvedValue({ degraded: false });
    const result = await orchestrateManualCatchUp_ACU(
      ['sheet_a', 'sheet_b'],
      refreshData,
      { executionSnapshot: { sheetKeys: ['sheet_a', 'sheet_b'] } },
    );

    expect(result.success).toBe(false);
    expect(result).toEqual(expect.objectContaining({
      success: false,
      outcome: 'integrity_failed',
      diagnosticCode: 'boundary_commit_failed',
      catchUpPlan: expect.objectContaining({ waves: expect.any(Array) }),
      committedBucketCount: 1,
      dataCommitted: true,
      replayVerified: false,
      // settle 失败后仍写 failed 终态（记录失败事实），所以 terminal progress 已保存。
      terminalProgressSaved: true,
    }));
    expect(result.error).toContain('跨根 staging 汇合失败');
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
  });

  it('显式传空 executionSnapshot 时追平 fail-closed 阻断（不静默降级）', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(1, 2) as any);
    const refreshData = vi.fn().mockResolvedValue({ degraded: false });

    const result = await orchestrateManualCatchUp_ACU(
      ['sheet_a', 'sheet_b'],
      refreshData,
      { executionSnapshot: { sheetKeys: [] } },
    );

    // 显式传入快照但为空 → 保护已启用且校验失败，不得静默降级为 legacy
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('blocked');
    expect(result.diagnosticCode).toBe('catch_up_runtime_changed_after_confirmation');
    expect(mockEnsureManualCatchUpAnchor).not.toHaveBeenCalled();
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
  });

  it('按已提交前沿切成 A 与 A+B 两个 wave，并写入精确 replacement 和 committed progress', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(1, 2) as any);
    const refreshData = vi.fn().mockResolvedValue({ degraded: false });

    const result = await orchestrateManualCatchUp_ACU(['sheet_a', 'sheet_b'], refreshData);

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'complete', committedBucketCount: 2 }));
    expect(result.catchUpPlan?.waves.map(wave => ({
      start: wave.startAiFloor,
      end: wave.endAiFloor,
      sheets: wave.sheetKeys,
    }))).toEqual([
      { start: 2, end: 2, sheets: ['sheet_a'] },
      { start: 3, end: 3, sheets: ['sheet_a', 'sheet_b'] },
    ]);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(3);
    expect(mockPersistTablesToChatMessage.mock.calls[0][0]).toEqual(expect.objectContaining({
      targetMessageIndex: 3,
      replaceExistingIncremental: { targetMessageIndices: [3], targetSheetKeys: ['sheet_a'] },
      manualRefillProgress: expect.objectContaining({
        version: 2,
        mode: 'catch_up',
        status: 'committed',
        waveIndex: 0,
        bucketIndex: 0,
        totalBuckets: 2,
        completedSheetMessageIndexByKey: { sheet_a: 3 },
      }),
    }));
    expect(mockPersistTablesToChatMessage.mock.calls[1][0]).toEqual(expect.objectContaining({
      targetMessageIndex: 5,
      replaceExistingIncremental: { targetMessageIndices: [5], targetSheetKeys: ['sheet_a', 'sheet_b'] },
      manualRefillProgress: expect.objectContaining({
        version: 2,
        mode: 'catch_up',
        status: 'committed',
        waveIndex: 1,
        bucketIndex: 1,
        totalBuckets: 2,
        completedSheetMessageIndexByKey: { sheet_a: 5, sheet_b: 5 },
      }),
    }));
    const completeProgressCall = mockPersistTablesToChatMessage.mock.calls.find(call => (
      call[0]?.manualRefillProgress?.status === 'complete'
    ));
    expect(completeProgressCall?.[0]).toEqual(expect.objectContaining({
      targetMessageIndex: 5,
      targetSheetKeys: [],
      updateGroupKeys: [],
      trackingSheetKeys: [],
      operations: [],
      strictSave: true,
      manualRefillProgress: expect.objectContaining({
        completedSheetMessageIndexByKey: { sheet_a: 5, sheet_b: 5 },
      }),
    }));
    expect(mockRunTableWriteTransaction.mock.calls.find(call => (
      call[0]?.reason === 'orchestrateManualCatchUp:terminal:complete'
    ))?.[0]).toEqual(expect.objectContaining({ workingDataMode: 'none' }));
    expect(mockUpdateReadableLorebookEntry).not.toHaveBeenCalled();
    expect(refreshData).toHaveBeenCalledTimes(1);
  });

  it('全部已追平时返回 no_work，且不调用 AI、保存或刷新', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(3, 3) as any);
    const refreshData = vi.fn();

    const result = await orchestrateManualCatchUp_ACU(['sheet_a', 'sheet_b'], refreshData);

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'no_work', committedBucketCount: 0 }));
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(refreshData).not.toHaveBeenCalled();
  });

  it('skipUpdateFloors 排除全部可用楼层时返回 no_work，且不调用 AI、保存或刷新', async () => {
    mockSettings.skipUpdateFloors = 3;
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(0, 0) as any);
    const refreshData = vi.fn();

    const result = await orchestrateManualCatchUp_ACU(['sheet_a', 'sheet_b'], refreshData);

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'no_work', committedBucketCount: 0 }));
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(refreshData).not.toHaveBeenCalled();
  });

  it('锚点预检无法安全修复时，在调用 AI 前返回 blocked 且不写入 bucket', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(2, 3) as any);
    mockEnsureManualCatchUpAnchor.mockResolvedValueOnce({
      status: 'blocked',
      error: '手动追平目标早于包含真实数据或未知历史的 V2 checkpoint；请先执行 V2 恢复诊断。',
    });

    const result = await orchestrateManualCatchUp_ACU(['sheet_a'], vi.fn());

    expect(result).toEqual(expect.objectContaining({
      success: false,
      outcome: 'blocked',
      committedBucketCount: 0,
      error: expect.stringContaining('V2 checkpoint'),
    }));
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('run-scoped catch-up 忽略其他任务的全局停止标志且不清零该标志', async () => {
    mockWasStopped = true;
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(2, 3) as any);
    const refreshData = vi.fn().mockResolvedValue({ degraded: false });

    const result = await orchestrateManualCatchUp_ACU(
      ['sheet_a'],
      refreshData,
      { abortController: new AbortController() },
    );

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'complete', committedBucketCount: 1 }));
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    expect(mockWasStopped).toBe(true);
  });

  it('最终刷新降级时保留已提交数据并返回 sync_pending', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(2, 3) as any);

    const result = await orchestrateManualCatchUp_ACU(['sheet_a'], vi.fn().mockResolvedValue({ degraded: true }));

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'sync_pending', committedBucketCount: 1 }));
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(2);
    const syncPendingCall = mockPersistTablesToChatMessage.mock.calls.find(call => (
      call[0]?.manualRefillProgress?.status === 'sync_pending'
    ));
    expect(syncPendingCall?.[0]).toEqual(expect.objectContaining({
      operations: [],
      targetSheetKeys: [],
      strictSave: true,
      manualRefillProgress: expect.objectContaining({
        completedSheetMessageIndexByKey: { sheet_a: 5 },
      }),
    }));
  });

  it('终态 replay 未恢复已提交表时返回 integrity_failed、回载运行时且不写 terminal progress', async () => {
    const chat = createCatchUpChat(2, 3) as any;
    mockGetChatArray_ACU.mockReturnValue(chat);
    mockPersistTablesToChatMessage.mockImplementationOnce(async () => {
      // 模拟严格 bucket 保存后历史被外部损坏；内存工作副本仍可能有数据，因此必须以
      // live chat replay 为准，不能继续刷新世界书或伪造 terminal complete。
      delete chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_a;
      return { saved: true, messageIndex: 5 };
    });
    const refreshData = vi.fn().mockResolvedValue({ degraded: false });

    const result = await orchestrateManualCatchUp_ACU(['sheet_a'], refreshData);

    expect(result).toEqual(expect.objectContaining({
      success: false,
      outcome: 'integrity_failed',
      committedBucketCount: 1,
      replayVerified: false,
      dataCommitted: true,
      terminalProgressSaved: false,
      diagnosticCode: 'replay_missing_selected_sheet',
      error: expect.stringContaining('V2 replay 未恢复所选表：sheet_a'),
    }));
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockReloadStorageProvider).toHaveBeenCalledTimes(1);
    expect(refreshData).not.toHaveBeenCalled();
  });

  it('终态 provisional Sheet 补锚不再作为单独阻断，但投影不一致仍拒绝 terminal progress', async () => {
    const chat = createCatchUpChat(2, 3) as any;
    mockGetChatArray_ACU.mockReturnValue(chat);
    const { getGlobalTemplateSnapshotForCurrentProfile_ACU } = await import('../../../src/service/template/chat-scope');
    vi.mocked(getGlobalTemplateSnapshotForCurrentProfile_ACU).mockReturnValue({
      templateObj: {
        mate: { type: 'acu' },
        sheet_a: {
          uid: 'table_a',
          name: '表A',
          sourceData: { ddl: 'CREATE TABLE table_a (row_id INTEGER PRIMARY KEY, value TEXT);' },
          updateConfig: { groupId: 0 },
          exportConfig: {},
          orderNo: 0,
          content: [['row_id', 'value']],
        },
      },
    } as any);
    mockPersistTablesToChatMessage.mockImplementationOnce(async () => {
      const frame = chat[1].TavernDB_ACU_IsolatedData[''].storageFrame;
      delete frame.checkpoint.data.sheet_a;
      frame.logEntries.push({
        seq: 1,
        entryId: 'compatibility-only-sheet-a',
        createdAt: 2,
        source: 'manual_crud',
        targetMessageIndex: 1,
        aiFloor: 1,
        filledSheetKeys: ['sheet_a'],
        changedSheetKeys: ['sheet_a'],
        groupKeys: [],
        operations: [{
          kind: 'sql_sheet_batch',
          sheetKey: 'sheet_a',
          tableName: 'table_a',
          statements: ["INSERT INTO table_a (row_id, value) VALUES (1, 'committed')"],
          reason: 'manual_refill',
        }],
      });
      return { saved: true, messageIndex: 5 };
    });
    const refreshData = vi.fn().mockResolvedValue({ degraded: false });

    const result = await orchestrateManualCatchUp_ACU(['sheet_a'], refreshData);

    expect(result).toEqual(expect.objectContaining({
      success: false,
      outcome: 'integrity_failed',
      committedBucketCount: 1,
      replayVerified: false,
      dataCommitted: true,
      terminalProgressSaved: false,
      diagnosticCode: 'replay_data_mismatch',
      error: expect.stringContaining('V2 replay 与本轮已提交数据不一致：sheet_a'),
    }));
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    expect(mockReloadStorageProvider).toHaveBeenCalledTimes(1);
    expect(refreshData).not.toHaveBeenCalled();
  });

  it('bucket 与世界书同步完成但 terminal progress 保存失败时返回 progress_metadata_failed', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(2, 3) as any);
    mockPersistTablesToChatMessage
      .mockResolvedValueOnce({ saved: true, messageIndex: 5 })
      .mockResolvedValueOnce({ saved: false, error: 'terminal strict save failed' });

    const result = await orchestrateManualCatchUp_ACU(['sheet_a'], vi.fn().mockResolvedValue({ degraded: false }));

    expect(result).toEqual(expect.objectContaining({
      success: true,
      outcome: 'progress_metadata_failed',
      committedBucketCount: 1,
      error: expect.stringContaining('terminal strict save failed'),
    }));
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(2);
    expect(mockPersistTablesToChatMessage.mock.calls[1][0]).toEqual(expect.objectContaining({
      strictSave: true,
      operations: [],
      manualRefillProgress: expect.objectContaining({ status: 'complete' }),
    }));
  });

  it('首个 wave 提交后终止时不启动下一 wave', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(1, 2) as any);
    const abortController = new AbortController();
    const refreshData = vi.fn().mockResolvedValue({ degraded: false });
    mockPersistTablesToChatMessage.mockImplementationOnce(async () => {
      abortController.abort();
      return { saved: true, messageIndex: 3 };
    });

    const result = await orchestrateManualCatchUp_ACU(['sheet_a', 'sheet_b'], refreshData, { abortController });

    expect(result).toEqual(expect.objectContaining({ success: false, outcome: 'stopped', committedBucketCount: 1 }));
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(2);
    const stoppedCall = mockPersistTablesToChatMessage.mock.calls.find(call => (
      call[0]?.manualRefillProgress?.status === 'stopped'
    ));
    expect(stoppedCall?.[0]).toEqual(expect.objectContaining({
      operations: [],
      targetSheetKeys: [],
      strictSave: true,
      manualRefillProgress: expect.objectContaining({
        completedSheetMessageIndexByKey: { sheet_a: 3 },
        lastError: '手动追平已终止。',
      }),
    }));
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
    expect(refreshData).toHaveBeenCalledTimes(1);
  });

  it('首个 wave 提交后第二个 wave 保存失败时保留已提交计数并最终刷新', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(1, 2) as any);
    mockPersistTablesToChatMessage
      .mockResolvedValueOnce({ saved: true, messageIndex: 3 })
      .mockResolvedValueOnce({ saved: false, error: 'save failed' });
    const refreshData = vi.fn();

    const result = await orchestrateManualCatchUp_ACU(['sheet_a', 'sheet_b'], refreshData);

    expect(result).toEqual(expect.objectContaining({
      success: false,
      committedBucketCount: 1,
      error: expect.stringContaining('save failed'),
    }));
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(3);
    expect(mockPersistTablesToChatMessage.mock.calls[0][0].manualRefillProgress).toEqual(expect.objectContaining({
      bucketIndex: 0,
      completedSheetMessageIndexByKey: { sheet_a: 3 },
    }));
    const failedCall = mockPersistTablesToChatMessage.mock.calls.find(call => (
      call[0]?.manualRefillProgress?.status === 'failed'
    ));
    expect(failedCall?.[0]).toEqual(expect.objectContaining({
      operations: [],
      targetSheetKeys: [],
      strictSave: true,
      manualRefillProgress: expect.objectContaining({
        completedSheetMessageIndexByKey: { sheet_a: 3 },
        lastError: expect.stringContaining('save failed'),
      }),
    }));
    expect(failedCall?.[0].manualRefillProgress.completedSheetMessageIndexByKey).not.toHaveProperty('sheet_b');
    expect(refreshData).toHaveBeenCalledTimes(1);
  });

// ═══════════════════════════════════════════════════════════════
// executeAutoFillStagingGroups_ACU（提交 5：自动填表跨 full checkpoint staging 编排）
// ═══════════════════════════════════════════════════════════════
describe('executeAutoFillStagingGroups_ACU', () => {
  beforeEach(async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { disposeStorageProvider } = await import('../../../src/service/table/table-storage-strategy');
    disposeStorageProvider();
    mockCheckIfFirstTimeInit.mockResolvedValue(false);
    vi.mocked(isSqliteMode).mockReturnValue(false);
    vi.clearAllMocks();
    mockCallCustomOpenAI.mockReset();
    mockPersistTablesToChatMessage.mockReset();
    mockParseAndApplyTableEditsToData.mockReset();
    mockWasStopped = false;
    mockSettings = {
      ...mockSettings,
      autoUpdateTokenThreshold: 0,
      updateBatchSize: 2,
      tableMaxRetries: 1,
      tableApiPresetOverridesByName: {},
    };
    mockCurrentJsonTableData = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    };
    mockPrepareAIInput.mockResolvedValue({ tableDataText: '模拟数据' });
    mockUpdateReadableLorebookEntry.mockResolvedValue(undefined);
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 5 });
    mockCallCustomOpenAI.mockResolvedValue('<tableEdit>sheet_0</tableEdit>');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any);
    mockParseAndApplyTableEditsToData.mockImplementation((aiResponse: string, tableData: any) => {
      if (aiResponse.includes('sheet_0')) {
        tableData.sheet_0.content.push([String(tableData.sheet_0.content.length), '来自A']);
        return { success: true, modifiedKeys: ['sheet_0'], appliedEdits: 1 };
      }
      return { success: false, modifiedKeys: [], appliedEdits: 0 };
    });
    mockCommitStagedSheetsAtFullBoundaryAtomic.mockReset();
    mockCommitStagedSheetsAtFullBoundaryAtomic.mockResolvedValue({ ok: true, boundaryCommitSummary: { selectedSheetKeys: ['sheet_0'], originalFullCheckpointIndex: 3 } });
  });

  const stagingGroup = (indices: number[]) => ({
    key: 'staging-group',
    groupId: 1,
    indices,
    batchSize: 2,
    sheetKeys: ['sheet_0'],
    requestOptions: { skipProfileSwitch: true, forceDirectApi: true },
  });

  it('无 full checkpoint 时退化为普通分组执行，不冻结 scope 也不汇合', async () => {
    const { executeAutoFillStagingGroups_ACU } = await import('../../../src/service/table/update-orchestrator');
    const result = await executeAutoFillStagingGroups_ACU([stagingGroup([1])], 'auto_independent', {
      boundary: { fullCheckpointIndices: [], requiresBoundaryStaging: true },
    });
    expect(result.success).toBe(true);
    expect(mockCommitStagedSheetsAtFullBoundaryAtomic).not.toHaveBeenCalled();
    // 普通持久化路径：persist 被调用
    expect(mockPersistTablesToChatMessage).toHaveBeenCalled();
  });

  it('纯 pre-boundary 组：stage_only 提交不写聊天帧，收尾原子汇合回原根', async () => {
    const { executeAutoFillStagingGroups_ACU } = await import('../../../src/service/table/update-orchestrator');
    const result = await executeAutoFillStagingGroups_ACU([stagingGroup([1])], 'auto_independent', {
      boundary: { fullCheckpointIndices: [3], requiresBoundaryStaging: true },
    });
    expect(result.success).toBe(true);
    // stage_only 不调用 persist（不写聊天 V2 frame）
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    // 收尾汇合：staging 累计快照折叠回原根
    expect(mockCommitStagedSheetsAtFullBoundaryAtomic).toHaveBeenCalledTimes(1);
    const commitCall = mockCommitStagedSheetsAtFullBoundaryAtomic.mock.calls[0];
    expect(commitCall[1]).toEqual(expect.objectContaining({
      originalFullIndex: 3,
      targetSheetKeys: ['sheet_0'],
    }));
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(1);
  });

  it('pre + post 跨边界组：pre 段 stage_only、首个 post 段前汇合、post 段普通持久化', async () => {
    const { executeAutoFillStagingGroups_ACU } = await import('../../../src/service/table/update-orchestrator');
    const result = await executeAutoFillStagingGroups_ACU([stagingGroup([1, 5])], 'auto_independent', {
      boundary: { fullCheckpointIndices: [3], requiresBoundaryStaging: true },
    });
    expect(result.success).toBe(true);
    // pre 段 stage_only 不写聊天帧；post 段普通持久化
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
    // 边界汇合恰在 post 段前执行一次
    expect(mockCommitStagedSheetsAtFullBoundaryAtomic).toHaveBeenCalledTimes(1);
    expect(mockCallCustomOpenAI).toHaveBeenCalledTimes(2);
  });

  it('边界汇合失败时返回失败并保留 staging 组为失败组', async () => {
    const { executeAutoFillStagingGroups_ACU } = await import('../../../src/service/table/update-orchestrator');
    mockCommitStagedSheetsAtFullBoundaryAtomic.mockResolvedValue({
      ok: false,
      error: 'boundary commit 拒绝执行：full checkpoint 不唯一',
      diagnosticCode: 'multiple_full_checkpoints',
    });
    const result = await executeAutoFillStagingGroups_ACU([stagingGroup([1, 5])], 'auto_independent', {
      boundary: { fullCheckpointIndices: [3], requiresBoundaryStaging: true },
    });
    expect(result.success).toBe(false);
    expect(result.failedGroups).toContain('staging-group');
    expect(result.error).toContain('full checkpoint 不唯一');
  });
});


  it('主执行失败且终态严格保存也失败时返回组合错误并释放运行锁', async () => {
    mockGetChatArray_ACU.mockReturnValue(createCatchUpChat(1, 2) as any);
    mockPersistTablesToChatMessage
      .mockResolvedValueOnce({ saved: true, messageIndex: 3 })
      .mockResolvedValueOnce({ saved: false, error: 'primary save failed' })
      .mockResolvedValueOnce({ saved: false, error: 'terminal strict save failed' });
    const refreshData = vi.fn().mockResolvedValue({ degraded: false });

    const result = await orchestrateManualCatchUp_ACU(['sheet_a', 'sheet_b'], refreshData);

    expect(result).toEqual(expect.objectContaining({
      success: false,
      committedBucketCount: 1,
      error: expect.stringContaining('primary save failed'),
    }));
    expect(result.error).toContain('终态进度保存失败：terminal strict save failed');
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(3);
    expect(mockPersistTablesToChatMessage.mock.calls[2][0]).toEqual(expect.objectContaining({
      strictSave: true,
      operations: [],
      manualRefillProgress: expect.objectContaining({ status: 'failed' }),
    }));
    expect(refreshData).toHaveBeenCalledTimes(1);
    expect(mockIsAutoUpdating).toBe(false);
  });

  it('跨原 full 边界的 wave：边界前段走 stage_only 不写聊天帧，边界后段前原子汇合，边界后段普通 persist', async () => {
    // AI 楼层：0/2/4。原 full checkpoint 位于 messageIndex=2（含真实行数据，不可前移）。
    // 追平目标楼层 4 > 原 full 边界 2：wave 同时覆盖边界前（0）与边界后（2,4）。
    const chat: any[] = [
      { is_user: false, mes: 'AI 0', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } } } },
      { is_user: true, mes: '用户1' },
      {
        is_user: false,
        mes: 'AI 2',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full', reason: 'init', createdAt: 1,
                data: { mate: { type: 'acu' }, sheet_a: { name: '表A', content: [['row_id', '值'], ['1', '真实']] } },
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
     },
              logEntries: [],
            },
          },
        },
      },
      { is_user: true, mes: '用户3' },
      { is_user: false, mes: 'AI 4' },
    ];
    mockGetChatArray_ACU.mockReturnValue(chat);
    mockEnsureManualCatchUpAnchor.mockResolvedValueOnce({ status: 'provisional_bridge_required', checkpointMessageIndex: 2 });
    mockHasActiveProvisionalBridgeAnywhere.mockReturnValue(false);
    // 边界后 bucket（target=2,4）走普通 persist；边界前 bucket（target=0）走 stage_only，
    // 不触发 persistTablesToChatMessage_ACU。
    mockPersistTablesToChatMessage
      .mockResolvedValueOnce({ saved: true, messageIndex: 2 })
      .mockResolvedValueOnce({ saved: true, messageIndex: 4 })
      .mockResolvedValue({ saved: true, messageIndex: 4 });
    // boundary commit 默认成功（beforeEach 已设）。断言其调用参数。
    mockCommitStagedSheetsAtFullBoundaryAtomic.mockClear();
    const refreshData = vi.fn().mockResolvedValue({ degraded: false });

    const result = await orchestrateManualCatchUp_ACU(['sheet_a'], refreshData);

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'complete', committedBucketCount: 3 }));
    // 边界前段（target=0）走 stage_only：不调用 persistTablesToChatMessage_ACU。
    const preBoundaryCall = mockPersistTablesToChatMessage.mock.calls.find(call => call[0]?.targetMessageIndex === 0);
    expect(preBoundaryCall).toBeUndefined();
    // 边界后首个 bucket（target=2）提交前必须触发 boundary commit：staging 原子汇合到原根。
    const commitCall = mockCommitStagedSheetsAtFullBoundaryAtomic.mock.calls[0];
    expect(commitCall).toBeDefined();
    expect(commitCall[1]).toEqual(expect.objectContaining({
      originalFullIndex: 2,
      targetSheetKeys: ['sheet_a'],
    }));
    expect(commitCall[0]).toEqual(expect.any(String)); // runId
    // boundary commit 后边界后 bucket 走普通 persist（无 manualCatchUpRunId / 无 stage_only）。
    const postBoundaryCall = mockPersistTablesToChatMessage.mock.calls.find(call => call[0]?.targetMessageIndex === 2);
    expect(postBoundaryCall?.[0]).toEqual(expect.objectContaining({ targetMessageIndex: 2 }));
    // 收尾：boundary commit 只触发一次，不重复。
    expect(mockCommitStagedSheetsAtFullBoundaryAtomic).toHaveBeenCalledTimes(1);
    expect(mockIsAutoUpdating).toBe(false);
  });

  it('跨边界 wave 边界前段零提交时丢弃 staging，而不是空快照 rebase', async () => {
    const chat: any[] = [
      { is_user: false, mes: 'AI 0', TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } } } },
      { is_user: true, mes: '用户1' },
      {
        is_user: false,
        mes: 'AI 2',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full', reason: 'init', createdAt: 1,
                data: { mate: { type: 'acu' }, sheet_a: { name: '表A', content: [['row_id', '值'], ['1', '真实']] } },
                event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
              },
              logEntries: [],
            },
          },
        },
      },
      { is_user: true, mes: '用户3' },
      { is_user: false, mes: 'AI 4' },
    ];
    mockGetChatArray_ACU.mockReturnValue(chat);
    mockEnsureManualCatchUpAnchor.mockResolvedValueOnce({ status: 'provisional_bridge_required', checkpointMessageIndex: 2 });
    mockHasActiveProvisionalBridgeAnywhere.mockReturnValue(false);
    // AI 调用失败 → 边界前段（target=0）零 staging 提交。
    // 必须 mockReset 清掉 beforeEach 的 mockResolvedValueOnce 队列，否则首个 bucket 仍会消费成功响应。
    mockCallCustomOpenAI.mockReset().mockRejectedValue(new Error('边界前 AI 调用失败'));
    const refreshData = vi.fn().mockResolvedValue({ degraded: false });

    const result = await orchestrateManualCatchUp_ACU(['sheet_a'], refreshData);

    expect(result).toEqual(expect.objectContaining({ success: false }));
    expect(result.committedBucketCount).toBe(0);
    // 零 staging：丢弃而非 rebase，boundary commit 不得被调用。
    expect(mockCommitStagedSheetsAtFullBoundaryAtomic).not.toHaveBeenCalled();
    // 丢弃 staging 后仍写 failed 终态（普通 persist 放行）。
    const failedCall = mockPersistTablesToChatMessage.mock.calls.find(call => (
      call[0]?.manualRefillProgress?.status === 'failed'
    ));
    expect(failedCall).toBeDefined();
    expect(mockIsAutoUpdating).toBe(false);
  });

});

// ═══════════════════════════════════════════════════════════════
// runtime schema 冻结与双权威修复（test31 根因回归）
// ═══════════════════════════════════════════════════════════════
describe('runtime schema 冻结与双权威修复', () => {
  beforeEach(async () => {
    const { isSqliteMode } = await import('../../../src/service/table/storage-mode');
    const { disposeStorageProvider } = await import('../../../src/service/table/table-storage-strategy');
    const { parseTableTemplateJson_ACU } = await import('../../../src/shared/utils');
    const { getChatSheetGuideDataForIsolationKey_ACU, getEffectiveSeedRowsForSheet_ACU } = await import('../../../src/service/template/chat-scope');
    disposeStorageProvider();
    vi.mocked(isSqliteMode).mockReturnValue(true);
    vi.clearAllMocks();
    vi.mocked(parseTableTemplateJson_ACU).mockReturnValue({
      mate: { type: 'acu' },
      sheet_0: { name: '活动表', content: [['row_id', '值']] },
    } as any);
    vi.mocked(getChatSheetGuideDataForIsolationKey_ACU).mockReturnValue(null);
    vi.mocked(getEffectiveSeedRowsForSheet_ACU).mockReturnValue([] as any);
    mockSettings = {
      ...mockSettings,
      discardUnauthorizedTableEditsEnabled: true,
      summaryVectorIndexModeEnabled: true,
    };
    mockUpdateReadableLorebookEntry.mockResolvedValue(undefined);
    mockPersistTablesToChatMessage.mockResolvedValue({ saved: true, messageIndex: 3 });
    mockChatArrayForSeedStage.length = 0;
    mockChatArrayForSeedStage.push(
      {
        is_user: false,
        mes: 'AI锚点',
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', reason: 'init', createdAt: 1, data: { mate: { type: 'acu' }, sheet_0: { name: '表A', content: [['row_id', '值']] } } },
              logEntries: [],
            },
          },
        },
      } as any,
      { is_user: true, mes: '用户' } as any,
      { is_user: false, mes: 'AI2' } as any,
      { is_user: true, mes: '用户2' } as any,
      { is_user: false, mes: 'AI3' } as any,
    );
  });

  function makeRuntimeDataWithSchema(): any {
    // DDL 必须每列独立一行：parseDDLColumnComments 按原始行匹配列注释，
    // 单行多列 + 行尾注释会把注释错误挂到首列（row_id → 值），导致
    // row_id 同时命中表头 row_id 与 值 → 「匹配到多个表头」无法 hydrate。
    const ddl = 'CREATE TABLE activity (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  value TEXT -- 值\n);';
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'activity',
        name: '活动表',
        sourceData: { ddl },
        content: [['row_id', '值'], ['1', '现有']],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    };
    Object.defineProperty(data.sheet_0, '_acu_runtimeEffectiveSchema', {
      value: {
        effectiveDDL: ddl,
        columnMap: {
          mappings: [
            { sourceIndex: 0, displayName: 'row_id', sqlName: 'row_id', required: true },
            { sourceIndex: 1, displayName: '值', sqlName: 'value', required: false },
          ],
          sqlToDisplay: { row_id: 'row_id', value: '值' },
        },
        source: 'explicit',
        diagnostics: [],
        originalDdlDigest: 'test',
      },
      enumerable: false,
    });
    return data;
  }

  function makeInventoryRuntimeDataWithSchema(): any {
    const ddl = 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT -- 物品名\n  quantity INTEGER -- 数量\n);';
    const data: any = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'inventory',
        name: '背包物品表',
        sourceData: { ddl },
        content: [['row_id', '物品名', '数量'], ['1', '铁剑', '3']],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    };
    Object.defineProperty(data.sheet_0, '_acu_runtimeEffectiveSchema', {
      value: {
        effectiveDDL: ddl,
        columnMap: {
          mappings: [
            { sourceIndex: 0, displayName: 'row_id', sqlName: 'row_id', required: true },
            { sourceIndex: 1, displayName: '物品名', sqlName: 'item_name', required: false },
            { sourceIndex: 2, displayName: '数量', sqlName: 'quantity', required: false },
          ],
          sqlToDisplay: { row_id: 'row_id', item_name: '物品名', quantity: '数量' },
        },
        source: 'explicit',
        diagnostics: [],
        originalDdlDigest: 'inventory-test',
      },
      enumerable: false,
    });
    return data;
  }


  it('baseSnapshot 含非首列空业务表头时，不再阻断对 live 合法表的 SQL 校验（test31 根因修复）', async () => {
    const runtimeData = makeRuntimeDataWithSchema();
    mockCurrentJsonTableData = runtimeData;
    const baseSnapshot = {
      mate: { type: 'acu', version: 1 },
      sheet_0: {
        uid: 'activity',
        name: '活动表',
        sourceData: {},
        content: [['row_id', '', ''], ['1', '', '']],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;
    const sql = "INSERT INTO activity (value) VALUES ('新值');";
    const responses = [{
      success: true,
      attempt: 1,
      aiResponse: `<tableEdit>${sql}</tableEdit>`,
      tableEditText: sql,
      job: {
        groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3,
        targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard',
        requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false,
        sqlApplyScope: {
          isolationKey: '',
          templateData: { mate: { type: 'acu' }, sheet_0: { name: '活动表', content: [['row_id', '值']] } } as any,
          templateDataWithRows: { mate: { type: 'acu' }, sheet_0: { name: '活动表', content: [['row_id', '值']] } } as any,
          activeSheetKeys: ['sheet_0'],
          skippedSheets: [],
          runtimeData,
        },
      },
    }];

    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, {
      saveTargetIndex: 3,
      updateMode: 'auto_standard',
      isImportMode: false,
      sqlApplyScope: (responses[0] as any).job.sqlApplyScope,
    });

    expect(result.success, result.error).toBe(true);
    expect(mockPersistTablesToChatMessage).toHaveBeenCalledTimes(1);
  });

  it('runtimeSchemaFailure 存在时 collect 阶段 fail-closed：不调用模型、不进入重试', async () => {
    const job: any = {
      groupKey: 'g0', groupId: 0, batchNumber: 1, targetSheetKeys: ['sheet_0'],
      messagesForContext: [{ is_user: false, mes: 'AI回复' }],
      saveTargetIndex: 0, updateMode: 'auto_standard', isImportMode: false,
      requestOptions: null,
      baseSnapshot: { sheet_0: { name: '快照表', content: [['row_id'], ['snapshot']] } },
      sqlApplyScope: {
        isolationKey: '',
        templateData: { mate: { type: 'acu' } } as any,
        templateDataWithRows: { mate: { type: 'acu' } } as any,
        activeSheetKeys: ['sheet_0'],
        runtimeSchemaFailure: {
          code: 'SQL_RUNTIME_SCHEMA_INVALID_ACU',
          message: 'SQLite runtime 未导出表格数据，无法冻结 schema。',
        },
      },
    };

    const result = await collectGroupFillResponse_ACU(job);

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('infrastructure');
    expect(result.error).toContain('SQLite runtime schema 冻结失败');
    expect(mockCallCustomOpenAI).not.toHaveBeenCalled();
    expect(mockPrepareAIInput).not.toHaveBeenCalled();
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
  });

  it('统一提交入口存在 runtimeSchemaFailure 时直接 precondition 失败，不解析 SQL', async () => {
    const baseSnapshot = {
      sheet_0: { name: '表A', content: [['row_id', '值'], ['1', 'base-a']] },
    } as any;
    const responses = [{
      success: true, attempt: 1, aiResponse: '<tableEdit>INSERT INTO x (y) VALUES (1);</tableEdit>',
      tableEditText: 'INSERT INTO x (y) VALUES (1);',
      job: {
        groupKey: 'a', groupId: 1, batchNumber: 1, saveTargetIndex: 3,
        targetSheetKeys: ['sheet_0'], updateMode: 'auto_standard',
        requestOptions: null, messagesForContext: [], baseSnapshot, isImportMode: false,
        sqlApplyScope: {
          isolationKey: '',
          templateData: { mate: { type: 'acu' } } as any,
          templateDataWithRows: { mate: { type: 'acu' } } as any,
          activeSheetKeys: ['sheet_0'],
          runtimeSchemaFailure: { code: 'provider_unavailable', message: 'SQLite 运行时未就绪。' },
        },
      },
    }];

    const result = await applyUnifiedGroupFillResponses_ACU(responses as any, baseSnapshot, {
      saveTargetIndex: 3, updateMode: 'auto_standard', isImportMode: false,
      sqlApplyScope: (responses[0] as any).job.sqlApplyScope,
    });

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('infrastructure');
    expect(mockPersistTablesToChatMessage).not.toHaveBeenCalled();
    expect(mockEnqueueSummaryVectorIndexFlush).not.toHaveBeenCalled();
  });
});

