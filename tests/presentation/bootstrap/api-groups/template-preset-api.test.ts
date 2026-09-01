import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyPreset: vi.fn(),
  applyChatSnapshot: vi.fn(),
  refreshUi: vi.fn(),
}));

vi.mock('../../../../src/service/template/template-preset-service', () => ({
  applyTemplatePresetToCurrent_ACU: mocks.applyPreset,
  applyChatTemplateSnapshotWithReconciliation_ACU: mocks.applyChatSnapshot,
  listTemplatePresetNames_ACU: vi.fn(() => []),
  normalizeTemplateOperationScope_ACU: vi.fn((scope: unknown) => scope === 'chat' ? 'chat' : 'global'),
  parseImportedTemplateData_ACU: vi.fn((templateData: unknown, options: any = {}) => ({
    templateObj: { sheet_a: {} },
    templateStr: '{"sheet_a":{}}',
    dataMode: options?.dataMode === 'replace' ? 'replace' : options?.dataMode === 'merge' ? 'merge' : 'seed',
    conflictPolicy: options?.conflictPolicy === 'reject' ? 'reject' : options?.conflictPolicy === 'template-wins' ? 'template-wins' : 'keep-current',
  })),
  resolveTemplateForExport_ACU: vi.fn(() => null),
  upsertTemplatePreset_ACU: vi.fn(() => true),
}));
vi.mock('../../../../src/shared/template-preset-utils', () => ({
  deriveTemplatePresetNameForImport_ACU: vi.fn(({ presetName }: any) => String(presetName || '').trim()),
  normalizeTemplatePresetSelectionValue_ACU: vi.fn((value: unknown) => String(value || '').trim()),
}));
vi.mock('../../../../src/shared/utils', () => ({ logDebug_ACU: vi.fn(), logError_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/components/template-preset-ui', () => ({ refreshTemplatePresetSelectInUI_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/components/pipeline-ui-helpers', () => ({
  refreshPresetUIAfterSwitch_ACU: mocks.refreshUi,
}));

import { createTemplatePresetApi } from '../../../../src/presentation/bootstrap/api-groups/template-preset-api';

function createApi() {
  let api: Record<string, Function>;
  api = createTemplatePresetApi({ getApi: () => api } as any);
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.applyPreset.mockResolvedValue({ saved: true, runtimeReady: true });
  mocks.applyChatSnapshot.mockResolvedValue({ saved: true, runtimeReady: true });
});

describe('template-preset-api 结果契约', () => {
  it('switchTemplatePreset 透传聊天切换失败的具体 error', async () => {
    mocks.applyPreset.mockResolvedValueOnce({ saved: false, error: '目标聊天已切换，已取消模板提交。' });

    const result = await createApi().switchTemplatePreset('preset-a', { scope: 'chat' });

    expect(result).toEqual({
      success: false,
      scope: 'chat',
      message: '目标聊天已切换，已取消模板提交。',
      error: '目标聊天已切换，已取消模板提交。',
    });
    expect(mocks.refreshUi).not.toHaveBeenCalled();
  });

  it('switchTemplatePreset 捕获异常时统一返回 scope/message/error', async () => {
    mocks.applyPreset.mockRejectedValueOnce(new Error('switch boom'));

    const result = await createApi().switchTemplatePreset('preset-a', { scope: 'chat' });

    expect(result).toEqual({
      success: false,
      scope: 'chat',
      message: '模板预设切换失败：switch boom',
      error: 'switch boom',
    });
    expect(mocks.refreshUi).not.toHaveBeenCalled();
  });

  it('switchTemplatePreset 已保存但 runtime 不可用时透传 warning 三态', async () => {
    mocks.applyPreset.mockResolvedValueOnce({
      saved: true,
      runtimeReady: false,
      postCommitWarning: '模板已保存，但 SQLite 运行时重建失败。',
    });

    const result = await createApi().switchTemplatePreset('preset-a', { scope: 'chat' });

    expect(result).toEqual({
      success: true,
      scope: 'chat',
      message: '当前聊天模板预设已切换：preset-a',
      runtimeReady: false,
      warning: '模板已保存，但 SQLite 运行时重建失败。',
      postCommitWarning: '模板已保存，但 SQLite 运行时重建失败。',
    });
    expect(mocks.refreshUi).toHaveBeenCalledOnce();
  });

  it('switchTemplatePreset 全局切换协调失败时透传 blockers（S1-3，供调用方确认重试）', async () => {
    mocks.applyPreset.mockResolvedValueOnce({
      saved: false,
      error: '删除表「旧表」需要显式确认',
      blockers: ['删除表「旧表」需要显式确认'],
    });

    const result = await createApi().switchTemplatePreset('preset-a', { scope: 'global' });

    expect(result).toEqual({
      success: false,
      scope: 'global',
      message: '删除表「旧表」需要显式确认',
      error: '删除表「旧表」需要显式确认',
      blockers: ['删除表「旧表」需要显式确认'],
    });
    expect(mocks.refreshUi).not.toHaveBeenCalled();
  });

  it('switchTemplatePreset 转发 destructiveChangeConfirmed 到服务层（S1-3）', async () => {
    await createApi().switchTemplatePreset('preset-a', { scope: 'global', destructiveChangeConfirmed: true });

    expect(mocks.applyPreset).toHaveBeenCalledWith('preset-a', expect.objectContaining({
      updateGlobal: true,
      destructiveChangeConfirmed: true,
    }));
  });

  it('switchTemplatePreset 完全成功时返回 runtimeReady=true 且无 warning', async () => {
    const result = await createApi().switchTemplatePreset('preset-a', { scope: 'chat' });

    expect(result).toEqual({
      success: true,
      scope: 'chat',
      message: '当前聊天模板预设已切换：preset-a',
      runtimeReady: true,
    });
    expect(mocks.refreshUi).toHaveBeenCalledOnce();
  });

  it('importTemplateFromData 失败时统一返回 scope/message/error', async () => {
    mocks.applyChatSnapshot.mockResolvedValueOnce({ saved: false, error: '当前没有可绑定的目标聊天，已取消模板提交。' });

    const result = await createApi().importTemplateFromData({}, { scope: 'chat', presetName: 'preset-a' });

    expect(result).toEqual({
      success: false,
      scope: 'chat',
      message: '模板导入失败：当前没有可绑定的目标聊天，已取消模板提交。',
      error: '当前没有可绑定的目标聊天，已取消模板提交。',
    });
    expect(mocks.refreshUi).not.toHaveBeenCalled();
  });

  it('importTemplateFromData 透传 DDL/表头预检阶段与列详情', async () => {
    const error = '完整 replay candidate DDL/表头预检失败: sheet_battle: 第 5 列不匹配：DDL 列名为「hp_rp」，表头为「HP/RP」';
    mocks.applyChatSnapshot.mockResolvedValueOnce({ saved: false, error });

    const result = await createApi().importTemplateFromData({}, { scope: 'chat', presetName: 'battle' });

    expect(result).toEqual({
      success: false,
      scope: 'chat',
      message: `模板导入失败：${error}`,
      error,
    });
    expect(result.message).toContain('DDL/表头预检失败');
    expect(result.message).toContain('hp_rp');
    expect(result.message).toContain('HP/RP');
    expect(mocks.refreshUi).not.toHaveBeenCalled();
  });

  it('聊天导入已保存但 runtime 不可用时透传 warning 三态', async () => {
    mocks.applyChatSnapshot.mockResolvedValueOnce({
      saved: true,
      runtimeReady: false,
      postCommitWarning: '模板已保存，但 SQLite 运行时重建失败。',
    });

    const result = await createApi().importTemplateFromData({}, { scope: 'chat', presetName: 'preset-a' });

    expect(result).toMatchObject({
      success: true,
      scope: 'chat',
      runtimeReady: false,
      warning: '模板已保存，但 SQLite 运行时重建失败。',
      postCommitWarning: '模板已保存，但 SQLite 运行时重建失败。',
    });
    expect(mocks.refreshUi).toHaveBeenCalledOnce();
  });

  it('importTemplateFromData 聊天导入透传 dataMode/conflictPolicy 到提交链并回填', async () => {
    const result = await createApi().importTemplateFromData({}, {
      scope: 'chat',
      presetName: 'preset-a',
      dataMode: 'merge',
      conflictPolicy: 'reject',
    });

    expect(mocks.applyChatSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: 'api_import_template_chat',
        presetName: 'preset-a',
        dataMode: 'merge',
        conflictPolicy: 'reject',
      }),
    );
    expect(result).toMatchObject({
      success: true,
      scope: 'chat',
      dataMode: 'merge',
      conflictPolicy: 'reject',
    });
  });

  it('importTemplateFromData 全局导入回填推导的 dataMode（不改变仅保存行为）', async () => {
    const result = await createApi().importTemplateFromData({}, {
      scope: 'global',
      presetName: 'preset-a',
      dataMode: 'seed',
    });

    expect(mocks.applyChatSnapshot).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      scope: 'global',
      dataMode: 'seed',
      conflictPolicy: 'keep-current',
    });
  });
});
