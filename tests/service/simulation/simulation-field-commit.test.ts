import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { planWorldSimulationFieldCommit_ACU } from '../../../src/service/simulation/simulation-field-commit';
import { parseWorldSimulationSqlFieldWrites_ACU } from '../../../src/service/simulation/agent/agent-protocol';
import { WORLD_SIMULATION_CHRONICLE_ARCHIVE_SCHEMA_VERSION_ACU } from '../../../src/service/simulation/agent/agent-model';
import type { WorldSimulationLedgerFieldSnapshot_ACU } from '../../../src/service/simulation/model';

const blankFields = (): WorldSimulationLedgerFieldSnapshot_ACU => ({ records: {} });
const blankArchive = () => ({ schemaVersion: WORLD_SIMULATION_CHRONICLE_ARCHIVE_SCHEMA_VERSION_ACU, records: {} });
function plan(sql: string, role: string, options: Partial<Parameters<typeof planWorldSimulationFieldCommit_ACU>[0]> = {}) {
  const parsed = parseWorldSimulationSqlFieldWrites_ACU(sql, role);
  const applied = planWorldSimulationFieldCommit_ACU({ ledger: buildEmptyWorldSimulationLedger_ACU(), fields: blankFields(), archive: blankArchive(), intents: parsed.intents, role, ...options });
  return { ...applied, rejected: [...parsed.rejected, ...applied.rejected] };
}

describe('世界推演逐栏领域规划', () => {
  it('缺必填栏目保留 partial；同批后续 UPDATE 补齐才提升完整条目', () => {
    const first = plan("INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-a', '风暴', 0)", 'undercurrent-analyst');
    expect(first.ledger.dimensions).toEqual([]);
    expect(first.ledger.revision).toBe(0);
    expect(first.partials).toEqual([expect.objectContaining({ id: 'dim-a', missingFields: expect.arrayContaining(['value']) })]);
    const second = plan("INSERT INTO dimensions (id, name, expected_revision) VALUES ('dim-a', '风暴', 0); UPDATE dimensions SET kind = 'pressure', value = 10, trend = 'rising', rationale = '海风', evidence_refs = '[]' WHERE id = 'dim-a' AND expected_revision = 0", 'undercurrent-analyst');
    expect(second.rejected).toEqual([]);
    expect(second.ledger.dimensions).toEqual([expect.objectContaining({ id: 'dim-a', name: '风暴', value: 10, revision: 1 })]);
    expect(second.ledger.revision).toBe(1);
    expect(second.partials).toEqual([]);
  });

  it('同一完整条目两句 UPDATE 只推进一轮条目和账本 revision', () => {
    const base = buildEmptyWorldSimulationLedger_ACU();
    base.dimensions = [{ id: 'dim-a', name: '风暴', kind: 'pressure', value: 10, trend: 'rising', rationale: '风大', evidenceRefs: [], revision: 1 }];
    const result = plan("UPDATE dimensions SET value = 11 WHERE id = 'dim-a' AND expected_revision = 1; UPDATE dimensions SET rationale = '夜里风更大' WHERE id = 'dim-a' AND expected_revision = 1", 'undercurrent-analyst', { ledger: base });
    expect(result.rejected).toEqual([]);
    expect(result.ledger.dimensions[0]).toMatchObject({ value: 11, rationale: '夜里风更大', revision: 2 });
    expect(result.ledger.revision).toBe(1);
  });

  it('两个完整领域模块同批只推进账本 revision 一次', () => {
    const result = plan("INSERT INTO dimensions (id, name, kind, value, trend, rationale, evidence_refs, expected_revision) VALUES ('dim-a', '风暴', 'pressure', 10, 'rising', '海风', '[]', 0); INSERT INTO seeds (id, title, status, level, catalyst, visibility, location, evidence_refs, expected_revision) VALUES ('seed-a', '出海', 'active', 1, '风向', 'public', NULL, '[]', 0)", 'undercurrent-analyst');
    expect(result.rejected).toEqual([]);
    expect(result.ledger.dimensions).toHaveLength(1);
    expect(result.ledger.seeds).toHaveLength(1);
    expect(result.ledger.revision).toBe(1);
  });

  it('非法栏目保留独立合法栏目，伪证据不会写入', () => {
    const result = plan("INSERT INTO dimensions (id, name, kind, evidence_refs, expected_revision) VALUES ('dim-a', '风暴', 'fake', '[\"evidence:fake:1\"]', 0)", 'undercurrent-analyst');
    expect(result.accepted.map(item => item.field)).toEqual(['name']);
    expect(result.rejected.map(item => item.path)).toEqual(expect.arrayContaining(['dimensions#dim-a.kind', 'dimensions#dim-a.evidenceRefs']));
    expect(result.ledger.dimensions).toEqual([]);
  });

  it('死者与传闻可以在同批满足跨模块一致性', () => {
    const result = plan("INSERT INTO rumors (id, fact, origin_day, channels, related_actor_ids, expected_revision) VALUES ('rumor-a', '失踪', 1, '[\"码头\"]', '[\"actor-a\"]', 0); INSERT INTO actors (id, name, interests, location, goals, information_sources, known_facts, life, died_at_day, death_summary, expected_revision) VALUES ('actor-a', '水手', '[]', '港口', '[]', '[]', '[]', 'dead', 1, '暴风中失踪', 0)", 'dramatis-keeper');
    expect(result.rejected).toEqual([]);
    expect(result.ledger.actors).toEqual([expect.objectContaining({ id: 'actor-a', life: 'dead' })]);
  });

  it('编年归档需一对一概览，单独归档不产生任何接受条目', () => {
    const result = plan("INSERT INTO chronicle_archive (archive_ref, day, summary) VALUES ('archive-a', 1, '风暴')", 'chronicler');
    expect(result.archiveWrites).toEqual([]);
    expect(result.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'chronicleArchive' })]));
    expect(result.accepted).toEqual([]);
  });
});

