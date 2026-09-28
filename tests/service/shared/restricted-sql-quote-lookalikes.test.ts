import { describe, expect, it } from 'vitest';
import { parseRestrictedSqlDml_ACU, parseRestrictedSqlDmlTolerant_ACU } from '../../../src/service/shared/restricted-sql-dml';

describe('受限 SQL 引号近似字符容错（仅一次性容错路径）', () => {
  it.each([
    ['弯引号', "INSERT INTO actors (name, visibility) VALUES (\u2018a\u2019, \u2018public\u2019)"],
    ['全角引号', "INSERT INTO actors (name, visibility) VALUES (\uFF07a\uFF07, \uFF07public\uFF07)"],
    ['反斜杠转义', "INSERT INTO actors (name, visibility) VALUES (\\'a\\', \\'public\\')"],
    ['零宽字符', "INSERT INTO actors (name, visibility) VALUES ('a', \u200B'public')"],
  ])('%s 包裹的字符串值按英文单引号解析', (_label, sql) => {
    const result = parseRestrictedSqlDmlTolerant_ACU(sql);
    expect(result.rejected).toEqual([]);
    expect(result.statements[0]).toMatchObject({ kind: 'insert', table: 'actors', values: { name: 'a', visibility: 'public' } });
  });

  it('弯引号包裹 JSON 数组的单例 UPDATE 可恢复', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("UPDATE clock SET days = 0, evidence_refs = \u2018[\"evidence:run-1:1\"]\u2019 WHERE expected_revision = 0");
    expect(result.rejected).toEqual([]);
    expect(result.statements[0]).toMatchObject({ kind: 'update', values: { days: 0, evidence_refs: '["evidence:run-1:1"]' } });
  });

  it('正文里的反斜杠转义单引号还原为字符内容', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO actors (name, known_facts) VALUES ('O\\'Neil', '[]')");
    expect(result.rejected).toEqual([]);
    expect(result.statements[0]).toMatchObject({ values: { name: "O'Neil" } });
  });

  it('已有英文单引号时正文里的中文弯引号保持原样', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO actors (name, known_facts) VALUES ('掌柜', '[\"他说\u2018封城了\u2019\"]')");
    expect(result.rejected).toEqual([]);
    expect(result.statements[0]).toMatchObject({ values: { known_facts: '["他说\u2018封城了\u2019"]' } });
  });

  it('严格解析路径不做归一，错误信息指明引号问题', () => {
    expect(() => parseRestrictedSqlDml_ACU("INSERT INTO actors (name) VALUES (\u2018a\u2019)")).toThrow(/英文半角单引号/);
  });
});
