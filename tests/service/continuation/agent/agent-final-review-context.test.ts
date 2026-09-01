import { describe, expect, it } from 'vitest';

import { buildAgentFinalReviewEvidence_ACU, extractAgentFinalReviewWorldbookSeeds_ACU } from '../../../../src/service/continuation/agent/agent-final-review-context';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';

function context_ACU() {
  return {
    chat: [{ mes: '主角询问守门人晶屑的用途。', is_user: false }],
    moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(),
    settledThroughIndex: 0,
    originInstruction: '主角必须调查禁区晶屑，但不得越过守门人的认知边界。',
    recentTurnCount: 1,
    tableData: {},
    execution: {
      envelope: {}, task: { taskId: 'task', stages: [] },
      stage: { stageNumber: 1, status: 'running' },
      revision: { outline: { title: '禁区试探', goal: '调查晶屑', tempo: 'mixed', totalTurns: 1 } },
      node: { id: 'node-1', title: '铁门前', goal: '询问守门人', turns: [{ id: 'turn-1', pacing: 'setup', goal: '观察晶屑' }] },
      turn: { id: 'turn-1', pacing: 'setup', goal: '观察晶屑' }, turnNumber: 1, nodeTurnNumber: 1,
    },
    worldbook: {
      available: true,
      entries: [
        { bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑', '禁区'], constant: false, content: '黑色晶屑只能由守门人保管，旁人不得带离铁门。', tokens: 24 },
        { bookName: '设定集', uid: '9', title: '守门人', keys: ['守门人'], constant: true, content: '守门人只知道铁门前发生的事。', tokens: 16 },
      ],
    },
  } as any;
}

describe('终审世界书证据准备', () => {
  it('从终审输入提取检索种子并注入命中与常开条目的全文', () => {
    const evidence = buildAgentFinalReviewEvidence_ACU({
      resolveContext: context_ACU(),
      currentUserInput: '让主角询问守门人晶屑。',
      candidateInstruction: '主角在铁门前观察晶屑，再向守门人提问。',
      planningSummary: '保持认知边界。',
    });

    expect(evidence.worldbookSeeds).toContain('晶屑');
    expect(evidence.worldbookEvidence).toContain('旁人不得带离铁门。');
    expect(evidence.worldbookEvidence).toContain('只知道铁门前发生的事。');
    expect(evidence.fixedReadKeys).toEqual(expect.arrayContaining(['$WORLDBOOK:设定集:7', '$WORLDBOOK:设定集:9']));
    expect(evidence.supplementalMaterials).toContain('世界书检索种子');
  });

  it('终审固定证据包含故事年代学账本，并把 $CHRONOLOGY 记入固定读地址', () => {
    const context = context_ACU();
    context.moduleSnapshot = {
      ...context.moduleSnapshot,
      revisions: { ...context.moduleSnapshot.revisions, chronology: 1 },
      chronology: [{ id: 'T1', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate', transition: '在临川城休整七日', evidenceIndexes: [0], updatedIndex: 0, retired: false, retiredReason: '' }],
    };
    const evidence = buildAgentFinalReviewEvidence_ACU({
      resolveContext: context,
      currentUserInput: '',
      candidateInstruction: '一个月后主角伤愈出关。',
    });

    expect(evidence.supplementalMaterials).toContain('故事年代学账本');
    expect(evidence.supplementalMaterials).toContain('当前时间锚：入城后的第七天');
    expect(evidence.supplementalMaterials).toContain('大纲时间字段只是计划');
    expect(evidence.fixedReadKeys).toContain('$CHRONOLOGY');
    expect(evidence.gateItems.some(item => item.text.includes('入城后的第七天'))).toBe(true);
  });

  it('空账本时终审证据如实说明没有已结算的时间事实', () => {
    const evidence = buildAgentFinalReviewEvidence_ACU({
      resolveContext: context_ACU(),
      currentUserInput: '',
      candidateInstruction: '观察晶屑',
    });
    expect(evidence.supplementalMaterials).toContain('没有已结算的故事时间记录');
  });

  it('世界书不可用时保留可诊断证据不足文本', () => {
    const context = context_ACU();
    context.worldbook.available = false;
    const evidence = buildAgentFinalReviewEvidence_ACU({ resolveContext: context, currentUserInput: '', candidateInstruction: '观察晶屑' });

    expect(evidence.worldbookEvidence).toContain('世界书当前不可用');
    expect(evidence.worldbookEvidence).toContain('未验证');
  });

  it('去重并限制检索种子数量', () => {
    const seeds = extractAgentFinalReviewWorldbookSeeds_ACU('晶屑 晶屑 守门人');
    expect(seeds).toEqual(expect.arrayContaining(['晶屑', '守门人']));
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(seeds.length).toBeLessThanOrEqual(48);
  });
});
