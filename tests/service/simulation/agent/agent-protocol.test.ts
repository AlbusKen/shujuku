import { describe, expect, it } from 'vitest';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';
import { buildDefaultWorldSimulationAgentPrompts_ACU, worldSimulationDirectorProtocolInstruction_ACU, worldSimulationSpecialistProtocolInstruction_ACU } from '../../../../src/service/simulation/agent/agent-defaults';
import {
  compactWorldSimulationProtocolError_ACU,
  createWorldSimulationProtocolRepairState_ACU,
  extractFirstWorldSimulationJsonObject_ACU,
  mergeWorldSimulationJsonDrafts_ACU,
  parseWorldSimulationJsonDraft_ACU,
  parseWorldSimulationJsonPayload_ACU,
  parseWorldSimulationMainAction_ACU,
  parseWorldSimulationMainOutput_ACU,
  parseWorldSimulationPlannerOutput_ACU,
  parseWorldSimulationReviewerResult_ACU,
  parseWorldSimulationSpecialistResult_ACU,
  recordWorldSimulationProtocolFailure_ACU,
  renderWorldSimulationDirectorProtocolRejection_ACU,
  renderWorldSimulationPlannerProtocolRejection_ACU,
  renderWorldSimulationReviewerProtocolRejection_ACU,
  renderWorldSimulationSpecialistProtocolRejection_ACU,
} from '../../../../src/service/simulation/agent/agent-protocol';

const plan = { schemaVersion: 1, title: '阶段一', objective: '推进世界', impactScope: ['北境'], factsToVerify: [], plannedTools: [], plannedSpecialists: [], expectedLedgerChanges: ['clock'], convergenceConditions: ['事实闭合'], blockingConditions: [], completedSteps: [], nextStep: '执行' };

