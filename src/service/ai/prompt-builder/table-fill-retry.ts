// 填表纠错历史仅用于当前请求，不写入表格或聊天存储。
export interface TableFillRetryTurn_ACU {
  response: string;
  error: string;
}

/** 按实际请求协议回灌失败回复与修正要求，原 assistant 预填充保持最后。 */
export function withTableFillRetryHistory_ACU(
  messages: Array<{ role: string; content: string }>,
  history: readonly TableFillRetryTurn_ACU[],
  mode: { sqlite: boolean; strictJson: boolean; tools: boolean },
): Array<{ role: string; content: string }> {
  if (!history?.length) return messages;
  const outputGuide = mode.strictJson
    ? mode.sqlite
      ? '重新输出完整 JSON 对象，format 为 table_edit_sql_v1，sql 为完整 SQL 字符串；不要输出 Markdown 或 <tableEdit> 标签。'
      : '重新输出完整 JSON 对象，format 为 table_edit_ops_v1，ops 为符合本次表格 schema 的操作数组；不要输出 Markdown 或 <tableEdit> 标签。'
    : mode.tools
      ? `重新调用 ${mode.sqlite ? 'table_sql' : 'table_edit'}，参数须为完整合法 JSON，${mode.sqlite ? 'sql' : 'commands'} 字段须为字符串；若用正文提交，必须使用完整闭合的 <tableEdit> 标签。`
      : '重新输出完整闭合的 <tableEdit>...</tableEdit> 块，不要只输出解释、续写残片或裸指令。';
  const editGuide = mode.sqlite
    ? 'SQL 仅使用 INSERT、REPLACE、UPDATE、DELETE；表名、列名照抄本次提供的表结构，不输出 CREATE、ALTER、DROP，不修改隐藏列。'
    : mode.strictJson
      ? '按本次表格 schema 提供的表、列和行标识修正 ops 操作数组，不猜测不存在的表或字段。'
      : '按本次表格、列索引和行索引修正 insertRow、updateRow、deleteRow 指令，不猜测不存在的表或字段。';
  const extra: Array<{ role: string; content: string }> = [];
  for (const turn of history) {
    if (turn.response) extra.push({ role: 'assistant', content: turn.response });
    extra.push({
      role: 'system',
      content: `【填表纠错】\n具体报错：${turn.error}\n修正要求：针对上述错误修正上一条回复，按原任务重新提交本轮完整修改；保留有效内容，不编造数据。${outputGuide}\n${editGuide}`,
    });
  }
  const last = messages[messages.length - 1];
  return last?.role === 'assistant'
    ? [...messages.slice(0, -1), ...extra, last]
    : [...messages, ...extra];
}
