import type { AgentToolMode_ACU } from '../../ai/agent-tool-mode';
import type { WorldSimulationLedgerModule_ACU } from '../model';
import { worldSimulationSqlWritableColumns_ACU } from './agent-sql-columns';

export type WorldSimulationOneShotProtocolRole_ACU = 'undercurrent-analyst' | 'dramatis-keeper' | 'guidance-composer';

/** 编辑器格式回答与实际请求共用的交付协议。 */
export function worldSimulationOneShotProtocol_ACU(name: WorldSimulationOneShotProtocolRole_ACU, modules: readonly WorldSimulationLedgerModule_ACU[], mode: AgentToolMode_ACU = 'tools'): string {
  const tables = modules.flatMap(module => module === 'chronicle' ? ['chronicle', 'chronicle_archive', 'chronicle_overview'] : [module]);
  const details: Record<WorldSimulationOneShotProtocolRole_ACU, string> = {
    'undercurrent-analyst': 'clock: UPDATE SET days, story_time, slot; dimensions: name, kind, value, trend, rationale，其中 kind 只能是英文原值 pressure 或 growth，trend 只能是 rising、stable、falling；seeds: title, status, level, catalyst, visibility, location, expires_at_day, missed_outcome, actor_ids, expose_policy, retired_reason。seeds.actor_ids 只能是已存在的 actor.id 字符串数组，例如 actor_ids = \'["actor-1"]\'；没有已确认人物 ID 就省略该列，绝不能写人物对象数组。seeds.location 必须是 JSON 对象字符串，例如 location = \'{"region":"江南府","place":"城外"}\'，只有 region 必填；无确定地点则省略 location，不可填单独地名。其中 visibility 只能是英文原值 hidden、limited、public，status 只能是 established、incubating、active、converging、resolved、retired。枚举不得填写中文解释、组合描述或其他同义词。',
    'dramatis-keeper': 'player: UPDATE SET location, contact（仅这两列及 evidence_refs，location_updated_at_day 与 region_visits 是内部派生字段，绝对不可写进 SQL）；actors: name, interests, location, location_ref, goals, information_sources, known_facts, life, died_at_day, death_summary, current_action, long_term_action; rumors 仅死亡伴生: fact, origin_day, earliest_reveal_day, channels, related_actor_ids。current_action 写 JSON 对象，例如 current_action = \'{"text":"在客栈盯着往来客商","expected_duration":"今夜之内"}\'；long_term_action 另带 status（ongoing/done/abandoned）与可选 outcome，例如 long_term_action = \'{"text":"护送粮车南下","expected_duration":"约三日","status":"done","outcome":"顺利抵达江南府"}\'。行为的开始时间与经历时间线由程序派生，不能写 experiences 或任何时间戳。',
    'guidance-composer': 'chronicle: INSERT summary, related_ids, missed_note 或 DELETE id, reason；missed_note 只在主角错过了重要幕后事件时写（说明错过了什么），普通纪要省略该列；chronicle_archive 只能写 archive_ref, day, summary, fingerprints, related_ids, source_chronicle_ids；chronicle_overview 只能写 fingerprint, day, one_line, archive_ref，二者必须用同一个 archive_ref 成对 INSERT，不能把 summary/related_ids 写入 chronicle_overview。rumors: fact, origin_day, earliest_reveal_day, channels, related_actor_ids, status, revealed_at_day；guidance: 只能 UPDATE signals, excluded_facts（必须带 WHERE expected_revision）。guidance.signals 的 sourceId 只能指向本次输入账本中已经存在的条目 ID、clock 或 player；本候选新 INSERT 的 rumor/chronicle 不能在同一候选中作为 sourceId，不得编造 rumors:1 等地址。',
  };

  return [
    mode === 'tools'
      ? '【交付协议】有可证实的变更时先调用 write_sql，参数只填 sql 字段（一条或多条受限 SQL）；它仅生成待验证候选，不即时写入账本。收到候选校验回执后，下一次回复单独调用 submit 交付，不与 read 或 write_sql 同回复。不得用正文交付或输出裸 SQL。'
      : '【交付协议】有可证实的变更时先输出 {"action":"write_sql","sql":"一条或多条受限 SQL"}，只填 action 与 sql；它仅生成待验证候选，不即时写入账本。收到候选校验回执后，下一次回复单独输出完整交付 JSON，不与工具动作混用，不输出裸 SQL。',
    `交付字段：status、agentName。candidate 仅确认已校验的候选，另填 summary、evidenceRefs、uncertainties；无变化用 no_change 并填 summary、evidenceRefs、uncertainties；无法完成用 failed 并填 reasonCode、message，或 blocked 并填非空 unresolved。agentName 必须为 ${name}。交付不带 sql 或 patch。${mode === 'tools' ? '交付只能调用 submit。' : '交付只能输出 JSON 对象。'}空回复和裸状态行均不是交付。`,
    `只能写表：${tables.join(' | ')}。一次 write_sql 收齐本角色所有变更，不拆成多次写入；失败时按工具回执修正，仅允许一次纠错。`,
    `【可写列白名单】${tables.map(table => `${table}(${worldSimulationSqlWritableColumns_ACU(table).join(', ')})`).join('；')}。SET 与 INSERT 只能用这些列；revision、day 等行字段只读，修订号只写在 WHERE expected_revision = 值 中：数组行用该行 revision 字段的值，clock/player/guidance 单例用运行时“单例修订号”。`,
    '提交前逐项核对负责模块，分别得出写或不写的结论；多个模块有变化时全部放进同一次 write_sql，不能只维护其中一两个模块就提交。',
    `运行时已给出本角色完整行与关联资料；只有目录中出现具体 readAddress 且确需详情时才${mode === 'tools' ? '调用 read，参数 reads 填该地址' : '输出 {"action":"read","reads":["该地址"]}'}。目录为空就不要为核对空资料而读取；ledger:current 并非普通角色可读地址。不能把 $.reads、裸模块名或错误路径当作地址。`,
    'SQL 只允许 INSERT INTO 表 (列) VALUES (字面量)、UPDATE 表 SET 列 = 字面量 WHERE 条件、DELETE FROM 表 WHERE 条件；不得使用 SELECT、函数、子查询或表达式。字符串单引号须转义为两个，列名使用 snake_case。',
    '归档列名必须严格区分：chronicle_archive=(archive_ref, day, summary, fingerprints, related_ids, source_chronicle_ids)；chronicle_overview=(fingerprint, day, one_line, archive_ref)。chronicle_overview 没有 summary 或 related_ids 列。guidance 是单例，只能 UPDATE 且 WHERE 只能带 expected_revision。',
    'guidance.signals 的 sourceId 只能引用运行时已注入账本中已有的条目 ID，或 clock/player；不能引用本次 SQL 刚 INSERT 的 rumors/chronicle，也不能写 rumors:1 等未出现在账本目录中的伪 ID。',
    details[name],
  ].join('\n');
}
