<template>
  <section class="acu-v2-continuation-page">
    <AcuPanel title="Agent 会话" description="像和 coding agent 对话一样使用：随时输入、随时打断。主 Agent 按需派工子代理并管理大纲，最终正文仍由酒馆模型生成。">
      <ContinuationChat
        :task="runtime.task.value"
        :entries="session.entries.value"
        :running="session.running.value"
        :draft="messageDraft"
        :sending="messageSending"
        :status-text="runtime.statusText.value"
        :stage-text="stageText"
        :completed-turns="runtime.activeStage.value?.completedTurns ?? 0"
        :total-turns="runtime.activeRevision.value?.outline.totalTurns ?? 0"
        :revision-text="runtime.activeStage.value ? `revision ${runtime.activeStage.value.activeRevision}` : ''"
        :deadline-text="deadlineText"
        :awaiting-host="runtime.isAwaitingHostResult.value"
        @send="sendMessage"
        @update:draft="messageDraft = $event"
        @stop="runtime.stopTask"
      />
    </AcuPanel>

    <AcuPanel v-if="runtime.task.value && runtime.task.value.status === 'awaiting_outline_review' && runtime.activeRevision.value" title="待确认的大纲" description="确认前会在领域层重新执行严格 Schema 与 revision 校验；页面不直接写入聊天数组。">
      <AcuTextarea :model-value="outlineDraft" :rows="16" @update:model-value="outlineDraft = $event" />
      <p v-if="outlineDraftError" class="acu-v2-continuation-page__error">{{ outlineDraftError }}</p>
      <div class="acu-v2-continuation-page__actions">
        <AcuButton variant="primary" :loading="runtime.busy.value" @click="acceptOutlineDraft">确认大纲并继续</AcuButton>
      </div>
    </AcuPanel>

    <!-- 会话独占整宽，资料与设置并列在其下：会话是主操作面，资料与设置是查阅面。 -->
    <AcuPanelGrid class="acu-v2-continuation-page__layout">
      <AcuPanel title="已有资料" description="阶段大纲与本地资料都可以直接编辑保存；一键清空只丢任务、会话记录与本地资料，不动小说正文。">
        <ContinuationMaterialsPanel
          ref="materialsPanel"
          :task="runtime.task.value"
          :active-stage="runtime.activeStage.value"
          :active-revision="runtime.activeRevision.value"
          :busy="runtime.busy.value"
          @save-outline="saveOutline"
          @clear="clearData"
        />
      </AcuPanel>

      <AcuPanel v-if="settingsDraft" title="续写设置" description="修改后自动保存；任务运行中也可以改，改动会在本轮空档落盘、下一轮开始时生效。常用项直接可见，其余参数按主题折叠，默认值已能满足大多数场景。">
        <div class="acu-v2-continuation-page__settings-grid">
          <AcuFormRow label="阶段规模" hint="一个阶段规划多少轮正文；轮数越多，单个大纲覆盖的剧情越长。">
            <select v-model="settingsDraft.stageSize">
              <option value="short">短（3–5）</option>
              <option value="standard">标准（6–10）</option>
              <option value="long">长（11–20）</option>
              <option value="custom">自定义</option>
            </select>
          </AcuFormRow>
          <AcuFormRow label="故事总纲卷数" hint="故事总纲预计分多少卷推进，影响总纲子代理的整体节奏规划。">
            <select v-model="settingsDraft.storyArcVolumePlan">
              <option value="short">短线（7–8 卷）</option>
              <option value="medium">中线（10–14 卷）</option>
              <option value="long">长线（20 卷）</option>
              <option value="custom">自定义</option>
            </select>
          </AcuFormRow>
          <AcuFormRow v-if="settingsDraft.storyArcVolumePlan === 'custom'" label="自定义总纲卷数" hint="1–50 的整数。">
            <AcuInput v-model="settingsDraft.customStoryArcVolumeCount" type="number" :min="1" :max="50" />
          </AcuFormRow>
          <AcuFormRow v-if="settingsDraft.stageSize === 'custom'" label="最少轮次" hint="1–50 的整数，且不能大于最多轮次。">
            <AcuInput v-model="settingsDraft.customTurnMin" type="number" :min="1" :max="50" />
          </AcuFormRow>
          <AcuFormRow v-if="settingsDraft.stageSize === 'custom'" label="最多轮次" hint="1–50 的整数。">
            <AcuInput v-model="settingsDraft.customTurnMax" type="number" :min="1" :max="50" />
          </AcuFormRow>
          <AcuFormRow label="API 预设（全局默认）" hint="所有 Agent 默认走这个预设；需要给某个 Agent 单独指定时，展开下方「各 Agent 渠道」。">
            <AcuSelect
              :options="continuationApiPresetOptions"
              :model-value="continuationApiPresetValue"
              :placeholder="followActiveApiLabel"
              @update:model-value="applyContinuationApiPreset"
            />
          </AcuFormRow>
          <AcuFormRow label="总时长（分钟）" hint="到点后自动停止任务，0 为不限时。">
            <AcuInput v-model="settingsDraft.totalDurationMinutes" type="number" :min="0" />
          </AcuFormRow>
        </div>
        <div class="acu-v2-continuation-page__toggles">
          <AcuCheckbox v-model="settingsDraft.outlinePreview" label="大纲产出后先预览再执行" />
          <AcuCheckbox v-model="settingsDraft.finalReview.enabled" label="启用发送前世界书终审" />
          <AcuCheckbox v-model="settingsDraft.webResearch.enabled" label="启用开场百科检索（同人推荐）" />
        </div>

        <div class="acu-v2-continuation-page__groups">
          <AcuDisclosureGroup
            class="acu-v2-continuation-page__group"
            label="运行与重试"
            :meta="runGroupMeta"
            :expanded="isGroupExpanded('run')"
            body-id="acu-continuation-group-run"
            @toggle="toggleGroup('run')"
          >
            <div class="acu-v2-continuation-page__settings-grid">
              <AcuFormRow label="自动阶段上限" hint="连续自动推进多少个阶段后暂停，等待你确认。">
                <AcuInput v-model="settingsDraft.maxAutomaticStages" type="number" :min="1" />
              </AcuFormRow>
              <AcuFormRow label="正文重试次数" hint="酒馆生成失败或被判定截断时最多重试几次。">
                <AcuInput v-model="settingsDraft.generationRetryLimit" type="number" :min="0" />
              </AcuFormRow>
              <AcuFormRow label="正文最低 token 数" hint="酒馆生成低于该值视为截断或出错并自动重试，0 为不检查。">
                <AcuInput v-model="settingsDraft.minGenerationTokens" type="number" :min="0" />
              </AcuFormRow>
              <AcuFormRow label="内部 AI 重试次数" hint="Agent 自身调用 API 失败时的重试次数。">
                <AcuInput v-model="settingsDraft.internalAiRetryLimit" type="number" :min="0" />
              </AcuFormRow>
              <AcuFormRow label="轮次延迟（秒）" hint="每轮正文完成后等待多久再开始下一轮。">
                <AcuInput v-model="settingsDraft.loopDelaySeconds" type="number" :min="0" />
              </AcuFormRow>
              <AcuFormRow label="重试延迟（秒）" hint="失败后等待多久再重试；遇到 429 限流可适当调大。">
                <AcuInput v-model="settingsDraft.retryDelaySeconds" type="number" :min="0" />
              </AcuFormRow>
              <AcuFormRow label="连续高压轮上限" hint="跨阶段累计多少轮没有日常/余波轮就强制安排一轮，0 为不作要求。每阶段的松紧由大纲自选的节奏形态决定，这里只兜底极端情况。">
                <AcuInput v-model="settingsDraft.maxConsecutivePressureTurns" type="number" :min="0" :max="maxConsecutivePressureTurnsMax" />
              </AcuFormRow>
              <AcuFormRow label="循环标签" hint="逗号分隔；正文中缺少任一标签就视为生成失败并重试。留空不检查。">
                <AcuInput v-model="settingsDraft.loopTags" type="text" />
              </AcuFormRow>
            </div>
          </AcuDisclosureGroup>

          <AcuDisclosureGroup
            class="acu-v2-continuation-page__group"
            label="正文读取与上下文"
            :meta="contextGroupMeta"
            :expanded="isGroupExpanded('context')"
            body-id="acu-continuation-group-context"
            @toggle="toggleGroup('context')"
          >
            <div class="acu-v2-continuation-page__settings-grid">
              <AcuFormRow label="正文可读窗口楼数" hint="只有最近这么多 AI 楼层能被 Agent 读取/搜索，更早剧情走纪要回溯；0 为不开放正文读取。">
                <AcuInput v-model="settingsDraft.storyWindowFloors" type="number" :min="0" />
              </AcuFormRow>
              <AcuFormRow label="正文目录尾部全文楼数" hint="最近几楼直接注入全文作承接锚点，其余窗口内楼层只进目录按需调阅。">
                <AcuInput v-model="settingsDraft.storyTailFloors" type="number" :min="0" />
              </AcuFormRow>
              <AcuFormRow label="会话自动总结阈值（token）" hint="按主 Agent 实际读取的完整上下文统计（含提示词、工具结果与子代理报告），超过后在下一轮开始前把最早轮次浓缩成交接报告；0 为不总结。">
                <AcuInput v-model="settingsDraft.agentHistoryTokenBudget" type="number" :min="0" />
              </AcuFormRow>
              <AcuFormRow label="单批次读取上限" hint="一次 read/search 工具批次最多可注入多少 token；超过整批打回。不同批次不累计，填正整数或形如 20% 的百分比（按总结阈值折算）。">
                <AcuInput v-model="settingsDraft.agentReadTokenBudget" type="text" />
              </AcuFormRow>
              <AcuFormRow label="临近总结时的精读额度（token）" hint="上下文即将触发总结时，只有不超过此大小的单批次读取会放行；默认 6000。">
                <AcuInput v-model="settingsDraft.agentReadFallbackTokens" type="number" :min="1" />
              </AcuFormRow>
            </div>
          </AcuDisclosureGroup>

          <AcuDisclosureGroup
            class="acu-v2-continuation-page__group"
            label="Agent 运行预算"
            :meta="budgetGroupMeta"
            :expanded="isGroupExpanded('budget')"
            body-id="acu-continuation-group-budget"
            @toggle="toggleGroup('budget')"
          >
            <div class="acu-v2-continuation-page__settings-grid">
              <AcuFormRow label="主 Agent 迭代上限" hint="一次规划内最多做多少次决策（派工/改大纲/交付各算一次；read/search 工具批次不计入）。范围 1–30。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxIterations" type="number" :min="1" :max="30" />
              </AcuFormRow>
              <AcuFormRow label="派工总数上限" hint="一次规划内最多派出多少个子代理任务，0 为禁止派工。范围 0–20。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxDelegations" type="number" :min="0" :max="20" />
              </AcuFormRow>
              <AcuFormRow label="单代理派工上限" hint="同一个子代理在一次规划内最多被派几次。范围 1–10。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxSameAgent" type="number" :min="1" :max="10" />
              </AcuFormRow>
              <AcuFormRow label="并发派工上限" hint="同一波次最多同时运行几个子代理；API 限流严格时调小。范围 1–6。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxConcurrent" type="number" :min="1" :max="6" />
              </AcuFormRow>
              <AcuFormRow label="读取批次上限" hint="主 Agent 一次规划内 read/search 工具批次的次数上限，0 为禁止读取。范围 0–30。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxReads" type="number" :min="0" :max="30" />
              </AcuFormRow>
              <AcuFormRow label="子代理工具轮上限" hint="子代理首轮之外还允许几轮 read/search 追加读取，0 为只靠固定注入与派工种子。范围 0–10。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxExtraReads" type="number" :min="0" :max="10" />
              </AcuFormRow>
            </div>
          </AcuDisclosureGroup>

          <AcuDisclosureGroup
            class="acu-v2-continuation-page__group"
            label="发送前终审"
            :meta="finalReviewGroupMeta"
            :expanded="isGroupExpanded('finalReview')"
            body-id="acu-continuation-group-final-review"
            @toggle="toggleGroup('finalReview')"
          >
            <div class="acu-v2-continuation-page__settings-grid">
              <AcuFormRow label="终审单批次读取上限" hint="终审每次 read/search 工具批次最多可注入多少 token；超过整批打回。填正整数或形如 20% 的百分比（按总结阈值折算）。">
                <AcuInput v-model="settingsDraft.finalReview.readTokenBudget" type="text" />
              </AcuFormRow>
              <AcuFormRow label="终审额外读取轮数" hint="终审首轮之外允许追加 read/search 的次数，0 为只使用固定证据。范围 0–10。">
                <AcuInput v-model="settingsDraft.finalReview.maxExtraReads" type="number" :min="0" :max="10" />
              </AcuFormRow>
            </div>
            <p class="acu-v2-continuation-page__meta">终审默认关闭；开启后会额外调用 final-reviewer，先看世界书目录与命中预览，再按实际需要 search/read 精读条目。它使用独立的单批次读取上限与工具轮，不占用主 Agent 的读取额度。关闭时不装配终审证据、不额外读取世界书，也不会发起终审调用。</p>
          </AcuDisclosureGroup>

          <AcuDisclosureGroup
            class="acu-v2-continuation-page__group"
            label="网页检索"
            :meta="webResearchGroupMeta"
            :expanded="isGroupExpanded('webResearch')"
            body-id="acu-continuation-group-web-research"
            @toggle="toggleGroup('webResearch')"
          >
            <p class="acu-v2-continuation-page__meta">开启后，新任务第一次规划前会自动派工 web-researcher，从勾选的百科查清原作人物、组织、能力与设定，按实体分条写进「百科资料库」（资料面板 → 百科资料）；之后主 Agent 也能按需再派。所有出网只由该子代理执行：维基与萌娘走浏览器直连，百度与网页抓取经酒馆服务器同源转发。</p>
            <div class="acu-v2-continuation-page__toggles">
              <AcuCheckbox v-model="settingsDraft.webResearch.sources.moegirl" label="萌娘百科" />
              <AcuCheckbox v-model="settingsDraft.webResearch.sources.wikipediaZh" label="中文维基百科" />
              <AcuCheckbox v-model="settingsDraft.webResearch.sources.wikipediaEn" label="英文维基百科" />
              <AcuCheckbox v-model="settingsDraft.webResearch.sources.baidu" label="百度百科（经酒馆转发）" />
            </div>
            <div class="acu-v2-continuation-page__settings-grid">
              <AcuFormRow label="搜索引擎" hint="百科查不到时的兜底搜索。DuckDuckGo 免 key；Serper / Tavily 使用酒馆「API 密钥」里已配置的 key；SearXNG 需填实例地址。">
                <AcuSelect v-model="settingsDraft.webResearch.searchProvider" :options="webSearchProviderOptions" />
              </AcuFormRow>
              <AcuFormRow v-if="settingsDraft.webResearch.searchProvider === 'searxng'" label="SearXNG 实例地址" hint="形如 https://searx.example.org">
                <AcuInput v-model="settingsDraft.webResearch.searxngBaseUrl" type="text" />
              </AcuFormRow>
              <AcuFormRow label="单次工具轮上限" hint="web-researcher 一次派工里搜索/抓取/本地调阅的轮数上限。范围 1–20。">
                <AcuInput v-model="settingsDraft.webResearch.maxToolRounds" type="number" :min="1" :max="20" />
              </AcuFormRow>
              <AcuFormRow label="单次抓取页数上限" hint="单次检索最多阅读的外部页面数。页面正文仅在检索子代理当次上下文中使用，不会写入聊天。范围 1–30。">
                <AcuInput v-model="settingsDraft.webResearch.maxPages" type="number" :min="1" :max="30" />
              </AcuFormRow>
              <AcuFormRow label="单页阅读字数上限" hint="检索子代理归纳资料时可读取的单页正文上限；正文不保存。范围 500–20000。">
                <AcuInput v-model="settingsDraft.webResearch.pageCharLimit" type="number" :min="500" :max="20000" />
              </AcuFormRow>
              <AcuFormRow label="域名黑名单" hint="web_read 不得抓取的域名，逗号或换行分隔；内网与酒馆自身始终被拦。">
                <AcuTextarea v-model="settingsDraft.webResearch.blockedDomains" :rows="3" />
              </AcuFormRow>
            </div>
          </AcuDisclosureGroup>

          <AcuDisclosureGroup
            class="acu-v2-continuation-page__group"
            label="各 Agent 渠道"
            :meta="channelGroupMeta"
            :expanded="isGroupExpanded('channels')"
            body-id="acu-continuation-group-channels"
            @toggle="toggleGroup('channels')"
          >
            <p class="acu-v2-continuation-page__meta">给不同 Agent 分配不同 API 预设：例如主 Agent 用强模型，审查类子代理用便宜快速的模型。「跟随全局默认」即使用上方的 API 预设。</p>
            <div class="acu-v2-continuation-page__settings-grid">
              <AcuFormRow v-for="channel in agentChannelRoles" :key="channel.role" :label="channel.label">
                <AcuSelect
                  :options="agentChannelOptions"
                  :model-value="agentChannelValue(channel.role)"
                  @update:model-value="value => applyAgentChannel(channel.role, value)"
                />
              </AcuFormRow>
            </div>
          </AcuDisclosureGroup>

          <AcuDisclosureGroup
            class="acu-v2-continuation-page__group"
            label="上下文提取与排除规则"
            :meta="rulesGroupMeta"
            :expanded="isGroupExpanded('rules')"
            body-id="acu-continuation-group-rules"
            @toggle="toggleGroup('rules')"
          >
            <p class="acu-v2-continuation-page__meta">提取规则只保留正文中匹配「起始–结束」标记之间的内容；排除规则则把匹配段落剔除。两者都为空时使用完整正文。</p>
            <AcuRulePairList v-model="settingsDraft.contextExtractRules" label="上下文提取规则" />
            <AcuRulePairList v-model="settingsDraft.contextExcludeRules" label="上下文排除规则" />
          </AcuDisclosureGroup>
        </div>

        <p v-if="settingsError" class="acu-v2-continuation-page__error">{{ settingsError }}</p>
        <p v-if="settingsNotice" class="acu-v2-continuation-page__meta">{{ settingsNotice }}</p>
      </AcuPanel>
    </AcuPanelGrid>

    <AcuPanel v-if="settingsDraft" title="伪 Role 提示词" description="仅启用段参与内部调用；占位符会按实际出现按需解析。修改后自动保存。">
      <div class="acu-v2-continuation-page__actions acu-v2-continuation-page__actions--start">
        <AcuButton @click="exportPrompts">导出提示词 JSON</AcuButton>
        <AcuButton @click="promptImportInput?.click()">导入提示词 JSON</AcuButton>
        <input ref="promptImportInput" type="file" accept=".json,application/json" class="acu-v2-continuation-page__file-input" @change="onImportPromptsFile" />
      </div>
      <p v-if="promptIoError" class="acu-v2-continuation-page__error">{{ promptIoError }}</p>
      <p v-if="promptIoNotice" class="acu-v2-continuation-page__meta">{{ promptIoNotice }}</p>

      <div class="acu-v2-continuation-page__groups">
        <AcuDisclosureGroup
          v-for="group in promptGroups"
          :key="group.key"
          class="acu-v2-continuation-page__group"
          :label="group.title"
          :meta="promptGroupMeta(group.key)"
          :expanded="isGroupExpanded(`prompt:${group.key}`)"
          :body-id="`acu-continuation-prompt-${group.key}`"
          @toggle="toggleGroup(`prompt:${group.key}`)"
        >
          <AcuPromptSegments
            :segments="promptList(group.key) ?? []"
            :role-options="continuationRoleOptions"
            :show-slot="false"
            :show-enabled="true"
            :allow-move="true"
            @add="position => addPrompt(group.key, position)"
            @delete="index => deletePrompt(group.key, index)"
            @move="(index, delta) => movePrompt(group.key, index, delta)"
            @update="(index, patch) => updatePrompt(group.key, index, patch)"
          />
          <div class="acu-v2-continuation-page__actions"><AcuButton @click="restorePrompt(group.kind)">{{ group.restoreLabel }}</AcuButton></div>
          <p v-if="group.note" class="acu-v2-continuation-page__meta">{{ group.note }}</p>
        </AcuDisclosureGroup>

        <AcuDisclosureGroup
          class="acu-v2-continuation-page__group"
          label="占位符速查"
          meta="参考"
          :expanded="isGroupExpanded('prompt:reference')"
          body-id="acu-continuation-prompt-reference"
          @toggle="toggleGroup('prompt:reference')"
        >
          <h4 class="acu-v2-continuation-page__subheading">大纲子代理</h4>
          <p class="acu-v2-continuation-page__meta">大纲可用占位符：$ORIGIN_INSTRUCTION、$1、$STORY_OVERVIEW（事件概览：纪要表概览全量 + 召回 AM 码展开纪要）、$STORY_TAIL（尾部楼层全文）、$STAGE_HISTORY、$COMPLETED_STAGE_PART、$REPLAN_INSTRUCTION、$TURN_RANGE、$REMAINING_TURNS、$STORY_ARC（故事总纲）、$STAGE_WORD_BUDGET（本阶段字数容量）、$PACING_CONTEXT（跨阶段节奏状态：上一阶段形态与已连续高压轮数）、$VALIDATION_ERRORS。</p>
          <h4 class="acu-v2-continuation-page__subheading">主 Agent</h4>
          <p class="acu-v2-continuation-page__meta">$HISTORY_ANCHOR 标记主 Agent 自己的会话记录（用户输入、它历次迭代的输出、回灌的工具结果与调阅到的资料）插入位置，该段本身不发送；删掉它会让会话记录退回到序列最前面。正文三层注入：$STORY_OVERVIEW（事件概览：纪要表概览全量，召回 AM 码展开对应纪要）、$STORY_TAIL（尾部楼层全文）、$STORY_CATALOG（楼层纯索引：楼号、字数、开头摘录、读取地址）。目录与状态占位符：$OUTLINE_STATE（大纲单行状态）、$WORLDBOOK_CATALOG（已启用世界书目录，含 token 估算）、$WORLDBOOK_HITS（本轮语境命中的世界书条目提示）、$AGENT_READ_CATALOG（read/search 地址词汇表）。其余可用占位符：$USER_INTENT、$CURRENT_TURN_GOAL、$CURRENT_TURN_PACING（本轮节奏与写作约束）、$STORY_ARC_STATE（总纲状态）、$HISTORY_UNSETTLED（未结算正文全量，仅 AI 楼层）、$AGENT_CATALOG、$MODULE_CATALOG、$TABLE_CATALOG、$BUDGET；旧版的 $OUTLINE_WINDOW、$ACTIVE_CONSTRAINTS、$TOOL_RESULTS 仍可在自定义提示词中使用。</p>
          <h4 class="acu-v2-continuation-page__subheading">各子代理</h4>
          <p class="acu-v2-continuation-page__meta">子代理可用占位符：$AGENT_READ_MATERIALS（派工种子读集解析出的资料）、$AGENT_TASK（本次派工任务）、$AGENT_WRITE_SCOPE（职责固定的写入范围）、$AGENT_READ_CATALOG（read/search 地址词汇表）、$STORY_OVERVIEW / $STORY_TAIL / $HISTORY_UNSETTLED（按角色固定注入的正文语境）、$HOOKS_LEDGER / $INFO_GAP / $ACTIVE_CONSTRAINTS / $STORY_ARC / $CHRONOLOGY / $WEB_REFS（本地资料；$WEB_REFS 只给名称 + 一句话简介的预览）、$STORY_CATALOG、$TABLE_CATALOG、$WORLDBOOK_CATALOG、$WORLDBOOK_HITS（各资料目录与命中提示）；网页检索子代理另有 $WEB_TOOL_CATALOG（出网工具说明与本次配额）。固定注入差异：主 Agent、总纲代理、两类策划代理、连续性审查与终审固定获得 $OUTLINE_WINDOW；主 Agent、总纲代理、连续性审查与终审固定获得 $USER_INTENT；大纲代理对应使用 $ORIGIN_INSTRUCTION；伏笔与认知维护代理不接收用户目标或阶段大纲，避免计划污染事实结算。</p>
        </AcuDisclosureGroup>
      </div>
      <p v-if="settingsError" class="acu-v2-continuation-page__error">{{ settingsError }}</p>
    </AcuPanel>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { ContinuationPromptKind_ACU } from '../../service/continuation/prompt-template'; // arch-ok: 仅类型导入，用于本页状态标注，编译后无运行时依赖
