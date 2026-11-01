import { sha256HexSync_ACU } from '../../../../src/shared/sha256-sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLogs, getAllLogs, isApiLogEnabled, isDebugLogEnabled, isWarnLogEnabled,
  setApiLogEnabled, setDebugLogEnabled, setWarnLogEnabled } from '../../../../src/shared/log-buffer';
import { buildDefaultWorldSimulationSettings_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../../src/service/simulation/defaults';
import { runWorldRound_ACU } from '../../../../src/service/simulation/agent/world-round-runner';
import { materializeReviewedWorldRoundCandidate_ACU, materializeWorldRoundCandidate_ACU, materializeWorldRoundPreview_ACU } from '../../../../src/service/simulation/world-candidate';
import { claimWorldBodyProjection_ACU } from '../../../../src/service/simulation/agent/world-projection-stage';
import type { WorldEvent_ACU, WorldFact_ACU } from '../../../../src/service/simulation/model';
import type { AgentWorldbookSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-worldbook-read';
import type { TableDataObject_ACU } from '../../../../src/shared/models/table-data';
import { readWorldRoundPayload_ACU } from '../../../helpers/world-round-payload';

function identity(mode: 'single' | 'layered', anchorText = '正文') {
  return { runId: 'r', chatIdentity: 'chat', triggerKind: 'assistant_completed' as const, triggerConversationMessageId: null,
    anchorMessageId: 1, anchorMessageKey: '1', anchorSwipeId: '0', anchorContentDigest: sha256HexSync_ACU(anchorText), baseLedgerRevision: 0,
    taskId: 't', stageId: 's', stageRevision: 1, workflowMode: mode, workflowProtocol: 'world-round-v1' as const, deliveryTarget: 'body' as const };
}
function targetAnchor(anchorText = '正文') {
  return { chatIdentity: 'chat', messageIndex: 1, messageId: 1, messageKey: '1', swipeId: '0', contentDigest: sha256HexSync_ACU(anchorText) };
}
function actor(id: string) {
  return { id, name: id, interests: [], location: '', locationRef: null, life: 'alive' as const, diedAtDay: null, deathSummary: null, resources: [], constraints: [], informationSources: [], knownFacts: [],
    currentAction: null, shortTermAction: null, longTermAction: null, goals: [], loreRefs: [], visibility: 'hidden' as const, simulationStatus: 'active' as const, experiences: [], revision: 1 };
}
function clock(day = 1) { return { day, slot: '', storyTime: '', precision: 'unknown' as const, evidenceRefs: [] }; }
function payload(messages: Array<{ role: string; content: string }>) {
  return readWorldRoundPayload_ACU(messages);
}
function selection(data: Record<string, unknown>) {
  return { selections: (data.directory as { actorIds: string[] }).actorIds.map(actorId => ({ actorId, historyMilestoneIds: [], worldEventIds: [], factIds: [], reason: '目录无额外资料', priority: 5, scope: 'actor' })),
    worldSelection: { worldEventIds: [], factIds: [], reason: '无到期世界资料', priority: 5, scope: 'world' } };
}
function normalResponse(role: string, messages: Array<{ content: string }>) {
  if (messages[0]?.content.includes('执行 world-narrative-review-v1') || messages[0]?.content.includes('只读的正文场景审查')) {
    return JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
  }
  const data = payload(messages);
  if (data.stage === 'clock-candidate') return JSON.stringify({ candidateClock: clock() });
  if (data.stage === 'recall-selection') return JSON.stringify(selection(data));
  if (data.stage === 'world-page') {
    const selectedIds = new Set((data.page as { worldEventIds: string[] }).worldEventIds);
    const events = Object.values(data.worldMaterials as Record<string, WorldEvent_ACU>).filter(event => selectedIds.has(event.id)
      && event.nextCheck && event.nextCheck.day <= (data.candidateClock as { day: number }).day
      && event.status !== 'resolved' && event.status !== 'cancelled');
    return JSON.stringify({ worldEventWrites: events.map(event => ({ value: { ...event, nextCheck: { day: (data.candidateClock as { day: number }).day + 1, slot: '', reason: '后续复核' }, revision: event.revision + 1 }, expectedRevision: event.revision })), factWrites: [] });
  }
  const ids = data.actorIds as string[];
  return JSON.stringify({ actorWrites: [], actorCompletions: ids.map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })), actorRegistrations: [], knowledgeAcquisitions: [], factWrites: [], historyMilestoneWrites: [] });
}

function changedActorWrite(id: string) {
  return { value: { ...actor(id), goals: ['完成本轮事项'], revision: 2 }, expectedRevision: 1 };
}
function changedFact(actorId: string) {
  return { value: { id: `fact-${actorId}`, summary: '已确认的行动结果', temporalKind: 'occurrence' as const, happenedAt: { day: 1, slot: '' }, validFrom: null, validUntil: null,
    locationRef: null, actorIds: [actorId], worldEventIds: [], projectionPolicy: 'internal' as const, revealState: 'locked' as const,
    revealGate: null, nextCheck: null, sourceRefs: [], evidenceRefs: [], supersedesFactIds: [], revision: 1 }, expectedRevision: 0 };
}
function sceneFact(id: string, summary: string, patch: Partial<WorldFact_ACU> = {}): WorldFact_ACU {
  return { ...changedFact('a0').value, id, summary, actorIds: [], locationRef: { region: '城区', place: '广场' },
    projectionPolicy: 'scene', revealState: 'unlocked', happenedAt: { day: 1, slot: '' }, ...patch };
}

function relatedEvent(id: string, actorIds: string[]): WorldEvent_ACU {
  return { id, title: id, state: '进行', status: 'active', actorIds, organizationIds: [], locationRefs: [], startedAt: { day: 1, slot: '' },
    deadline: null, nextCheck: { day: 1, slot: '', reason: '检查' }, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null };
}
function milestone(id: string, actorIds: string[], sourceFactIds: string[], worldEventIds: string[] = []) {
  return { value: { id, summary: '有事实来源的重要历史', happenedAt: { day: 1, slot: '' }, actorIds, worldEventIds, locationRef: null,
    sourceFactIds, importance: 1, category: '重要变化', visibility: 'internal' as const, revision: 1, legacyRefs: [] }, expectedRevision: 0 };
}

function tableFixture(): TableDataObject_ACU {
  return { mate: { type: 'chatSheets', version: 1 }, sheet_0: {
    name: '人物记录', content: [['姓名', '状态'], ['林舟', '$ANCHOR_MESSAGE {{user}} <%= 1 + 1 %>']],
    updateConfig: { sendRowsSqlTemplate: '不应进入提示词' }, sourceData: { initNode: '不应进入提示词' },
  }, sheet_1: { name: '纪要表', content: [['日期', '纪要'], ['第一日', '钟楼修好'], ['', '']] },
    sheet_2: { name: '仅表头', content: [['标识', '内容']] }, sheet_3: { name: '空行表', content: [] },
    sheet_bad: { name: '损坏表', content: '不是行数组' },
    metadata: { name: '脚本元信息', content: [['不应进入提示词']] },
  } as unknown as TableDataObject_ACU;
}
function tableBlocks(messages: readonly { content: string }[]): unknown[] {
  return messages.flatMap(message => {
    try {
      const value = JSON.parse(message.content) as Record<string, unknown>;
      return value && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'WORLD_TABLES') ? [value.WORLD_TABLES] : [];
    } catch { return []; }
  });
}

function run(input: Parameters<typeof runWorldRound_ACU>[0]) { return runWorldRound_ACU(input); }
function baseInput(ledger = buildEmptyWorldSimulationLedger_ACU(), mode: 'single' | 'layered' = 'layered') {
  const anchorText = '正文';
  return { identity: identity(mode, anchorText), settings: buildDefaultWorldSimulationSettings_ACU(), ledger, anchorText,
    signal: new AbortController().signal, invoke: vi.fn(normalResponse), countTokens: async () => 1, isCurrent: () => true };
}

describe('整轮失败日志进入真实缓冲区', () => {
  let originalDebug: boolean;
  let originalApi: boolean;
  let originalWarn: boolean;
  beforeEach(() => {
    originalDebug = isDebugLogEnabled();
    originalApi = isApiLogEnabled();
    originalWarn = isWarnLogEnabled();
    clearLogs();
    setDebugLogEnabled(false);
    setApiLogEnabled(false);
    setWarnLogEnabled(false);
  });
  afterEach(() => {
    clearLogs();
    setDebugLogEnabled(originalDebug);
    setApiLogEnabled(originalApi);
    setWarnLogEnabled(originalWarn);
  });
  const errors = () => getAllLogs().filter(entry => entry.level === 'error');

  it('世界页拒绝真实坏事件组时记录 ID、页号和具体原因，保留独立合法事实而不泄露摘要', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('a0')];
    ledger.worldEvents = [relatedEvent('event-invalid', ['a0'])];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') return JSON.stringify({ ...selection(data), worldSelection: {
        worldEventIds: ['event-invalid'], factIds: [], reason: '到期', priority: 1, scope: 'world',
      } });
      if (data.stage === 'world-page') return JSON.stringify({
        worldEventWrites: [{ value: { ...ledger.worldEvents[0], state: '突然变化', revision: 2 }, expectedRevision: 1 }],
        factWrites: [{ ...changedFact('a0'), value: { ...changedFact('a0').value, id: 'fact-valid', summary: '不能出现在日志的秘密摘要' } }],
      });
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.ledger.facts.map(fact => fact.id)).toContain('fact-valid');
    expect(result.ledger.worldEvents[0].state).toBe('进行');
    const failure = errors().find(entry => entry.message.includes('候选组未被接收'));
    expect(failure).toMatchObject({ level: 'error', tag: '格林推演' });
    expect(failure!.message).toContain('"runId":"r"');
    expect(failure!.message).toContain('"stage":"world"');
    expect(failure!.message).toContain('"pageIndex":0');
    expect(failure!.message).toContain('"worldEventIds":["event-invalid"]');
    expect(failure!.message).toContain('"factIds":[]');
    expect(failure!.message).toContain('"actorIds":[]');
    expect(failure!.message).toContain('"historyIds":[]');
    expect(failure!.message).toContain('发生变化却缺少确定结果事实');
    expect(JSON.stringify(getAllLogs())).not.toContain('不能出现在日志的秘密摘要');
  });

  it('人物批真正坏组记录人物 ID、批号与失败原因，其他合法人物和事实继续提交', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0'), actor('a1')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [
        { value: { ...actor('a0'), life: 'invalid-life', revision: 2 }, expectedRevision: 1 },
        changedActorWrite('a1')], factWrites: [changedFact('a1')] }) : normalResponse(role, messages));
    const result = await run(input);
    expect(result.roundCandidate.actorWrites.map(write => write.value.id)).toEqual(['a1']);
    expect(result.ledger.facts.map(fact => fact.id)).toEqual(['fact-a1']);
    const failure = errors().find(entry => entry.message.includes('候选组未被接收'));
    expect(failure?.message).toContain('"stage":"actor"');
    expect(failure?.message).toContain('"batchIndex":0');
    expect(failure?.message).toContain('"actorIds":["a0"]');
    expect(failure?.message).toContain('"factIds":[]');
    expect(failure?.message).toContain('life');
    expect(failure?.message).not.toContain('已确认的行动结果');
  });

  it('非法事实组记录事实 ID 和具体时间原因，不误报合法事实', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ factWrites: [{ ...changedFact('a0'), value: { ...changedFact('a0').value, happenedAt: { day: 99, slot: '' } } },
        { ...changedFact('a0'), value: { ...changedFact('a0').value, id: 'fact-good' } }] })
      : normalResponse(role, messages));
    const result = await run(input);
    expect(result.ledger.facts.map(fact => fact.id)).toEqual(['fact-good']);
    const failure = errors().find(entry => entry.message.includes('候选组未被接收'));
    expect(failure?.message).toContain('"factIds":["fact-a0"]');
    expect(failure?.message).toContain('事实 fact-a0 尚未在候选时间成立');
    expect(failure?.message).not.toContain('fact-good');
  });

  it.each(['world-page', 'actor-batch'] as const)('%s 非 JSON 回复保留原状态并记明确阶段，不记录原文', async stage => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    const secret = 'RAW_REPLY_SECRET_绝不能进入日志';
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === stage ? secret : normalResponse(role, messages));
    const result = await run(input);
    expect(result.roundCandidate.completion).toBe('no_change');
    const failure = errors().find(entry => entry.message.includes('WORLD_ROUND_REPLY_UNPARSEABLE'));
    expect(failure?.message).toContain(`"stage":"${stage}"`);
    expect(failure?.message).toContain('"runId":"r"');
    expect(failure?.message).toContain('"reason":"WORLD_ROUND_PROTOCOL_INVALID:模型未返回唯一 JSON 对象"');
    if (stage === 'actor-batch') expect(failure?.message).toContain('"actorIds":["a0"]');
    else expect(failure?.message).toContain('"page":');
    expect(JSON.stringify(getAllLogs())).not.toContain(secret);
  });

  it('真实网络异常在 error 日志保留失败 step、运行身份和原因', async () => {
    const input = baseInput();
    input.invoke = vi.fn(async (role, messages) => {
      if (payload(messages).stage === 'world-page') throw new Error('NETWORK_ECONNRESET');
      return normalResponse(role, messages);
    });
    await expect(run(input)).rejects.toThrow('NETWORK_ECONNRESET');
    expect(errors().some(entry => entry.message.includes('阶段执行失败')
      && entry.message.includes('"step":"world-0"')
      && entry.message.includes('"agentName":"undercurrent-analyst"')
      && entry.message.includes('"runId":"r"')
      && entry.message.includes('"taskId":"t"')
      && entry.message.includes('"stageId":"s"')
      && entry.message.includes('"reason":"NETWORK_ECONNRESET"'))).toBe(true);
  });

  it('世界页执行途中取消不误记阶段 error', async () => {
    const controller = new AbortController();
    const input = baseInput(); input.signal = controller.signal;
    input.invoke = vi.fn(async (role, messages) => {
      if (payload(messages).stage === 'world-page') controller.abort();
      return normalResponse(role, messages);
    });
    await expect(run(input)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(errors()).toEqual([]);
  });
});

