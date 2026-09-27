import { describe, expect, it } from 'vitest';
import { parseRestrictedSqlDmlTolerant_ACU } from '../../../src/service/shared/restricted-sql-dml';

describe('一次性输出的宽容 SQL 解析', () => {
  it('修复日志中的末尾游离引号并保留两条语句', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO chronicle (summary, related_ids) VALUES ('完结', '[]');INSERT INTO rumors (fact, origin_day) VALUES ('传闻', 0)'");
    expect(result.statements).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  it('隔离中间的列值数不匹配语句', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO chronicle (summary) VALUES ('甲');INSERT INTO chronicle (summary, related_ids) VALUES ('乙');INSERT INTO chronicle (summary) VALUES ('丙')");
    expect(result.statements).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].index).toBe(1);
  });

  it('引号未闭合时只保留之前的完整语句', () => {
    const result = parseRestrictedSqlDmlTolerant_ACU("INSERT INTO chronicle (summary) VALUES ('甲');INSERT INTO chronicle (summary) VALUES ('未闭合;INSERT INTO chronicle (summary) VALUES ('丙')");
    expect(result.statements).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('未闭合');
  });
});
