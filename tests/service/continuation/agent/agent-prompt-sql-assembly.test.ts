import { describe, expect, it } from 'vitest';
import {
  buildDefaultContinuationSettings_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V52_ACU,
} from '../../../../src/service/continuation/defaults';
import { buildV33ContinuationAgentPrompts_ACU } from '../../../../src/service/continuation/agent/agent-defaults';
import { validateContinuationSettings_ACU } from '../../../../src/service/continuation/continuation-store';
import { renderContinuationPrompt_ACU, restoreContinuationPromptDefault_ACU } from '../../../../src/service/continuation/prompt-template';

const writers = ['arcArchitect', 'maintainer', 'webResearcher'] as const;
const sqlWriters = ['arcArchitect', 'webResearcher'] as const;

async function sentPrompt(role: typeof writers[number], settings = buildDefaultContinuationSettings_ACU()) {
  const rendered = await renderContinuationPrompt_ACU(settings.agentPrompts[role], {}, 'agent_delegate');
  return rendered.messages.map(message => message.content).join('\n');
}

function expectSqlWriterContract(text: string) {
  expect(text).toContain('"sql"');
  expect(text).toContain('INSERT INTO');
  expect(text).toContain('UPDATE');
  expect(text).toContain('DELETE');
  expect(text).not.toMatch(/"delta"\s*:|delta\.chronology|"action"\s*:\s*"(?:upsert|retire|patch)|expectedRevisions/);
}

function expectMaintainerSubmitContract(text: string) {
  expect(text).toContain('"summary":"本次结算、轮目标达成度与尚存缺口","delta":{"hooks":[],"infoGap":[],"chronology":[],"constraintProposals":[]}');
  expect(text).toContain('优先一次交付 summary + delta');
  expect(text).toContain('delta 只含 hooks、infoGap、chronology 的变化条目及 constraintProposals 文本数组');
  expect(text).toContain('action 为 upsert、patch 或 retire');
  for (const field of ['plantedIndex', 'objectiveFact', 'readerKnown', 'characterKnowledge', 'revealStatus', 'revealIndex', 'evidenceIndexes']) {
    expect(text).toContain(field);
  }
  expect(text).toContain('summary 本身不是保存证明');
  expect(text).toContain('读取与交付不混在同一回复');
  expect(text).toContain('收到回执后单独输出最终交付 summary');
  expect(text).not.toContain('"summary":"本次结算、轮目标达成度与尚存缺口","sql"');
  expect(text).toContain('兼容路径：写入时单独输出 {"action":"write_sql","sql":"全部受限 SQL"}');
}

describe('续写维护代理最终组装的写集提示', () => {
  it.each(sqlWriters)('%s 仍只要求在 JSON 的 sql 字段提交受限 SQL DML', async role => {
    expectSqlWriterContract(await sentPrompt(role));
  });

  it('维护者最终交付 summary + delta，保留独立 write_sql 兼容路径', async () => {
    expectMaintainerSubmitContract(await sentPrompt('maintainer'));
  });

  it('维护者年代学要求完整时间字段、真实正文证据、模糊精度和退役理由', async () => {
    const text = await sentPrompt('maintainer');
    expect(text).toContain('chronology：anchor、elapsed、precision、transition、evidenceIndexes');
    expect(text).toContain('真实楼层号取正文标注');
    expect(text).toContain('新增事实必须有真实正文依据');
    expect(text).toContain('precision 为 exact、approximate 或 unknown');
    expect(text).toContain('正文只说「数日后」就用 approximate');
    expect(text).toContain('退役用 retire，带真实 id 与非空 reason');
    expect(text).toContain('漏写既有条目不等于删除');
  });

  it('V33 旧配置读出时整组严格重置为 V52 默认，清除自定义和追加段；恢复默认仍为 V52', async () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.promptForceDefaultVersion = 'spv4.1-continuation-sql-dml-v33';
    settings.agentPrompts = buildV33ContinuationAgentPrompts_ACU();
    const custom = settings.agentPrompts.maintainer.find(segment => segment.content.startsWith('我的边界有五条：'))!;
    custom.content += '\n用户定制：保留此段。';
    const extra = { role: 'user', content: '用户添加的额外段', enabled: true, deletable: true };
    settings.agentPrompts.webResearcher.push(extra);

    const migrated = validateContinuationSettings_ACU(settings);
    const defaults = buildDefaultContinuationSettings_ACU();
    expect(migrated.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V52_ACU);
    expect(migrated.agentPrompts).toEqual(defaults.agentPrompts);
    expect(await sentPrompt('maintainer', migrated)).not.toContain('用户定制：保留此段。');
    expect(await sentPrompt('webResearcher', migrated)).not.toContain('用户添加的额外段');
    expectMaintainerSubmitContract(await sentPrompt('maintainer', migrated));
    for (const role of sqlWriters) expectSqlWriterContract(await sentPrompt(role, migrated));

    const restored = restoreContinuationPromptDefault_ACU(migrated, 'agent_maintainer');
    expect(restored.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V52_ACU);
    expect(restored.agentPrompts.maintainer).toEqual(defaults.agentPrompts.maintainer);
    expectMaintainerSubmitContract(await sentPrompt('maintainer', restored));
  });
});
