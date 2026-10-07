export type SqlTableAliasMap_ACU = ReadonlyMap<string, string>;
export type SqlColumnAliasMap_ACU = ReadonlyMap<string, ReadonlyMap<string, string>>;

export interface SqlReadRebindResult_ACU {
  sql: string;
  tableRebindCount: number;
  columnRebindCount: number;
  /** Internal ranges used by the shared read resolver before legacy translation. */
  protectedIdentifierSpans?: Array<{ start: number; end: number }>;
}

type Quote_ACU = '"' | '`' | '[' | null;
interface Token_ACU { start: number; end: number; value: string; quote: Quote_ACU; depth: number; commaBefore: boolean; }

function wordStart(char: string): boolean { return /^[A-Za-z_\u0080-\uFFFF]$/.test(char); }
function wordPart(char: string): boolean { return /^[A-Za-z0-9_$\u0080-\uFFFF]$/.test(char); }
function keyword(token: Token_ACU | undefined, value: string): boolean {
  return !!token && token.quote === null && token.value.toUpperCase() === value;
}

function tokens(sql: string): Token_ACU[] {
  const result: Token_ACU[] = [];
  let index = 0;
  let depth = 0;
  const commaDepths = new Set<number>();
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === '-' && next === '-') { index += 2; while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1; continue; }
    if (char === '/' && next === '*') { const end = sql.indexOf('*/', index + 2); if (end < 0) throw new Error('unterminated comment'); index = end + 2; continue; }
    if (char === "'") { index += 1; while (index < sql.length) { if (sql[index] !== "'") index += 1; else if (sql[index + 1] === "'") index += 2; else { index += 1; break; } } if (sql[index - 1] !== "'") throw new Error('unterminated string'); continue; }
    if (char === ',') { commaDepths.add(depth); index += 1; continue; }
    if (char === '(') { commaDepths.delete(depth); depth += 1; index += 1; continue; }
    if (char === ')') { depth = Math.max(0, depth - 1); index += 1; continue; }
    if (char === '"' || char === '`' || char === '[') {
      const quote = char as Exclude<Quote_ACU, null>; const close = quote === '[' ? ']' : quote; const start = index; let value = ''; index += 1; let closed = false;
      while (index < sql.length) { if (sql[index] !== close) value += sql[index++]; else if (sql[index + 1] === close) { value += close; index += 2; } else { index += 1; closed = true; break; } }
      if (!closed) throw new Error('unterminated quoted identifier'); result.push({ start, end: index, value, quote, depth, commaBefore: commaDepths.delete(depth) }); continue;
    }
    if (wordStart(char)) { const start = index; index += 1; while (index < sql.length && wordPart(sql[index])) index += 1; result.push({ start, end: index, value: sql.slice(start, index), quote: null, depth, commaBefore: commaDepths.delete(depth) }); continue; }
    index += 1;
  }
  return result;
}

function qualifiedTail(sql: string, values: Token_ACU[], start: number): Token_ACU | undefined {
  let token = values[start];
  if (!token) return undefined;
  let index = start;
  while (values[index + 1] && values[index + 1].depth === token.depth && /^\s*\.\s*$/.test(sql.slice(token.end, values[index + 1].start))) token = values[++index];
  return token;
}

function mutationTarget(sql: string, values: Token_ACU[]): Token_ACU | undefined {
  const first = values[0];
  const actionIndex = keyword(first, 'WITH') ? values.findIndex((token, index) => index > 0 && token.depth === 0 && ['INSERT', 'REPLACE', 'UPDATE', 'DELETE'].includes(token.value.toUpperCase())) : 0;
  const action = values[actionIndex];
  if (!action) return undefined;
  if (keyword(action, 'INSERT') || keyword(action, 'REPLACE')) {
    let index = actionIndex + 1;
    if (keyword(action, 'INSERT') && keyword(values[index], 'OR')) index += 2;
    return keyword(values[index], 'INTO') ? qualifiedTail(sql, values, index + 1) : undefined;
  }
  if (keyword(action, 'UPDATE')) { let index = actionIndex + 1; if (keyword(values[index], 'OR')) index += 2; return qualifiedTail(sql, values, index); }
  return keyword(action, 'DELETE') && keyword(values[actionIndex + 1], 'FROM') ? qualifiedTail(sql, values, actionIndex + 2) : undefined;
}

interface CteScope_ACU { name: string; depth: number; start: number; end: number; }

function cteScopes(values: Token_ACU[]): CteScope_ACU[] {
  const result: CteScope_ACU[] = [];
  for (let withIndex = 0; withIndex < values.length; withIndex += 1) {
    const withToken = values[withIndex];
    if (!keyword(withToken, 'WITH')) continue;
    const depth = withToken.depth;
    let index = withIndex + 1;
    if (keyword(values[index], 'RECURSIVE')) index += 1;
    const names: string[] = [];
    let valid = false;
    while (values[index]) {
      const name = values[index];
      if (!name || name.depth !== depth) break;
      index += 1;
      if (values[index]?.depth === depth + 1) {
        const columnDepth = values[index].depth;
        while (values[index] && values[index].depth >= columnDepth) index += 1;
      }
      if (!keyword(values[index], 'AS')) break;
      names.push(name.value.toLowerCase());
      index += 1;
      if (!values[index] || values[index].depth !== depth + 1) break;
      const definitionDepth = values[index].depth;
      while (values[index] && values[index].depth >= definitionDepth) index += 1;
      valid = true;
      if (!values[index]?.commaBefore || values[index].depth !== depth) break;
    }
    if (!valid) continue;
    const end = values.findIndex((token, tokenIndex) => tokenIndex > index && token.depth < depth);
    for (const name of names) result.push({ name, depth, start: withIndex, end: end < 0 ? values.length : end });
  }
  return result;
}

