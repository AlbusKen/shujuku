/**
 * templateFollowGlobalFlow — 跟随全局共享流程（S1-2）
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  follow: vi.fn(),
  guard: vi.fn(),
  globalSnapshot: vi.fn(),
}));

vi.mock('../../../src/service/template/template-preset-service', () => ({
  followGlobalTemplateForCurrentChat_ACU: mocks.follow,
}));
vi.mock('../../../src/service/template/chat-scope', () => ({
  buildChatSheetGuideDataFromTemplateObj_ACU: (obj: any) => (obj ? { sheets: {} } : null),
  getGlobalTemplateSnapshotForCurrentProfile_ACU: mocks.globalSnapshot,
}));
vi.mock('../../../src/presentation-v2/composables/useTemplateRecoveryGuard', () => ({
  ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU: mocks.guard,
}));

import {
  promptFollowGlobalAfterSetDefault_ACU,
  runFollowGlobalTemplateFlow_ACU,
} from '../../../src/presentation-v2/composables/templateFollowGlobalFlow';

function makeUi() {
  return {
    dialogStore: { confirm: vi.fn(async () => true) } as any,
    toast: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() } as any,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.globalSnapshot.mockReturnValue({ templateObj: { sheet_1: {} }, templateStr: '{"sheet_1":{}}' });
  mocks.guard.mockResolvedValue({ success: true, dataWasReset: false });
  mocks.follow.mockResolvedValue({ saved: true, mode: 'inherit_global', presetName: '全局A' });
});

describe('runFollowGlobalTemplateFlow_ACU', () => {
  it('恢复守卫失败时不执行任何提交', async () => {
    const ui = makeUi();
    mocks.guard.mockResolvedValueOnce({ success: false, dataWasReset: false });
    expect(await runFollowGlobalTemplateFlow_ACU(ui)).toBe(false);
    expect(mocks.follow).not.toHaveBeenCalled();
  });

  it('成功清除覆盖时 toast 成功并返回 true', async () => {
    const ui = makeUi();
    expect(await runFollowGlobalTemplateFlow_ACU(ui)).toBe(true);
    expect(mocks.follow).toHaveBeenCalledWith(expect.objectContaining({ destructiveChangeConfirmed: false }));
    expect(ui.toast.success).toHaveBeenCalled();
  });

  it('alreadyFollowing 时提示已跟随全局并返回 true', async () => {
    const ui = makeUi();
    mocks.follow.mockResolvedValueOnce({ saved: true, alreadyFollowing: true, mode: 'inherit_global', presetName: '' });
    expect(await runFollowGlobalTemplateFlow_ACU(ui)).toBe(true);
    expect(ui.toast.info).toHaveBeenCalledWith('当前聊天已跟随全局模板，无需清除覆盖。');
  });

  it('postCommitWarning 透传为 warning toast', async () => {
    const ui = makeUi();
    mocks.follow.mockResolvedValueOnce({ saved: true, mode: 'inherit_global', presetName: '', postCommitWarning: 'SQLite 重建失败' });
    expect(await runFollowGlobalTemplateFlow_ACU(ui)).toBe(true);
    expect(ui.toast.warning).toHaveBeenCalledWith('SQLite 重建失败', expect.any(Object));
    expect(ui.toast.success).not.toHaveBeenCalled();
  });

  it('破坏性 blockers 经确认后以 destructiveChangeConfirmed=true 重试；拒绝则返回 false', async () => {
    const ui = makeUi();
    mocks.follow
      .mockResolvedValueOnce({ saved: false, blockers: ['删除表「旧表」需要显式确认。'], error: '删除表「旧表」需要显式确认。' })
      .mockResolvedValueOnce({ saved: true, mode: 'inherit_global', presetName: '' });
    expect(await runFollowGlobalTemplateFlow_ACU(ui)).toBe(true);
    expect(mocks.follow).toHaveBeenNthCalledWith(1, expect.objectContaining({ destructiveChangeConfirmed: false }));
    expect(mocks.follow).toHaveBeenNthCalledWith(2, expect.objectContaining({ destructiveChangeConfirmed: true }));

    const ui2 = makeUi();
    ui2.dialogStore.confirm.mockResolvedValueOnce(false);
    mocks.follow.mockReset().mockResolvedValueOnce({ saved: false, blockers: ['删除列「旧列」需要显式确认。'], error: 'x' });
    expect(await runFollowGlobalTemplateFlow_ACU(ui2)).toBe(false);
    expect(mocks.follow).toHaveBeenCalledTimes(1);
  });

  it('stale_revision_conflict 单次重试', async () => {
    const ui = makeUi();
    mocks.follow
      .mockResolvedValueOnce({ saved: false, error: 'V2 stale_revision_conflict: 请重试' })
      .mockResolvedValueOnce({ saved: true, mode: 'inherit_global', presetName: '' });
    expect(await runFollowGlobalTemplateFlow_ACU(ui)).toBe(true);
    expect(mocks.follow).toHaveBeenCalledTimes(2);
  });

  it('提交失败时 toast 真实错误并返回 false', async () => {
    const ui = makeUi();
    mocks.follow.mockResolvedValueOnce({ saved: false, error: '目标聊天已切换，已取消模板提交。' });
    expect(await runFollowGlobalTemplateFlow_ACU(ui)).toBe(false);
    expect(ui.toast.error).toHaveBeenCalledWith('目标聊天已切换，已取消模板提交。');
  });
});

describe('promptFollowGlobalAfterSetDefault_ACU', () => {
  it('确认后执行跟随全局流程；拒绝则保留覆盖', async () => {
    const ui = makeUi();
    expect(await promptFollowGlobalAfterSetDefault_ACU({ ...ui, newDefaultName: '新默认' })).toBe(true);
    expect(ui.dialogStore.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('新默认') }));
    expect(mocks.follow).toHaveBeenCalled();

    const ui2 = makeUi();
    ui2.dialogStore.confirm.mockResolvedValueOnce(false);
    mocks.follow.mockClear();
    expect(await promptFollowGlobalAfterSetDefault_ACU({ ...ui2, newDefaultName: '新默认' })).toBe(false);
    expect(mocks.follow).not.toHaveBeenCalled();
  });
});
