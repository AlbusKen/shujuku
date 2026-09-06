/**
 * log-error-hints — 把运行日志里的报错翻译成「大概是什么问题 + 可以怎么处理」。
 *
 * 规则按顺序匹配：越靠前越具体（明确短语、HTTP 状态码），越靠后越宽泛（按功能模块兜底），
 * 最后一条是通用兜底，保证每条 error 级日志都有一份处理建议。
 * 只做字符串匹配，不依赖 DOM 与 Vue，方便单测。
 */
import type { LogEntry } from '../../shared/log-buffer';

export interface LogErrorHint {
  /** 规则 ID，便于测试与后续针对性调整文案。 */
  id: string;
  /** 一句话说明这条报错大致意味着什么。 */
  summary: string;
  /** 用户可以直接照做的处理步骤，按先后顺序排列。 */
  steps: string[];
}

interface HintRule {
  id: string;
  /** 在小写化后的 `tag + message` 上匹配。 */
  test: RegExp | ((haystack: string) => boolean);
  summary: string;
  steps: string[];
}

const RETRY_LATER = '稍等片刻后重试一次，很多问题是服务商偶发抖动。';
const SEE_PREVIOUS_LOG = '查看紧邻的上一条日志，通常会给出更具体的原因（HTTP 状态码、解析失败的内容等）。';
const EXPORT_LOGS = '如果反复出现，点日志面板的「导出」把日志连同复现步骤反馈给作者。';