import type { ContinuationPromptSegment_ACU, ContinuationSettings_ACU, StageOutline_ACU } from '../../service/continuation/model'; // arch-ok: 仅类型导入，用于本页状态标注，编译后无运行时依赖
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuCheckbox from '../components/_lib/AcuCheckbox.vue';
import AcuDisclosureGroup from '../components/_lib/AcuDisclosureGroup.vue';
import AcuFormRow from '../components/_lib/AcuFormRow.vue';
import AcuInput from '../components/_lib/AcuInput.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import AcuPromptSegments from '../components/_lib/AcuPromptSegments.vue';
import AcuRulePairList from '../components/_lib/AcuRulePairList.vue';
import AcuSelect from '../components/_lib/AcuSelect.vue';
import AcuTextarea from '../components/_lib/AcuTextarea.vue';
import ContinuationChat from '../components/ContinuationChat.vue';
import ContinuationMaterialsPanel from '../components/ContinuationMaterialsPanel.vue';
import { useApiPresetSelectOptions } from '../composables/useApiPresetSelectOptions';
import { useChatChangedTick, useChatMutationTick } from '../composables/useChatChangedListener';
import { CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_UI_ACU, useContinuationRuntime } from '../composables/useContinuationRuntime';
import { useContinuationSession } from '../composables/useContinuationSession';
import { useDialogStore } from '../stores/dialog-store';

