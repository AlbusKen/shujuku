import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSettings } = vi.hoisted(() => ({ mockSettings: {} as Record<string, unknown> }));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
}));

import {
  MANUAL_UPDATE_BATCH_SIZE_DEFAULT_ACU,
  resolveManualUpdateBatchSize_ACU,
  resolveManualUpdateContextDepth_ACU,
} from '../../../src/service/table/manual-update-settings';

describe('manual-update-settings', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockSettings)) delete mockSettings[key];
  });

  it('批大小只认手动面板的值，自动填表的 updateBatchSize 不参与', () => {
    mockSettings.updateBatchSize = 7;
    expect(resolveManualUpdateBatchSize_ACU()).toBe(MANUAL_UPDATE_BATCH_SIZE_DEFAULT_ACU);
    mockSettings.manualUpdateBatchSize = 4;
    expect(resolveManualUpdateBatchSize_ACU()).toBe(4);
    mockSettings.manualUpdateBatchSize = '2';
    expect(resolveManualUpdateBatchSize_ACU()).toBe(2);
    mockSettings.manualUpdateBatchSize = 0;
    expect(resolveManualUpdateBatchSize_ACU()).toBe(MANUAL_UPDATE_BATCH_SIZE_DEFAULT_ACU);
  });

  it('处理层数未设置时沿用自动阈值作为初始默认，设置后只认手动值', () => {
    mockSettings.autoUpdateThreshold = 5;
    expect(resolveManualUpdateContextDepth_ACU()).toBe(5);
    mockSettings.manualUpdateContextDepth = 0;
    expect(resolveManualUpdateContextDepth_ACU()).toBe(0);
    mockSettings.manualUpdateContextDepth = 12;
    mockSettings.autoUpdateThreshold = 1;
    expect(resolveManualUpdateContextDepth_ACU()).toBe(12);
  });
});
