import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyAgentUserRequirementsReplace_ACU,
  isMechanicalResumeUserText_ACU,
  renderAgentUserRequirements_ACU,
  seedAgentUserRequirementsIfEmpty_ACU,
} from '../../../../src/service/continuation/agent/agent-user-requirements';
import { buildEmptyAgentModuleSnapshot_ACU, readAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { AGENT_MODULE_FIELD_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';
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
    expect(readAgentModuleSnapshot_ACU(chat).userRequirements).toEqual(['推进禁区']);
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
