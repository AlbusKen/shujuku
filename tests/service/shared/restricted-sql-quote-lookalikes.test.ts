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

  it('尾部多出的右括号被去掉后按原语句解析', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO actors (name, known_facts) VALUES ('掌柜', '[\"城门已封\"]'))");
    expect(result.rejected).toEqual([]);
    expect(result.statements[0]).toMatchObject({ kind: 'insert', table: 'actors', values: { name: '掌柜', known_facts: '[\"城门已封\"]' } });
  });

  it('引号近似字符与多余右括号叠加时一并恢复', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO actors (name, known_facts) VALUES (\u2018\u638c\u67dc\u2019, \u2018[\"\u57ce\u95e8\u5df2\u5c01\"]\u2019))");
    expect(result.rejected).toEqual([]);
    expect(result.statements[0]).toMatchObject({ kind: 'insert', values: { name: '\u638c\u67dc', known_facts: '[\"\u57ce\u95e8\u5df2\u5c01\"]' } });
  });

  it('多余右括号出现在语句中段时不猜测删改，保留原报错', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("UPDATE clock SET days = 0, evidence_refs = '[]') WHERE expected_revision = 0");
    expect(result.statements).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('括号缺失而非多余时不改写，保留原报错', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO actors (name) VALUES ('掌柜'");
    expect(result.statements).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('严格解析路径不做归一，错误信息指明引号问题', () => {
    expect(() => parseRestrictedSqlDml_ACU("INSERT INTO actors (name) VALUES (\u2018a\u2019)")).toThrow(/英文半角单引号/);
  });
});