describe('新整轮 runner', () => {
  it('人物对象只改变字段顺序不生成虚假写入或阻断保存', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      if (payload(messages).stage === 'actor-batch') return JSON.stringify({ actorWrites: [{
        value: Object.fromEntries(Object.entries(ledger.actors[0]).reverse()), expectedRevision: 1,
      }] });
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.roundCandidate.actorWrites).toEqual([]);
    expect(result.roundCandidate.completion).toBe('no_change');
    expect(result.ledger.actors).toEqual(ledger.actors);
  });
  it.each(['single', 'layered'] as const)('%s 每个业务阶段实际请求可读完整表格（含纪要及空表），只读不改变候选账本', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const before = structuredClone(ledger);
    const tableData = tableFixture();
    const beforeTables = structuredClone(tableData);
    const expected = [
      { sheetKey: 'sheet_0', name: '人物记录', content: [['姓名', '状态'], ['林舟', '$ANCHOR_MESSAGE {{user}} <%= 1 + 1 %>']] },
      { sheetKey: 'sheet_1', name: '纪要表', content: [['日期', '纪要'], ['第一日', '钟楼修好'], ['', '']] },
      { sheetKey: 'sheet_2', name: '仅表头', content: [['标识', '内容']] },
      { sheetKey: 'sheet_3', name: '空行表', content: [] },
    ];
    const stages: string[] = [];
    const input = { ...baseInput(ledger, mode), tableData };
    input.settings.workflowMode = mode;
    input.invoke = vi.fn(async (role, messages) => {
      const stage = String(payload(messages).stage);
      stages.push(stage);
      const blocks = tableBlocks(messages);
      expect(blocks, stage).toEqual([expected]);
      const text = JSON.stringify(messages);
      expect(text).toContain('$ANCHOR_MESSAGE {{user}} <%= 1 + 1 %>');
      expect(text).not.toContain('不应进入提示词');
      expect(text).not.toContain('损坏表');
      expect(text).not.toContain('脚本元信息');
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(stages).toEqual(['clock-candidate', 'recall-selection', 'world-page', 'actor-batch']);
    expect(result.roundCandidate.completion).toBe('no_change');
    expect(result.ledger).toEqual({ ...before, revision: before.revision + 1 });
    expect(ledger).toEqual(before);
    expect(tableData).toEqual(beforeTables);
  });

  it.each(['single', 'layered'] as const)('%s 自定义重复占位符只送一次真实表格，未用占位符的阶段仍末尾补齐', async mode => {
    const input = { ...baseInput(buildEmptyWorldSimulationLedger_ACU(), mode), tableData: tableFixture() };
    input.settings.workflowMode = mode;
    input.settings.worldRoundPrompts = { 'clock-recaller': [{ role: 'user', content: '自定义读表 $WORLD_TABLES 再读 $WORLD_TABLES', enabled: true, deletable: true, pinned: false }] };
    const stages: string[] = [];
    input.invoke = vi.fn(async (role, messages) => {
      const stage = String(payload(messages).stage); stages.push(stage);
      const blocks = tableBlocks(messages);
      if (stage === 'clock-candidate' || stage === 'recall-selection') {
        expect(blocks).toEqual([expect.arrayContaining([expect.objectContaining({ sheetKey: 'sheet_1', content: [['日期', '纪要'], ['第一日', '钟楼修好'], ['', '']] })]), '资料已提供，请勿重复请求。']);
      } else {
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual(expect.arrayContaining([expect.objectContaining({ sheetKey: 'sheet_1' })]));
      }
      return normalResponse(role, messages);
    });
    await run(input);
    expect(stages).toEqual(['clock-candidate', 'recall-selection', 'world-page', 'actor-batch']);
  });

  it.each(['single', 'layered'] as const)('%s 未提供或没有有效表格时每个阶段仍提供空数组', async mode => {
    for (const tableData of [undefined, { ...tableFixture(), sheet_0: null, sheet_1: {}, sheet_2: { name: '坏表' }, sheet_3: { name: '损坏', content: '不是行数组' } } as unknown as TableDataObject_ACU]) {
      const input = { ...baseInput(buildEmptyWorldSimulationLedger_ACU(), mode), tableData };
      input.settings.workflowMode = mode;
      const stages: string[] = [];
      input.invoke = vi.fn(async (role, messages) => {
        stages.push(String(payload(messages).stage));
        expect(tableBlocks(messages)).toEqual([[]]);
        return normalResponse(role, messages);
      });
      await run(input);
      expect(stages).toEqual(['clock-candidate', 'recall-selection', 'world-page', 'actor-batch']);
    }
  });

  it.each(['single', 'layered'] as const)('%s 没有旧事件和旧事实、正文未提及时仍可从世界背景新建比赛并物化', async mode => {
    const input = baseInput(buildEmptyWorldSimulationLedger_ACU(), mode);
    input.settings.workflowMode = mode;
    const event: WorldEvent_ACU = { ...relatedEvent('event-band-contest', []), title: '本地乐队交流赛',
      state: '场馆开始筹备，开放报名', nextCheck: { day: 2, slot: '', reason: '核对报名进展' } };
    const fact: WorldFact_ACU = { ...sceneFact('fact-contest-announced', '场馆已开始筹备乐队交流赛并开放报名'),
      actorIds: [], locationRef: null, worldEventIds: [event.id], projectionPolicy: 'internal', revealState: 'locked' };
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'world-page') {
        expect(data.worldMaterials).toEqual({});
        expect(messages[0].content).toContain('不要求正文先提及');
        expect(messages[0].content).not.toContain('可由本页事实支持的新事件');
        expect(messages.map(message => message.content).join('\n')).toContain('乐队或场馆可以发起比赛');
        return JSON.stringify({ worldEventWrites: [{ value: event, expectedRevision: 0 }],
          factWrites: [{ value: fact, expectedRevision: 0 }] });
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.ledger.worldEvents).toEqual([event]);
    expect(result.ledger.facts).toEqual([fact]);
    expect(result.roundCandidate.completion).toBe('changed');
    expect(input.ledger.worldEvents).toEqual([]);
    expect(input.ledger.facts).toEqual([]);
  });

  it.each(['single', 'layered'] as const)('%s 世界页按基准与候选明确日期归一化真实双事件双事实，坏条目不拖垮同页合法组', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.clock = { day: 7, slot: '清晨', storyTime: '2026年4月10日', precision: 'exact', evidenceRefs: [] };
    ledger.player.location = { region: '北岸', place: '码头' };
    ledger.actors = [actor('a0')];
    const before = structuredClone(ledger);
    const input = baseInput(ledger, mode); input.settings.workflowMode = mode;
    const filteredDetails: string[] = [];
    input.onProgress = (key, event) => { if (key.startsWith('filtered-')) filteredDetails.push(event.detail ?? ''); };
    const expectedClock = { day: 9, slot: '午后', storyTime: '2026年4月12日', precision: 'exact', evidenceRefs: [] };
    const worldEventWrites = [
      { value: { id: 'harbor-transfer', title: '北岸物资转运', state: '货物正在清点', status: 'active', actorIds: ['a0'], organizationIds: [],
        locationRefs: ['粮站'], startedAt: '2026-04-11', deadline: '2026-04-13', nextCheck: { day: '2026-04-12', slot: '傍晚' },
        revision: 0, legacy: false }, expectedRevision: 0 },
      { value: { id: 'repair-shift', title: '灯塔维修排班', state: '次日准备开工', status: 'scheduled', actorIds: ['a0'],
        locationRefs: ['灯塔'], startedAt: '2026-04-12', nextCheck: null, revision: 0, legacy: false }, expectedRevision: 0 },
      { value: { id: 'bad-event', title: '无效事件', state: '不存在的状态', status: 'imaginary', actorIds: ['a0'], startedAt: '2026-04-12', revision: 0 }, expectedRevision: 0 },
    ];
    const factWrites = [
      { value: { id: 'harbor-count', summary: '粮站已经完成物资清点', temporalKind: 'occurrence', happenedAt: '2026-04-11',
        locationRef: '粮站', actorIds: ['a0'], worldEventIds: ['harbor-transfer'], projectionPolicy: 'internal', revealState: 'locked',
        nextCheck: { day: '2026-04-12' }, revision: 0 }, expectedRevision: 0 },
      { value: { id: 'repair-notice', summary: '灯塔维修排班已经公布', temporalKind: 'condition', validFrom: '2026-04-12',
        locationRef: '灯塔', actorIds: ['a0'], worldEventIds: ['repair-shift'], projectionPolicy: 'internal', revealState: 'locked',
        revision: 0 }, expectedRevision: 0 },
      { value: { id: 'bad-fact', summary: '非法事实', temporalKind: 'imaginary', happenedAt: '2026-04-12',
        actorIds: ['a0'], worldEventIds: [], revision: 0 }, expectedRevision: 0 },
    ];
    let actorSawOverlay = false;
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'clock-candidate') return JSON.stringify({ candidateClock: expectedClock });
      if (data.stage === 'world-page') {
        expect(data.baseClock).toEqual(ledger.clock);
        expect(data.candidateClock).toEqual(expectedClock);
        return JSON.stringify({ worldEventWrites, factWrites });
      }
      if (data.stage === 'actor-batch') {
        const overlay = data.worldOverlay as { worldEvents: WorldEvent_ACU[]; facts: WorldFact_ACU[] };
        expect(overlay.worldEvents.map(item => item.id).sort()).toEqual(['harbor-transfer', 'repair-shift']);
        expect(overlay.facts.map(item => item.id).sort()).toEqual(['harbor-count', 'repair-notice']);
        expect(overlay.worldEvents.find(item => item.id === 'harbor-transfer')).toMatchObject({ startedAt: { day: 8, slot: '' }, deadline: { day: 10, slot: '' },
          nextCheck: { day: 9, slot: '傍晚', reason: expect.any(String) }, legacy: null, revision: 1, locationRefs: [{ region: '粮站' }] });
        expect(overlay.worldEvents.find(item => item.id === 'repair-shift')).toMatchObject({ startedAt: { day: 9, slot: '' },
          nextCheck: null,
          legacy: null, revision: 1, locationRefs: [{ region: '灯塔' }], organizationIds: [], relatedEventIds: [], evidenceRefs: [], tags: [] });
        expect(overlay.facts.find(item => item.id === 'harbor-count')).toMatchObject({ happenedAt: { day: 8, slot: '' },
          nextCheck: { day: 9, slot: '', reason: expect.any(String) }, locationRef: { region: '粮站' }, revision: 1, sourceRefs: [], supersedesFactIds: [] });
        expect(overlay.facts.find(item => item.id === 'repair-notice')).toMatchObject({ validFrom: { day: 9, slot: '' },
          locationRef: { region: '灯塔' }, revision: 1, evidenceRefs: [] });
        actorSawOverlay = true;
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(actorSawOverlay).toBe(true);
    expect(result.roundCandidate.worldEventWrites.map(write => write.value.id).sort()).toEqual(['harbor-transfer', 'repair-shift']);
    expect(result.roundCandidate.factWrites.map(write => write.value.id).sort()).toEqual(['harbor-count', 'repair-notice']);
    expect(result.ledger.worldEvents.map(item => item.id).sort()).toEqual(['harbor-transfer', 'repair-shift']);
    expect(result.ledger.facts.map(item => item.id).sort()).toEqual(['harbor-count', 'repair-notice']);
    expect(result.roundCandidate.completion).toBe('changed');
    expect(filteredDetails).toContain('本页跳过 2 组无效写入，其余合法结果继续保存。');
    expect(ledger).toEqual(before);
  });

  it.each(['single', 'layered'] as const)('%s 在模型未返回前报告运行中，校验通过后按阶段更新同一卡片', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger, mode);
    const events: Array<{ key: string; event: Parameters<NonNullable<Parameters<typeof run>[0]['onProgress']>>[1] }> = [];
    input.invoke = vi.fn(async (role, messages) => {
      if (payload(messages).stage === 'clock-candidate') return new Promise<string>(resolve => { release = () => resolve(normalResponse(role, messages)); });
      return normalResponse(role, messages);
    });
    let release: (() => void) | undefined;
    const pending = run({ ...input, onProgress: (key, event) => { events.push({ key, event }); } });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(events.map(({ key, event }) => [key, event.status])).toEqual([['clock-candidate', 'running']]);
    release!();
    await pending;
    expect(events.map(({ key, event }) => [key, event.status])).toEqual([
      ['clock-candidate', 'running'], ['clock-candidate', 'done'],
      ['recall-0', 'running'], ['recall-0', 'done'],
      ['world-0', 'running'], ['world-0', 'done'],
      ['actor-0', 'running'], ['actor-0', 'done'],
      ['candidate-check', 'running'], ['candidate-check', 'done'],
    ]);
    expect(events.find(item => item.key === 'world-0')?.event.agentName).toBe('undercurrent-analyst');
    expect(events.find(item => item.key === 'actor-0')?.event.agentName).toBe(mode === 'single' ? 'undercurrent-analyst' : 'dramatis-keeper');
    expect(events.every(item => item.event.kind === 'delegation' && item.event.title.includes('第') === (['recall-0', 'world-0', 'actor-0'].includes(item.key)))).toBe(true);
  });

  it('世界页网络请求途中取消仍拒绝整轮，不把已返回世界写入物化', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const before = structuredClone(ledger);
    const controller = new AbortController();
    const input = baseInput(ledger); input.signal = controller.signal;
    input.invoke = vi.fn(async (role, messages) => {
      if (payload(messages).stage !== 'world-page') return normalResponse(role, messages);
      controller.abort();
      return JSON.stringify({ worldEventWrites: [{ value: relatedEvent('late-event', ['a0']), expectedRevision: 0 }], factWrites: [] });
    });
    await expect(run(input)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(ledger).toEqual(before);
    expect(input.invoke.mock.calls.some(([, messages]) => payload(messages).stage === 'actor-batch')).toBe(false);
  });

  it('世界书选择与整段补读、正文联合审查也报告阶段状态，不将敏感资料写进事件', async () => {
    const secret = '绝密设定正文与林舟姓名';
    const snapshot: AgentWorldbookSnapshot_ACU = { available: true, entries: [
      { bookName: '设定', uid: 'one', title: '秘密', keys: ['正文'], constant: false, content: secret, tokens: 1 },
    ] };
    const input = { ...baseInput(), worldbookSnapshot: snapshot, targetAnchor: targetAnchor() };
    const events: Array<{ key: string; event: Parameters<NonNullable<Parameters<typeof run>[0]['onProgress']>>[1] }> = [];
    input.invoke = vi.fn(async (role, messages) => {
      if (messages[0]?.content.includes('你执行只读联合正文审查')) return JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
      return payload(messages).stage === 'worldbook-selection'
        ? JSON.stringify({ refs: [{ bookName: '设定', uid: 'one' }] }) : normalResponse(role, messages);
    });
    await run({ ...input, onProgress: (key, event) => { events.push({ key, event }); } });
    for (const key of ['worldbook-selection', 'worldbook-clock-read', 'narrative-review']) {
      expect(events.filter(item => item.key === key).map(item => item.event.status)).toEqual(['running', 'done']);
    }
    expect(events.filter(item => item.key === 'narrative-review').every(item => item.event.agentName === 'guidance-composer')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain('林舟');
    expect(JSON.stringify(events)).not.toContain('设定');
  });

  it('解释字段与缺失覆盖证明不阻断后批，进度不回显模型原文', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0'), actor('a1')];
    const input = { ...baseInput(ledger), actorPageSize: 1 };
    const events: Array<{ key: string; event: Parameters<NonNullable<Parameters<typeof run>[0]['onProgress']>>[1] }> = [];
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [], secret: '林舟秘密' }) : normalResponse(role, messages));
    const result = await run({ ...input, onProgress: (key, event) => { events.push({ key, event }); } });
    expect(result.roundCandidate.actorCompletions).toEqual(['a0', 'a1'].map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })));
    expect(events.filter(item => item.key === 'actor-0').map(item => item.event.status)).toEqual(['running', 'done']);
    expect(events.map(item => item.key)).toContain('actor-1');
    expect(events.map(item => item.key)).toContain('candidate-check');
    expect(JSON.stringify(events)).not.toContain('林舟秘密');
  });

  it('联合审查失败时最终候选检查不应报告通过', async () => {
    const input = { ...baseInput(), targetAnchor: targetAnchor() };
    input.invoke = vi.fn(async (role, messages) => {
      if (messages[0]?.content.includes('你执行只读联合正文审查')) throw new Error('REVIEW_NETWORK_FAILED');
      return normalResponse(role, messages);
    });
    const events: Array<{ key: string; status: string | undefined }> = [];
    await expect(run({ ...input, onProgress: (key, event) => { events.push({ key, status: event.status }); } }))
      .rejects.toThrow('模型调用失败');
    expect(events.slice(-4)).toEqual([
      { key: 'candidate-check', status: 'running' },
      { key: 'narrative-review', status: 'running' },
      { key: 'narrative-review', status: 'failed' },
      { key: 'candidate-check', status: 'failed' },
    ]);
  });

  it('省略进度回调保持原有候选结果', async () => {
    const result = await run(baseInput());
    expect(result.roundCandidate.completion).toBe('no_change');
  });
  it.each(['single', 'layered'] as const)('%s 自定义业务提示词按角色进入请求且在运行开始冻结', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger, mode);
    const segment = (content: string, enabled = true) => ({ role: 'system', content, enabled, deletable: true, pinned: false });
    input.settings.worldRoundPrompts = { 'clock-recaller': [segment('CUSTOM_CLOCK')], 'world-simulator': [segment('CUSTOM_SINGLE')],
      'world-event-analyst': [segment('CUSTOM_WORLD')], 'actor-simulator': [segment('CUSTOM_ACTOR'), segment('DISABLED_ACTOR', false)] };
    const seen: string[] = [];
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      const text = JSON.stringify(messages);
      expect(text).not.toContain('DISABLED_ACTOR');
      if (data.stage === 'clock-candidate') {
        expect(text).toContain('CUSTOM_CLOCK');
        input.settings.worldRoundPrompts!['actor-simulator']![0].content = 'MUTATED_ACTOR';
      }
      if (data.stage === 'world-page') expect(text).toContain(mode === 'single' ? 'CUSTOM_SINGLE' : 'CUSTOM_WORLD');
      if (data.stage === 'actor-batch') {
        expect(text).toContain(mode === 'single' ? 'CUSTOM_SINGLE' : 'CUSTOM_ACTOR');
        expect(text).not.toContain('MUTATED_ACTOR');
      }
      seen.push(String(data.stage));
      return normalResponse(role, messages);
    });
    await run(input);
    expect(seen).toContain('actor-batch');
  });

  it('自定义业务段纳入最终完整请求预算，超限不调用模型', async () => {
    const input = baseInput();
    input.settings.worldRoundPrompts = { 'clock-recaller': [{ role: 'system', content: 'LARGE_CUSTOM'.repeat(2000), enabled: true, deletable: true, pinned: false }] };
    input.countTokens = async text => text.length;
    input.settings.agentHistoryTokenBudget = 1000;
    await expect(run(input)).rejects.toThrow('WORLD_ROUND_BUDGET_REJECTED');
    expect(input.invoke).not.toHaveBeenCalled();
  });

  it.each(['single', 'layered'] as const)('%s 页外发送者仅提供已提交传播候选，不泄漏完整人物资料', async mode => {
    const place = { region: '北境', place: '钟楼' };
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = Array.from({ length: 25 }, (_, index) => ({ ...actor(`a${String(index).padStart(2, '0')}`), locationRef: place }));
    ledger.actors[0] = { ...ledger.actors[0], name: '守卫', informationSources: ['当面告知'] };
    ledger.actors[24] = { ...ledger.actors[24], name: '信使', knownFacts: ['北门关闭', '不相关私密认知'], resources: ['发送者私密资源'] };
    const source = { ...changedFact('a00').value, id: 'communication', summary: '信使通过当面告知向守卫说明北门关闭。',
      actorIds: ['a00', 'a24'], locationRef: place };
    ledger.facts = [source];
    const before = structuredClone(ledger);
    const input = baseInput(ledger, mode);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') {
        const selected = selection(data);
        selected.selections = selected.selections.map(row => ({ ...row, factIds: row.actorId === 'a00' ? ['communication'] : [] }));
        return JSON.stringify(selected);
      }
      if (data.stage !== 'actor-batch' || !(data.actorIds as string[]).includes('a00')) return normalResponse(role, messages);
      expect(data.knowledgeSources).toEqual([{ actorId: 'a00', sourceActorId: 'a24', sourceFactId: 'communication', knowledge: '北门关闭', channel: '当面告知', locationRef: place }]);
      expect(JSON.stringify(data)).not.toContain('不相关私密认知');
      expect(JSON.stringify(data)).not.toContain('发送者私密资源');
      return JSON.stringify({ actorWrites: [{ expectedRevision: 1, value: { ...ledger.actors[0], knownFacts: ['北门关闭'], revision: 2 } }],
        actorCompletions: (data.actorIds as string[]).map(actorId => ({ actorId, completion: actorId === 'a00' ? 'changed' : 'no_change', expectedRevision: 1 })),
        knowledgeAcquisitions: [{ actorId: 'a00', sourceActorId: 'a24', sourceFactId: 'communication', knowledge: '北门关闭', channel: '当面告知',
          evidenceQuote: source.summary, acquiredAt: { day: 1, slot: '' }, locationRef: place }], factWrites: [], historyMilestoneWrites: [] });
    });
    const result = await run(input);
    expect(result.ledger.actors[0].knownFacts).toEqual(['北门关闭']);
    expect(result.roundCandidate.actorCompletions).toHaveLength(25);
    expect(result.ledger.facts[0].revealState).toBe('locked');
    expect(ledger).toEqual(before);
  });

  it('同轮新造传播事实不能立即作为认知来源', async () => {
    const place = { region: '北境', place: '钟楼' };
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [{ ...actor('receiver'), name: '守卫', locationRef: place, informationSources: ['当面告知'] },
      { ...actor('sender'), name: '信使', locationRef: place, knownFacts: ['北门关闭'] }];
    const source = { ...changedFact('receiver').value, id: 'new-communication', actorIds: ['receiver', 'sender'], locationRef: place,
      summary: '信使通过当面告知向守卫说明北门关闭。' };
    const before = structuredClone(ledger);
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'world-page') return JSON.stringify({ worldEventWrites: [], factWrites: [{ value: source, expectedRevision: 0 }] });
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      expect(data.knowledgeSources).toEqual([]);
      return JSON.stringify({ actorWrites: [{ expectedRevision: 1, value: { ...ledger.actors[0], knownFacts: ['北门关闭'], revision: 2 } }],
        actorCompletions: [{ actorId: 'receiver', completion: 'changed', expectedRevision: 1 }, { actorId: 'sender', completion: 'no_change', expectedRevision: 1 }],
        knowledgeAcquisitions: [{ actorId: 'receiver', sourceActorId: 'sender', sourceFactId: source.id, knowledge: '北门关闭', channel: '当面告知',
          evidenceQuote: source.summary, acquiredAt: { day: 1, slot: '' }, locationRef: place }], factWrites: [], historyMilestoneWrites: [] });
    });
    const result = await run(input);
    expect(result.ledger.actors.find(item => item.id === 'receiver')?.knownFacts).toEqual([]);
    expect(ledger).toEqual(before);
  });

  it('前批刚获得的认知不能在后批零时间继续转传', async () => {
    const place = { region: '北境', place: '钟楼' };
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [{ ...actor('a'), name: '阿甲', locationRef: place, informationSources: ['当面告知'] },
      { ...actor('b'), name: '阿乙', locationRef: place, informationSources: ['当面告知'] }];
    const source = { ...changedFact('a').value, id: 'claimed-relay', actorIds: ['a', 'b'], locationRef: place,
      summary: '阿甲通过当面告知向阿乙说明北门关闭。' };
    ledger.facts = [source, { ...source, id: 'second-relay' }];
    const before = structuredClone(ledger);
    const input = { ...baseInput(ledger), actorPageSize: 1, anchorText: '阿甲听到北门关闭。' };
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') {
        const selected = selection(data);
        selected.selections = selected.selections.map(row => ({ ...row, factIds: [...(data.directory as { dueFactIds: string[] }).dueFactIds] }));
        return JSON.stringify(selected);
      }
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      expect(data.knowledgeSources).toEqual([]);
      const id = (data.actorIds as string[])[0];
      const current = ledger.actors.find(item => item.id === id)!;
      return JSON.stringify({ actorWrites: [{ expectedRevision: 1, value: { ...current, knownFacts: ['北门关闭'], revision: 2 } }],
        actorCompletions: [{ actorId: id, completion: 'changed', expectedRevision: 1 }],
        knowledgeAcquisitions: [{ actorId: id, knowledge: '北门关闭', channel: '当面告知',
          evidenceQuote: id === 'a' ? input.anchorText : source.summary, acquiredAt: { day: 1, slot: '' }, locationRef: place,
          ...(id === 'b' ? { sourceActorId: 'a', sourceFactId: 'second-relay' } : {}) }], factWrites: [], historyMilestoneWrites: [] });
    });
    const result = await run(input);
    expect(result.ledger.actors.find(item => item.id === 'b')?.knownFacts).toEqual([]);
    expect(ledger).toEqual(before);
  });

  it('传播候选参与联合资料预算，超额时不发送人物请求', async () => {
    const place = { region: '北境', place: '钟楼' };
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [{ ...actor('receiver'), name: '守卫', locationRef: place, informationSources: ['当面告知'] },
      { ...actor('sender'), name: '信使', locationRef: place, knownFacts: ['北门关闭'] }];
    ledger.facts = [{ ...changedFact('receiver').value, id: 'communication', actorIds: ['receiver', 'sender'], locationRef: place,
      summary: '信使通过当面告知向守卫说明北门关闭。' }];
    const input = baseInput(ledger);
    const stages: string[] = [];
    input.countTokens = async text => text.includes('"knowledgeSources":[{') && text.includes('"combinedMaterials"') ? 1_000_000 : 1;
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      stages.push(String(data.stage));
      if (data.stage === 'recall-selection') {
        const selected = selection(data);
        selected.selections = selected.selections.map(row => ({ ...row, factIds: ['communication'] }));
        return JSON.stringify(selected);
      }
      return normalResponse(role, messages);
    });
    await expect(run(input)).rejects.toThrow('WORLD_ROUND_RECALL_DENIED');
    expect(stages).not.toContain('actor-batch');
  });

  it('未出场 active 人物姓名及精确 loreRefs 进入安全目录，inactive 人物与无效引用不扩权', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [
      { ...actor('active'), name: '顾南', loreRefs: ['设定:无词', '设定:不存在', '别书:秘密'] },
      { ...actor('archived'), name: '归隐者', loreRefs: ['设定:秘密'], simulationStatus: 'archived' },
    ];
    const snapshot: AgentWorldbookSnapshot_ACU = { available: true, entries: [
      { bookName: '设定', uid: 'name', title: '顾南设定', keys: ['顾南'], constant: false, content: '顾南基础设定', tokens: 1 },
      { bookName: '设定', uid: 'no-key', title: '无词设定', keys: [], constant: false, content: '无关键词基础设定', tokens: 1 },
      { bookName: '设定', uid: '无词', title: '明示设定', keys: [], constant: false, content: '显式引用正文', tokens: 1 },
      { bookName: '设定', uid: '秘密', title: '秘密', keys: ['归隐者'], constant: false, content: '归隐者私密正文', tokens: 1 },
    ] };
    const input = { ...baseInput(ledger), worldbookSnapshot: snapshot };
    let directory: Array<{ uid: string }> = [];
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'worldbook-selection') {
        directory = data.directory as Array<{ uid: string }>;
        expect(JSON.stringify(data)).not.toContain('顾南基础设定');
        expect(JSON.stringify(data)).not.toContain('归隐者私密正文');
        return JSON.stringify({ refs: [{ bookName: '设定', uid: 'name' }, { bookName: '设定', uid: '无词' }] });
      }
      if (data.stage === 'actor-batch') {
        expect(JSON.stringify(data.worldbook)).toContain('顾南基础设定');
        expect(JSON.stringify(data.worldbook)).toContain('显式引用正文');
        expect(JSON.stringify(data)).not.toContain('归隐者私密正文');
      }
      return normalResponse(role, messages);
    });
    await run(input);
    expect(directory.map(item => item.uid)).toEqual(['name', '无词']);
    expect(snapshot.entries.every(item => item.constant === false)).toBe(true);
  });

  it.each(['single', 'layered'] as const)('%s 每页看到全事件概览，未到期与已结束旧事不因空召回选择被隐藏，后页继承新事件', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = Array.from({ length: 17 }, (_, i) => ({ ...relatedEvent(`old-${String(i).padStart(2, '0')}`, []),
      title: `已有进程${i}`, nextCheck: { day: 100, slot: '', reason: '远期参考' } }));
    ledger.worldEvents[1].status = 'paused';
    ledger.worldEvents[2].status = 'resolved';
    ledger.worldEvents[2].nextCheck = null;
    ledger.worldEvents[3].status = 'cancelled';
    ledger.worldEvents[3].nextCheck = null;
    const original = structuredClone(ledger);
    const created = { ...relatedEvent('new-competition', []), nextCheck: null };
    const input = baseInput(ledger, mode);
    let worldCalls = 0;
    const detailedIds: string[] = [];
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'world-page') {
        const directory = data.eventDirectory as Array<{ id: string; status: string; title: string }>;
        expect(directory.filter(event => event.id.startsWith('old-'))).toHaveLength(17);
        expect(directory).toContainEqual(expect.objectContaining({ id: 'old-02', status: 'resolved' }));
        expect(directory).toContainEqual(expect.objectContaining({ id: 'old-03', status: 'cancelled' }));
        const pageIds = (data.page as { worldEventIds: string[] }).worldEventIds;
        detailedIds.push(...pageIds);
        const materials = data.worldMaterials as Record<string, WorldEvent_ACU | WorldFact_ACU>;
        pageIds.forEach(id => expect(materials[`worldEvents:${id}`]).toMatchObject({ id }));
        const occurrence = (id: string) => ({ ...changedFact('a0').value, id, actorIds: [], worldEventIds: [created.id] });
        if (worldCalls++ === 0) {
          expect(directory).not.toContainEqual(expect.objectContaining({ id: created.id }));
          return JSON.stringify({ worldEventWrites: [{ value: created, expectedRevision: 0 }],
            factWrites: [{ value: occurrence('competition-started'), expectedRevision: 0 }] });
        }
        expect(directory).toContainEqual(expect.objectContaining({ id: created.id }));
        expect(materials[`worldEvents:${created.id}`]).toMatchObject(created);
        expect(materials['facts:competition-started']).toMatchObject({ id: 'competition-started' });
        return JSON.stringify({ worldEventWrites: [], factWrites: [{ value: occurrence('competition-next-step'), expectedRevision: 0 }] });
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(worldCalls).toBe(2);
    expect(new Set(detailedIds).size).toBe(17);
    expect(detailedIds).toHaveLength(17);
    expect(result.ledger.worldEvents).toHaveLength(18);
    expect(result.ledger.worldEvents.filter(event => event.id.startsWith('old-'))).toEqual(original.worldEvents);
    expect(result.ledger.facts.map(fact => fact.id)).toEqual(['competition-started', 'competition-next-step']);
    expect(ledger).toEqual(original);
  });

  it('已读事件空写集保留原检查时间，模型明确重排 nextCheck 时照常保存', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = [relatedEvent('due', [])];
    for (const missing of [true, false]) {
      const input = baseInput(structuredClone(ledger));
      input.invoke = vi.fn(async (role, messages) => {
        const data = payload(messages);
        if (data.stage === 'recall-selection') return JSON.stringify({ selections: [], worldSelection: { worldEventIds: ['due'], factIds: [], reason: '到期', priority: 1, scope: 'world' } });
        if (data.stage === 'world-page') return JSON.stringify({ worldEventWrites: missing ? [] : [{ value: { ...ledger.worldEvents[0], nextCheck: { day: 2, slot: '', reason: '次日复查' }, revision: 2 }, expectedRevision: 1 }], factWrites: [] });
        return normalResponse(role, messages);
      });
      const result = await run(input);
      expect(result.ledger.worldEvents[0].nextCheck).toEqual(missing
        ? { day: 1, slot: '', reason: '检查' } : { day: 2, slot: '', reason: '次日复查' });
    }
  });

  it('世界书仅向已选关键词命中条目暴露正文，并让所有 stage 可见 intent context', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const snapshot: AgentWorldbookSnapshot_ACU = { available: true, entries: [
      { bookName: '书', uid: 'hit', title: '命中', keys: ['正文'], constant: false, content: '命中正文', tokens: 1 },
      { bookName: '书', uid: 'hidden', title: '未选', keys: ['无关'], constant: false, content: '未选秘密正文', tokens: 1 },
    ] };
    const stages: string[] = [];
    const input = { ...baseInput(ledger), instruction: '即时要求', userRequirements: { schemaVersion: 1 as const, requirements: ['长期约束'], updatedAt: 1 }, worldbookSnapshot: snapshot };
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages); stages.push(data.stage as string);
      expect(data.context).toEqual({ instruction: '即时要求', userRequirements: ['长期约束'] });
      if (data.stage === 'worldbook-selection') return JSON.stringify({ refs: [{ bookName: '书', uid: 'hit' }] });
      if (data.stage === 'world-page' || data.stage === 'actor-batch') {
        expect(JSON.stringify(data)).toContain('命中正文');
        expect(JSON.stringify(data)).not.toContain('未选秘密正文');
      }
      return normalResponse(role, messages);
    });
    await run(input);
    expect(stages).toContain('worldbook-selection');
    expect(stages).toContain('world-page');
    expect(stages).toContain('actor-batch');
  });

  it('召回可两轮有限 read 并将累积资料交给 finish，再供世界与人物阶段使用', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    ledger.historyMilestones = [{ id: 'recent', summary: '近期历史全文', happenedAt: { day: 1, slot: '' }, actorIds: ['a0'], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 1, category: '历史', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const due = relatedEvent('due', ['a0']); ledger.worldEvents = [due];
    const input = baseInput(ledger); let recallTurn = 0;
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') {
        recallTurn += 1;
        if (recallTurn === 1) return JSON.stringify({ action: 'read', historyByActor: { a0: ['recent'] }, worldEventIds: [], factIds: [] });
        if (recallTurn === 2) {
          expect(JSON.stringify(data.recallPreview)).toContain('近期历史全文');
          return JSON.stringify({ action: 'read', historyByActor: {}, worldEventIds: ['due'], factIds: [] });
        }
        expect(JSON.stringify(data.recallPreview)).toContain('近期历史全文');
        expect(JSON.stringify(data.recallPreview)).toContain('"id":"due"');
        return JSON.stringify({ selections: [{ actorId: 'a0', historyMilestoneIds: ['recent'], worldEventIds: ['due'], factIds: [], reason: '已读', priority: 1, scope: 'actor' }], worldSelection: { worldEventIds: ['due'], factIds: [], reason: '已读', priority: 1, scope: 'world' } });
      }
      if (data.stage === 'actor-batch') expect(JSON.stringify(data.actorMaterials)).toContain('近期历史全文');
      return normalResponse(role, messages);
    });
    await run(input);
    expect(recallTurn).toBe(3);
  });

  it('召回无效引用和重复补读保留已有资料，继续世界与人物阶段', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    ledger.historyMilestones = [
      { id: 'recent-1', summary: '一', happenedAt: { day: 1, slot: '' }, actorIds: ['a0'], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 1, category: '历史', visibility: 'internal', revision: 1, legacyRefs: [] },
      { id: 'recent-2', summary: '二', happenedAt: { day: 1, slot: '' }, actorIds: ['a0'], worldEventIds: [], locationRef: null, sourceFactIds: [], importance: 1, category: '历史', visibility: 'internal', revision: 1, legacyRefs: [] },
    ];
    for (const invalid of [
      () => ({ action: 'read', historyByActor: { a0: ['forged'] }, worldEventIds: [], factIds: [] }),
      (() => { let calls = 0; return () => ({ action: 'read', historyByActor: { a0: [calls++ === 0 ? 'recent-1' : 'recent-2'] }, worldEventIds: [], factIds: [] }); })(),
    ]) {
      const input = baseInput(structuredClone(ledger));
      input.invoke = vi.fn(async (role, messages) => {
        const data = payload(messages);
        if (data.stage === 'recall-selection') {
          const reply = invalid(); if (reply) return JSON.stringify(reply);
        }
        return normalResponse(role, messages);
      });
      const result = await run(input);
      expect(result.roundCandidate.actorCompletions).toEqual([{ actorId: 'a0', completion: 'no_change', expectedRevision: 1 }]);
      expect(JSON.stringify(result.ledger)).not.toContain('forged');
    }
  });

  it('世界书选择可有限 read 后 finish，时钟只在收到最终冻结全文后运行', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const snapshot: AgentWorldbookSnapshot_ACU = { available: true, entries: [
      { bookName: '书', uid: 'one', title: '一', keys: ['正文'], constant: false, content: '设定一全文', tokens: 1 },
      { bookName: '书', uid: 'two', title: '二', keys: ['正文'], constant: false, content: '设定二全文', tokens: 1 },
    ] };
    const input = { ...baseInput(ledger), worldbookSnapshot: snapshot };
    const stages: string[] = []; let selections = 0;
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages); stages.push(String(data.stage));
      if (data.stage === 'worldbook-selection') {
        selections += 1;
        if (selections === 1) return JSON.stringify({ action: 'read', refs: [{ bookName: '书', uid: 'one' }] });
        expect(JSON.stringify(data.worldbook)).toContain('设定一全文');
        return JSON.stringify({ refs: [{ bookName: '书', uid: 'one' }, { bookName: '书', uid: 'two' }] });
      }
      if (data.stage === 'clock-candidate') {
        expect(JSON.stringify(data.worldbook)).toContain('设定一全文');
        expect(JSON.stringify(data.worldbook)).toContain('设定二全文');
      }
      return normalResponse(role, messages);
    });
    await run(input);
    expect(stages.slice(0, 3)).toEqual(['worldbook-selection', 'worldbook-selection', 'clock-candidate']);
  });

  it('人物与世界书分别可读但联合资料超额时，不把正文交给人物模型', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [{ ...actor('a0'), resources: ['人物私密'.repeat(450)] }];
    const before = structuredClone(ledger);
    const input = { ...baseInput(ledger), worldbookSnapshot: { available: true, entries: [
      { bookName: '书', uid: 'hit', title: '命中', keys: ['正文'], constant: false, content: '世界书背景'.repeat(450), tokens: 1 },
    ] } };
    input.settings.agentReadTokenBudget = 900;
    input.countTokens = async text => Math.max(1, Math.ceil(text.length / 4));
    const stages: string[] = [];
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages); stages.push(String(data.stage));
      if (data.stage === 'worldbook-selection') return JSON.stringify({ refs: [{ bookName: '书', uid: 'hit' }] });
      return normalResponse(role, messages);
    });
    await expect(run(input)).rejects.toThrow('WORLD_ROUND_RECALL_DENIED');
    expect(stages).toContain('world-page'); expect(stages).not.toContain('actor-batch');
    expect(ledger).toEqual(before);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0])('联合资料 counter=%s 时不得调用业务模型', async invalid => {
    const input = baseInput();
    input.countTokens = async text => text.includes('"combinedMaterials"') ? invalid : Math.max(1, Math.ceil(text.length / 4));
    const stages: string[] = [];
    input.invoke = vi.fn(async (role, messages) => { stages.push(String(payload(messages).stage)); return normalResponse(role, messages); });
    await expect(run(input)).rejects.toThrow('WORLD_ROUND_READ_GATE_INVALID');
    expect(stages).not.toContain('world-page');
  });

  it('超大当前要求通过最终 prompt gate 拒绝，损坏长期要求不降级为空', async () => {
    const oversized = { ...baseInput(), instruction: '要求'.repeat(10000) };
    oversized.settings.agentHistoryTokenBudget = 1000;
    oversized.countTokens = async text => Math.max(1, Math.ceil(text.length / 4));
    await expect(run(oversized)).rejects.toThrow('WORLD_ROUND_BUDGET_REJECTED');
    expect(oversized.invoke).not.toHaveBeenCalled();
    const damaged = { ...baseInput(), userRequirements: { schemaVersion: 1 as const, requirements: [''], updatedAt: 0 } };
    await expect(run(damaged)).rejects.toThrow('用户要求'); expect(damaged.invoke).not.toHaveBeenCalled();
  });

  it('世界书非法 refs 按条忽略，不可用与真实预算错误仍明确失败', async () => {
    const snapshot: AgentWorldbookSnapshot_ACU = { available: true, entries: [{ bookName: '书', uid: 'hit', title: '命中', keys: ['正文'], constant: false, content: '正文', tokens: 1 }] };
    const invalid = { ...baseInput(), worldbookSnapshot: snapshot };
    invalid.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'worldbook-selection'
      ? JSON.stringify({ refs: [{ bookName: '书', uid: 'forged' }] }) : normalResponse(role, messages));
    await expect(run(invalid)).resolves.toMatchObject({ roundCandidate: { completion: 'no_change' } });
    expect(invalid.invoke.mock.calls.some(([, messages]) => payload(messages).stage === 'actor-batch')).toBe(true);

    const unavailable = { ...baseInput(), worldbookSnapshot: { available: false, entries: [] } };
    const unavailableStages: string[] = [];
    unavailable.invoke = vi.fn(async (role, messages) => { unavailableStages.push(payload(messages).stage as string); return normalResponse(role, messages); });
    await expect(run(unavailable)).rejects.toThrow('WORLD_ROUND_WORLDBOOK_UNAVAILABLE');
    expect(unavailableStages).not.toContain('worldbook-selection');
    expect(unavailableStages).not.toContain('world-page');

    const blocked = { ...baseInput(), worldbookSnapshot: { available: true, entries: [{ bookName: '书', uid: 'huge', title: '超大', keys: ['正文'], constant: false, content: '超大世界书'.repeat(10000), tokens: 1 }] } };
    blocked.settings.agentReadTokenBudget = 500; blocked.countTokens = async text => Math.max(1, Math.ceil(text.length / 4));
    const blockedStages: string[] = [];
    blocked.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages); blockedStages.push(data.stage as string);
      if (data.stage === 'worldbook-selection') return JSON.stringify({ refs: [{ bookName: '书', uid: 'huge' }] });
      return normalResponse(role, messages);
    });
    await expect(run(blocked)).rejects.toThrow('WORLD_ROUND_WORLDBOOK_DENIED');
    expect(blockedStages).not.toContain('world-page');
    expect(blockedStages).not.toContain('actor-batch');
  });
  it('single 使用同一角色处理世界、逐页召回与人物，完整覆盖空变更人物', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const result = await run({ ...baseInput(ledger, 'single') });
    expect(result.calls.map(call => call.role)).toEqual(['clock-recaller', 'clock-recaller', 'world-simulator', 'world-simulator']);
    expect(result.roundCandidate.actorCompletions).toEqual([{ actorId: 'a0', completion: 'no_change', expectedRevision: 1 }]);
    expect(result.roundCandidate.completion).toBe('no_change');
  });

  it.each(['single', 'layered'] as const)('%s 世界页收到上一轮人物谱简表，含上一轮行动结果，归档人物不列入且不改账本', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [
      { ...actor('teacher'), name: '王老师', location: '高三教室',
        currentAction: { text: '整理讲评重点', expectedDuration: '半小时', startedAtDay: 1, startedAt: '' },
        shortTermAction: { text: '完成月考讲评', expectedDuration: '两天', startedAtDay: 1, startedAt: '', status: 'ongoing' as const, outcome: null },
        longTermAction: { text: '完成月考讲评', expectedDuration: '两天', startedAtDay: 1, startedAt: '', status: 'ongoing' as const, outcome: null },
        previousActionResult: '本班试卷已批完，多数学生在函数题失分' },
      { ...actor('student'), name: '林舟' },
      { ...actor('gone'), name: '已归档', simulationStatus: 'archived' as const },
    ];
    const original = structuredClone(ledger);
    const input = baseInput(ledger, mode);
    const directories: unknown[] = [];
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'world-page') directories.push(data.actorDirectory);
      return normalResponse(role, messages);
    });
    await run(input);
    expect(directories.length).toBeGreaterThan(0);
    for (const directory of directories) {
      expect(directory).toEqual([
        { id: 'teacher', name: '王老师', life: 'alive', location: '高三教室', locationRef: null, currentAction: '整理讲评重点',
          shortTermAction: { text: '完成月考讲评', status: 'ongoing', outcome: null },
          previousActionResult: '本班试卷已批完，多数学生在函数题失分' },
        { id: 'student', name: '林舟', life: 'alive', location: '', locationRef: null, currentAction: null,
          shortTermAction: null, previousActionResult: '无' },
      ]);
    }
    expect(ledger).toEqual(original);
  });

  it.each(['single', 'layered'] as const)('%s 中转把每个阶段的回答都放进工具调用参数、正文为空时整轮照常完成', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger, mode);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      const text = data.stage === 'actor-batch'
        ? JSON.stringify({ actorWrites: [{ value: { id: 'a0', currentAction: { text: '整理讲评重点', expectedDuration: '半小时' } } }] })
        : normalResponse(role, messages);
      return { content: '', toolCalls: [{ id: 'call-1', name: 'reply', arguments: text }] };
    });
    const result = await run(input);
    expect(result.ledger.actors[0].currentAction?.text).toBe('整理讲评重点');
  });

  it('人物附带的唯一一条事实不合格时只丢该事实，人物自身更新照常保存', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    const badFact = { ...changedFact('a0'), value: { ...changedFact('a0').value, id: 'future-fact', happenedAt: { day: 99, slot: '' } } };
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [{ value: { id: 'a0', currentAction: { text: '整理讲评重点', expectedDuration: '半小时' } } }], factWrites: [badFact] })
      : normalResponse(role, messages));
    const result = await run(input);
    expect(result.ledger.actors[0].currentAction?.text).toBe('整理讲评重点');
    expect(result.ledger.facts.map(fact => fact.id)).not.toContain('future-fact');
  });

  it('模型只写兼容字段 longTermAction 时以它为准，不被合并进来的旧短期事务覆盖', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const old = { text: '完成月考讲评', expectedDuration: '两天', startedAtDay: 1, startedAt: '', status: 'ongoing' as const, outcome: null };
    ledger.actors = [{ ...actor('a0'), shortTermAction: old, longTermAction: old }];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [{ value: { id: 'a0', longTermAction: { ...old, text: '准备家长会' } } }] })
      : normalResponse(role, messages));
    const result = await run(input);
    expect(result.ledger.actors[0].shortTermAction?.text).toBe('准备家长会');
    expect(result.ledger.actors[0].longTermAction?.text).toBe('准备家长会');
  });

  it('人物批固定协议禁止“未详/未定”类占位并要求给出预计时长', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    let protocol = '';
    input.invoke = vi.fn(async (role, messages) => {
      if (payload(messages).stage === 'actor-batch') protocol = messages[0].content;
      return normalResponse(role, messages);
    });
    await run(input);
    expect(protocol).toContain('expectedDuration 必须给出估计时长');
    expect(protocol).toContain('禁止“具体事务未详”“未知”“不明”“未定”“待定”等占位或空字符串');
    expect(protocol).toContain('旧记录里是这类占位的，本轮换成具体内容');
  });

  it('人物很多时每页简表只含本页人物和本页事件参与者，不随总人数增长', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = Array.from({ length: 60 }, (_, index) => actor(`actor-${String(index).padStart(2, '0')}`));
    ledger.worldEvents = [relatedEvent('event-far', ['actor-59'])];
    const input = baseInput(ledger);
    const pages: Array<{ pageActors: string[]; directory: string[] }> = [];
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'world-page') pages.push({
        pageActors: (data.page as { actorIds: string[] }).actorIds,
        directory: (data.actorDirectory as Array<{ id: string }>).map(item => item.id),
      });
      return normalResponse(role, messages);
    });
    await run(input);
    expect(pages.length).toBeGreaterThan(1);
    const eventPage = pages.find(page => page.directory.includes('actor-59'))!;
    for (const page of pages) {
      expect(page.directory.length).toBeLessThan(ledger.actors.length);
      expect(page.directory.every(id => page.pageActors.includes(id) || id === 'actor-59')).toBe(true);
      expect(page.pageActors.every(id => page.directory.includes(id))).toBe(true);
    }
    expect(eventPage).toBeDefined();
  });

  it.each(['single', 'layered'] as const)('%s 人物上轮行动结果独立保存，别名归一且不要求结果事实，后续无进展清无', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [{ ...actor('a0'), previousActionResult: '更早的结果',
      currentAction: { text: '批改本班试卷', expectedDuration: '一小时', startedAtDay: 1, startedAt: '' } }];
    const input = baseInput(ledger, mode);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [{ value: { id: 'a0', previous_action_result: '本班试卷已批完，多数学生在函数题失分',
        currentAction: { text: '整理讲评重点' } } }] }) : normalResponse(role, messages));
    const first = await run(input);
    expect(first.ledger.actors[0]).toMatchObject({ previousActionResult: '本班试卷已批完，多数学生在函数题失分', currentAction: { text: '整理讲评重点' } });
    expect(first.ledger.actors[0]).not.toHaveProperty('previous_action_result');
    expect(first.ledger.facts).toEqual([]);
    expect(first.ledger.historyMilestones).toEqual([]);
    const nextInput = baseInput(first.ledger, mode);
    nextInput.identity.baseLedgerRevision = first.ledger.revision;
    nextInput.invoke = vi.fn(async (role, messages) => {
      if (payload(messages).stage === 'actor-batch') {
        expect(payload(messages).actorMaterials).toMatchObject({ actors: [{ previousActionResult: '本班试卷已批完，多数学生在函数题失分' }] });
        return JSON.stringify({ actorWrites: [] });
      }
      return normalResponse(role, messages);
    });
    expect((await run(nextInput)).ledger.actors[0].previousActionResult).toBe('无');
  });

  it.each([undefined, null, '', '   ', '无'])('人物有其他更新但结果为 %s 时不继承更早结果', async result => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [{ ...actor('a0'), previousActionResult: '旧结果' }];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [{ value: { id: 'a0', goals: ['后续目标'], previousActionResult: result } }] }) : normalResponse(role, messages));
    expect((await run(input)).ledger.actors[0].previousActionResult).toBe('无');
  });

  it('人物页回复无法解析时不把上一轮已保存结果改成无', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [{ ...actor('a0'), previousActionResult: '已保存结果' }];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch' ? 'unparseable' : normalResponse(role, messages));
    expect((await run(input)).ledger.actors[0].previousActionResult).toBe('已保存结果');
  });

  it('layered 模型非法 JSON 时拒绝且不返回候选', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'clock-candidate' ? JSON.stringify({ candidateClock: clock() }) : 'bad');
    await expect(run(input)).rejects.toThrow('WORLD_ROUND_PROTOCOL_INVALID');
  });

  it('260 active 人物按真实召回页固定后重新分成稳定 24 人批次', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = Array.from({ length: 260 }, (_, index) => actor(`actor-${String(index).padStart(3, '0')}`));
    const seenActorBatches: string[][] = [];
    const materialTokens: number[] = [];
    const promptTokens: number[] = [];
    const input = baseInput(ledger);
    input.settings.agentReadTokenBudget = 5000;
    input.settings.agentHistoryTokenBudget = 20000;
    input.countTokens = async text => Math.max(1, Math.ceil(text.length / 4));
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      promptTokens.push(Math.ceil(JSON.stringify(messages).length / 4));
      if (data.stage === 'actor-batch') {
        const ids = data.actorIds as string[];
        const materials = data.actorMaterials as { actors: Array<{ id: string }> };
        seenActorBatches.push(ids);
        expect(materials.actors.map(row => row.id)).toEqual(ids);
        materialTokens.push(Math.ceil(JSON.stringify({ ...materials, ...(data.worldOverlay as object) }).length / 4));
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.calls.filter(call => call.role === 'actor-simulator')).toHaveLength(11);
    expect(result.roundCandidate.actorCompletions).toHaveLength(260);
    expect(seenActorBatches).toHaveLength(11);
    expect(seenActorBatches.every(batch => batch.length <= 24)).toBe(true);
    expect(seenActorBatches.flat()).toEqual(ledger.actors.map(item => item.id));
    expect(Math.max(...materialTokens)).toBeLessThanOrEqual(5000);
    expect(materialTokens.reduce((sum, size) => sum + size, 0)).toBeGreaterThan(5000);
    expect(Math.max(...promptTokens)).toBeLessThan(20000);
  });

  it('返回经内存预检的真实人物、事实与纪要候选', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      return JSON.stringify({ actorWrites: [changedActorWrite('a0')], actorCompletions: [{ actorId: 'a0', completion: 'changed', expectedRevision: 1 }],
        factWrites: [changedFact('a0')], historyMilestoneWrites: [{ value: { id: 'milestone-a0', summary: '行动完成', happenedAt: { day: 1, slot: '' }, actorIds: ['a0'], worldEventIds: [], locationRef: null,
          sourceFactIds: ['fact-a0'], importance: 1, category: '行动', visibility: 'internal', revision: 1, legacyRefs: [] }, expectedRevision: 0 }] });
    });
    const result = await run(input);
    expect(result.roundCandidate.completion).toBe('changed');
    expect(result.ledger.actors[0].goals).toEqual(['完成本轮事项']);
    expect(result.ledger.facts.map(item => item.id)).toEqual(['fact-a0']);
    // 历史已移交联合审查专员：人物批即使返回 historyMilestoneWrites 也静默忽略，本批照常保存。
    expect(result.ledger.historyMilestones).toEqual([]);
    expect(result.roundCandidate.historyMilestoneWrites).toEqual([]);
  });

  it('既有数字字符串人物 ID 接受模型数字 ID 写入，始终回存原 ID 且不登记新人物', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('42')];
    const before = structuredClone(ledger);
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      if (payload(messages).stage !== 'actor-batch') return normalResponse(role, messages);
      return JSON.stringify({ actorWrites: [{ value: { id: 42, goals: ['完成本轮事项'] }, expectedRevision: 1 }],
        actorCompletions: [{ actorId: '42', completion: 'changed', expectedRevision: 1 }] });
    });
    const result = await run(input);
    expect(result.roundCandidate.actorWrites).toMatchObject([{ value: { id: '42', goals: ['完成本轮事项'], revision: 2 }, expectedRevision: 1 }]);
    expect(result.ledger.actors).toHaveLength(1);
    expect(result.ledger.actors[0]).toMatchObject({ id: '42', goals: ['完成本轮事项'], revision: 2 });
    expect(ledger).toEqual(before);
  });

  it('同批缺字段更新及坏登记、坏 completion 不抹掉有效人物', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0'), actor('a1')];
    const input = baseInput(ledger); input.anchorText = '林舟踏进了钟楼。'; input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage !== 'actor-batch' ? normalResponse(role, messages) : JSON.stringify({
      actorWrites: [null, { expectedRevision: 99, value: { id: 'a0', goals: ['继续巡查'], revision: 900 } }],
      actorCompletions: [null, { actorId: 'forged', completion: 'changed' }, { actorId: 'a0', completion: 'no_change' }, { actorId: 'a0', completion: 'invalid' }],
      actorRegistrations: [null, { value: { ...actor('empty'), name: '' }, evidenceQuote: input.anchorText },
        { value: { ...actor('lin-zhou'), name: '林舟', knownFacts: ['伪造'] }, evidenceQuote: input.anchorText },
        { value: { ...actor('lin-zhou'), name: '林舟' }, evidenceQuote: input.anchorText }],
    }));
    const result = await run(input);
    expect(result.roundCandidate.actorCompletions).toEqual([
      { actorId: 'a0', completion: 'changed', expectedRevision: 1 },
      { actorId: 'a1', completion: 'no_change', expectedRevision: 1 },
      { actorId: 'lin-zhou', completion: 'changed', expectedRevision: 0 },
    ]);
    expect(result.ledger.actors.find(item => item.id === 'a0')).toMatchObject({ name: 'a0', goals: ['继续巡查'], revision: 2 });
    expect(result.ledger.actors.find(item => item.id === 'lin-zhou')?.knownFacts).toEqual([]);
  });

  it('同批无效人物认知降级，但保留其余行动与另一人物已验证认知', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('a0'), { ...actor('a1'), name: '阿一', locationRef: { region: '城', place: '塔' }, informationSources: ['电台'] }];
    const input = baseInput(ledger); input.anchorText = '阿一通过电台听到港口封锁。'; input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage !== 'actor-batch' ? normalResponse(role, messages) : JSON.stringify({
      actorWrites: [{ value: { id: 'a0', goals: ['巡查'], knownFacts: ['幻觉'] } },
        { value: { id: 'a1', knownFacts: ['港口已封锁'] } }],
      knowledgeAcquisitions: [{ actorId: 'a0', knowledge: '幻觉', channel: '不存在', evidenceQuote: '幻觉', acquiredAt: { day: 1, slot: '' }, locationRef: { region: '城', place: '塔' } },
        { actorId: 'a1', knowledge: '港口已封锁', channel: '电台', evidenceQuote: input.anchorText, acquiredAt: { day: 1, slot: '' }, locationRef: { region: '城', place: '塔' } }],
    }));
    const result = await run(input);
    expect(result.ledger.actors.find(item => item.id === 'a0')).toMatchObject({ goals: ['巡查'], knownFacts: [] });
    expect(result.ledger.actors.find(item => item.id === 'a1')?.knownFacts).toEqual(['港口已封锁']);
  });

  it.each(['single', 'layered'] as const)('%s 两名登记逐人确认，仅批准者物化；拒绝人物的事实结构引用和锁定 gate 清除，旧人物照常更新', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('existing')];
    const anchorText = '林舟与白栩走进钟楼。';
    const input = { ...baseInput(ledger, mode), anchorText, identity: identity(mode, anchorText) };
    const approved = { ...actor('new-approved'), name: '林舟' };
    const refused = { ...actor('new-refused'), name: '白栩' };
    const fact = { ...changedFact('new-refused').value, id: 'fact-encounter', summary: '白栩与原有人物见面', actorIds: ['new-refused', 'existing'],
      projectionPolicy: 'gated' as const, revealState: 'locked' as const, revealGate: { actorIds: ['new-refused'], semanticCondition: '见面' } };
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [changedActorWrite('existing')], actorRegistrations: [
        { value: approved, expectedRevision: 0, evidenceQuote: '林舟与白栩走进钟楼。' },
        { value: refused, expectedRevision: 0, evidenceQuote: '林舟与白栩走进钟楼。' },
      ], factWrites: [{ value: fact, expectedRevision: 0 }, { ...changedFact('new-refused'), value: { ...changedFact('new-refused').value, id: 'fact-only-refused' } }],
        historyMilestoneWrites: [milestone('history-encounter', ['new-refused', 'existing'], [fact.id]),
          milestone('history-only-refused', ['new-refused'], ['fact-only-refused'])] })
      : normalResponse(role, messages));
    const confirmActorRegistration = vi.fn(async (candidate: typeof approved) => {
      const decision = candidate.id === approved.id;
      candidate.name = '篡改克隆对象'; candidate.goals.push('篡改目标');
      return decision;
    });
    const events: string[] = [];
    const result = await run({ ...input, confirmActorRegistration, onProgress: (key, event) => {
      if (key.startsWith('actor-registration-')) events.push(`${event.title}:${event.detail}`);
    } });
    expect(confirmActorRegistration.mock.calls.map(([candidate]) => candidate.id)).toEqual(['new-approved', 'new-refused']);
    expect(result.ledger.actors.map(item => item.id)).toEqual(['existing', 'new-approved']);
    expect(result.ledger.actors[1]).toMatchObject({ name: '林舟', goals: [] });
    expect(result.ledger.actors[0].goals).toEqual(['完成本轮事项']);
    expect(result.roundCandidate.actorCompletions.map(item => item.actorId)).toEqual(['existing', 'new-approved']);
    expect(result.ledger.facts.map(item => item.id)).toEqual(['fact-encounter', 'fact-only-refused']);
    expect(result.ledger.facts[0]).toMatchObject({ id: 'fact-encounter', summary: '白栩与原有人物见面', actorIds: ['existing'], revealState: 'locked', revealGate: null });
    expect(result.ledger.facts[1].actorIds).toEqual([]);
    expect(result.ledger.historyMilestones).toEqual([]);
    expect(events).toEqual(['等待人物登记确认:第 1/2 人', '已同意人物登记:第 1/2 人', '等待人物登记确认:第 2/2 人', '人物未新增:第 2/2 人']);
    expect(JSON.stringify(events)).not.toContain('见面');
  });

  it('跨两批仅首批新人物确认一次，后批累积候选不重复询问', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = Array.from({ length: 25 }, (_, index) => actor(`old-${String(index).padStart(2, '0')}`));
    const anchorText = '林舟踏进钟楼。';
    const input = { ...baseInput(ledger), anchorText, identity: identity('layered', anchorText) };
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      return JSON.stringify({ actorRegistrations: data.allowActorRegistrations
        ? [{ value: { ...actor('new'), name: '林舟' }, evidenceQuote: anchorText }] : [] });
    });
    const confirmActorRegistration = vi.fn(async () => true);
    const result = await run({ ...input, confirmActorRegistration });
    expect(input.invoke.mock.calls.filter(([, messages]) => payload(messages).stage === 'actor-batch')).toHaveLength(2);
    expect(confirmActorRegistration).toHaveBeenCalledOnce();
    expect(result.ledger.actors.filter(item => item.id === 'new')).toHaveLength(1);
    expect(result.roundCandidate.actorCompletions.filter(item => item.actorId === 'new')).toHaveLength(1);
  });

  it('全部拒绝不阻断世界事实和原有人物更新，下一轮仍可确认同 ID', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('existing')];
    const anchorText = '林舟踏进钟楼。';
    const input = { ...baseInput(ledger), anchorText, identity: identity('layered', anchorText) };
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [changedActorWrite('existing')], actorRegistrations: [
        { value: { ...actor('new'), name: '林舟' }, evidenceQuote: anchorText },
      ], factWrites: [changedFact('existing')] }) : normalResponse(role, messages));
    const confirmActorRegistration = vi.fn(async () => false);
    const first = await run({ ...input, confirmActorRegistration });
    expect(first.roundCandidate.actorWrites.map(write => write.value.id)).toEqual(['existing']);
    expect(first.ledger.facts.map(fact => fact.id)).toEqual(['fact-existing']);
    expect(first.ledger.actors.map(item => item.id)).toEqual(['existing']);
    await run({ ...input, confirmActorRegistration });
    expect(confirmActorRegistration).toHaveBeenCalledTimes(2);
    const legacy = await run(input);
    expect(legacy.ledger.actors.map(item => item.id)).toEqual(['existing', 'new']);
  });

  it.each(['abort', 'stale'] as const)('确认窗口等待时 %s 不返回候选，也不进入后续审查', async stop => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); const before = structuredClone(ledger);
    const controller = new AbortController();
    const anchorText = '林舟踏进钟楼。';
    const input = { ...baseInput(ledger), signal: controller.signal, anchorText, identity: identity('layered', anchorText) };
    let current = true;
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorRegistrations: [{ value: { ...actor('new'), name: '林舟' }, evidenceQuote: anchorText }] })
      : normalResponse(role, messages));
    let release: ((approved: boolean) => void) | undefined;
    const pending = run({ ...input, isCurrent: () => current,
      confirmActorRegistration: () => new Promise<boolean>(resolve => { release = resolve; }) });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (stop === 'abort') controller.abort(); else current = false;
    release!(true);
    await expect(pending).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(ledger).toEqual(before);
  });

  it('无效登记未通过物化预检不弹确认', async () => {
    const anchorText = '林舟踏进钟楼。';
    const input = { ...baseInput(), anchorText, identity: identity('layered', anchorText) };
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorRegistrations: [
        { value: { ...actor('invalid'), name: '林舟', life: 'invalid' }, evidenceQuote: anchorText },
        { value: { ...actor('valid'), name: '林舟' }, evidenceQuote: anchorText },
      ] }) : normalResponse(role, messages));
    const confirmActorRegistration = vi.fn(async () => true);
    const result = await run({ ...input, confirmActorRegistration });
    expect(confirmActorRegistration.mock.calls.map(([candidate]) => candidate.id)).toEqual(['valid']);
    expect(result.ledger.actors.map(item => item.id)).toEqual(['valid']);
  });

  it('真实末尾只有三种人物写集也接受完整 alive 登记', async () => {
    const input = baseInput(); input.anchorText = '林舟踏进了钟楼。'; input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [], actorCompletions: [], actorRegistrations: [{ value: { ...actor('lin-zhou'), name: '林舟' }, evidenceQuote: input.anchorText }] })
      : normalResponse(role, messages));
    const result = await run(input);
    expect(result.ledger.actors.map(item => item.name)).toEqual(['林舟']);
    expect(result.roundCandidate.factWrites).toEqual([]);
    expect(result.roundCandidate.historyMilestoneWrites).toEqual([]);
  });

  it('时钟只给数字字符串 day 时保留已有时间详情，不将解释字段视作非法', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.clock = { ...clock(1), slot: '午后', storyTime: '夏季' };
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'clock-candidate'
      ? JSON.stringify({ candidateClock: { day: '2' }, explanation: '时间前进一天' }) : normalResponse(role, messages));
    const result = await run(input);
    expect(result.roundCandidate.candidateClock).toEqual({ day: 2, slot: '午后', storyTime: '夏季', precision: 'unknown', evidenceRefs: [] });
  });

  it('无渠道声称知识只保留原认知，不生成伪 changed', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [{ value: { ...actor('a0'), knownFacts: ['虚构'], revision: 2 } }] }) : normalResponse(role, messages));
    const result = await run(input);
    expect(result.ledger.actors[0].knownFacts).toEqual([]);
    expect(result.roundCandidate.actorCompletions).toEqual([{ actorId: 'a0', completion: 'no_change', expectedRevision: 1 }]);
  });

  it('有前后说明的唯一 fenced JSON、单项写集、缺失 revision 接受合法登记并略过空名登记', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const input = baseInput(ledger); input.anchorText = '林舟踏进了钟楼。'; input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => {
      if (payload(messages).stage !== 'actor-batch') return normalResponse(role, messages);
      return `下面是本轮结果\n\`\`\`json\n${JSON.stringify({ actorRegistrations: [
        { value: { ...actor('bad'), name: '' }, evidenceQuote: input.anchorText },
        { value: { ...actor('lin-zhou'), name: '林舟', revision: undefined }, evidenceQuote: input.anchorText },
      ], actorWrites: null, factWrites: null })}\n\`\`\`\n处理完毕`;
    });
    const result = await run(input);
    expect(result.ledger.actors.map(item => item.id)).toEqual(['lin-zhou']);
    expect(result.roundCandidate.actorCompletions).toEqual([{ actorId: 'lin-zhou', completion: 'changed', expectedRevision: 0 }]);
  });

  it('世界页缺失空写集键可通过', async () => {
    const input = baseInput();
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'world-page' ? '{}' : normalResponse(role, messages));
    await expect(run(input)).resolves.toMatchObject({ roundCandidate: { worldEventWrites: [], factWrites: [] } });
  });

  it('格式损坏的第二个顶层 JSON 对象不能被当成唯一候选', async () => {
    const input = baseInput();
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'clock-candidate'
      ? `${JSON.stringify({ candidateClock: clock() })}\n${JSON.stringify({ candidateClock: clock() })}` : normalResponse(role, messages));
    await expect(run(input)).rejects.toThrow('模型未返回唯一 JSON 对象');
  });

  it('倒退时钟仍拒绝，已接受的世界页没有合法事实时不伪造事实', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')]; ledger.clock = clock(3);
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => JSON.stringify({ candidateClock: clock(2) }));
    await expect(run(input)).rejects.toThrow('WORLD_ROUND_CLOCK_REGRESSION');
    expect(input.invoke).toHaveBeenCalledTimes(1);
  });

  it('无效召回 ID 被丢弃，不阻断其余世界与人物推演', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'clock-candidate') return JSON.stringify({ candidateClock: clock() });
      if (data.stage === 'recall-selection') return JSON.stringify({ selections: [{ actorId: 'a0', historyMilestoneIds: ['forged'], worldEventIds: [], factIds: [], reason: '伪造', priority: 1, scope: 'actor' }], worldSelection: { worldEventIds: [], factIds: [], reason: '无', priority: 5, scope: 'world' } });
      if (data.stage === 'actor-batch') expect(JSON.stringify(data.actorMaterials)).not.toContain('forged');
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.roundCandidate.actorCompletions).toHaveLength(1);
    expect(result.ledger.historyMilestones).toEqual([]);
  });

  it('世界页非法改变无结果事实时丢弃该改变，其它合法世界事实仍保留', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    ledger.worldEvents = [relatedEvent('event-1', ['a0'])];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') return JSON.stringify({ selections: [{ actorId: 'a0', historyMilestoneIds: [], worldEventIds: ['event-1'], factIds: [], reason: '到期', priority: 1, scope: 'world' }], worldSelection: { worldEventIds: ['event-1'], factIds: [], reason: '到期', priority: 1, scope: 'world' } });
      if (data.stage === 'world-page') return JSON.stringify({ worldEventWrites: [{ value: { ...ledger.worldEvents[0], state: '非法改变', revision: 2 }, expectedRevision: 1 }], factWrites: [changedFact('a0')] });
      if (data.stage === 'actor-batch') {
        expect((data.worldOverlay as { worldEvents: WorldEvent_ACU[] }).worldEvents[0].state).toBe('进行');
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.ledger.worldEvents[0]).toMatchObject({ state: '进行', nextCheck: { reason: '检查' } });
    expect(result.ledger.facts.map(fact => fact.id)).toEqual(['fact-a0']);
  });

  it('后续人物批次回复损坏时保留前批有效写入且输入账本不变', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = Array.from({ length: 25 }, (_, index) => actor(`a${String(index).padStart(2, '0')}`));
    const before = structuredClone(ledger);
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      const ids = data.actorIds as string[];
      if (ids[0] === 'a00') return JSON.stringify({ actorWrites: [changedActorWrite('a00')], actorCompletions: ids.map(actorId => ({ actorId, completion: actorId === 'a00' ? 'changed' : 'no_change', expectedRevision: 1 })), factWrites: [], historyMilestoneWrites: [] });
      return 'bad';
    });
    const result = await run(input);
    expect(result.ledger.actors[0].goals).toEqual(['完成本轮事项']);
    expect(result.roundCandidate.actorCompletions.find(item => item.actorId === 'a24')?.completion).toBe('no_change');
    expect(ledger).toEqual(before);
  });

  it('同批短期 done 无额外结果事实也保存该人物及其他合法写入', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0'), actor('a1')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [
        { value: { ...actor('a0'), shortTermAction: { text: '结束', expectedDuration: '', startedAtDay: null, startedAt: '', status: 'done', outcome: '完成' }, revision: 2 } },
        changedActorWrite('a1')], factWrites: [changedFact('a1')] }) : normalResponse(role, messages));
    const result = await run(input);
    expect(result.roundCandidate.actorWrites.map(write => write.value.id)).toEqual(['a0', 'a1']);
    expect(result.ledger.facts.map(fact => fact.id)).toEqual(['fact-a1']);
    expect(result.roundCandidate.actorCompletions.find(item => item.actorId === 'a0')?.completion).toBe('changed');
  });

  it('非法事实与重复事实不覆盖独立合法写入', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => payload(messages).stage === 'actor-batch'
      ? JSON.stringify({ actorWrites: [changedActorWrite('a0')], factWrites: [
        { ...changedFact('a0'), value: { ...changedFact('a0').value, id: 'bad', happenedAt: { day: 99, slot: '' } } },
        changedFact('a0'), changedFact('a0')] }) : normalResponse(role, messages));
    const result = await run(input);
    expect(result.ledger.facts.map(fact => fact.id)).toEqual(['fact-a0']);
    expect(result.ledger.actors[0].goals).toEqual(['完成本轮事项']);
  });

  it('无人物时执行空人物批以登记正文人物', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const input = baseInput(ledger);
    input.anchorText = '林舟踏进了钟楼。';
    input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      expect(data.actorIds).toEqual([]);
      expect(data.allowActorRegistrations).toBe(true);
      return JSON.stringify({ actorWrites: [], actorCompletions: [], actorRegistrations: [{
        value: { ...actor('lin-zhou'), name: '林舟', goals: ['查看钟楼'], revision: 1 }, expectedRevision: 0, evidenceQuote: '林舟踏进了钟楼。',
      }], factWrites: [], historyMilestoneWrites: [] });
    });
    const result = await run(input);
    expect(result.roundCandidate.actorCompletions).toEqual([{ actorId: 'lin-zhou', completion: 'changed', expectedRevision: 0 }]);
    expect(result.ledger.actors).toMatchObject([{ id: 'lin-zhou', name: '林舟', simulationStatus: 'active', knownFacts: [], experiences: [] }]);
  });

  it.each(['single', 'layered'] as const)('%s 人物固定协议的完整 JSON 示例可登记并由程序盖行动时间', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const before = structuredClone(ledger);
    const input = baseInput(ledger, mode);
    input.anchorText = '林舟踏进了钟楼。';
    input.identity = identity(mode, input.anchorText);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      const protocol = messages[0].content;
      expect(protocol).toContain('diedAtDay 与 deathSummary 必须都是 null');
      expect(protocol).toContain('不得写成字符串');
      expect(protocol).toContain('longTermAction 是存储兼容字段');
      const exampleLine = protocol.split('\n').find(line => line.startsWith('WorldActor JSON 格式示例：'))!;
      const value = JSON.parse(exampleLine.slice('WorldActor JSON 格式示例：'.length));
      expect(value.deathSummary).toBeNull();
      expect(value.resources).toEqual([]);
      expect(value.currentAction).toMatchObject({ text: expect.any(String), startedAtDay: null });
      expect(value.shortTermAction).toEqual(value.longTermAction);
      return JSON.stringify({ actorWrites: [], actorCompletions: [], actorRegistrations: [{
        value: { ...value, id: 'lin-zhou', name: '林舟' }, expectedRevision: 0, evidenceQuote: input.anchorText,
      }], factWrites: [], historyMilestoneWrites: [] });
    });
    const result = await run(input);
    expect(result.ledger.actors[0]).toMatchObject({ id: 'lin-zhou', life: 'alive', diedAtDay: null, deathSummary: null, resources: [],
      currentAction: { text: '检查钟楼门锁', startedAtDay: 1, startedAt: '' },
      shortTermAction: { text: '完成钟楼巡查', status: 'ongoing', outcome: null, startedAtDay: 1, startedAt: '' } });
    expect(result.ledger.actors[0].shortTermAction).toEqual(result.ledger.actors[0].longTermAction);
    expect(ledger).toEqual(before);
  });

  it.each([
    ['死亡摘要空串', { deathSummary: '' }, { deathSummary: null }],
    ['资源字符串', { resources: '有学习资料' }, { resources: ['有学习资料'] }],
    ['行动字符串', { currentAction: '正在巡查' }, { currentAction: { text: '正在巡查', expectedDuration: '', startedAtDay: 1, startedAt: '' } }],
    ['事务字符串', { shortTermAction: '完成巡查', longTermAction: '完成巡查' }, { shortTermAction: { text: '完成巡查', status: 'ongoing', outcome: null, startedAtDay: 1, startedAt: '' } }],
  ])('兼容真实日志中的人物登记格式：%s，基础账本不变', async (_label, patch, expected) => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const before = structuredClone(ledger);
    const input = baseInput(ledger);
    input.anchorText = '林舟踏进了钟楼。';
    input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => {
      if (payload(messages).stage !== 'actor-batch') return normalResponse(role, messages);
      return JSON.stringify({ actorWrites: [], actorCompletions: [], actorRegistrations: [{
        value: { ...actor('lin-zhou'), name: '林舟', ...patch }, expectedRevision: 0, evidenceQuote: input.anchorText,
      }] });
    });
    const result = await run(input);
    expect(result.ledger.actors[0]).toMatchObject(expected);
    expect(ledger).toEqual(before);
  });

  it.each(['single', 'layered'] as const)('%s 首批全册 roster 区分正文三名旧人物与三名新人物，同轮全登记且次页不能重复', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = Array.from({ length: 25 }, (_, index) => ({ ...actor(`old-${String(index).padStart(2, '0')}`), name: index < 3 ? ['邵宁', '祁月', '程野'][index] : `既有人物${index}` }));
    ledger.actors.push({ ...actor('old-archived'), name: '退场的洛岚', simulationStatus: 'archived' });
    const before = structuredClone(ledger);
    const anchorText = '邵宁与祁月在门前等候，程野开门。新来的主持人孟溪宣布会议开始，助手白栩分发地图，记录员贺春逐项记下决定。';
    const input = { ...baseInput(ledger, mode), anchorText, identity: identity(mode, anchorText), actorPageSize: 24 };
    input.settings.workflowMode = mode;
    const newcomers = [
      { id: 'new-host', name: '孟溪', evidenceQuote: '主持人孟溪宣布会议开始' },
      { id: 'new-assistant', name: '白栩', evidenceQuote: '助手白栩分发地图' },
      { id: 'new-recorder', name: '贺春', evidenceQuote: '记录员贺春逐项记下决定' },
    ];
    const expectedRoster = ledger.actors.map(({ id, name, simulationStatus }) => ({ id, name, simulationStatus }));
    let batches = 0;
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      const ids = data.actorIds as string[];
      const roster = data.registrationRoster as Array<{ id: string; name: string; simulationStatus: string }>;
      expect(roster).toEqual(expectedRoster);
      expect(roster).toContainEqual({ id: 'old-24', name: '既有人物24', simulationStatus: 'active' });
      expect(roster).toContainEqual({ id: 'old-archived', name: '退场的洛岚', simulationStatus: 'archived' });
      expect(roster.every(row => Object.keys(row).sort().join(',') === 'id,name,simulationStatus')).toBe(true);
      if (batches++ === 0) {
        expect(ids).toHaveLength(24);
        expect(data.allowActorRegistrations).toBe(true);
        expect(messages[0].content).toContain('registrationRoster');
        expect(messages[0].content).toContain('正文');
        return JSON.stringify({ actorWrites: [], actorCompletions: ids.map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })),
          actorRegistrations: newcomers.map(({ id, name, evidenceQuote }) => ({ value: { ...actor(id), name,
            knownFacts: ['伪造旧认知'], revision: 0 }, expectedRevision: 0, evidenceQuote })) });
      }
      expect(ids).toEqual(['old-24']);
      expect(data.allowActorRegistrations).toBe(false);
      expect(data.actorRegistrationLimit).toBe(0);
      return JSON.stringify({ actorWrites: [], actorCompletions: ids.map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })),
        actorRegistrations: [{ value: { ...actor('forged-repeat'), name: '孟溪' }, expectedRevision: 0, evidenceQuote: newcomers[0].evidenceQuote }] });
    });
    const result = await run(input);
    expect(batches).toBe(2);
    expect(result.roundCandidate.actorWrites.filter(write => write.expectedRevision === 0).map(write => write.value.id)).toEqual(newcomers.map(row => row.id));
    expect(result.ledger.actors.filter(row => row.id.startsWith('new-')).map(row => row.name)).toEqual(newcomers.map(row => row.name));
    expect(result.ledger.actors.some(row => row.id === 'forged-repeat')).toBe(false);
    expect(result.ledger.actors.filter(row => row.id.startsWith('new-')).every(row => row.knownFacts.length === 0 && row.simulationStatus === 'active')).toBe(true);
    expect(result.roundCandidate.actorCompletions).toHaveLength(28);
    expect(ledger).toEqual(before);
  });

  it('首批登记连同本批事实纪要，后批仍完整覆盖原 roster', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = Array.from({ length: 25 }, (_, index) => actor(`a${String(index).padStart(2, '0')}`));
    const before = structuredClone(ledger);
    const input = baseInput(ledger); input.anchorText = '林舟踏进了钟楼。'; input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      const ids = data.actorIds as string[];
      if (ids[0] !== 'a00') return JSON.stringify({ actorWrites: [], actorCompletions: ids.map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })), actorRegistrations: [], knowledgeAcquisitions: [], factWrites: [], historyMilestoneWrites: [] });
      return JSON.stringify({ actorWrites: [], actorCompletions: ids.map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })), actorRegistrations: [{
        value: { ...actor('lin-zhou'), name: '林舟', goals: ['查看钟楼'], revision: 1 }, expectedRevision: 0, evidenceQuote: '林舟踏进了钟楼。',
      }], factWrites: [changedFact('lin-zhou')], historyMilestoneWrites: [milestone('history-lin-zhou', ['lin-zhou'], ['fact-lin-zhou'])] });
    });
    const result = await run(input);
    expect(result.roundCandidate.actorCompletions).toHaveLength(26);
    expect(new Set(result.roundCandidate.actorCompletions.map(item => item.actorId)).size).toBe(26);
    expect(result.roundCandidate.actorCompletions.find(item => item.actorId === 'a24')).toMatchObject({ completion: 'no_change', expectedRevision: 1 });
    expect(result.ledger.facts.map(item => item.id)).toContain('fact-lin-zhou');
    expect(result.ledger.historyMilestones).toEqual([]);
    expect(ledger).toEqual(before);
  });

  it.each([
    ['重复 ID', [{ value: { ...actor('duplicate'), name: '林舟', revision: 1 }, expectedRevision: 0, evidenceQuote: '林舟踏进了钟楼。' }, { value: { ...actor('duplicate'), name: '林舟', revision: 1 }, expectedRevision: 0, evidenceQuote: '林舟踏进了钟楼。' }], '新人物登记含重复 ID'],
    ['超过首批上限', Array.from({ length: 25 }, (_, index) => ({ value: { ...actor(`new-${index}`), name: '林舟', revision: 1 }, expectedRevision: 0, evidenceQuote: '林舟踏进了钟楼。' })), '新人物登记超过人物批次上限'],
  ])('首批登记%s只保留限额内唯一合法 ID', async (_label, actorRegistrations) => {
    const input = baseInput(); input.anchorText = '林舟踏进了钟楼。'; input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      return JSON.stringify({ actorWrites: [], actorCompletions: [], actorRegistrations, factWrites: [], historyMilestoneWrites: [] });
    });
    const result = await run(input);
    expect(result.ledger.actors).toHaveLength(_label === '重复 ID' ? 1 : 24);
    expect(new Set(result.ledger.actors.map(item => item.id)).size).toBe(result.ledger.actors.length);
  });

  it('仅首批可登记，登记必须为正文引文中的新人物且没有伪造旧认知', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = Array.from({ length: 25 }, (_, index) => actor(`a${String(index).padStart(2, '0')}`));
    const input = baseInput(ledger); input.anchorText = '林舟踏进了钟楼。'; input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      const ids = data.actorIds as string[];
      if (ids[0] === 'a00') return JSON.stringify({ actorWrites: [], actorCompletions: ids.map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })), actorRegistrations: [], knowledgeAcquisitions: [], factWrites: [], historyMilestoneWrites: [] });
      return JSON.stringify({ actorWrites: [], actorCompletions: ids.map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })), actorRegistrations: [{
        value: { ...actor('late'), name: '林舟', revision: 1 }, expectedRevision: 0, evidenceQuote: '林舟踏进了钟楼。',
      }], factWrites: [], historyMilestoneWrites: [] });
    });
    const result = await run(input);
    expect(result.ledger.actors.some(item => item.id === 'late')).toBe(false);
  });

  it.each([
    ['已有或 archived ID', (ledger: ReturnType<typeof buildEmptyWorldSimulationLedger_ACU>) => { ledger.actors = [{ ...actor('taken'), simulationStatus: 'archived' }]; return { ...actor('taken'), name: '林舟', revision: 1 }; }],
    ['初始 knownFacts', () => ({ ...actor('new'), name: '林舟', knownFacts: ['伪造旧史'], revision: 1 })],
  ])('登记不可信状态按安全边界处理%s', async (label, build) => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const value = build(ledger);
    const input = baseInput(ledger); input.anchorText = '林舟踏进了钟楼。'; input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      const evidenceQuote = label === '无引文' ? '' : label === '伪引文' ? '林舟并未出现。' : '林舟踏进了钟楼。';
      return JSON.stringify({ actorWrites: [], actorCompletions: [], actorRegistrations: [{ value, expectedRevision: 0, evidenceQuote }], factWrites: [], historyMilestoneWrites: [] });
    });
    const result = await run(input);
    if (label === '初始 knownFacts') expect(result.ledger.actors[0].knownFacts).toEqual([]);
    else expect(result.roundCandidate.actorWrites).toEqual([]);
  });

  it('无人物时执行空人物批并返回可校验候选', async () => {
    const result = await run(baseInput());
    expect(result.calls.map(call => call.role)).toEqual(['clock-recaller', 'clock-recaller', 'world-event-analyst', 'actor-simulator']);
    expect(result.roundCandidate.actorCompletions).toEqual([]);
  });

  it.each([
    ['预算溢出', async () => 1_000_000],
    ['取消', async () => 1],
    ['租约失效', async () => 1],
  ])('%s 时不返回候选或修改输入', async (name, countTokens) => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const before = structuredClone(ledger);
    const controller = new AbortController();
    const input = baseInput(ledger);
    input.countTokens = countTokens;
    if (name === '取消') { controller.abort(); input.signal = controller.signal; }
    if (name === '租约失效') input.isCurrent = () => false;
    await expect(run(input)).rejects.toThrow(name === '预算溢出' ? 'WORLD_ROUND_BUDGET_REJECTED' : 'WORLD_SIMULATION_RUN_STALE');
    expect(ledger).toEqual(before);
  });

  it('获选后只重排 nextCheck 的事件与基线事实进入人物包，可提炼纪要且不泄漏未选秘密', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    ledger.worldEvents = [relatedEvent('event-a', ['a0'])];
    const visible: WorldFact_ACU = { ...changedFact('a0').value, id: 'baseline-fact', worldEventIds: ['event-a'], nextCheck: { day: 1, slot: '', reason: '复查' } };
    ledger.facts = [visible, { ...visible, id: 'hidden-fact', summary: '未选择的远方秘密', actorIds: [], worldEventIds: [] }];
    const before = structuredClone(ledger);
    let actorCalls = 0;
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') return JSON.stringify({
        selections: [{ actorId: 'a0', historyMilestoneIds: [], worldEventIds: ['event-a'], factIds: ['baseline-fact'], reason: '人物关联', priority: 1, scope: 'actor' }],
        worldSelection: { worldEventIds: ['event-a'], factIds: ['baseline-fact'], reason: '到期', priority: 1, scope: 'world' },
      });
      if (data.stage === 'actor-batch') {
        actorCalls += 1;
        expect(JSON.stringify(data)).not.toContain('未选择的远方秘密');
        expect(data.worldOverlay).toMatchObject({ worldEvents: [{ id: 'event-a', revision: 2 }], facts: [{ id: 'baseline-fact' }] });
        return JSON.stringify({ actorWrites: [], actorCompletions: [{ actorId: 'a0', completion: 'no_change', expectedRevision: 1 }], factWrites: [],
          historyMilestoneWrites: [milestone('baseline-history', ['a0'], ['baseline-fact'], ['event-a'])] });
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(actorCalls).toBe(1); expect(result.ledger.historyMilestones).toEqual([]);
    expect(ledger).toEqual(before);
  });

  it('旧事件虽已选但与首批人物无关联仍完成本轮，并交给人物阶段', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    ledger.worldEvents = [relatedEvent('unrelated-old', [])];
    const before = structuredClone(ledger);
    const seen: string[] = [];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') return JSON.stringify({ selections: [{ actorId: 'a0', historyMilestoneIds: [], worldEventIds: ['unrelated-old'], factIds: [], reason: '已选世界事项', priority: 1, scope: 'actor' }],
        worldSelection: { worldEventIds: ['unrelated-old'], factIds: [], reason: '到期', priority: 1, scope: 'world' } });
      if (data.stage === 'world-page') {
        expect(data.worldMaterials).toMatchObject({ 'worldEvents:unrelated-old': { id: 'unrelated-old' } });
        seen.push('world');
      }
      if (data.stage === 'actor-batch') {
        expect(data.worldOverlay).toMatchObject({ worldEvents: [{ id: 'unrelated-old', revision: 2 }] });
        seen.push('actor');
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(seen).toEqual(['world', 'actor']);
    expect(result.roundCandidate.completion).toBe('changed');
    expect(result.ledger.worldEvents[0].nextCheck).toMatchObject({ day: 2 });
    expect(result.ledger.actors[0].knownFacts).toEqual([]);
    expect(ledger).toEqual(before);
  });

  it('25 人跨页每个 batch 都读到本轮无 owner 事件，且不会自动获得人物认知或未选秘密', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = Array.from({ length: 25 }, (_, index) => actor(`a${String(index).padStart(2, '0')}`));
    ledger.facts = [{ ...changedFact('a00').value, id: 'unselected-secret', summary: '不可见秘密', actorIds: [], nextCheck: null }];
    const before = structuredClone(ledger);
    const newEvent = { ...relatedEvent('unowned-new', []), state: '筹备中', nextCheck: { day: 2, slot: '', reason: '继续检查' } };
    const resultFact: WorldFact_ACU = { ...changedFact('a00').value, id: 'event-created', summary: '独立赛事已经开始筹备', actorIds: [], worldEventIds: ['unowned-new'] };
    const input = baseInput(ledger);
    const batches: string[][] = [];
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'world-page' && (data.page as { actorIds: string[] }).actorIds.includes('a00')) {
        return JSON.stringify({ worldEventWrites: [{ value: newEvent, expectedRevision: 0 }], factWrites: [{ value: resultFact, expectedRevision: 0 }] });
      }
      if (data.stage === 'actor-batch') {
        const ids = data.actorIds as string[];
        batches.push(ids);
        expect((data.worldOverlay as { worldEvents: WorldEvent_ACU[]; facts: WorldFact_ACU[] }).worldEvents).toEqual([newEvent]);
        expect((data.worldOverlay as { facts: WorldFact_ACU[] }).facts).toEqual([resultFact]);
        expect(JSON.stringify(data)).not.toContain('不可见秘密');
        expect((data.actorMaterials as { actors: Array<{ id: string }> }).actors.map(item => item.id)).toEqual(ids);
        expect(data.knowledgeSources).toEqual([]);
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(batches.map(ids => ids.length)).toEqual([24, 1]);
    expect(result.ledger.worldEvents).toEqual([newEvent]);
    expect(result.ledger.facts).toEqual([...before.facts, resultFact]);
    expect(result.ledger.actors.every(item => item.knownFacts.length === 0)).toBe(true);
    expect(result.roundCandidate.actorCompletions).toHaveLength(25);
    expect(ledger).toEqual(before);
  });

  it('人物可基于已预检世界事实形成纪要，共享世界对象跨批不丢失', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0'), actor('a1')];
    ledger.worldEvents = [relatedEvent('shared-event', ['a0', 'a1'])];
    const input = { ...baseInput(ledger), actorPageSize: 1 };
    const seen: string[] = [];
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') {
        const reply = selection(data);
        const directory = data.directory as { dueEventIds: string[] };
        return JSON.stringify({ ...reply, worldSelection: { worldEventIds: directory.dueEventIds, factIds: [], reason: '到期', priority: 1, scope: 'world' } });
      }
      if (data.stage === 'world-page' && (data.page as { worldEventIds: string[] }).worldEventIds.length) {
        return JSON.stringify({ worldEventWrites: [{ value: { ...ledger.worldEvents[0], state: '共同事项完成', revision: 2 }, expectedRevision: 1 }],
          factWrites: [{ value: { ...changedFact('a0').value, id: 'world-result', actorIds: ['a0', 'a1'], worldEventIds: ['shared-event'] }, expectedRevision: 0 }] });
      }
      if (data.stage === 'actor-batch') {
        const actorId = (data.actorIds as string[])[0]; seen.push(actorId);
        expect(data.worldOverlay).toMatchObject({ worldEvents: [{ id: 'shared-event', revision: 2 }], facts: [{ id: 'world-result' }] });
        return JSON.stringify({ actorWrites: [], actorCompletions: [{ actorId, completion: 'no_change', expectedRevision: 1 }], factWrites: [],
          historyMilestoneWrites: [milestone(`history-${actorId}`, [actorId], ['world-result'], ['shared-event'])] });
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(seen).toEqual(['a0', 'a1']); expect(result.ledger.historyMilestones).toHaveLength(0);
  });

  it.each(['未选纪要事实', '未选纠正事实', '无关人物纪要'])('%s 跳过无授权条目且基线不变', async scenario => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0'), actor('a1')];
    ledger.facts = [{ ...changedFact('a0').value, id: 'selected-fact', nextCheck: { day: 1, slot: '', reason: '复查' } },
      { ...changedFact('a0').value, id: 'hidden-fact', nextCheck: { day: 1, slot: '', reason: '复查' } }];
    const before = structuredClone(ledger);
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') return JSON.stringify({
        selections: (data.directory as { actorIds: string[] }).actorIds.map(actorId => ({ actorId, historyMilestoneIds: [], worldEventIds: [], factIds: actorId === 'a0' ? ['selected-fact'] : [], reason: '资料', priority: 1, scope: 'actor' })),
        worldSelection: { worldEventIds: [], factIds: ['selected-fact'], reason: '到期', priority: 1, scope: 'world' },
      });
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      return JSON.stringify({ actorWrites: [], actorCompletions: ['a0', 'a1'].map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })),
        factWrites: scenario === '未选纠正事实' ? [{ ...changedFact('a0'), value: { ...changedFact('a0').value, supersedesFactIds: ['hidden-fact'] } }] : [],
        historyMilestoneWrites: scenario === '未选纠正事实' ? [] : [milestone('bad-history', scenario === '无关人物纪要' ? ['a0', 'a1'] : ['a0'], scenario === '未选纪要事实' ? ['hidden-fact'] : ['selected-fact'])] });
    });
    const result = await run(input);
    expect(result.roundCandidate.historyMilestoneWrites).toEqual([]);
    expect(result.roundCandidate.factWrites).toEqual([]);
    expect(ledger).toEqual(before);
  });

  it('单个超大人物在资料 gate 被拒绝，人物模型未见全文且无候选', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [{ ...actor('a0'), resources: ['巨大私密资源'.repeat(10000)] }];
    const before = structuredClone(ledger); const stages: unknown[] = [];
    const input = baseInput(ledger); input.settings.agentReadTokenBudget = 2000;
    input.countTokens = async text => Math.max(1, Math.ceil(text.length / 4));
    input.invoke = vi.fn(async (role, messages) => { stages.push(payload(messages).stage); expect(JSON.stringify(messages)).not.toContain('巨大私密资源'); return normalResponse(role, messages); });
    await expect(run(input)).rejects.toThrow('WORLD_ROUND_RECALL_DENIED');
    expect(stages).not.toContain('actor-batch'); expect(ledger).toEqual(before);
  });

  it('世界 overlay 超出人物资料预算时整包拒绝，不启动人物模型', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')]; ledger.worldEvents = [relatedEvent('event-a', ['a0'])];
    const before = structuredClone(ledger); const stages: unknown[] = [];
    const input = baseInput(ledger); input.settings.agentReadTokenBudget = 2000;
    input.countTokens = async text => Math.max(1, Math.ceil(text.length / 4));
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages); stages.push(data.stage);
      expect(JSON.stringify(messages)).not.toContain('超大世界事实');
      if (data.stage === 'recall-selection') return JSON.stringify({ ...selection(data), worldSelection: { worldEventIds: ['event-a'], factIds: [], reason: '到期', priority: 1, scope: 'world' } });
      if (data.stage === 'world-page') return JSON.stringify({ worldEventWrites: [{ value: { ...ledger.worldEvents[0], state: '变化', revision: 2 }, expectedRevision: 1 }],
        factWrites: [{ value: { ...changedFact('a0').value, summary: '超大世界事实'.repeat(10000), worldEventIds: ['event-a'] }, expectedRevision: 0 }] });
      return normalResponse(role, messages);
    });
    await expect(run(input)).rejects.toThrow('WORLD_ROUND_RECALL_DENIED');
    expect(stages).not.toContain('actor-batch'); expect(ledger).toEqual(before);
  });

  it.each(['取消', '租约失效'])('计数期间%s时最终 gate 不启动模型调用', async scenario => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const controller = new AbortController();
    let current = true;
    const input = baseInput(ledger);
    input.signal = controller.signal;
    input.isCurrent = () => current;
    input.countTokens = async () => { if (scenario === '取消') controller.abort(); else current = false; return 1; };
    await expect(run(input)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');
    expect(input.invoke).not.toHaveBeenCalled();
  });

  it('正文已有 JSON 时附带的工具调用不影响整轮', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => ({ content: normalResponse(role, messages), toolCalls: [{ id: 'x', name: 'x', arguments: '{}' }] }));
    await expect(run(input)).resolves.toMatchObject({ roundCandidate: expect.any(Object) });
  });

  it('真实长度计数触发目录页预算拒绝时，业务模型不见资料且输入不变', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    ledger.historyMilestones = [{ id: 'history-a0', summary: '很长的历史'.repeat(80), happenedAt: { day: 1, slot: '' }, actorIds: ['a0'], worldEventIds: [], locationRef: null,
      sourceFactIds: [], importance: 1, category: '历史', visibility: 'internal', revision: 1, legacyRefs: [] }];
    const before = structuredClone(ledger);
    const seenStages: string[] = [];
    const input = baseInput(ledger);
    input.settings.agentReadTokenBudget = 12;
    input.countTokens = async text => Math.max(1, Math.ceil(text.length / 4));
    input.invoke = vi.fn(async (role, messages) => { seenStages.push(payload(messages).stage as string); return normalResponse(role, messages); });
    await expect(run(input)).rejects.toThrow('WORLD_ROUND_RECALL_BLOCKED');
    expect(seenStages).toEqual(['clock-candidate']);
    expect(ledger).toEqual(before);
  });

  it('同一输入的 single 与 layered 返回结构相同候选', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const single = await run(baseInput(structuredClone(ledger), 'single'));
    const layered = await run(baseInput(structuredClone(ledger), 'layered'));
    expect(single.roundCandidate).toEqual(layered.roundCandidate);
    expect(single.ledger).toEqual(layered.ledger);
  });

  it('召回漏掉人物时补齐该人物近期历史与无变化覆盖，不整轮拒绝', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0'), actor('a1')];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'clock-candidate') return JSON.stringify({ candidateClock: clock() });
      if (data.stage === 'recall-selection') return JSON.stringify({ selections: [{ actorId: 'a0', historyMilestoneIds: [], worldEventIds: [], factIds: [], reason: '漏人', priority: 5, scope: 'actor' }], worldSelection: { worldEventIds: [], factIds: [], reason: '无', priority: 5, scope: 'world' } });
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.roundCandidate.actorCompletions.map(item => item.actorId)).toEqual(['a0', 'a1']);
  });

  it('人物批次过滤跨页写入且无渠道 knownFacts 保持原状', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = Array.from({ length: 25 }, (_, index) => actor(`a${String(index).padStart(2, '0')}`));
    const crossPage = baseInput(structuredClone(ledger));
    crossPage.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      const ids = data.actorIds as string[];
      return JSON.stringify({ actorWrites: [changedActorWrite('a24')], actorCompletions: ids.map(actorId => ({ actorId, completion: 'no_change', expectedRevision: 1 })), factWrites: [], historyMilestoneWrites: [] });
    });
    const crossResult = await run(crossPage);
    expect(crossResult.roundCandidate.actorWrites.map(write => write.value.id)).toEqual(['a24']);
    expect(crossResult.roundCandidate.actorCompletions.find(item => item.actorId === 'a00')?.completion).toBe('no_change');

    const knownFacts = baseInput(ledger);
    knownFacts.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      return JSON.stringify({ actorWrites: [{ value: { ...actor('a00'), knownFacts: ['未经渠道传播'], revision: 2 }, expectedRevision: 1 }],
        actorCompletions: (data.actorIds as string[]).map(actorId => ({ actorId, completion: actorId === 'a00' ? 'changed' : 'no_change', expectedRevision: 1 })), factWrites: [], historyMilestoneWrites: [] });
    });
    const knowledgeResult = await run(knownFacts);
    expect(knowledgeResult.ledger.actors[0].knownFacts).toEqual([]);
  });

  it.each(['single', 'layered'] as const)('%s 已投送且正文确实写入的历史由联合审查标记并冷归档，摘要保持原样，人物批不再收到历史标记资料', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('a0')];
    ledger.historyMilestones = [milestone('history-a0', ['a0'], []).value];
    const before = structuredClone(ledger);
    const deliveryQuote = '钟楼的门在昨夜被修好';
    const evidenceQuote = '钟楼的门在昨夜被修好。';
    const anchorText = `清晨，${evidenceQuote}`;
    const input = { ...baseInput(ledger, mode), anchorText, identity: identity(mode, anchorText), historyDeliveryText: `历史资料：${deliveryQuote}。` };
    let reviewed = 0;
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'actor-batch') {
        expect(data.historyRecordingMaterials).toBeUndefined();
        expect(data.historyDeliveryText).toBeUndefined();
        // 人物批即使仍返回历史字段，也静默忽略。
        return JSON.stringify({ actorWrites: [], actorCompletions: [{ actorId: 'a0', completion: 'no_change', expectedRevision: 1 }],
          historyRecordingCandidates: [{ historyId: 'history-a0', deliveryQuote, evidenceQuote }] });
      }
      if (data.stage === 'world-review-maintenance-v1') {
        reviewed += 1;
        expect(role).toBe('guidance-composer');
        expect(data.historyRecordingMaterials).toEqual([ledger.historyMilestones[0]]);
        expect(data.historyDeliveryText).toBe(input.historyDeliveryText);
        expect(data.anchor).toBe(anchorText);
        return JSON.stringify({ historyRecordingCandidates: [{ historyId: 'history-a0', deliveryQuote, evidenceQuote }] });
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    const record = { status: 'recorded', recordedAt: { day: 1, slot: '' }, anchorDigest: sha256HexSync_ACU(anchorText), deliveryQuote, evidenceQuote };
    expect(reviewed).toBe(1);
    expect(result.roundCandidate.historyRecordings).toEqual([{ historyId: 'history-a0', expectedRevision: 1, record }]);
    expect(result.roundCandidate.completion).toBe('changed');
    expect(result.ledger.historyMilestones).toEqual([]);
    expect(result.ledger.historyArchive).toEqual([{ ...before.historyMilestones[0], revision: 2, narrativeRecord: record }]);
    expect(result.ledger.historyArchive?.[0].summary).toBe(before.historyMilestones[0].summary);
    expect(ledger).toEqual(before);
  });

  it('历史标记容忍键顺序、额外字段、单条对象、别名字段、ID大小写和引文空白标点差异', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    ledger.historyMilestones = [milestone('history-a0', ['a0'], []).value];
    const anchorText = '守卫回忆：钟楼的门，昨夜修好。';
    const historyDeliveryText = '旧事：钟楼的门\n昨夜修好';
    const input = { ...baseInput(ledger), anchorText, identity: identity('layered', anchorText), historyDeliveryText };
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'world-review-maintenance-v1') return JSON.stringify({ History_Recordings: {
        evidenceQuote: '钟楼的门 昨夜修好', extra: '不影响记录', id: ' HISTORY-A0 ', delivered_quote: '钟楼的门，昨夜修好',
      } });
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.ledger.historyArchive?.[0].narrativeRecord).toMatchObject({
      status: 'recorded', deliveryQuote: '钟楼的门\n昨夜修好', evidenceQuote: '钟楼的门，昨夜修好',
    });
    expect(result.roundCandidate.completion).toBe('changed');
  });

  it.each(['仅投送但正文没写入', '正文引文不在冻结正文', '未投送', '目录外历史', '重复坏项'] as const)('%s 逐项跳过历史标记，独立合法人物结果仍提交', async scenario => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('a0'), actor('a1')];
    ledger.historyMilestones = [milestone('history-a0', ['a0'], []).value, milestone('history-a1', ['a1'], []).value];
    const before = structuredClone(ledger);
    const anchorText = scenario === '仅投送但正文没写入' ? '阿零从钟楼前经过。' : '阿零见到钟楼的门已经修好。';
    const deliveryQuote = '钟楼的门已经修好';
    const input = { ...baseInput(ledger), actorPageSize: 1, anchorText, identity: identity('layered', anchorText),
      historyDeliveryText: scenario === '未投送' ? undefined : `资料记载：${deliveryQuote}。` };
    const seen: string[] = [];
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'actor-batch') {
        const actorId = (data.actorIds as string[])[0];
        seen.push(actorId);
        if (actorId === 'a1') return normalResponse(role, messages);
        return JSON.stringify({ actorWrites: [changedActorWrite('a0')], actorCompletions: [{ actorId: 'a0', completion: 'changed', expectedRevision: 1 }] });
      }
      if (data.stage === 'world-review-maintenance-v1') {
        expect((data.historyRecordingMaterials as Array<{ id: string }>).map(row => row.id)).toEqual(['history-a0', 'history-a1']);
        const bad = { historyId: scenario === '目录外历史' ? 'history-ghost' : 'history-a0', deliveryQuote,
          evidenceQuote: scenario === '正文引文不在冻结正文' ? '钟楼的门仍然坏着' : '钟楼的门已经修好' };
        return JSON.stringify({ historyRecordingCandidates: scenario === '仅投送但正文没写入' ? [] : scenario === '重复坏项'
          ? [{ historyId: 'history-a0', deliveryQuote: '未曾投送的另一句', evidenceQuote: '钟楼的门已经修好' }, bad, bad] : [bad] });
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(seen).toEqual(['a0', 'a1']);
    // 没有投送资料时没有任何可标记的历史，也就没有审查请求。
    expect(input.invoke.mock.calls.some(call => payload(call[1] as never).stage === 'world-review-maintenance-v1')).toBe(scenario !== '未投送');
    expect(result.roundCandidate.historyRecordings ?? []).toEqual(scenario === '重复坏项' ? [{ historyId: 'history-a0', expectedRevision: 1,
      record: { status: 'recorded', recordedAt: { day: 1, slot: '' }, anchorDigest: sha256HexSync_ACU(anchorText), deliveryQuote, evidenceQuote: '钟楼的门已经修好' } }] : []);
    expect(result.ledger.actors.find(row => row.id === 'a0')?.goals).toEqual(['完成本轮事项']);
    expect(result.ledger.historyMilestones.find(row => row.id === 'history-a1')).toEqual(before.historyMilestones[1]);
    if (scenario !== '重复坏项') expect(result.ledger.historyMilestones.find(row => row.id === 'history-a0')).toEqual(before.historyMilestones[0]);
    else expect(result.ledger.historyArchive?.find(row => row.id === 'history-a0')?.narrativeRecord).toMatchObject({ deliveryQuote });
    expect(ledger).toEqual(before);
  });

  it('已在冷层且尚未标记的历史可由联合审查标记，保持冷层不复热', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU(); ledger.actors = [actor('a0')];
    const coldHistory = milestone('cold-a0', ['a0'], []).value;
    ledger.historyArchive = [coldHistory];
    const before = structuredClone(ledger);
    const anchorText = '守卫回忆钟楼的门已经修好。';
    const input = { ...baseInput(ledger), anchorText, identity: identity('layered', anchorText), historyDeliveryText: '往事：钟楼的门已经修好。' };
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'world-review-maintenance-v1') {
        expect(data.historyRecordingMaterials).toEqual([coldHistory]);
        return JSON.stringify({ historyRecordingCandidates: [{ historyId: 'cold-a0', deliveryQuote: '钟楼的门已经修好', evidenceQuote: '钟楼的门已经修好' }] });
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.roundCandidate.historyRecordings).toMatchObject([{ historyId: 'cold-a0', expectedRevision: 1 }]);
    expect(result.ledger.historyMilestones).toEqual([]);
    expect(result.ledger.historyArchive).toMatchObject([{ id: 'cold-a0', revision: 2, summary: coldHistory.summary, narrativeRecord: { status: 'recorded' } }]);
    expect(ledger).toEqual(before);
  });

  it('空 actor 页仍选择并读取到期世界事件，不因 roster 为空漏掉世界资料', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = [{ id: 'event-1', title: '事件', state: '进行', status: 'active', actorIds: [], organizationIds: [], locationRefs: [], startedAt: { day: 1, slot: '' }, deadline: null,
      nextCheck: { day: 1, slot: '', reason: '检查' }, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }];
    const worldPages: Array<{ ids: string[]; materials: string[] }> = [];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') return JSON.stringify({ selections: [], worldSelection: { worldEventIds: ['event-1'], factIds: [], reason: '到期', priority: 1, scope: 'world' } });
      if (data.stage === 'world-page') worldPages.push({ ids: (data.page as { worldEventIds: string[] }).worldEventIds, materials: Object.keys(data.worldMaterials as object) });
      return normalResponse(role, messages);
    });
    await run(input);
    expect(worldPages).toEqual([{ ids: ['event-1'], materials: ['worldEvents:event-1'] }]);
  });

  it('世界候选超过 roster 页数时逐空 actor 页保留全部到期事件', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = Array.from({ length: 17 }, (_, index) => ({ id: `event-${index}`, title: '事件', state: '进行', status: 'active' as const, actorIds: [], organizationIds: [], locationRefs: [], startedAt: { day: 1, slot: '' }, deadline: null,
      nextCheck: { day: 1, slot: '', reason: '检查' }, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }));
    const selectedPages: string[][] = [];
    const input = baseInput(ledger);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') {
        const ids = (data.directory as { dueEventIds: string[] }).dueEventIds;
        return JSON.stringify({ selections: [], worldSelection: { worldEventIds: ids, factIds: [], reason: '到期', priority: 1, scope: 'world' } });
      }
      if (data.stage === 'world-page') selectedPages.push((data.page as { worldEventIds: string[] }).worldEventIds);
      return normalResponse(role, messages);
    });
    await run(input);
    expect(selectedPages).toHaveLength(2);
    expect(new Set(selectedPages.flat())).toEqual(new Set(Array.from({ length: 17 }, (_, index) => `event-${index}`)));
    expect(selectedPages.map(page => page.length)).toEqual([16, 1]);
  });

  it('scene-only 仅返回同账本场景的 unlocked scene ID，秘密不进入语义审查或结果', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.player.location = { region: '城区', place: '广场' };
    ledger.facts = [
      sceneFact('scene-open', '可见场景'),
      sceneFact('scene-far', '远方场景', { locationRef: { region: '城区', place: '后街' } }),
      sceneFact('scene-locked', '锁定秘密', { revealState: 'locked' }),
      sceneFact('gated-secret', '不得泄露的 gated 秘密', { projectionPolicy: 'gated', revealState: 'locked', revealGate: { semanticCondition: '提问', locationRef: { region: '城区', place: '广场' } } }),
    ];
    const input = { ...baseInput(ledger), targetAnchor: targetAnchor() };
    const stages: string[] = [];
    input.invoke = vi.fn(async (role, messages) => {
      if (messages[0]?.content.includes('你执行只读联合正文审查') || messages[0]?.content.includes('执行 world-narrative-review-v1') || messages[0]?.content.includes('只读的正文场景审查')) {
        const joint = readWorldRoundPayload_ACU(messages);
        const candidates = (joint.candidates as Array<{ factId: string }> | undefined) ?? [];
        return JSON.stringify({ locationRef: { region: '城区', place: '广场' }, contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '正文' }], reviews: candidates.map(candidate => ({ factId: candidate.factId, triggered: false, evidence: [] })) });
      }
      if (messages[0]?.content.includes('执行只读正文投影语义审查')) {
        const stagePayload = JSON.parse(messages[1].content) as { candidates: Array<{ factId: string }> };
        return JSON.stringify({ reviews: stagePayload.candidates.map(candidate => ({ factId: candidate.factId, triggered: false, evidence: [] })) });
      }
      const data = payload(messages);
      stages.push(String(data.stage ?? 'business'));
      expect(JSON.stringify(messages)).not.toContain('不得泄露的 gated 秘密');
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.sceneCandidateIds).toEqual(['scene-open']);
    expect(stages).not.toContain('world-projection-semantic-review-v1');
    expect(JSON.stringify(result.sceneCandidateIds)).not.toContain('不得泄露的 gated 秘密');
    expect(JSON.stringify(result.roundCandidate)).not.toContain('不得泄露的 gated 秘密');
    expect(result.roundCandidate.projection).toEqual({ anchor: null, deliveries: [] });
    expect(result.roundCandidate.completion).toBe('no_change');
  });

  it('同楼层摘要变化不阻断，正常取消仍停止，空投影按合法结果处理', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.player.location = { region: '城区', place: '广场' };
    ledger.facts = [sceneFact('scene-open', '可见场景')];
    const digestMismatch = { ...baseInput(structuredClone(ledger)), targetAnchor: { ...targetAnchor(), contentDigest: 'bad' } };
    digestMismatch.invoke = vi.fn(async (role, messages) => messages[0]?.content.includes('你执行只读联合正文审查')
      ? JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] }) : normalResponse(role, messages));
    await expect(run(digestMismatch)).resolves.toMatchObject({ sceneCandidateIds: [], bodyProjection: { proof: expect.any(Object) } });

    const controller = new AbortController();
    const cancelled = { ...baseInput(structuredClone(ledger)), targetAnchor: targetAnchor(), signal: controller.signal, isCurrent: () => true };
    cancelled.countTokens = async text => { if (text.includes('"factIds"')) controller.abort(); return 1; };
    await expect(run(cancelled)).rejects.toThrow('WORLD_SIMULATION_RUN_STALE');

    const budgetRejected = { ...baseInput(structuredClone(ledger)), targetAnchor: targetAnchor() };
    budgetRejected.settings.agentReadTokenBudget = 10;
    budgetRejected.countTokens = async text => text.includes('"candidates"') ? 1_000_000 : 1;
    budgetRejected.invoke = vi.fn(async (role, messages) => {
      if (messages[0]?.content.includes('你执行只读联合正文审查')) {
        return JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [] });
      }
      return normalResponse(role, messages);
    });
    await expect(run(budgetRejected)).resolves.toMatchObject({ sceneCandidateIds: [] });
  });

  it('plot 分支只产出业务账本，不自行正文投影', async () => {
    const input = baseInput();
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    const result = await run(input);
    expect(result).toMatchObject({ sceneCandidateIds: [] });
    expect(input.invoke.mock.calls.some(call => String(call[1]?.[0]?.content).includes('正文场景审查'))).toBe(false);
  });

  it('世界写入未授权引用不伪造关联，缺重排事件仍能自动待确认', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = ['event-selected', 'event-hidden'].map(id => ({ id, title: id, state: '进行', status: 'active' as const, actorIds: [], organizationIds: [], locationRefs: [], startedAt: { day: 1, slot: '' }, deadline: null,
      nextCheck: { day: 1, slot: '', reason: '检查' }, relatedEventIds: [], loreRefs: [], evidenceRefs: [], tags: [], revision: 1, legacy: null }));
    ledger.facts = [{ ...changedFact('a0').value, id: 'fact-hidden', actorIds: [], worldEventIds: [], revision: 1 }];
    const cases = [
      { label: '世界事件关联', reply: { worldEventWrites: [{ value: { ...ledger.worldEvents[0], relatedEventIds: ['event-hidden'], revision: 2 }, expectedRevision: 1 }], factWrites: [] }, error: '世界事件引用了未选中世界事件' },
      { label: '事实事件', reply: { worldEventWrites: [], factWrites: [{ ...changedFact('a0'), value: { ...changedFact('a0').value, worldEventIds: ['event-hidden'] } }] }, error: '世界事实引用了未选中世界事件' },
      { label: '事实纠正', reply: { worldEventWrites: [], factWrites: [{ ...changedFact('a0'), value: { ...changedFact('a0').value, supersedesFactIds: ['fact-hidden'] } }] }, error: '世界事实纠正引用了未选中事实' },
    ];
    for (const scenario of cases) {
      const input = baseInput(structuredClone(ledger));
      input.invoke = vi.fn(async (role, messages) => {
        const data = payload(messages);
        if (data.stage === 'recall-selection') return JSON.stringify({ selections: [], worldSelection: { worldEventIds: ['event-selected'], factIds: [], reason: '到期', priority: 1, scope: 'world' } });
        if (data.stage === 'world-page') return JSON.stringify(scenario.reply);
        return normalResponse(role, messages);
      });
      const result = await run(input);
      expect(result.ledger.worldEvents[0].relatedEventIds).toEqual([]);
      expect(result.roundCandidate.factWrites).toEqual([]);
    }
  });
  it.each(['single', 'layered'] as const)('%s 仅在既有渠道、冻结引文与同一时空边界齐全时接受新增认知', async mode => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [{ ...actor('a0'), name: '阿零', informationSources: ['钟楼电台'], locationRef: { region: '城区', place: '钟楼' } }];
    const input = baseInput(ledger, mode); input.anchorText = '阿零通过钟楼电台听到港口封锁。'; input.identity = identity(mode, input.anchorText);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      return JSON.stringify({
        actorWrites: [{ value: { ...ledger.actors[0], knownFacts: ['港口已封锁'], revision: 2 }, expectedRevision: 1 }],
        actorCompletions: [{ actorId: 'a0', completion: 'changed', expectedRevision: 1 }], actorRegistrations: [],
        knowledgeAcquisitions: [{ actorId: 'a0', knowledge: '港口已封锁', channel: '钟楼电台', evidenceQuote: '阿零通过钟楼电台听到港口封锁。', acquiredAt: { day: 1, slot: '' }, locationRef: { region: '城区', place: '钟楼' } }],
        factWrites: [], historyMilestoneWrites: [],
      });
    });
    await expect(run(input)).resolves.toMatchObject({ ledger: { actors: [{ id: 'a0', knownFacts: ['港口已封锁'] }] } });
  });

  it.each([
    ['无既有渠道', (base: ReturnType<typeof actor>) => ({ actor: { ...base, knownFacts: ['港口已封锁'], revision: 2 }, acquisitions: [{ actorId: 'a0', knowledge: '港口已封锁', channel: '不存在的渠道', evidenceQuote: '阿零通过钟楼电台听到港口封锁。', acquiredAt: { day: 1, slot: '' }, locationRef: { region: '城区', place: '钟楼' } }], error: '提交前 informationSources' })],
    ['同轮新渠道', (base: ReturnType<typeof actor>) => ({ actor: { ...base, informationSources: ['钟楼电台', '刚添加的渠道'], knownFacts: ['港口已封锁'], revision: 2 }, acquisitions: [{ actorId: 'a0', knowledge: '港口已封锁', channel: '刚添加的渠道', evidenceQuote: '阿零通过钟楼电台听到港口封锁。', acquiredAt: { day: 1, slot: '' }, locationRef: { region: '城区', place: '钟楼' } }], error: '提交前 informationSources' })],
    ['页外人物', (base: ReturnType<typeof actor>) => ({ actor: { ...base, knownFacts: ['港口已封锁'], revision: 2 }, acquisitions: [{ actorId: 'a1', knowledge: '港口已封锁', channel: '钟楼电台', evidenceQuote: '阿零通过钟楼电台听到港口封锁。', acquiredAt: { day: 1, slot: '' }, locationRef: { region: '城区', place: '钟楼' } }], error: '页外人物' })],
    ['引文不符', (base: ReturnType<typeof actor>) => ({ actor: { ...base, knownFacts: ['港口已封锁'], revision: 2 }, acquisitions: [{ actorId: 'a0', knowledge: '港口已封锁', channel: '钟楼电台', evidenceQuote: '港口封锁。', acquiredAt: { day: 1, slot: '' }, locationRef: { region: '城区', place: '钟楼' } }], error: '冻结正文精确子串' })],
    ['时空不符', (base: ReturnType<typeof actor>) => ({ actor: { ...base, knownFacts: ['港口已封锁'], revision: 2 }, acquisitions: [{ actorId: 'a0', knowledge: '港口已封锁', channel: '钟楼电台', evidenceQuote: '阿零通过钟楼电台听到港口封锁。', acquiredAt: { day: 2, slot: '' }, locationRef: { region: '城区', place: '码头' } }], error: '知识获取时间' })],
  ])('不可信认知获取不升级人物：%s', async (_label, build) => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [{ ...actor('a0'), name: '阿零', informationSources: ['钟楼电台'], knownFacts: _label === '删除原认知' ? ['旧认知'] : [], locationRef: { region: '城区', place: '钟楼' } }];
    const input = baseInput(ledger); input.anchorText = '阿零通过钟楼电台听到港口封锁。'; input.identity = identity('layered', input.anchorText);
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage !== 'actor-batch') return normalResponse(role, messages);
      const result = build(ledger.actors[0]);
      return JSON.stringify({ actorWrites: [{ value: result.actor, expectedRevision: 1 }], actorCompletions: [{ actorId: 'a0', completion: 'changed', expectedRevision: 1 }], actorRegistrations: [], knowledgeAcquisitions: result.acquisitions, factWrites: [], historyMilestoneWrites: [] });
    });
    const result = await run(input);
    expect(result.ledger.actors[0].knownFacts).toEqual([]);
  });
});

