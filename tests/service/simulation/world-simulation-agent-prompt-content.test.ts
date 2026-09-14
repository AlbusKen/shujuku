import { describe, expect, it } from 'vitest';
import {
  buildWorldSimulationWorkflowRules_ACU,
  getWorldSimulationSpecialistRules_ACU,
  WORLD_SIMULATION_DIRECTOR_ACTION_PROMPT_ACU,
  WORLD_SIMULATION_DIRECTOR_ROOT_PROMPT_ACU,
  WORLD_SIMULATION_SHARED_COGNITION_PROMPT_ACU,
  WORLD_SIMULATION_SPECIALIST_OUTPUT_PROMPT_ACU,
  WORLD_SIMULATION_SPECIALIST_ROOT_PROMPT_ACU,
} from '../../../src/service/simulation/world-simulation-agent-prompt-content';

describe('world simulation deep prompt content', () => {
  it('defines a shared evidence hierarchy and multidimensional world model', () => {
    for (const text of [
      '世界记忆维护与因果推算', '当前 active swipe', '当前世界账本',
      '时间与因果', '行动者', '空间与传播', '势力与制度', '压力与生长',
      '关系与承诺', '暗线生命周期', '信息生态', '环境与生活', '节奏与负证据',
      'entities', 'events', 'threads', '稳定 id', 'retire',
    ]) expect(WORLD_SIMULATION_SHARED_COGNITION_PROMPT_ACU).toContain(text);
    expect(WORLD_SIMULATION_SHARED_COGNITION_PROMPT_ACU).toContain('宁可 no_change');
    expect(WORLD_SIMULATION_SHARED_COGNITION_PROMPT_ACU).toContain('目录、概要、搜索命中');
  });

  it('gives the director an auditable requirements, evidence, delegation and convergence workflow', () => {
    for (const text of [
      'maintain_requirements', '增量判读', '影响分解', '世界书调配', '精准派工',
      '候选审核', 'expectedRevision', 'materialGrants', 'finalize', 'no_change', 'block',
    ]) expect(`${WORLD_SIMULATION_DIRECTOR_ROOT_PROMPT_ACU}\n${WORLD_SIMULATION_DIRECTOR_ACTION_PROMPT_ACU}`).toContain(text);
    expect(WORLD_SIMULATION_DIRECTOR_ROOT_PROMPT_ACU).toContain('不直接生成 entities、events、threads 写集');
    expect(buildWorldSimulationWorkflowRules_ACU(true)).toContain('纪要概要、目录和搜索命中只用于定位');
  });

  it('gives each specialist a distinct domain checklist without widening write authority', () => {
    const entity = getWorldSimulationSpecialistRules_ACU('entity-movement');
    const event = getWorldSimulationSpecialistRules_ACU('faction-events');
    const thread = getWorldSimulationSpecialistRules_ACU('thread-weaver');
    expect(entity).toContain('【实体推演规则】');
    expect(entity).toContain('位置与处境');
    expect(entity).toContain('不创建 events 或 threads');
    expect(event).toContain('【事件推演规则】');
    expect(event).toContain('occurredAt 与 durationHint');
    expect(event).toContain('不直接修改 entities 或 threads');
    expect(thread).toContain('【线索推演规则】');
    expect(thread).toContain('brewing');
    expect(thread).toContain('不创建 entities 或 events');
    expect(WORLD_SIMULATION_SPECIALIST_ROOT_PROMPT_ACU).toContain('你是世界推演的受限子代理 $AGENT_NAME');
    expect(WORLD_SIMULATION_SPECIALIST_OUTPUT_PROMPT_ACU).toContain('【输出协议】');
    expect(WORLD_SIMULATION_SPECIALIST_OUTPUT_PROMPT_ACU).toContain('evidenceRefs');
  });
});
