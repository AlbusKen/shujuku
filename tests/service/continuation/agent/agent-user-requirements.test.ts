import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyAgentUserRequirementsReplace_ACU,
  collectSubstantialUserTexts_ACU,
  isMechanicalResumeUserText_ACU,
  normalizeUserRequirementLines_ACU,
  renderAgentUserRequirements_ACU,
  seedAgentUserRequirementsIfEmpty_ACU,
} from '../../../../src/service/continuation/agent/agent-user-requirements';
import { buildEmptyAgentModuleSnapshot_ACU, readAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { AGENT_MODULE_FIELD_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

function userMessage_ACU(id: number, text: string) {
  return { id, kind: 'user' as const, text, digest: text.slice(0, 24), turnKey: 't', at: id };
}

describe('续写用户要求资料区', () => {
  beforeEach(() => {
    _set_SillyTavern_API_ACU(null as any);
  });

  it('机械继续类关键词整段匹配才过滤，夹带实质要求的句子保留', () => {
    expect(isMechanicalResumeUserText_ACU('')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('  ')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('继续')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('开始')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('恢复任务')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('RESUME')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('continue')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('继续写主角隐瞒身份')).toBe(false);
  });

  it('压缩区间只收集 kind=user 的实质发言，按 id 开闭区间去重空白与继续类', () => {
    const messages = [
      userMessage_ACU(1, '不要提前揭底牌'),
      { id: 2, kind: 'agent' as const, text: '已记下', digest: 'agent', turnKey: 't', at: 2 },
      userMessage_ACU(3, '继续'),
      userMessage_ACU(4, '  用第一人称  '),
      userMessage_ACU(5, '恢复'),
      userMessage_ACU(6, '保持慢热'),
    ];
    expect(collectSubstantialUserTexts_ACU(messages, 1, 5)).toEqual(['用第一人称']);
    expect(collectSubstantialUserTexts_ACU(messages, 0, 6)).toEqual(['不要提前揭底牌', '用第一人称', '保持慢热']);
  });

  it('规范化拒绝非数组、非字符串与空串；按首次出现去重并 trim', () => {
    expect(normalizeUserRequirementLines_ACU('nope')).toBeNull();
    expect(normalizeUserRequirementLines_ACU(['合法', 1])).toBeNull();
    expect(normalizeUserRequirementLines_ACU(['合法', '  '])).toBeNull();
    expect(normalizeUserRequirementLines_ACU(['  第一人称  ', '第一人称', '不要揭底牌'])).toEqual(['第一人称', '不要揭底牌']);
    expect(normalizeUserRequirementLines_ACU([])).toEqual([]);
  });

  it('渲染空清单时回退 originInstruction；两者都空时给占位句', () => {
    const empty = buildEmptyAgentModuleSnapshot_ACU();
    expect(renderAgentUserRequirements_ACU(empty, '')).toBe('（用户尚未提出任务要求）');
    expect(renderAgentUserRequirements_ACU(empty, '  推进禁区  ')).toBe('- 推进禁区');
    const filled = applyAgentUserRequirementsReplace_ACU(empty, ['不要揭底牌', '用第一人称']);
    expect(filled.revisions.userRequirements).toBe(1);
    expect(renderAgentUserRequirements_ACU(filled, '推进禁区')).toBe('- 不要揭底牌\n- 用第一人称');
  });

  it('创建任务无楼层时种子写入静默跳过；有末楼且快照为空时机械写入 originInstruction', async () => {
    await expect(seedAgentUserRequirementsIfEmpty_ACU('推进禁区', [])).resolves.toBeUndefined();

    const chat: any[] = [{ mes: '正文' }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    await seedAgentUserRequirementsIfEmpty_ACU('  推进禁区  ', chat);
    expect(saveChat).toHaveBeenCalledOnce();
    expect(readAgentModuleSnapshot_ACU(chat).userRequirements).toEqual(['推进禁区']);

    await seedAgentUserRequirementsIfEmpty_ACU('另一条要求', chat);
    expect(saveChat).toHaveBeenCalledOnce();
    expect(chat[0][AGENT_MODULE_FIELD_ACU].userRequirements).toEqual(['推进禁区']);
  });

  it('空白 originInstruction 不写盘', async () => {
    const chat: any[] = [{ mes: '正文' }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    await seedAgentUserRequirementsIfEmpty_ACU('   ', chat);
    expect(saveChat).not.toHaveBeenCalled();
    expect(Object.prototype.hasOwnProperty.call(chat[0], AGENT_MODULE_FIELD_ACU)).toBe(false);
  });
});