function isCteReference(values: Token_ACU[], token: Token_ACU, scopes: CteScope_ACU[]): boolean {
  const index = values.indexOf(token);
  return index >= 0 && scopes.some(scope => (
    scope.name === token.value.toLowerCase()
    && index >= scope.start
    && index < scope.end
    && token.depth >= scope.depth
  ));
}

function references(sql: string, values: Token_ACU[], target: Token_ACU): Token_ACU[] {
  const result = new Map<number, Token_ACU>([[target.start, target]]);
  const scopes = cteScopes(values);
  const terminators = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW', 'RETURNING', 'VALUES', 'SET']);
  const fromDepths = new Set<number>();
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    const value = token.quote === null ? token.value.toUpperCase() : '';
    if (terminators.has(value)) fromDepths.delete(token.depth);
    if (value === 'FROM') fromDepths.add(token.depth);
    if (value === 'FROM' || value === 'JOIN') {
      const reference = qualifiedTail(sql, values, index + 1);
      if (reference && reference.depth === token.depth && !isCteReference(values, reference, scopes)) result.set(reference.start, reference);
    } else if (token.commaBefore && fromDepths.has(token.depth) && !isCteReference(values, token, scopes)) {
      result.set(token.start, token);
    }
  }
  return [...result.values()];
}

function format(value: string, quote: Quote_ACU): string {
  if (quote === '"') return `"${value.replace(/"/g, '""')}"`;
  if (quote === '`') return `\`${value.replace(/`/g, '``')}\``;
  if (quote === '[') return `[${value.replace(/]/g, ']]')}]`;
  return value;
}

export function decodeSqlIdentifier_ACU(value: unknown): string {
  const text = String(value || '').trim();
  if (text.length >= 2 && ((text[0] === '"' && text[text.length - 1] === '"') || (text[0] === '`' && text[text.length - 1] === '`'))) {
    return text.slice(1, -1).split(text[0] + text[0]).join(text[0]);
  }
  if (text.length >= 2 && text[0] === '[' && text[text.length - 1] === ']') return text.slice(1, -1).split(']]').join(']');
  return text;
}

export function rebindSqlMutationTableReferences_ACU(
  statements: string[],
  aliases: SqlTableAliasMap_ACU,
  options: {
    lenient?: boolean;
    requireKnownTables?: boolean;
    /** 规范化后的歧义别名集合：命中即结构化拒绝，不随机选择、不当作未知表放行。 */
    ambiguousAliases?: ReadonlySet<string>;
  } = {},
): string[] {
  const resolvedAliases = new Map<string, string>();
  for (const [alias, physicalName] of aliases) resolvedAliases.set(decodeSqlIdentifier_ACU(alias).toLowerCase(), physicalName);
  const normalizedAmbiguous = new Set<string>();
  for (const alias of options.ambiguousAliases || []) {
    normalizedAmbiguous.add(decodeSqlIdentifier_ACU(alias).toLowerCase());
  }
  return statements.map(statement => {
    try {
      const values = tokens(statement);
      const target = mutationTarget(statement, values);
      if (!target) return statement;
      const tableReferences = references(statement, values, target);
      for (const reference of tableReferences) {
        if (normalizedAmbiguous.has(reference.value.toLowerCase())) {
          const role = reference.start === target.start ? '目标表' : '关联表';
          const error = new Error(
            `SQL 写入引用了歧义表名「${reference.value}」：该名称同时指向多张物理表，无法安全路由。请改用各表当前唯一物理表名，或只针对唯一英文表名编写 SQL。`,
          );
          Object.defineProperty(error, 'code', {
            value: 'SQL_ALIAS_AMBIGUOUS_ACU',
            enumerable: false,
          });
          throw error;
        }
      }
      if (options.requireKnownTables) {
        for (const reference of tableReferences) {
          if (!resolvedAliases.has(reference.value.toLowerCase())) {
            const role = reference.start === target.start ? '目标表' : '关联表';
            throw new Error(`SQL 写入包含无法识别的${role}「${reference.value}」。`);
          }
        }
      }
      if (!resolvedAliases.has(target.value.toLowerCase())) return statement;
      const replacements = tableReferences
        .map(token => ({ token, name: resolvedAliases.get(token.value.toLowerCase()) }))
        .filter((item): item is { token: Token_ACU; name: string } => !!item.name);
      let result = statement;
      for (const { token, name } of replacements.sort((left, right) => right.token.start - left.token.start)) {
        result = `${result.slice(0, token.start)}${format(name, token.quote)}${result.slice(token.end)}`;
      }
      return result;
    } catch (error) {
      if (options.lenient) return statement;
      throw error;
    }
  });
}


/**
 * 列名重绑纯工具：把历史物理列名（或别名表里的其他列名）改写为当前物理列名。
 *
 * 调用方注入 columnAliases（来自 buildSheetColumnAliasMap_ACU 的物理表 → 列别名表）
 * 与当前目标物理表名；本模块保持零依赖，不解析 schema、不做相似度猜测。
 *
 * 安全边界（计划 4.1）：
 * - 只在可证明是列引用的位置替换：UPDATE SET 左侧、INSERT 列清单、WHERE/RETURNING
 *   中的非函数非关键字裸标识符。
 * - 不碰：字符串字面量、注释（tokens 已跳过）、VALUES 中的值、函数名、AS 后别名、
 *   限定符点号左侧。
 * - 语句含目标表之外的表引用（JOIN / 子查询 / 逗号连接多表 / INSERT...SELECT）时
 *   整条放弃列重绑并抛结构化错误：跨表列归属无法在不解析 schema 的纯工具里证明。
 * - 命中 ambiguousColumns → 抛 SQL_COLUMN_ALIAS_AMBIGUOUS_ACU。
 * - 别名表查不到 → 原样保留，交给 SQLite 报真实 no such column（无证据不猜）。
 * - 不提供 lenient 选项：写路径重绑错误会静默写进错误列并持久化，必须 fail closed。
 */