const runtime = useContinuationRuntime();
const dialog = useDialogStore();
const session = useContinuationSession();
const { apiStore, followActiveApiLabel, apiPresetSelectOptions: continuationApiPresetOptions } = useApiPresetSelectOptions();
const settingsDraft = ref<ContinuationSettings_ACU | null>(null);
const outlineDraft = ref('');
const messageDraft = ref('');
const messageSending = ref(false);
const outlineDraftError = ref('');
const settingsError = ref('');
const settingsNotice = ref('');
const materialsPanel = ref<InstanceType<typeof ContinuationMaterialsPanel> | null>(null);
const clock = ref(Date.now());
let countdownTimer: ReturnType<typeof setInterval> | undefined;

const stageText = computed(() => {
  const stage = runtime.activeStage.value;
  if (!runtime.task.value) return '尚未创建任务';
  return stage ? `第 ${stage.stageNumber} 阶段` : '大纲待创建';
});

const deadlineText = computed(() => {
  const deadlineAt = runtime.task.value?.deadlineAt;
  if (deadlineAt === null || deadlineAt === undefined) return '未设置';
  const remainingSeconds = Math.max(0, Math.ceil((deadlineAt - clock.value) / 1_000));
  const hours = Math.floor(remainingSeconds / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
});

const continuationApiPresetValue = computed(() => {
  if (!settingsDraft.value) return '';
  return settingsDraft.value.apiPresetMode === 'fixed'
    ? settingsDraft.value.fixedApiPresetName
    : '';
});

function applyContinuationApiPreset(value: string): void {
  if (!settingsDraft.value) return;
  const trimmed = String(value || '').trim();
  if (trimmed) {
    settingsDraft.value.apiPresetMode = 'fixed';
    settingsDraft.value.fixedApiPresetName = trimmed;
  } else {
    settingsDraft.value.apiPresetMode = 'current';
    settingsDraft.value.fixedApiPresetName = '';
  }
  // 渠道选择与填表工作台一致：选择即保存，不等防抖窗口，避免用户离开页面时选择丢失。
  saveSettingsImmediately();
}

const continuationRoleOptions = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'user', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];

