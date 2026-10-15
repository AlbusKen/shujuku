import { describe, expect, it } from 'vitest';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { buildV33ContinuationAgentPrompts_ACU } from '../../../../src/service/continuation/agent/agent-defaults';
import { validateContinuationSettings_ACU } from '../../../../src/service/continuation/continuation-store';
import { renderContinuationPrompt_ACU, restoreContinuationPromptDefault_ACU } from '../../../../src/service/continuation/prompt-template';

const writers = ['arcArchitect', 'webResearcher'] as const;

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

  // maintainer 使用 summary + delta；保存与年代学校验由 agent-subagent-runtime / agent-protocol 测试覆盖。
  it('V33 旧配置读出时整组重置为当前默认，自定义和追加段一并换掉；恢复默认仍是当前默认', () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.promptForceDefaultVersion = 'spv4.1-continuation-sql-dml-v33';
    settings.agentPrompts = buildV33ContinuationAgentPrompts_ACU();
    const custom = settings.agentPrompts.maintainer.find(segment => segment.content.startsWith('我的边界有五条：'))!;
    custom.content += '\n用户定制：保留此段。';
    const extra = { role: 'user', content: '用户添加的额外段', enabled: true, deletable: true };
    settings.agentPrompts.webResearcher.push(extra);
    const migrated = validateContinuationSettings_ACU(settings);
    const defaults = buildDefaultContinuationSettings_ACU().agentPrompts;
    expect(migrated.agentPrompts).toEqual(defaults);
    migrated.agentPrompts.maintainer.push({ ...extra });
    const beforeRestore = structuredClone(migrated.agentPrompts.maintainer);
    const restored = restoreContinuationPromptDefault_ACU(migrated, 'agent_maintainer');
    expect(restored.agentPrompts.maintainer).toEqual(defaults.maintainer);
    expect(restored.agentPrompts.webResearcher).toEqual(defaults.webResearcher);
    expect(migrated.agentPrompts.maintainer).toEqual(beforeRestore);
  });
});