export function rebindSqlMutationColumnReferences_ACU(
  statements: string[],
  columnAliases: SqlColumnAliasMap_ACU,
  targetPhysicalTableName: string,
  options: {
    ambiguousColumns?: ReadonlySet<string>;
    /** 实时 AI 写路径 opt-in：INSERT/REPLACE 显式列清单命中 registry 未知列时抛 SQL_INSERT_UNKNOWN_COLUMN_ACU。 */
    requireKnownInsertColumns?: boolean;
    /** 每次实际发生的列改写上报一次（from=历史/别名列名，to=当前物理列名），供调用方做诊断取证。 */
    onRebound?: (rebind: { from: string; to: string }) => void;
    /**
     * 歧义别名 → 候选目标列列表。仅供错误信息里给出「全部候选与各自证据」；
     * 纯工具不解析 schema，由调用方注入（来自 buildSheetColumnAliasMap_ACU 的 conflictCandidates）。
     */
    resolveAmbiguity?: (alias: string) => ReadonlyArray<{ target: string; evidence: string }>;
  } = {},
): string[] {
  const tableKey = decodeSqlIdentifier_ACU(targetPhysicalTableName).toLowerCase();
  const tableColumns = columnAliases.get(tableKey);
  const resolvedAliases = new Map<string, string>();
  if (tableColumns) {
    for (const [alias, physicalName] of tableColumns) {
      const aliasKey = decodeSqlIdentifier_ACU(alias).toLowerCase();
      if (aliasKey) resolvedAliases.set(aliasKey, physicalName);
    }
  }
  const normalizedAmbiguous = new Set<string>();
  for (const alias of options.ambiguousColumns || []) {
    normalizedAmbiguous.add(decodeSqlIdentifier_ACU(alias).toLowerCase());
  }

  return statements.map(statement => {
    const values = tokens(statement);
    const target = mutationTarget(statement, values);
    // 无法识别 mutation 目标 → 原样放行（无证据不猜）。
    if (!target) return statement;
    // 目标表不是当前物理表 → 不重绑（避免把别名表里的列套到别的表上）。
    if (decodeSqlIdentifier_ACU(target.value).toLowerCase() !== tableKey) return statement;

    // INSERT...SELECT / 子查询：SELECT 出现即含子查询语义，放弃列重绑、原样放行。
    // 这类语句是 V2 历史日志中的合法回放路径（replay.test.ts:869 的 WITH...UPDATE...
    // SELECT... 子查询用例）。子查询内列归属无法在不解析 schema 的纯工具中证明，
    // 强行重绑可能改错子查询内部标识符；原样放行后，若列名真是历史名，SQLite 会
    // 报真实的 no such column —— 仍是 fail closed，只是错误信息不是本工具的结构化码。
    // SELECT 检测必须先于跨表检测：INSERT...SELECT / UPDATE...FROM 等含多表引用，
    // 但属于既有合法放行路径（如 sql-table-service 的「不支持 INSERT SELECT」校验在
    // 列重绑之后才执行）；若先抛跨表拒绝会改变原有错误优先级与契约。
    if (values.some(value => keyword(value, 'SELECT'))) {
      return statement;
    }
    // 跨表检测：references() 首项即目标表自身，多于 1 项说明含 JOIN/逗号连接/CTE 关联。
    const tableReferences = references(statement, values, target);
    if (tableReferences.length > 1) {
      throw structuredMutationColumnError_ACU(
        'SQL_COLUMN_CROSS_TABLE_REFUSED_ACU',
        'SQL 写入包含目标表之外的关联表列归属无法在不解析 schema 的纯工具中证明，已拒绝列重绑。请改用当前物理列名直接书写。',
      );
    }

    const replacements = collectMutationColumnReplacements_ACU(statement, values, resolvedAliases, normalizedAmbiguous, options.resolveAmbiguity, options.requireKnownInsertColumns, targetPhysicalTableName);
    let result = statement;
    for (const { token, value } of replacements) {
      options.onRebound?.({ from: decodeSqlIdentifier_ACU(token.value), to: value });
    }
    for (const { token, value } of [...replacements].sort((left, right) => right.token.start - left.token.start)) {
      result = `${result.slice(0, token.start)}${format(value, token.quote)}${result.slice(token.end)}`;
    }
    return result;
  });
}

/**
 * 按语句 mutation target 自动选择列 map 的纯包装（计划 3.7）。
 *
 * 实时写批次可能包含多条语句、各自指向不同目标表；调用方（applyEdits 等）
 * 不必预先知道单一 sheet。本函数只解析 mutation target（token 级），
 * 不读取 schema、不引入依赖：
 * - 每条语句独立解析目标表名，查 columnAliases 里对应的列别名表并重绑；
 * - 目标表在 columnAliases 中不存在 → 原样放行（该表未注册列别名，交给 SQLite）；
 * - 无法解析 mutation target → 原样放行（无证据不猜）。
 *
 * 冲突按目标表隔离：ambiguousColumns 以「物理表名(小写) → 冲突别名集」组织，
 * 命中即结构化拒绝（SQL_COLUMN_ALIAS_AMBIGUOUS_ACU），绝不原样放行成
 * no such column。跨表/子查询语义与 rebindSqlMutationColumnReferences_ACU 一致。
 */