const RULES: HintRule[] = [
  // ─── 主动中止 ───
  {
    id: 'aborted',
    test: /request aborted|aborterror|the user aborted|已中止|已取消|用户取消|用户中止|abort signal|signal is aborted/,
    summary: '请求被主动中止（通常是你点了停止、切换了聊天，或关闭了面板）。',
    steps: [
      '如果是你主动停止的，这条记录可以忽略。',
      '如果没有手动停止却出现中止，检查网络是否在请求途中断开，然后重试。',
    ],
  },

  // ─── 浏览器存储 ───
  {
    id: 'storage-quota',
    test: /quotaexceeded|exceeded the quota|storage.*full|out of storage|存储空间不足|localstorage/,
    summary: '浏览器本地存储空间不足，设置或缓存写不进去。',
    steps: [
      '到「数据管理」页清理不再需要的历史数据或导入缓存。',
      '清理浏览器里其他站点 / 扩展占用的存储空间。',
      '隐私 / 无痕模式下存储会被限制，请改用普通窗口。',
    ],
  },

  // ─── 启动 / 宿主 ───
  {
    id: 'startup',
    test: /等待 ?sillytavern|core apis not available|getcontext\(\)|not ready after|jquery|#extensionsmenu|failed to initialize\. core|插件启动|插件无法启动|host doc|failed to load one or more critical apis/,
    summary: '插件初始化失败：没有等到酒馆核心接口就绪。',
    steps: [
      '刷新页面（Ctrl+F5）。',
      '确认酒馆版本不过旧，并在扩展管理里启用了本插件。',
      '同时安装了很多扩展时加载会变慢，稍等加载完成再打开插件；仍失败请检查浏览器控制台里其他扩展的报错。',
    ],
  },
  {
    id: 'ui-not-ready',
    test: /ui元素未初始化|cannot find .*dom|popup dom|ui surface is not registered|界面未初始化/,
    summary: '界面还没加载完成就触发了操作。',
    steps: [
      '关闭并重新打开插件面板。',
      '仍出现时刷新页面。',
    ],
  },

  // ─── 酒馆侧 API 配置 ───
  {
    id: 'tavern-profile',
    test: /未选择酒馆连接预设|无法找到id为|没有配置api|没有选择预设|连接预设.*(不存在|无效|失败)|connection profile/,
    summary: '所选的酒馆「连接预设」不可用：被删除、改名，或里面没有配置 API。',
    steps: [
      '打开酒馆左上角「API 连接」→「连接配置」，确认该预设存在且已经绑定 API 与预设。',
      '回到本插件「API」页重新选择一次连接预设并保存。',
      '也可以改用「自定义 API」，直接填写地址、密钥和模型。',
    ],
  },
  {
    id: 'tavern-helper-missing',
    test: /tavernhelper\.generateraw|未检测到酒馆助手|主api生成不可用|connectionmanagerrequestservice 不可用|请检查酒馆版本|js-slash-runner/,
    summary: '缺少「酒馆助手（TavernHelper）」扩展，或酒馆版本过旧，无法调用酒馆主 API。',
    steps: [
      '在酒馆扩展管理里安装并启用「酒馆助手（JS-Slash-Runner）」。',
      '把酒馆更新到最新版本后刷新页面。',
      '临时方案：到「API」页改用「自定义 API」，不依赖酒馆主 API。',
    ],
  },
  {
    id: 'api-config-incomplete',
    test: /url或模型未配置|缺少 ?embedding ?endpoint|缺少 ?embedding ?model|rerank endpoint 为空|rerank model 为空|api.*(未配置|未填写)|endpoint.*(为空|missing)|未配置api/,
    summary: 'API 配置不完整：接口地址、密钥或模型名有一项没填。',
    steps: [
      '到「API」页补全该预设的接口地址、API Key 和模型名，然后保存预设。',
      '向量相关报错请到「交火模式」页检查 Embedding / Rerank 的地址与模型。',
      '确认对应功能（填表 / 剧情推进 / 续写）选择的是这个已补全的预设。',
    ],
  },
  // 交火 rerank 回退：runtime 会把网关的具体原因（HTTP 状态 / 网络失败）包在这条消息里，
  // 必须排在 HTTP / 网络通用规则之前，否则用户只会看到泛泛的「网络问题」而不知道是 rerank 被跳过了。
  {
    id: 'vector-rerank-fallback',
    test: /rerank 调用失败|rerank 响应没有任何可用的评分/,
    summary: 'Rerank 重排序没有生效，本轮交火已回退为仅按 Embedding 相似度排序。',
    steps: [
      '到「交火模式」页核对 Rerank 的接口地址（要填到 /rerank 这一级的完整地址）、API Key 与模型名。',
      '报错含「网络失败 / Failed to fetch」时多半是服务商不允许浏览器跨域直连，换用支持 CORS 的 rerank 服务或反向代理地址。',
      '报错含「没有任何可用的评分」时说明返回格式不是 results[].index / relevance_score，换一个兼容 Jina / Cohere 格式的服务商。',
      '不想用重排序就把 Rerank 地址与模型都清空，日志就不会再出现这条报错。',
    ],
  },

  // ─── HTTP 状态码 ───
  {
    id: 'http-401',
    test: /\b401\b|unauthorized|invalid[ _-]?api[ _-]?key|incorrect api key|invalid x-api-key|authentication[ _-]?error|invalid_api_key|no auth credentials|令牌无效|密钥无效|api key 无效/,
    summary: 'API 拒绝了请求：密钥无效、填错或已过期（401）。',
    steps: [
      '到「API」页打开当前使用的预设，检查 API Key 是否完整、有没有多余空格。',
      '确认这个 Key 对应的服务商与接口地址一致（比如 OpenAI 的 Key 不能填到 Claude 地址）。',
      '如果是中转站，登录站点确认 Key 仍然有效、余额充足。',
    ],
  },
  {
    id: 'http-403',
    test: /\b403\b|forbidden|permission[ _-]?denied|not allowed to|access denied|无权访问|权限不足/,
    summary: '服务商拒绝访问（403）：Key 没有权限，或请求来源被限制。',
    steps: [
      '确认该 Key 有权使用所选模型（部分模型需要单独开通）。',
      '一些服务商会拒绝来自浏览器的直连请求：把该 API 预设改为走「酒馆连接预设」由酒馆后端转发。',
      '如果是中转站，联系站方确认账号是否被限制。',
    ],
  },
  {
    id: 'http-404',
    test: /\b404\b|not[ _]found.*(model|endpoint|route)|model.*(not found|does not exist|not exist)|no such model|unknown model|invalid model|模型不存在|找不到模型/,
    summary: '接口地址或模型名不存在（404）。',
    steps: [
      '到「API」页检查接口地址是否完整，不同服务商对结尾是否带 /v1 要求不同，按服务商文档填写。',
      '点击「拉取模型列表」重新选择模型，避免手写模型名拼错。',
      '确认服务商仍然提供该模型，旧模型可能已下线。',
    ],
  },
  {
    id: 'http-429',
    test: /\b429\b|rate[ _-]?limit|too many requests|quota|insufficient (balance|funds)|exceeded your current|resource[ _-]?exhausted|请求过于频繁|限流|额度不足|余额不足|欠费|配额/,
    summary: '请求过于频繁被限流，或账户额度 / 余额已用完（429）。',
    steps: [
      '先等 1–2 分钟再重试；短时间内连续重试只会让限流更久。',
      '登录服务商后台确认余额与额度是否充足。',
      '在对应功能的设置里调大「重试延迟」/「轮次延迟」，或调小并发数、批处理大小。',
      '智能续写会连续发起大量请求，请使用支持高 RPM 的 API，不要用公益站。',
    ],
  },
  {
    id: 'http-5xx',
    test: /\b(500|502|503|504|529)\b|bad gateway|service unavailable|gateway time-?out|internal server error|overloaded|server error|服务器错误|服务不可用|上游.*(错误|超时)/,
    summary: '服务商服务器出错或过载（5xx），不是本地配置问题。',
    steps: [
      RETRY_LATER,
      '持续出现时换一个模型或换一条 API 渠道。',
      '如果用的是中转站，查看站方公告确认是否在维护。',
    ],
  },
  {
    id: 'context-length',
    test: /context[ _-]?length|maximum context|context window|too many tokens|tokens? (exceed|limit|too long)|prompt is too long|input is too long|max_tokens.*(exceed|invalid)|超出.*(上下文|长度)|上下文.*(超限|过长)|token.*超/,
    summary: '发送给模型的内容太长，超出了模型的上下文上限。',
    steps: [
      '填表：到「填表规则」把「批处理大小」/「上下文楼层数」调小一些。',
      '智能续写：调小「正文可读窗口楼数」「会话自动总结阈值」与各项读取预算。',
      '换用上下文更大的模型，或精简过长的自定义提示词与世界书条目。',
    ],
  },
  {
    id: 'http-400',
    test: /\b400\b|bad request|invalid_request_error|unsupported parameter|invalid parameter|unrecognized request argument|unknown parameter|参数错误|请求参数无效/,
    summary: '服务商认为请求内容有问题（400）：通常是模型名或某个参数不被支持。',
    steps: [
      '到「API」页确认模型名拼写正确，最好通过「拉取模型列表」选择。',
      '如果调整过 temperature / top_p 等高级参数或开启了「严格 JSON」，先恢复默认再试。',
      '换一个模型试试：部分模型不支持 system 角色或某些字段。',
    ],
  },

  // ─── 网络 ───
  {
    id: 'network-cors',
    test: /\bcors\b|cross-origin|access-control-allow-origin|preflight/,
    summary: '浏览器跨域被拦截（CORS）：该服务商不允许网页直接调用。',
    steps: [
      '把该 API 预设改为走「酒馆连接预设」，由酒馆后端代为转发。',
      '或者使用支持浏览器直连的中转服务。',
    ],
  },
  {
    id: 'network',
    test: /failed to fetch|networkerror|network error|net::err|econnrefused|econnreset|enotfound|etimedout|getaddrinfo|socket hang up|fetch failed|timed? ?out|timeout|无法连接|连接被拒绝|网络错误|请求超时|超时/,
    summary: '网络连不上目标服务，或者等待响应超时。',
    steps: [
      '检查本机网络、代理 / VPN 是否正常；把接口地址复制到浏览器地址栏，确认能打开。',
      '超时多半是模型响应太慢：稍后重试，或换用响应更快的模型。',
      '酒馆若部署在远程服务器，确认服务器本身能访问该 API 地址。',
    ],
  },

  // ─── 内容审查 ───
  {
    id: 'content-filter',
    test: /content[ _-]?filter|content_policy|safety (setting|filter|system)|blocked by|flagged|prohibited_content|recitation|内容审查|违规内容|敏感内容|安全策略/,
    summary: '内容被服务商的安全审查拦截，模型拒绝或截断了输出。',
    steps: [
      '换用审查宽松的模型或渠道，官方渠道对成人 / 暴力内容通常很严格。',
      '调整提示词或世界书里触发审查的表述。',
      '如果是填表被拦截，可先手动填表跳过这一层。',
    ],
  },

  // ─── 模板变量 / 表达式 ───
  {
    id: 'template-vars',
    test: /\[条件模板\]|\[db\.(expr|rand|calc|max|min)\]|\[orm\]|模板变量|evaluatecondexpression|表达式执行失败|随机数生成失败/,
    summary: '世界书 / 提示词里的模板变量表达式（{{db.xxx}} 或条件模板）解析失败。',
    steps: [
      '打开对应的世界书条目或提示词，检查日志里给出的表达式写法：括号、引号是否配对，表名列名是否正确。',
      '对照插件自带的语法参考（syntax-reference）核对函数名与参数。',
      '先把表达式替换成一个最简单的例子确认能跑通，再逐步加复杂度。',
    ],
  },

  // ─── 表格结构 ───
  {
    id: 'column-not-found',
    test: /column .* not found|no such column|column mapping is unavailable|absent from canonical headers|cannot find .* column|column index .* out of bounds|找不到.*列|列.*不存在|列名.*无效/,
    summary: '找不到指定的列：列名与当前表头不一致。',
    steps: [
      '到「高级工具」→ SQL 控制台点「查看表结构」，核对准确的列名。',
      '提示词或模板中的列名要与表格表头完全一致（包含空格、括号）。',
      '如果刚改过模板，打开表格编辑器重新保存一次，让结构同步到数据库。',
    ],
  },
  {
    id: 'sqlite-ddl-exec',
    test: /ddl.*(执行|apply|run|fail|失败|error)|执行.*ddl|apply.*ddl|建表失败|创建表失败|alter table.*(失败|fail)|drop table.*(失败|fail)|完整 candidate sqlite hydrate 失败|candidate.*hydrate 失败/,
    summary: 'SQLite 建表 / 改表（DDL）执行失败，模板结构无法在 SQLite 中落成。',
    steps: [
      '通常是模板中存在重复列名、约束冲突或与历史物理表不兼容。',
      '到「数据管理」页查看模板与历史表结构，或使用结构校准 / 恢复工具重建。',
      '如果刚切换模板，先刷新页面再重试；仍失败请导出日志反馈。',
    ],
  },
  {
    id: 'table-not-found',
    test: /table "[^"]*" not found|no such table|has no content|表格?\s*[「"“]?[^\s」"”]{0,40}[」"”]?\s*(不存在|未找到)|找不到表|表不存在/,
    summary: '找不到指定的表格（或表格是空的）。',
    steps: [
      '检查表名是否拼写正确；中文表名和英文表名不能混用。',
      '确认当前聊天已经加载了表格模板（在「填表规则」页能看到表格列表）。',
      '到「高级工具」→ SQL 控制台点「查看所有表」，用列出的表名重试。',
    ],
  },
  {
    id: 'row-out-of-bounds',
    test: /row index .* out of bounds|row_id not found|cannot (modify|delete) header row|行号.*越界|行.*不存在|找不到.*行/,
    summary: '行号越界，或找不到对应的行。',
    steps: [
      '行号从 1 开始计数，0 是表头不能修改或删除。',
      '打开表格编辑器确认目标行确实存在。',
      '如果是 AI 生成的编辑指令，多为模型幻觉，重试即可。',
    ],
  },

  // ─── SQLite ───
  {
    id: 'sqlite-init',
    test: /sql\.js|wasm|sqlite.*(初始化|init|加载|load).*(失败|fail|异常)|sqlite runtime unavailable|fallback 到原生|回退.*原生|sqlite mode expected|exported no table data|sqlite provider|sqlite 不可用/,
    summary: 'SQLite 引擎加载失败，已自动回退到原生（JSON）存储模式。',
    steps: [
      '刷新酒馆页面（Ctrl+F5）后重试。',
      '检查浏览器的广告拦截 / 安全插件是否拦截了 .wasm 文件下载。',
      '重新安装本插件以确保文件完整。回退期间表格仍可用，只是 SQL 相关功能受限。',
    ],
  },
  {
    id: 'schema-mismatch',
    test: /schema_missing|未在 sqlite runtime 中创建|未在 sqlite 运行时|缺列|缺少列|runtime 中不存在|结构不一致|schema 不一致|表结构.*(不一致|缺失|不匹配)|hydrate 失败.*(schema|列)|schema.*(fail|mismatch|不一致)/,
    summary: '表格结构（列 / 物理表）与 SQLite 实际建表结果不一致，属于数据或模板结构问题，不是引擎加载失败。',
    steps: [
      '这不是 wasm / 引擎下载问题，不需要检查下载拦截。',
      '到「数据管理」页运行诊断 / 恢复工具，让插件按当前模板重建或校准运行时结构。',
      '如果刚切换过模板，先刷新页面并重新加载当前聊天；仍失败请导出日志反馈。',
    ],
  },
  {
    id: 'identity-conflict',
    test: /表身份.*(失败|冲突|歧义)|身份冲突|identity conflict|多对一冲突|同时指向|同名.*(冲突|重复)|物理表名冲突|sheetkey.*(冲突|歧义)|表名.*(冲突|歧义)|schema 身份/,
    summary: '表格身份存在冲突或歧义：同一规范表名 / 别名对应了多个表，或新旧 sheetKey 没有正确归并。',
    steps: [
      '这通常是模板切换后旧 key 与新 key 并存导致。',
      '到「数据管理」页使用诊断 / 恢复工具，优先选择能保留两边数据的保真恢复。',
      '不要手工删除历史表；导出日志并附上模板切换步骤，便于定位身份映射。',
    ],
  },
  {
    id: 'sql-constraint',
    test: /unique constraint|constraint failed|not null constraint|foreign key constraint|datatype mismatch|主键冲突|唯一约束/,
    summary: 'SQL 写入违反了表约束（重复主键 / 空值 / 类型不匹配）。',
    steps: [
      '插入的行与已有行 row_id 重复：改用 UPDATE，或让系统自动分配 row_id。',
      '如果是 AI 生成的语句，重试一次让模型重新生成。',
      '手写 SQL 时确认列类型与填入值一致。',
    ],
  },
  {
    id: 'sql-syntax',
    test: /syntax error|near "|sql.*(执行失败|failed|error)|sqlite_error|execute failed|批量执行失败|快照 sql/,
    summary: 'SQL 语句执行失败：语法有误，或引用了不存在的表 / 列。',
    steps: [
      '如果是你在 SQL 控制台手写的语句，检查拼写、引号是否配对、语句末尾的分号。',
      '如果是 AI 生成的语句，多为模型输出错误，重试即可。',
      '用「查看所有表」「查看表结构」核对表名与列名。',
    ],
  },

  // ─── 表格数据状态 ───
  {
    id: 'table-data-not-loaded',
    test: /tabledata is not loaded|currentjsontabledata_acu is (null|not (loaded|available))|chat history is empty|表格数据.*(未加载|不可用)|聊天记录为空|获取聊天记录失败|save aborted/,
    summary: '表格数据尚未加载，或当前聊天里还没有消息。',
    steps: [
      '确认当前聊天里至少有一条 AI 回复；全新的聊天需要先发一条消息。',
      '切换一次聊天或刷新页面，让表格重新加载。',
      '如果反复出现，到「数据管理」页检查当前聊天的表格状态。',
    ],
  },
  {
    id: 'table-persist-model',
    test: /table persistence requires|direct unsafe writes/,
    summary: '有脚本尝试绕过安全写入通道直接改表，被插件拒绝。',
    steps: [
      '这通常来自第三方脚本或旧版角色卡脚本；本插件数据未受影响。',
      '请脚本作者改用本插件公开的表格 API（updateCell / updateRow / executeSql 等）。',
    ],
  },

  // ─── 设置持久化 ───
  {
    id: 'settings-persist',
    test: /failed to (save|persist|load).*settings|settings.*(save|load|persist).*fail|保存.*(设置|预设|配置|阈值|次数|频率|大小|并发|楼层|保留数).*失败|设置.*(保存|读取).*失败|failed to load or parse settings/,
    summary: '设置保存或读取失败。',
    steps: [
      '刷新页面后重新修改并保存一次。',
      '如果读取失败已回落到默认值，到「数据管理」页用之前导出的配置恢复。',
      '检查浏览器存储是否已满或被隐私设置限制。',
    ],
  },

  // ─── JSON / 解析 ───
  {
    id: 'json-import',
    // 第二组限定「文件导入」语境：TemplateAssistant 这类 AI 草稿解析失败不算导入问题。
    test: haystack => /json|parse|解析|unexpected token|unexpected end/.test(haystack)
      && /导入|import|\[模板|模板文件|template (file|json)|预设|preset|主题|theme|合并配置/.test(haystack),
    summary: '导入的文件不是合法 JSON，或结构与本插件要求的不一致。',
    steps: [
      '确认导入的是本插件「导出」功能生成的 JSON 文件，而不是别的插件或手改过的文件。',
      '用记事本打开文件，检查是否被截断、开头结尾的大括号是否完整。',
      '如果是从聊天 / 网页复制的内容，先粘贴到编辑器里检查再另存为 .json。',
    ],
  },
  {
    id: 'json-ai-output',
    test: /json.*(解析|parse|sanitiz)|parse.*json|unexpected token|unexpected end of json|is not valid json|sanitization|loose row object|failed to parse (command|or apply)|解析\/应用失败|解析失败|解析出错|解析异常/,
    summary: 'AI 输出的 JSON / 指令格式不正确，插件解析不了。',
    steps: [
      '这通常是模型偶发抖动，直接重试一次。',
      '频繁出现时换用指令遵循更好的模型（更大参数、或官方渠道）。',
      '填表可到「填表规则」开启「严格 JSON」或降低 temperature；检查自定义提示词是否要求了额外的输出格式。',
    ],
  },
  {
    id: 'empty-response',
    test: /未返回预期的文本响应|返回无效响应|unknown response format|failed to parse response|empty response|响应为空|返回为空|空响应|返回内容为空|已返回 null/,
    summary: 'AI 返回了空内容或无法识别的格式。',
    steps: [
      RETRY_LATER,
      '可能触发了服务商的内容审查（部分模型被拦截时会静默返回空），换个模型或调整内容再试。',
      '如果开启了流式输出，到「API」页关闭该预设的流式后再试。',
    ],
  },

  // ─── 向量 / 存储 / 检查点 ───
  {
    id: 'vector',
    test: /embedding|rerank|向量|vector/,
    summary: '交火模式（向量索引）相关操作失败。',
    steps: [
      '到「交火模式」页检查 Embedding / Rerank 的接口地址、密钥和模型名，确认服务商支持该接口。',
      SEE_PREVIOUS_LOG,
      '可先暂时关闭交火模式，不影响填表等基础功能。',
    ],
  },
  {
    id: 'storage-mode-switch',
    test: /存储模式.*(切换|回滚)|storage mode (switch|rollback)/,
    summary: '存储模式切换失败，已尝试回滚到切换前的状态。',
    steps: [
      '确认当前没有正在进行的填表或续写任务，等它们结束后再切换。',
      '刷新页面后再试一次。',
      '切换前建议先到「数据管理」页导出一份数据备份。',
    ],
  },
  {
    id: 'checkpoint-replay',
    test: /checkpoint|v2 replay|replay|snapshot hydrate|数据库重建|回放|增量更新流程失败|merge base|compaction|staging|provisional|临时根/,
    summary: '表格历史回放 / 检查点处理失败，当前显示的数据可能不是最新。',
    steps: [
      '先刷新页面，或切出去再切回这个聊天，让插件重新加载。',
      '到「数据管理」页导出一份数据备份，避免后续操作覆盖。',
      '使用「数据管理」里的诊断 / 恢复工具修复；仍不行请导出日志反馈。',
    ],
  },

  // ─── 世界书 ───
  {
    id: 'worldbook',
    test: /world ?book|lorebook|世界书|worldbook/,
    summary: '世界书读取或写入失败。',
    steps: [
      '确认当前角色已绑定世界书，且目标世界书没有被删除或重命名。',
      '打开酒馆自带的世界书面板，确认该世界书能正常打开。',
      '如果刚改过绑定，到对应功能页重新选择一次目标世界书。',
    ],
  },

  // ─── 外部脚本调用 ───
  {
    id: 'deprecated-api',
    test: /已弃用|deprecated/,
    summary: '有其他脚本调用了本插件已弃用的接口。',
    steps: [
      '不影响本插件正常运行，可以忽略。',
      '如果是你自己写的脚本，按日志提示改用新接口；如果是角色卡或第三方扩展，联系其作者更新。',
    ],
  },
  {
    id: 'invalid-params',
    test: /must be (an? )?(array|object|non-empty|integer)|is required\.?|invalid (params|input|rowindex|preset name|context settings)|received invalid input|参数无效|参数不合法/,
    summary: '外部脚本调用本插件接口时传入的参数不合法。',
    steps: [
      '这类调用通常来自角色卡脚本或其他扩展，本插件数据不受影响。',
      '如果是你写的脚本，按提示修正参数类型（例如 rowIndex 必须是从 1 开始的整数）。',
      '否则联系脚本作者处理。',
    ],
  },
  {
    id: 'preset-not-found',
    test: /preset .* not found|预设.*(不存在|未找到|找不到)|无法找到.*预设|找不到.*预设/,
    summary: '找不到指定名称的预设。',
    steps: [
      '检查预设名是否拼写正确，注意大小写和空格。',
      '到对应功能页（API / 填表规则 / 剧情推进）确认该预设仍然存在，可能已被删除或改名。',
      '重新选择一次预设并保存。',
    ],
  },
  {
    id: 'callback',
    test: /callback/,
    summary: '第三方脚本注册到本插件的回调函数执行出错。',
    steps: [
      '错误来自其他脚本内部，不影响本插件的填表结果。',
      '联系该脚本 / 角色卡作者排查。',
    ],
  },

  // ─── 按功能模块兜底 ───
  {
    id: 'template',
    test: /模板|template/,
    summary: '表格模板处理失败。',
    steps: [
      '确认导入的是本插件导出的模板 JSON，且每张表都有表头行。',
      '到「填表规则」页重新选择模板，或恢复默认模板后再导入自定义模板。',
      SEE_PREVIOUS_LOG,
    ],
  },
  {
    id: 'content-optimization',
    test: /正文优化|正文替换|content replace|reoptimize|重新优化/,
    summary: '正文替换 / 重新优化执行失败。',
    steps: [
      SEE_PREVIOUS_LOG,
      '到「正文替换」页确认规则与所选 API 预设是否正常。',
      '可先临时关闭该功能验证问题是否消失。',
    ],
  },
  {
    id: 'plot',
    test: /剧情推进|plot/,
    summary: '剧情推进任务执行失败。',
    steps: [
      '到「剧情推进」页检查所选 API 预设与世界书配置。',
      '如果刚编辑过任务提示词，检查占位符（$ 开头）是否拼写正确。',
      SEE_PREVIOUS_LOG,
    ],
  },
  {
    id: 'import',
    test: /外部导入|import|导入/,
    summary: '外部导入流程失败。',
    steps: [
      '确认导入文件为 UTF-8 编码，且分块大小设置不要过大。',
      '导入前确认已选择目标世界书。',
      '到「外部导入」页先「清空导入缓存」再重试。',
    ],
  },
  {
    id: 'fill',
    test: /manual (refill|update)|重填|填表|update process|\bbatch\b|merge|合并|fillfirstlayer|数据加载|triggerupdate|manualupdate/,
    summary: '填表 / 数据合并流程失败。',
    steps: [
      SEE_PREVIOUS_LOG,
      '到「填表规则」把批处理大小调小后重试。',
      '可到「填表工作台」使用手动填表 / 重填。',
    ],
  },
  {
    id: 'continuation',
    test: /continuation|续写|agent/,
    summary: 'Agent / 智能续写相关操作出错。',
    steps: [
      '智能续写：查看「智能续写」页会话流里的错误提示，并展开「各 Agent 渠道」确认每个渠道的 API 预设仍然存在。',
      '如果是超预算 / 超时，调大对应的预算或延迟；实在卡住可「一键清空」后重新开始任务。',
      'Agent 世界书：到「Agent」页确认接管模式与目标世界书配置。',
    ],
  },
  {
    id: 'export',
    test: /导出|export/,
    summary: '导出失败。',
    steps: [
      '检查浏览器是否拦截了文件下载（地址栏右侧通常有提示）。',
      '刷新页面后重试；仍失败请导出日志反馈。',
    ],
  },

  // ─── 通用兜底 ───
  {
    id: 'generic',
    test: () => true,
    summary: '插件内部操作失败。',
    steps: [
      '先重试一次；如果和 API 相关，稍等片刻再试。',
      '刷新页面后再做一次同样的操作。',
      EXPORT_LOGS,
    ],
  },
];

/**
 * 为一条日志匹配处理建议。只对 error 级日志给建议；warn / debug 返回 null。
 */
export function resolveLogErrorHint(entry: Pick<LogEntry, 'level' | 'tag' | 'message'>): LogErrorHint | null {
  if (entry.level !== 'error') return null;
  const haystack = `${entry.tag} ${entry.message}`.toLowerCase();
  for (const rule of RULES) {
    const matched = typeof rule.test === 'function' ? rule.test(haystack) : rule.test.test(haystack);
    if (matched) return { id: rule.id, summary: rule.summary, steps: rule.steps };
  }
  return null;
}

/** 供测试与调试使用：规则 ID 列表（按匹配优先级排序）。 */
export const LOG_ERROR_HINT_RULE_IDS: readonly string[] = RULES.map(rule => rule.id);
