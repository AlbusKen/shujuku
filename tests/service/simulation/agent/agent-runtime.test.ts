import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU, buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { buildDefaultWorldSimulationAgentPrompts_ACU, WORLD_SIMULATION_AGENT_PREFILLS_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import { WorldSimulationSubagentRuntime_ACU } from '../../../../src/service/simulation/agent/agent-subagent-runtime';
import { WorldSimulationMainLoop_ACU } from '../../../../src/service/simulation/agent/agent-main-loop';
import { WorldSimulationRunWriteState_ACU, readWorldSimulationRunWriteProof_ACU } from '../../../../src/service/simulation/simulation-run-write-state';
import { commitWorldSimulationFieldWrites_ACU } from '../../../../src/service/simulation/simulation-commit-adapter';
import { foldWorldSimulationLedger_ACU, foldWorldSimulationArchive_ACU, readWorldSimulationLedgerFieldSnapshot_ACU } from '../../../../src/service/simulation/simulation-ledger-fold';
import { createWorldSimulationToolDependencies_ACU } from '../../../../src/service/simulation/world-simulation-agent-tools';
import { WORLD_SIMULATION_STATE_FIELD_ACU } from '../../../../src/service/simulation/agent/agent-model';
import { readWorldSimulationRunState_ACU, resetWorldSimulationRunCacheForTests_ACU, saveWorldSimulationRunState_ACU } from '../../../../src/service/simulation/agent/agent-run-cache';
import { resolveWorldSimulationAnchor_ACU } from '../../../../src/service/simulation/simulation-store';
import { appendWorldSimulationDirectorHistory_ACU, appendWorldSimulationSessionEvent_ACU, readWorldSimulationDirectorCompactionSource_ACU, readWorldSimulationDirectorHistory_ACU, readWorldSimulationConversation_ACU } from '../../../../src/service/simulation/agent/agent-conversation-store';
import { persistWorldSimulationRunState_ACU } from '../../../../src/service/simulation/agent/agent-run-state-store';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';
import { readWorldSimulationSessionLog_ACU, resetWorldSimulationSessionLogForTests_ACU } from '../../../../src/service/simulation/agent/agent-session-log';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';

const apiPreset = { resolvePreset: () => ({ resolved: true, apiMode: 'openai' as any, apiConfig: {} as any, tavernProfile: '' }) };
const tools = { read: vi.fn(async () => ({ status: 'empty' as const, summary: 'empty' })), search: vi.fn(async () => ({ status: 'empty' as const, hits: [], summary: 'empty' })) };
const settings = () => ({ ...buildDefaultWorldSimulationSettings_ACU(), agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU(), agentRunBudget: { maxIterations: 3, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1 } });
function fixture(runId = 'runtime') {
  const registry = createWorldSimulationEvidenceRegistry_ACU(runId);
  const evidence = recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'anchor:message', status: 'ok', summary: '锚点', exact: true }).evidenceRef!;
  const promptContext = { task: {}, history: [], runtimeContext: {}, agentCatalog: [], toolCatalog: [], evidence: [], userGuidance: '', worldState: buildEmptyWorldSimulationLedger_ACU(), anchorMessage: '正文', anchorIdentity: {}, worldStagePlan: {}, worldChronicle: [], worldCandidates: [], worldCollisions: { playerRegion: null, playerContact: 'open' as const, secludedNote: null, collidedSeeds: [], ripeRumors: [] }, evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(registry), projectionPreview: {} };
  return { registry, evidence, promptContext, runId };
}

