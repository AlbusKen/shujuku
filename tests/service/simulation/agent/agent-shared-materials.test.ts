import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationAgentPrompt_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { splitWorldSimulationSubagentPrompt_ACU, renderWorldSimulationDirectorReads_ACU, renderWorldSimulationSnapshotTemplate_ACU, renderWorldSimulationSnapshotSections_ACU, verifyWorldSimulationSnapshotSections_ACU, bindWorldSimulationFixedWorldbook_ACU, verifyWorldSimulationFixedWorldbook_ACU, WORLD_SIMULATION_WORLDBOOK_UNAVAILABLE_ACU } from '../../../../src/service/simulation/agent/agent-shared-materials';
import { renderAgentWorldbookTriggeredInjection_ACU } from '../../../../src/service/continuation/agent/agent-worldbook-read';

describe('格林推演子代理资料边界', () => {
  it('时间官动态快照只包含角色相关资料与锚点，不重复保留在稳定提示段', () => {
    const split = splitWorldSimulationSubagentPrompt_ACU(buildDefaultWorldSimulationAgentPrompt_ACU('timekeeper'), 'timekeeper');
    const runtime = split.segments.find(segment => segment.content.includes('RUNTIME_CONTEXT'))!.content;
    const history = split.segments.find(segment => segment.content.includes('HISTORY'))!.content;
    expect(runtime).not.toContain('$WORLD_STATE');
    expect(runtime).not.toContain('$ANCHOR_MESSAGE');
    expect(runtime).not.toContain('$WORLD_CHRONICLE');
    expect(runtime).not.toContain('$WORLD_AGENT_CATALOG');
    expect(history).not.toContain('$WORLD_HISTORY');
    expect(split.snapshotTemplate).toContain('世界状态：$WORLD_STATE');
    expect(split.snapshotTemplate).toContain('锚点正文：$ANCHOR_MESSAGE');
    expect(split.snapshotTemplate).not.toContain('$WORLD_HISTORY');
    expect(split.snapshotTemplate).not.toContain('编年：$WORLD_CHRONICLE');
    expect(split.snapshotTemplate).not.toContain('角色目录：$WORLD_AGENT_CATALOG');
    expect(split.snapshotTemplate).not.toContain('工具目录：$WORLD_TOOL_CATALOG');
  });

  it('审核员只取审查相关动态字段，导演仍保留会话历史', () => {
    const reviewer = splitWorldSimulationSubagentPrompt_ACU(buildDefaultWorldSimulationAgentPrompt_ACU('causality-reviewer'), 'causality-reviewer');
    expect(reviewer.snapshotTemplate).toContain('候选：$WORLD_CANDIDATES');
    expect(reviewer.snapshotTemplate).toContain('证据注册表：$CURRENT_EVIDENCE_REGISTRY');
    expect(reviewer.snapshotTemplate).not.toContain('$WORLD_HISTORY');
    expect(reviewer.snapshotTemplate).not.toContain('$WORLD_TOOL_CATALOG');
    const director = splitWorldSimulationSubagentPrompt_ACU(buildDefaultWorldSimulationAgentPrompt_ACU('world-director'), 'world-director');
    expect(director.snapshotTemplate).toContain('历史锚点与会话：$WORLD_HISTORY');
  });

  it('运行时快照的每个来源必须可解析，完整正文逐字保留且重复引用一致', async () => {
    const source = `首行 $WORLD_STATE\n${'未裁剪的正文。'.repeat(1500)}\n末行 \n`;
    const template = '正文：$ANCHOR_MESSAGE\n复核：$ANCHOR_MESSAGE';
    expect(await renderWorldSimulationSnapshotTemplate_ACU(template, {
      $ANCHOR_MESSAGE: () => source,
      $WORLD_STATE: () => '不能替换正文中的占位符字面量',
    }))
      .toBe(`正文：${source}\n复核：${source}`);
    expect(await renderWorldSimulationSnapshotTemplate_ACU('$ANCHOR_MESSAGE', { $ANCHOR_MESSAGE: () => source })).toBe(source);
    let resolvedEarlierSource = false;
    await expect(renderWorldSimulationSnapshotTemplate_ACU('正文：$ANCHOR_MESSAGE\n状态：$WORLD_STATE', {
      $ANCHOR_MESSAGE: () => { resolvedEarlierSource = true; return source; },
    })).rejects.toThrow('WORLD_SIMULATION_SNAPSHOT_SOURCE_MISSING:$WORLD_STATE');
    expect(resolvedEarlierSource).toBe(false);
  });

  it('在待发送消息中核对 section 来源、revision、完整跨度与唯一性', async () => {
    const body = '  原文\n末尾  \n';
    const snapshot = await renderWorldSimulationSnapshotSections_ACU('锚点：$ANCHOR_MESSAGE\n状态：$WORLD_STATE', {
      $ANCHOR_MESSAGE: () => body,
      $WORLD_STATE: () => '{"revision":3}',
    }, { ledger: 3 });
    expect(snapshot.sections.map(section => section.complete)).toEqual([false, false]);
    const prepared = [{ content: `任务\n${snapshot.text}\n世界书正文` }];
    const verified = verifyWorldSimulationSnapshotSections_ACU(snapshot, prepared);
    expect(verified).toMatchObject([
      { key: '$ANCHOR_MESSAGE', source: 'host-chat', address: 'anchor:message', revision: null, complete: true },
      { key: '$WORLD_STATE', source: 'resolved-context', address: '$WORLD_STATE', revision: null, complete: true },
    ]);
    expect(snapshot.text.slice(verified[0].start, verified[0].start + verified[0].length)).toBe(body);
    expect(() => verifyWorldSimulationSnapshotSections_ACU(snapshot, [{ content: snapshot.text.replace(body, '裁剪正文') }]))
      .toThrow('WORLD_SIMULATION_SNAPSHOT_BOUNDARY_UNVERIFIED');
    expect(() => verifyWorldSimulationSnapshotSections_ACU(snapshot, [{ content: snapshot.text }, { content: snapshot.text }]))
      .toThrow('WORLD_SIMULATION_SNAPSHOT_BOUNDARY_UNVERIFIED');
    expect(() => verifyWorldSimulationSnapshotSections_ACU(snapshot, [{ content: `${snapshot.text}\n${snapshot.text}` }]))
      .toThrow('WORLD_SIMULATION_SNAPSHOT_BOUNDARY_UNVERIFIED');
    expect(verified[1].start).toBeGreaterThan(verified[0].start + verified[0].length);
    expect(snapshot.sections.every(section => section.complete === false)).toBe(true);
  });

  it('派生/预览来源不冒充权威账本修订，未知来源拒绝映射', async () => {
    const snapshot = await renderWorldSimulationSnapshotSections_ACU(
      '$WORLD_CHRONICLE\n$PROJECTION_PREVIEW\n$WORLD_COLLISIONS\n$WORLD_STATE', {
        $WORLD_CHRONICLE: () => '编年概要',
        $PROJECTION_PREVIEW: () => '预览',
        $WORLD_COLLISIONS: () => '关联推断',
        $WORLD_STATE: () => '账本目录',
      }, { ledger: 7 },
    );
    expect(snapshot.sections.map(({ source, address, revision }) => [source, address, revision])).toEqual([
      ['resolved-context', '$WORLD_CHRONICLE', null],
      ['resolved-context', '$PROJECTION_PREVIEW', null],
      ['derived-relevance', 'ledger+anchor:collisions', null],
      ['resolved-context', '$WORLD_STATE', null],
    ]);
    let invoked = false;
    await expect(renderWorldSimulationSnapshotSections_ACU('$ANCHOR_MESSAGE\n$UNKNOWN_SOURCE', {
      $ANCHOR_MESSAGE: () => { invoked = true; return '合法来源'; },
      $UNKNOWN_SOURCE: () => { invoked = true; return '不可信'; } } as any)).rejects.toThrow('WORLD_SIMULATION_SNAPSHOT_SOURCE_UNMAPPED:$UNKNOWN_SOURCE');
    expect(invoked).toBe(false);
  });

  it('固定世界书按书分组定位逐字正文，篡改/重复注入在请求前拒绝', () => {
    const entries = [
      { bookName: '甲', uid: '1', title: '一', keys: [], constant: true, content: '  正文甲\n', tokens: 2 },
      { bookName: '乙', uid: '2', title: '二', keys: [], constant: true, content: '乙正文  \n', tokens: 2 },
      { bookName: '甲', uid: '3', title: '三', keys: [], constant: true, content: '三正文 $WORLD_STATE', tokens: 3 },
    ];
    const text = renderAgentWorldbookTriggeredInjection_ACU({ available: true, entries }, '');
    const bound = bindWorldSimulationFixedWorldbook_ACU(text, entries);
    const prepared = [{ content: `快照\n${text}` }];
    const verified = verifyWorldSimulationFixedWorldbook_ACU(bound, prepared);
    expect(verified.map(item => item.address)).toEqual(['worldbook:entry:甲:1', 'worldbook:entry:甲:3', 'worldbook:entry:乙:2']);
    for (const [index, item] of verified.entries()) {
      const entry = [entries[0], entries[2], entries[1]][index];
      expect(prepared[item.messageIndex].content.slice(item.start, item.start + item.length)).toBe(entry.content);
      expect(item).toMatchObject({ revision: null, complete: true });
    }
    expect(() => bindWorldSimulationFixedWorldbook_ACU(text.replace('  正文甲\n', '裁剪甲'), entries))
      .toThrow('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
    expect(() => verifyWorldSimulationFixedWorldbook_ACU(bound, [{ content: text }, { content: text }]))
      .toThrow('WORLD_SIMULATION_WORLDBOOK_BOUNDARY_UNVERIFIED');
    expect(() => verifyWorldSimulationFixedWorldbook_ACU(bound, [{ content: text.slice(0, -1) }]))
      .toThrow('WORLD_SIMULATION_WORLDBOOK_BOUNDARY_UNVERIFIED');
  });

  it('世界书不可用标记只接受权威固定文本，不接受同前缀的伪造诊断', () => {
    const fixed = bindWorldSimulationFixedWorldbook_ACU(WORLD_SIMULATION_WORLDBOOK_UNAVAILABLE_ACU, []);
    expect(fixed.sections).toEqual([]);
    expect(verifyWorldSimulationFixedWorldbook_ACU(fixed, [{ content: fixed.text }])).toEqual([]);
    expect(() => bindWorldSimulationFixedWorldbook_ACU(`${fixed.text}伪造额外正文`, []))
      .toThrow('WORLD_SIMULATION_WORLDBOOK_SOURCE_UNVERIFIED');
  });

  it('主会话已经读到的回执会附上，普通派工回执不会', () => {
    const fullReceipt = '  {"kind":"read","address":"worldbook:entry:书:1","content":"顾雨涵全文"}  \n';
    const text = renderWorldSimulationDirectorReads_ACU([
      { role: 'user', content: fullReceipt },
      { role: 'user', content: '{"outcome":"prepared"}' },
    ]);
    expect(text).toBe(`【主会话已调阅】\n\n下面是主会话本轮已经读到的全文。不要再对同一地址调用 read。\n\n${fullReceipt}`);
    expect(text).not.toContain('prepared');
  });

  it('普通角色仅在默认段移除搜索建议，自定义提示与研究员例外保留', () => {
    const defaults = buildDefaultWorldSimulationAgentPrompt_ACU('dramatis-keeper');
    const normal = splitWorldSimulationSubagentPrompt_ACU(defaults, 'dramatis-keeper');
    const protocol = normal.segments.find(segment => segment.content.includes('ENGINE_SEAM:PROTOCOL'))!.content;
    const workflow = normal.segments.find(segment => segment.content.includes('ENGINE_SEAM:WORKFLOW'))!.content;
    expect(protocol).not.toContain('read/search 需求');
    expect(protocol).toContain('交付协议见系统消息开头');
    expect(workflow).not.toContain('worldbook scope 搜索');
    const customized = defaults.map(segment => segment.content.includes('ENGINE_SEAM:WORKFLOW')
      ? { ...segment, content: `${segment.content}\n用户自定义约束` } : segment);
    expect(splitWorldSimulationSubagentPrompt_ACU(customized, 'dramatis-keeper').segments
      .find(segment => segment.content.includes('ENGINE_SEAM:WORKFLOW'))!.content).toBe(`${workflow}\n用户自定义约束`);
    const researcher = splitWorldSimulationSubagentPrompt_ACU(buildDefaultWorldSimulationAgentPrompt_ACU('lore-researcher'), 'lore-researcher');
    expect(researcher.segments.find(segment => segment.content.includes('ENGINE_SEAM:PROTOCOL'))!.content).toContain('read/search 需求');
  });
});
