/**
 * tests/service/preview/prompt-preview-gate.test.ts
 * 提示词预览门控 — 四互斥开关 × 填表模式 × 剧情总开关 全组合
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { captureZeroLayerCarrier_ACU, physicalHistoryFingerprint_ACU, isolateZeroLayerCarrierCandidate_ACU } from '../../../src/service/zero-layer/carrier-context';
import { applyZeroLayerCommand_ACU } from '../../../src/service/zero-layer/store-command';
import { ZERO_LAYER_CARRIER_FIELD_ACU } from '../../../src/service/zero-layer/model';
import { pendingZeroLayerPersistence_ACU } from '../../../src/service/zero-layer/persistence-state';

const {
  mockSettings,
  mockFillMode,
  mockAgentRuntimeEnabled,
} = vi.hoisted(() => {
  return {
    mockSettings: {
      continuationPageEnabled: false,
      contentOptimizationSettings: { enabled: false },
      worldSimulationPageEnabled: false,
      plotSettings: { enabled: true },
    } as any,
    mockFillMode: { value: 'llm' as string },
    mockAgentRuntimeEnabled: { value: false as boolean },
  };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/service/fill-mode/fill-mode-chat-record', () => ({
  resolveCurrentChatFillMode_ACU: vi.fn(() => ({ mode: mockFillMode.value, source: 'record' })),
}));

vi.mock('../../../src/service/agent/agent-worldbook-runtime-state', () => ({
  isAgentWorldbookRuntimeEnabled_ACU: vi.fn(() => mockAgentRuntimeEnabled.value),
}));

import { evaluatePromptPreviewGate_ACU } from '../../../src/service/preview/prompt-preview-gate';

function resetState() {
  _set_SillyTavern_API_ACU(undefined);
  pendingZeroLayerPersistence_ACU.clear();
  vi.stubGlobal('window', {});
  mockSettings.continuationPageEnabled = false;
  mockSettings.contentOptimizationSettings = { enabled: false };
  mockSettings.worldSimulationPageEnabled = false;
  mockSettings.plotSettings = { enabled: true };
  mockFillMode.value = 'llm';
  mockAgentRuntimeEnabled.value = false;
}

describe('evaluatePromptPreviewGate_ACU 全组合', () => {
  beforeEach(resetState);
  afterEach(() => { _set_SillyTavern_API_ACU(undefined); vi.unstubAllGlobals(); pendingZeroLayerPersistence_ACU.clear(); });

  it('续写开关缺省按开启处理，两个预览均阻断', () => {
    delete mockSettings.continuationPageEnabled;
    const gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.blockers.map(b => b.feature)).toContain('continuation');
    expect(gate.plot.blockers.map(b => b.feature)).toContain('continuation');
  });

  it('真实零层载体阻断两种预览，读取不改写载体且不保存', async () => {
    const carrier: Record<string, any> = { is_user: false, mes: '开场', swipe_id: 0 };
    const saveChat = vi.fn();
    _set_SillyTavern_API_ACU({ chat: [carrier], getCurrentChatId: () => 'preview-zero', this_chid: '0', characters: [{ avatar: 'preview.png' }], saveChat } as any);
    const context = captureZeroLayerCarrier_ACU();
    carrier[ZERO_LAYER_CARRIER_FIELD_ACU] = applyZeroLayerCommand_ACU(null, { type: 'initialize', apiPresetName: 'direct' }, context, await physicalHistoryFingerprint_ACU(context.source));
    const before = structuredClone(carrier);
    const gate = evaluatePromptPreviewGate_ACU();
    for (const result of [gate.tableFill, gate.plot]) {
      expect(result.available).toBe(false);
      expect(result.blockers).toContainEqual({ feature: 'zero_layer', reason: '零层聊天暂不支持预览' });
    }
    expect(carrier).toEqual(before);
    expect(saveChat).not.toHaveBeenCalled();
    carrier[ZERO_LAYER_CARRIER_FIELD_ACU].enabled = true;
    expect(evaluatePromptPreviewGate_ACU().plot.blockers).toContainEqual({
      feature: 'zero_layer', reason: '零层聊天暂不支持预览',
    });
    // 保存候选不具权威性：确认前必须继续阻断，不能凭候选字段放行。
    const release = isolateZeroLayerCarrierCandidate_ACU(context, carrier[ZERO_LAYER_CARRIER_FIELD_ACU]);
    delete carrier[ZERO_LAYER_CARRIER_FIELD_ACU];
    pendingZeroLayerPersistence_ACU.set(context.key, {
      before: before[ZERO_LAYER_CARRIER_FIELD_ACU],
      candidate: before[ZERO_LAYER_CARRIER_FIELD_ACU],
      source: context.source,
    });
    try {
      expect(evaluatePromptPreviewGate_ACU().tableFill.blockers[0].reason).toContain('保存结果未知');
    } finally { release(); }
  });

  it('真实损坏零层存档 fail-closed，保留读取错误而不伪装非零层', () => {
    const carrier = { is_user: false, mes: '开场', [ZERO_LAYER_CARRIER_FIELD_ACU]: { schemaVersion: 999 } };
    _set_SillyTavern_API_ACU({ chat: [carrier], getCurrentChatId: () => 'preview-zero', this_chid: '0', characters: [{ avatar: 'preview.png' }] } as any);
    const gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(false);
    expect(gate.plot.available).toBe(false);
    expect(gate.tableFill.blockers[0].reason).toContain('零层状态读取失败');
    expect(gate.tableFill.blockers[0].reason).not.toBe('零层聊天暂不支持预览');
  });

  it('全开关关闭 + llm 模式：两个场景都可用', () => {
    const gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(true);
    expect(gate.tableFill.blockers).toEqual([]);
    expect(gate.plot.available).toBe(true);
    expect(gate.plot.blockers).toEqual([]);
  });

  it('classic 模式：填表可用，剧情被 fill_mode 阻断', () => {
    mockFillMode.value = 'classic';
    const gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(true);
    expect(gate.plot.available).toBe(false);
    expect(gate.plot.blockers.map((b) => b.feature)).toContain('fill_mode');
  });

  it('crossfire 模式：两个场景都被 fill_mode 阻断', () => {
    mockFillMode.value = 'crossfire';
    const gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(false);
    expect(gate.tableFill.blockers.map((b) => b.feature)).toContain('fill_mode');
    expect(gate.plot.available).toBe(false);
    expect(gate.plot.blockers.map((b) => b.feature)).toContain('fill_mode');
  });

  it.each([
    ['continuation', () => { mockSettings.continuationPageEnabled = true; }, 'continuation'],
    ['content_optimization', () => { mockSettings.contentOptimizationSettings = { enabled: true }; }, 'content_optimization'],
    ['world_simulation', () => { mockSettings.worldSimulationPageEnabled = true; }, 'world_simulation'],
  ] as const)('互斥开关 %s 开启时两个场景都阻断', (_name, apply, feature) => {
    apply();
    const gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(false);
    expect(gate.tableFill.blockers.map((b) => b.feature)).toContain(feature);
    expect(gate.plot.available).toBe(false);
    expect(gate.plot.blockers.map((b) => b.feature)).toContain(feature);
  });

  it('agent 世界书运行时接管：两个场景都阻断', () => {
    mockAgentRuntimeEnabled.value = true;
    const gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(false);
    expect(gate.tableFill.blockers.map((b) => b.feature)).toContain('agent_worldbook');
    expect(gate.plot.blockers.map((b) => b.feature)).toContain('agent_worldbook');
  });

  it('agent 静态配置对象形态：enabled+mode=agent 阻断；默认关闭对象不阻断（形态修正回归）', () => {
    mockSettings.plotSettings = {
      enabled: true,
      agentWorldbookControl: { enabled: true, mode: 'agent' },
    };
    let gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(false);
    expect(gate.tableFill.blockers.map((b) => b.feature)).toContain('agent_worldbook');

    // defaults-json.js 实际默认形态：对象 {enabled:false,mode:'disabled'}，不得误判为接管。
    mockSettings.plotSettings = {
      enabled: true,
      agentWorldbookControl: { enabled: false, mode: 'disabled' },
    };
    gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(true);
  });

  it('agent 静态配置字符串形态：非 disabled 阻断，disabled 不阻断', () => {
    mockSettings.plotSettings = { enabled: true, agentWorldbookControl: 'agent' as any };
    let gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(false);

    mockSettings.plotSettings = { enabled: true, agentWorldbookControl: 'disabled' as any };
    gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(true);
  });

  it('剧情总开关未开：剧情场景被 plot_tasks_disabled 阻断，填表不受影响', () => {
    mockSettings.plotSettings = { enabled: false };
    const gate = evaluatePromptPreviewGate_ACU();
    expect(gate.tableFill.available).toBe(true);
    expect(gate.plot.available).toBe(false);
    expect(gate.plot.blockers.map((b) => b.feature)).toContain('plot_tasks_disabled');
  });

  it('多开关叠加：blockers 收齐全部原因且 reason 为中文', () => {
    mockSettings.continuationPageEnabled = true;
    mockSettings.worldSimulationPageEnabled = true;
    mockFillMode.value = 'classic';
    const gate = evaluatePromptPreviewGate_ACU();
    expect(gate.plot.available).toBe(false);
    const features = gate.plot.blockers.map((b) => b.feature).sort();
    expect(features).toEqual(['continuation', 'fill_mode', 'world_simulation']);
    for (const blocker of gate.plot.blockers) {
      expect(blocker.reason.length).toBeGreaterThan(0);
    }
  });
});