export function rebindSqlMutationColumnsByTarget_ACU(
  statements: string[],
  columnAliases: SqlColumnAliasMap_ACU,
  options: {
    ambiguousColumns?: ReadonlyMap<string, ReadonlySet<string>>;
    /** 实时 AI 写路径 opt-in：INSERT/REPLACE 显式列清单命中 registry 未知列时抛 SQL_INSERT_UNKNOWN_COLUMN_ACU。 */
    requireKnownInsertColumns?: boolean;
    onRebound?: (rebind: { from: string; to: string; targetTable: string }) => void;
    resolveAmbiguity?: (targetTable: string, alias: string) => ReadonlyArray<{ target: string; evidence: string }>;
  } = {},
): string[] {
  return statements.map(statement => {
    let targetTableName: string | null = null;
    try {
      const values = tokens(statement);
      const target = mutationTarget(statement, values);
      if (!target) return statement;
      targetTableName = decodeSqlIdentifier_ACU(target.value);
      const targetKey = decodeSqlIdentifier_ACU(target.value).toLowerCase();
      const tableColumns = columnAliases.get(targetKey);
      if (!tableColumns) return statement; // 未注册列别名的目标表 → 原样放行
      return rebindSqlMutationColumnReferences_ACU([statement], columnAliases, target.value, {
        ambiguousColumns: options.ambiguousColumns?.get(targetKey),
        requireKnownInsertColumns: options.requireKnownInsertColumns,
        onRebound: options.onRebound
          ? rebind => options.onRebound?.({ ...rebind, targetTable: targetTableName as string })
          : undefined,
        resolveAmbiguity: options.resolveAmbiguity
          ? alias => options.resolveAmbiguity?.(targetTableName as string, alias) || []
          : undefined,
      })[0];
    } catch (error) {
      // 与单表重绑一致：无 lenient，错误必须上抛（避免静默写进错误列）。
      throw error;
    }
  });
}


function structuredMutationColumnError_ACU(code: string, message: string): Error {
  const error = new Error(`[${code}] ${message}`);
  Object.defineProperty(error, 'code', { value: code, enumerable: false });
  return error;
}

/**
 * 收集可证明是列引用的重绑点。统一按位置语义扫描，不做内容猜测：
 * - UPDATE：SET 之后、WHERE/RETURNING 之前，depth 相同且后跟 `=` 的标识符（列赋值左侧）；
 * - INSERT/REPLACE：表名后紧邻括号（depth+1）内的逗号分隔标识符（列清单）；
 * - WHERE / RETURNING：非函数、非关键字、非 AS 别名、非限定符左侧的裸标识符。
 */
