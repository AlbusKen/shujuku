import { describe, expect, it } from 'vitest';

import { renderAgentModuleCatalog_ACU, renderAgentReadCatalog_ACU, renderAgentSubagentCatalog_ACU, findAgentSubagentDefinition_ACU } from '../../../../src/service/continuation/agent/agent-catalog';
import { renderAgentTableByAliases_ACU, renderAgentTableByName_ACU, renderAgentTableCatalog_ACU } from '../../../../src/service/continuation/agent/agent-tables';
import {
  renderAgentReadMaterials_ACU,
  renderAgentStoryCatalog_ACU,
  renderAgentStoryOverview_ACU,
  renderAgentUnsettledHistory_ACU,
  resolveAgentReadToken_ACU,
  type AgentResolveContext_ACU,
} from '../../../../src/service/continuation/agent/agent-placeholder-resolver';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';

const tableData_ACU = {
  mate: { ignored: true },
  s0: { name: '全局数据表', content: [['键', '值'], ['当前地点', '禁区外围']] },
  s1: { name: '角色表', content: [['姓名', '状态'], ['林瑶', '右臂有伤']] },
  s2: { name: '纪要表', content: [['时间', '事件']] },
  s3: { name: '自定义道具表', content: [['道具', '归属'], ['黑色晶屑', '主角']] },
};

function context_ACU(): AgentResolveContext_ACU {
  return {
    chat: [{ mes: '第零楼', is_user: true }, { mes: '第一楼' }, { mes: '第二楼', is_user: true }],
    moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(),
    settledThroughIndex: 0,
    execution: {
      envelope: {} as any,
      task: { taskId: 't', originInstruction: '推进剧情' } as any,
      stage: { stageNumber: 2 } as any,
      revision: { outline: { title: '禁区', goal: '进入禁区', tempo: 'mixed', role: 'development', timeSpanGoal: '三日', totalTurns: 6 } } as any,
      node: {
        id: 'n1', title: '试探', goal: '试探守门人', turns: [
          { id: 'turn-1', goal: '第一轮', pacing: 'setup', function: 'daily_world', mainlineDelta: 'hold', timeAdvance: 'same_day' },
          {
            id: 'turn-2',
            goal: '第二轮',
            pacing: 'turn',
            function: 'reveal',
            mainlineDelta: 'step',
            timeAdvance: 'days',
            timeAnchor: '第三日清晨',
          },
        ],
      } as any,
      turn: {
        id: 'turn-2', goal: '第二轮', pacing: 'turn', function: 'reveal', mainlineDelta: 'step', timeAdvance: 'days', timeAnchor: '第三日清晨',
      } as any,
      turnNumber: 2,
      nodeTurnNumber: 2,
    },
    originInstruction: '推进剧情',
    recentTurnCount: 2,
    tableData: tableData_ACU,
  };
}

describe('Agent 目录渲染', () => {
  it('子代理目录暴露职责与读写权限，但不含内部提示词', () => {
    const catalog = renderAgentSubagentCatalog_ACU();
    expect(catalog).toContain('hook-cognition-maintainer');
    expect(catalog).toContain('continuity-reviewer');
    expect(catalog).toContain('无（只返回建议）');
    expect(catalog).not.toContain('你只输出一个 JSON 对象');
  });

  it('大纲子代理排在目录首位，说明三种触发时机与串行执行方式', () => {
    const catalog = renderAgentSubagentCatalog_ACU();
    expect(catalog.indexOf('outline-architect')).toBeLessThan(catalog.indexOf('hook-cognition-maintainer'));
    expect(catalog).toContain('创建（当前没有任何大纲时）');
    expect(catalog).toContain('串行执行且先于同波次其他派工');
    expect(catalog).toContain('计入派工预算');
  });

  it('资料模块目录说明谁能写，长期约束标注仅主 Agent 可登记', () => {
    const catalog = renderAgentModuleCatalog_ACU();
    expect(catalog).toContain('$HOOKS_LEDGER');
    expect(catalog).toContain('$ACTIVE_CONSTRAINTS');
    expect(catalog).toContain('仅主 Agent 裁决后登记');
  });

  it('目录与写入说明公开故事年代学账本，并由维护代理职责固定负责', () => {
    const moduleCatalog = renderAgentModuleCatalog_ACU();
    expect(moduleCatalog).toContain('$CHRONOLOGY');
    expect(moduleCatalog).toContain('故事年代学账本');
    expect(moduleCatalog).toContain('大纲里的时间字段是计划，不在此账本内');

    const subagentCatalog = renderAgentSubagentCatalog_ACU();
    expect(subagentCatalog).toContain('$HOOKS_LEDGER、$INFO_GAP、$CHRONOLOGY（职责固定');
    expect(subagentCatalog).toContain('故事年代学账本');
  });

  it('未知代理名查不到定义', () => {
    expect(findAgentSubagentDefinition_ACU('hook-cognition-maintainer')?.kind).toBe('maintain');
    expect(findAgentSubagentDefinition_ACU('不存在的代理')).toBeNull();
  });
});

