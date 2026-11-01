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
  /** 面向用户展示的错误代码（规则 ID 的大写形式，如 NETWORK_DNS、HTTP_429）。 */
  code: string;
  /** 从报错文本中识别出的 HTTP 状态码；识别不到时不带该字段。 */
  httpStatus?: number;
  /** 一句话说明这条报错大致意味着什么。 */
  summary: string;
  /** 用户可以直接照做的处理步骤，按先后顺序排列。 */
  steps: string[];
}

interface HintContext {
  /** 小写化后的 `tag + message`。 */
  text: string;
  /** 可信的 HTTP 状态码（4xx / 5xx）；没有时为 null。 */
  status: number | null;
}

interface HintRule {
  id: string;
  /** 正则在小写化后的 `tag + message` 上匹配；函数可同时使用识别出的 HTTP 状态码。 */
  test: RegExp | ((context: HintContext) => boolean);
  summary: string;
  steps: string[];
}

/** 有可信状态码时只按状态码判定；没有状态码时才用关键词兜底，避免正文里的词把状态码盖掉。 */
function httpRule(statusTest: (status: number) => boolean, fallback?: RegExp): (context: HintContext) => boolean {
  return ({ status, text }) => (status !== null ? statusTest(status) : !!fallback && fallback.test(text));
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
      '向量相关报错请到「填表工作台」的「Embedding / Rerank」面板检查 Embedding / Rerank 的地址与模型。',
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
      '到「填表工作台」的「Embedding / Rerank」面板核对 Rerank 的接口地址（要填到 /rerank 这一级的完整地址）、API Key 与模型名。',
      '报错含「网络失败 / Failed to fetch」时多半是服务商不允许浏览器跨域直连，换用支持 CORS 的 rerank 服务或反向代理地址。',
      '报错含「没有任何可用的评分」时说明返回格式不是 results[].index / relevance_score，换一个兼容 Jina / Cohere 格式的服务商。',
      '不想用重排序就把 Rerank 地址与模型都清空，日志就不会再出现这条报错。',
    ],
  },

  // ─── 网络：带明确错误码的连接层故障 ───
  // 排在 HTTP 状态码之前：酒馆后端转发失败时会以 500 把 ECONNREFUSED 等原始原因带回来，
  // 这时连接层原因比「服务器 5xx」更准确。
  {
    id: 'network-offline',
    test: /err_internet_disconnected|err_network_changed|网络已断开|网络连接已断开|设备离线/,
    summary: '本机网络已断开，或请求途中网络发生了切换。',
    steps: [
      '确认电脑 / 手机已经连上网络。',
      '切换过 Wi-Fi、有线或 VPN 后，刷新酒馆页面再重试。',
    ],
  },
  {
    id: 'network-blocked-by-client',
    test: /err_blocked_by_client|blocked by client|被扩展拦截/,
    summary: '请求被浏览器扩展（广告拦截 / 隐私保护类）拦截，没有发出去。',
    steps: [
      '把酒馆所在网址加入广告拦截扩展的白名单，或临时停用该扩展后刷新页面。',
      '也可以开启该 API 预设的「通过酒馆渠道发送」，由酒馆后端代发请求。',
    ],
  },
  {
    id: 'network-mixed-content',
    test: /mixed content|混合内容/,
    summary: '酒馆页面是 https，而接口地址是 http，浏览器按「混合内容」规则拦截了请求。',
    steps: [
      '把接口地址改成 https 开头的地址。',
      '或者开启该 API 预设的「通过酒馆渠道发送」，由酒馆后端转发。',
    ],
  },
  {
    id: 'network-cors',
    test: /\bcors\b|cross-origin|access-control-allow-origin|preflight/,
    summary: '浏览器跨域被拦截（CORS）：该服务商不允许网页直接调用。',
    steps: [
      '开启该 API 预设的「通过酒馆渠道发送」，由酒馆后端代为转发（推荐）。',
      '或者改用明确支持浏览器直连（返回 Access-Control-Allow-Origin）的中转服务。',
    ],
  },
  {
    id: 'network-dns',
    test: /enotfound|eai_again|getaddrinfo|err_name_not_resolved|name not resolved|\bdns\b|域名解析/,
    summary: '域名解析失败：接口地址里的域名找不到对应的服务器。',
    steps: [
      '检查接口地址里的域名有没有拼错、是否多了空格或少了字母。',
      '把地址复制到浏览器打开；打不开时更换 DNS 或检查代理 / VPN。',
      '开启了「通过酒馆渠道发送」时，是酒馆所在的服务器解析不了该域名，需要在那台服务器上检查网络与 DNS。',
    ],
  },
  {
    id: 'network-refused',
    test: /econnrefused|err_connection_refused|connection refused|连接被拒绝|拒绝连接/,
    summary: '目标地址拒绝连接：该地址和端口上没有服务在运行。',
    steps: [
      '本地模型（Ollama、KoboldCpp、LM Studio 等）：确认程序已经启动，端口号与接口地址里的一致。',
      '检查地址开头的 http / https 是否与服务实际协议一致。',
      '酒馆部署在远程服务器或 Docker 中时，地址里的 127.0.0.1 / localhost 指的是那台服务器自己，需要改成它能访问到的地址。',
    ],
  },
  {
    id: 'network-reset',
    test: /econnreset|err_connection_reset|err_connection_closed|err_empty_response|socket hang up|connection reset|other side closed|typeerror: terminated|连接被重置|连接中断/,
    summary: '连接建立后被中途断开（连接被重置），通常是代理、中转站或服务商主动断开。',
    steps: [
      RETRY_LATER,
      '长时间没有数据的流式请求容易被中间代理掐断：可关闭该预设的流式输出，或换一条更稳定的线路。',
      '持续出现时换一条 API 渠道，或联系中转站确认服务是否稳定。',
    ],
  },
  {
    id: 'network-connect-timeout',
    test: /etimedout|err_connection_timed_out|err_timed_out|connect ?timeout|und_err_connect_timeout|连接超时/,
    summary: '连接目标服务器超时：服务器一直没有应答，多为网络不通、被防火墙或地区网络封锁。',
    steps: [
      '把接口地址复制到浏览器打开，确认当前网络能访问；访问海外服务通常需要代理。',
      '开启了「通过酒馆渠道发送」时，是酒馆所在的服务器连不上该地址，需要给服务器配置网络代理。',
      '这不是模型回复慢：调大「请求超时」不能解决连接超时。',
    ],
  },
  {
    id: 'network-ssl',
    test: /err_cert|err_ssl|certificate|self[ _-]signed|unable_to_verify|\bssl\b|\btls\b|证书/,
    summary: 'HTTPS 证书校验失败：服务器证书过期、自签名或与域名不匹配。',
    steps: [
      '把接口地址复制到浏览器打开，看是否出现证书警告。',
      '检查电脑系统时间是否正确，时间错误也会导致证书失效。',
      '自建服务请换用有效证书；中转站证书问题请联系站方。',
    ],
  },
  {
    id: 'network-proxy',
    test: ({ status, text }) => status === 407 || /err_proxy|err_tunnel|proxy connection|tunneling socket|proxy authentication|代理服务器/.test(text),
    summary: '代理服务器连接失败，或代理要求身份认证（407）。',
    steps: [
      '检查系统 / 浏览器的代理设置：代理软件是否在运行、端口是否正确。',
      '开启了「通过酒馆渠道发送」时，检查酒馆服务器 config.yaml 里的代理配置。',
      '临时关闭代理重试，确认问题是否出在代理上。',
    ],
  },

  // ─── 服务商账户 / 地区 ───
  {
    id: 'api-region-blocked',
    test: /unsupported_country|country, region,? or territory|location is not supported|user location|地区不支持|所在地区/,
    summary: '服务商不对当前所在地区提供服务（按发出请求的出口 IP 判断）。',
    steps: [
      '换用支持当前地区的中转线路，或通过代理从受支持地区发出请求。',
      '开启了「通过酒馆渠道发送」时，判断依据是酒馆服务器的出口 IP，而不是你本机。',
    ],
  },
  {
    id: 'api-quota',
    // 429 + 「quota exceeded」在 Gemini 等服务商是「每分钟配额」限流，归 http-429；只有明确的计费/余额措辞才算额度耗尽。
    test: ({ status, text }) => status === 402
      || /insufficient[ _]quota|exceeded your current quota|insufficient[ _](balance|funds|credits?)|billing[ _](hard[ _])?limit|billing_not_active|余额不足|额度不足|额度已用完|欠费|账户余额/.test(text)
      || (status !== 429 && /quota (exceeded|exhausted)/.test(text)),
    summary: '账户额度或余额已用完（与请求频率无关，等待不会自动恢复）。',
    steps: [
      '登录服务商 / 中转站后台查看余额与账单，充值或更换有余额的 API Key。',
      '免费额度通常按日或按月重置，可等待重置后再用。',
      '确认当前预设填的是你以为的那个 Key（多个预设时容易用错）。',
    ],
  },

  // ─── HTTP 状态码（识别到状态码时只按状态码判定）───
  {
    id: 'http-401',
    test: httpRule(status => status === 401, /unauthorized|invalid[ _-]?api[ _-]?key|incorrect api key|invalid x-api-key|authentication[ _-]?error|no auth credentials|令牌无效|密钥无效|api key 无效/),
    summary: 'API 拒绝了请求：密钥无效、填错或已过期（401）。',
    steps: [
      '到「API」页打开当前使用的预设，检查 API Key 是否完整、有没有多余空格。',
      '确认这个 Key 对应的服务商与接口地址、「API 格式」一致（比如 OpenAI 的 Key 不能填到 Claude 地址）。',
      '如果是中转站，登录站点确认 Key 仍然有效、没有被禁用。',
    ],
  },
  {
    id: 'http-403',
    test: httpRule(status => status === 403, /forbidden|permission[ _-]?denied|not allowed to|access denied|无权访问|权限不足/),
    summary: '服务商拒绝访问（403）：Key 没有该模型的权限，或请求来源被限制。',
    steps: [
      '确认该 Key 有权使用所选模型（部分模型需要单独开通或更高的账户等级）。',
      '一些服务商会拒绝来自浏览器的直连请求：开启该预设的「通过酒馆渠道发送」。',
      '如果是中转站，联系站方确认账号或 IP 是否被限制。',
    ],
  },
  {
    id: 'http-404',
    test: httpRule(status => status === 404 || status === 405, /not[ _]found.*(model|endpoint|route)|model.*(not found|does not exist|not exist)|no such model|unknown model|invalid model|模型不存在|找不到模型/),
    summary: '接口地址或模型名不存在（404 / 405）。',
    steps: [
      '到「API」页检查接口地址：不同服务商对结尾是否带 /v1 要求不同，不要手动加上 /chat/completions 等具体路径，按服务商文档填写。',
      '点击「拉取模型列表」重新选择模型，避免手写模型名拼错。',
      '确认服务商仍然提供该模型，旧模型可能已下线。',
    ],
  },
  {
    id: 'api-timeout',
    test: httpRule(status => status === 408 || status === 504 || status === 524, /timeouterror|timed out|\btimeout\b|gateway time-?out|请求超时|响应超时|读取超时/),
    summary: '等待回复超时：服务器已经连上，但在期限内没有返回完整回复（插件请求超时，或网关 408 / 504 / 524）。',
    steps: [
      '到「API」页调大该预设的「请求超时（秒）」（默认 300 秒），推理模型和长输出需要更久。',
      '调小输出长度或批处理大小，让单次回复更快结束。',
      '504 / 524 是中转站或 Cloudflare 等网关先等不及了，插件这边调大超时无效：换一条线路或联系站方。',
    ],
  },
  {
    id: 'context-length',
    test: ({ status, text }) => status !== 429
      && /context[ _-]?length|maximum context|context window|too many tokens|tokens? (exceed|limit|too long)|prompt is too long|input is too long|max_tokens.*(exceed|invalid)|超出.*(上下文|长度)|上下文.*(超限|过长)|token.*超/.test(text),
    summary: '发送给模型的内容太长，超出了模型的上下文上限。',
    steps: [
      '填表：到「填表规则」把「批处理大小」/「上下文楼层数」调小一些。',
      '智能续写：调小「正文可读窗口楼数」「会话自动总结阈值」与各项读取预算。',
      '换用上下文更大的模型，或精简过长的自定义提示词与世界书条目。',
    ],
  },
  {
    id: 'http-413',
    test: httpRule(status => status === 413, /payload too large|request entity too large|请求体过大/),
    summary: '请求体太大，被服务商或中间代理拒收（413）。',
    steps: [
      '调小批处理大小、上下文楼层数等，让单次请求更小。',
      '自建反向代理（如 nginx）时调大 client_max_body_size；中转站限制请联系站方。',
    ],
  },

  {
    id: 'http-429',
    test: httpRule(status => status === 429, /rate[ _-]?limit|too many requests|\bquota\b|resource[ _-]?exhausted|请求过于频繁|限流|配额/),
    summary: '请求过于频繁被限流（429）：短时间内的请求数或 Token 用量超过了服务商上限。',
    steps: [
      '先等 1–2 分钟再重试；短时间内连续重试只会让限流更久。',
      '在对应功能的设置里调大「重试延迟」/「轮次延迟」，或调小并发数、批处理大小。',
      '智能续写会连续发起大量请求，请使用支持高 RPM 的 API，不要用公益站。',
      '如果报错写的是额度（quota）用完而不是频率，登录服务商后台确认余额。',
    ],
  },
  {
    id: 'http-5xx',
    test: httpRule(status => status >= 500 && status <= 599, /bad gateway|service unavailable|internal server error|overloaded|server error|服务器错误|服务不可用/),
    summary: '服务商服务器出错或过载（5xx），不是本地配置问题。',
    steps: [
      RETRY_LATER,
      '持续出现时换一个模型或换一条 API 渠道；中转站请查看站方公告确认是否在维护。',
      '开启了「通过酒馆渠道发送」时，500 也可能是酒馆后端转发出错：到酒馆服务器的控制台窗口查看具体报错。',
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
  {
    id: 'http-400',
    test: httpRule(status => status === 400, /bad request|invalid_request_error|unsupported parameter|invalid parameter|unrecognized request argument|unknown parameter|参数错误|请求参数无效/),
    summary: '服务商认为请求内容有问题（400）：通常是模型名或某个参数不被支持。',
    steps: [
      '到「API」页确认模型名拼写正确，最好通过「拉取模型列表」选择。',
      '如果调整过 temperature / top_p 等高级参数或开启了「严格 JSON」，先恢复默认再试。',
      '换一个模型试试：部分模型不支持 system 角色或某些字段。',
    ],
  },
  {
    id: 'http-4xx',
    test: httpRule(status => status >= 400 && status <= 499),
    summary: '服务商拒绝了这次请求（4xx），具体原因写在报错正文里。',
    steps: [
      '阅读报错里服务商返回的 message / code 字段，按提示修改模型名、参数或接口地址。',
      '确认「API」页的「API 格式」与服务商一致，模型名通过「拉取模型列表」选择。',
      SEE_PREVIOUS_LOG,
    ],
  },
  {
    id: 'api-upstream-error',
    test: /返回上游错误/,
    summary: '服务商在响应里返回了错误对象（HTTP 状态码正常，但内容是错误而不是回复）。',
    steps: [
      '看报错里附带的 type / code / message，按含义处理（额度、模型、参数等）。',
      '确认「API」页的「API 格式」与服务商一致：格式选错时服务商常会返回错误对象。',
      RETRY_LATER,
    ],
  },

  // ─── 网络（无状态码的兜底）───
  {
    id: 'network-fetch-failed',
    test: /failed to fetch|network ?error|load failed|fetch failed|net::err|网络错误|网络失败|网络不可达|无法连接/,
    summary: '请求没能发出去或没收到任何回应（Failed to fetch）。浏览器出于安全不给出具体原因，最常见是跨域被拦、地址打不开或被扩展拦截。',
    steps: [
      '直连时（关闭了「通过酒馆渠道发送」）最常见的原因是跨域被拦：开启该预设的「通过酒馆渠道发送」再试。',
      '把接口地址复制到浏览器新标签页打开，确认能访问、没有证书警告。',
      '检查代理 / VPN 与广告拦截扩展；按 F12 打开控制台，红色报错里的 net::ERR_… 就是具体原因。',
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

  // ─── V2 历史回放 / 恢复 ───
  // 必须排在 sql-constraint 之前：这类错误正文里会原样带着「UNIQUE constraint failed」，
  // 但根因不是这次 SQL，而是聊天历史只能宽容回放；「重试让模型重新生成」修不好它。
  {
    id: 'v2-write-guard',
    test: /写入时基底与回放基底不一致|不可严格回放的历史/,
    summary: '本次表格增量与聊天历史回放状态不一致，插件在写入前拦住了它（历史没有被写坏）。',
    steps: [
      '这通常是模型重复填行：它生成的 INSERT 在按楼层回放时与已有行的 row_id 冲突。填表 / 追平会把这条错误反馈给模型自动重试，一般无需处理。',
      '如果同一楼层反复失败，说明模型看到的表内容与该楼层的历史状态不一致（多见于手动追平早期楼层）；换一个追平起点或缩小选表范围再试。',
      EXPORT_LOGS,
    ],
  },
  {
    id: 'v2-compat-readonly',
    test: /兼容宽容回放读出|仅可经兼容|compat_tolerant_replay|v2 恢复收敛|固化为过渡根|兼容过渡根/,
    summary: '聊天里的表格历史只能以兼容（宽容）模式读出：某条历史增量在严格回放时失败（常见是重复插入同一 row_id）。读取仍然正常，但写入、追平和模板提交会被拒绝。',
    steps: [
      '这不是本次 AI 输出的问题，重试生成不会修复历史，所以插件不会自动重试。',
      '到「数据管理」→「诊断 V2 数据恢复」，点「固化兼容回放为过渡根」：把当前兼容读取结果写成严格可回放的根，之后写入与追平恢复正常（含 sheetKey 身份归并时需要额外确认）。',
      '固化不会改写任何原始 storage frame；如需人工核对，先用「导出已保存的原始 frame 备份」。',
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
    test: ({ text: haystack }) => /json|parse|解析|unexpected token|unexpected end/.test(haystack)
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
    test: /\bembedding\b|\brerank\b|向量|\bvector\b/,
    summary: '交火模式（向量索引）相关操作失败。',
    steps: [
      '到「填表工作台」的「Embedding / Rerank」面板检查 Embedding / Rerank 的接口地址、密钥和模型名，确认服务商支持该接口。',
      SEE_PREVIOUS_LOG,
      '可先在填表模式页切到经典表格模式或LLM模型逻辑召回模式，不影响填表等基础功能。',
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
 * 从报错文本中取出 HTTP 状态码：只认紧跟在「HTTP / status / 状态码 / 失败 / 错误」之后的三位数，
 * 避免把堆栈行号、row_id、楼层号、Token 数等普通数字误判成状态码。
 */
const HTTP_STATUS_PATTERNS: readonly RegExp[] = [
  /\bhttp(?:\s*状态码?)?\s*[:：=/]?\s*([1-5]\d\d)\b/g,
  /\bstatus(?:[ _]?code)?["'\s]*[:：=]\s*([1-5]\d\d)\b/g,
  /状态码[\s:：=]*([1-5]\d\d)\b/g,
  /(?:失败|错误|error|failed)\s*(?:[（(][^）)\n]{0,80}[）)])?\s*[:：]?\s*([1-5]\d\d)\b/g,
];

/** 返回文本里第一个 4xx / 5xx 状态码；没有可信的状态码时返回 null。 */
export function extractLogHttpStatus(text: string): number | null {
  const haystack = text.toLowerCase();
  let best: { index: number; status: number } | null = null;
  for (const pattern of HTTP_STATUS_PATTERNS) {
    for (const match of haystack.matchAll(pattern)) {
      const status = Number(match[1]);
      if (status < 400 || status > 599) continue;
      if (!best || (match.index ?? 0) < best.index) best = { index: match.index ?? 0, status };
      break;
    }
  }
  return best ? best.status : null;
}

function toHint(rule: HintRule, status: number | null): LogErrorHint {
  const hint: LogErrorHint = { id: rule.id, code: rule.id.toUpperCase().replace(/-/g, '_'), summary: rule.summary, steps: rule.steps };
  if (status !== null) hint.httpStatus = status;
  return hint;
}

/**
 * 为任意一段报错文本匹配处理建议；桌宠错误气泡等非日志入口使用。
 * 总会返回一条建议，未命中任何具体规则时返回通用兜底（id = generic）。
 */
export function resolveErrorTextHint(text: string): LogErrorHint {
  const haystack = String(text ?? '').toLowerCase();
  const context: HintContext = { text: haystack, status: extractLogHttpStatus(haystack) };
  for (const rule of RULES) {
    const matched = typeof rule.test === 'function' ? rule.test(context) : rule.test.test(haystack);
    if (matched) return toHint(rule, context.status);
  }
  return toHint(RULES[RULES.length - 1], context.status);
}

/**
 * 为一条日志匹配处理建议。只对 error 级日志给建议；warn / debug 返回 null。
 */
export function resolveLogErrorHint(entry: Pick<LogEntry, 'level' | 'tag' | 'message'>): LogErrorHint | null {
  if (entry.level !== 'error') return null;
  return resolveErrorTextHint(`${entry.tag} ${entry.message}`);
}

/** 供测试与调试使用：规则 ID 列表（按匹配优先级排序）。 */
export const LOG_ERROR_HINT_RULE_IDS: readonly string[] = RULES.map(rule => rule.id);