describe('世界推演逐栏批次边界', () => {
  it('旧完整条目无变化写入不推进账本与条目 revision', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.dimensions = [{ id: 'dim-a', name: '风暴', kind: 'pressure', value: 10, trend: 'rising', rationale: '海风', evidenceRefs: [], revision: 1 }];
    const result = plan("UPDATE dimensions SET value = 10 WHERE id = 'dim-a' AND expected_revision = 1", 'undercurrent-analyst', { ledger });
    expect(result.ledger.revision).toBe(0);
    expect(result.ledger.dimensions[0].revision).toBe(1);
    expect(result.accepted).toEqual([]);
  });

  it('同批两个单例 UPDATE 用同一个提交前账本 revision 并只推进一次', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    const result = plan("UPDATE player SET contact = 'open' WHERE expected_revision = 0; UPDATE player SET contact = 'secluded' WHERE expected_revision = 0", 'dramatis-keeper', { ledger });
    expect(result.rejected).toEqual([]);
    expect(result.ledger.revision).toBe(1);
    expect(result.ledger.player.contact).toBe('secluded');
    expect(result.batches).toHaveLength(1);
  });

  it('合法完整条目不因另一个领域违规的新 ID 被整体撤销', () => {
    const result = plan("INSERT INTO dimensions (id, name, kind, value, trend, rationale, evidence_refs, expected_revision) VALUES ('dim-a', '风暴', 'pressure', 10, 'rising', '海风', '[]', 0); INSERT INTO rumors (id, fact, origin_day, channels, related_actor_ids, expected_revision) VALUES ('rumor-b', '并不存在的人', 1, '[\"酒馆\"]', '[\"ghost\"]', 0)", 'undercurrent-analyst');
    // 不同角色无权写 rumor，因此此断言专门保证已授权的完整条目保留。
    expect(result.ledger.dimensions).toHaveLength(1);
    expect(result.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'sql[1].rumors' })]));
  });

  it('删除完整条目后只留下无关联合法领域行，不能获孤儿成功回执', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.actors = [{ id: 'actor-a', name: '水手', interests: [], location: '港口', locationRef: null, life: 'alive', diedAtDay: null, deathSummary: null, resources: [], goals: [], constraints: [], informationSources: [], knownFacts: [], visibility: 'public', revision: 1 }];
    ledger.rumors = [{ id: 'rumor-a', fact: '水手在港口', originDay: 1, earliestRevealDay: 1, channels: ['港口'], relatedActorIds: ['actor-a'], status: 'active', revealedAtDay: null, revision: 1 }];
    const result = plan("DELETE FROM actors WHERE id = 'actor-a' AND expected_revision = 1 AND reason = '移除'", 'dramatis-keeper', { ledger });
    expect(result.accepted).toEqual([]);
    expect(result.ledger.actors).toHaveLength(1);
    expect(result.ledger.revision).toBe(0);
  });
});

describe('推演逐栏隔离与归档', () => {
  it('同一角色的合法 actor 与孤儿 rumor 可独立保存，孤儿仅保留 partial', () => {
    const result = plan("INSERT INTO actors (id, name, interests, location, goals, information_sources, known_facts, expected_revision) VALUES ('actor-ok', '水手', '[]', '港口', '[]', '[]', '[]', 0); INSERT INTO rumors (id, fact, origin_day, channels, related_actor_ids, expected_revision) VALUES ('rumor-bad', '不存在的人', 1, '[\"酒馆\"]', '[\"ghost\"]', 0)", 'dramatis-keeper');
    expect(result.ledger.actors.map(item => item.id)).toEqual(['actor-ok']);
    expect(result.ledger.rumors).toEqual([]);
    expect(result.partials).toEqual([expect.objectContaining({ id: 'rumor-bad', promotionError: expect.any(String) })]);
    expect(result.accepted.some(item => item.module === 'actors')).toBe(true);
    expect(result.ledger.revision).toBe(1);
  });

  it('成对归档单独写入时仅推进一次账本 revision', () => {
    const result = plan("INSERT INTO chronicle_archive (archive_ref, day, summary) VALUES ('archive-a', 1, '风暴'); INSERT INTO chronicle_overview (archive_ref, day, fingerprint, one_line) VALUES ('archive-a', 1, 'fp-a', '风暴')", 'chronicler');
    expect(result.rejected).toEqual([]);
    expect(result.archiveWrites).toHaveLength(1);
    expect(result.ledger.chronicleOverview).toHaveLength(1);
    expect(result.ledger.revision).toBe(1);
    expect(result.batches).toHaveLength(0);
  });
});

describe('编年归档一致性边界', () => {
  it('概览必须对应每一条归档且使用同一个明确的 archiveRef', () => {
    const result = plan("INSERT INTO chronicle_archive (archive_ref, day, summary) VALUES ('archive-a', 1, '风暴'); INSERT INTO chronicle_overview (archive_ref, day, fingerprint, one_line) VALUES ('archive-b', 1, 'fp-b', '风暴')", 'chronicler');
    expect(result.archiveWrites).toEqual([]);
    expect(result.accepted).toEqual([]);
    expect(result.ledger.revision).toBe(0);
    expect(result.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'chronicleArchive' })]));
  });
});
