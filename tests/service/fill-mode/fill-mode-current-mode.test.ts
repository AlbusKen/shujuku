import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tableData: null as any,
  isolationKey: '',
  settings: { plotSettings: { enabled: true } } as any,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.tableData; },
  get settings_ACU() { return h.settings; },
  getCurrentIsolationKey_ACU: () => h.isolationKey,
}));

import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { setChatScopedConfigContainer_ACU, normalizeChatScopedConfigContainer_ACU, peekChatScopedConfigContainer_ACU } from '../../../src/data/storage/chat-history';
import { globalMeta_ACU } from '../../../src/data/repositories/profile-repo';
import { FILL_MODE_PREFERENCES_KEY_ACU, type FillMode_ACU } from '../../../src/service/fill-mode/fill-mode-preferences';
import { stageChatFillModeRecord_ACU, resolveCurrentChatFillMode_ACU, resolveUnrecordedChatFillMode_ACU } from '../../../src/service/fill-mode/fill-mode-chat-record';
import { getFillModeBehavior_ACU, resolveFillPlan_ACU } from '../../../src/service/fill-mode/fill-mode-resolver';
import {
  evaluatePlotPermissionForCurrentChat_ACU,
  getVectorPipelinePlanForCurrentChat_ACU,
  isPlotAllowedForCurrentChat_ACU,
  isVectorPipelineEnabledForCurrentChat_ACU,
} from '../../../src/service/fill-mode/fill-mode-gate';

let chat: any[] = [];
const savedPreferences = globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU];

function seedContainer(mutate: (container: Record<string, any>) => void): void {
  const container = normalizeChatScopedConfigContainer_ACU(peekChatScopedConfigContainer_ACU(chat));
  mutate(container);
  setChatScopedConfigContainer_ACU(chat, container);
}

function seedRecord(mode: FillMode_ACU): void {
  seedContainer(container => stageChatFillModeRecord_ACU(container, h.isolationKey, mode));
}

function seedFlightEnabled(): void {
  seedContainer(container => {
    container.flightModeByIsolationKey = { [h.isolationKey]: { enabled: true, hiddenRowIds: [] } };
  });
}

function seedPreferredMode(mode: FillMode_ACU): void {
  globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU] = { schemaVersion: 1, selectedMode: mode };
}

function legacyChronicleTable(): any {
  return { sheet_chronicle: { name: '纪要表', content: [['row_id', '纪要'], ['1', 'a']] } };
}

function appendLegacyVectorMessage(): void {
  chat.push({
    is_user: false,
    mes: 'reply',
    TavernDB_ACU_IsolatedData: {
      [h.isolationKey]: {
        summaryVectorIndexState: {
          sourceTableKey: 'sheet_chronicle',
          rows: [{ rowId: '1', rowKey: 'row-1', status: 'ready' }],
          chunks: [{ chunkId: 'chunk-1', rowKey: 'row-1', vector: [0.25, 0.5] }],
        },
      },
    },
  });
}

beforeEach(() => {
  chat = [{ is_user: false, mes: 'greeting' }];
  h.tableData = {};
  h.isolationKey = '';
  h.settings = { plotSettings: { enabled: true } };
  _set_SillyTavern_API_ACU({ chat, chatMetadata: {}, getCurrentChatId: () => 'chat-1' } as any);
  delete globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU];
});

afterEach(() => {
  _set_SillyTavern_API_ACU(undefined);
  if (savedPreferences === undefined) delete globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU];
  else globalMeta_ACU[FILL_MODE_PREFERENCES_KEY_ACU] = savedPreferences;
});

describe('填表模式行为映射', () => {
  it('四种模式对应剧情推进与向量管线', () => {
    expect(getFillModeBehavior_ACU('classic')).toEqual({ plotAllowed: false, vectorPipeline: null });
    expect(getFillModeBehavior_ACU('vector')).toEqual({ plotAllowed: false, vectorPipeline: 'vector' });
    expect(getFillModeBehavior_ACU('llm')).toEqual({ plotAllowed: true, vectorPipeline: null });
    expect(getFillModeBehavior_ACU('crossfire')).toEqual({ plotAllowed: true, vectorPipeline: 'crossfire' });
  });

  it('运行计划只由模式决定', () => {
    const preferences = { schemaVersion: 1 as const, selectedMode: 'classic' as const, classic: { recentChronicleRows: 15 }, vector: { resultCount: 30, minScore: 0.35, candidateLimit: 20 } };
    expect(resolveFillPlan_ACU(preferences, 'vector')).toMatchObject({
      mode: 'vector',
      unmaskChronicleEntriesForContinuation: true,
      vectorPipeline: { kind: 'vector', rerankRequired: true, overrides: { topK: 30, minScore: 0.35, candidateLimit: 30 } },
    });
    expect(resolveFillPlan_ACU(preferences, 'crossfire')).toMatchObject({ vectorPipeline: { kind: 'crossfire', overrides: null }, unmaskChronicleEntriesForContinuation: false });
    expect(resolveFillPlan_ACU(preferences, 'classic').vectorPipeline).toBeNull();
    expect(resolveFillPlan_ACU(preferences, 'llm').vectorPipeline).toBeNull();
  });

  it('无记录推导：飞行开关 > 旧表格数据 > 偏好', () => {
    expect(resolveUnrecordedChatFillMode_ACU({ flightModeActive: true, hasLegacyData: true, hasSummaryVectorData: true, preferredMode: 'vector' }))
      .toEqual({ mode: 'classic', source: 'legacy', basis: 'flight' });
    expect(resolveUnrecordedChatFillMode_ACU({ flightModeActive: false, hasLegacyData: true, hasSummaryVectorData: true, preferredMode: 'classic' }))
      .toEqual({ mode: 'crossfire', source: 'legacy', basis: 'legacy_table' });
    expect(resolveUnrecordedChatFillMode_ACU({ flightModeActive: false, hasLegacyData: true, hasSummaryVectorData: false, preferredMode: 'classic' }))
      .toEqual({ mode: 'llm', source: 'legacy', basis: 'legacy_table' });
    expect(resolveUnrecordedChatFillMode_ACU({ flightModeActive: false, hasLegacyData: false, hasSummaryVectorData: true, preferredMode: 'vector' }))
      .toEqual({ mode: 'vector', source: 'preferred', basis: 'preferred' });
  });
});