const maxConsecutivePressureTurnsMax = CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_UI_ACU;

/** 渠道下拉里「跟随全局默认」的哨兵值：空串已被「跟随当前活动 API」占用。 */
const INHERIT_CHANNEL_VALUE = '__inherit__';

const agentChannelRoles = [
  { role: 'main', label: '主 Agent' },
  { role: 'outline', label: '大纲子代理' },
  { role: 'arcArchitect', label: '故事总纲' },
  { role: 'maintainer', label: '伏笔与认知维护' },
  { role: 'mainlinePlanner', label: '主线推进策划' },
  { role: 'beatPlanner', label: '伏笔与节拍策划' },
  { role: 'reviewer', label: '连续性审查' },
  { role: 'finalReviewer', label: '发送前终审' },
  { role: 'webResearcher', label: '网页检索' },
] as const;

const webSearchProviderOptions = [
  { value: 'duckduckgo', label: 'DuckDuckGo（免 key）' },
  { value: 'serper', label: 'Serper（Google，需酒馆已配 key）' },
  { value: 'tavily', label: 'Tavily（需酒馆已配 key）' },
  { value: 'searxng', label: 'SearXNG（自建/公共实例）' },
];

type AgentChannelRole = typeof agentChannelRoles[number]['role'];

/** 折叠分组的展开状态：默认全部收起，只在本次打开面板期间记忆。 */
const expandedGroups = reactive<Record<string, boolean>>({});

