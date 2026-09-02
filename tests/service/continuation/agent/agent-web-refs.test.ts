import { describe, expect, it } from 'vitest';

import {
  buildEmptyAgentModuleSnapshot_ACU,
  renderAgentWebRefsByIds_ACU,
  renderAgentWebRefsCatalog_ACU,
  validateAgentModuleSnapshot_ACU,
  validateWebRefEntry_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import { applyAgentWebRefsDelta_ACU, nextAgentWebRefId_ACU } from '../../../../src/service/continuation/agent/agent-transaction';
import { parseAgentResearcherOutput_ACU, parseAgentResearcherToolCalls_ACU, parseAgentWebToolCall_ACU } from '../../../../src/service/continuation/agent/agent-protocol';
import { renderAgentModuleCatalog_ACU, renderAgentSubagentCatalog_ACU } from '../../../../src/service/continuation/agent/agent-catalog';
import { resolveAgentReadToken_ACU } from '../../../../src/service/continuation/agent/agent-placeholder-resolver';
import { runAgentSearch_ACU } from '../../../../src/service/continuation/agent/agent-search';
import { ContinuationValidationError_ACU } from '../../../../src/service/continuation/model';
import type { AgentModuleSnapshot_ACU, AgentResearcherOutput_ACU, AgentWebRefEntry_ACU } from '../../../../src/service/continuation/agent/agent-model';

const entry_ACU = (overrides: Partial<AgentWebRefEntry_ACU> = {}): AgentWebRefEntry_ACU => ({
  id: 'WR-001',
  title: '鲁迪乌斯·格雷拉特',
  source: 'moegirl',
  url: 'https://zh.moegirl.org.cn/鲁迪乌斯·格雷拉特',
  query: '鲁迪乌斯',
  tags: ['人物'],
  brief: '《无职转生》主角，转生的前尼特魔术师。',
  summary: '身份：布耶纳村下级贵族长男。\n能力：帝级土系魔术，成名技泥沼与岩炮弹。\n雷点：本性好色但对妻子忠诚。',
  sourceStatus: 'ok',
  fetchedAt: 1,
  retired: false,
  retiredReason: '',
  ...overrides,
});

const snapshotWith_ACU = (...entries: AgentWebRefEntry_ACU[]): AgentModuleSnapshot_ACU => ({
  ...buildEmptyAgentModuleSnapshot_ACU(),
  settledThroughIndex: 0,
  webRefs: entries,
  revisions: { ...buildEmptyAgentModuleSnapshot_ACU().revisions, webRefs: 2 },
});

const resolveContext_ACU = (snapshot: AgentModuleSnapshot_ACU) => ({
  chat: [],
  moduleSnapshot: snapshot,
  settledThroughIndex: snapshot.settledThroughIndex,
  execution: { task: { stages: [] }, stage: null, revision: null, node: null, turn: null } as any,
  originInstruction: '',
});

describe('百科资料库快照', () => {
  it('旧快照没有 webRefs 字段时兼容为空库；字段存在但非数组则整份非法', () => {
    const legacy = { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 0 } as any;
    delete legacy.webRefs;
    delete legacy.revisions.webRefs;
    const loaded = validateAgentModuleSnapshot_ACU(legacy);
    expect(loaded?.webRefs).toEqual([]);
    expect(loaded?.revisions.webRefs).toBe(0);
    expect(validateAgentModuleSnapshot_ACU({ ...legacy, webRefs: 'nope' })).toBeNull();
  });

  it('条目校验：id / title / url 缺一即非法；brief 缺失退回摘要首句；来源与状态非法回落保守值', () => {
    expect(validateWebRefEntry_ACU({ id: 'x', title: '', url: 'https://a' })).toBeNull();
    const salvaged = validateWebRefEntry_ACU({ id: 'x', title: '物品', url: 'https://a', source: 'weird', sourceStatus: 'odd', summary: '一把剑。可斩钢。' });
    expect(salvaged).toMatchObject({ source: 'web', sourceStatus: 'unavailable', brief: '一把剑。', tags: [] });
  });

  it('目录与全量读只给「名称 + 一句话简介」预览，详情只在按 ID 精读时出现', () => {
    const snapshot = snapshotWith_ACU(entry_ACU(), entry_ACU({ id: 'WR-002', title: '泥沼', tags: ['法术'], brief: '土系魔术，在敌人脚下制造泥潭。', summary: '效果：限制行动。', retired: true, retiredReason: '并入人物条目' }));
    const catalog = renderAgentWebRefsCatalog_ACU(snapshot, true);
    expect(catalog).toContain('[WR-001]「鲁迪乌斯·格雷拉特」《无职转生》主角，转生的前尼特魔术师。（人物）');
    expect(catalog).not.toContain('泥沼');
    expect(catalog).not.toContain('布耶纳村');
    expect(catalog).not.toContain('成名技泥沼');

    const preview = resolveAgentReadToken_ACU('$WEB_REFS', resolveContext_ACU(snapshot));
    expect(preview.text).toContain('当前修订号=2');
    expect(preview.text).toContain('[WR-001]「鲁迪乌斯·格雷拉特」《无职转生》主角');
    expect(preview.text).not.toContain('布耶纳村');
    expect(preview.text).toContain('另有 1 条已退休条目');

    const detail = resolveAgentReadToken_ACU('$WEB_REFS:WR-001,WR-002', resolveContext_ACU(snapshot));
    expect(detail.text).toContain('简介：《无职转生》主角');
    expect(detail.text).toContain('详情：\n身份：布耶纳村下级贵族长男。');
    expect(detail.text).not.toContain('原文：');
    expect(detail.text).toContain('链接：https://zh.moegirl.org.cn/');
    expect(detail.text).toContain('[WR-002]「泥沼」');
    expect(detail.text).toContain('退休原因：并入人物条目');
  });

  it('关闭功能且库空时目录给一句说明；开启时提示可派工', () => {
    expect(renderAgentWebRefsCatalog_ACU(buildEmptyAgentModuleSnapshot_ACU(), false)).toContain('未启用');
    expect(renderAgentWebRefsCatalog_ACU(buildEmptyAgentModuleSnapshot_ACU(), true)).toContain('web-researcher');
    expect(renderAgentWebRefsByIds_ACU(buildEmptyAgentModuleSnapshot_ACU(), ['WR-009'])).toContain('不存在于百科资料库');
  });

  it('本地 search 的 modules 域能按资料详情命中百科条目并给出精读地址', () => {
    const snapshot = snapshotWith_ACU(entry_ACU());
    const result = runAgentSearch_ACU({ kind: 'search', query: '岩炮弹', scope: ['modules'], isRegex: false, maxResults: 10 }, resolveContext_ACU(snapshot) as any);
    expect(result).toContain('百科资料库 [WR-001]');
    expect(result).toContain('读取地址 $WEB_REFS:WR-001');
    const byDetail = runAgentSearch_ACU({ kind: 'search', query: '帝级土系魔术', scope: ['modules'], isRegex: false, maxResults: 10 }, resolveContext_ACU(snapshot) as any);
    expect(byDetail).toContain('读取地址 $WEB_REFS:WR-001');
  });
});

describe('百科资料库写集事务', () => {
  const upsert = (overrides: Partial<AgentResearcherOutput_ACU['items'][number]> = {}): AgentResearcherOutput_ACU['items'][number] => ({
    action: 'upsert', id: '', title: '洛琪希', source: 'moegirl', url: 'https://zh.moegirl.org.cn/洛琪希', query: '洛琪希', tags: ['人物'], brief: '鲁迪乌斯的家庭教师。', summary: '', extract: '原文', sourceStatus: 'ok', reason: '', ...overrides,
  });

  it('漏写 id 时按 WR-### 顺延分配，修订号 +1，不推进结算水位', () => {
    const snapshot = snapshotWith_ACU(entry_ACU());
    const next = applyAgentWebRefsDelta_ACU(snapshot, { summary: '', expectedRevision: 2, items: [upsert(), upsert({ title: '希露菲', url: 'https://x/2', brief: '青梅竹马。' })] }, 2, 99);
    expect(next.webRefs.map(item => item.id)).toEqual(['WR-001', 'WR-002', 'WR-003']);
    expect(next.revisions.webRefs).toBe(3);
    expect(next.settledThroughIndex).toBe(snapshot.settledThroughIndex);
    expect(next.webRefs[1]).toMatchObject({ title: '洛琪希', fetchedAt: 99, brief: '鲁迪乌斯的家庭教师。' });
    expect(nextAgentWebRefId_ACU(next.webRefs)).toBe('WR-004');
  });

  it('brief 为空、retire 不存在或无理由、修订号不一致都整份拒绝', () => {
    const snapshot = snapshotWith_ACU(entry_ACU());
    const rejects = (output: AgentResearcherOutput_ACU, expected?: number) => {
      try { applyAgentWebRefsDelta_ACU(snapshot, output, expected); } catch (error) { return (error as ContinuationValidationError_ACU).error.message; }
      return '';
    };
    expect(rejects({ summary: '', expectedRevision: 2, items: [upsert({ brief: '' })] }, 2)).toContain('一句话简介');
    expect(rejects({ summary: '', expectedRevision: 2, items: [{ ...upsert(), action: 'retire', id: 'WR-404', reason: 'x' }] }, 2)).toContain('不存在');
    expect(rejects({ summary: '', expectedRevision: 2, items: [{ ...upsert(), action: 'retire', id: 'WR-001', reason: '' }] }, 2)).toContain('理由');
    expect(rejects({ summary: '', expectedRevision: 1, items: [upsert()] }, 1)).toContain('revision 已变化');
  });

  it('对既有 id 重复 upsert 覆盖内容但保留首次入库时间', () => {
    const snapshot = snapshotWith_ACU(entry_ACU({ fetchedAt: 5 }));
    const next = applyAgentWebRefsDelta_ACU(snapshot, { summary: '', expectedRevision: undefined, items: [upsert({ id: 'WR-001', title: '鲁迪', brief: '新简介。' })] }, undefined, 50);
    expect(next.webRefs).toHaveLength(1);
    expect(next.webRefs[0]).toMatchObject({ title: '鲁迪', brief: '新简介。', fetchedAt: 5 });
  });
});

describe('web-researcher 协议', () => {
  it('出网工具批次可与本地 read/search 混排，来源别名归一', () => {
    const calls = parseAgentResearcherToolCalls_ACU('{"action":"encyclopedia_search","query":"鲁迪","sources":["萌娘百科","wikipedia"]}\n{"action":"read","reads":["$WEB_REFS"]}\n{"action":"web_read","url":"https://a.org"}', '');
    expect(calls).toEqual([
      { kind: 'encyclopedia_search', query: '鲁迪', sources: ['moegirl', 'wikipedia_zh'] },
      { kind: 'read', reads: ['$WEB_REFS'] },
      { kind: 'web_read', url: 'https://a.org' },
    ]);
    expect(parseAgentResearcherToolCalls_ACU('{"summary":"done","delta":{}}', '')).toBeNull();
    expect(() => parseAgentWebToolCall_ACU({ action: 'encyclopedia_read', source: 'nowhere', title: 'x' })).toThrow(/moegirl/);
  });

  it('契约：name 与 brief 是唯一固定字段，detail 自由（字符串或对象都收），缺 pageRef / name / brief 即拒绝', () => {
    const parsed = parseAgentResearcherOutput_ACU({
      summary: '查了两条',
      delta: { expectedRevisions: { webRefs: 2 }, webRefs: [
        { action: 'upsert', pageRef: 'P1', name: '鲁迪乌斯', brief: '主角', detail: { 身份: '贵族长男', 能力: '帝级魔术' } },
        { pageRef: 'p2', name: '泥沼', brief: '土系魔术', tags: ['法术'], summary: '限制行动' },
        { action: 'retire', id: 'WR-003', reason: '重复' },
      ] },
    });
    expect(parsed.expectedRevision).toBe(2);
    expect(parsed.items[0]).toMatchObject({ action: 'upsert', pageRef: 'P1', title: '鲁迪乌斯', brief: '主角' });
    expect(parsed.items[0].summary).toContain('贵族长男');
    expect(parsed.items[1]).toMatchObject({ action: 'upsert', pageRef: 'p2', title: '泥沼', tags: ['法术'], summary: '限制行动' });
    expect(parsed.items[2]).toMatchObject({ action: 'retire', id: 'WR-003', reason: '重复' });
    expect(() => parseAgentResearcherOutput_ACU({ delta: { webRefs: [{ name: 'x', brief: 'y' }] } })).toThrow(/pageRef/);
    expect(() => parseAgentResearcherOutput_ACU({ delta: { webRefs: [{ pageRef: 'P1', brief: 'y' }] } })).toThrow(/name/);
    expect(() => parseAgentResearcherOutput_ACU({ delta: { webRefs: [{ pageRef: 'P1', name: 'x' }] } })).toThrow(/brief/);
  });
});

describe('目录按开关显隐', () => {
  it('web-researcher 与 $WEB_REFS 只在功能开启（或库里已有条目）时出现在主 Agent 目录里', () => {
    expect(renderAgentSubagentCatalog_ACU()).not.toContain('web-researcher');
    expect(renderAgentSubagentCatalog_ACU({ webResearchEnabled: true })).toContain('name: web-researcher');
    expect(renderAgentModuleCatalog_ACU()).not.toContain('$WEB_REFS');
    expect(renderAgentModuleCatalog_ACU({ webResearchEnabled: true })).toContain('$WEB_REFS');
    expect(renderAgentModuleCatalog_ACU({ webRefsPresent: true })).toContain('$WEB_REFS');
  });
});