describe('世界推演 Agent runtime', () => {
  beforeEach(() => { resetWorldSimulationRunCacheForTests_ACU(); resetWorldSimulationSessionLogForTests_ACU(); vi.clearAllMocks(); });

  it('锚定主会话第二次请求见首次 read 原文，重启后不会从展示卡片重复投影', async () => {
    const { registry, promptContext } = fixture('director-history');
    const chat: any[] = [{ message_id: 1, mes: '正文原文', swipe_id: 0 }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-director-history', getCurrentChatId: () => 'chat-director-history', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const identity = { runId: 'director-history', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
      anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-history', stageId: 'stage-history', stageRevision: 1 };
    const read = JSON.stringify({ action: 'read', reads: ['anchor:message'] });
    const blocked = JSON.stringify({ action: 'block', reason: '待续', unresolved: ['稍后继续'] });
    const sent: Array<readonly { role: string; content: string }[]> = [];
    const invoke = vi.fn(async (_role, messages) => { sent.push(messages); return sent.length === 1 ? read : blocked; });
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset, countTokens: async () => 1 });
    const result = await loop.run({ identity, anchor, chat, settings: settings(), promptContext, registry,
      tools: { read: vi.fn(async () => ({ status: 'ok' as const, content: '已读完整正文', summary: '正文' })), search: tools.search },
      persistSessionEvent: async () => undefined });
    expect(result.outcome).toBe('blocked');
    expect(sent).toHaveLength(2);
    expect(sent[1].filter(item => item.content === read)).toHaveLength(1);
    expect(sent[1].filter(item => item.content.includes('已读完整正文'))).toHaveLength(1);
    expect(readWorldSimulationDirectorHistory_ACU(chat)).toEqual([
      { role: 'assistant', content: read, tool_calls: [{ id: 'call_0_read', type: 'function', function: { name: 'read', arguments: '{"reads":["anchor:message"]}' } }] },
      { role: 'tool', tool_call_id: 'call_0_read', content: expect.stringContaining('已读完整正文') },
      { role: 'assistant', content: blocked }, { role: 'user', content: expect.stringContaining('\"outcome\":\"blocked\"') },
    ]);
    expect(readWorldSimulationConversation_ACU(chat).messages.filter(item => item.kind === 'model_agent')).toHaveLength(2);
    resetWorldSimulationRunCacheForTests_ACU();
    const freshSent: Array<readonly { role: string; content: string }[]> = [];
    const fresh = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async (_role, messages) => {
      freshSent.push(messages); return JSON.stringify({ action: 'block', reason: '暂停', unresolved: ['待用户'] });
    }), subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset, countTokens: async () => 1 });
    await fresh.run({ identity, anchor, chat, settings: settings(), promptContext, registry, tools, persistSessionEvent: async () => undefined });
    expect(freshSent[0].filter(item => item.content === read)).toHaveLength(1);
    expect(freshSent[0].filter(item => item.content.includes('已读完整正文'))).toHaveLength(1);
    expect(freshSent[0].some(item => item.content.includes('主 Agent 正在读取资料'))).toBe(false);
  });

  it('最终完整请求超阈值才持久总结旧完整动作/回执，重启不重复且撤销楼层可恢复原文', async () => {
    const { registry, promptContext } = fixture('director-compaction');
    const chat: any[] = [
      { message_id: 1, mes: '旧正文', swipe_id: 0 },
      { message_id: 2, mes: '当前正文 A', swipe_id: 0, swipes: ['当前正文 A', '当前正文 B'] },
    ];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-director-compaction', getCurrentChatId: () => 'chat-director-compaction', saveChat } as any);
    const first = resolveWorldSimulationAnchor_ACU(0, chat);
    const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const identity = { runId: 'director-compaction', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
      anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-compaction', stageId: 'stage-compaction', stageRevision: 1 };
    const oldRead = JSON.stringify({ action: 'read', reads: ['anchor:message'], note: 'OLD_READ' });
    const oldReceipt = `OLD_RECEIPT:${'R'.repeat(100000)}`;
    const pairs = [{ role: 'assistant' as const, content: oldRead }, { role: 'user' as const, content: oldReceipt },
      ...Array.from({ length: 4 }, (_, index) => [
        { role: 'assistant' as const, content: `RECENT_ACTION_${index}` },
        { role: 'user' as const, content: `RECENT_RECEIPT_${index}` },
      ]).flat()];
    await appendWorldSimulationDirectorHistory_ACU({ anchor: first, runId: identity.runId, taskId: identity.taskId,
      stageId: identity.stageId, stageRevision: identity.stageRevision, messages: pairs }, chat);
    await appendWorldSimulationSessionEvent_ACU({ anchor, runId: identity.runId, taskId: identity.taskId,
      stageId: identity.stageId, stageRevision: identity.stageRevision, eventKey: 'current-start',
      event: { kind: 'run_started', title: '本轮开始', detail: '模型不可见的展示事件' } }, chat);
    const requested = JSON.stringify({ action: 'block', reason: '等下轮', unresolved: ['下一正文'] });
    const invoke = vi.fn(async () => requested);
    const runSettings = { ...settings(), agentHistoryTokenBudget: 9000 };
    const countTokens = async (text: string) => Math.ceil(text.length / 10);
    const run = () => new WorldSimulationMainLoop_ACU({ invoke, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset, countTokens })
      .run({ identity, anchor, chat, settings: runSettings, promptContext, registry, tools, persistSessionEvent: async () => undefined });
    await run();
    const sent = invoke.mock.calls[0][1] as readonly { role: string; content: string }[];
    expect(sent.some(item => item.content === oldRead || item.content === oldReceipt)).toBe(false);
    expect(sent.filter(item => item.content.includes('更早世界推演会话交接'))).toHaveLength(1);
    for (let index = 0; index < 4; index += 1) {
      expect(sent.filter(item => item.content === `RECENT_ACTION_${index}`)).toHaveLength(1);
      expect(sent.filter(item => item.content === `RECENT_RECEIPT_${index}`)).toHaveLength(1);
    }
    const source = readWorldSimulationDirectorCompactionSource_ACU(chat);
    expect(source.view.compaction).toMatchObject({ compactedThroughId: 2 });
    expect(source.view.messages[0].text).toContain('anchor:message');
    const raw = Object.values(chat[0]._qrf_world_simulation_agent_chat.entries)[0] as any;
    expect(raw.value.segments[0].messages.map((item: { text: string }) => item.text)).toEqual(pairs.map(item => item.content));
    resetWorldSimulationRunCacheForTests_ACU();
    invoke.mockClear();
    await run();
    const restarted = invoke.mock.calls[0][1] as readonly { role: string; content: string }[];
    expect(restarted.filter(item => item.content === source.view.compaction!.report)).toHaveLength(1);
    expect(restarted.filter(item => item.content === oldReceipt)).toHaveLength(0);
    expect(restarted.filter(item => item.content === 'RECENT_ACTION_3')).toHaveLength(1);
    resetWorldSimulationRunCacheForTests_ACU();
    invoke.mockClear();
    await run();
    const third = invoke.mock.calls[0][1] as readonly { role: string; content: string }[];
    expect(third.filter(item => item.content === source.view.compaction!.report)).toHaveLength(1);
    expect(third.filter(item => item.content === 'RECENT_ACTION_3')).toHaveLength(1);
    chat[1].swipe_id = 1;
    chat[1].mes = '当前正文 B';
    expect(readWorldSimulationDirectorHistory_ACU(chat).some(item => item.content === oldReceipt)).toBe(true);
    _set_SillyTavern_API_ACU(undefined);
  });

  it('压缩标记已保存而 run-state 随后保存失败，重启仍以楼层 handoff 为权威', async () => {
    const { registry, promptContext } = fixture('mark-run-fail');
    const chat: any[] = [{ message_id: 1, mes: '旧正文', swipe_id: 0 }, { message_id: 2, mes: '新正文', swipe_id: 0 }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-mark-run-fail', getCurrentChatId: () => 'chat-mark-run-fail', saveChat } as any);
    const oldAnchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const identity = { runId: 'mark-run-fail', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
      anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-mark-run-fail', stageId: 'stage-mark-run-fail', stageRevision: 1 };
    await appendWorldSimulationDirectorHistory_ACU({ anchor: oldAnchor, runId: identity.runId, taskId: identity.taskId,
      stageId: identity.stageId, stageRevision: 1, messages: [
        { role: 'assistant', content: 'OLD_ACTION' }, { role: 'user', content: 'Z'.repeat(100000) },
        ...Array.from({ length: 4 }, (_, index) => [
          { role: 'assistant' as const, content: `RECENT_ACTION_${index}` },
          { role: 'user' as const, content: `RECENT_RESULT_${index}` },
        ]).flat(),
      ] }, chat);
    await appendWorldSimulationSessionEvent_ACU({ anchor, runId: identity.runId, taskId: identity.taskId,
      stageId: identity.stageId, stageRevision: 1, eventKey: 'start',
      event: { kind: 'run_started', title: 'start', detail: 'pending' } }, chat);
    const blocked = JSON.stringify({ action: 'block', reason: '等待', unresolved: ['下一次'] });
    const countTokens = async (text: string) => Math.ceil(text.length / 10);
    const runSettings = { ...settings(), agentHistoryTokenBudget: 9000 };
    const invoke = vi.fn(async () => blocked);
    saveChat.mockImplementation(async () => {
      if (chat[1]._qrf_world_simulation_agent_run) throw new Error('RUN_STATE_SAVE_FAILED_AFTER_MARK');
    });
    const run = () => new WorldSimulationMainLoop_ACU({ invoke, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset, countTokens })
      .run({ identity, anchor, chat, settings: runSettings, promptContext, registry, tools, persistSessionEvent: async () => undefined });
    await expect(run()).rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_PERSIST_FAILED' } });
    const mark = readWorldSimulationDirectorCompactionSource_ACU(chat).view.compaction;
    expect(mark).toMatchObject({ compactedThroughId: 2 });
    expect(chat[1]._qrf_world_simulation_agent_run).toBeUndefined();
    expect(readWorldSimulationDirectorHistory_ACU(chat).some(item => item.content === blocked)).toBe(true);
    resetWorldSimulationRunCacheForTests_ACU();
    saveChat.mockResolvedValue(undefined);
    invoke.mockClear();
    await run();
    const request = invoke.mock.calls[0][1] as readonly { content: string }[];
    expect(request.filter(item => item.content === mark!.report)).toHaveLength(1);
    expect(request.some(item => item.content === 'OLD_ACTION')).toBe(false);
    expect(request.filter(item => item.content === blocked)).toHaveLength(1);
    _set_SillyTavern_API_ACU(undefined);
  });

  it('旧回执不够大而最终骨架超限时不伪压缩，拒发且保留原始回执', async () => {
    const { registry, promptContext } = fixture('director-overflow');
    const chat: any[] = [{ message_id: 1, mes: '正文', swipe_id: 0 }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-director-overflow', getCurrentChatId: () => 'chat-director-overflow', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const identity = { runId: 'director-overflow', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
      anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-overflow', stageId: 'stage-overflow', stageRevision: 1 };
    const read = JSON.stringify({ action: 'read', reads: ['anchor:message'] });
    const receipt = 'read result, do not truncate';
    await appendWorldSimulationDirectorHistory_ACU({ anchor, runId: identity.runId, taskId: identity.taskId,
      stageId: identity.stageId, stageRevision: 1,
      messages: [{ role: 'assistant', content: read }, { role: 'user', content: receipt }] }, chat);
    const invoke = vi.fn();
    await expect(new WorldSimulationMainLoop_ACU({ invoke, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset,
      countTokens: async text => Math.ceil(text.length / 10) }).run({ identity, anchor, chat,
        settings: { ...settings(), agentHistoryTokenBudget: 40 }, promptContext, registry, tools,
        persistSessionEvent: async () => undefined })).rejects.toThrow('final-request-token-overflow');
    expect(invoke).not.toHaveBeenCalled();
    expect(readWorldSimulationDirectorHistory_ACU(chat)).toEqual([
      { role: 'assistant', content: read }, { role: 'user', content: receipt },
    ]);
    expect(readWorldSimulationDirectorCompactionSource_ACU(chat).view.compaction).toBeNull();
    _set_SillyTavern_API_ACU(undefined);
  });

  it('无锚点路径按最终完整请求判定压缩：骨架超支时压缩旧轮而不是拒发', async () => {
    const markerCount = async (text: string) => (text.match(/填/g)?.length ?? 0);
    const pad = '填'.repeat(80);
    const receipt = `回执${'x'.repeat(250)}${'填'.repeat(10)}`;
    const read = JSON.stringify({ action: 'read', reads: ['anchor:message'] });
    const block = JSON.stringify({ action: 'block', reason: '等待', unresolved: ['后续'] });
    const paddedTools = { read: vi.fn(async () => ({ status: 'ok' as const, content: receipt, summary: '正文' })), search: tools.search };
    const baseIdentity = { chatIdentity: 'volatile-chat', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0',
      anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'volatile-task', stageId: 'volatile-stage', stageRevision: 1 };
    const runSettings = { ...settings(), agentReadTokenBudget: 100000, agentRunBudget: { maxIterations: 8, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1 } };

    // 先用极大预算实测固定段标记数，避免预算写死依赖真实提示词骨架长度。
    const probeFixture = fixture('volatile-probe');
    const probeSent: Array<readonly { role: string; content: string }[]> = [];
    const probe = vi.fn(async (_role: string, messages: readonly { role: string; content: string }[]) => { probeSent.push(messages); return block; });
    await new WorldSimulationMainLoop_ACU({ invoke: probe, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset, countTokens: markerCount })
      .run({ identity: { ...baseIdentity, runId: 'volatile-probe' }, settings: { ...runSettings, agentHistoryTokenBudget: 1000000 },
        promptContext: { ...probeFixture.promptContext, userRequirements: pad }, registry: probeFixture.registry, tools: paddedTools });
    let fixed = 0;
    for (const message of probeSent[0]) fixed += await markerCount(message.content);
    expect(fixed).toBeGreaterThanOrEqual(80);

    // transcript 5 轮仅 50 个标记、远低于 0.8×预算；但固定段 + transcript 超出预算与越界线。
    // 旧的 transcript 比例触发线在这里不会压缩，最终门禁只能拒发；按完整请求判定则应压缩后发送。
    const budget = Math.floor((fixed + 45) / 1.25);
    const second = fixture('volatile-run');
    const sent: Array<readonly { role: string; content: string }[]> = [];
    let calls = 0;
    const invoke = vi.fn(async (_role: string, messages: readonly { role: string; content: string }[]) => {
      sent.push(messages); calls += 1; return calls < 6 ? read : block;
    });
    const result = await new WorldSimulationMainLoop_ACU({ invoke, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset, countTokens: markerCount })
      .run({ identity: { ...baseIdentity, runId: 'volatile-run', taskId: 'volatile-task-run' }, settings: { ...runSettings, agentHistoryTokenBudget: budget },
        promptContext: { ...second.promptContext, userRequirements: pad }, registry: second.registry, tools: paddedTools });

    expect(result.outcome).toBe('blocked');
    expect(invoke).toHaveBeenCalledTimes(6);
    expect(sent[4].some(message => message.content.includes('更早世界推演会话交接'))).toBe(false);
    expect(sent[5].some(message => message.content.includes('更早世界推演会话交接'))).toBe(true);
    expect(sent[5].filter(message => message.content.includes(receipt))).toHaveLength(4);
  });

  it('实际导演请求稳定协议在动态用户要求之前，模型历史追加在末位预填充之前', async () => {
    const { registry, promptContext } = fixture('director-prefix');
    const sent: Array<readonly { role: string; content: string }[]> = [];
    const read = JSON.stringify({ action: 'read', reads: ['anchor:message'] });
    const invoke = vi.fn(async (_role, messages) => {
      sent.push(messages);
      return sent.length === 1 ? read : JSON.stringify({ action: 'block', reason: '等待', unresolved: ['后续'] });
    });
    await new WorldSimulationMainLoop_ACU({ invoke, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset, countTokens: async () => 1 })
      .run({ identity: { runId: 'director-prefix', chatIdentity: 'prefix-chat', triggerKind: 'assistant_completed',
        triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0',
        anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'prefix-task', stageId: 'prefix-stage', stageRevision: 1 },
      settings: settings(), promptContext: { ...promptContext, userRequirements: '只推演北境' }, registry,
      tools: { read: vi.fn(async () => ({ status: 'ok' as const, content: '已读北境正文', summary: '正文' })), search: tools.search } });
    expect(sent).toHaveLength(2);
    expect(sent[0].slice(0, 5)).toEqual(sent[1].slice(0, 5));
    expect(sent[0][0].content).toContain('read 与 search 使用函数调用');
    expect(sent[0][5].content).toContain('只推演北境');
    expect(sent[1].slice(5, -1).some(item => item.content === read)).toBe(true);
    expect(sent[1].at(-2)).toMatchObject({ role: 'tool', content: expect.stringContaining('已读北境正文') });
    expect(sent[1].at(-1)).toEqual({ role: 'assistant', content: WORLD_SIMULATION_AGENT_PREFILLS_ACU['world-director'] });
  });

  it('旧 run-state 比楼层投影多一对时只迁移缺失后缀，重启后没有重复', async () => {
    const { registry, promptContext } = fixture('partial-migration');
    const chat: any[] = [{ message_id: 1, mes: '正文', swipe_id: 0 }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-partial-migration', getCurrentChatId: () => 'chat-partial-migration', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const identity = { runId: 'partial-migration', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
      anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-partial-migration', stageId: 'stage-partial-migration', stageRevision: 1 };
    const first = [{ role: 'assistant' as const, content: 'old read' }, { role: 'user' as const, content: 'old read reply' }];
    const second = [{ role: 'assistant' as const, content: 'old write' }, { role: 'user' as const, content: 'old write reply' }];
    await appendWorldSimulationDirectorHistory_ACU({ anchor, runId: identity.runId, taskId: identity.taskId,
      stageId: identity.stageId, stageRevision: 1, messages: first }, chat);
    await persistWorldSimulationRunState_ACU(anchor, {
      taskId: identity.taskId, cursorKey: `${identity.stageId}#1#0`, nextIteration: 1,
      delegationsUsed: 0, perAgent: {}, outcomes: [], candidateFingerprint: 'old', candidateSummary: '',
      reviewerFeedback: '', transcript: [...first, ...second],
    }, chat);
    resetWorldSimulationRunCacheForTests_ACU();
    const invoke = vi.fn(async () => JSON.stringify({ action: 'block', reason: '先暂停', unresolved: ['等用户'] }));
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    await new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 })
      .run({ identity, anchor, chat, settings: settings(), promptContext, registry, tools });
    for (const item of [...first, ...second]) {
      expect(invoke.mock.calls[0][1].filter((message: { content: string }) => message.content === item.content)).toHaveLength(1);
    }
    expect(readWorldSimulationDirectorHistory_ACU(chat).slice(0, 4)).toEqual([...first, ...second]);
    resetWorldSimulationRunCacheForTests_ACU();
    const next = vi.fn(async () => JSON.stringify({ action: 'block', reason: '继续暂停', unresolved: ['等待'] }));
    await new WorldSimulationMainLoop_ACU({ invoke: next, subagents, apiPreset, countTokens: async () => 1 })
      .run({ identity, anchor, chat, settings: settings(), promptContext, registry, tools });
    for (const item of [...first, ...second]) {
      expect(next.mock.calls[0][1].filter((message: { content: string }) => message.content === item.content)).toHaveLength(1);
    }
    _set_SillyTavern_API_ACU(undefined);
  });

  it('旧 run-state 声称有缺失回执却与已确认楼层前缀冲突时明确报错，不合并旧文本', async () => {
    const { registry, promptContext } = fixture('conflicting-migration');
    const chat: any[] = [{ message_id: 1, mes: '正文', swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-conflicting-migration', getCurrentChatId: () => 'chat-conflicting-migration', saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const identity = { runId: 'conflicting-migration', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
      anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-conflicting-migration', stageId: 'stage-conflicting-migration', stageRevision: 1 };
    await appendWorldSimulationDirectorHistory_ACU({ anchor, runId: identity.runId, taskId: identity.taskId,
      stageId: identity.stageId, stageRevision: 1, messages: [
        { role: 'assistant', content: 'confirmed read' }, { role: 'user', content: 'confirmed reply' },
      ] }, chat);
    await persistWorldSimulationRunState_ACU(anchor, {
      taskId: identity.taskId, cursorKey: `${identity.stageId}#1#0`, nextIteration: 1,
      delegationsUsed: 0, perAgent: {}, outcomes: [], candidateFingerprint: 'old', candidateSummary: '',
      reviewerFeedback: '', transcript: [
        { role: 'assistant', content: 'different read' }, { role: 'user', content: 'different reply' },
        { role: 'assistant', content: 'unconfirmed write' }, { role: 'user', content: 'unconfirmed reply' },
      ],
    }, chat);
    resetWorldSimulationRunCacheForTests_ACU();
    const invoke = vi.fn();
    await expect(new WorldSimulationMainLoop_ACU({ invoke, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset, countTokens: async () => 1 })
      .run({ identity, anchor, chat, settings: settings(), promptContext, registry, tools }))
      .rejects.toThrow('WORLD_SIMULATION_LEGACY_TRANSCRIPT_CONFLICT');
    expect(invoke).not.toHaveBeenCalled();
    expect(readWorldSimulationDirectorHistory_ACU(chat)).toEqual([
      { role: 'assistant', content: 'confirmed read' }, { role: 'user', content: 'confirmed reply' },
    ]);
    _set_SillyTavern_API_ACU(undefined);
  });

  it('楼层 run-state 保存失败不会继续发下一轮请求，恢复后仍只见已确认的动作与回执', async () => {
    const { registry, promptContext } = fixture('run-save-failed');
    const chat: any[] = [{ message_id: 1, mes: '正文', swipe_id: 0 }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-run-save-failed', getCurrentChatId: () => 'chat-run-save-failed', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const identity = { runId: 'run-save-failed', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
      anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-run-save-failed', stageId: 'stage-run-save-failed', stageRevision: 1 };
    const read = JSON.stringify({ action: 'read', reads: ['anchor:message'] });
    const invoke = vi.fn(async () => read);
    const runSettings = settings();
    saveChat.mockImplementation(async () => {
      if (chat[0]._qrf_world_simulation_agent_run) throw new Error('RUN_STATE_SAVE_FAILED');
    });
    await expect(new WorldSimulationMainLoop_ACU({ invoke, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset,
      countTokens: async () => 1 }).run({ identity, anchor, chat, settings: runSettings, promptContext, registry,
        tools: { read: vi.fn(async () => ({ status: 'ok' as const, content: 'read reply', summary: '正文' })), search: tools.search } }))
      .rejects.toMatchObject({ error: { code: 'WORLD_SIMULATION_PERSIST_FAILED' } });
    expect(invoke).toHaveBeenCalledOnce();
    expect(chat[0]._qrf_world_simulation_agent_run).toBeUndefined();
    expect(readWorldSimulationDirectorHistory_ACU(chat)).toEqual([
      { role: 'assistant', content: read, tool_calls: [{ id: 'call_0_read', type: 'function', function: { name: 'read', arguments: '{"reads":["anchor:message"]}' } }] },
      { role: 'tool', tool_call_id: 'call_0_read', content: expect.stringContaining('read reply') },
    ]);
    resetWorldSimulationRunCacheForTests_ACU();
    saveChat.mockResolvedValue(undefined);
    const next = vi.fn(async () => JSON.stringify({ action: 'block', reason: '暂停', unresolved: ['等待'] }));
    await new WorldSimulationMainLoop_ACU({ invoke: next, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset,
      countTokens: async () => 1 }).run({ identity, anchor, chat, settings: runSettings, promptContext, registry, tools });
    expect(next.mock.calls[0][1].filter((item: { content: string }) => item.content === read)).toHaveLength(1);
    expect(next.mock.calls[0][1].filter((item: { content: string }) => item.content.includes('read reply'))).toHaveLength(1);
    _set_SillyTavern_API_ACU(undefined);
  });

  it('迟到的导演模型输出遇到删楼、Swipe 或聊天切换，不落盘到旧/新锚点', async () => {
    for (const change of ['delete', 'swipe', 'chat'] as const) {
      resetWorldSimulationRunCacheForTests_ACU();
      const { registry, promptContext } = fixture(`late-${change}`);
      const chat: any[] = [{ message_id: 1, mes: '正文 A', swipe_id: 0, swipes: ['正文 A', '正文 B'] }];
      const saveChat = vi.fn().mockResolvedValue(undefined);
      _set_SillyTavern_API_ACU({ chat, chatId: `chat-late-${change}`, getCurrentChatId: () => `chat-late-${change}`, saveChat } as any);
      const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
      const identity = { runId: `late-${change}`, chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
        triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
        anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
        taskId: `task-late-${change}`, stageId: `stage-late-${change}`, stageRevision: 1 };
      let release!: (value: string) => void;
      const response = new Promise<string>(resolve => { release = resolve; });
      let started!: () => void;
      const entered = new Promise<void>(resolve => { started = resolve; });
      const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => { started(); return response; }),
        subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset, countTokens: async () => 1 });
      const pending = loop.run({ identity, anchor, chat, settings: settings(), promptContext, registry, tools });
      await entered;
      if (change === 'delete') chat.splice(0, 1);
      else if (change === 'swipe') { chat[0].swipe_id = 1; chat[0].mes = '正文 B'; }
      else _set_SillyTavern_API_ACU({ chat: [{ message_id: 2, mes: '别的正文', swipe_id: 0 }], chatId: 'new-chat',
        getCurrentChatId: () => 'new-chat', saveChat } as any);
      release(JSON.stringify({ action: 'block', reason: '过期结果', unresolved: ['等待'] }));
      await expect(pending).rejects.toBeTruthy();
      expect(saveChat).toHaveBeenCalledTimes(0);
      expect(chat[0]?._qrf_world_simulation_agent_chat).toBeUndefined();
    }
    _set_SillyTavern_API_ACU(undefined);
  });

  it('生产逐栏入口的连续请求见到已保存缺栏回执，下一次派工不继承私有 transcript', async () => {
    const { registry, promptContext, runId } = fixture('write-loop');
    const chat: any[] = [{}, { message_id: 1, mes: '正文', swipe_id: 0 }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-write-loop', getCurrentChatId: () => 'chat-write-loop', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const identity = { runId, chatIdentity: 'chat-write-loop', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
      anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-write-loop', stageId: 'stage-write-loop', stageRevision: 1 };
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    envelope.task = { taskId: identity.taskId, originInstruction: '推进', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    envelope.activeStageId = identity.stageId;
    envelope.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
        plan: { schemaVersion: 1, title: '阶段', objective: '推进', impactScope: [], factsToVerify: [], plannedTools: [],
          plannedSpecialists: [], expectedLedgerChanges: ['dimensions'], convergenceConditions: [], blockingConditions: [],
          completedSteps: [], nextStep: '提交' } }] }];
    chat[0]._qrf_world_simulation = envelope;
    const read = () => {
      const folded = foldWorldSimulationLedger_ACU(chat, anchor.messageIndex);
      return { ledger: folded?.ledger ?? envelope.ledger, fields: folded?.fields,
        archive: foldWorldSimulationArchive_ACU(chat, anchor.messageIndex).snapshot };
    };
    const writes = new WorldSimulationRunWriteState_ACU(read, 0);
    const writeSql: NonNullable<Parameters<WorldSimulationSubagentRuntime_ACU['run']>[0]['writeSql']> = write =>
      commitWorldSimulationFieldWrites_ACU({ identity, anchor, ...write,
        assertRunLedger: view => { writes.assertCurrent(view); writes.assertPersistedProof(identity, readWorldSimulationRunWriteProof_ACU(anchor, chat)); },
        prepareRunProof: (view, refs, accepted) => writes.prepareConfirmation(identity, view, refs, accepted),
        confirmRunLedger: (view, refs, accepted) => writes.confirm(view, refs, accepted) });
    const sql1 = "INSERT INTO dimensions (id, name, kind, expected_revision) VALUES ('dim-loop', '山雨', 'not_a_kind', 0)";
    const sql2 = "UPDATE dimensions SET kind = 'pressure', value = 10, trend = 'rising', rationale = '山雨', evidence_refs = '[]' WHERE id = 'dim-loop' AND expected_revision = 0";
    const replies = [
      JSON.stringify({ action: 'write_sql', sql: sql1 }),
      JSON.stringify({ action: 'write_sql', sql: sql1 }),
      JSON.stringify({ action: 'write_sql', sql: sql2 }),
      JSON.stringify({ status: 'no_change', summary: '分栏已保存', evidenceRefs: [], uncertainties: [] }),
      JSON.stringify({ status: 'no_change', summary: '下次独立派工', evidenceRefs: [], uncertainties: [] }),
    ];
    const sent: Array<readonly { role: string; content: string }[]> = [];
    const invoke = vi.fn(async (_role, messages) => { sent.push(messages); return replies.shift()!; });
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    const input = { delegation: { agentName: 'undercurrent-analyst', instruction: '补全维度', reads: [] },
      settings: settings(), promptContext, registry, tools, runId, writeSql, readCurrent: () => read().ledger,
      readFieldSnapshot: () => read().fields! };

    const completed = await runtime.run(input);
    expect(completed).toMatchObject({ status: 'no_change', completion: 'complete_changed', acceptedKeys: expect.arrayContaining(['dimensions:dim-loop:name', 'dimensions:dim-loop:kind']) });
    expect(sent.slice(0, 4).every(request => request.at(-1)?.role === 'assistant' && request.at(-1)?.content === WORLD_SIMULATION_AGENT_PREFILLS_ACU['undercurrent-analyst'])).toBe(true);
    expect(sent[0].slice(0, 5)).toEqual(sent[1].slice(0, 5));
    expect(sent[0][0].content).toContain('只输出一个 specialist JSON');
    expect(sent[1][5].content).toContain('以下是用户对任务曾经提过的要求');
    expect(sent[1].at(-2)?.role).toBe('tool');
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(sent[1].at(-2)?.content).toContain('"status":"committed"');
    expect(sent[1].at(-2)?.content).toContain('"missingFields"');
    expect(sent[1].at(-2)?.content).toContain('field:dimensions:dim-loop');
    expect(sent[1].at(-2)?.content).toContain('"path":"dimensions#dim-loop.kind"');
    expect(sent[2].at(-2)?.content).toContain('"status":"rejected"');
    expect(sent[2].at(-2)?.content).toContain('id_exists');
    expect(sent[2].at(-2)?.content).toContain('"accepted":[]');
    expect(sent[3].at(-2)?.content).toContain('"field":"kind"');
    expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions).toEqual([expect.objectContaining({ id: 'dim-loop', revision: 1 })]);
    expect(writes.confirmedWrites).toBe(2);
    const reloaded = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    await reloaded.run(input);
    expect(sent[4].some(item => item.content.includes('"action":"write_sql","status":"committed"'))).toBe(false);
    replies.push(JSON.stringify({ status: 'no_change', summary: '新角色读权威资料', evidenceRefs: [], uncertainties: [] }));
    await reloaded.run({ ...input, delegation: { agentName: 'timekeeper', instruction: '其他角色读取已提交资料', reads: [] },
      runId: 'next-workflow', writeSql: undefined });
    expect(sent[5].some(item => item.content.includes('"action":"write_sql","status":"committed"'))).toBe(false);
    expect(sent[5].some(item => item.content.includes('其他角色读取已提交资料'))).toBe(true);
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it('逐栏写入只覆盖部分 ID 时模型 no_change 不能结束合格派工', async () => {
    const { registry, promptContext, runId } = fixture('partial-terminal');
    const replies = [JSON.stringify({ action: 'write_sql', sql: "INSERT INTO dimensions (id, name) VALUES ('d1', '山雨')" }),
      JSON.stringify({ status: 'no_change', summary: '结束', evidenceRefs: [], uncertainties: [] })];
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke: vi.fn(async () => replies.shift()!), apiPreset, countTokens: async () => 1 });
    const fields = { records: { dimensions: { d1: { module: 'dimensions' as const, id: 'd1', status: 'partial' as const,
      fields: { name: { value: '山雨', revision: 1, updatedAt: 1 } }, missingFields: ['kind', 'value'], updatedAt: 1 } } } };
    const outcome = await runtime.run({ delegation: { agentName: 'undercurrent-analyst', instruction: '补齐维度', reads: [] },
      settings: settings(), promptContext, registry, tools, runId, readFieldSnapshot: () => fields,
      writeSql: async () => ({ status: 'committed', accepted: [{ module: 'dimensions', id: 'd1', field: 'name', revision: 1 }],
        rejected: [], partials: [{ module: 'dimensions', id: 'd1', missingFields: ['kind', 'value'] }], ledgerRevision: 0 }) });
    expect(outcome.status).toBe('failed');
    expect(outcome.completion).toBe('failed');
    expect(outcome.unresolvedIssues).toEqual(expect.arrayContaining([expect.objectContaining({ module: 'dimensions', id: 'd1', path: 'dimensions#d1.kind' })]));
    expect(outcome.acceptedKeys).toContain('dimensions:d1:name');
  });

  it('无效写动作回灌协议错误，不虚记一次写入或成功回执', async () => {
    const { registry, promptContext, runId } = fixture('write-protocol-repair');
    const sql = "INSERT INTO dimensions (id, name) VALUES ('d1', '雨')";
    const replies = [JSON.stringify({ action: 'write_sql', sql, extra: true }),
      JSON.stringify({ action: 'write_sql', sql }),
      JSON.stringify({ status: 'no_change', summary: '完成', evidenceRefs: [], uncertainties: [] })];
    const sent: Array<readonly { role: string; content: string }[]> = [];
    const invoke = vi.fn(async (_role, messages) => { sent.push(messages); return replies.shift()!; });
    const writeSql = vi.fn(async () => ({ status: 'rejected' as const, accepted: [], rejected: [], partials: [], ledgerRevision: 0 }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    await runtime.run({ delegation: { agentName: 'undercurrent-analyst', instruction: '分析', reads: [] },
      settings: settings(), promptContext, registry, tools, runId, writeSql });
    expect(writeSql).toHaveBeenCalledOnce();
    expect(sent[1].at(-2)?.content).toContain('你上一次的输出没有被采纳');
    expect(sent[1].at(-2)?.content).not.toContain('"status":"committed"');
    expect(sent[2].at(-2)?.content).toContain('"remainingWriteRounds":2');
  });

  it('重复写动作超过额度后停止发请求，且不会继续触发提交端口', async () => {
    const { registry, promptContext, runId } = fixture('write-round-limit');
    const limited = settings();
    limited.agentRunBudget.maxIterations = 1;
    limited.agentRunBudget.maxExtraReads = 0;
    const writeSql = vi.fn(async () => ({ status: 'rejected' as const, accepted: [], rejected: [], partials: [], ledgerRevision: 0 }));
    const invoke = vi.fn(async () => JSON.stringify({ action: 'write_sql', sql: "INSERT INTO dimensions (id, name) VALUES ('d1', '雨')" }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1, protocolRetries: 0 });

    await expect(runtime.run({ delegation: { agentName: 'undercurrent-analyst', instruction: '分析', reads: [] },
      settings: limited, promptContext, registry, tools, runId, writeSql })).resolves.toMatchObject({ status: 'failed', completion: 'failed' });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(writeSql).toHaveBeenCalledTimes(1);
    const last = invoke.mock.calls[2][1] as readonly { role: string; content: string }[];
    expect(last.at(-2)?.content).toContain('write_sql 轮次已用尽');
    expect(last.at(-2)?.content).toContain('"remainingWriteRounds":0');
  });

  it('恢复失败回执没有旧 revision 和缺栏，也不进入新派工历史', async () => {
    const { registry, promptContext, runId } = fixture('uncertain-write');
    const replies = [JSON.stringify({ action: 'write_sql', sql: "INSERT INTO dimensions (id, name) VALUES ('d1', '雨')" }),
      JSON.stringify({ status: 'no_change', summary: '写入结果不确定', evidenceRefs: [], uncertainties: [] }),
      JSON.stringify({ status: 'no_change', summary: '新派工', evidenceRefs: [], uncertainties: [] })];
    const sent: Array<readonly { role: string; content: string }[]> = [];
    const invoke = vi.fn(async (_role, messages) => { sent.push(messages); return replies.shift()!; });
    const writeSql = vi.fn(async () => ({ status: 'persist_failed' as const, accepted: [], rejected: [{ path: 'persist', reason: 'primary failed' }],
      partials: null, ledgerRevision: null, recovery: 'failed' as const }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    const input = { delegation: { agentName: 'undercurrent-analyst', instruction: '分析', reads: [] },
      settings: settings(), promptContext, registry, tools, runId, writeSql };
    await runtime.run(input);
    expect(sent[1].at(-2)?.content).toContain('"partials":null');
    expect(sent[1].at(-2)?.content).toContain('"ledgerRevision":null');
    expect(sent[1].at(-2)?.content).toContain('"readAddresses":[]');
    await runtime.run(input);
    expect(sent[2].some(message => message.content.includes('"recovery":"failed"'))).toBe(false);
  });

  it('生产端口抛出失效错误时写回状态未知的结构化回执与读写剩余额度', async () => {
    const { registry, promptContext, runId } = fixture('throwing-write');
    const sent: Array<readonly { role: string; content: string }[]> = [];
    const replies = [JSON.stringify({ action: 'write_sql', sql: "INSERT INTO dimensions (id, name) VALUES ('d1', '雨')" }),
      JSON.stringify({ status: 'no_change', summary: '暂停写入', evidenceRefs: [], uncertainties: [] })];
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke: vi.fn(async (_role, messages) => { sent.push(messages); return replies.shift()!; }), apiPreset, countTokens: async () => 1 });
    const outcome = await runtime.run({ delegation: { agentName: 'undercurrent-analyst', instruction: '分析', reads: [] },
      settings: settings(), promptContext, registry, tools, runId, writeSql: async () => { throw new Error('锚点已失效'); } });
    const receipt = JSON.parse(sent[1].at(-2)!.content).results[0];
    expect(receipt).toMatchObject({ status: 'rejected', accepted: [], partials: null, ledgerRevision: null,
      readAddresses: [], remainingReadRounds: 1, remainingWriteRounds: 2 });
    expect(receipt.reason).toContain('锚点已失效');
    expect(outcome.status).toBe('failed');
    expect(outcome.unresolvedIssues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'write_state' })]));
  });

  it('仅拒绝已定位栏目时给权威读取地址，恢复未知时不返回旧地址', async () => {
    const { registry, promptContext, runId } = fixture('rejected-address');
    const sql = "UPDATE dimensions SET kind = 'invalid' WHERE id = 'dim-a' AND expected_revision = 0";
    const sent: Array<readonly { role: string; content: string }[]> = [];
    const replies = [JSON.stringify({ action: 'write_sql', sql }), JSON.stringify({ status: 'no_change', summary: '结束', evidenceRefs: [], uncertainties: [] })];
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke: vi.fn(async (_role, messages) => { sent.push(messages); return replies.shift()!; }), apiPreset, countTokens: async () => 1 });
    const input = { delegation: { agentName: 'undercurrent-analyst', instruction: '核对维度', reads: [] },
      settings: settings(), promptContext, registry, tools, runId,
      writeSql: vi.fn(async () => ({ status: 'rejected' as const, accepted: [], rejected: [
        { path: 'dimensions#dim-a.kind', reason: 'invalid kind' }, { path: 'sql[0].dimensions.fake', reason: 'invalid column' }],
        partials: [], ledgerRevision: 0 })) };
    await runtime.run(input);
    expect(sent[1].at(-2)?.content).toContain('"readAddresses":["field:dimensions:dim-a"]');
    sent.length = 0;
    replies.push(JSON.stringify({ action: 'write_sql', sql }), JSON.stringify({ status: 'no_change', summary: '结束', evidenceRefs: [], uncertainties: [] }));
    input.writeSql.mockResolvedValueOnce({ status: 'readback_failed', accepted: [], rejected: [{ path: 'dimensions#dim-a.kind', reason: 'readback' }], partials: null, ledgerRevision: null } as any);
    await runtime.run(input);
    expect(sent[1].at(-2)?.content).toContain('"readAddresses":[]');
  });

  it('模型响应返回前租约失效时不执行 write_sql，也不再发下一次请求', async () => {
    const { registry, promptContext, runId } = fixture('late-write');
    let release!: (value: string) => void;
    let current = true;
    const invoke = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const writeSql = vi.fn();
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    const pending = runtime.run({ delegation: { agentName: 'undercurrent-analyst', instruction: '分析', reads: [] },
      settings: settings(), promptContext, registry, tools, runId, writeSql, isCurrent: () => current });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    current = false;
    release(JSON.stringify({ action: 'write_sql', sql: "INSERT INTO dimensions (id, name) VALUES ('d1', '雨')" }));

    await expect(pending).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(writeSql).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('specialist 只能在 catalog 声明的 ledger modules 内产出候选', async () => {
    const { registry, evidence, promptContext, runId } = fixture('specialist');
    const invoke = vi.fn(async () => JSON.stringify({ status: 'candidate', agentName: 'timekeeper', patch: { clock: { days: 1 } }, summary: '时间推进', evidenceRefs: [evidence], uncertainties: [] }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    const result = await runtime.run({ delegation: { agentName: 'timekeeper', instruction: '分析时间', reads: [] }, settings: settings(), promptContext, registry, tools, runId });
    expect(result.status).toBe('candidate');
    expect(result.candidate).toMatchObject({ agentName: 'timekeeper', writableModules: ['clock'] });
    expect(result.candidate?.candidateId).toBe('specialist:timekeeper:1');
  });

  it('specialist 省略绑定身份时由运行时补齐 agentName', async () => {
    const { registry, promptContext, runId } = fixture('specialist-bound-identity');
    const invoke = vi.fn(async () => JSON.stringify({ status: 'no_change', summary: '无需修改', evidenceRefs: [], uncertainties: [] }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });

    await expect(runtime.run({
      delegation: { agentName: 'lore-researcher', instruction: '核对行动者信息', reads: [] },
      settings: settings(), promptContext, registry, tools, runId,
    })).resolves.toMatchObject({ agentName: 'lore-researcher', status: 'no_change', summary: '无需修改' });
  });

  it('specialist 显式伪造不同身份时仍 fail-closed', async () => {
    const { registry, promptContext, runId } = fixture('specialist-forged-identity');
    const invoke = vi.fn(async () => JSON.stringify({
      status: 'no_change', agentName: 'timekeeper', summary: '伪造身份', evidenceRefs: [], uncertainties: [],
    }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1, protocolRetries: 0 });

    await expect(runtime.run({
      delegation: { agentName: 'lore-researcher', instruction: '核对行动者信息', reads: [] },
      settings: settings(), promptContext, registry, tools, runId,
    })).rejects.toThrow('WORLD_SIMULATION_AGENT_IDENTITY_MISMATCH');
  });

  it('reviewer 读取额度耗尽后仍反复请求工具时在有限模型调用内失败', async () => {
    const { registry, promptContext } = fixture('reviewer-read-limit');
    const limited = settings();
    limited.agentRunBudget.maxExtraReads = 0;
    const candidate = { candidateId: 'review-limit', agentName: 'timekeeper', patch: { clock: { days: 1 } },
      summary: '时间候选', evidenceRefs: [], uncertainties: [], writableModules: ['clock'] };
    const invoke = vi.fn(async () => JSON.stringify({ action: 'read', reads: ['ledger:current'] }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1, protocolRetries: 0 });

    await expect(runtime.runReviewer({ candidates: [candidate], settings: limited, promptContext, registry, tools }))
      .rejects.toThrow('WORLD_SIMULATION_REVIEWER_CALL_LIMIT:2');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(tools.read).not.toHaveBeenCalled();
    const last = invoke.mock.calls[1][1] as readonly { role: string; content: string }[];
    expect(last.at(-2)?.content).toContain('read/search 轮次已用尽');
    expect(last.at(-1)?.content).toBe(WORLD_SIMULATION_AGENT_PREFILLS_ACU['causality-reviewer']);
  });

  it('reviewer 模型响应迟到且派工租约失效时不执行读取', async () => {
    const { registry, promptContext } = fixture('reviewer-late-read');
    const candidate = { candidateId: 'review-late', agentName: 'timekeeper', patch: { clock: { days: 1 } },
      summary: '时间候选', evidenceRefs: [], uncertainties: [], writableModules: ['clock'] };
    let release!: (value: string) => void;
    let current = true;
    const invoke = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    const pending = runtime.runReviewer({ candidates: [candidate], settings: settings(), promptContext, registry, tools,
      isCurrent: () => current });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    current = false;
    release(JSON.stringify({ action: 'read', reads: ['ledger:current'] }));

    await expect(pending).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(tools.read).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('causality reviewer 对非法 verdict 回灌完整协议并在重试后收敛', async () => {
    const { registry, evidence, promptContext } = fixture('reviewer-protocol-repair');
    const candidate = {
      candidateId: 'candidate:reviewer-repair',
      agentName: 'timekeeper',
      patch: { clock: { days: 1 } },
      summary: '时间推进',
      evidenceRefs: [evidence],
      uncertainties: [],
      writableModules: ['clock'],
    };
    const responses = [
      JSON.stringify({ verdict: 'approved', summary: '错误别名', findings: [], acceptedCandidateIds: [candidate.candidateId] }),
      JSON.stringify({ verdict: 'accept', summary: '审核通过', findings: [], acceptedCandidateIds: [candidate.candidateId] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });

    await expect(runtime.runReviewer({ candidates: [candidate], settings: settings(), promptContext, registry, tools }))
      .resolves.toMatchObject({ verdict: 'accept', summary: '审核通过', acceptedCandidateIds: [candidate.candidateId] });
    expect(invoke).toHaveBeenCalledTimes(2);
    const initialMessages = invoke.mock.calls[0][1] as readonly { role: string; content: string }[];
    expect(initialMessages.some(message => message.role === 'system' && message.content.includes('verdict 必须精确为 accept、revise、reject'))).toBe(true);
    const retryMessages = invoke.mock.calls[1][1] as readonly { role: string; content: string }[];
    const rejection = retryMessages.find(message => message.role === 'user' && message.content.includes('INVALID_REVIEW_VERDICT'))?.content ?? '';
    expect(rejection).toContain('"verdict":"accept"');
    expect(rejection).toContain('"verdict":"revise"');
    expect(rejection).toContain('"verdict":"reject"');
  });

  it('specialist 协议重试回灌明确枚举、角色、写入范围与合法 JSON 模板', async () => {
    const { registry, promptContext, runId } = fixture('specialist-repair');
    const responses = [
      JSON.stringify({ status: 'successful', agentName: 'timekeeper', summary: '非法状态', evidenceRefs: [], uncertainties: [] }),
      JSON.stringify({ status: 'no_change', agentName: 'timekeeper', summary: '无需修改', evidenceRefs: [], uncertainties: [] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const runtime = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    await expect(runtime.run({
      delegation: { agentName: 'timekeeper', instruction: '分析时间', reads: [] },
      settings: settings(), promptContext, registry, tools, runId,
    })).resolves.toMatchObject({ status: 'no_change', summary: '无需修改' });
    expect(invoke).toHaveBeenCalledTimes(2);
    const retryMessages = invoke.mock.calls[1][1] as readonly { role: string; content: string }[];
    const rejection = retryMessages.find(message => message.role === 'user' && message.content.includes('INVALID_SPECIALIST_STATUS'))?.content ?? '';
    expect(rejection).toContain('status 必须精确为 candidate、no_change、failed、blocked');
    expect(rejection).toContain('agentName 必须精确为 timekeeper');
    expect(rejection).toContain('sql 只允许写：clock');
    expect(rejection).toContain('UPDATE clock SET days');
    expect(rejection).toContain('"status":"candidate"');
  });

  it('并行派工部分失败时仍可由 reviewer 部分采用成功候选', async () => {
    const { registry, evidence, promptContext } = fixture('partial');
    const candidate = {
      candidateId: 'candidate:accepted', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '时间推进', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn(async ({ delegation }: any) => {
        if (delegation.agentName === 'lore-researcher') throw new Error('seed failed');
        return { agentName: delegation.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] };
      }),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '采用可信候选', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [
        { agentName: 'timekeeper', instruction: '分析时间', reads: [] },
        { agentName: 'lore-researcher', instruction: '分析暗流', reads: [] },
      ] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交部分成功结果', evidenceRefs: [evidence] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-partial', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result.outcome).toBe('commit');
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(result.commitCandidate.acceptedCandidates).toEqual([candidate]);
    expect(result.outcomes.map(item => item.status)).toEqual(['candidate', 'failed']);
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
  });

  it('同一 specialist 后续成功结果替换旧失败，不让历史协议错误永久污染收敛', async () => {
    const { registry, evidence, promptContext } = fixture('latest-outcome-wins');
    const candidate = {
      candidateId: 'candidate:latest', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '重试后形成候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn()
        .mockRejectedValueOnce(new Error('INVALID_SPECIALIST_STATUS: $.status'))
        .mockResolvedValueOnce({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '采用最新候选', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '首次分析', reads: [] }] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '按协议重试', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交最新结果', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-latest', chatIdentity: 'chat-latest', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-latest', stageId: 'stage-latest', stageRevision: 1 };

    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });

    expect(result.outcome).toBe('commit');
    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentName: candidate.agentName, status: 'candidate' }),
    ]));
    expect(result.outcomes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ agentName: candidate.agentName, status: 'failed' }),
    ]));
    expect(subagents.run).toHaveBeenCalledTimes(2);
  });

  it('存在失败派工时不允许伪装 no_change', async () => {
    const { registry, evidence, promptContext } = fixture('no-change-gate');
    const subagents = {
      run: vi.fn(async () => { throw new Error('all failed'); }),
      runReviewer: vi.fn(),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'timekeeper', instruction: '分析', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'no_change', summary: '无变化', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'block', reason: '证据不足', unresolved: ['specialist failed'] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-block', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result).toMatchObject({ outcome: 'blocked', summary: '证据不足' });
    expect(subagents.runReviewer).not.toHaveBeenCalled();
  });

  it('导演在逐栏已提交后不重放写入，剩余独立候选仍可提交', async () => {
    const { registry, evidence, promptContext } = fixture('director-confirmed');
    let current = promptContext.worldState;
    const archive = { schemaVersion: 1, records: {} };
    const proof = new WorldSimulationRunWriteState_ACU(() => ({ ledger: current, fields: undefined, archive }), 0);
    const candidate = { candidateId: 'dimension-after-clock', agentName: 'undercurrent-analyst',
      patch: { dimensions: { upsert: [{ id: 'dimension-1', name: '边境压力', kind: 'pressure', value: 1, trend: 'rising',
        rationale: '锚点证据', evidenceRefs: [evidence], expectedRevision: 0 }] } },
      summary: '补充维度', evidenceRefs: [evidence], uncertainties: [], writableModules: ['dimensions', 'seeds'] };
    const subagents = { run: vi.fn(async ({ delegation }: any) => {
      if (delegation.agentName === 'timekeeper') {
        current = { ...current, revision: 1, clock: { ...current.clock, day: 2 } };
        proof.confirm({ ledger: current, fields: undefined, archive }, [evidence], [{ module: 'clock', id: 'singleton' }]);
        return { agentName: 'timekeeper', status: 'no_change', summary: '时钟已保存', evidenceRefs: [evidence], uncertainties: [] };
      }
      return { agentName: candidate.agentName, status: 'candidate', summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] };
    }), runReviewer: vi.fn(async ({ candidates, promptContext: context }: any) => {
      expect(context.worldState).toMatchObject({ revision: 1, clock: { day: 2 } });
      return { verdict: 'accept', summary: '通过', findings: [], acceptedCandidateIds: candidates.map((item: any) => item.candidateId) };
    }) };
    const responses = [
      { action: 'delegate', delegations: [{ agentName: 'timekeeper', instruction: '推进', reads: [] }] },
      { action: 'delegate', delegations: [{ agentName: 'undercurrent-analyst', instruction: '补充', reads: [] }] },
      { action: 'finalize', outcome: 'commit', summary: '完成', evidenceRefs: [evidence] },
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => JSON.stringify(responses.shift())), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'director-confirmed', chatIdentity: 'chat-director-confirmed', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest',
      baseLedgerRevision: 0, taskId: 'task-director-confirmed', stageId: 'stage-director-confirmed', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools, readCurrent: () => current, runWrites: proof });
    expect(result.outcome).toBe('commit');
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(result.commitCandidate.acceptedCandidates).toEqual([candidate]);
    expect(subagents.runReviewer).toHaveBeenCalledTimes(1);
  });

  it('只发生确认的逐栏写入时导演无需虚构候选即可完成', async () => {
    const { registry, evidence, promptContext } = fixture('director-only-write');
    let current = promptContext.worldState;
    const archive = { schemaVersion: 1, records: {} };
    const proof = new WorldSimulationRunWriteState_ACU(() => ({ ledger: current, fields: undefined, archive }), 0);
    const subagents = { run: vi.fn(async () => {
      current = { ...current, revision: 1, clock: { ...current.clock, day: 2 } };
      proof.confirm({ ledger: current, fields: undefined, archive }, [evidence], [{ module: 'clock', id: 'singleton' }]);
      return { agentName: 'timekeeper', status: 'no_change', summary: '已经写入', evidenceRefs: [], uncertainties: [] };
    }), runReviewer: vi.fn() };
    const responses = [
      { action: 'delegate', delegations: [{ agentName: 'timekeeper', instruction: '推进', reads: [] }] },
      { action: 'finalize', outcome: 'commit', summary: '已经写入', evidenceRefs: [evidence] },
    ];
    const identity = { runId: 'director-only-write', chatIdentity: 'chat-director-only-write', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest',
      baseLedgerRevision: 0, taskId: 'task-director-only-write', stageId: 'stage-director-only-write', stageRevision: 1 };
    const result = await new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => JSON.stringify(responses.shift())), subagents, apiPreset, countTokens: async () => 1 }).run({
      identity, settings: settings(), promptContext, registry, tools, readCurrent: () => current, runWrites: proof,
    });
    expect(result.outcome).toBe('commit');
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(result.commitCandidate.acceptedCandidates).toEqual([]);
    expect(result.commitCandidate.evidenceRefs).toContain(evidence);
    expect(subagents.runReviewer).not.toHaveBeenCalled();
  });

  it('已保存部分栏但终态缺栏时导演看到缺口，预算耗尽不提交成功', async () => {
    const { registry, evidence, promptContext } = fixture('director-partial-write');
    let current = promptContext.worldState;
    const archive = { schemaVersion: 1, records: {} };
    const proof = new WorldSimulationRunWriteState_ACU(() => ({ ledger: current, fields: undefined, archive }), 0);
    const subagents = { run: vi.fn(async () => {
      current = { ...current, revision: 1 };
      proof.confirm({ ledger: current, fields: undefined, archive }, [evidence], [{ module: 'dimensions', id: 'd1' }]);
      return { agentName: 'undercurrent-analyst', status: 'failed' as const, completion: 'failed' as const,
        summary: '逐栏维护未完成', evidenceRefs: [], uncertainties: [], acceptedKeys: ['dimensions:d1:name'],
        unresolvedIssues: [{ module: 'dimensions', id: 'd1', source: 'missing_field' as const,
          path: 'dimensions#d1.kind', message: '尚未写入' }] };
    }), runReviewer: vi.fn() };
    const responses = [
      { action: 'delegate', delegations: [{ agentName: 'undercurrent-analyst', instruction: '补齐维度', reads: [] }] },
      { action: 'finalize', outcome: 'commit', summary: '声称完成', evidenceRefs: [evidence] },
    ];
    const invoke = vi.fn(async () => JSON.stringify(responses.shift()));
    const identity = { runId: 'director-partial-write', chatIdentity: 'chat-director-partial-write', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest',
      baseLedgerRevision: 0, taskId: 'task-director-partial-write', stageId: 'stage-director-partial-write', stageRevision: 1 };
    const limited = settings();
    limited.agentRunBudget.maxIterations = 2;
    const result = await new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 }).run({
      identity, settings: limited, promptContext, registry, tools, readCurrent: () => current, runWrites: proof,
    });
    expect(result.outcome).toBe('blocked');
    expect(result.outcomes).toEqual([expect.objectContaining({ status: 'failed', acceptedKeys: ['dimensions:d1:name'],
      unresolvedIssues: [expect.objectContaining({ path: 'dimensions#d1.kind' })] })]);
    expect(invoke.mock.calls[1][1].some((message: { content: string }) => message.content.includes('dimensions#d1.kind'))).toBe(true);
    expect(subagents.runReviewer).not.toHaveBeenCalled();
  });

  it('与已确认逐栏写入重叠的候选回灌修正，而不再审核并重放', async () => {
    const { registry, evidence, promptContext } = fixture('director-overlap-write');
    let current = promptContext.worldState;
    const archive = { schemaVersion: 1, records: {} };
    const proof = new WorldSimulationRunWriteState_ACU(() => ({ ledger: current, fields: undefined, archive }), 0);
    const candidate = { candidateId: 'overlap-clock', agentName: 'timekeeper', patch: { clock: { days: 1 } },
      summary: '重复推进', evidenceRefs: [evidence], uncertainties: [], writableModules: ['clock'] };
    const subagents = { run: vi.fn(async () => {
      current = { ...current, revision: 1, clock: { ...current.clock, day: 2 } };
      proof.confirm({ ledger: current, fields: undefined, archive }, [evidence], [{ module: 'clock', id: 'singleton' }]);
      return { agentName: 'timekeeper', status: 'candidate', summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] };
    }), runReviewer: vi.fn() };
    const responses = [
      { action: 'delegate', delegations: [{ agentName: 'timekeeper', instruction: '推进', reads: [] }] },
      { action: 'finalize', outcome: 'commit', summary: '重复候选', evidenceRefs: [evidence] },
      { action: 'block', reason: '等待修正', unresolved: ['重叠候选'] },
    ];
    const invoke = vi.fn(async (_role: string, messages: readonly { role: string; content: string }[]) => {
      if (responses.length === 1) expect(JSON.stringify(messages)).toContain('WORLD_SIMULATION_RUN_WRITE_OVERLAP');
      return JSON.stringify(responses.shift());
    });
    const identity = { runId: 'director-overlap-write', chatIdentity: 'chat-director-overlap', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest',
      baseLedgerRevision: 0, taskId: 'task-director-overlap', stageId: 'stage-director-overlap', stageRevision: 1 };
    const result = await new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 }).run({
      identity, settings: settings(), promptContext, registry, tools, readCurrent: () => current, runWrites: proof,
    });
    expect(result).toMatchObject({ outcome: 'blocked', summary: '等待修正' });
    expect(subagents.runReviewer).not.toHaveBeenCalled();
  });

  it('主 Agent 协议错误只做有限修正并可在下一轮收敛', async () => {
    const { registry, promptContext } = fixture('director-repair');
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    const responses = [
      JSON.stringify({ action: 'unknown' }),
      JSON.stringify({ action: 'block', reason: '修正后阻断', unresolved: ['missing evidence'] }),
    ];
    const sent: Array<readonly { role: string; content: string }[]> = [];
    const invoke = vi.fn(async (_role, messages) => { sent.push(messages); return responses.shift()!; });
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-repair', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result).toMatchObject({ outcome: 'blocked', summary: '修正后阻断' });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(sent.every(messages => messages[messages.length - 1]?.role === 'assistant'
      && messages[messages.length - 1]?.content === WORLD_SIMULATION_AGENT_PREFILLS_ACU['world-director'])).toBe(true);
    expect(sent[1][sent[1].length - 2]).toMatchObject({ role: 'user', content: expect.stringContaining('INVALID_ACTION') });
    expect(sent[1].some(message => message.role === 'assistant' && message.content.includes('"action":"unknown"'))).toBe(true);
    expect(subagents.run).not.toHaveBeenCalled();
  });

  it('主 Agent 可连续修正不同 finalize 机械错误且重复指纹门禁不变', async () => {
    const { registry, promptContext } = fixture('director-sequential-repair');
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    const responses = [
      JSON.stringify({ action: 'finalize', summary: '缺少 outcome', evidenceRefs: [] }),
      JSON.stringify({ action: 'finalize', outcome: 'no_change', candidateId: 'candidate:wrong', summary: '混入审核字段', evidenceRefs: [] }),
      JSON.stringify({ action: 'block', reason: '协议已修正但证据不足', unresolved: ['missing evidence'] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-sequential-repair', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 4;

    await expect(loop.run({ identity, settings: runSettings, promptContext, registry, tools }))
      .resolves.toMatchObject({ outcome: 'blocked', summary: '协议已修正但证据不足' });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(subagents.run).not.toHaveBeenCalled();
  });

  it('主 Agent 响应未返回时立即显示 running 卡片，完成后原位更新', async () => {
    const { registry, promptContext } = fixture('director-live');
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    let resolveInvoke!: (value: string) => void;
    const invoke = vi.fn(() => new Promise<string>(resolve => { resolveInvoke = resolve; }));
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-director-live', chatIdentity: 'chat-director-live', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };

    const pending = loop.run({ identity, settings: settings(), promptContext, registry, tools });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const running = readWorldSimulationSessionLog_ACU(identity.chatIdentity);
    const runningCard = running.find(item => item.kind === 'main_action');
    expect(runningCard).toMatchObject({ title: '主 Agent 第 1 轮正在工作', status: 'running', agentName: 'world-director' });

    resolveInvoke(JSON.stringify({ action: 'block', reason: '等待外部证据', unresolved: ['missing'] }));
    await expect(pending).resolves.toMatchObject({ outcome: 'blocked' });

    const completed = readWorldSimulationSessionLog_ACU(identity.chatIdentity);
    const completedCard = completed.find(item => item.id === runningCard?.id);
    expect(completedCard).toMatchObject({ title: '主 Agent 动作：block', status: 'done', ok: true });
    expect(completed.filter(item => item.kind === 'main_action')).toHaveLength(1);
  });

  it('工具读取未返回时立即显示 running 卡片，完成后原位更新', async () => {
    const { registry, promptContext } = fixture('tool-live');
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    const responses = [
      JSON.stringify({ action: 'read', reads: ['ledger:current'] }),
      JSON.stringify({ action: 'block', reason: '取证完成后暂停', unresolved: ['next'] }),
    ];
    let resolveRead!: (value: { status: 'empty'; summary: string }) => void;
    const liveTools = {
      read: vi.fn(() => new Promise<{ status: 'empty'; summary: string }>(resolve => { resolveRead = resolve; })),
      search: vi.fn(async () => ({ status: 'empty' as const, hits: [], summary: 'empty' })),
    };
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-tool-live', chatIdentity: 'chat-tool-live', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };

    const pending = loop.run({ identity, settings: settings(), promptContext, registry, tools: liveTools });
    await vi.waitFor(() => expect(liveTools.read).toHaveBeenCalledOnce());
    const running = readWorldSimulationSessionLog_ACU(identity.chatIdentity);
    const runningCard = running.find(item => item.kind === 'tool_read');
    expect(runningCard).toMatchObject({ title: '主 Agent 正在读取资料', status: 'running', agentName: 'world-director' });

    resolveRead({ status: 'empty', summary: '当前账本为空' });
    await expect(pending).resolves.toMatchObject({ outcome: 'blocked' });

    const completed = readWorldSimulationSessionLog_ACU(identity.chatIdentity);
    const completedCard = completed.find(item => item.id === runningCard?.id);
    expect(completedCard).toMatchObject({ title: '资料读取完成（1 项）', status: 'done', ok: true });
    expect(completed.filter(item => item.kind === 'tool_read')).toHaveLength(1);
  });

  it('reviewer 要求 revise 时返回主循环修正而不是误提交', async () => {
    const { registry, evidence, promptContext } = fixture('review-revise');
    const candidate = {
      candidateId: 'candidate:revise', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '时间推进', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn()
        .mockResolvedValueOnce({
          verdict: 'revise' as const,
          summary: '需要补充因果说明',
          findings: [{ severity: 'major' as const, reasonCode: 'CAUSE_GAP', path: '$.clock', expected: 'causal rationale', actual: 'missing' }],
          acceptedCandidateIds: [candidate.candidateId],
        })
        .mockResolvedValueOnce({ verdict: 'accept' as const, summary: '修订后通过', findings: [], acceptedCandidateIds: [candidate.candidateId] }),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '首次提交', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '修订后提交', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-revise', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result.outcome).toBe('commit');
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(result.summary).toBe('修订后提交');
    expect(subagents.runReviewer).toHaveBeenCalledTimes(2);
  });

  it('reviewer 驳回候选后主 Agent 重新派工修订而不是结束任务', async () => {
    const { registry, evidence, promptContext } = fixture('review-reject-redelegate');
    const rejectedCandidate = {
      candidateId: 'candidate:rejected', agentName: 'timekeeper',
      patch: { clock: { days: 1 } },
      summary: '缺少锚点证据的时间候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const revisedCandidate = {
      ...rejectedCandidate,
      candidateId: 'candidate:revised',
      patch: { clock: { days: 1, storyTime: '30m' } },
      summary: '按审核意见修正后的时间候选',
    };
    const subagents = {
      run: vi.fn()
        .mockResolvedValueOnce({ agentName: rejectedCandidate.agentName, status: 'candidate' as const, summary: rejectedCandidate.summary, candidate: rejectedCandidate, evidenceRefs: [evidence], uncertainties: [] })
        .mockResolvedValueOnce({ agentName: revisedCandidate.agentName, status: 'candidate' as const, summary: revisedCandidate.summary, candidate: revisedCandidate, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn()
        .mockResolvedValueOnce({
          verdict: 'reject' as const,
          summary: '候选时间跨度缺少锚点证据',
          findings: [{ severity: 'blocking' as const, reasonCode: 'EVIDENCE_GAP', path: '$.clock.days', expected: '时间跨度由锚点证据支持', actual: '缺少直接依据' }],
          acceptedCandidateIds: [],
        })
        .mockResolvedValueOnce({ verdict: 'accept' as const, summary: '修订候选通过', findings: [], acceptedCandidateIds: [revisedCandidate.candidateId] }),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: rejectedCandidate.agentName, instruction: '分析时间推进', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '首次送审', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: rejectedCandidate.agentName, instruction: '根据 EVIDENCE_GAP 修正候选', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交修订候选', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-reject-redelegate', chatIdentity: 'chat-reject-redelegate', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-reject-redelegate', stageId: 'stage-reject-redelegate', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 4;

    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'commit', summary: '提交修订候选' });
    expect(subagents.run).toHaveBeenCalledTimes(2);
    expect(subagents.runReviewer).toHaveBeenCalledTimes(2);
    expect(subagents.run.mock.calls[1][0].delegation.instruction).toContain('EVIDENCE_GAP');
  });

  it('同一 specialist 对同一逻辑条目的修订候选替换旧候选', async () => {
    const { registry, evidence, promptContext } = fixture('replace-revised-candidate');
    const baseEntry = {
      id: 'dimension-1', name: '边境压力', kind: 'pressure', value: 1, trend: 'rising',
      rationale: '锚点证据', evidenceRefs: [evidence], expectedRevision: 0,
    };
    const original = {
      candidateId: 'candidate:dimension-original', agentName: 'undercurrent-analyst',
      patch: { dimensions: { upsert: [baseEntry] } }, summary: '初版维度候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['dimensions', 'seeds'],
    };
    const revised = {
      ...original,
      candidateId: 'candidate:dimension-revised',
      patch: { dimensions: { upsert: [{ ...baseEntry, value: 2, rationale: '修订后的锚点解释' }] } },
      summary: '修订维度候选',
    };
    const subagents = {
      run: vi.fn()
        .mockResolvedValueOnce({ agentName: original.agentName, status: 'candidate' as const, summary: original.summary, candidate: original, evidenceRefs: [evidence], uncertainties: [] })
        .mockResolvedValueOnce({ agentName: revised.agentName, status: 'candidate' as const, summary: revised.summary, candidate: revised, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn(async ({ candidates }: any) => ({ verdict: 'accept' as const, summary: '修订候选通过', findings: [], acceptedCandidateIds: candidates.map((candidate: any) => candidate.candidateId) })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: original.agentName, instruction: '生成初版维度', reads: [] }] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: revised.agentName, instruction: '修订同一维度', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交修订维度', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-replace-revised', chatIdentity: 'chat-replace-revised', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-replace-revised', stageId: 'stage-replace-revised', stageRevision: 1 };

    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'commit' });
    expect(subagents.runReviewer.mock.calls.at(-1)![0].candidates).toEqual([revised]);
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(result.commitCandidate.acceptedCandidates).toEqual([revised]);
  });

  it('候选事务失败后回灌错误并重新派工修正', async () => {
    const { registry, evidence, promptContext } = fixture('transaction-redelegate');
    const entry = {
      id: 'dimension-transaction', name: '事务维度', kind: 'pressure', value: 1, trend: 'rising',
      rationale: '锚点证据', evidenceRefs: [evidence],
    };
    const stale = {
      candidateId: 'candidate:stale-revision', agentName: 'undercurrent-analyst',
      patch: { dimensions: { upsert: [{ ...entry, expectedRevision: 1 }] } }, summary: '错误 revision 候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['dimensions', 'seeds'],
    };
    const corrected = {
      ...stale,
      candidateId: 'candidate:corrected-revision',
      patch: { dimensions: { upsert: [{ ...entry, expectedRevision: 0 }] } },
      summary: '修正 revision 候选',
    };
    const subagents = {
      run: vi.fn()
        .mockResolvedValueOnce({ agentName: stale.agentName, status: 'candidate' as const, summary: stale.summary, candidate: stale, evidenceRefs: [evidence], uncertainties: [] })
        .mockResolvedValueOnce({ agentName: corrected.agentName, status: 'candidate' as const, summary: corrected.summary, candidate: corrected, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn(async ({ candidates }: any) => ({ verdict: 'accept' as const, summary: '候选通过', findings: [], acceptedCandidateIds: candidates.map((candidate: any) => candidate.candidateId) })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: stale.agentName, instruction: '生成候选', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '首次提交', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: corrected.agentName, instruction: '根据事务错误修订', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交修订候选', evidenceRefs: [evidence] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-transaction-redelegate', chatIdentity: 'chat-transaction-redelegate', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-transaction-redelegate', stageId: 'stage-transaction-redelegate', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 4;

    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'commit', summary: '提交修订候选' });
    expect(JSON.stringify(invoke.mock.calls)).toContain('revision 冲突');
    expect(JSON.stringify(invoke.mock.calls)).toContain('重新派工');
    expect(JSON.stringify(invoke.mock.calls)).toContain('完整必填字段模板');
    expect(JSON.stringify(invoke.mock.calls)).toContain('字段纪律：dimensions 必须给 id,name');
    expect(subagents.run).toHaveBeenCalledTimes(2);
    expect(subagents.runReviewer.mock.calls.at(-1)![0].candidates).toEqual([corrected]);
  });

  it('候选缺 kind/value/trend 时预检通过并直接入库', async () => {
    const { registry, evidence, promptContext } = fixture('transaction-missing-fields');
    const incomplete = {
      candidateId: 'candidate:missing-fields', agentName: 'undercurrent-analyst',
      patch: { dimensions: { upsert: [{ id: 'pressure', name: '压力', expectedRevision: 0, rationale: '', evidenceRefs: [evidence] }] } },
      summary: '缺字段候选', evidenceRefs: [evidence], uncertainties: [], writableModules: ['dimensions', 'seeds'],
    };
    const subagents = {
      run: vi.fn()
        .mockResolvedValueOnce({ agentName: incomplete.agentName, status: 'candidate' as const, summary: incomplete.summary, candidate: incomplete, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn(async ({ candidates }: any) => ({ verdict: 'accept' as const, summary: '候选通过', findings: [], acceptedCandidateIds: candidates.map((candidate: any) => candidate.candidateId) })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: incomplete.agentName, instruction: '生成候选', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '首次提交', evidenceRefs: [evidence] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-transaction-missing-fields', chatIdentity: 'chat-transaction-missing-fields', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-transaction-missing-fields', stageId: 'stage-transaction-missing-fields', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 4;

    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'commit', summary: '首次提交' });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('缺少必填字段：kind,value,trend');
  });

  it('显式 block 后保留同一 task/cursor 的候选并在恢复时避免重复派工', async () => {
    const { registry, evidence, promptContext } = fixture('resume-after-block');
    const candidate = {
      candidateId: 'candidate:block-resume', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '阻断前候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '恢复后通过', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'block', reason: '等待继续', unresolved: ['用户确认'] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '恢复后提交', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = {
      runId: 'run-block-resume', chatIdentity: 'chat-block-resume', triggerKind: 'agent_chat_message' as const,
      triggerConversationMessageId: 'turn-1', anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 4,
      taskId: 'task-block-resume', stageId: 'stage-block-resume', stageRevision: 2,
    };
    const runSettings = settings();

    await expect(loop.run({ identity, settings: runSettings, promptContext, registry, tools }))
      .resolves.toMatchObject({ outcome: 'blocked', summary: '等待继续' });
    expect(readWorldSimulationRunState_ACU(
      identity.chatIdentity,
      identity.taskId,
      `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`,
    )).toMatchObject({ candidates: [candidate], nextIteration: 3 });

    const resumedRegistry = createWorldSimulationEvidenceRegistry_ACU(registry.runId);
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(resumedRegistry).entries).toHaveLength(0);
    const resumed = await loop.run({ identity, settings: runSettings, promptContext, registry: resumedRegistry, tools });
    expect(resumed.outcome).toBe('commit');
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(resumedRegistry).entries.some(entry => entry.evidenceRef === evidence)).toBe(true);
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).toHaveBeenCalledTimes(2);
  });

  it('同一 task/stage identity 恢复候选且不重复派工', async () => {
    const { registry, evidence, promptContext } = fixture('resume-same-identity');
    const candidate = {
      candidateId: 'candidate:resume', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '恢复候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '恢复后通过', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '恢复后提交', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = {
      runId: 'run-resume', chatIdentity: 'chat-resume', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 7,
      taskId: 'task-resume', stageId: 'stage-resume', stageRevision: 3,
    };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 1;

    await expect(loop.run({ identity, settings: runSettings, promptContext, registry, tools }))
      .resolves.toMatchObject({ outcome: 'blocked', unresolved: ['iteration budget exhausted'] });
    const resumed = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });

    expect(resumed.outcome).toBe('commit');
    if (resumed.outcome !== 'commit') throw new Error('expected resumed commit');
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
    expect(resumed.commitCandidate).toMatchObject({
      runId: identity.runId,
      taskId: identity.taskId,
      stageId: identity.stageId,
      stageRevision: identity.stageRevision,
      baseLedgerRevision: identity.baseLedgerRevision,
      acceptedCandidates: [candidate],
    });
  });

  it('stage cursor 改变后不复用旧候选', async () => {
    const { registry, evidence, promptContext } = fixture('resume-cursor-isolation');
    const candidate = {
      candidateId: 'candidate:stale-cursor', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '旧 cursor 候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '不得提交旧候选', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = {
      runId: 'run-cursor', chatIdentity: 'chat-cursor', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 2,
      taskId: 'task-cursor', stageId: 'stage-cursor', stageRevision: 1,
    };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 1;

    await expect(loop.run({ identity, settings: runSettings, promptContext, registry, tools }))
      .resolves.toMatchObject({ outcome: 'blocked' });
    const changedCursor = { ...identity, runId: 'run-cursor-next', stageRevision: 2 };
    const result = await loop.run({ identity: changedCursor, settings: runSettings, promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'blocked', unresolved: ['iteration budget exhausted'] });
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).not.toHaveBeenCalled();
  });

  it('重启后内存清空，从锚点楼层恢复候选与证据直接提交', async () => {
    const { registry, evidence, promptContext } = fixture('floor-resume');
    const chat: any[] = [{ message_id: 1, mes: '锚点正文', swipe_id: 0, is_user: false, is_system: false }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-floor-resume', getCurrentChatId: () => 'chat-floor-resume', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const candidate = {
      candidateId: 'candidate:floor-resume', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '楼层恢复候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async ({ candidates }: any) => ({ verdict: 'accept' as const, summary: '楼层恢复后通过', findings: [], acceptedCandidateIds: candidates.map((item: any) => item.candidateId) })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'block', reason: '等待继续', unresolved: ['用户确认'] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = {
      runId: 'run-floor-resume', chatIdentity: 'chat-floor-resume', triggerKind: 'agent_chat_message' as const,
      triggerConversationMessageId: 'turn-1', anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 4,
      taskId: 'task-floor-resume', stageId: 'stage-floor-resume', stageRevision: 2,
    };
    const runSettings = settings();

    await expect(loop.run({ identity, settings: runSettings, promptContext, registry, tools, anchor, chat }))
      .resolves.toMatchObject({ outcome: 'blocked', summary: '等待继续' });
    // 等楼层持久化（fire-and-forget）完成后模拟重启：清空内存缓存与证据注册表。
    await new Promise(resolve => setTimeout(resolve, 0));
    resetWorldSimulationRunCacheForTests_ACU();
    const resumedRegistry = createWorldSimulationEvidenceRegistry_ACU(registry.runId);
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(resumedRegistry).entries).toHaveLength(0);

    const resumedLoop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '楼层恢复后提交', evidenceRefs: [evidence] })), subagents, apiPreset, countTokens: async () => 1 });
    const result = await resumedLoop.run({ identity, settings: runSettings, promptContext, registry: resumedRegistry, tools, anchor, chat });

    expect(result).toMatchObject({ outcome: 'commit', summary: '楼层恢复后提交' });
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).toHaveBeenCalledTimes(2);
    expect(snapshotWorldSimulationEvidenceRegistry_ACU(resumedRegistry).entries.some(entry => entry.evidenceRef === evidence)).toBe(true);
    _set_SillyTavern_API_ACU(undefined);
  });

  it('预算耗尽后继续时重置迭代与派工窗口并保留候选', async () => {
    const { registry, evidence, promptContext } = fixture('budget-reset-resume');
    const chat: any[] = [{ message_id: 1, mes: '锚点正文', swipe_id: 0, is_user: false, is_system: false }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-budget-resume', getCurrentChatId: () => 'chat-budget-resume', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const candidate = {
      candidateId: 'candidate:budget-resume', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '预算重置候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async ({ candidates }: any) => ({ verdict: 'accept' as const, summary: '预算重置后通过', findings: [], acceptedCandidateIds: candidates.map((item: any) => item.candidateId) })),
    };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 2;
    const identity = {
      runId: 'run-budget-resume', chatIdentity: 'chat-budget-resume', triggerKind: 'agent_chat_message' as const,
      triggerConversationMessageId: 'turn-1', anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 6,
      taskId: 'task-budget-resume', stageId: 'stage-budget-resume', stageRevision: 3,
    };

    // 第一段：仅做一次读取即耗尽迭代预算，形成 'iteration budget exhausted' 恢复标记。
    const firstLoop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => JSON.stringify({ action:'read', reads: ['$CLOCK'] })), subagents, apiPreset, countTokens: async () => 1 });
    await expect(firstLoop.run({ identity, settings: runSettings, promptContext, registry, tools, anchor, chat }))
      .resolves.toMatchObject({ outcome: 'blocked', summary: '世界推演主循环迭代预算耗尽' });
    const exhausted = readWorldSimulationRunState_ACU(identity.chatIdentity, identity.taskId, `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`);
    expect(exhausted).toMatchObject({ budgetExhausted: true, reviewerFeedback: 'iteration budget exhausted' });
    expect(exhausted?.handoffSummary).toContain('交接');
    await new Promise(resolve => setTimeout(resolve, 0));
    resetWorldSimulationRunCacheForTests_ACU();

    // 第二段：模拟重启后恢复，预算窗口重置、候选与证据保留，可以继续派工直至提交。
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '继续推进', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '预算重置后提交', evidenceRefs: [evidence] }),
    ];
    const resumedLoop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const result = await resumedLoop.run({ identity, settings: runSettings, promptContext, registry, tools, anchor, chat });

    expect(result).toMatchObject({ outcome: 'commit', summary: '预算重置后提交' });
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
    _set_SillyTavern_API_ACU(undefined);
  });

  it('重启恢复后主 Agent 对话 transcript 从楼层回填，审核意见不丢失', async () => {
    const { registry, evidence, promptContext } = fixture('transcript-floor-resume');
    const chat: any[] = [{ message_id: 1, mes: '锚点正文', swipe_id: 0, is_user: false, is_system: false }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-transcript-resume', getCurrentChatId: () => 'chat-transcript-resume', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const candidate = {
      candidateId: 'candidate:transcript-resume', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '对话恢复候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn()
        .mockResolvedValueOnce({ verdict: 'reject' as const, summary: '候选缺少时间证据', findings: [{ severity: 'blocking' as const, reasonCode: 'EVIDENCE_GAP', path: '$.clock.days', expected: '锚点支持', actual: '缺失' }], acceptedCandidateIds: [] })
        .mockResolvedValueOnce({ verdict: 'accept' as const, summary: '恢复后通过', findings: [], acceptedCandidateIds: [candidate.candidateId] }),
    };
    const runSettings = settings();
    const identity = {
      runId: 'run-transcript-resume', chatIdentity: 'chat-transcript-resume', triggerKind: 'agent_chat_message' as const,
      triggerConversationMessageId: 'turn-1', anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 5,
      taskId: 'task-transcript-resume', stageId: 'stage-transcript-resume', stageRevision: 2,
    };

    // 第一段：派工 -> 审核驳回（意见写入 transcript）-> block，形成可恢复现场。
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '首次送审', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'block', reason: '等待继续', unresolved: ['用户确认'] }),
    ];
    const firstLoop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    await expect(firstLoop.run({ identity, settings: runSettings, promptContext, registry, tools, anchor, chat }))
      .resolves.toMatchObject({ outcome: 'blocked', summary: '等待继续' });
    const paused = readWorldSimulationRunState_ACU(identity.chatIdentity, identity.taskId, `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`);
    expect(paused?.nextIteration).toBeGreaterThan(runSettings.agentRunBudget.maxIterations);
    expect(paused?.budgetExhausted).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 0));
    resetWorldSimulationRunCacheForTests_ACU();

    // 第二段：模拟重启后恢复；Director 首轮请求应携带楼层回填的审核意见。
    const resumedLoop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '对话恢复后提交', evidenceRefs: [evidence] })), subagents, apiPreset, countTokens: async () => 1 });
    const result = await resumedLoop.run({ identity, settings: runSettings, promptContext, registry, tools, anchor, chat });

    expect(result).toMatchObject({ outcome: 'commit', summary: '对话恢复后提交' });
    const resumedInvoke = (resumedLoop as unknown as { dependencies: { invoke: { mock: { calls: unknown[][] } } } })['dependencies']['invoke'] as unknown as { mock: { calls: Array<[string, Array<{ role: string; content: string }>, unknown]> } };
    expect(resumedInvoke.mock.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(resumedInvoke.mock.calls[0][1])).toContain('reviewer 驳回或要求修订候选');
    expect(JSON.stringify(resumedInvoke.mock.calls[0][1])).toContain('EVIDENCE_GAP');
    _set_SillyTavern_API_ACU(undefined);
  });

  it('内容违规候选留给容错提交，预检不再把整个 specialist 判失败', async () => {
    const { registry, evidence, promptContext } = fixture('preflight-reject');
    const badCandidate = {
      candidateId: 'candidate:preflight-bad', agentName: 'undercurrent-analyst',
      patch: { seeds: { upsert: [{ id: 'seed-bad', title: '坏种子', actorIds: ['actor-missing'] }] } },
      summary: '引用不存在角色', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['dimensions', 'seeds'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: badCandidate.agentName, status: 'candidate' as const, summary: badCandidate.summary, candidate: badCandidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'undercurrent-analyst', instruction: '分析维度', reads: [] }] }),
      JSON.stringify({ action: 'block', reason: '等待修正', unresolved: ['preflight'] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-preflight', chatIdentity: 'chat-preflight', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-preflight', stageId: 'stage-preflight', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result).toMatchObject({ outcome: 'blocked', summary: '等待修正' });
    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentName: 'undercurrent-analyst', status: 'candidate', candidate: badCandidate }),
    ]));
    expect(subagents.runReviewer).toHaveBeenCalled();
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('候选入库预检拒绝');
  });

  it('open_round 后投影只由 guidance-composer 产出，审核员不夹带 guidance', async () => {
    const { registry, evidence, promptContext } = fixture('reviewer-guidance');
    const candidate = {
      candidateId: 'run-guidance:timekeeper:1', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '时间推进', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const guidanceCandidate = {
      candidateId: 'run-guidance:guidance-composer:1', agentName: 'guidance-composer',
      patch: { guidance: { signals: [{ text: '远处钟声响起', voice: 'ambient', sourceId: 'clock' }] } },
      summary: '投影决定', evidenceRefs: [evidence], uncertainties: [], writableModules: ['guidance'],
    };
    const subagents = {
      run: vi.fn(async ({ delegation }: { delegation: { agentName: string } }) => {
        if (delegation.agentName === 'guidance-composer') {
          return { agentName: 'guidance-composer', status: 'candidate' as const, summary: guidanceCandidate.summary, candidate: guidanceCandidate, evidenceRefs: [evidence], uncertainties: [] };
        }
        if (delegation.agentName === 'timekeeper') {
          return { agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] };
        }
        return { agentName: delegation.agentName, status: 'no_change' as const, summary: '无变化', evidenceRefs: [evidence], uncertainties: [] };
      }),
      runReviewer: vi.fn(),
    };
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => JSON.stringify({ action: 'open_round', summary: '锁定时钟', focus: '时间推进', dispatchChronicler: false })), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-guidance', chatIdentity: 'chat-guidance', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-guidance', stageId: 'stage-guidance', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result.outcome).toBe('commit');
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(result.commitCandidate.acceptedCandidates.map(item => item.agentName)).toEqual(['timekeeper', 'guidance-composer']);
    expect(result.commitCandidate.reviewer).toBeUndefined();
    expect(subagents.runReviewer).not.toHaveBeenCalled();
  });

  it('整轮派工被预算门禁拦截时当轮显式 block 并写入预算终局', async () => {
    const { registry, promptContext } = fixture('delegation-gate-silent');
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    const invoke = vi.fn(async () => JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'timekeeper', instruction: '分析时间', reads: [] }] }));
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-gate-silent', chatIdentity: 'chat-gate-silent', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-gate-silent', stageId: 'stage-gate-silent', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxSameAgent = 0;

    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'blocked', summary: '派工被预算门禁拦截，无可派工角色' });
    expect(result.unresolved?.join('\n')).toContain('同角色派工预算已耗尽');
    expect(subagents.run).not.toHaveBeenCalled();
    expect(subagents.runReviewer).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledOnce();
    expect(readWorldSimulationSessionLog_ACU(identity.chatIdentity).some(item => item.kind === 'delegation')).toBe(false);
    expect(readWorldSimulationSessionLog_ACU(identity.chatIdentity).some(item => item.kind === 'block')).toBe(true);
    const state = readWorldSimulationRunState_ACU(identity.chatIdentity, identity.taskId, `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`);
    expect(state).toMatchObject({ budgetExhausted: true, reviewerFeedback: 'delegation gate exhausted' });
    expect(state?.handoffSummary).toContain('交接');
  });

  it('部分派工被并行预算拦截时只回灌原因且不调用被拦角色', async () => {
    const { registry, evidence, promptContext } = fixture('delegation-gate-partial');
    const subagents = {
      run: vi.fn(async ({ delegation }: any) => ({ agentName: delegation.agentName, status: 'no_change' as const, summary: '无变化', evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [
        { agentName: 'timekeeper', instruction: '分析时间', reads: [] },
        { agentName: 'lore-researcher', instruction: '分析暗流', reads: [] },
      ] }),
      JSON.stringify({ action: 'block', reason: '被拦后收敛', unresolved: ['等待下一轮预算'] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-gate-partial', chatIdentity: 'chat-gate-partial', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-gate-partial', stageId: 'stage-gate-partial', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxConcurrent = 1;

    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'blocked', summary: '被拦后收敛' });
    expect(subagents.run).toHaveBeenCalledOnce();
    expect(subagents.run.mock.calls[0][0].delegation.agentName).toBe('timekeeper');
    const secondCall = JSON.stringify(invoke.mock.calls[1][1]);
    expect(secondCall).toContain('预算门禁拦截');
    expect(secondCall).toContain('并行派工预算已耗尽');
    expect(secondCall).toContain('lore-researcher');
    expect(readWorldSimulationSessionLog_ACU(identity.chatIdentity).filter(item => item.kind === 'delegation')).toHaveLength(1);
  });

  it('部分拒绝派工在当前请求和重启后仍保存成对的动作与完整回执', async () => {
    const { registry, evidence, promptContext } = fixture('partial-history');
    const chat: any[] = [{ message_id: 1, mes: '正文', swipe_id: 0 }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 'chat-partial-history', getCurrentChatId: () => 'chat-partial-history', saveChat } as any);
    const anchor = resolveWorldSimulationAnchor_ACU(0, chat);
    const identity = { runId: 'partial-history', chatIdentity: anchor.chatIdentity, triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
      anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-partial-history', stageId: 'stage-partial-history', stageRevision: 1 };
    const delegation = JSON.stringify({ action: 'delegate', delegations: [
      { agentName: 'timekeeper', instruction: '分析时间', reads: [] },
      { agentName: 'lore-researcher', instruction: '分析暗流', reads: [] },
    ] });
    const sent: Array<readonly { role: string; content: string }[]> = [];
    const replies = [delegation, JSON.stringify({ action: 'block', reason: '待续', unresolved: ['稍后继续'] })];
    const runSettings = settings();
    runSettings.agentRunBudget.maxConcurrent = 1;
    const subagents = { run: vi.fn(async ({ delegation }: any) => ({ agentName: delegation.agentName, status: 'no_change' as const,
      summary: '无变化', evidenceRefs: [evidence], uncertainties: [] })), runReviewer: vi.fn() };
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async (_role, messages) => { sent.push(messages); return replies.shift()!; }),
      subagents, apiPreset, countTokens: async () => 1 });
    await expect(loop.run({ identity, anchor, chat, settings: runSettings, promptContext, registry, tools }))
      .resolves.toMatchObject({ outcome: 'blocked' });
    const history = readWorldSimulationDirectorHistory_ACU(chat);
    expect(history).toHaveLength(4);
    expect(history[0].content).toBe(delegation);
    expect(history[1].content).toContain('并行派工预算已耗尽');
    expect(history[1].content).toContain('no_change');
    expect(sent[1].filter(item => item.content === delegation)).toHaveLength(1);
    expect(sent[1].filter(item => item.content === history[1].content)).toHaveLength(1);
    resetWorldSimulationRunCacheForTests_ACU();
    const resumed = vi.fn(async () => JSON.stringify({ action: 'block', reason: '继续暂停', unresolved: ['等待'] }));
    await new WorldSimulationMainLoop_ACU({ invoke: resumed, subagents, apiPreset, countTokens: async () => 1 })
      .run({ identity, anchor, chat, settings: runSettings, promptContext, registry, tools });
    expect(resumed.mock.calls[0][1].filter((item: { content: string }) => item.content === delegation)).toHaveLength(1);
    expect(resumed.mock.calls[0][1].filter((item: { content: string }) => item.content === history[1].content)).toHaveLength(1);
    _set_SillyTavern_API_ACU(undefined);
  });

  it('同批同一 specialist 并发派工时按 agent 递增 candidateSeq 且 candidateId 不碰撞', async () => {
    const { registry, evidence, promptContext } = fixture('candidate-seq');
    const subagents = {
      run: vi.fn(async ({ delegation, candidateSeq, runId }: any) => ({
        agentName: delegation.agentName,
        status: 'candidate' as const,
        summary: `时钟候选${candidateSeq}`,
        candidate: {
          candidateId: `${runId}:${delegation.agentName}:${candidateSeq}`,
          agentName: delegation.agentName,
          patch: { clock: { days: 1 } },
          summary: `时钟候选${candidateSeq}`,
          evidenceRefs: [evidence],
          uncertainties: [],
          writableModules: ['clock'],
        },
        evidenceRefs: [evidence],
        uncertainties: [],
      })),
      runReviewer: vi.fn(async ({ candidates }: any) => ({
        verdict: 'accept' as const,
        summary: '通过',
        findings: [],
        acceptedCandidateIds: candidates.map((item: any) => item.candidateId),
      })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [
        { agentName: 'timekeeper', instruction: '第一次', reads: [] },
        { agentName: 'timekeeper', instruction: '第二次', reads: [] },
      ] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交两笔时钟候选', evidenceRefs: [evidence] }),
    ];
    const invoke = vi.fn(async () => responses.shift()!);
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-candidate-seq', chatIdentity: 'chat-candidate-seq', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-candidate-seq', stageId: 'stage-candidate-seq', stageRevision: 1 };
    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });
    expect(result.outcome).toBe('commit');
    if (result.outcome !== 'commit') throw new Error('expected commit');
    expect(subagents.run.mock.calls.map(call => `${call[0].runId}:${call[0].delegation.agentName}:${call[0].candidateSeq}`)).toEqual([
      'run-candidate-seq:timekeeper:1',
      'run-candidate-seq:timekeeper:2',
    ]);
    expect(result.commitCandidate.acceptedCandidates.map(item => item.candidateId)).toEqual([
      'run-candidate-seq:timekeeper:2',
    ]);
  });

  it('预检失败不扣派工预算，连续预检失败也不会耗尽 maxDelegations', async () => {
    const { registry, evidence, promptContext } = fixture('preflight-no-budget');
    const badCandidate = {
      candidateId: 'candidate:preflight-budget', agentName: 'undercurrent-analyst',
      patch: { seeds: { upsert: [{ id: 'seed-bad', title: '坏种子', actorIds: ['actor-missing'] }] } },
      summary: '预检失败', evidenceRefs: [evidence], uncertainties: [], writableModules: ['dimensions', 'seeds'],
    };
    const goodCandidate = {
      candidateId: 'candidate:preflight-ok', agentName: 'undercurrent-analyst',
      patch: { dimensions: { upsert: [{ id: 'pressure', name: '压力', expectedRevision: 0, rationale: '', evidenceRefs: [evidence] }] } },
      summary: '预检通过', evidenceRefs: [evidence], uncertainties: [], writableModules: ['dimensions', 'seeds'],
    };
    const subagents = {
      run: vi.fn()
        .mockResolvedValueOnce({ agentName: 'undercurrent-analyst', status: 'candidate' as const, summary: badCandidate.summary, candidate: badCandidate, evidenceRefs: [evidence], uncertainties: [] })
        .mockResolvedValueOnce({ agentName: 'undercurrent-analyst', status: 'candidate' as const, summary: badCandidate.summary, candidate: { ...badCandidate, candidateId: 'candidate:preflight-budget-2' }, evidenceRefs: [evidence], uncertainties: [] })
        .mockResolvedValueOnce({ agentName: 'undercurrent-analyst', status: 'candidate' as const, summary: goodCandidate.summary, candidate: goodCandidate, evidenceRefs: [evidence], uncertainties: [] }),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '通过', findings: [], acceptedCandidateIds: [goodCandidate.candidateId] })),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'undercurrent-analyst', instruction: '第一次', reads: [] }] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'undercurrent-analyst', instruction: '第二次', reads: [] }] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'undercurrent-analyst', instruction: '第三次', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '预检后提交', evidenceRefs: [evidence] }),
    ];
    const loop = new WorldSimulationMainLoop_ACU({ invoke: vi.fn(async () => responses.shift()!), subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-preflight-budget', chatIdentity: 'chat-preflight-budget', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-preflight-budget', stageId: 'stage-preflight-budget', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxDelegations = 1;
    runSettings.agentRunBudget.maxIterations = 5;
    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });
    expect(result).toMatchObject({ outcome: 'commit', summary: '预检后提交' });
    expect(subagents.run).toHaveBeenCalledTimes(3);
    expect(subagents.runReviewer).toHaveBeenCalledTimes(3);
  });

  it('allowDelegate=false 时 delegate 当轮显式 block，不走协议重试', async () => {
    const { registry, promptContext } = fixture('delegation-budget-exhausted');
    const subagents = { run: vi.fn(), runReviewer: vi.fn() };
    const invoke = vi.fn(async () => JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'timekeeper', instruction: '分析', reads: [] }] }));
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = { runId: 'run-delegation-budget', chatIdentity: 'chat-delegation-budget', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-delegation-budget', stageId: 'stage-delegation-budget', stageRevision: 1 };
    const runSettings = settings();
    runSettings.agentRunBudget.maxDelegations = 0;
    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools });
    expect(result).toMatchObject({ outcome: 'blocked', summary: '派工预算已耗尽', unresolved: ['delegation budget exhausted'] });
    expect(invoke).toHaveBeenCalledOnce();
    expect(subagents.run).not.toHaveBeenCalled();
    const state = readWorldSimulationRunState_ACU(identity.chatIdentity, identity.taskId, `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`);
    expect(state).toMatchObject({ budgetExhausted: true, reviewerFeedback: 'delegation budget exhausted' });
    expect(state?.handoffSummary).toContain('交接');
    expect(readWorldSimulationSessionLog_ACU(identity.chatIdentity).some(item => item.kind === 'block' && item.title === '派工预算已耗尽')).toBe(true);
  });

  it('三种预算终局恢复后都重置窗口并注入交接摘要', async () => {
    const { registry, evidence, promptContext } = fixture('budget-terminals-resume');
    const candidate = {
      candidateId: 'candidate:budget-terminals', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '恢复候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const cursor = (identity: { stageId: string; stageRevision: number; baseLedgerRevision: number }) => `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`;
    const resumeAndCommit = async (chatIdentity: string, taskId: string, stageId: string, extras: { reviewerFeedback: string; budgetExhausted?: boolean }) => {
      const identity = { runId: `run-${chatIdentity}`, chatIdentity, triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId, stageId, stageRevision: 1 };
      saveWorldSimulationRunState_ACU(chatIdentity, {
        taskId, cursorKey: cursor(identity), nextIteration: 4, delegationsUsed: 4,
        perAgent: { 'timekeeper': 4 }, outcomes: [], candidateFingerprint: 'c', candidateSummary: candidate.summary,
        reviewerFeedback: extras.reviewerFeedback, candidates: [candidate],
        ...(extras.budgetExhausted ? { budgetExhausted: true } : {}),
        handoffSummary: '【更早世界推演会话交接】\n- 预置摘要',
      });
      const subagents = {
        run: vi.fn(),
        runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '恢复后通过', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
      };
      const invoke = vi.fn(async () => JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '终局后提交', evidenceRefs: [evidence] }));
      const runSettings = settings();
      runSettings.agentRunBudget.maxIterations = 2;
      const result = await new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 }).run({ identity, settings: runSettings, promptContext, registry, tools });
      expect(result).toMatchObject({ outcome: 'commit', summary: '终局后提交' });
      expect(JSON.stringify(invoke.mock.calls[0][1])).toContain('预置摘要');
      expect(subagents.run).not.toHaveBeenCalled();
    };
    await resumeAndCommit('chat-term-flag', 'task-term-flag', 'stage-term-flag', { reviewerFeedback: '', budgetExhausted: true });
    await resumeAndCommit('chat-term-iteration', 'task-term-iteration', 'stage-term-iteration', { reviewerFeedback: 'iteration budget exhausted' });
    await resumeAndCommit('chat-term-gate', 'task-term-gate', 'stage-term-gate', { reviewerFeedback: 'delegation gate exhausted' });
  });

  it('Director 自由文本 block 不写 budgetExhausted，恢复时不重置窗口', async () => {
    const { registry, evidence, promptContext } = fixture('director-block-no-reset');
    const candidate = {
      candidateId: 'candidate:director-block', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '自由文本阻断候选', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async () => ({ verdict: 'accept' as const, summary: '通过', findings: [], acceptedCandidateIds: [candidate.candidateId] })),
    };
    const identity = { runId: 'run-director-block', chatIdentity: 'chat-director-block', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task-director-block', stageId: 'stage-director-block', stageRevision: 1 };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'timekeeper', instruction: '分析', reads: [] }] }),
      JSON.stringify({ action: 'block', reason: '等待继续', unresolved: ['用户确认'] }),
    ];
    const first = new WorldSimulationMainLoop_ACU({
      invoke: vi.fn(async () => responses.shift()!),
      subagents, apiPreset, countTokens: async () => 1,
    });
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 4;
    await expect(first.run({ identity, settings: runSettings, promptContext, registry, tools })).resolves.toMatchObject({ outcome: 'blocked', summary: '等待继续' });
    const paused = readWorldSimulationRunState_ACU(identity.chatIdentity, identity.taskId, `${identity.stageId}#${identity.stageRevision}#${identity.baseLedgerRevision}`);
    expect(paused?.budgetExhausted).toBeUndefined();
    expect(paused?.delegationsUsed).toBe(1);
    expect(paused?.nextIteration).toBeGreaterThan(1);
    const invoke = vi.fn(async () => JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '自由文本后提交', evidenceRefs: [evidence] }));
    const resumed = await new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 }).run({ identity, settings: runSettings, promptContext, registry, tools });
    expect(resumed).toMatchObject({ outcome: 'commit', summary: '自由文本后提交' });
    expect(subagents.run).toHaveBeenCalledOnce();
  });

  it('候选形成后投机审核与主 Agent 下一轮重叠，commit 复用同一 fingerprint', async () => {
    const { registry, evidence, promptContext } = fixture('speculative-review-overlap');
    const candidate = {
      candidateId: 'candidate:overlap', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '时间推进', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const events: string[] = [];
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn(async () => {
        events.push('reviewer');
        return {
          verdict: 'accept' as const,
          summary: '投机审核通过',
          findings: [],
          acceptedCandidateIds: [candidate.candidateId],
        };
      }),
    };
    let directorRound = 0;
    const invoke = vi.fn(async () => {
      directorRound += 1;
      events.push(`director-${directorRound}`);
      if (directorRound === 1) {
        return JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] });
      }
      expect(events).toContain('reviewer');
      return JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交重叠审核结果', evidenceRefs: [evidence] });
    });
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const identity = {
      runId: 'run-overlap', chatIdentity: 'chat-overlap', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0,
      taskId: 'task-overlap', stageId: 'stage-overlap', stageRevision: 1,
    };

    const result = await loop.run({ identity, settings: settings(), promptContext, registry, tools });

    expect(result).toMatchObject({ outcome: 'commit', summary: '提交重叠审核结果' });
    expect(events).toEqual(['director-1', 'reviewer', 'director-2']);
    expect(subagents.runReviewer).toHaveBeenCalledOnce();
  });

  it('取证后作废投机审核，commit 改走串行审核且不复用 reject', async () => {
    const { registry, evidence, promptContext } = fixture('speculative-review-invalidate');
    const candidate = {
      candidateId: 'candidate:invalidate', agentName: 'timekeeper',
      patch: { clock: { days: 1 } }, summary: '时间推进', evidenceRefs: [evidence],
      uncertainties: [], writableModules: ['clock'],
    };
    const subagents = {
      run: vi.fn(async () => ({ agentName: candidate.agentName, status: 'candidate' as const, summary: candidate.summary, candidate, evidenceRefs: [evidence], uncertainties: [] })),
      runReviewer: vi.fn()
        .mockResolvedValueOnce({
          verdict: 'reject' as const,
          summary: '过期审核不得复用',
          findings: [{ severity: 'blocking' as const, reasonCode: 'STALE_EVIDENCE', path: '$', expected: '最新取证', actual: '审核早于 read' }],
          acceptedCandidateIds: [],
        })
        .mockResolvedValueOnce({
          verdict: 'accept' as const,
          summary: '取证后串行通过',
          findings: [],
          acceptedCandidateIds: [candidate.candidateId],
        }),
    };
    const responses = [
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: candidate.agentName, instruction: '分析时间', reads: [] }] }),
      JSON.stringify({ action: 'read', reads: ['ledger:current'] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '取证后提交', evidenceRefs: [evidence] }),
    ];
    const liveTools = {
      read: vi.fn(async () => ({ status: 'ok' as const, content: '{}', summary: '最新账本', exact: true })),
      search: vi.fn(async () => ({ status: 'empty' as const, hits: [], summary: 'empty' })),
    };
    const loop = new WorldSimulationMainLoop_ACU({
      invoke: vi.fn(async () => responses.shift()!),
      subagents, apiPreset, countTokens: async () => 1,
    });
    const identity = {
      runId: 'run-invalidate', chatIdentity: 'chat-invalidate', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1',
      anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0,
      taskId: 'task-invalidate', stageId: 'stage-invalidate', stageRevision: 1,
    };
    const runSettings = settings();
    runSettings.agentRunBudget.maxIterations = 4;

    const result = await loop.run({ identity, settings: runSettings, promptContext, registry, tools: liveTools });

    expect(result).toMatchObject({ outcome: 'commit', summary: '取证后提交' });
    expect(subagents.runReviewer).toHaveBeenCalledTimes(2);
    expect(liveTools.read).toHaveBeenCalledWith('ledger:current');
  });

  it('原生 tool_calls 的回执以 role=tool 进入下一次请求', async () => {
    const { registry, promptContext } = fixture('native-tool');
    const sent: Array<readonly { role: string; content: string; tool_call_id?: string }[]> = [];
    const replies = [
      { content: '', toolCalls: [{ id: 'call-rain', name: 'read', arguments: JSON.stringify({ reads: ['anchor:message'] }) }] },
      JSON.stringify({ action: 'block', reason: '已读锚点', unresolved: ['等待'] }),
    ];
    const invoke = vi.fn(async (_role: string, messages: readonly { role: string; content: string; tool_call_id?: string }[]) => {
      sent.push(messages);
      return replies.shift()!;
    });
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents: { run: vi.fn(), runReviewer: vi.fn() }, apiPreset, countTokens: async () => 1, nativeTools: true });
    const identity = { runId: 'native-tool', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null, anchorMessageId: 1, anchorMessageKey: 'number:1', anchorSwipeId: '0', anchorContentDigest: 'digest', baseLedgerRevision: 0, taskId: 'task', stageId: 'stage', stageRevision: 1 };
    const result = await loop.run({
      identity, settings: settings(), promptContext, registry,
      tools: { read: vi.fn(async () => ({ status: 'ok' as const, content: '山雨将至', summary: '正文' })), search: tools.search },
    });
    expect(result).toMatchObject({ outcome: 'blocked' });
    expect(sent[0]?.at(-1)?.content).not.toBe('{');
    expect(sent[1]?.some(message => message.role === 'tool' && message.tool_call_id === 'call-rain' && message.content.includes('山雨将至'))).toBe(true);
  });

});