describe('Agent 表格只读投影', () => {
  it('按别名命中三张保底表', () => {
    expect(renderAgentTableByAliases_ACU('global', tableData_ACU)).toContain('禁区外围');
    expect(renderAgentTableByAliases_ACU('characters', tableData_ACU)).toContain('林瑶');
    expect(renderAgentTableByAliases_ACU('chronicles', tableData_ACU)).toContain('该表暂无数据行');
  });

  it('表缺失时如实标注并阻止据此推断', () => {
    const text = renderAgentTableByAliases_ACU('characters', { s0: tableData_ACU.s0 });
    expect(text).toContain('不存在角色表');
    expect(text).toContain('请勿据此推断');
  });

  it('同类多张表全部列出而不是猜一张', () => {
    const text = renderAgentTableByAliases_ACU('characters', { a: tableData_ACU.s1, b: { name: '人物表', content: [['姓名'], ['另一张']] } });
    expect(text).toContain('命中 2 张同名或同类表');
  });

  it('目录列出全部实际存在的表并给出读集写法，mate 不算表', () => {
    const catalog = renderAgentTableCatalog_ACU(tableData_ACU);
    expect(catalog).toContain('$TABLE:自定义道具表');
    expect(catalog).not.toContain('mate');
    expect(renderAgentTableByName_ACU('自定义道具表', tableData_ACU)).toContain('黑色晶屑');
    expect(renderAgentTableByName_ACU('不存在表', tableData_ACU)).toContain('不存在名为');
  });
});

