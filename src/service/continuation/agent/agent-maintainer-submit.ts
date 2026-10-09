import { AGENT_MODULE_FIELD_MATRIX_ACU, type AgentModuleDelta_ACU, type AgentModuleSnapshot_ACU } from './agent-model';
import type { AgentModuleFieldSnapshot_ACU } from './agent-model';

/** 已解析的维护写集转为受限 SQL；保存仍使用原逐栏提交口，不直接改权威帧。 */
export function maintainerDeltaSql_ACU(
  delta: AgentModuleDelta_ACU,
  snapshot: AgentModuleSnapshot_ACU,
  fields: AgentModuleFieldSnapshot_ACU,
  readRevisions: AgentModuleSnapshot_ACU['revisions'],
): string {
  const literal = (value: unknown): string => {
    if (value === null) return 'NULL';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('维护写集含非法数值');
      return String(value);
    }
    if (typeof value === 'boolean') return value ? '1' : '0';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text === undefined) throw new Error('维护写集含不可序列化栏目');
    return `'${text.replace(/'/g, "''")}'`;
  };
  const column = (field: string): string => field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  const statements: string[] = [];
  const modules = [
    ['hooks', 'hooks', delta.hooks, delta.hookPatches],
    ['infoGap', 'info_gap', delta.infoGap, delta.infoGapPatches],
    ['storyArc', 'story_arc', delta.storyArc, delta.storyArcPatches],
    ['chronology', 'chronology', delta.chronology, delta.chronologyPatches],
  ] as const;
  for (const [module, table, items, patches] of modules) {
    for (const item of [...items, ...patches]) {
      const row = item as unknown as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id : '';
      // 用派工读集绑定修订号，不能拿提交前刚读到的版本掩盖并发冲突。
      const revision = readRevisions[module];
      const where = `id = ${literal(id)} AND expected_revision = ${revision}`;
      if (row.action === 'retire') {
        statements.push(`DELETE FROM ${table} WHERE ${where} AND reason = ${literal(row.reason ?? '')}`);
        continue;
      }
      const values = Object.entries(row).filter(([key, value]) => value !== undefined
        && AGENT_MODULE_FIELD_MATRIX_ACU[module].fields.includes(key));
      if (!values.length) continue;
      const existing = id && (snapshot[module].some(entry => entry.id === id) || fields.records[module]?.[id]);
      if (!('action' in row) || existing) {
        statements.push(`UPDATE ${table} SET ${values.map(([key, value]) => `${column(key)} = ${literal(value)}`).join(', ')} WHERE ${where}`);
      } else {
        const entries = [...(id ? [['id', id] as const] : []), ...values, ['expected_revision', 0] as const];
        statements.push(`INSERT INTO ${table} (${entries.map(([key]) => column(key)).join(', ')}) VALUES (${entries.map(([, value]) => literal(value)).join(', ')})`);
      }
    }
  }
  // 约束提议仅随交付交给主控裁决，不冒充已经保存的长期约束。
  return statements.join(';\n');
}