describe('世界推演 Agent 协议', () => {
  it('提取配平 JSON，并兼容 reasoning、围栏、额外文本和预填充续写', () => {
    expect(extractFirstWorldSimulationJsonObject_ACU('说明 {"action":"block","reason":"缺证据","unresolved":["时间"]} 尾注')).toContain('"action":"block"');
    const full = parseWorldSimulationJsonPayload_ACU('<think>内部思考</think>```json\n{"action":"read","reads":["$WORLD"]}\n```', '', ['action']);
    expect(full.action).toBe('read');
    const continued = parseWorldSimulationJsonPayload_ACU('推进", "action":"search", "query":"线索"}', '{"thought":"', ['action']);
    expect(continued).toMatchObject({ action: 'search', query: '线索' });
  });

  it('只抢救截断 JSON 中已经闭合的完整条目', () => {
    const draft = parseWorldSimulationJsonDraft_ACU('{"status":"candidate","items":[{"id":"A"},{"id":"B"},{"id":"C', '', ['status']);
    expect(draft.truncated).toBe(true);
    expect(draft.payload).toMatchObject({ status: 'candidate', items: [{ id: 'A' }, { id: 'B' }] });
  });

  it('解析主动作、规划、specialist 和 reviewer 的闭合契约', () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('protocol');
    const ref = recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'ledger:current', status: 'ok', summary: '当前账本', exact: true }).evidenceRef!;
    const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(registry);
    expect(parseWorldSimulationMainAction_ACU({ action: 'delegate', delegations: [{ agentName: 'macro', instruction: '分析', reads: ['$CLOCK'] }] })).toMatchObject({ kind: 'delegate' });
    expect(parseWorldSimulationPlannerOutput_ACU({ action: 'plan', summary: '已规划', plan })).toMatchObject({ action: 'plan', plan: { title: '阶段一' } });
    expect(parseWorldSimulationSpecialistResult_ACU({ status: 'candidate', agentName: 'macro', patch: { clock: { elapsed: '一天' } }, summary: '候选', evidenceRefs: [ref], uncertainties: [] }, snapshot)).toMatchObject({ status: 'candidate' });
    expect(() => parseWorldSimulationSpecialistResult_ACU({ status: 'candidate', agentName: 'macro', patch: { clock: { elapsed: '一天' } }, summary: '越权', evidenceRefs: ['E1'], uncertainties: [] }, snapshot)).toThrowError(/EVIDENCE_REF_UNAUTHORIZED/);
    expect(() => parseWorldSimulationMainAction_ACU({ action: 'finalize', outcome: 'commit', summary: '完成', evidenceRefs: [ref] })).toThrowError(/EVIDENCE_REGISTRY_REQUIRED/);
    expect(parseWorldSimulationReviewerResult_ACU({ verdict: 'revise', summary: '需修正', findings: [{ severity: 'major', reasonCode: 'TIME_GAP', path: '$.clock', expected: '连续', actual: '跳跃' }], acceptedCandidateIds: [] })).toMatchObject({ verdict: 'revise' });
  });

  it('在 specialist 边界拒绝非法模块 patch 并保留精确修正路径', () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('invalid-specialist-patch');
    const ref = recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'ledger:current', status: 'ok', summary: '当前账本', exact: true }).evidenceRef!;
    const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(registry);
    let error: unknown;
    try {
      parseWorldSimulationSpecialistResult_ACU({
        status: 'candidate', agentName: 'seed-lifecycle-analyst',
        patch: { seeds: [{ id: 'seed-1' }] }, summary: '非法种子候选', evidenceRefs: [ref], uncertainties: [],
      }, snapshot);
    } catch (caught) {
      error = caught;
    }
    expect(compactWorldSimulationProtocolError_ACU(error)).toMatchObject({
      reasonCode: 'INVALID_SPECIALIST_PATCH', path: '$.patch.seeds', expected: 'object',
    });
  });

  it('在 specialist 边界拒绝缺少持久化标识字段的实体 upsert', () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('missing-entity-label');
    const ref = recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'ledger:current', status: 'ok', summary: '当前账本', exact: true }).evidenceRef!;
    const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(registry);
    let error: unknown;
    try {
      parseWorldSimulationSpecialistResult_ACU({
        status: 'candidate', agentName: 'macro-dynamics-analyst',
        patch: { dimensions: { upsert: [{ id: 'dimension-1', expectedRevision: 0 }] } },
        summary: '缺少名称的维度候选', evidenceRefs: [ref], uncertainties: [],
      }, snapshot);
    } catch (caught) {
      error = caught;
    }
    expect(compactWorldSimulationProtocolError_ACU(error)).toMatchObject({
      reasonCode: 'INVALID_SPECIALIST_PATCH', path: '$.patch.dimensions.upsert[0].name', expected: 'non-empty string',
    });
  });

  it('只对具备强语义证据的常见状态别名做受控归一化', () => {
    const registry = createWorldSimulationEvidenceRegistry_ACU('status-alias');
    const ref = recordWorldSimulationEvidence_ACU(registry, { operation: 'initial', address: 'ledger:current', status: 'ok', summary: '当前账本', exact: true }).evidenceRef!;
    const snapshot = snapshotWorldSimulationEvidenceRegistry_ACU(registry);
    const candidate = { agentName: 'macro', patch: { clock: { elapsed: '一天' } }, summary: '候选', evidenceRefs: [ref], uncertainties: [] };
    expect(parseWorldSimulationSpecialistResult_ACU({ status: 'success', ...candidate }, snapshot)).toMatchObject({ status: 'candidate' });
    expect(parseWorldSimulationSpecialistResult_ACU({ status: 'completed', ...candidate }, snapshot)).toMatchObject({ status: 'candidate' });
    expect(parseWorldSimulationSpecialistResult_ACU({ status: 'ok', ...candidate }, snapshot)).toMatchObject({ status: 'candidate' });
    expect(parseWorldSimulationSpecialistResult_ACU({ status: 'unchanged', agentName: 'macro', summary: '无变化', evidenceRefs: [], uncertainties: [] }, snapshot)).toMatchObject({ status: 'no_change' });
    expect(() => parseWorldSimulationSpecialistResult_ACU({ status: 'success', agentName: 'macro', summary: '缺少 patch', evidenceRefs: [], uncertainties: [] }, snapshot)).toThrowError(/INVALID_SPECIALIST_STATUS/);
    expect(() => parseWorldSimulationSpecialistResult_ACU({ status: 'success', agentName: 'macro', patch: {}, summary: '空 patch', evidenceRefs: [], uncertainties: [] }, snapshot)).toThrowError(/INVALID_SPECIALIST_STATUS/);
    expect(() => parseWorldSimulationSpecialistResult_ACU({ status: 'unchanged', agentName: 'macro', patch: { clock: { elapsed: '一天' } }, summary: '冲突结构', evidenceRefs: [ref], uncertainties: [] }, snapshot)).toThrowError(/INVALID_SPECIALIST_STATUS/);
  });

  it('block 缺少机械 unresolved 列表时从有效 reason 安全推导', () => {
    expect(parseWorldSimulationMainAction_ACU({ action: 'block', reason: '缺少时间证据' })).toEqual({
      kind: 'block',
      reason: '缺少时间证据',
      unresolved: ['缺少时间证据'],
    });
  });

  it('specialist 协议拒绝回灌包含角色、枚举、写入范围与合法模板', () => {
    const message = renderWorldSimulationSpecialistProtocolRejection_ACU({ reasonCode: 'INVALID_SPECIALIST_STATUS', path: '$.status', expected: 'candidate | no_change | failed | blocked', actual: 'success' }, 'macro-dynamics-analyst', ['clock', 'dimensions']);
    expect(message).toContain('status 必须精确为 candidate、no_change、failed、blocked');
    expect(message).toContain('agentName 必须精确为 macro-dynamics-analyst');
    expect(message).toContain('patch 顶层只能使用：clock | dimensions');
    expect(message).toContain('"status":"candidate"');
    expect(message).toContain('非负整数 expectedRevision');
    expect(message).toContain('新建条目填 0');
  });

  it('reviewer 协议拒绝回灌明确 verdict、finding 结构与三种合法模板', () => {
    const message = renderWorldSimulationReviewerProtocolRejection_ACU({ reasonCode: 'INVALID_REVIEW_VERDICT', path: '$.verdict', expected: 'accept | revise | reject', actual: 'approved' });
    expect(message).toContain('verdict 必须精确为 accept、revise、reject');
    expect(message).toContain('不得使用 approve、approved、pass、success、done 等别名');
    expect(message).toContain('severity 必须精确为 blocking、major、minor');
    expect(message).toContain('"verdict":"accept"');
    expect(message).toContain('"verdict":"revise"');
    expect(message).toContain('"verdict":"reject"');
    expect(message).toContain('WORLD_SIMULATION_ENGINE_SEAM');
  });

  it('planner 协议拒绝回灌包含完整 plan 字段与账本模块白名单', () => {
    const message = renderWorldSimulationPlannerProtocolRejection_ACU({ reasonCode: 'MISSING_FIELD', path: '$.plan', expected: 'required field', actual: undefined });
    expect(message).toContain('顶层必须且只能包含 action、summary、plan');
    expect(message).toContain('schemaVersion、title、objective、impactScope');
    expect(message).toContain(`expectedLedgerChanges 只能使用：clock | dimensions | seeds | actors | chronicle | guidance`);
    expect(message).toContain('"action":"plan"');
    expect(message).toContain('WORLD_SIMULATION_ENGINE_SEAM');
  });

  it('主输出把多个 read/search 对象收敛为原子工具批次，并拒绝未知字段', () => {
    const output = parseWorldSimulationMainOutput_ACU(
      '{"action":"read","reads":["ledger:current"]}\n{"action":"search","query":"边境","scope":["world"],"maxResults":5}\n{"action":"finalize","outcome":"commit","summary":"不能混入"}',
    );
    expect(output).toMatchObject({ kind: 'tools', calls: [{ kind: 'read' }, { kind: 'search', maxResults: 5 }] });
    expect(parseWorldSimulationMainAction_ACU({ action: 'read', reads: 'ledger:current' })).toEqual({ kind: 'read', reads: ['ledger:current'] });
    expect(parseWorldSimulationMainAction_ACU({ action: 'read', address: 'summary:current' })).toEqual({ kind: 'read', reads: ['summary:current'] });
    expect(parseWorldSimulationMainAction_ACU({ action: 'read', reads: ['$WORLD_LEDGER'] })).toEqual({ kind: 'read', reads: ['ledger:current'] });
    expect(parseWorldSimulationMainOutput_ACU(
      '<WORLD_SIMULATION_ENGINE_SEAM:READ>{"action":"read","reads":["ledger:current"],"evidenceRef":"evidence:run:2","purpose":"核对账本"}</WORLD_SIMULATION_ENGINE_SEAM:READ>',
    )).toEqual({ kind: 'tools', calls: [{ kind: 'read', reads: ['ledger:current'] }] });
    expect(parseWorldSimulationMainOutput_ACU(
      '<WORLD_SIMULATION_ENGINE_SEAM:READ>{"address":"ledger:current"}</WORLD_SIMULATION_ENGINE_SEAM:READ>',
    )).toEqual({ kind: 'tools', calls: [{ kind: 'read', reads: ['ledger:current'] }] });
    expect(() => parseWorldSimulationMainOutput_ACU('{"address":"unknown:address"}')).toThrowError(/INVALID_ACTION/);
    expect(() => parseWorldSimulationMainAction_ACU({ action: 'read', reads: ['unknown:address'] })).toThrowError(/INVALID_TOOL_ADDRESS/);
    expect(() => parseWorldSimulationMainAction_ACU({ action: 'read', reads: [] })).toThrowError(/REQUIRED_TEXT_LIST/);
    expect(() => parseWorldSimulationMainAction_ACU({ action: 'read', reads: ['ledger:current'], extra: true })).toThrowError(/UNKNOWN_FIELD/);
    expect(() => parseWorldSimulationMainAction_ACU({ action: 'search', query: '边境', maxResults: 0 })).toThrowError(/INVALID_MAX_RESULTS/);
  });

  it('协议拒绝回灌明确 read/search 字段与服务端 evidenceRef 语义', () => {
    const message = renderWorldSimulationDirectorProtocolRejection_ACU({ reasonCode: 'UNKNOWN_FIELD', path: '$.evidenceRef', expected: 'no additional fields', actual: 'evidence:run:2' }, true);
    expect(message).toContain('read 只能包含 action、reads');
    expect(message).toContain('不要添加 evidenceRef、purpose');
    expect(message).toContain('由服务端在读取成功后随工具结果颁发');
    expect(message).toContain('finalize 顶层只能包含 action、outcome、summary、evidenceRefs');
    expect(message).toContain('candidateId、acceptedCandidateIds、status、verdict 禁止出现');
    expect(message).toContain('outcome 必须精确为 commit、no_change、blocked');
    expect(message).toContain('不得使用 candidate、success、done、finalized 等别名');
    expect(message).toContain('"action":"finalize","outcome":"commit"');
    expect(message).toContain('"action":"finalize","outcome":"no_change"');
    expect(message).toContain('delegate 只能包含 action、delegations');
    expect(message).toContain('evidenceRefs 只允许出现在 finalize 顶层');
  });

  it('初始提示词即声明 specialist upsert/expectedRevision 契约与 director 动作字段白名单', () => {
    const specialist = worldSimulationSpecialistProtocolInstruction_ACU('macro-dynamics-analyst', ['clock', 'dimensions', 'chronicle']);
    expect(specialist).toContain('"upsert"');
    expect(specialist).toContain('非负整数 expectedRevision');
    expect(specialist).toContain('新建条目填 0');
    expect(specialist).toContain('当前 revision');
    expect(specialist).toContain('不能只补单字段');
    expect(specialist).toContain('dimensions: id,name,kind,value,trend,rationale,evidenceRefs,revision');
    const noWrite = worldSimulationSpecialistProtocolInstruction_ACU('lore-researcher', []);
    expect(noWrite).toContain('不得输出 candidate');
    expect(noWrite).not.toContain('expectedRevision');
    const director = worldSimulationDirectorProtocolInstruction_ACU();
    expect(director).toContain('evidenceRefs 只允许出现在 finalize 顶层');
    expect(director).toContain('delegate 只能包含 action、delegations');
    expect(director).toContain('block 只能包含 action、reason、unresolved');
  });

  it('默认提示词模板已接线 specialist upsert 契约与 director 字段白名单', () => {
    const prompts = buildDefaultWorldSimulationAgentPrompts_ACU();
    const specialist = prompts['macro-dynamics-analyst'].map(segment => segment.content).join('\n');
    expect(specialist).toContain('非负整数 expectedRevision');
    expect(specialist).toContain('新建条目填 0');
    expect(specialist).toContain('ledger:current');
    const director = prompts['world-director'].map(segment => segment.content).join('\n');
    expect(director).toContain('evidenceRefs 只允许出现在 finalize 顶层');
    expect(director).toContain('block 只能包含 action、reason、unresolved');
  });

  it('草稿合并只拼接数组和递归对象，标量冲突时 fail-closed', () => {
    expect(mergeWorldSimulationJsonDrafts_ACU(
      { status: 'candidate', patch: { actors: [{ id: 'A' }] } },
      { status: 'candidate', patch: { actors: [{ id: 'B' }], clock: { elapsed: '一天' } } },
    )).toEqual({ status: 'candidate', patch: { actors: [{ id: 'A' }, { id: 'B' }], clock: { elapsed: '一天' } } });
    expect(() => mergeWorldSimulationJsonDrafts_ACU({ status: 'candidate' }, { status: 'failed' })).toThrowError(/DRAFT_MERGE_CONFLICT/);
  });

  it('结构化错误包含稳定字段，重复指纹和次数共同限制修正', () => {
    let error: unknown;
    try { parseWorldSimulationMainAction_ACU({ action: 'block', reason: '', unresolved: [] }); } catch (caught) { error = caught; }
    expect(compactWorldSimulationProtocolError_ACU(error)).toMatchObject({ reasonCode: 'REQUIRED_TEXT', path: '$.reason', expected: 'non-empty string' });
    const state = createWorldSimulationProtocolRepairState_ACU(3);
    expect(recordWorldSimulationProtocolFailure_ACU(state, error).retry).toBe(true);
    expect(recordWorldSimulationProtocolFailure_ACU(state, error).retry).toBe(false);
  });

  it('拒绝非法账本模块并保留 INVALID_LEDGER_MODULE', () => {
    let error: unknown;
    try {
      parseWorldSimulationPlannerOutput_ACU({ action: 'plan', summary: '非法模块', plan: { ...plan, expectedLedgerChanges: ['ledger'] } });
    } catch (caught) {
      error = caught;
    }
    expect(compactWorldSimulationProtocolError_ACU(error)).toMatchObject({
      reasonCode: 'INVALID_LEDGER_MODULE',
      path: '$.plan.expectedLedgerChanges',
      expected: 'clock | dimensions | seeds | actors | chronicle | guidance',
      actual: 'ledger',
    });
  });
});
