import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emptyWorldSimulationUserRequirementsSnapshot_ACU,
  isMechanicalWorldSimulationResumeText_ACU,
  normalizeWorldSimulationUserRequirementLines_ACU,
  readLatestWorldSimulationUserRequirements_ACU,
  renderWorldSimulationUserRequirements_ACU,
  replaceWorldSimulationUserRequirementsByUser_ACU,
  seedWorldSimulationUserRequirementsIfEmpty_ACU,
  validateWorldSimulationUserRequirementsSnapshot_ACU,
} from '../../../../src/service/simulation/agent/agent-user-requirements';
import { WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU } from '../../../../src/service/simulation/agent/agent-model';
import { resolveWorldSimulationAnchor_ACU } from '../../../../src/service/simulation/simulation-store';
import { WorldSimulationValidationError_ACU } from '../../../../src/service/simulation/model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

describe('世界推演用户要求资料区', () => {
  beforeEach(() => {
    _set_SillyTavern_API_ACU(undefined);
  });

  it('机械继续类关键词含「开始」，夹带实质要求的句子保留', () => {
    expect(isMechanicalWorldSimulationResumeText_ACU('开始')).toBe(true);
    expect(isMechanicalWorldSimulationResumeText_ACU('恢复任务')).toBe(true);
    expect(isMechanicalWorldSimulationResumeText_ACU('开始推演港口局势')).toBe(false);
  });

  it('规范化拒绝超长行与空串，允许空数组', () => {
    expect(normalizeWorldSimulationUserRequirementLines_ACU([])).toEqual([]);
    expect(normalizeWorldSimulationUserRequirementLines_ACU(['ok', ''])).toBeNull();
    expect(normalizeWorldSimulationUserRequirementLines_ACU(['x'.repeat(8001)])).toBeNull();
    expect(normalizeWorldSimulationUserRequirementLines_ACU(['  a  ', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('校验未知键与缺键一律拒绝；缺独立字段读取为空而不伪装损坏', () => {
    expect(() => validateWorldSimulationUserRequirementsSnapshot_ACU({ schemaVersion: 1, requirements: [], updatedAt: 0, extra: 1 })).toThrow(WorldSimulationValidationError_ACU);
    expect(() => validateWorldSimulationUserRequirementsSnapshot_ACU({ schemaVersion: 1, requirements: [] })).toThrow(/缺少字段/);
    const chat: any[] = [{ message_id: 1, mes: '正文', swipe_id: 0 }];
    expect(readLatestWorldSimulationUserRequirements_ACU(chat)).toMatchObject({ snapshot: null, adoptedIndex: null, diagnostics: [] });
  });

  it('损坏快照 fail-closed 记诊断，不静默伪装成空清单', async () => {
    const chat: any[] = [{ message_id: 1, mes: '正文', swipe_id: 0 }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    chat[0][WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU] = { schemaVersion: 1, entries: 'broken' };
    const result = readLatestWorldSimulationUserRequirements_ACU(chat);
    expect(result.snapshot).toBeNull();
    expect(result.diagnostics.join('；')).toMatch(/损坏|未知|非法|当前有效分支/);
  });

  it('渲染空快照时回退非机械 originInstruction；机械继续词不回退', () => {
    const empty = emptyWorldSimulationUserRequirementsSnapshot_ACU();
    expect(renderWorldSimulationUserRequirements_ACU(empty, '继续')).toBe('（用户尚未提出任务要求）');
    expect(renderWorldSimulationUserRequirements_ACU(null, '推进港口')).toBe('- 推进港口');
    expect(renderWorldSimulationUserRequirements_ACU({ schemaVersion: 1, requirements: ['用第一人称'], updatedAt: 1 }, '推进港口')).toBe('- 用第一人称');
  });

  it('有 assistant 楼层时机械种子写入 originInstruction；机械继续词与已有清单不覆盖', async () => {
    const chat: any[] = [{ message_id: 1, mes: '正文', swipe_id: 0 }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);

    await seedWorldSimulationUserRequirementsIfEmpty_ACU('开始', anchor, chat);
    expect(saveChat).not.toHaveBeenCalled();

    await seedWorldSimulationUserRequirementsIfEmpty_ACU('推进港口局势', anchor, chat);
    expect(saveChat).toHaveBeenCalledOnce();
    expect(readLatestWorldSimulationUserRequirements_ACU(chat).snapshot?.requirements).toEqual(['推进港口局势']);

    await seedWorldSimulationUserRequirementsIfEmpty_ACU('另一条', anchor, chat);
    expect(saveChat).toHaveBeenCalledOnce();
  });

  it('用户编辑必须是字符串数组；空串整份拒绝，空数组合法', async () => {
    const chat: any[] = [{ message_id: 1, mes: '正文', swipe_id: 0 }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);

    await expect(replaceWorldSimulationUserRequirementsByUser_ACU(['不要揭底牌', ''], chat)).rejects.toMatchObject({
      error: { code: 'WORLD_SIMULATION_SNAPSHOT_INVALID' },
    });
    const saved = await replaceWorldSimulationUserRequirementsByUser_ACU(['不要揭底牌', '用第一人称'], chat);
    expect(saved.requirements).toEqual(['不要揭底牌', '用第一人称']);
    const cleared = await replaceWorldSimulationUserRequirementsByUser_ACU([], chat);
    expect(cleared.requirements).toEqual([]);
  });
});