function isGroupExpanded(key: string): boolean {
  return expandedGroups[key] === true;
}

function toggleGroup(key: string): void {
  expandedGroups[key] = !isGroupExpanded(key);
}

/** 折叠态下的一行摘要：让用户不展开也能看到关键取值。 */
const runGroupMeta = computed(() => {
  const s = settingsDraft.value;
  if (!s) return '';
  return `阶段上限 ${s.maxAutomaticStages} · 正文重试 ${s.generationRetryLimit} 次`;
});

const contextGroupMeta = computed(() => {
  const s = settingsDraft.value;
  if (!s) return '';
  return `窗口 ${s.storyWindowFloors} 楼 · 总结阈值 ${s.agentHistoryTokenBudget}`;
});

const budgetGroupMeta = computed(() => {
  const s = settingsDraft.value;
  if (!s) return '';
  return `迭代 ${s.agentRunBudget.maxIterations} · 派工 ${s.agentRunBudget.maxDelegations} · 并发 ${s.agentRunBudget.maxConcurrent}`;
});

const finalReviewGroupMeta = computed(() => (settingsDraft.value?.finalReview.enabled ? '已开启' : '已关闭'));

const webResearchGroupMeta = computed(() => {
  const web = settingsDraft.value?.webResearch;
  if (!web) return '';
  if (!web.enabled) return '已关闭';
  const sources = [web.sources.moegirl && '萌娘', web.sources.wikipediaZh && '中文维基', web.sources.wikipediaEn && '英文维基', web.sources.baidu && '百度'].filter(Boolean);
  return `已开启 · ${sources.length ? sources.join('/') : '无百科来源'} · ${web.searchProvider}`;
});

const channelGroupMeta = computed(() => {
  const presets = settingsDraft.value?.agentApiPresets;
  if (!presets) return '';
  const customized = agentChannelRoles.filter(channel => presets[channel.role]?.mode !== 'inherit').length;
  return customized ? `${customized} 个单独指定` : '全部跟随默认';
});

const rulesGroupMeta = computed(() => {
  const s = settingsDraft.value;
  if (!s) return '';
  return `提取 ${s.contextExtractRules.length} · 排除 ${s.contextExcludeRules.length}`;
});

const agentChannelOptions = computed(() => [
  { value: INHERIT_CHANNEL_VALUE, label: '跟随全局默认' },
  ...continuationApiPresetOptions.value,
]);

function agentChannelValue(role: AgentChannelRole): string {
  const choice = settingsDraft.value?.agentApiPresets?.[role];
  if (!choice || choice.mode === 'inherit') return INHERIT_CHANNEL_VALUE;
  return choice.mode === 'fixed' ? choice.presetName : '';
}

function applyAgentChannel(role: AgentChannelRole, value: string): void {
  if (!settingsDraft.value) return;
  const trimmed = String(value ?? '').trim();
  if (trimmed === INHERIT_CHANNEL_VALUE) {
    settingsDraft.value.agentApiPresets[role] = { mode: 'inherit', presetName: '' };
  } else if (trimmed) {
    settingsDraft.value.agentApiPresets[role] = { mode: 'fixed', presetName: trimmed };
  } else {
    settingsDraft.value.agentApiPresets[role] = { mode: 'current', presetName: '' };
  }
  saveSettingsImmediately();
}

/** 立即触发保存：先取消挂起的防抖计时器再保存，保证渠道类改动不受 800ms 窗口影响。 */
function saveSettingsImmediately(): void {
  if (settingsSaveTimer !== undefined) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = undefined;
  }
  void saveSettingsNow();
}

function cloneSettings(settings: ContinuationSettings_ACU): ContinuationSettings_ACU {
  return {
    ...settings,
    contextExtractRules: settings.contextExtractRules.map(rule => ({ ...rule })),
    contextExcludeRules: settings.contextExcludeRules.map(rule => ({ ...rule })),
    agentRunBudget: { ...settings.agentRunBudget },
    finalReview: { ...settings.finalReview },
    webResearch: { ...settings.webResearch, sources: { ...settings.webResearch.sources } },
    agentApiPresets: {
      main: { ...settings.agentApiPresets.main },
      outline: { ...settings.agentApiPresets.outline },
      arcArchitect: { ...settings.agentApiPresets.arcArchitect },
      maintainer: { ...settings.agentApiPresets.maintainer },
      mainlinePlanner: { ...settings.agentApiPresets.mainlinePlanner },
      beatPlanner: { ...settings.agentApiPresets.beatPlanner },
      reviewer: { ...settings.agentApiPresets.reviewer },
      finalReviewer: { ...settings.agentApiPresets.finalReviewer },
      webResearcher: { ...settings.agentApiPresets.webResearcher },
    },
    outlinePrompt: settings.outlinePrompt.map(segment => ({ ...segment })),
    agentPrompts: {
      main: settings.agentPrompts.main.map(segment => ({ ...segment })),
      arcArchitect: settings.agentPrompts.arcArchitect.map(segment => ({ ...segment })),
      maintainer: settings.agentPrompts.maintainer.map(segment => ({ ...segment })),
      mainlinePlanner: settings.agentPrompts.mainlinePlanner.map(segment => ({ ...segment })),
      beatPlanner: settings.agentPrompts.beatPlanner.map(segment => ({ ...segment })),
      reviewer: settings.agentPrompts.reviewer.map(segment => ({ ...segment })),
      finalReviewer: settings.agentPrompts.finalReviewer.map(segment => ({ ...segment })),
      webResearcher: settings.agentPrompts.webResearcher.map(segment => ({ ...segment })),
    },
  };
}

function syncOutlineDraft(): void {
  outlineDraft.value = runtime.activeRevision.value
    ? JSON.stringify(runtime.activeRevision.value.outline, null, 2)
    : '';
  outlineDraftError.value = '';
}