describe('S11 推演双楼全链集成', () => {
  beforeEach(() => { resetWorldSimulationRunCacheForTests_ACU(); resetWorldSimulationSessionLogForTests_ACU(); vi.clearAllMocks(); });

  it('推演双楼全链：正文锚点→同会话逐栏写入→提交账本→等待下一正文', async () => {
    const firstBody = '山雨将至，江面压低。';
    const nextBody = '雨落九江，水寨灯火忽明忽灭。';
    const { registry, evidence, promptContext } = fixture('s11-sim');
    promptContext.anchorMessage = firstBody;
    const chat: any[] = [
      { mes: '开始推演', is_user: true },
      { message_id: 1, mes: firstBody, swipe_id: 0, is_user: false },
    ];
    const saveChat = vi.fn(async () => undefined);
    _set_SillyTavern_API_ACU({ chat, chatId: 's11-sim', getCurrentChatId: () => 's11-sim', saveChat } as any);
    const envelope = buildDefaultWorldSimulationEnvelope_ACU();
    const anchor = resolveWorldSimulationAnchor_ACU(1, chat);
    const identity = {
      runId: 's11-sim', chatIdentity: 's11-sim', triggerKind: 'assistant_completed' as const,
      triggerConversationMessageId: null, anchorMessageId: anchor.messageId, anchorMessageKey: anchor.messageKey,
      anchorSwipeId: anchor.swipeId, anchorContentDigest: anchor.contentDigest, baseLedgerRevision: 0,
      taskId: 'task-s11', stageId: 'stage-s11', stageRevision: 1,
    };
    envelope.task = { taskId: identity.taskId, originInstruction: '推进山雨', status: 'running', createdAt: 1, updatedAt: 1, activeRun: identity, stopReason: null };
    envelope.activeStageId = identity.stageId;
    envelope.stages = [{ stageId: identity.stageId, stageNumber: 1, status: 'running', activeRevision: 1,
      revisions: [{ revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
        plan: { schemaVersion: 1, title: '阶段', objective: '推进山雨', impactScope: [], factsToVerify: [], plannedTools: [],
          plannedSpecialists: [], expectedLedgerChanges: ['dimensions'], convergenceConditions: [], blockingConditions: [],
          completedSteps: [], nextStep: '提交' } }] }];
    chat[0]._qrf_world_simulation = envelope;
    const readView = () => {
      const folded = foldWorldSimulationLedger_ACU(chat);
      return { ledger: folded?.ledger ?? envelope.ledger, fields: folded?.fields, archive: foldWorldSimulationArchive_ACU(chat).snapshot };
    };
    const writes = new WorldSimulationRunWriteState_ACU(readView, 0);
    const writeSql: NonNullable<Parameters<WorldSimulationSubagentRuntime_ACU['run']>[0]['writeSql']> = write =>
      commitWorldSimulationFieldWrites_ACU({
        identity, anchor, ...write,
        assertRunLedger: view => { writes.assertCurrent(view); writes.assertPersistedProof(identity, readWorldSimulationRunWriteProof_ACU(anchor, chat)); },
        prepareRunProof: (view, refs, accepted) => writes.prepareConfirmation(identity, view, refs, accepted),
        confirmRunLedger: (view, refs, accepted) => writes.confirm(view, refs, accepted),
      });
    const scene = {
      anchorMessage: firstBody,
      summary: null,
      ledger: envelope.ledger,
      stagePlan: {},
      candidates: [],
      chronicle: [],
      projectionPreview: {},
      liveLedger: () => ({ ledger: readView().ledger, fields: readView().fields }),
    };
    const liveTools = createWorldSimulationToolDependencies_ACU(scene);
    const mainReplies = [
      JSON.stringify({ action: 'read', reads: ['anchor:message'] }),
      JSON.stringify({ action: 'delegate', delegations: [{ agentName: 'undercurrent-analyst', instruction: '把山雨写入维度', reads: [] }] }),
      JSON.stringify({ action: 'finalize', outcome: 'commit', summary: '提交山雨维度', evidenceRefs: [evidence] }),
      JSON.stringify({ action: 'read', reads: ['anchor:message'] }),
      JSON.stringify({ action: 'block', reason: '下一正文已锚定，本轮不重复提交', unresolved: ['等待后续正文再推演'] }),
    ];
    const subReplies = [
      JSON.stringify({ action: 'write_sql', sql: "INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-rain', '山雨', 0)" }),
      JSON.stringify({ action: 'write_sql', sql: "UPDATE dimensions SET kind = 'pressure', value = 10, trend = 'rising', rationale = '江面压低', evidence_refs = '[]' WHERE id = 'dim-rain' AND expected_revision = 0" }),
      JSON.stringify({ status: 'no_change', summary: '山雨已入账', evidenceRefs: [], uncertainties: [] }),
    ];
    const mainCalls: Array<readonly { role: string; content: string }[]> = [];
    const subCalls: Array<readonly { role: string; content: string }[]> = [];
    const invoke = vi.fn(async (role: string, messages: readonly { role: string; content: string }[]) => {
      if (role === 'world-director') {
        mainCalls.push(messages);
        const next = mainReplies.shift();
        if (!next) throw new Error('主会话脚本没有更多回复');
        return next;
      }
      subCalls.push(messages);
      const next = subReplies.shift();
      if (!next) throw new Error('子代理脚本没有更多回复');
      return next;
    });
    const subagents = new WorldSimulationSubagentRuntime_ACU({ invoke, apiPreset, countTokens: async () => 1 });
    const loop = new WorldSimulationMainLoop_ACU({ invoke, subagents, apiPreset, countTokens: async () => 1 });
    const runSettings = settings();
    runSettings.agentRunBudget = { ...runSettings.agentRunBudget, maxIterations: 6 };

    try {
      const first = await loop.run({
        identity, anchor, chat, settings: runSettings, promptContext, registry, tools: liveTools,
        writeSql, readCurrent: () => readView().ledger, readFieldSnapshot: () => readView().fields!, runWrites: writes,
      });
      expect(first.outcome).toBe('commit');
      if (first.outcome !== 'commit') throw new Error('expected commit');
      expect(first.summary).toBe('提交山雨维度');
      expect(first.commitCandidate.acceptedCandidates).toEqual([]);
      expect(first.outcomes).toEqual([expect.objectContaining({
        agentName: 'undercurrent-analyst', status: 'no_change', completion: 'complete_changed', summary: '山雨已入账',
      })]);

      expect(mainCalls).toHaveLength(3);
      expect(mainCalls[0].map(message => message.content).join('\n')).toContain(firstBody);
      expect(mainCalls[1].map(message => message.content).join('\n')).toContain(firstBody);
      const delegationFeedback = mainCalls[2].map(message => message.content).join('\n');
      expect(delegationFeedback).toContain('山雨已入账');
      expect(mainCalls.map(call => call.map(message => message.content).join('\n')).join('\n')).not.toContain('"status":"committed"');
      expect(subCalls).toHaveLength(3);
      const firstReceipt = subCalls[1].at(-2)?.content ?? '';
      const secondReceipt = subCalls[2].at(-2)?.content ?? '';
      expect(firstReceipt).toContain('"status":"committed"');
      expect(firstReceipt).toContain('"missingFields"');
      expect(firstReceipt).toContain('field:dimensions:dim-rain');
      expect(secondReceipt).toContain('"status":"committed"');
      expect(secondReceipt).not.toContain('dimensions#dim-rain.kind');

      expect(saveChat).toHaveBeenCalled();
      expect(chat[1][WORLD_SIMULATION_STATE_FIELD_ACU]?.entries).toEqual(expect.any(Object));
      expect(Object.keys(chat[1][WORLD_SIMULATION_STATE_FIELD_ACU].entries).length).toBeGreaterThan(0);
      const stored = readWorldSimulationLedgerFieldSnapshot_ACU(chat).records.dimensions?.['dim-rain'];
      expect(stored?.status).toBe('complete');
      expect(stored?.fields.name.value).toBe('山雨');
      expect(stored?.fields.kind.value).toBe('pressure');
      expect(stored?.fields.rationale.value).toBe('江面压低');
      expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions).toEqual([
        expect.objectContaining({ id: 'dim-rain', name: '山雨', kind: 'pressure', value: 10, trend: 'rising', rationale: '江面压低' }),
      ]);
      const committedFields = JSON.stringify(stored);

      chat.push({ message_id: 2, mes: nextBody, swipe_id: 0, is_user: false });
      const nextAnchor = resolveWorldSimulationAnchor_ACU(2, chat);
      const ledgerRevision = readView().ledger.revision;
      promptContext.anchorMessage = nextBody;
      scene.anchorMessage = nextBody;
      const secondIdentity = {
        ...identity,
        runId: 's11-sim-next',
        taskId: 'task-s11-next',
        stageId: 'stage-s11-next',
        anchorMessageId: nextAnchor.messageId,
        anchorMessageKey: nextAnchor.messageKey,
        anchorSwipeId: nextAnchor.swipeId,
        anchorContentDigest: nextAnchor.contentDigest,
        baseLedgerRevision: ledgerRevision,
      };
      const secondWrites = vi.fn();
      const second = await loop.run({
        identity: secondIdentity, anchor: nextAnchor, chat, settings: runSettings, promptContext, registry,
        tools: liveTools, readCurrent: () => readView().ledger, readFieldSnapshot: () => readView().fields!,
        writeSql: secondWrites,
      });
      expect(second).toMatchObject({ outcome: 'blocked', summary: '下一正文已锚定，本轮不重复提交' });
      expect(secondWrites).not.toHaveBeenCalled();
      expect(mainCalls).toHaveLength(5);
      expect(subCalls).toHaveLength(3);
      const resumed = mainCalls[3].map(message => message.content).join('\n');
      expect(resumed).toContain(nextBody);
      expect(resumed).toContain('提交山雨维度');
      expect(resumed).toContain('"outcome":"prepared"');
      expect(mainCalls[4].map(message => message.content).join('\n')).toContain(nextBody);
      const history = readWorldSimulationDirectorHistory_ACU(chat).map(message => message.content).join('\n');
      expect(history).toContain('"outcome":"prepared"');
      expect(history).toContain('下一正文已锚定，本轮不重复提交');
      expect(JSON.stringify(readWorldSimulationLedgerFieldSnapshot_ACU(chat).records.dimensions?.['dim-rain'])).toBe(committedFields);
      expect(foldWorldSimulationLedger_ACU(chat)?.ledger.dimensions.map(item => item.id)).toEqual(['dim-rain']);
    } finally {
      _set_SillyTavern_API_ACU(undefined);
    }
  });
});
