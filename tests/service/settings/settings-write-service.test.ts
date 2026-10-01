/**
 * tests/service/settings/settings-write-service.test.ts
 * settings-write-service 事务写原语与提示词默认值恢复测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSaveSettings, mockSettings } = vi.hoisted(() => {
  const mockSettings: any = {
    storageMode: 'native',
    charCardPrompt: [{ role: 'USER', content: 'custom-prompt', mainSlot: 'A' }],
    mergeSummaryPrompt: 'custom-merge-prompt',
    strictJsonTableFillEnabled: false,
    strictJsonCharCardPrompt: [],
    strictJsonSqlCharCardPrompt: [],
    importSplitSize: 10000,
  };
  return {
    mockSettings,
    mockSaveSettings: vi.fn(),
  };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: mockSaveSettings,
}));

vi.mock('../../../src/service/table/storage-mode', () => ({
  getCurrentStorageMode: () => mockSettings.storageMode,
  isSqliteMode: () => mockSettings.storageMode === 'sqlite',
}));

// defaults-json 保持真实常量（不 mock），用于断言默认值内容
import {
  resetAllPromptsToDefault_ACU,
  resetMergeSummaryPrompt_ACU,
  setUpdateNumberFields_ACU,
} from '../../../src/service/settings/settings-write-service';
import {
  DEFAULT_MERGE_SUMMARY_PROMPT_ACU,
  DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU,
} from '../../../src/shared/defaults-json.js';
import { buildTableFillDefaultPromptSegments_ACU } from '../../../src/service/ai/prompt-builder/table-fill-tools';

/** 填表默认提示词的期望值：默认关闭原生工具，主段应为正文格式。 */
function expectedTableFillDefault_ACU(sqlite: boolean): any[] {
  return buildTableFillDefaultPromptSegments_ACU(sqlite, false);
}

beforeEach(() => {
  mockSettings.storageMode = 'native';
  mockSettings.charCardPrompt = [{ role: 'USER', content: 'custom-prompt', mainSlot: 'A' }];
  mockSettings.mergeSummaryPrompt = 'custom-merge-prompt';
  mockSettings.strictJsonTableFillEnabled = false;
  mockSettings.importSplitSize = 10000;
  mockSaveSettings.mockReset();
  mockSaveSettings.mockReturnValue({ saved: true, storageType: 'tavern' });
});

describe('resetAllPromptsToDefault_ACU', () => {
  it('native 模式恢复默认填表提示词与合并纪要提示词并保存', () => {
    const result = resetAllPromptsToDefault_ACU();

    expect(result.ok).toBe(true);
    expect(mockSettings.charCardPrompt).toEqual(expectedTableFillDefault_ACU(false));
    expect(mockSettings.mergeSummaryPrompt).toEqual(DEFAULT_MERGE_SUMMARY_PROMPT_ACU);
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
  });

  it('sqlite 模式恢复 SQL 版默认提示词', () => {
    mockSettings.storageMode = 'sqlite';
    const result = resetAllPromptsToDefault_ACU();

    expect(result.ok).toBe(true);
    expect(mockSettings.charCardPrompt).toEqual(expectedTableFillDefault_ACU(true));
    expect(mockSettings.mergeSummaryPrompt).toEqual(DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU);
  });

  it('显式传入 mode 覆盖当前 storageMode', () => {
    const result = resetAllPromptsToDefault_ACU('sqlite');

    expect(result.ok).toBe(true);
    expect(mockSettings.charCardPrompt).toEqual(expectedTableFillDefault_ACU(true));
    expect(mockSettings.mergeSummaryPrompt).toEqual(DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU);
  });

  it('保存失败时回滚已修改字段并返回失败', () => {
    mockSaveSettings.mockReturnValue({ saved: false, storageType: 'memory', code: 'settings_loading', warning: '保存被阻止' });

    const result = resetAllPromptsToDefault_ACU();

    expect(result.ok).toBe(false);
    expect(result.code).toBe('settings_loading');
    // 回滚：保持导入前自定义值
    expect(mockSettings.charCardPrompt).toEqual([{ role: 'USER', content: 'custom-prompt', mainSlot: 'A' }]);
    expect(mockSettings.mergeSummaryPrompt).toBe('custom-merge-prompt');
  });

  it('save:false 时只改内存不调用 saveSettings', () => {
    const result = resetAllPromptsToDefault_ACU(undefined, { save: false });

    expect(result.ok).toBe(true);
    expect(mockSettings.charCardPrompt).toEqual(expectedTableFillDefault_ACU(false));
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('非法 mode 返回 invalid_input 且不修改 settings', () => {
    const before = JSON.parse(JSON.stringify(mockSettings.charCardPrompt));
    const result = resetAllPromptsToDefault_ACU('invalid' as any);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_input');
    expect(mockSettings.charCardPrompt).toEqual(before);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});

describe('resetMergeSummaryPrompt_ACU', () => {
  it('默认按当前 storageMode 恢复合并纪要提示词', () => {
    mockSettings.storageMode = 'sqlite';
    const result = resetMergeSummaryPrompt_ACU();

    expect(result.ok).toBe(true);
    expect(mockSettings.mergeSummaryPrompt).toEqual(DEFAULT_MERGE_SUMMARY_PROMPT_SQL_ACU);
    expect(mockSettings.charCardPrompt).toEqual([{ role: 'USER', content: 'custom-prompt', mainSlot: 'A' }]);
  });

  it('显式 mode=native 覆盖', () => {
    mockSettings.storageMode = 'sqlite';
    const result = resetMergeSummaryPrompt_ACU('native');

    expect(result.ok).toBe(true);
    expect(mockSettings.mergeSummaryPrompt).toEqual(DEFAULT_MERGE_SUMMARY_PROMPT_ACU);
  });

  it('保存失败回滚', () => {
    mockSaveSettings.mockReturnValue({ saved: false, storageType: 'memory', code: 'storage_error', error: '存储错误' });

    const result = resetMergeSummaryPrompt_ACU();

    expect(result.ok).toBe(false);
    expect(result.code).toBe('save_failed');
    expect(mockSettings.mergeSummaryPrompt).toBe('custom-merge-prompt');
  });
});


describe('setUpdateNumberFields_ACU', () => {
  it('importSplitSize 低于下限 100 时钳制到 100', () => {
    const result = setUpdateNumberFields_ACU({ importSplitSize: 50 });

    expect(result.ok).toBe(true);
    expect(mockSettings.importSplitSize).toBe(100);
  });

  it('非法数值回退到默认值 10000', () => {
    const before = mockSettings.importSplitSize;
    const result = setUpdateNumberFields_ACU({ importSplitSize: Number.NaN });

    expect(result.ok).toBe(true);
    expect(mockSettings.importSplitSize).toBe(10000);
  });

  it('空 patch 返回 changed:false 且不调用保存', () => {
    const result = setUpdateNumberFields_ACU({});

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});