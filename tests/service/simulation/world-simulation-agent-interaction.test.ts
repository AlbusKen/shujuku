import { describe, expect, it } from 'vitest';

import { WorldSimulationValidationError_ACU } from '../../../src/service/simulation/model';
import { parseWorldSimulationDelegationPlan_ACU, parseWorldSimulationMasterAction_ACU } from '../../../src/service/simulation/world-simulation-agent-interaction';

describe('world simulation master action protocol', () => {
  it('keeps the legacy bare delegation plan compatible while returning a delegate action', () => {
    expect(parseWorldSimulationMasterAction_ACU('{"delegations":[{"agent":"entity-movement","instruction":"移动"}]}')).toMatchObject({ kind: 'delegate', thought: '', plan: { delegations: [{ agent: 'entity-movement' }] } });
    expect(parseWorldSimulationDelegationPlan_ACU('{"delegations":[]}')).toEqual({ delegations: [] });
  });

  it('accepts maintain payload classification but reserves strict replacement validation for the session', () => {
    const raw = '{"action":"maintain_requirements","thought":"同步","expectedRevision":0,"appliedUserMessageId":"world-simulation-user:1:string:ai-1:0:1","requirements":[],"summary":"清空"}';
    expect(parseWorldSimulationMasterAction_ACU(raw)).toMatchObject({ kind: 'maintain_requirements', thought: '同步' });
  });

  it('accepts strict tools, delegation, finalize, and block actions', () => {
    expect(parseWorldSimulationMasterAction_ACU('{"action":"tools","thought":"补证","calls":[{"kind":"read","reads":["$WORLD_STATE"]}]}')).toMatchObject({ kind: 'tools' });
    expect(parseWorldSimulationMasterAction_ACU('{"action":"delegate","thought":"派工","delegations":[{"agentName":"entity-movement","task":"核验位置","materialGrants":["W1"],"reads":["$WORLD_STATE"]}]}')).toMatchObject({ kind: 'delegate', legacy: false, plan: { delegations: [{ agent: 'entity-movement', materialGrants: ['W1'] }] } });
    expect(parseWorldSimulationMasterAction_ACU('{"action":"finalize","thought":"采用","decision":"commit","acceptedAgents":["entity-movement"],"summary":"可提交","unresolved":[]}')).toMatchObject({ kind: 'finalize', decision: 'commit' });
    expect(parseWorldSimulationMasterAction_ACU('{"action":"block","thought":"缺资料","reason":"无证据","unresolved":["世界书"]}')).toMatchObject({ kind: 'block' });
  });

  it('rejects modern specialist seed reads outside the fixed non-worldbook directory', () => {
    expect(parseWorldSimulationMasterAction_ACU('{"action":"delegate","thought":"派工","delegations":[{"agentName":"entity-movement","task":"核验位置","materialGrants":[],"reads":["$STORY_PENDING"]}]}')).toMatchObject({ kind: 'delegate', legacy: false });
    expect(() => parseWorldSimulationMasterAction_ACU('{"action":"delegate","thought":"派工","delegations":[{"agentName":"entity-movement","task":"伪造读取","materialGrants":[],"reads":["正文内容"]}]}')).toThrow(WorldSimulationValidationError_ACU);
  });

  it('rejects unknown actions, missing thought, and malformed delegate fields', () => {
    for (const raw of [
      '{"action":"write_ledger","thought":"越权"}',
      '{"action":"delegate","delegations":[]}',
      '{"action":"delegate","thought":"派工","delegations":[],"forged":true}',
      '{"delegations":[],"forged":true}',
    ]) expect(() => parseWorldSimulationMasterAction_ACU(raw)).toThrow(WorldSimulationValidationError_ACU);
  });
});