function parseOutlineDraft(): StageOutline_ACU | null {
  try {
    const parsed: unknown = JSON.parse(outlineDraft.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('大纲必须是 JSON 对象');
    return parsed as StageOutline_ACU;
  } catch (error) {
    outlineDraftError.value = error instanceof Error ? error.message : '大纲 JSON 无法解析';
    return null;
  }
}

async function acceptOutlineDraft(): Promise<void> {
  const outline = parseOutlineDraft();
  if (!outline) return;
  if (await runtime.acceptOutline(outline)) syncOutlineDraft();
}

/** 首次发送（即将创建任务）前的高 RPM 风险确认：5 秒倒计时结束前只能取消。 */
async function confirmFirstSendRpmWarning(): Promise<boolean> {
  return dialog.confirm({
    title: '开始智能续写前请确认',
    message: '本功能单次请求占用的 Token 不多，但 Agent 会连续发起大量请求，需要 API 支持很高的 RPM（每分钟请求数）。',
    dangerMessage: '禁止使用任何公益站，除非它明确表示允许 coding（本功能的请求模式与 coding 类似）。违规使用可能导致账号被封禁。',
    confirmLabel: '我已了解，开始',
    cancelLabel: '取消',
    confirmVariant: 'danger',
    confirmCountdownSeconds: 5,
  });
}

/** 会话发送：没有任务时创建任务，运行中会打断当前迭代并带着这句话重新开始。 */
async function sendMessage(text: string): Promise<void> {
  if (messageSending.value) return;
  // 仅在本次发送将创建新任务（首次发送）时弹确认框；取消则保留草稿不发送。
  if (!runtime.task.value && !(await confirmFirstSendRpmWarning())) return;
  if (messageSending.value) return;
  messageSending.value = true;
  try {
    const accepted = await runtime.sendAgentMessage(text);
    if (accepted && messageDraft.value.trim() === text) messageDraft.value = '';
  } finally {
    messageSending.value = false;
  }
}

/** 用户手动改写的大纲保存成功后刷新资料面板，让它读到新的 revision。 */
async function saveOutline(outline: StageOutline_ACU): Promise<void> {
  if (await runtime.saveActiveOutline(outline)) materialsPanel.value?.reload();
}

async function clearData(): Promise<void> {
  if (await runtime.clearData()) materialsPanel.value?.reload();
}

function requiredInteger(value: unknown, label: string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric)) throw new Error(`${label} 必须是整数`);
  return numeric;
}

/** 有上界的整数设置；空串与 NaN 会让落盘校验报「字段必须是整数」，在这里先拦成可读提示。 */
function requiredBoundedInteger(value: unknown, label: string, maximum: number): number {
  return requiredRangeInteger(value, label, 0, maximum);
}