function collectMutationColumnReplacements_ACU(
  sql: string,
  values: Token_ACU[],
  aliases: Map<string, string>,
  ambiguous: Set<string>,
  resolveAmbiguity?: (alias: string) => ReadonlyArray<{ target: string; evidence: string }>,
  /** INSERT/REPLACE 显式列清单命中 registry 未知列时 fail-closed（实时 AI 写路径 opt-in）。 */
  requireKnownInsertColumns?: boolean,
  /** 目标物理表名（仅用于未知列结构化错误信息）。 */
  targetTableName?: string,
): Array<{ token: Token_ACU; value: string }> {
  const replacements: Array<{ token: Token_ACU; value: string }> = [];
  const handledStarts = new Set<number>();
  const addIfAlias = (token: Token_ACU | undefined, isInsertColumn: boolean): void => {
    if (!token) return;
    const key = decodeSqlIdentifier_ACU(token.value).toLowerCase();
    if (ambiguous.has(key)) {
      const candidates = resolveAmbiguity?.(token.value) || [];
      const candidateText = candidates.length > 0
        ? ` 候选列：${candidates.map(candidate => `${candidate.target}（证据：${candidate.evidence}）`).join('、')}。`
        : '';
      throw structuredMutationColumnError_ACU(
        'SQL_COLUMN_ALIAS_AMBIGUOUS_ACU',
        `SQL 写入引用了歧义列名「${token.value}」：该名称同时映射到多列，无法安全重绑。请改用当前唯一物理列名。${candidateText}`,
      );
    }
    const target = aliases.get(key);
    if (!target) {
      // 列清单里出现 registry 未知列：实时 AI 写路径必须 fail-closed，
      // 否则 SQLite 晚失败会泄漏完整 SQL/VALUES（test31 根因 3.4）。
      if (isInsertColumn && requireKnownInsertColumns) {
        // 模型偶尔把列名写短（posture → post）：只有唯一一列以它开头时才纠正，否则照旧拒绝。
        const prefixMatches = key.length >= 3
          ? [...new Set(aliases.values())].filter(value => value.toLowerCase().startsWith(key))
          : [];
        if (prefixMatches.length === 1) {
          if (!handledStarts.has(token.start)) {
            handledStarts.add(token.start);
            replacements.push({ token, value: prefixMatches[0] });
          }
          return;
        }
        const allowed = [...new Set([...aliases.values()].map(value => value.toLowerCase()))]
          .filter(Boolean)
          .sort()
          .join(', ');
        throw structuredMutationColumnError_ACU(
          'SQL_INSERT_UNKNOWN_COLUMN_ACU',
          `目标表「${targetTableName || ''}」的 INSERT 引用了未知列「${token.value}」；请只使用允许列：${allowed}。`,
        );
      }
      return;
    }
    if (target.toLowerCase() === key) return;
    if (handledStarts.has(token.start)) return;
    handledStarts.add(token.start);
    replacements.push({ token, value: target });
  };

  const first = values[0];
  const actionIndex = keyword(first, 'WITH')
    ? values.findIndex((token, index) => index > 0 && token.depth === 0
      && ['INSERT', 'REPLACE', 'UPDATE', 'DELETE'].includes(token.value.toUpperCase()))
    : 0;
  const action = values[actionIndex];
  if (!action) return replacements;
  const actionValue = action.value.toUpperCase();
  const actionDepth = action.depth;

  if (actionValue === 'UPDATE') {
    // SET 子句：action 之后找同 depth 的 SET，其后的 `col =` 左侧标识符为列。
    let setIndex = -1;
    for (let index = actionIndex + 1; index < values.length; index += 1) {
      const token = values[index];
      if (token.depth !== actionDepth) continue;
      if (keyword(token, 'SET')) { setIndex = index; break; }
      if (['WHERE', 'GROUP', 'ORDER', 'LIMIT'].includes(token.value.toUpperCase())) break;
    }
    if (setIndex >= 0) {
      for (let index = setIndex + 1; index < values.length; index += 1) {
        const token = values[index];
        if (token.depth !== actionDepth) continue;
        if (['WHERE', 'GROUP', 'ORDER', 'LIMIT', 'RETURNING'].includes(token.value.toUpperCase())) break;
        const next = values[index + 1];
        // `=` 不是标识符 token，next 是 `=` 之后的值 token；检查两者之间含 `=`。
        if (next && next.depth === token.depth && /=/.test(sql.slice(token.end, next.start))) {
          addIfAlias(token, false);
        }
      }
    }
  } else if (actionValue === 'INSERT' || actionValue === 'REPLACE') {
    // 列清单：目标表 token 之后第一个 depth+1 的 token 即首列（tokenizer 不产出括号 token）。
    const openIndex = values.findIndex(token => token.depth === actionDepth + 1 && token.start > action.start);
    if (openIndex >= 0) {
      let cursor = openIndex;
      while (cursor < values.length && values[cursor].depth >= actionDepth + 1) {
        const token = values[cursor];
        if (token.depth === actionDepth + 1) {
          if (token.value === ')') break;
          addIfAlias(token, true);
        }
        cursor += 1;
      }
    }
  }

  // WHERE / RETURNING 裸标识符（含 UPDATE SET 的值、DELETE WHERE）：全语句扫描，
  // 排除函数调用、AS 后别名、限定符点号左侧、关键字。已处理的 token 用 start 去重。
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (token.quote !== null) continue;
    if (READ_COLUMN_KEYWORDS_ACU.has(token.value.toUpperCase())) continue;
    if (isFunctionCall_ACU(sql, values, index)) continue;
    const previous = values[index - 1];
    if (previous && previous.depth === token.depth && keyword(previous, 'AS')) continue;
    const beforeDot = values[index - 1];
    if (beforeDot && beforeDot.depth === token.depth && /^\s*\.\s*$/.test(sql.slice(beforeDot.end, token.start))) continue;
    addIfAlias(token, false);
  }
  return replacements;
}


interface ReadScope_ACU {
  start: number;
  end: number;
  depth: number;
  /** Projection aliases exported by this SELECT scope. */
  outputs: Set<string>;
  /** Explicit or implicit outputs of alias-less derived sources in this scope. */
  unaliasedDerivedOutputs: Set<string>[];
  /** Derived-table aliases visible to this SELECT scope. */
  derivedSources: Map<string, Set<string>>;
  /** Virtual sources whose exported columns cannot be determined safely. */
  unknownDerivedSources: Set<string>;
  /** Token positions whose names are virtual outputs rather than entity columns. */
  protectedTokens: Set<number>;
  tables: Set<string>;
  aliases: Map<string, string>;
  qualifiers: Map<string, string>;
  tableTokens: Token_ACU[];
}

