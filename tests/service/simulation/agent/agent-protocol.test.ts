import { describe, expect, it } from 'vitest';
import { createWorldSimulationEvidenceRegistry_ACU, recordWorldSimulationEvidence_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../../src/service/simulation/world-simulation-evidence-registry';
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
    expect(() => parseWorldSimulationSpecialistResult_ACU({ status: 'candidate', agentName: 'macro', patch: { clock: {} }, summary: '越权', evidenceRefs: ['E1'], uncertainties: [] }, snapshot)).toThrowError(/EVIDENCE_REF_UNAUTHORIZED/);
    expect(() => parseWorldSimulationMainAction_ACU({ action: 'finalize', outcome: 'commit', summary: '完成', evidenceRefs: [ref] })).toThrowError(/EVIDENCE_REGISTRY_REQUIRED/);
    expect(parseWorldSimulationReviewerResult_ACU({ verdict: 'revise', summary: '需修正', findings: [{ severity: 'major', reasonCode: 'TIME_GAP', path: '$.clock', expected: '连续', actual: '跳跃' }], acceptedCandidateIds: [] })).toMatchObject({ verdict: 'revise' });
  });

  it('主输出把多个 read/search 对象收敛为原子工具批次，并拒绝未知字段', () => {
    const output = parseWorldSimulationMainOutput_ACU(
      '{"action":"read","reads":["$CLOCK"]}\n{"action":"search","query":"边境","scope":["world"],"maxResults":5}\n{"action":"finalize","outcome":"commit","summary":"不能混入"}',
    );
    expect(output).toMatchObject({ kind: 'tools', calls: [{ kind: 'read' }, { kind: 'search', maxResults: 5 }] });
    expect(() => parseWorldSimulationMainAction_ACU({ action: 'read', reads: ['$CLOCK'], extra: true })).toThrowError(/UNKNOWN_FIELD/);
    expect(() => parseWorldSimulationMainAction_ACU({ action: 'search', query: '边境', maxResults: 0 })).toThrowError(/INVALID_MAX_RESULTS/);
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