describe('当前对话模式（真实 scoped container 播种）', () => {
  it.each(['classic', 'vector', 'llm', 'crossfire'] as const)('记录 %s 为唯一权威', (mode) => {
    seedPreferredMode(mode === 'classic' ? 'llm' : 'classic');
    seedRecord(mode);
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode, source: 'chat', recordStatus: 'recorded' });
    const behavior = getFillModeBehavior_ACU(mode);
    expect(isPlotAllowedForCurrentChat_ACU()).toBe(behavior.plotAllowed);
    expect(isVectorPipelineEnabledForCurrentChat_ACU()).toBe(behavior.vectorPipeline !== null);
    expect(getVectorPipelinePlanForCurrentChat_ACU()?.kind ?? null).toBe(behavior.vectorPipeline);
  });

  it('记录 classic 且飞行开关未启用：仍是 classic，不推进剧情', () => {
    seedRecord('classic');
    expect(resolveCurrentChatFillMode_ACU().mode).toBe('classic');
    expect(evaluatePlotPermissionForCurrentChat_ACU()).toMatchObject({ allowed: false, reason: 'fill_mode_no_plot' });
  });

  it('记录 llm 且飞行开关残留开启：以记录为准', () => {
    seedFlightEnabled();
    seedRecord('llm');
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'llm', source: 'chat' });
    expect(isPlotAllowedForCurrentChat_ACU()).toBe(true);
  });

  it('llm 下剧情子开关关闭：plot_disabled', () => {
    seedRecord('llm');
    h.settings = { plotSettings: { enabled: false } };
    expect(evaluatePlotPermissionForCurrentChat_ACU()).toMatchObject({ allowed: false, reason: 'plot_disabled' });
  });

  it('非法记录按无记录规则推导', () => {
    seedPreferredMode('crossfire');
    seedContainer(container => { container.fillModeByIsolationKey = { [h.isolationKey]: { mode: 'bogus' } }; });
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'crossfire', source: 'preferred', recordStatus: 'invalid' });
  });

  it('无记录且飞行开关已开：classic', () => {
    seedPreferredMode('llm');
    seedFlightEnabled();
    h.tableData = legacyChronicleTable();
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'classic', source: 'legacy', recordStatus: 'absent' });
    expect(isPlotAllowedForCurrentChat_ACU()).toBe(false);
  });

  it('无记录、有旧表格且无向量：llm', () => {
    seedPreferredMode('classic');
    h.tableData = legacyChronicleTable();
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'llm', source: 'legacy', recordStatus: 'absent' });
  });

  it('无记录、有旧表格且有有效向量：crossfire', () => {
    seedPreferredMode('classic');
    h.tableData = legacyChronicleTable();
    appendLegacyVectorMessage();
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'crossfire', source: 'legacy', recordStatus: 'absent' });
    expect(getVectorPipelinePlanForCurrentChat_ACU()).toMatchObject({ kind: 'crossfire', overrides: null });
  });

  it.each(['classic', 'vector', 'llm', 'crossfire'] as const)('无记录新对话按偏好 %s', (mode) => {
    seedPreferredMode(mode);
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode, source: 'preferred', recordStatus: 'absent' });
    expect(isPlotAllowedForCurrentChat_ACU()).toBe(getFillModeBehavior_ACU(mode).plotAllowed);
  });

  it('偏好未保存时新对话默认 classic，剧情不推进', () => {
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'classic', source: 'preferred' });
    expect(isPlotAllowedForCurrentChat_ACU()).toBe(false);
  });

  it('记录按隔离标签区分', () => {
    seedPreferredMode('classic');
    h.isolationKey = 'tagA';
    seedRecord('llm');
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'llm', source: 'chat' });
    h.isolationKey = 'tagB';
    expect(resolveCurrentChatFillMode_ACU()).toMatchObject({ mode: 'classic', source: 'preferred', recordStatus: 'absent' });
  });
});