const READ_SCOPE_TERMINATORS_ACU = new Set(['UNION', 'EXCEPT', 'INTERSECT']);
const READ_FROM_TERMINATORS_ACU = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW']);
const READ_ALIAS_STOP_WORDS_ACU = new Set(['ON', 'USING', 'JOIN', 'LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS', 'NATURAL', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW']);
const READ_COLUMN_KEYWORDS_ACU = new Set(['SELECT', 'FROM', 'JOIN', 'AS', 'ON', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT', 'WITH', 'RECURSIVE', 'DISTINCT', 'BY', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'COLLATE', 'USING']);

function isFunctionCall_ACU(sql: string, values: Token_ACU[], index: number): boolean {
  const token = values[index];
  return !!token && /^\s*\(/.test(sql.slice(token.end));
}

function findReadScope_ACU(scopes: ReadScope_ACU[], values: Token_ACU[], index: number): ReadScope_ACU | undefined {
  const token = values[index];
  return scopes
    .filter(scope => index >= scope.start && index < scope.end && token.depth >= scope.depth)
    .sort((left, right) => right.depth - left.depth || right.start - left.start)[0];
}

function projectionOutputs_ACU(values: Token_ACU[], scope: ReadScope_ACU): Set<string> {
  const outputs = new Set<string>();
  let projectionEnd = scope.end;
  for (let index = scope.start + 1; index < scope.end; index += 1) {
    const token = values[index];
    if (token.depth === scope.depth && keyword(token, 'FROM')) {
      projectionEnd = index;
      break;
    }
  }
  for (let index = scope.start + 1; index < projectionEnd; index += 1) {
    const token = values[index];
    if (token.depth !== scope.depth || !keyword(token, 'AS')) continue;
    const alias = values[index + 1];
    if (alias?.depth === scope.depth) outputs.add(alias.value.toLowerCase());
  }
  return outputs;
}

const IMPLICIT_OUTPUT_ALIAS_STOP_WORDS_ACU = new Set(['END', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST', 'COLLATE']);
const IMPLICIT_OUTPUT_ALIAS_MODIFIERS_ACU = new Set(['DISTINCT', 'ALL']);
const IMPLICIT_OUTPUT_ALIAS_OPERAND_PREFIX_ACU = /(?:\b(?:AND|OR|IN|IS|LIKE|GLOB|MATCH|REGEXP|BETWEEN|ESCAPE|COLLATE)\s*|[+*/%<>=|&~-]\s*)$/i;

/**
 * Finds implicit projection aliases (for example `SELECT name 姓名`) only for
 * alias-less derived sources. This deliberately does not enrich `outputs`:
 * that existing field also drives named derived tables and CTEs, where changing
 * an empty output set to a precise one would narrow established protection.
 */
function implicitProjectionOutputs_ACU(sql: string, values: Token_ACU[], scope: ReadScope_ACU): {
  outputs: Set<string>;
  aliasTokenStarts: Set<number>;
} {
  const outputs = new Set<string>();
  const aliasTokenStarts = new Set<number>();
  let projectionEnd = scope.end;
  for (let index = scope.start + 1; index < scope.end; index += 1) {
    const token = values[index];
    if (token.depth === scope.depth && keyword(token, 'FROM')) {
      projectionEnd = index;
      break;
    }
  }
  let segment: Token_ACU[] = [];
  const record = (): void => {
    if (segment.length < 2) return;
    const alias = segment[segment.length - 1];
    const beforeAlias = segment[segment.length - 2];
    if (IMPLICIT_OUTPUT_ALIAS_STOP_WORDS_ACU.has(alias.value.toUpperCase())
      || !/\s/.test(sql.slice(beforeAlias.end, alias.start))) return;
    const expression = sql.slice(segment[0].start, alias.start).trim();
    const expressionWithoutModifiers = expression.replace(/^(?:DISTINCT|ALL)\s+/i, '').trim();
    if (!expressionWithoutModifiers
      || IMPLICIT_OUTPUT_ALIAS_MODIFIERS_ACU.has(expression.toUpperCase())
      || IMPLICIT_OUTPUT_ALIAS_OPERAND_PREFIX_ACU.test(expressionWithoutModifiers)) return;
    outputs.add(alias.value.toLowerCase());
    aliasTokenStarts.add(alias.start);
  };
  for (let index = scope.start + 1; index < projectionEnd; index += 1) {
    const token = values[index];
    if (token.depth !== scope.depth) continue;
    if (token.commaBefore) {
      record();
      segment = [];
    }
    segment.push(token);
  }
  record();
  return { outputs, aliasTokenStarts };
}

function compoundScopeEnd_ACU(values: Token_ACU[], scope: ReadScope_ACU): number {
  for (let index = scope.end; index < values.length; index += 1) {
    if (values[index].depth < scope.depth) return index;
  }
  return values.length;
}

function isOutputAliasReference_ACU(values: Token_ACU[], scope: ReadScope_ACU, tokenIndex: number, key: string): boolean {
  if (!scope.outputs.has(key)) return false;
  let clause = '';
  for (let index = scope.start + 1; index < tokenIndex; index += 1) {
    const token = values[index];
    if (token.depth !== scope.depth) continue;
    if (keyword(token, 'ORDER') || keyword(token, 'GROUP') || keyword(token, 'HAVING')) clause = token.value.toUpperCase();
    else if (READ_FROM_TERMINATORS_ACU.has(token.value.toUpperCase())) clause = token.value.toUpperCase();
  }
  return clause === 'ORDER' || clause === 'GROUP' || clause === 'HAVING';
}

function collectReadScopes_ACU(
  sql: string,
  values: Token_ACU[],
  normalizedTables: ReadonlyMap<string, string>,
  onTableReference?: (alias: string) => void,
): ReadScope_ACU[] {
  const cte = cteScopes(values);
  const scopes: ReadScope_ACU[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const select = values[index];
    if (!keyword(select, 'SELECT')) continue;
    let end = values.length;
    for (let cursor = index + 1; cursor < values.length; cursor += 1) {
      const token = values[cursor];
      if (token.depth < select.depth || (token.depth === select.depth && READ_SCOPE_TERMINATORS_ACU.has(token.value.toUpperCase()))) {
        end = cursor;
        break;
      }
    }
    scopes.push({
      start: index,
      end,
      depth: select.depth,
      outputs: new Set(),
      unaliasedDerivedOutputs: [],
      derivedSources: new Map(),
      unknownDerivedSources: new Set(),
      protectedTokens: new Set(),
      tables: new Set(),
      aliases: new Map(),
      qualifiers: new Map(),
      tableTokens: [],
    });
  }

  for (const scope of scopes) scope.outputs = projectionOutputs_ACU(values, scope);
  const cteOutputs = new Map<string, Set<string>>();
  for (let withIndex = 0; withIndex < values.length; withIndex += 1) {
    const withToken = values[withIndex];
    if (!keyword(withToken, 'WITH')) continue;
    const depth = withToken.depth;
    let cursor = withIndex + 1;
    if (keyword(values[cursor], 'RECURSIVE')) cursor += 1;
    while (values[cursor]?.depth === depth) {
      const name = values[cursor++];
      const explicitOutputs = new Set<string>();
      if (values[cursor]?.depth === depth + 1) {
        const listDepth = values[cursor].depth;
        while (values[cursor]?.depth >= listDepth) {
          if (values[cursor].depth === listDepth) explicitOutputs.add(values[cursor].value.toLowerCase());
          cursor += 1;
        }
      }
      if (!keyword(values[cursor], 'AS')) break;
      cursor += 1;
      const definition = scopes.find(scope => scope.start === cursor && scope.depth === depth + 1);
      if (!definition) break;
      cteOutputs.set(name.value.toLowerCase(), explicitOutputs.size > 0 ? explicitOutputs : definition.outputs);
      while (values[cursor] && values[cursor].depth >= depth + 1) cursor += 1;
      if (!values[cursor]?.commaBefore || values[cursor].depth !== depth) break;
    }
  }

  for (const scope of [...scopes].sort((left, right) => right.depth - left.depth || right.start - left.start)) {
    let inFrom = false;
    const addSource = (sourceIndex: number): void => {
      const source = values[sourceIndex];
      if (source?.depth === scope.depth + 1 && keyword(source, 'SELECT')) {
        const nested = scopes.find(candidate => candidate.start === sourceIndex && candidate.depth === source.depth);
        const aliasIndex = nested ? compoundScopeEnd_ACU(values, nested) : -1;
        const marker = aliasIndex >= 0 ? values[aliasIndex] : undefined;
        const alias = keyword(marker, 'AS') ? values[aliasIndex + 1] : marker;
        if (nested && alias?.depth === scope.depth && !READ_ALIAS_STOP_WORDS_ACU.has(alias.value.toUpperCase())) {
          const aliasKey = alias.value.toLowerCase();
          scope.derivedSources.set(aliasKey, nested.outputs);
          if (nested.outputs.size === 0) scope.unknownDerivedSources.add(aliasKey);
        } else if (nested) {
          // An alias-less derived source can only be read through unqualified
          // output names. Prefer explicit outputs, then independently detected
          // implicit aliases. In particular, do not treat SELECT * as unknown:
          // its physical output names may still need legacy display-name
          // translation in the enclosing scope.
          let provableOutputs = nested.outputs;
          if (provableOutputs.size === 0) {
            const implicitOutputs = implicitProjectionOutputs_ACU(sql, values, nested);
            provableOutputs = implicitOutputs.outputs;
            // The alias declaration itself is not an entity-column reference.
            // Without this, the inner alias could be rebound before the outer
            // scope gets a chance to preserve the alias-less derived output.
            for (const start of implicitOutputs.aliasTokenStarts) nested.protectedTokens.add(start);
          }
          if (provableOutputs.size > 0) scope.unaliasedDerivedOutputs.push(provableOutputs);
        }
        return;
      }
      if (!source || source.depth !== scope.depth || isFunctionCall_ACU(sql, values, sourceIndex)) return;
      const cteOutput = cteOutputs.get(source.value.toLowerCase());
      if (cteOutput && isCteReference(values, source, cte)) {
        scope.derivedSources.set(source.value.toLowerCase(), cteOutput);
        if (cteOutput.size === 0) scope.unknownDerivedSources.add(source.value.toLowerCase());
        return;
      }
      const tail = qualifiedTail(sql, values, sourceIndex);
      if (!tail || tail.depth !== scope.depth) return;
      onTableReference?.(tail.value.toLowerCase());
      const physicalName = normalizedTables.get(tail.value.toLowerCase());
      if (!physicalName) return;
      scope.tables.add(physicalName);
      scope.tableTokens.push(tail);
      let cursor = values.indexOf(tail) + 1;
      const next = values[cursor];
      let alias: Token_ACU | undefined;
      if (keyword(next, 'AS')) alias = values[cursor + 1]?.depth === scope.depth ? values[cursor + 1] : undefined;
      else if (next?.depth === scope.depth && !READ_ALIAS_STOP_WORDS_ACU.has(next.value.toUpperCase()) && !next.commaBefore) alias = next;
      if (alias) scope.aliases.set(alias.value.toLowerCase(), physicalName);
      else {
        scope.aliases.set(tail.value.toLowerCase(), physicalName);
        scope.qualifiers.set(tail.value.toLowerCase(), physicalName);
      }
    };
    for (let index = scope.start + 1; index < scope.end; index += 1) {
      const token = values[index];
      if (token.depth !== scope.depth) continue;
      const value = token.value.toUpperCase();
      if (READ_FROM_TERMINATORS_ACU.has(value)) inFrom = false;
      if (value === 'FROM') {
        inFrom = true;
        addSource(index + 1);
      } else if (value === 'JOIN') {
        addSource(index + 1);
      } else if (inFrom && token.commaBefore) {
        addSource(index);
      }
    }
  }
  return scopes;
}

/**
 * Rebinds SELECT-family table and unambiguous column identifiers without using
 * broad string replacement. The caller supplies aliases from the active schema.
 */
export function rebindSqlReadIdentifiers_ACU(
  sql: string,
  tableAliases: SqlTableAliasMap_ACU,
  columnAliases: SqlColumnAliasMap_ACU = new Map(),
  options: { lenient?: boolean; onTableReference?: (alias: string) => void; onColumnReference?: (alias: string, tableNames: readonly string[]) => void } = {},
): SqlReadRebindResult_ACU {
  const normalizedTables = new Map<string, string>();
  for (const [alias, physicalName] of tableAliases) {
    normalizedTables.set(decodeSqlIdentifier_ACU(alias).toLowerCase(), physicalName);
  }
  try {
    const values = tokens(sql);
    const scopes = collectReadScopes_ACU(sql, values, normalizedTables, options.onTableReference);
    const replacements = new Map<number, { token: Token_ACU; value: string; kind: 'table' | 'column' }>();
    for (const scope of scopes) {
      for (const token of scope.tableTokens) {
        const value = normalizedTables.get(token.value.toLowerCase());
        if (value) replacements.set(token.start, { token, value, kind: 'table' });
      }
    }
    for (let index = 0; index < values.length - 1; index += 1) {
      const token = values[index];
      const next = values[index + 1];
      if (token.depth !== next.depth || !/^\s*\.\s*$/.test(sql.slice(token.end, next.start))) continue;
      const scope = findReadScope_ACU(scopes, values, index);
      const value = scope?.qualifiers.get(token.value.toLowerCase());
      if (value) replacements.set(token.start, { token, value, kind: 'table' });
    }

    for (let index = 0; index < values.length; index += 1) {
      const token = values[index];
      const previous = values[index - 1];
      const next = values[index + 1];
      if (replacements.has(token.start)
        || (previous && previous.depth === token.depth && keyword(previous, 'AS'))
        || (next && next.depth === token.depth && /^\s*\.\s*$/.test(sql.slice(token.end, next.start)))
        || isFunctionCall_ACU(sql, values, index)
        || token.quote === null && READ_COLUMN_KEYWORDS_ACU.has(token.value.toUpperCase())) continue;
      const scope = findReadScope_ACU(scopes, values, index);
      if (!scope) continue;
      const key = token.value.toLowerCase();
      if (scope.protectedTokens.has(token.start)) {
        continue;
      }
      if (isOutputAliasReference_ACU(values, scope, index, key)) {
        scope.protectedTokens.add(token.start);
        continue;
      }
      const candidates = new Set<string>();
      const qualifier = previous && previous.depth === token.depth && /^\s*\.\s*$/.test(sql.slice(previous.end, token.start))
        ? previous : undefined;
      const qualifierKey = qualifier?.value.toLowerCase();
      const virtualOutputs = qualifierKey ? scope.derivedSources.get(qualifierKey) : undefined;
      if (virtualOutputs || (qualifierKey && scope.unknownDerivedSources.has(qualifierKey))) {
        scope.protectedTokens.add(token.start);
        continue;
      }
      if (!qualifier && (scope.unknownDerivedSources.size > 0
        || [...scope.derivedSources.values()].some(outputs => outputs.has(key))
        || scope.unaliasedDerivedOutputs.some(outputs => outputs.has(key)))) {
        scope.protectedTokens.add(token.start);
        continue;
      }
      const tableNames = qualifier
        ? [scope.aliases.get(qualifier.value.toLowerCase())].filter((value): value is string => !!value)
        : [...scope.tables];
      options.onColumnReference?.(key, tableNames);
      for (const tableName of tableNames) {
        const columns = columnAliases.get(tableName);
        const value = columns?.get(key);
        if (value) candidates.add(value);
      }
      if (candidates.size === 1) {
        const [value] = candidates;
        if (value !== token.value) replacements.set(token.start, { token, value, kind: 'column' });
      }
    }

    let result = sql;
    let tableRebindCount = 0;
    let columnRebindCount = 0;
    for (const { token, value, kind } of [...replacements.values()].sort((left, right) => right.token.start - left.token.start)) {
      result = `${result.slice(0, token.start)}${format(value, token.quote)}${result.slice(token.end)}`;
      if (kind === 'table') tableRebindCount += 1;
      else columnRebindCount += 1;
    }
    const protectedTokenStarts = new Set([...scopes].flatMap(scope => [...scope.protectedTokens]));
    // CTE column lists are declarations, not entity-column references. They
    // must be shielded from the legacy broad translator for the same reason as
    // their downstream CTE references.
    for (let withIndex = 0; withIndex < values.length; withIndex += 1) {
      const withToken = values[withIndex];
      if (!keyword(withToken, 'WITH')) continue;
      const depth = withToken.depth;
      let cursor = withIndex + 1;
      if (keyword(values[cursor], 'RECURSIVE')) cursor += 1;
      while (values[cursor]?.depth === depth) {
        cursor += 1; // CTE name
        if (values[cursor]?.depth === depth + 1) {
          const listDepth = values[cursor].depth;
          while (values[cursor]?.depth >= listDepth) {
            if (values[cursor].depth === listDepth) protectedTokenStarts.add(values[cursor].start);
            cursor += 1;
          }
        }
        if (!keyword(values[cursor], 'AS')) break;
        cursor += 1;
        while (values[cursor] && values[cursor].depth >= depth + 1) cursor += 1;
        if (!values[cursor]?.commaBefore || values[cursor].depth !== depth) break;
      }
    }
    const protectedIdentifierSpans = [...protectedTokenStarts]
      .map(start => {
        const token = values.find(value => value.start === start)!;
        const offset = [...replacements.values()]
          .filter(replacement => replacement.token.start < token.start)
          .reduce((total, replacement) => total + replacement.value.length - (replacement.token.end - replacement.token.start), 0);
        return { start: token.start + offset, end: token.end + offset };
      });
    const rebound: SqlReadRebindResult_ACU = { sql: result, tableRebindCount, columnRebindCount };
    Object.defineProperty(rebound, 'protectedIdentifierSpans', {
      value: protectedIdentifierSpans,
      enumerable: false,
    });
    return rebound;
  } catch (error) {
    if (options.lenient) return { sql, tableRebindCount: 0, columnRebindCount: 0 };
    throw error;
  }
}
