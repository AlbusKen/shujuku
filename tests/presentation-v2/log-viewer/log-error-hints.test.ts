/**
 * log-error-hints — 报错文本到「原因 + 处理建议」的规则匹配。
 */
import { describe, expect, it } from 'vitest';
import { LOG_ERROR_HINT_RULE_IDS, resolveLogErrorHint } from '../../../src/presentation-v2/composables/log-error-hints';

function hintIdFor(message: string, tag = '未分类'): string | undefined {
  return resolveLogErrorHint({ level: 'error', tag, message })?.id;
}

describe('resolveLogErrorHint', () => {
  it('只对 error 级日志给建议', () => {
    expect(resolveLogErrorHint({ level: 'warn', tag: 'SQL', message: 'API请求失败: 429' })).toBeNull();
    expect(resolveLogErrorHint({ level: 'debug', tag: 'SQL', message: 'API请求失败: 429' })).toBeNull();
    expect(resolveLogErrorHint({ level: 'error', tag: 'SQL', message: 'API请求失败: 429' })).not.toBeNull();
  });

  it('每条 error 日志都有兜底建议，且建议包含摘要与至少一步操作', () => {
    const hint = resolveLogErrorHint({ level: 'error', tag: '未分类', message: 'something totally unexpected happened' });
    expect(hint?.id).toBe('generic');
    expect(hint?.summary).toBeTruthy();
    expect(hint?.steps.length).toBeGreaterThan(0);
    expect(LOG_ERROR_HINT_RULE_IDS.at(-1)).toBe('generic');
  });

  it.each([
    // HTTP 状态码 / API
    ['[ACU] API请求失败: 401 {"error":{"message":"Incorrect API key provided"}}', 'http-401'],
    ['[正文优化] API调用失败 (尝试 1/3): Error: API请求失败: 403 Forbidden', 'http-403'],
    ['API请求失败: 404 {"error":"model gpt-99 does not exist"}', 'http-404'],
    ['Rerank 请求失败: 429 rate limit exceeded', 'http-429'],
    ['[剧情推进] 执行失败: Error: API请求失败: 503 Service Unavailable', 'http-5xx'],
    ["API请求失败: 400 This model's maximum context length is 128000 tokens", 'context-length'],
    ['API请求失败: 400 {"error":{"type":"invalid_request_error","message":"Unsupported parameter: top_k"}}', 'http-400'],
    // 网络
    ['ACU: 调用酒馆连接预设时出错: TypeError: Failed to fetch', 'network'],
    ['Access to fetch has been blocked by CORS policy', 'network-cors'],
    // 酒馆侧配置
    ['ACU: 调用酒馆连接预设时出错: Error: 未选择酒馆连接预设。', 'tavern-profile'],
    ['主API生成不可用：未检测到酒馆助手（TavernHelper.generateRaw）。', 'tavern-helper-missing'],
    ['Error: 自定义API的URL或模型未配置。', 'api-config-incomplete'],
    ['[parseNonStreamResponse] Unknown response format: {}', 'empty-response'],
    // 中止
    ['[正文优化] API调用失败: Error: Request aborted', 'aborted'],
    // JSON
    ['导入提示词模板失败：JSON解析错误。 SyntaxError: Unexpected token', 'json-import'],
    ['Primary JSON parse failed for: "{...". Attempting sanitization pipeline...', 'json-ai-output'],
    ['[TemplateAssistant] draft 解析失败', 'json-ai-output'],
    ['[模板解析] 所有解析方案均失败，模板长度: 12', 'json-import'],
    // 表格 / SQL
    ['updateCell: Table "角色表" not found.', 'table-not-found'],
    ['updateCell: Column "年龄" not found in table "角色表".', 'column-not-found'],
    ['deleteRow: Row index 12 out of bounds.', 'row-out-of-bounds'],
    ['[SQLite引擎] query 执行失败: SELECT * FROM x | 错误: no such table: x', 'table-not-found'],
    ['[SQLite引擎] run 执行失败: INSERT ... | 错误: UNIQUE constraint failed: t.row_id', 'sql-constraint'],
    ['[SQL Console] 执行失败: near "SELEC": syntax error', 'sql-syntax'],
    ['[SQLite引擎] sql.js 初始化失败: WebAssembly.instantiate failed', 'sqlite-init'],
    ['[StorageStrategy] SQLite 加载失败，自动 fallback 到原生模式: wasm not found', 'sqlite-init'],
    ['Cannot apply edits, tableData is not loaded.', 'table-data-not-loaded'],
    ['Save failed: Chat history is empty.', 'table-data-not-loaded'],
    ['Table persistence requires table update commit model; direct unsafe writes are not allowed.', 'table-persist-model'],
    ['[db.expr] 表达式执行失败: a + → Unexpected end of input', 'template-vars'],
    ['[条件模板] evaluateCondExpression_ACU 解析出错: SyntaxError expression: x >', 'template-vars'],
    // 存储 / 检查点
    ['存储模式切换失败: Error: busy', 'storage-mode-switch'],
    ['[SQLite] CHAT_CHANGED: snapshot hydrate 失败: unknown', 'checkpoint-replay'],
    ['[V2 Replay] 应用日志失败: messageIndex=3, seq=2', 'checkpoint-replay'],
    ['Failed to persist settings to storage: QuotaExceededError', 'storage-quota'],
    ['Failed to load or parse settings, using defaults: SyntaxError', 'settings-persist'],
    // 世界书
    ['Failed to populate worldbook list: TypeError: Cannot read properties of undefined', 'worldbook'],
    ['[剧情推进] 获取角色世界书失败', 'worldbook'],
    // 启动 / 界面
    ['[插件启动] 等待 SillyTavern 超时（30000ms），TH=false,ST=true,GC=false', 'startup'],
    ['ACU: Failed to initialize. Core APIs not available on DOM ready. 宿主能力: {}', 'startup'],
    ['保存阈值失败：UI元素未初始化。', 'ui-not-ready'],
    ['openVisualizer failed: V2 UI surface is not registered.', 'ui-not-ready'],
    // 外部脚本
    ['getApiPresets: 已弃用，公开 API 不再暴露预设内容，请使用 callAI', 'deprecated-api'],
    ['updateRow: data must be an object.', 'invalid-params'],
    ['updateCell: tableName is required.', 'invalid-params'],
    ['switchPlotPreset: Preset "夜行" not found.', 'preset-not-found'],
    ['[回调管理] Error executing a table update callback:', 'callback'],
    // 模块兜底
    ['[游戏初始化] 模板注入失败: Error: boom', 'template'],
    ['[正文优化] 替换消息失败: Error: boom', 'content-optimization'],
    ['[剧情推进] [阶段:plan] [任务:t1] 执行失败: Error: boom', 'plot'],
    ['[外部导入] Failed to split TXT text into temp storage.', 'import'],
    ['[Manual Refill] 分组执行或同步聊天失败: Error: boom', 'fill'],
    ['[Continuation][Agent] 世界书快照预取失败', 'worldbook'],
    ['getAgentPromptConfig failed: Error: boom', 'continuation'],
    ['导出JSON数据失败: Error: boom', 'export'],
  ])('%s → %s', (message, expectedId) => {
    expect(hintIdFor(message)).toBe(expectedId);
  });

  it('tag 也参与匹配：仅凭 tag 就能落到对应模块的建议', () => {
    expect(hintIdFor('boom', '剧情推进')).toBe('plot');
    expect(hintIdFor('boom', '外部导入')).toBe('import');
    expect(hintIdFor('boom', 'Worldbook')).toBe('worldbook');
  });

  it('SQLite 标签下的普通查询失败不会被误判为引擎加载失败', () => {
    expect(hintIdFor('query 执行失败: SELECT 1 | 错误: boom', 'SQLite引擎')).toBe('sql-syntax');
  });

  it('规则 ID 唯一', () => {
    expect(new Set(LOG_ERROR_HINT_RULE_IDS).size).toBe(LOG_ERROR_HINT_RULE_IDS.length);
  });
});
