import { describe, expect, it } from 'vitest';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { buildV33ContinuationAgentPrompts_ACU } from '../../../../src/service/continuation/agent/agent-defaults';
import { validateContinuationSettings_ACU } from '../../../../src/service/continuation/continuation-store';
import { renderContinuationPrompt_ACU, restoreContinuationPromptDefault_ACU } from '../../../../src/service/continuation/prompt-template';

const writers = ['arcArchitect', 'maintainer', 'webResearcher'] as const;

async function sentPrompt(role: typeof writers[number], settings = buildDefaultContinuationSettings_ACU()) {
  const rendered = await renderContinuationPrompt_ACU(settings.agentPrompts[role], {}, 'agent_delegate');
  return rendered.messages.map(message => message.content).join('\n');
}

describe('续写维护代理最终组装的 SQL 写集提示', () => {
  it.each(writers)('%s 只要求在 JSON 的 sql 字段提交受限 SQL DML', async role => {
    const text = await sentPrompt(role);
    expect(text).toContain('"sql"');
    expect(text).toContain('INSERT INTO');
    expect(text).toContain('UPDATE');
    expect(text).toContain('DELETE');
    expect(text).not.toMatch(/"delta"\s*:|delta\.chronology|"action"\s*:\s*"(?:upsert|retire|patch)|expectedRevisions/);
  });

  it('年代学段仍要求真实正文证据、模糊时间精度和显式删除理由', async () => {
    const text = await sentPrompt('maintainer');
    expect(text).toContain('UPDATE chronology');
    expect(text).toContain('DELETE FROM chronology');
    expect(text).toContain('evidence_indexes');
    expect(text).toContain('approximate');
    expect(text).toContain('DELETE 必须给出理由');
  });

  it('V33 旧默认逐段升级，自定义和追加段原样保留；恢复默认使用 V34', async () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.promptForceDefaultVersion = 'spv4.1-continuation-sql-dml-v33';
    settings.agentPrompts = buildV33ContinuationAgentPrompts_ACU();
    const custom = settings.agentPrompts.maintainer.find(segment => segment.content.startsWith('我的边界有五条：'))!;
    custom.content += '\n用户定制：保留此段。';
    const extra = { role: 'user', content: '用户添加的额外段', enabled: true, deletable: true };
    settings.agentPrompts.webResearcher.push(extra);
    const migrated = validateContinuationSettings_ACU(settings);
    expect(migrated.agentPrompts.maintainer).toContainEqual(custom);
    expect(migrated.agentPrompts.webResearcher).toContainEqual(extra);
    for (const role of writers) expect(await sentPrompt(role, migrated)).not.toMatch(/"delta"\s*:|delta\.chronology|expectedRevisions/);
    const restored = restoreContinuationPromptDefault_ACU(migrated, 'agent_maintainer');
    expect(await sentPrompt('maintainer', restored)).toContain('UPDATE chronology');
  });
});