/** 上下界俱全的整数设置，用于 Agent 运行预算等有护栏的字段。 */
function requiredRangeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) throw new Error(`${label} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  return numeric;
}

/** 读取预算接受两种形态：正整数（固定 token 数）或 1%-100% 的百分比串（按总结阈值折算）。 */
function normalizedReadBudget(value: unknown): number | string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('读取预算不能为空');
  if (raw.endsWith('%')) {
    const percent = Number.parseFloat(raw);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) throw new Error('读取预算百分比必须在 1% 到 100% 之间');
    return `${percent}%`;
  }
  const fixed = Number(raw);
  if (!Number.isInteger(fixed) || fixed < 1) throw new Error('读取上限必须是正整数，或形如 20% 的百分比');
  return fixed;
}

function normalizeSettingsDraft(): ContinuationSettings_ACU {
  if (!settingsDraft.value) throw new Error('续写设置尚未加载');
  const source = settingsDraft.value;
  const customTurnMin = source.stageSize === 'custom' ? requiredInteger(source.customTurnMin, '最少轮次') : null;
  const customTurnMax = source.stageSize === 'custom' ? requiredInteger(source.customTurnMax, '最多轮次') : null;
  const customStoryArcVolumeCount = source.storyArcVolumePlan === 'custom'
    ? requiredInteger(source.customStoryArcVolumeCount, '自定义总纲卷数')
    : null;
  if (source.stageSize === 'custom' && (customTurnMin < 1 || customTurnMax < customTurnMin || customTurnMax > 50)) {
    throw new Error('自定义阶段轮次必须是 1 到 50 的递增整数范围');
  }
  if (source.storyArcVolumePlan === 'custom' && (customStoryArcVolumeCount < 1 || customStoryArcVolumeCount > 50)) {
    throw new Error('自定义总纲卷数必须是 1 到 50 的整数');
  }
  const normalized = {
    ...cloneSettings(source),
    customTurnMin,
    customTurnMax,
    customStoryArcVolumeCount,
    maxAutomaticStages: requiredInteger(source.maxAutomaticStages, '自动阶段上限'),
    generationRetryLimit: requiredInteger(source.generationRetryLimit, '正文重试次数'),
    minGenerationTokens: requiredInteger(source.minGenerationTokens, '正文最低 token 数'),
    internalAiRetryLimit: requiredInteger(source.internalAiRetryLimit, '内部 AI 重试次数'),
    loopDelaySeconds: requiredInteger(source.loopDelaySeconds, '轮次延迟'),
    retryDelaySeconds: requiredInteger(source.retryDelaySeconds, '重试延迟'),
    totalDurationMinutes: requiredInteger(source.totalDurationMinutes, '总时长'),
    maxConsecutivePressureTurns: requiredBoundedInteger(source.maxConsecutivePressureTurns, '连续高压轮上限', CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_UI_ACU),
    storyWindowFloors: requiredInteger(source.storyWindowFloors, '正文可读窗口楼数'),
    storyTailFloors: requiredInteger(source.storyTailFloors, '正文目录尾部全文楼数'),
    agentHistoryTokenBudget: requiredInteger(source.agentHistoryTokenBudget, '会话自动总结阈值'),
    agentReadTokenBudget: normalizedReadBudget(source.agentReadTokenBudget),
    agentReadFallbackTokens: requiredInteger(source.agentReadFallbackTokens, '临近总结时的精读额度'),
    finalReview: {
      enabled: source.finalReview.enabled,
      readTokenBudget: normalizedReadBudget(source.finalReview.readTokenBudget),
      maxExtraReads: requiredRangeInteger(source.finalReview.maxExtraReads, '终审额外读取轮数', 0, 10),
    },
    webResearch: {
      enabled: source.webResearch.enabled,
      sources: { ...source.webResearch.sources },
      searchProvider: source.webResearch.searchProvider,
      searxngBaseUrl: String(source.webResearch.searxngBaseUrl ?? '').trim(),
      maxToolRounds: requiredRangeInteger(source.webResearch.maxToolRounds, '网页检索单次工具轮上限', 1, 20),
      maxPages: requiredRangeInteger(source.webResearch.maxPages, '网页检索单次抓取页数上限', 1, 30),
      pageCharLimit: requiredRangeInteger(source.webResearch.pageCharLimit, '网页检索单页阅读字数上限', 500, 20000),
      blockedDomains: String(source.webResearch.blockedDomains ?? ''),
    },
    agentRunBudget: {
      maxIterations: requiredRangeInteger(source.agentRunBudget.maxIterations, '主 Agent 迭代上限', 1, 30),
      maxDelegations: requiredRangeInteger(source.agentRunBudget.maxDelegations, '派工总数上限', 0, 20),
      maxSameAgent: requiredRangeInteger(source.agentRunBudget.maxSameAgent, '单代理派工上限', 1, 10),
      maxConcurrent: requiredRangeInteger(source.agentRunBudget.maxConcurrent, '并发派工上限', 1, 6),
      maxReads: requiredRangeInteger(source.agentRunBudget.maxReads, '读取批次上限', 0, 30),
      maxExtraReads: requiredRangeInteger(source.agentRunBudget.maxExtraReads, '子代理工具轮上限', 0, 10),
    },
  };
  if (normalized.maxAutomaticStages < 1 || normalized.generationRetryLimit < 0 || normalized.minGenerationTokens < 0 || normalized.internalAiRetryLimit < 0 || normalized.loopDelaySeconds < 0 || normalized.retryDelaySeconds < 0 || normalized.totalDurationMinutes < 0 || normalized.storyWindowFloors < 0 || normalized.storyTailFloors < 0 || normalized.agentHistoryTokenBudget < 0 || normalized.agentReadFallbackTokens < 1) {
    throw new Error('续写设置中的数值不能低于允许范围');
  }
  if (normalized.webResearch.enabled && normalized.webResearch.searchProvider === 'searxng' && !normalized.webResearch.searxngBaseUrl) {
    throw new Error('搜索引擎选择 SearXNG 时必须填写实例地址');
  }
  if (normalized.apiPresetMode === 'fixed') {
    const presetName = normalized.fixedApiPresetName.trim();
    if (!presetName) throw new Error('固定 API 预设名称不能为空');
    if (!presetExists(presetName)) throw new Error(`API 预设 "${presetName}" 不存在，请重新选择`);
  }
  for (const channel of agentChannelRoles) {
    const choice = normalized.agentApiPresets[channel.role];
    if (choice.mode !== 'fixed') continue;
    const presetName = choice.presetName.trim();
    if (!presetName) throw new Error(`${channel.label} 的固定渠道必须选择预设`);
    if (!presetExists(presetName)) throw new Error(`${channel.label} 渠道的 API 预设 "${presetName}" 不存在，请重新选择`);
  }
  return normalized;
}

/**
 * 判断预设名是否存在于当前 API 预设列表中。
 * 保存前校验存在性，把悬挂引用（预设已被删除）从运行中途的任务失败提前到保存时报错。
 */
function presetExists(presetName: string): boolean {
  return apiStore.presets.some(preset => preset.name === presetName);
}

/** 记录最近一次从权威状态装载/保存成功的草稿快照，用于跳过无变化的自动保存并切断"保存→刷新→重建草稿"的循环。 */
let lastPersistedSettingsJson = '';
let settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;

/** 设置修改后自动保存（防抖 800ms），与剧情推进/填表工作台的"改动即生效"一致。 */
function scheduleSettingsSave(): void {
  if (settingsSaveTimer !== undefined) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => { void saveSettingsNow(); }, 800);
}

async function saveSettingsNow(): Promise<void> {
  if (!settingsDraft.value) return;
  if (JSON.stringify(settingsDraft.value) === lastPersistedSettingsJson) return;
  if (runtime.busy.value) {
    // 有续写操作正在执行时不抢租约，稍后重试本次保存。
    scheduleSettingsSave();
    return;
  }
  let candidate: ContinuationSettings_ACU;
  try {
    apiStore.refreshFromSettings();
    candidate = normalizeSettingsDraft();
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : '续写设置无效';
    return;
  }
  const outcome = await runtime.saveSettings(candidate);
  if (outcome === 'saved') {
    settingsError.value = '';
    settingsNotice.value = '';
  } else if (outcome === 'busy') {
    // Agent 正在规划，改动不能丢：告知用户并排队等空档（如等待宿主正文时）落盘。
    settingsNotice.value = '设置已修改：Agent 正在运行，将在本轮空档自动保存并于下一轮生效。';
    scheduleSettingsSave();
  }
}

type PromptKey = 'outlinePrompt' | 'main' | 'arcArchitect' | 'maintainer' | 'mainlinePlanner' | 'beatPlanner' | 'reviewer' | 'finalReviewer' | 'webResearcher';

interface PromptGroupDef {
  key: PromptKey;
  kind: ContinuationPromptKind_ACU;
  title: string;
  restoreLabel: string;
  /** 只属于该组的补充说明；通用占位符收在「占位符速查」里。 */
  note?: string;
}

const promptGroups: PromptGroupDef[] = [
  { key: 'outlinePrompt', kind: 'outline', title: '大纲子代理（outline-architect）提示词', restoreLabel: '恢复大纲提示词默认值' },
  { key: 'main', kind: 'agent_main', title: '主 Agent 提示词', restoreLabel: '恢复主 Agent 默认值', note: '$HISTORY_ANCHOR 段标记会话记录的插入位置，本身不发送；删掉它会让会话记录退回到序列最前面。' },
  { key: 'arcArchitect', kind: 'agent_arc', title: '故事总纲子代理（arc-architect）提示词', restoreLabel: '恢复总纲子代理默认值' },
  { key: 'maintainer', kind: 'agent_maintainer', title: '伏笔与认知维护子代理提示词', restoreLabel: '恢复维护子代理默认值', note: '该代理不接收用户目标或阶段大纲，避免计划污染事实结算。' },
  { key: 'mainlinePlanner', kind: 'agent_mainline', title: '主线推进策划子代理提示词', restoreLabel: '恢复主线策划默认值' },
  { key: 'beatPlanner', kind: 'agent_beat', title: '伏笔与节拍策划子代理提示词', restoreLabel: '恢复节拍策划默认值' },
  { key: 'reviewer', kind: 'agent_reviewer', title: '连续性审查子代理提示词', restoreLabel: '恢复审查子代理默认值' },
  { key: 'finalReviewer', kind: 'agent_final_reviewer', title: '发送前终审子代理提示词', restoreLabel: '恢复终审子代理默认值', note: '仅在「启用发送前世界书终审」开启时才会被调用。' },
  { key: 'webResearcher', kind: 'agent_web_researcher', title: '网页检索子代理（web-researcher）提示词', restoreLabel: '恢复网页检索默认值', note: '仅在「启用开场百科检索」开启时才会被调用。专属占位符：$WEB_TOOL_CATALOG（出网工具说明与本次配额）、$WEB_REFS（百科资料库预览）。' },
];

/** 折叠态摘要：启用段数 / 总段数。 */
function promptGroupMeta(key: PromptKey): string {
  const prompts = promptList(key);
  if (!prompts) return '';
  const enabled = prompts.filter(segment => segment.enabled !== false).length;
  return `${enabled}/${prompts.length} 段启用`;
}

/** 取出指定提示词组的数组。大纲组在设置根层，其余 Agent 提示词在 agentPrompts 下。 */
function promptList(key: PromptKey): ContinuationPromptSegment_ACU[] | null {
  if (!settingsDraft.value) return null;
  if (key === 'outlinePrompt') return settingsDraft.value.outlinePrompt;
  return settingsDraft.value.agentPrompts[key];
}

function addPrompt(key: PromptKey, position: 'top' | 'bottom' = 'bottom'): void {
  const prompts = promptList(key);
  if (!prompts) return;
  const segment: ContinuationPromptSegment_ACU = { role: 'user', content: '请填写提示词内容。', enabled: true, deletable: true };
  if (position === 'top') prompts.unshift(segment);
  else prompts.push(segment);
}

function deletePrompt(key: PromptKey, index: number): void {
  const prompts = promptList(key);
  if (!prompts || prompts[index]?.deletable === false) return;
  prompts.splice(index, 1);
}

function movePrompt(key: PromptKey, index: number, delta: -1 | 1): void {
  const prompts = promptList(key);
  const target = index + delta;
  if (!prompts || target < 0 || target >= prompts.length) return;
  [prompts[index], prompts[target]] = [prompts[target], prompts[index]];
}

function updatePrompt(key: PromptKey, index: number, patch: Partial<ContinuationPromptSegment_ACU>): void {
  const prompts = promptList(key);
  const current = prompts?.[index];
  if (prompts && current) prompts[index] = { ...current, ...patch };
}

function restorePrompt(kind: ContinuationPromptKind_ACU): void {
  if (!settingsDraft.value) return;
  settingsDraft.value = runtime.restorePromptDefault(settingsDraft.value, kind);
}

const promptImportInput = ref<HTMLInputElement | null>(null);
const promptIoError = ref('');
const promptIoNotice = ref('');

/** 导出全部提示词（大纲组 + 五组 Agent）为 JSON 文件下载。 */
function exportPrompts(): void {
  if (!settingsDraft.value) return;
  promptIoError.value = '';
  try {
    const source = cloneSettings(settingsDraft.value);
    const bundle = { version: 1, outlinePrompt: source.outlinePrompt, agentPrompts: source.agentPrompts };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'acu-continuation-prompts.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    promptIoNotice.value = '提示词 JSON 已导出。';
  } catch (error) {
    promptIoError.value = error instanceof Error ? error.message : '提示词导出失败。';
  }
}

/** 导入提示词 JSON：逐组校验通过后整体写入草稿并立即保存，任何一组失败即整体拒绝。 */
async function onImportPromptsFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 允许连续选择同一个文件重复导入。
  input.value = '';
  if (!file || !settingsDraft.value) return;
  promptIoError.value = '';
  promptIoNotice.value = '';
  try {
    const bundle = runtime.parsePromptBundle(await file.text());
    settingsDraft.value.outlinePrompt = bundle.outlinePrompt;
    settingsDraft.value.agentPrompts = bundle.agentPrompts;
    saveSettingsImmediately();
    promptIoNotice.value = '提示词 JSON 已导入并保存。';
  } catch (error) {
    promptIoError.value = error instanceof Error ? error.message : '提示词 JSON 读取失败。';
  }
}

/** 刷新页面依赖的全部数据源：API 预设列表必须在挂载与聊天切换时重新读取，否则预设下拉是空的。 */
function refreshAll(): void {
  apiStore.refreshFromSettings();
  runtime.refresh();
  // 会话流是全局内存：切聊天必须清空并从新聊天的持久会话回灌，否则显示的是上一个聊天的记录。
  session.rehydrate();
}

/**
 * 当前聊天内楼层被删除 / swipe 后：任务游标、Agent 会话与资料快照都锚定在楼层上，
 * 存储层已随楼层回退，页面必须重读一遍，否则进度、会话流、资料仍停在删楼前。
 */
function refreshAfterChatMutation(): void {
  runtime.refresh();
  session.resyncAfterChatMutation();
  materialsPanel.value?.reload();
}

onMounted(() => {
  apiStore.refreshFromSettings();
  void runtime.initialize();
  countdownTimer = setInterval(() => { clock.value = Date.now(); }, 1_000);
});
onBeforeUnmount(() => {
  if (countdownTimer !== undefined) clearInterval(countdownTimer);
  // 防抖窗口内离开页面时冲刷一次未落盘的改动，避免"改了像改了、重进没了"。
  if (settingsSaveTimer !== undefined) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = undefined;
    void saveSettingsNow();
  }
});
watch(useChatChangedTick(), refreshAll);
watch(useChatMutationTick(), refreshAfterChatMutation);
watch(runtime.settings, settings => {
  // 每次刷新信封都会产生新的 settings 引用；只有持久化内容真的变了（保存成功、切换聊天）
  // 才重建草稿。否则运行期间的每次状态刷新都会把用户尚未保存的改动悄悄冲掉。
  const persistedJson = settings ? JSON.stringify(cloneSettings(settings)) : '';
  if (persistedJson === lastPersistedSettingsJson && settingsDraft.value) return;
  settingsDraft.value = settings ? cloneSettings(settings) : null;
  lastPersistedSettingsJson = persistedJson;
}, { immediate: true });
watch(settingsDraft, () => {
  if (!settingsDraft.value) return;
  if (JSON.stringify(settingsDraft.value) === lastPersistedSettingsJson) return;
  scheduleSettingsSave();
}, { deep: true });
watch(() => `${runtime.activeStage.value?.stageId ?? ''}:${runtime.activeRevision.value?.revision ?? ''}`, syncOutlineDraft, { immediate: true });
</script>

<style scoped>
.acu-v2-continuation-page { min-height: 100%; padding: 20px; display: grid; gap: 18px; }
.acu-v2-continuation-page__layout { align-items: start; }
.acu-v2-continuation-page__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.acu-v2-continuation-page__actions--start { justify-content: flex-start; margin-top: 0; margin-bottom: 12px; }
.acu-v2-continuation-page__file-input { display: none; }
.acu-v2-continuation-page__error { color: var(--acu-danger, #d65b5b); white-space: pre-wrap; }
.acu-v2-continuation-page__meta { color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-continuation-page__settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
.acu-v2-continuation-page__settings-grid label { display: grid; gap: 5px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-page__settings-grid select { min-height: 30px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 30%, transparent); border-radius: 4px; background: var(--acu-bg-2); color: var(--acu-text-1); }
.acu-v2-continuation-page__toggles { display: flex; flex-wrap: wrap; gap: 14px; margin: 14px 0; }
.acu-v2-continuation-page__groups { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.acu-v2-continuation-page__group {
  border: 1px solid var(--acu-border, color-mix(in srgb, var(--acu-text-3) 18%, transparent));
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-bg-2) 72%, transparent);
}
.acu-v2-continuation-page__group :deep(.acu-disclosure-group__header) { border-radius: var(--acu-radius-sm); }
.acu-v2-continuation-page__group :deep(.acu-disclosure-group--expanded .acu-disclosure-group__header) { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.acu-v2-continuation-page__group :deep(.acu-disclosure-group__body) { gap: 12px; padding: 12px; }
.acu-v2-continuation-page__group :deep(.acu-disclosure-group__meta) { max-width: 55%; overflow: hidden; text-overflow: ellipsis; }
.acu-v2-continuation-page__group .acu-v2-continuation-page__actions { margin-top: 0; }
.acu-v2-continuation-page__subheading { margin: 4px 0 0; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); font-weight: 600; }
.acu-v2-continuation-page__subheading:first-child { margin-top: 0; }
@media (max-width: 860px) { .acu-v2-continuation-page { padding: 14px; } }
@media (max-width: 640px) {
  .acu-v2-continuation-page { padding: 10px; gap: 12px; }
  .acu-v2-continuation-page__settings-grid { grid-template-columns: 1fr; }
  .acu-v2-continuation-page__actions > * { flex: 1 1 auto; }
  .acu-v2-continuation-page__group :deep(.acu-disclosure-group__meta) { display: none; }
}
</style>