describe('Agent 读写集解析', () => {
  it('未结算历史从水位之后开始逐楼列出，且只含 AI 楼层（正文永不含用户楼层）', () => {
    const text = renderAgentUnsettledHistory_ACU(context_ACU());
    expect(text).toContain('【楼层 1】');
    expect(text).toContain('第一楼');
    expect(text).not.toContain('第二楼');
    expect(text).not.toContain('第零楼');
  });

  it('水位已到最后一楼时如实说明没有未结算内容', () => {
    expect(renderAgentUnsettledHistory_ACU({ ...context_ACU(), settledThroughIndex: 2 })).toContain('没有尚未结算的真实历史');
  });

  it('大纲窗口标出本轮位置并声明大纲只是计划', () => {
    const text = resolveAgentReadToken_ACU('$OUTLINE_WINDOW', context_ACU()).text;
    expect(text).toContain('← 本轮');
    expect(text).toContain('阶段结构职责：development');
    expect(text).toContain('阶段时间目标：三日');
    expect(text).toContain('function=reveal');
    expect(text).toContain('mainline=step');
    expect(text).toContain('time=days｜anchor=第三日清晨');
    expect(text).toContain('大纲是计划，不是已经发生的事实');
  });

  it('无大纲与阶段已完成两种空态都指引派工大纲子代理', () => {
    const noOutline = context_ACU();
    noOutline.execution = { ...noOutline.execution, stage: null, revision: null, node: null, turn: null, turnNumber: null, nodeTurnNumber: null } as any;
    expect(resolveAgentReadToken_ACU('$OUTLINE_WINDOW', noOutline).text).toContain('还没有阶段大纲');
    expect(resolveAgentReadToken_ACU('$OUTLINE_WINDOW', noOutline).text).toContain('outline-architect');
    expect(resolveAgentReadToken_ACU('$CURRENT_TURN_GOAL', noOutline).text).toContain('尚无可执行的大纲轮次');

    const completed = context_ACU();
    completed.execution = { ...completed.execution, stage: { stageNumber: 2, status: 'completed', completedTurns: 6 } as any, revision: null, node: null, turn: null, turnNumber: null, nodeTurnNumber: null };
    const text = resolveAgentReadToken_ACU('$OUTLINE_WINDOW', completed).text;
    expect(text).toContain('已全部完成');
    expect(text).toContain('继续大纲');
  });

  it('$TABLE:<表名> 形式的动态读集直接解析成该表内容', () => {
    const resolved = resolveAgentReadToken_ACU('$TABLE:自定义道具表', context_ACU());
    expect(resolved.title).toContain('自定义道具表');
    expect(resolved.text).toContain('黑色晶屑');
  });

  it('未知读集 token 明确告知不可读而不是静默返回空', () => {
    expect(resolveAgentReadToken_ACU('$NOT_A_TOKEN', context_ACU()).text).toContain('不是可读资料接口');
  });

  it('材料块按分节汇总并去重，空读集如实标注', () => {
    const materials = renderAgentReadMaterials_ACU(['$HOOKS_LEDGER', '$HOOKS_LEDGER', '$TABLE_CHARACTERS'], context_ACU());
    expect(materials.match(/### /g)).toHaveLength(2);
    expect(materials).toContain('伏笔账本');
    expect(materials).toContain('林瑶');
    expect(renderAgentReadMaterials_ACU([], context_ACU())).toContain('信息不足');
  });

  it('读集词汇表覆盖全部地址体系，主/子代理共用同一份', () => {
    const catalog = renderAgentReadCatalog_ACU();
    expect(catalog).toContain('$STORY_RANGE:');
    expect(catalog).toContain('$TABLE:表名:起始行-结束行');
    expect(catalog).toContain('$WORLDBOOK:书名:uid');
    expect(catalog).toContain('$TABLE:纪要表:起始行-结束行');
    expect(catalog).toContain('$CHRONOLOGY / $CHRONOLOGY:ID,ID');
    expect(catalog).not.toContain('$CHRONICLES');
    expect(catalog).toContain('search');
  });

  it('$CHRONOLOGY 读地址解析为年代学账本，支持按 ID 精读', () => {
    const context = context_ACU();
    context.moduleSnapshot = {
      ...context.moduleSnapshot,
      revisions: { ...context.moduleSnapshot.revisions, chronology: 1 },
      chronology: [{ id: 'T1', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate', transition: '在临川城休整七日', evidenceIndexes: [1], updatedIndex: 1, retired: false, retiredReason: '' }],
    };

    const full = resolveAgentReadToken_ACU('$CHRONOLOGY', context);
    expect(full.title).toContain('故事年代学账本');
    expect(full.text).toContain('当前时间锚：入城后的第七天');

    const byId = resolveAgentReadToken_ACU('$CHRONOLOGY:T1', context);
    expect(byId.text).toContain('在临川城休整七日');
    expect(resolveAgentReadToken_ACU('$CHRONOLOGY:T9', context).text).toContain('不存在');
  });
});

describe('正文窗口与区间读取', () => {
  function storyContext_ACU(windowFloors: number, tailFloors: number): AgentResolveContext_ACU {
    return {
      ...context_ACU(),
      chat: [
        { mes: '用户开场', is_user: true },
        { mes: '第一楼正文内容' },
        { mes: '用户插话', is_user: true },
        { mes: '第三楼正文内容' },
        { mes: '第四楼正文内容' },
      ],
      storyWindowFloors: windowFloors,
      storyTailFloors: tailFloors,
    };
  }

  it('目录只列窗口内楼层，尾部楼层给全文，更早的指引纪要', () => {
    const catalog = renderAgentStoryCatalog_ACU(storyContext_ACU(2, 1));
    expect(catalog).toContain('更早的 1 个 AI 楼层不在可读窗口内');
    expect(catalog).toContain('$STORY_RANGE:3-3');
    expect(catalog).toContain('第四楼正文内容');
    expect(catalog).not.toContain('第一楼正文内容');
  });

  it('$STORY_RANGE 只放行窗口内楼层，窗口外指引事件概览与纪要表行区间', () => {
    const context = storyContext_ACU(2, 1);
    expect(resolveAgentReadToken_ACU('$STORY_RANGE:3-4', context).text).toContain('第三楼正文内容');
    expect(resolveAgentReadToken_ACU('$STORY_RANGE:1-1', context).text).toContain('$TABLE:纪要表');
    expect(resolveAgentReadToken_ACU('$STORY_RANGE:xx', context).text).toContain('不合法');
  });

  it('表格行区间读取只回区间内数据行', () => {
    const context = context_ACU();
    const ranged = resolveAgentReadToken_ACU('$TABLE:角色表:1-1', context);
    expect(ranged.text).toContain('林瑶');
    const outside = resolveAgentReadToken_ACU('$TABLE:角色表:5-9', context);
    expect(outside.text).not.toContain('林瑶');
  });

  it('模块按 ID 精读时未知 ID 如实标注', () => {
    const text = resolveAgentReadToken_ACU('$HOOKS_LEDGER:H999', context_ACU()).text;
    expect(text).toContain('H999');
    expect(text).toContain('不存在');
  });
});

describe('事件概览渲染与截断', () => {
  const chronicleData_ACU = {
    s0: {
      name: '纪要表',
      content: [
        ['编码索引', '概览', '纪要'],
        ['AM0001', '第一轮概览', '第一轮纪要全文'],
        ['AM0002', '第二轮概览', ''],
        ['AM0003', '第三轮概览', '第三轮纪要全文'],
        ['AM0004', '第四轮概览', '第四轮纪要全文'],
        ['AM0005', '第五轮概览', '第五轮纪要全文'],
        ['AM0006', '第六轮概览', '第六轮纪要全文'],
      ],
    },
  };

  it('无上限时全量渲染，召回命中行就地展开为纪要全文', () => {
    const text = renderAgentStoryOverview_ACU({ tableData: chronicleData_ACU, recallCodes: ['AM0003'] });
    expect(text).toContain('- AM0001｜第一轮概览');
    expect(text).toContain('- AM0006｜第六轮概览');
    expect(text).toContain('- AM0003｜【纪要全文】第三轮纪要全文');
    expect(text).not.toContain('已省略');
  });

  it('maxRows 大于等于总行数时输出与全量渲染一致', () => {
    const full = renderAgentStoryOverview_ACU({ tableData: chronicleData_ACU, recallCodes: ['AM0003'] });
    const capped = renderAgentStoryOverview_ACU({ tableData: chronicleData_ACU, recallCodes: ['AM0003'] }, { maxRows: 6 });
    expect(capped).toBe(full);
  });

  it('截断时只保留尾部窗口，并给出被省略行区间的回溯地址', () => {
    const text = renderAgentStoryOverview_ACU({ tableData: chronicleData_ACU }, { maxRows: 2 });
    expect(text).toContain('更早的 4 轮概览已省略（对应「纪要表」第 1-4 行）');
    expect(text).toContain('$TABLE:纪要表:行区间');
    expect(text).toContain('- AM0005｜第五轮概览');
    expect(text).toContain('- AM0006｜第六轮概览');
    expect(text).not.toContain('第三轮概览');
  });

  it('窗口外的召回命中行不被截断：以纪要全文按行序前置展示', () => {
    const text = renderAgentStoryOverview_ACU({ tableData: chronicleData_ACU, recallCodes: ['AM0001', 'AM0003', 'AM0006'] }, { maxRows: 2 });
    expect(text).toContain('以下为本轮召回命中的更早轮次');
    expect(text).toContain('- AM0001｜【纪要全文】第一轮纪要全文');
    expect(text).toContain('- AM0003｜【纪要全文】第三轮纪要全文');
    expect(text.indexOf('AM0001')).toBeLessThan(text.indexOf('AM0003'));
    expect(text.indexOf('AM0003')).toBeLessThan(text.indexOf('AM0005'));
    // 窗口内的命中行仍是就地展开，不进前置小节。
    expect(text).toContain('- AM0006｜【纪要全文】第六轮纪要全文');
  });

  it('窗口外召回命中但纪要列为空时退回概览文本，不静默丢弃', () => {
    const text = renderAgentStoryOverview_ACU({ tableData: chronicleData_ACU, recallCodes: ['AM0002'] }, { maxRows: 2 });
    expect(text).toContain('以下为本轮召回命中的更早轮次');
    expect(text).toContain('- AM0002｜第二轮概览');
  });
});