describe('联合审查专员清理内部管理事实', () => {
  let originalDebug: boolean;
  beforeEach(() => { originalDebug = isDebugLogEnabled(); clearLogs(); setDebugLogEnabled(false); });
  afterEach(() => { clearLogs(); setDebugLogEnabled(originalDebug); });
  const errors = () => getAllLogs().filter(entry => entry.level === 'error');
  const internalFact = (id: string, patch: Partial<WorldFact_ACU> = {}): WorldFact_ACU =>
    sceneFact(id, `内部记录 ${id}`, { projectionPolicy: 'internal', revealState: 'locked', locationRef: null, ...patch });
  function prunableLedger() {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.player.location = { region: '城区', place: '广场' };
    ledger.facts = [
      internalFact('stale'),
      internalFact('keep-me'),
      sceneFact('scene-open', '可见场景'),
      sceneFact('gated-secret', '待揭示的秘密', { projectionPolicy: 'gated', revealState: 'locked', revealGate: { semanticCondition: '提问', locationRef: { region: '城区', place: '广场' } } }),
    ];
    ledger.factArchive = [internalFact('cold-old')];
    ledger.historyMilestones = [{ ...milestone('history-1', [], ['stale', 'keep-me']).value, revision: 1 }];
    return ledger;
  }
  const isJoint = (messages: readonly { content: string }[]) => messages[0]?.content.includes('你执行只读联合正文审查');
  const isPruneOnly = (messages: readonly { content: string }[]) => messages[0]?.content.includes('内部管理事实清理审查');

  it('body 模式：同一次联合审查请求带回 pruneFactIds，候选带 factRemovals 并清引用，不额外发请求', async () => {
    const ledger = prunableLedger();
    const input = { ...baseInput(structuredClone(ledger)), targetAnchor: targetAnchor() };
    const progress: Array<{ title?: string; detail?: string }> = [];
    (input as { onProgress?: unknown }).onProgress = async (_key: string, event: { title?: string; detail?: string }) => { progress.push(event); };
    const offered: string[][] = [];
    input.invoke = vi.fn(async (role, messages) => {
      if (isJoint(messages)) {
        const joint = readWorldRoundPayload_ACU(messages);
        offered.push((joint.pruneCandidates as Array<{ id: string }>).map(item => item.id));
        return JSON.stringify({ locationRef: { region: '城区', place: '广场' }, contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '正文' }],
          reviews: ((joint.candidates as Array<{ factId: string }> | undefined) ?? []).map(item => ({ factId: item.factId, triggered: false, evidence: [] })),
          pruneFactIds: ['stale', 'scene-open', 'cold-old', 'ghost'] });
      }
      if (messages[0]?.content.includes('执行只读正文投影语义审查')) return JSON.stringify({ reviews: [] });
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(offered).toEqual([['gated-secret', 'keep-me', 'stale']]);
    expect(input.invoke.mock.calls.filter(call => isJoint(call[1] as never))).toHaveLength(1);
    expect(input.invoke.mock.calls.some(call => isPruneOnly(call[1] as never))).toBe(false);
    expect(result.roundCandidate.factRemovals).toEqual(['stale']);
    expect(result.roundCandidate.completion).toBe('changed');
    expect(result.ledger.facts.map(fact => fact.id)).toEqual(['keep-me', 'scene-open', 'gated-secret']);
    expect(result.ledger.factArchive!.map(fact => fact.id)).toEqual(['cold-old']);
    expect(result.ledger.historyMilestones[0]).toMatchObject({ sourceFactIds: ['keep-me'], revision: 2, summary: '有事实来源的重要历史' });
    // 提交路径重新物化得到同一账本，body 许可绑定的是清理后的预览账本。
    expect(materializeWorldRoundCandidate_ACU(ledger, result.roundCandidate)).toEqual(result.ledger);
    const preview = materializeWorldRoundPreview_ACU(ledger, result.roundCandidate);
    expect(claimWorldBodyProjection_ACU(result.bodyProjection!.proof, preview, input.identity, input.targetAnchor)).toEqual(['scene-open']);
    expect(progress.some(event => event.detail?.includes('联合审查清理内部事实 1 项'))).toBe(true);
    expect(errors().some(entry => entry.message.includes('不符合条件'))).toBe(false);
  });

  it('body 模式：模型把本轮刚写的事实或场景事实列入清理时被结构过滤，仅记 error 日志', async () => {
    const ledger = prunableLedger();
    const input = { ...baseInput(structuredClone(ledger)), targetAnchor: targetAnchor() };
    input.invoke = vi.fn(async (role, messages) => {
      if (isJoint(messages)) {
        return JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [], pruneFactIds: ['scene-open', 'cold-old'] });
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.roundCandidate.factRemovals).toBeUndefined();
    expect(result.roundCandidate.completion).toBe('no_change');
    expect(result.ledger.facts.map(fact => fact.id)).toEqual(ledger.facts.map(fact => fact.id));
  });

  it('body 模式：pruneFactIds 畸形时整轮照常保存，不清理', async () => {
    const input = { ...baseInput(prunableLedger()), targetAnchor: targetAnchor() };
    input.invoke = vi.fn(async (role, messages) => isJoint(messages)
      ? JSON.stringify({ locationRef: null, contactedActorIds: [], evidence: [], reviews: [], pruneFactIds: '全部删除' })
      : normalResponse(role, messages));
    const result = await run(input);
    expect(result.roundCandidate.factRemovals).toBeUndefined();
    expect(result.ledger.facts).toHaveLength(4);
  });

  it('plot 模式：发起仅清理的联合审查请求，同一预设与自定义稿，删除并清引用', async () => {
    const ledger = prunableLedger();
    const input = baseInput(structuredClone(ledger));
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    input.settings = { ...input.settings, agentHistoryTokenBudget: 77777, worldRoundPrompts: { 'joint-reviewer': [
      { role: 'system', content: 'PLOT_PRUNE_CUSTOM', enabled: true, deletable: true, pinned: false },
    ] } };
    const progress: Array<{ title?: string; detail?: string; status?: string }> = [];
    (input as { onProgress?: unknown }).onProgress = async (_key: string, event: { title?: string; detail?: string; status?: string }) => { progress.push(event); };
    let seen: Record<string, unknown> | undefined;
    input.invoke = vi.fn(async (role, messages, _preset, tools) => {
      if (isPruneOnly(messages)) {
        seen = { tools, text: JSON.stringify(messages), data: readWorldRoundPayload_ACU(messages) };
        return '{"pruneFactIds":[{"factId":"stale","reason":"重复"},"keep-me-not-offered"]}';
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(input.invoke.mock.calls.filter(call => isPruneOnly(call[1] as never))).toHaveLength(1);
    expect(input.invoke.mock.calls.some(call => isJoint(call[1] as never))).toBe(false);
    expect(input.invoke.mock.calls.find(call => isPruneOnly(call[1] as never))![0]).toBe('guidance-composer');
    expect(seen!.text).toContain('PLOT_PRUNE_CUSTOM');
    expect(seen!.text).toMatch(/inputTokenBudget\\?"\s*:\s*77777/);
    expect(seen!.tools).toMatchObject({ tools: [], cacheTools: ['world-review-maintenance-v1'] });
    expect((seen!.data as { pruneCandidates: Array<{ id: string }> }).pruneCandidates.map(item => item.id)).toEqual(['gated-secret', 'keep-me', 'stale']);
    expect(result.roundCandidate).toMatchObject({ factRemovals: ['stale'], completion: 'changed' });
    expect(result.ledger.facts.map(fact => fact.id)).toEqual(['keep-me', 'scene-open', 'gated-secret']);
    expect(result.ledger.historyMilestones[0].sourceFactIds).toEqual(['keep-me']);
    expect(result.sceneCandidateIds).toEqual([]);
    expect(progress.filter(event => event.title === '联合审查清理与重要历史已通过').map(event => event.detail)).toEqual(['联合审查清理内部事实 1 项']);
  });

  it('无目标锚点的 body 运行同样走仅清理请求；没有候选时不发请求', async () => {
    const withAnchorless = baseInput(prunableLedger());
    withAnchorless.invoke = vi.fn(async (role, messages) => isPruneOnly(messages) ? '{"pruneFactIds":["stale"]}' : normalResponse(role, messages));
    await expect(run(withAnchorless)).resolves.toMatchObject({ roundCandidate: { factRemovals: ['stale'] } });
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.facts = [sceneFact('only-scene', '只有场景事实')];
    const none = baseInput(ledger);
    none.identity = { ...none.identity, deliveryTarget: 'plot' };
    none.invoke = vi.fn(async (role, messages) => normalResponse(role, messages));
    const result = await run(none);
    expect(none.invoke.mock.calls.some(call => isPruneOnly(call[1] as never))).toBe(false);
    expect(result.roundCandidate.factRemovals).toBeUndefined();
  });

  it('plot 模式：清理回复无法解析或请求失败时整轮照常保存，error 日志只含安全 ID 与原因', async () => {
    for (const failure of ['不是 JSON', new Error('network down')]) {
      clearLogs();
      const input = baseInput(prunableLedger());
      input.identity = { ...input.identity, deliveryTarget: 'plot' };
      input.invoke = vi.fn(async (role, messages) => {
        if (!isPruneOnly(messages)) return normalResponse(role, messages);
        if (failure instanceof Error) throw failure;
        return failure;
      });
      const result = await run(input);
      expect(result.roundCandidate.factRemovals).toBeUndefined();
      expect(result.roundCandidate.completion).toBe('no_change');
      expect(result.ledger.facts).toHaveLength(4);
      const log = errors().find(entry => entry.message.includes('联合审查清理与重要历史失败'));
      expect(log).toBeDefined();
      expect(log!.message).toContain('"step":"maintenance-review"');
      expect(log!.message).toContain('"runId":"r"');
      expect(JSON.stringify(getAllLogs())).not.toContain('内部记录 stale');
    }
  });

  it('plot 模式：清理请求途中取消仍按取消处理，不当作清理失败', async () => {
    const controller = new AbortController();
    const input = baseInput(prunableLedger());
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    input.signal = controller.signal;
    input.invoke = vi.fn(async (role, messages) => {
      if (isPruneOnly(messages)) { controller.abort(); throw new Error('aborted'); }
      return normalResponse(role, messages);
    });
    await expect(run(input)).rejects.toThrow();
    expect(errors().some(entry => entry.message.includes('联合审查清理与重要历史失败'))).toBe(false);
  });
});

describe('联合审查专员清理已结束世界事件', () => {
  let originalDebug: boolean;
  beforeEach(() => { originalDebug = isDebugLogEnabled(); clearLogs(); setDebugLogEnabled(false); });
  afterEach(() => { clearLogs(); setDebugLogEnabled(originalDebug); });
  const errors = () => getAllLogs().filter(entry => entry.level === 'error');
  const endedEvent = (id: string, status: WorldEvent_ACU['status'], patch: Partial<WorldEvent_ACU> = {}): WorldEvent_ACU =>
    ({ ...relatedEvent(id, []), status, state: `状态 ${id}`, nextCheck: null, revision: 2, ...patch });
  const internalFact = (id: string, patch: Partial<WorldFact_ACU> = {}): WorldFact_ACU =>
    sceneFact(id, `内部记录 ${id}`, { projectionPolicy: 'internal', revealState: 'locked', locationRef: null, ...patch });
  function eventLedger() {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.player.location = { region: '城区', place: '广场' };
    ledger.worldEvents = [
      endedEvent('ended-a', 'resolved'),
      endedEvent('ended-b', 'cancelled'),
      endedEvent('active-1', 'active', { relatedEventIds: ['ended-a'], nextCheck: null }),
      endedEvent('paused-1', 'paused'),
      endedEvent('planned-1', 'scheduled'),
      endedEvent('gate-ended', 'resolved'),
    ];
    ledger.facts = [
      internalFact('stale'),
      internalFact('result-a', { worldEventIds: ['ended-a'], revision: 3 }),
      sceneFact('secret', '待揭示的秘密', { projectionPolicy: 'gated', revealState: 'locked', worldEventIds: ['gate-ended'],
        revealGate: { requiredEventIds: ['gate-ended'], semanticCondition: '提问', locationRef: { region: '城区', place: '广场' } } }),
    ];
    ledger.historyMilestones = [{ ...milestone('history-1', [], ['result-a'], ['ended-a', 'active-1']).value, revision: 4 }];
    return ledger;
  }
  const isJoint = (messages: readonly { content: string }[]) => messages[0]?.content.includes('你执行只读联合正文审查');
  const isPruneOnly = (messages: readonly { content: string }[]) => messages[0]?.content.includes('内部管理事实清理审查');
  const jointReply = (joint: Record<string, unknown>, extra: Record<string, unknown>) => JSON.stringify({
    locationRef: { region: '城区', place: '广场' }, contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '正文' }],
    reviews: ((joint.candidates as Array<{ factId: string }> | undefined) ?? []).map(item => ({ factId: item.factId, triggered: false, evidence: [] })), ...extra });

  it('body 模式：同一次联合审查请求带回 pruneEventIds，候选带 eventRemovals 并只清引用，不额外发请求', async () => {
    const ledger = eventLedger();
    const input = { ...baseInput(structuredClone(ledger)), targetAnchor: targetAnchor() };
    const progress: Array<{ title?: string; detail?: string }> = [];
    (input as { onProgress?: unknown }).onProgress = async (_key: string, event: { title?: string; detail?: string }) => { progress.push(event); };
    const offered: string[][] = [];
    let jointSystem = '';
    input.invoke = vi.fn(async (role, messages) => {
      if (isJoint(messages)) {
        const joint = readWorldRoundPayload_ACU(messages);
        jointSystem = messages[0].content;
        offered.push((joint.pruneEventCandidates as Array<{ id: string }>).map(item => item.id));
        return jointReply(joint, { pruneEventIds: ['ended-a', 'active-1', 'paused-1', 'planned-1', 'gate-ended', 'ghost'], pruneFactIds: ['ended-a'] });
      }
      if (messages[0]?.content.includes('执行只读正文投影语义审查')) return JSON.stringify({ reviews: [] });
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(offered).toEqual([['ended-b', 'ended-a']]);
    expect(jointSystem).toContain('"pruneEventIds":string[]');
    expect(input.invoke.mock.calls.filter(call => isJoint(call[1] as never))).toHaveLength(1);
    expect(input.invoke.mock.calls.some(call => isPruneOnly(call[1] as never))).toBe(false);
    expect(result.roundCandidate.eventRemovals).toEqual(['ended-a']);
    expect(result.roundCandidate.factRemovals).toBeUndefined();
    expect(result.roundCandidate.completion).toBe('changed');
    expect(result.ledger.worldEvents.map(event => event.id)).toEqual(['ended-b', 'active-1', 'paused-1', 'planned-1', 'gate-ended']);
    expect(result.ledger.worldEvents.find(event => event.id === 'active-1')).toMatchObject({ relatedEventIds: [], state: '状态 active-1', revision: 3 });
    expect(result.ledger.facts.find(fact => fact.id === 'result-a')).toMatchObject({ summary: '内部记录 result-a', worldEventIds: [], revision: 4 });
    expect(result.ledger.historyMilestones[0]).toMatchObject({ summary: '有事实来源的重要历史', worldEventIds: ['active-1'], sourceFactIds: ['result-a'], revision: 5 });
    expect(result.ledger.facts.map(fact => fact.id)).toEqual(ledger.facts.map(fact => fact.id));
    // 提交路径重新物化得到同一账本，body 许可绑定的是清理后的预览账本。
    expect(materializeWorldRoundCandidate_ACU(ledger, result.roundCandidate)).toEqual(result.ledger);
    const preview = materializeWorldRoundPreview_ACU(ledger, result.roundCandidate);
    expect(claimWorldBodyProjection_ACU(result.bodyProjection!.proof, preview, input.identity, input.targetAnchor)).toEqual([]);
    expect(progress.some(event => event.detail?.includes('联合审查清理已结束事件 1 项'))).toBe(true);
    // 目录外 id 在解析阶段就被丢弃，不会走到程序过滤，因此没有跳过日志。
    expect(errors().some(entry => entry.message.includes('已跳过'))).toBe(false);
    expect(JSON.stringify(errors())).not.toContain('状态 ended-a');
  });

  it('body 模式：事实与事件同时清理，进度文案同时列出两类数量', async () => {
    const input = { ...baseInput(eventLedger()), targetAnchor: targetAnchor() };
    const progress: Array<{ title?: string; detail?: string }> = [];
    (input as { onProgress?: unknown }).onProgress = async (_key: string, event: { title?: string; detail?: string }) => { progress.push(event); };
    input.invoke = vi.fn(async (role, messages) => {
      if (isJoint(messages)) return jointReply(readWorldRoundPayload_ACU(messages), { pruneFactIds: ['stale'], pruneEventIds: ['ended-b'] });
      if (messages[0]?.content.includes('执行只读正文投影语义审查')) return JSON.stringify({ reviews: [] });
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.roundCandidate).toMatchObject({ factRemovals: ['stale'], eventRemovals: ['ended-b'], completion: 'changed' });
    expect(progress.some(event => event.detail?.includes('联合审查清理内部事实 1 项、已结束事件 1 项'))).toBe(true);
    expect(progress.some(event => event.detail?.includes('清理内部事实 1 项、清理已结束事件 1 项'))).toBe(true);
  });

  it('body 模式：pruneEventIds 畸形或指向目录外时整轮照常保存，不删事件', async () => {
    for (const pruneEventIds of ['全部删除', ['active-1', 'paused-1', 'ghost'], [null, 3]]) {
      const ledger = eventLedger();
      const input = { ...baseInput(structuredClone(ledger)), targetAnchor: targetAnchor() };
      input.invoke = vi.fn(async (role, messages) => isJoint(messages)
        ? jointReply(readWorldRoundPayload_ACU(messages), { pruneEventIds })
        : messages[0]?.content.includes('执行只读正文投影语义审查') ? JSON.stringify({ reviews: [] }) : normalResponse(role, messages));
      const result = await run(input);
      expect(result.roundCandidate.eventRemovals).toBeUndefined();
      expect(result.roundCandidate.completion).toBe('no_change');
      expect(result.ledger.worldEvents).toEqual(ledger.worldEvents);
    }
  });

  it('plot 模式：仅清理请求带事件目录与本轮正文，删除已结束事件并清引用', async () => {
    const ledger = eventLedger();
    const input = baseInput(structuredClone(ledger));
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    const progress: Array<{ title?: string; detail?: string }> = [];
    (input as { onProgress?: unknown }).onProgress = async (_key: string, event: { title?: string; detail?: string }) => { progress.push(event); };
    let seen: Record<string, unknown> | undefined;
    let system = '';
    input.invoke = vi.fn(async (role, messages, _preset, tools) => {
      if (isPruneOnly(messages)) {
        system = messages[0].content;
        seen = { tools, data: readWorldRoundPayload_ACU(messages), text: JSON.stringify(messages) };
        return '{"pruneEventIds":[{"eventId":"ended-a","reason":"正文已写"},"active-1","gate-ended"]}';
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(input.invoke.mock.calls.filter(call => isPruneOnly(call[1] as never))).toHaveLength(1);
    expect(input.invoke.mock.calls.some(call => isJoint(call[1] as never))).toBe(false);
    expect(system).toContain('{"pruneFactIds":string[],"pruneEventIds":string[]}');
    expect(seen!.tools).toMatchObject({ tools: [], cacheTools: ['world-review-maintenance-v1'] });
    expect((seen!.data as { pruneEventCandidates: Array<{ id: string; referencedByActiveEvents?: unknown }> }).pruneEventCandidates.map(item => item.id)).toEqual(['ended-b', 'ended-a']);
    expect((seen!.data as { pruneEventCandidates: Array<{ id: string; referencedByActiveEvents?: unknown }> }).pruneEventCandidates[1].referencedByActiveEvents)
      .toEqual([{ id: 'active-1', status: 'active' }]);
    expect(seen!.text).toContain('正文');
    expect(result.roundCandidate).toMatchObject({ eventRemovals: ['ended-a'], completion: 'changed' });
    expect(result.ledger.worldEvents.map(event => event.id)).toEqual(['ended-b', 'active-1', 'paused-1', 'planned-1', 'gate-ended']);
    expect(progress.filter(event => event.title === '联合审查清理与重要历史已通过').map(event => event.detail)).toEqual(['联合审查清理已结束事件 1 项']);
  });

  it('只有进行中事件、没有已结束事件和内部事实时不发清理请求', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.worldEvents = [endedEvent('active-only', 'active'), endedEvent('paused-only', 'paused')];
    const input = baseInput(ledger);
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    input.invoke = vi.fn(async (role, messages) => normalResponse(role, messages));
    const result = await run(input);
    expect(input.invoke.mock.calls.some(call => isPruneOnly(call[1] as never))).toBe(false);
    expect(result.roundCandidate.eventRemovals).toBeUndefined();
  });

  it('本轮刚收束的事件不进目录，下一轮才可清理', async () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('a0')];
    ledger.worldEvents = [endedEvent('closing', 'active', { actorIds: ['a0'], nextCheck: { day: 1, slot: '', reason: '到期' } })];
    const input = baseInput(ledger);
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    const offered: string[][] = [];
    input.invoke = vi.fn(async (role, messages) => {
      const data = payload(messages);
      if (data.stage === 'recall-selection') return JSON.stringify({ ...selection(data), worldSelection: {
        worldEventIds: ['closing'], factIds: [], reason: '到期', priority: 1, scope: 'world' } });
      if (data.stage === 'world-page') {
        const closing = ledger.worldEvents[0];
        return JSON.stringify({ worldEventWrites: [{ value: { ...closing, status: 'resolved', state: '已收束', nextCheck: null, revision: 3 }, expectedRevision: 2 }],
          factWrites: [{ ...changedFact('a0'), value: { ...changedFact('a0').value, id: 'closing-result', worldEventIds: ['closing'] } }] });
      }
      if (isPruneOnly(messages)) {
        offered.push(((data.pruneEventCandidates ?? []) as Array<{ id: string }>).map(item => item.id));
        return '{"pruneEventIds":["closing"]}';
      }
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.ledger.worldEvents.find(event => event.id === 'closing')).toMatchObject({ status: 'resolved' });
    expect(result.roundCandidate.worldEventWrites).toHaveLength(1);
    expect(result.roundCandidate.eventRemovals).toBeUndefined();
    expect(offered).toEqual([]);
    // 下一轮：该事件已是提交前就结束的事件，进入目录并可被清理。
    const next = baseInput(structuredClone(result.ledger));
    next.identity = { ...next.identity, deliveryTarget: 'plot' };
    next.invoke = vi.fn(async (role, messages) => isPruneOnly(messages)
      ? (offered.push((readWorldRoundPayload_ACU(messages).pruneEventCandidates as Array<{ id: string }>).map(item => item.id)), '{"pruneEventIds":["closing"]}')
      : normalResponse(role, messages));
    const after = await run(next);
    expect(offered).toEqual([['closing']]);
    expect(after.roundCandidate.eventRemovals).toEqual(['closing']);
    expect(after.ledger.worldEvents.some(event => event.id === 'closing')).toBe(false);
    expect(after.ledger.facts.find(fact => fact.id === 'closing-result')).toMatchObject({ summary: '已确认的行动结果', worldEventIds: [] });
  });

  it('plot 模式：事件清理回复无法解析时整轮照常保存，error 日志只含安全信息', async () => {
    const ledger = eventLedger();
    const input = baseInput(structuredClone(ledger));
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    input.invoke = vi.fn(async (role, messages) => isPruneOnly(messages) ? '这不是 JSON' : normalResponse(role, messages));
    const result = await run(input);
    expect(result.roundCandidate.eventRemovals).toBeUndefined();
    expect(result.roundCandidate.factRemovals).toBeUndefined();
    expect(result.roundCandidate.completion).toBe('no_change');
    expect(result.ledger.worldEvents).toEqual(ledger.worldEvents);
    const log = errors().find(entry => entry.message.includes('联合审查清理与重要历史失败'));
    expect(log).toBeDefined();
    expect(JSON.stringify(getAllLogs())).not.toContain('状态 ended-a');
  });
});

describe('联合审查专员总结重要历史', () => {
  let originalDebug: boolean;
  beforeEach(() => { originalDebug = isDebugLogEnabled(); clearLogs(); setDebugLogEnabled(false); });
  afterEach(() => { clearLogs(); setDebugLogEnabled(originalDebug); });
  const errors = () => getAllLogs().filter(entry => entry.level === 'error');
  const isJoint = (messages: readonly { content: string }[]) => messages[0]?.content.includes('你执行只读联合正文审查');
  const isMaintenance = (messages: readonly { content: string }[]) => readWorldRoundPayload_ACU(messages as never).stage === 'world-review-maintenance-v1';
  function historyLedger() {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [actor('a0'), actor('a1')];
    ledger.historyMilestones = [milestone('old-history', ['a0'], []).value];
    return ledger;
  }
  /** a0 本轮有变化并写入事实 fact-a0；a1 无变化。 */
  function actorReply(role: string, messages: Array<{ role: string; content: string }>) {
    const data = payload(messages);
    if (data.stage !== 'actor-batch') return undefined;
    return JSON.stringify({ actorWrites: [changedActorWrite('a0')], actorCompletions: [
      { actorId: 'a0', completion: 'changed', expectedRevision: 1 }, { actorId: 'a1', completion: 'no_change', expectedRevision: 1 }],
    factWrites: [changedFact('a0')],
    // 人物批即使仍返回历史字段也静默忽略，不让本批失败。
    historyMilestoneWrites: [milestone('actor-history', ['a0'], ['fact-a0'])], historyRecordingCandidates: [{ historyId: 'old-history' }] });
  }
  const mixedHistoryReply = () => ({
    historyMilestoneWrites: [
      { value: { id: 'new-cross', summary: '两人达成约定', happenedAt: { day: 1, slot: '' }, actorIds: ['a0', 'a1'], worldEventIds: [], locationRef: null,
        sourceFactIds: ['fact-a0'], importance: 3, category: '承诺', narrativeRecord: { status: 'recorded' } }, expectedRevision: 0 },
      { value: { id: 'ghost-fact', summary: '引用不存在的事实', actorIds: ['a0'], sourceFactIds: ['no-such-fact'] }, expectedRevision: 0 },
      { value: { id: 'old-history', summary: '与已有历史冲突', actorIds: ['a0'], sourceFactIds: [] }, expectedRevision: 3 },
      { value: { id: 'ghost-actor', summary: '引用不存在的人物', actorIds: ['nobody'], sourceFactIds: [] }, expectedRevision: 0 },
      // 裸对象、字段别名、缺省与多余字段、大小写 ID。
      { id: 'bare-alias', text: '裸对象别名字段', time: { day: 1 }, Actors: ['A1'], FactIds: ['FACT-A0'], extra: '多余字段', level: '4' },
      '不是对象',
    ],
  });

  it.each(['plot', 'body'] as const)('%s 模式：联合审查返回的重要历史真正保存；跨人物不再被本批门槛拒绝，引用不存在的与已有历史冲突的跳过，只记安全 ID', async target => {
    const ledger = historyLedger();
    const input = target === 'body' ? { ...baseInput(structuredClone(ledger)), targetAnchor: targetAnchor() }
      : { ...baseInput(structuredClone(ledger)), identity: { ...identity('layered'), deliveryTarget: 'plot' as const } };
    let seen: Record<string, unknown> | undefined;
    let system = '';
    input.invoke = vi.fn(async (role, messages) => {
      const actors = actorReply(role, messages);
      if (actors) return actors;
      if (isJoint(messages) || isMaintenance(messages)) {
        seen = readWorldRoundPayload_ACU(messages); system = messages[0].content;
        return JSON.stringify(isJoint(messages)
          ? { locationRef: { region: '城区', place: '广场' }, contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '正文' }], reviews: [], ...mixedHistoryReply() }
          : mixedHistoryReply());
      }
      if (messages[0]?.content.includes('执行只读正文投影语义审查')) return JSON.stringify({ reviews: [] });
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(input.invoke.mock.calls.filter(call => isJoint(call[1] as never) || isMaintenance(call[1] as never))).toHaveLength(1);
    expect(isMaintenance(input.invoke.mock.calls.find(call => isJoint(call[1] as never) || isMaintenance(call[1] as never))![1] as never)).toBe(target === 'plot');
    // 请求内容：本轮变化与已有历史目录；协议声明历史字段；人物批写的历史没有进入候选。
    expect((seen!.historyChanges as { facts: Array<{ id: string }> }).facts.map(item => item.id)).toEqual(['fact-a0']);
    expect((seen!.historyCatalog as Array<{ id: string }>).map(item => item.id)).toEqual(['old-history']);
    expect(seen!.anchor).toBe('正文');
    expect(system).toContain('"historyMilestoneWrites"');
    expect(system).not.toContain('pruneFactIds');
    expect(result.ledger.historyMilestones.map(item => item.id).sort()).toEqual(['bare-alias', 'new-cross', 'old-history']);
    expect(result.ledger.historyMilestones.find(item => item.id === 'new-cross')).toMatchObject({
      actorIds: ['a0', 'a1'], sourceFactIds: ['fact-a0'], visibility: 'internal', revision: 1, legacyRefs: [], importance: 3 });
    expect(result.ledger.historyMilestones.find(item => item.id === 'new-cross')!.narrativeRecord).toBeUndefined();
    expect(result.ledger.historyMilestones.find(item => item.id === 'bare-alias')).toMatchObject({
      summary: '裸对象别名字段', actorIds: ['a1'], sourceFactIds: ['fact-a0'], happenedAt: { day: 1, slot: '' }, category: '经历', importance: 4 });
    expect(result.ledger.historyMilestones.find(item => item.id === 'old-history')).toEqual(ledger.historyMilestones[0]);
    expect(result.roundCandidate.historyMilestoneWrites.map(item => item.value.id).sort()).toEqual(['bare-alias', 'new-cross']);
    expect(result.roundCandidate.historyMilestoneWrites.every(item => item.expectedRevision === 0)).toBe(true);
    expect(result.roundCandidate.completion).toBe('changed');
    // 提交路径重新物化得到同一账本。
    expect(materializeWorldRoundCandidate_ACU(ledger, result.roundCandidate)).toEqual(result.ledger);
    const log = errors().find(entry => entry.message.includes('不满足结构要求'));
    expect(log).toBeDefined();
    for (const id of ['ghost-fact', 'old-history', 'ghost-actor']) expect(log!.message).toContain(id);
    expect(JSON.stringify(getAllLogs())).not.toContain('引用不存在的事实');
  });

  it('人物批返回 historyMilestoneWrites 与 historyRecordingCandidates 被静默忽略；人物写入与事实照常保存，不报错', async () => {
    const ledger = historyLedger();
    const input = baseInput(structuredClone(ledger));
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    let actorSystem = '';
    input.invoke = vi.fn(async (role, messages) => {
      const actors = actorReply(role, messages);
      if (actors) { actorSystem = messages[0].content; return actors; }
      return isMaintenance(messages) ? '{}' : normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.ledger.actors.find(item => item.id === 'a0')?.goals).toEqual(['完成本轮事项']);
    expect(result.ledger.facts.map(item => item.id)).toEqual(['fact-a0']);
    expect(result.ledger.historyMilestones.map(item => item.id)).toEqual(['old-history']);
    expect(result.roundCandidate.historyMilestoneWrites).toEqual([]);
    expect(actorSystem).toContain('联合审查专员');
    expect(actorSystem).not.toContain('"historyMilestoneWrites":[{"value"');
    expect(errors().filter(entry => entry.message.includes('候选组未被接收'))).toEqual([]);
  });

  it('本轮要清理、却被新历史引用为来源的事实保留，其余清理照常', async () => {
    const ledger = historyLedger();
    const stale = { ...changedFact('a0').value, id: 'stale', summary: '内部记录 stale', happenedAt: { day: 1, slot: '' } };
    const other = { ...stale, id: 'other-stale', summary: '内部记录 other-stale' };
    ledger.facts = [stale, other];
    const input = baseInput(structuredClone(ledger));
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    input.invoke = vi.fn(async (role, messages) => {
      const actors = actorReply(role, messages);
      if (actors) return actors;
      if (isMaintenance(messages)) return JSON.stringify({ pruneFactIds: ['stale', 'other-stale'], historyMilestoneWrites: [
        milestone('cites-stale', ['a0'], ['stale', 'fact-a0'])] });
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(result.roundCandidate.factRemovals).toEqual(['other-stale']);
    expect(result.ledger.facts.map(item => item.id).sort()).toEqual(['fact-a0', 'stale']);
    expect(result.ledger.historyMilestones.find(item => item.id === 'cites-stale')).toMatchObject({ sourceFactIds: ['stale', 'fact-a0'] });
  });

  it('历史部分无法解析或缺失时跳过历史，清理照常，整轮正常保存并记 error 日志', async () => {
    const ledger = historyLedger();
    const stale = { ...changedFact('a0').value, id: 'stale', summary: '内部记录 stale', happenedAt: { day: 1, slot: '' } };
    ledger.facts = [stale];
    for (const reply of ['{"pruneFactIds":["stale"],"historyMilestoneWrites":"垃圾文字"}', '{"pruneFactIds":["stale"]}']) {
      clearLogs();
      const input = baseInput(structuredClone(ledger));
      input.identity = { ...input.identity, deliveryTarget: 'plot' };
      input.invoke = vi.fn(async (role, messages) => actorReply(role, messages) ?? (isMaintenance(messages) ? reply : normalResponse(role, messages)));
      const result = await run(input);
      expect(result.roundCandidate.factRemovals).toEqual(['stale']);
      expect(result.ledger.facts.map(item => item.id)).toEqual(['fact-a0']);
      expect(result.ledger.historyMilestones.map(item => item.id)).toEqual(['old-history']);
      expect(errors().some(entry => entry.message.includes('重要历史回复形状无法使用'))).toBe(reply.includes('垃圾文字'));
    }
  });

  it('没有任何目录时不发审查请求；仅有已有历史目录（无变化、无投送资料）也不构成历史职责', async () => {
    const input = baseInput(historyLedger());
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    const result = await run(input);
    expect(input.invoke.mock.calls.some(call => isMaintenance(call[1] as never) || isJoint(call[1] as never))).toBe(false);
    expect(result.roundCandidate.completion).toBe('no_change');
  });

  it('历史总结取消仍按取消处理，不当作历史失败', async () => {
    const controller = new AbortController();
    const input = { ...baseInput(historyLedger()), signal: controller.signal };
    input.identity = { ...input.identity, deliveryTarget: 'plot' };
    input.invoke = vi.fn(async (role, messages) => {
      const actors = actorReply(role, messages);
      if (actors) return actors;
      if (isMaintenance(messages)) { controller.abort(); throw new Error('aborted'); }
      return normalResponse(role, messages);
    });
    await expect(run(input)).rejects.toThrow();
    expect(errors().some(entry => entry.message.includes('联合审查清理与重要历史失败'))).toBe(false);
  });

  it('body 联合审查同一次请求标记正文记录：投送资料与冻结正文引文核对，历史冷归档，人物批不参与', async () => {
    const ledger = historyLedger();
    ledger.historyMilestones = [milestone('history-a0', ['a0'], []).value];
    const deliveryQuote = '钟楼的门在昨夜被修好';
    const anchorText = '清晨，钟楼的门在昨夜被修好。';
    const input = { ...baseInput(structuredClone(ledger)), anchorText, identity: identity('layered', anchorText), targetAnchor: targetAnchor(anchorText),
      historyDeliveryText: `历史资料：${deliveryQuote}。` };
    let seen: Record<string, unknown> | undefined;
    input.invoke = vi.fn(async (role, messages) => {
      if (isJoint(messages)) {
        seen = readWorldRoundPayload_ACU(messages);
        return JSON.stringify({ locationRef: { region: '城区', place: '广场' }, contactedActorIds: [], evidence: [{ kind: 'location', actorId: null, quote: '清晨' }], reviews: [],
          historyRecordingCandidates: [{ historyId: 'history-a0', deliveryQuote, evidenceQuote: '钟楼的门在昨夜被修好。' }] });
      }
      if (messages[0]?.content.includes('执行只读正文投影语义审查')) return JSON.stringify({ reviews: [] });
      return normalResponse(role, messages);
    });
    const result = await run(input);
    expect(input.invoke.mock.calls.filter(call => isJoint(call[1] as never))).toHaveLength(1);
    expect(seen!.historyRecordingMaterials).toEqual([ledger.historyMilestones[0]]);
    expect(seen!.historyDeliveryText).toBe(input.historyDeliveryText);
    expect(seen!.historyChanges).toBeUndefined();
    expect(result.roundCandidate.historyRecordings).toMatchObject([{ historyId: 'history-a0', expectedRevision: 1 }]);
    expect(result.ledger.historyMilestones).toEqual([]);
    expect(result.ledger.historyArchive).toMatchObject([{ id: 'history-a0', revision: 2, narrativeRecord: { status: 'recorded', deliveryQuote } }]);
    expect(materializeWorldRoundCandidate_ACU(ledger, result.roundCandidate)).toEqual(result.ledger);
  });
});
