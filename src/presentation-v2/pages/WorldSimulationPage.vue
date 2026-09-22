<template>
  <section class="acu-v2-world-simulation-page">
    <AcuPanel title="Agent 会话" description="像和 coding agent 对话一样使用：随时输入、随时打断。主 Agent 按需派工子代理取证与改写，最终账本经审核后严格写入任务开始时冻结的 assistant 楼层；正文生成完成后也会自动推演一次。">
      <p v-if="runtime.error.value" class="acu-v2-world-simulation-page__error">
        {{ runtime.error.value }}
        <AcuButton size="sm" @click="refreshAll">重新读取</AcuButton>
      </p>
      <p v-else-if="!runtime.ready.value" class="acu-v2-world-simulation-page__meta">正在读取并验证世界推演快照…</p>
      <WorldSimulationChat
        v-else
        :task="runtime.task.value"
        :last-error="runtime.envelope.value?.lastError ?? null"
        :entries="runtime.entries.value"
        :running="runtime.running.value"
        :draft="messageDraft"
        :sending="messageSending"
        :status-text="runtime.statusText.value"
        :stage-text="runtime.stageText.value"
        :revision-text="runtime.revisionText.value"
        :anchor-text="runtime.anchorText.value"
        @send="sendMessage"
        @update:draft="messageDraft = $event"
        @stop="runtime.stop"
      />
    </AcuPanel>

    <!-- 会话独占整宽，资料与设置并列在其下：会话是主操作面，资料与设置是查阅面。 -->
    <AcuPanelGrid class="acu-v2-world-simulation-page__layout">
      <AcuPanel title="已有资料" description="当前分支的用户要求、世界账本、编年对照、错过清单、传闻队列、候选轨迹、投影预览与读取诊断；用户要求可在资料区手动修正，账本只由 Agent 经审核后写入。一键清空只丢任务、会话记录与楼层资料快照，不动正文。">
        <WorldSimulationMaterialsPanel
          v-if="runtime.ready.value && runtime.snapshot.value"
          :conversation="runtime.snapshot.value.conversation"
          :materials="runtime.snapshot.value.materials"
          :user-requirements="runtime.snapshot.value.userRequirements"
          :session="runtime.entries.value"
          :ledger="runtime.snapshot.value.envelope?.ledger ?? null"
          :anchor="runtime.anchor.value"
          :projection-preview="runtime.snapshot.value.projectionPreview"
          :busy="runtime.busy.value"
          :timeline="runtime.envelope.value?.timeline ?? []"
          @refresh="refreshAll"
          @clear="clearData"
          @repair="runtime.repairPendingMaterials"
          @save-user-requirements="saveUserRequirements"
        />
        <p v-else class="acu-v2-world-simulation-page__meta">当前没有可显示的世界推演资料。</p>
      </AcuPanel>

      <AcuPanel v-if="settingsDraft" title="推演设置" description="修改后自动保存；任务运行中也可以改，改动会在本轮结束后落盘、下一轮开始时生效。常用项直接可见，其余参数按主题折叠。">
        <div class="acu-v2-world-simulation-page__settings-grid">
          <AcuFormRow label="API 预设（全局默认）" hint="所有 Agent 默认走这个预设；需要给某个 Agent 单独指定时，展开下方「各 Agent 渠道」。">
            <AcuSelect
              :options="apiPresetOptions"
              :model-value="apiPresetValue"
              :placeholder="followActiveApiLabel"
              @update:model-value="applyApiPreset"
            />
          </AcuFormRow>
          <AcuFormRow label="会话自动总结阈值（token）" hint="按主 Agent 实际读取的完整上下文统计，超过后把最早轮次浓缩成交接报告；0 为不总结。">
            <AcuInput v-model="settingsDraft.agentHistoryTokenBudget" type="number" :min="0" :max="1000000" />
          </AcuFormRow>
          <AcuFormRow label="单批次读取上限" hint="一次 read/search 工具批次最多可注入多少 token；超过整批打回。填正整数或形如 20% 的百分比（按总结阈值折算）。">
            <AcuInput v-model="settingsDraft.agentReadTokenBudget" type="text" />
          </AcuFormRow>
          <AcuFormRow label="临近总结时的精读额度（token）" hint="上下文即将触发总结时，只有不超过此大小的单批次读取会放行。">
            <AcuInput v-model="settingsDraft.agentReadFallbackTokens" type="number" :min="0" :max="100000" />
          </AcuFormRow>
        </div>
        <div class="acu-v2-world-simulation-page__toggles">
          <AcuCheckbox v-model="settingsDraft.autoTriggerEnabled" label="正文生成完成后自动推演（与自动填表同一时机）" />
          <AcuCheckbox v-model="settingsDraft.workflow.autoFixEnabled" label="自动修复违规模块（连续失败 3 次后交给主 Agent）" />
          <AcuCheckbox v-model="settingsDraft.webResearch.enabled" label="启用设定研究（外部百科检索）" />
        </div>

        <div class="acu-v2-world-simulation-page__groups">
          <AcuDisclosureGroup
            class="acu-v2-world-simulation-page__group"
            label="Agent 运行预算"
            :meta="budgetGroupMeta"
            :expanded="isGroupExpanded('budget')"
            body-id="acu-world-simulation-group-budget"
            @toggle="toggleGroup('budget')"
          >
            <div class="acu-v2-world-simulation-page__settings-grid">
              <AcuFormRow label="主 Agent 迭代上限" hint="一次推演内主 Agent 最多做多少次决策（取证/派工/收敛各算一次）。范围 1–100。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxIterations" type="number" :min="1" :max="100" />
              </AcuFormRow>
              <AcuFormRow label="派工总数上限" hint="一次推演内最多派出多少个子代理任务，0 为禁止派工。范围 0–100。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxDelegations" type="number" :min="0" :max="100" />
              </AcuFormRow>
              <AcuFormRow label="单代理派工上限" hint="同一个子代理在一次推演内最多被派几次。范围 0–20。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxSameAgent" type="number" :min="0" :max="20" />
              </AcuFormRow>
              <AcuFormRow label="并发派工上限" hint="同一波次最多同时运行几个子代理；默认 5。API 限流严格时调小。范围 1–20。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxConcurrent" type="number" :min="1" :max="20" />
              </AcuFormRow>
              <AcuFormRow label="读取批次上限" hint="主 Agent 一次推演内 read/search 工具批次的次数上限，0 为禁止读取。范围 0–200。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxReads" type="number" :min="0" :max="200" />
              </AcuFormRow>
              <AcuFormRow label="子代理工具轮上限" hint="子代理首轮之外还允许几轮 read/search 追加读取。范围 0–20。">
                <AcuInput v-model="settingsDraft.agentRunBudget.maxExtraReads" type="number" :min="0" :max="20" />
              </AcuFormRow>
            </div>
          </AcuDisclosureGroup>

          <AcuDisclosureGroup
            class="acu-v2-world-simulation-page__group"
            label="设定研究（网页检索）"
            :meta="webResearchGroupMeta"
            :expanded="isGroupExpanded('webResearch')"
            body-id="acu-world-simulation-group-web-research"
            @toggle="toggleGroup('webResearch')"
          >
            <p class="acu-v2-world-simulation-page__meta">开启后，主 Agent 在本地证据不足时可派工 lore-researcher 从勾选的百科补充公开设定资料；研究结果只作证据，不直接写入世界账本。</p>
            <div class="acu-v2-world-simulation-page__toggles">
              <AcuCheckbox v-model="settingsDraft.webResearch.sources.moegirl" label="萌娘百科" />
              <AcuCheckbox v-model="settingsDraft.webResearch.sources.wikipediaZh" label="中文维基百科" />
              <AcuCheckbox v-model="settingsDraft.webResearch.sources.wikipediaEn" label="英文维基百科" />
            </div>
            <div class="acu-v2-world-simulation-page__settings-grid">
              <AcuFormRow label="搜索引擎" hint="百科查不到时的兜底搜索。DuckDuckGo 免 key；Serper / Tavily 使用酒馆「API 密钥」里已配置的 key；SearXNG 需填实例地址。">
                <AcuSelect v-model="settingsDraft.webResearch.searchProvider" :options="webSearchProviderOptions" />
              </AcuFormRow>
              <AcuFormRow v-if="settingsDraft.webResearch.searchProvider === 'searxng'" label="SearXNG 实例地址" hint="形如 https://searx.example.org">
                <AcuInput v-model="settingsDraft.webResearch.searxngBaseUrl" type="text" />
              </AcuFormRow>
              <AcuFormRow label="单页阅读字数上限" hint="研究子代理可读取的单页正文上限；正文不保存。范围 500–20000。">
                <AcuInput v-model="settingsDraft.webResearch.pageCharLimit" type="number" :min="500" :max="20000" />
              </AcuFormRow>
              <AcuFormRow label="域名黑名单" hint="不得抓取的域名，逗号或换行分隔；内网与酒馆自身始终被拦。">
                <AcuTextarea v-model="settingsDraft.webResearch.blockedDomains" :rows="3" />
              </AcuFormRow>
            </div>
          </AcuDisclosureGroup>

          <AcuDisclosureGroup
            class="acu-v2-world-simulation-page__group"
            label="世界动态"
            :meta="dynamicsGroupMeta"
            :expanded="isGroupExpanded('dynamics')"
            body-id="acu-world-simulation-group-dynamics"
            @toggle="toggleGroup('dynamics')"
          >
            <p class="acu-v2-world-simulation-page__meta">控制传闻时效、时钟推进上限、碰撞兑现与过期清扫；改动在下一轮推演生效。</p>
            <div class="acu-v2-world-simulation-page__settings-grid">
              <AcuFormRow label="传闻等待上限（世界日）" hint="传闻进入待命后，等待玩家命中渠道的世界日上限。范围 1–3650。">
                <AcuInput v-model="settingsDraft.dynamics.rumorTTLDays" type="number" :min="1" :max="3650" />
              </AcuFormRow>
              <AcuFormRow label="单次时钟推进上限（世界日）" hint="一次提交允许推进的天数；超过则必须附带证据。范围 0–3650。">
                <AcuInput v-model="settingsDraft.dynamics.maxClockAdvanceDays" type="number" :min="0" :max="3650" />
              </AcuFormRow>
              <AcuFormRow label="碰撞兑现策略" hint="严格：撞上必须有当场反应，否则拒绝提交。宽松：只记警告。">
                <AcuSelect v-model="settingsDraft.dynamics.collisionEnforcement" :options="collisionEnforcementOptions" />
              </AcuFormRow>
            </div>
            <div class="acu-v2-world-simulation-page__toggles">
              <AcuCheckbox v-model="settingsDraft.dynamics.missedSweepEnabled" label="启用过期清扫（关闭后过期暗流不会自动记为错过）" />
            </div>
          </AcuDisclosureGroup>

          <AcuDisclosureGroup
            class="acu-v2-world-simulation-page__group"
            label="工作流"
            :meta="workflowGroupMeta"
            :expanded="isGroupExpanded('workflow')"
            body-id="acu-world-simulation-group-workflow"
            @toggle="toggleGroup('workflow')"
          >
            <p class="acu-v2-world-simulation-page__meta">固定工作流按时间、暗流、人物的顺序自治执行。这里只改配置：自动修复和编年热层阈值。提示词仍在下方各角色分组里改。</p>
            <div class="acu-v2-world-simulation-page__settings-grid">
              <AcuFormRow label="编年热层阈值" hint="热层编年达到这个条数时，本轮会派出编年。范围 1–512。">
                <AcuInput v-model="settingsDraft.workflow.chroniclerHotThreshold" type="number" :min="1" :max="512" />
              </AcuFormRow>
            </div>
          </AcuDisclosureGroup>

          <AcuDisclosureGroup
            class="acu-v2-world-simulation-page__group"
            label="各 Agent 渠道"
            :meta="channelGroupMeta"
            :expanded="isGroupExpanded('channels')"
            body-id="acu-world-simulation-group-channels"
            @toggle="toggleGroup('channels')"
          >
            <p class="acu-v2-world-simulation-page__meta">给不同 Agent 分配不同 API 预设：例如主 Agent 用强模型，审核类子代理用便宜快速的模型。「跟随全局默认」即使用上方的 API 预设。</p>
            <div class="acu-v2-world-simulation-page__settings-grid">
              <AcuFormRow v-for="agentName in agentNames" :key="agentName" :label="agentLabel(agentName)">
                <AcuSelect
                  :options="agentChannelOptions"
                  :model-value="agentChannelValue(agentName)"
                  @update:model-value="value => applyAgentChannel(agentName, value)"
                />
              </AcuFormRow>
            </div>
          </AcuDisclosureGroup>
        </div>

        <p v-if="settingsError" class="acu-v2-world-simulation-page__error">{{ settingsError }}</p>
        <p v-if="settingsNotice" class="acu-v2-world-simulation-page__meta">{{ settingsNotice }}</p>
      </AcuPanel>
    </AcuPanelGrid>

    <AcuPanel v-if="settingsDraft" title="伪 Role 提示词" description="仅启用段参与内部调用；占位符会按实际出现按需解析。引擎 seam 段固定顺序与角色、不可删除，其余段可自由增删改。修改后自动保存。">
      <div class="acu-v2-world-simulation-page__actions acu-v2-world-simulation-page__actions--start">
        <AcuButton @click="exportPrompts">导出提示词 JSON</AcuButton>
        <AcuButton @click="promptImportInput?.click()">导入提示词 JSON</AcuButton>
        <input ref="promptImportInput" type="file" accept=".json,application/json" class="acu-v2-world-simulation-page__file-input" @change="onImportPromptsFile" />
      </div>
      <p v-if="promptIoError" class="acu-v2-world-simulation-page__error">{{ promptIoError }}</p>
      <p v-if="promptIoNotice" class="acu-v2-world-simulation-page__meta">{{ promptIoNotice }}</p>

      <div class="acu-v2-world-simulation-page__groups">
        <AcuDisclosureGroup
          v-for="agentName in agentNames"
          :key="agentName"
          class="acu-v2-world-simulation-page__group"
          :label="`${agentLabel(agentName)}（${agentName}）提示词`"
          :meta="promptGroupMeta(agentName)"
          :expanded="isGroupExpanded(`prompt:${agentName}`)"
          :body-id="`acu-world-simulation-prompt-${agentName}`"
          @toggle="toggleGroup(`prompt:${agentName}`)"
        >
          <AcuPromptSegments
            :segments="settingsDraft.agentPrompts[agentName] ?? []"
            :role-options="roleOptions"
            :show-slot="false"
            :show-enabled="true"
            :allow-move="true"
            @add="position => addPrompt(agentName, position)"
            @delete="index => deletePrompt(agentName, index)"
            @move="(index, delta) => movePrompt(agentName, index, delta)"
            @update="(index, patch) => updatePrompt(agentName, index, patch)"
          />
          <div class="acu-v2-world-simulation-page__actions"><AcuButton @click="restorePrompt(agentName)">恢复{{ agentLabel(agentName) }}默认值</AcuButton></div>
        </AcuDisclosureGroup>

        <AcuDisclosureGroup
          class="acu-v2-world-simulation-page__group"
          label="占位符速查"
          meta="参考"
          :expanded="isGroupExpanded('prompt:reference')"
          body-id="acu-world-simulation-prompt-reference"
          @toggle="toggleGroup('prompt:reference')"
        >
          <h4 class="acu-v2-world-simulation-page__subheading">引擎 seam 段</h4>
          <p class="acu-v2-world-simulation-page__meta">每个角色的提示词由固定顺序的 ROOT、ROLE_RULES、PROTOCOL、WORKFLOW、HISTORY、RUNTIME_CONTEXT、ACKNOWLEDGEMENT、EXECUTION_BOUNDARY 八段引擎 seam 与一段可编辑的用户要求段组成。seam 段的角色与顺序由引擎锁定，只能改内容不能删除或移动；可编辑段必须唯一且包含 $WORLD_USER_REQUIREMENTS 或 $WORLD_USER_GUIDANCE。</p>
          <h4 class="acu-v2-world-simulation-page__subheading">世界推演占位符</h4>
          <p class="acu-v2-world-simulation-page__meta">运行装配占位符：$WORLD_TASK（当前任务）、$WORLD_HISTORY（楼层锚定的 Agent 会话历史）、$WORLD_RUNTIME_CONTEXT（触发种类、指令与基准账本 revision）、$WORLD_AGENT_CATALOG（可派工角色与职责）、$WORLD_TOOL_CATALOG（read/search 地址词汇表）、$WORLD_EVIDENCE（已授权证据条目）、$WORLD_USER_REQUIREMENTS（用户累计要求，默认注入）、$WORLD_USER_GUIDANCE（用户本轮指令，自定义段仍可用）。世界领域占位符：$WORLD_STATE（当前世界账本）、$ANCHOR_MESSAGE（冻结 assistant 楼层正文）、$ANCHOR_IDENTITY（楼层 / swipe / 正文摘要身份）、$WORLD_STAGE_PLAN（本轮阶段计划）、$WORLD_CHRONICLE（宏观编年）、$WORLD_CANDIDATES（本轮候选摘要）、$CURRENT_EVIDENCE_REGISTRY（证据注册表快照）、$PROJECTION_PREVIEW（〈与此同时〉投影预览）。所有动态内容都以转义后的 UNTRUSTED_* 区块注入，只有提示词里实际出现的占位符才会被解析；未知占位符会在保存时被拒绝。</p>
        </AcuDisclosureGroup>
      </div>
      <p v-if="settingsError" class="acu-v2-world-simulation-page__error">{{ settingsError }}</p>
    </AcuPanel>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { WorldSimulationAgentName_ACU } from '../../service/simulation/agent/agent-catalog'; // arch-ok: 仅类型导入，用于本页状态标注，编译后无运行时依赖
import type { WorldSimulationPromptSegment_ACU, WorldSimulationSettings_ACU } from '../../service/simulation/model'; // arch-ok: 仅类型导入，用于本页状态标注，编译后无运行时依赖
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuCheckbox from '../components/_lib/AcuCheckbox.vue';
import AcuDisclosureGroup from '../components/_lib/AcuDisclosureGroup.vue';
import AcuFormRow from '../components/_lib/AcuFormRow.vue';
import AcuInput from '../components/_lib/AcuInput.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import AcuPromptSegments from '../components/_lib/AcuPromptSegments.vue';
import AcuSelect from '../components/_lib/AcuSelect.vue';
import AcuTextarea from '../components/_lib/AcuTextarea.vue';
import WorldSimulationChat from '../components/WorldSimulationChat.vue';
import WorldSimulationMaterialsPanel from '../components/WorldSimulationMaterialsPanel.vue';
import { useApiPresetSelectOptions } from '../composables/useApiPresetSelectOptions';
import { useChatChangedTick, useChatMutationTick } from '../composables/useChatChangedListener';
import { useWorldSimulationRuntime } from '../composables/useWorldSimulationRuntime';
import { WORLD_SIMULATION_AGENT_ORDER_ACU, worldSimulationAgentLabel_ACU } from '../copy/world-simulation-copy';
import { useDialogStore } from '../stores/dialog-store';

const runtime = useWorldSimulationRuntime();
const dialog = useDialogStore();
const { apiStore, followActiveApiLabel, apiPresetSelectOptions: apiPresetOptions } = useApiPresetSelectOptions();
const settingsDraft = ref<WorldSimulationSettings_ACU | null>(null);
const messageDraft = ref('');
const messageSending = ref(false);
const settingsError = ref('');
const settingsNotice = ref('');

const agentNames = WORLD_SIMULATION_AGENT_ORDER_ACU;
const agentLabel = worldSimulationAgentLabel_ACU;

const roleOptions = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'user', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];

const webSearchProviderOptions = [
  { value: 'duckduckgo', label: 'DuckDuckGo（免 key）' },
  { value: 'serper', label: 'Serper（Google，需酒馆已配 key）' },
  { value: 'tavily', label: 'Tavily（需酒馆已配 key）' },
  { value: 'searxng', label: 'SearXNG（自建/公共实例）' },
];

const collisionEnforcementOptions = [
  { value: 'strict', label: '严格（未兑现则拒绝提交）' },
  { value: 'relaxed', label: '宽松（仅警告）' },
];

/** 渠道下拉里「跟随全局默认」的哨兵值：空串已被「跟随当前活动 API」占用。 */
const INHERIT_CHANNEL_VALUE = '__inherit__';

const apiPresetValue = computed(() => {
  if (!settingsDraft.value) return '';
  return settingsDraft.value.apiPresetMode === 'fixed' ? settingsDraft.value.fixedApiPresetName : '';
});

function applyApiPreset(value: string): void {
  if (!settingsDraft.value) return;
  const trimmed = String(value || '').trim();
  if (trimmed) {
    settingsDraft.value.apiPresetMode = 'fixed';
    settingsDraft.value.fixedApiPresetName = trimmed;
  } else {
    settingsDraft.value.apiPresetMode = 'current';
    settingsDraft.value.fixedApiPresetName = '';
  }
  // 渠道选择与智能续写一致：选择即保存，不等防抖窗口，避免用户离开页面时选择丢失。
  saveSettingsImmediately();
}

const agentChannelOptions = computed(() => [
  { value: INHERIT_CHANNEL_VALUE, label: '跟随全局默认' },
  ...apiPresetOptions.value,
]);

/** 世界推演的渠道映射以「键不存在」表示跟随全局默认，与 settings validator 的闭合契约一致。 */
function agentChannelValue(agentName: WorldSimulationAgentName_ACU): string {
  const choice = settingsDraft.value?.agentApiPresets[agentName];
  if (!choice) return INHERIT_CHANNEL_VALUE;
  return choice.mode === 'fixed' ? choice.presetName : '';
}

function applyAgentChannel(agentName: WorldSimulationAgentName_ACU, value: string): void {
  if (!settingsDraft.value) return;
  const trimmed = String(value ?? '').trim();
  const next = { ...settingsDraft.value.agentApiPresets };
  if (trimmed === INHERIT_CHANNEL_VALUE) delete next[agentName];
  else if (trimmed) next[agentName] = { mode: 'fixed', presetName: trimmed };
  else next[agentName] = { mode: 'current', presetName: '' };
  settingsDraft.value.agentApiPresets = next;
  saveSettingsImmediately();
}

/** 折叠分组的展开状态：默认全部收起，只在本次打开面板期间记忆。 */
const expandedGroups = reactive<Record<string, boolean>>({});

function isGroupExpanded(key: string): boolean {
  return expandedGroups[key] === true;
}

function toggleGroup(key: string): void {
  expandedGroups[key] = !isGroupExpanded(key);
}

/** 折叠态下的一行摘要：让用户不展开也能看到关键取值。 */
const budgetGroupMeta = computed(() => {
  const s = settingsDraft.value;
  if (!s) return '';
  return `迭代 ${s.agentRunBudget.maxIterations} · 派工 ${s.agentRunBudget.maxDelegations} · 并发 ${s.agentRunBudget.maxConcurrent}`;
});

const webResearchGroupMeta = computed(() => {
  const web = settingsDraft.value?.webResearch;
  if (!web) return '';
  if (!web.enabled) return '已关闭';
  const sources = [web.sources.moegirl && '萌娘', web.sources.wikipediaZh && '中文维基', web.sources.wikipediaEn && '英文维基'].filter(Boolean);
  return `已开启 · ${sources.length ? sources.join('/') : '无百科来源'} · ${web.searchProvider}`;
});

const channelGroupMeta = computed(() => {
  const presets = settingsDraft.value?.agentApiPresets;
  if (!presets) return '';
  const customized = agentNames.filter(name => presets[name] !== undefined).length;
  return customized ? `${customized} 个单独指定` : '全部跟随默认';
});

const dynamicsGroupMeta = computed(() => {
  const dynamics = settingsDraft.value?.dynamics;
  if (!dynamics) return '';
  return `TTL ${dynamics.rumorTTLDays} · 推进 ${dynamics.maxClockAdvanceDays} · ${dynamics.collisionEnforcement === 'strict' ? '严格' : '宽松'}${dynamics.missedSweepEnabled ? ' · 清扫开' : ' · 清扫关'}`;
});

const workflowGroupMeta = computed(() => {
  const workflow = settingsDraft.value?.workflow;
  if (!workflow) return '';
  return `${workflow.autoFixEnabled ? '自动修复开' : '自动修复关'} · 编年热层 ${workflow.chroniclerHotThreshold}`;
});

function cloneSettings(settings: WorldSimulationSettings_ACU): WorldSimulationSettings_ACU {
  return JSON.parse(JSON.stringify(settings)) as WorldSimulationSettings_ACU;
}

/** 首次发送（即将创建任务）前的高 RPM 风险确认：5 秒倒计时结束前只能取消。 */
async function confirmFirstSendRpmWarning(): Promise<boolean> {
  return dialog.confirm({
    title: '开始世界推演前请确认',
    message: '本功能单次请求占用的 Token 不多，但 Agent 会连续发起大量请求，需要 API 支持很高的 RPM（每分钟请求数）。开启「自动推演」后每次正文生成完成都会再跑一轮。',
    dangerMessage: '禁止使用任何公益站，除非它明确表示允许 coding（本功能的请求模式与 coding 类似）。违规使用可能导致账号被封禁。',
    confirmLabel: '我已了解，开始',
    cancelLabel: '取消',
    confirmVariant: 'danger',
    confirmCountdownSeconds: 5,
  });
}

/** 会话发送：没有任务时创建任务，运行中会打断当前 run 并带着这句话继续或新建。 */
async function sendMessage(text: string): Promise<void> {
  if (messageSending.value) return;
  if (!runtime.task.value && !(await confirmFirstSendRpmWarning())) return;
  if (messageSending.value) return;
  messageSending.value = true;
  try {
    const accepted = await runtime.send(text);
    if (accepted && messageDraft.value.trim() === text) messageDraft.value = '';
  } finally {
    messageSending.value = false;
  }
}

async function clearData(): Promise<void> {
  await runtime.clearData();
}

async function saveUserRequirements(requirements: unknown): Promise<void> {
  await runtime.saveUserRequirements(requirements);
}

function requiredRangeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) throw new Error(`${label} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  return numeric;
}

/** 读取预算接受两种形态：正整数（固定 token 数）或 1%-100% 的百分比串（按总结阈值折算）。 */
function normalizedReadBudget(value: unknown): number | string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('单批次读取上限不能为空');
  if (raw.endsWith('%')) {
    const percent = Number.parseInt(raw, 10);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100 || `${percent}%` !== raw) throw new Error('读取预算百分比必须是 1% 到 100% 之间的整数百分比');
    return `${percent}%`;
  }
  const fixed = Number(raw);
  if (!Number.isInteger(fixed) || fixed < 1 || fixed > 1000000) throw new Error('单批次读取上限必须是 1 到 1000000 的整数，或形如 20% 的百分比');
  return fixed;
}

/** 判断预设名是否存在于当前 API 预设列表中：把悬挂引用从运行中途的任务失败提前到保存时报错。 */
function presetExists(presetName: string): boolean {
  return apiStore.presets.some(preset => preset.name === presetName);
}

function normalizeSettingsDraft(): WorldSimulationSettings_ACU {
  if (!settingsDraft.value) throw new Error('世界推演设置尚未加载');
  const source = settingsDraft.value;
  const normalized: WorldSimulationSettings_ACU = {
    ...cloneSettings(source),
    agentHistoryTokenBudget: requiredRangeInteger(source.agentHistoryTokenBudget, '会话自动总结阈值', 0, 1000000),
    agentReadTokenBudget: normalizedReadBudget(source.agentReadTokenBudget),
    agentReadFallbackTokens: requiredRangeInteger(source.agentReadFallbackTokens, '临近总结时的精读额度', 0, 100000),
    agentRunBudget: {
      maxIterations: requiredRangeInteger(source.agentRunBudget.maxIterations, '主 Agent 迭代上限', 1, 100),
      maxDelegations: requiredRangeInteger(source.agentRunBudget.maxDelegations, '派工总数上限', 0, 100),
      maxSameAgent: requiredRangeInteger(source.agentRunBudget.maxSameAgent, '单代理派工上限', 0, 20),
      maxConcurrent: requiredRangeInteger(source.agentRunBudget.maxConcurrent, '并发派工上限', 1, 20),
      maxReads: requiredRangeInteger(source.agentRunBudget.maxReads, '读取批次上限', 0, 200),
      maxExtraReads: requiredRangeInteger(source.agentRunBudget.maxExtraReads, '子代理工具轮上限', 0, 20),
    },
    webResearch: {
      enabled: source.webResearch.enabled,
      sources: { ...source.webResearch.sources },
      searchProvider: source.webResearch.searchProvider,
      searxngBaseUrl: String(source.webResearch.searxngBaseUrl ?? '').trim(),
      pageCharLimit: requiredRangeInteger(source.webResearch.pageCharLimit, '单页阅读字数上限', 500, 20000),
      blockedDomains: String(source.webResearch.blockedDomains ?? ''),
    },
    dynamics: {
      rumorTTLDays: requiredRangeInteger(source.dynamics.rumorTTLDays, '传闻等待上限', 1, 3650),
      maxClockAdvanceDays: requiredRangeInteger(source.dynamics.maxClockAdvanceDays, '单次时钟推进上限', 0, 3650),
      collisionEnforcement: source.dynamics.collisionEnforcement === 'relaxed' ? 'relaxed' : source.dynamics.collisionEnforcement === 'strict' ? 'strict' : (() => { throw new Error('碰撞兑现策略必须是严格或宽松'); })(),
      missedSweepEnabled: typeof source.dynamics.missedSweepEnabled === 'boolean' ? source.dynamics.missedSweepEnabled : (() => { throw new Error('过期清扫开关无效'); })(),
    },
    workflow: {
      autoFixEnabled: typeof source.workflow?.autoFixEnabled === 'boolean' ? source.workflow.autoFixEnabled : true,
      chroniclerHotThreshold: requiredRangeInteger(source.workflow?.chroniclerHotThreshold, '编年热层阈值', 1, 512),
    },
  };
  if (normalized.webResearch.enabled && normalized.webResearch.searchProvider === 'searxng' && !normalized.webResearch.searxngBaseUrl) {
    throw new Error('搜索引擎选择 SearXNG 时必须填写实例地址');
  }
  if (normalized.apiPresetMode === 'fixed') {
    const presetName = normalized.fixedApiPresetName.trim();
    if (!presetName) throw new Error('固定 API 预设名称不能为空');
    if (!presetExists(presetName)) throw new Error(`API 预设 "${presetName}" 不存在，请重新选择`);
  }
  for (const agentName of agentNames) {
    const choice = normalized.agentApiPresets[agentName];
    if (!choice || choice.mode !== 'fixed') continue;
    const presetName = choice.presetName.trim();
    if (!presetName) throw new Error(`${agentLabel(agentName)} 的固定渠道必须选择预设`);
    if (!presetExists(presetName)) throw new Error(`${agentLabel(agentName)} 渠道的 API 预设 "${presetName}" 不存在，请重新选择`);
  }
  return normalized;
}

/** 记录最近一次从权威状态装载/保存成功的草稿快照，用于跳过无变化的自动保存并切断"保存→刷新→重建草稿"的循环。 */
let lastPersistedSettingsJson = '';
let settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;

/** 设置修改后自动保存（防抖 800ms），与智能续写/填表工作台的"改动即生效"一致。 */
function scheduleSettingsSave(): void {
  if (settingsSaveTimer !== undefined) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => { void saveSettingsNow(); }, 800);
}

/** 立即触发保存：先取消挂起的防抖计时器再保存，保证渠道类改动不受 800ms 窗口影响。 */
function saveSettingsImmediately(): void {
  if (settingsSaveTimer !== undefined) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = undefined;
  }
  void saveSettingsNow();
}

async function saveSettingsNow(): Promise<void> {
  if (!settingsDraft.value) return;
  if (JSON.stringify(settingsDraft.value) === lastPersistedSettingsJson) return;
  let candidate: WorldSimulationSettings_ACU;
  try {
    apiStore.refreshFromSettings();
    candidate = normalizeSettingsDraft();
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : '世界推演设置无效';
    return;
  }
  const outcome = await runtime.saveSettings(candidate);
  if (outcome === 'saved') {
    settingsError.value = '';
    settingsNotice.value = '';
  } else if (outcome === 'busy') {
    // Agent 正在运行，改动不能丢：告知用户并排队等本轮结束后落盘。
    settingsNotice.value = '设置已修改：世界推演正在运行，将在本轮结束后自动保存并于下一轮生效。';
    scheduleSettingsSave();
  }
}

/** 折叠态摘要：启用段数 / 总段数。 */
function promptGroupMeta(agentName: WorldSimulationAgentName_ACU): string {
  const prompts = settingsDraft.value?.agentPrompts[agentName];
  if (!prompts) return '';
  const enabled = prompts.filter(segment => segment.enabled !== false).length;
  return `${enabled}/${prompts.length} 段启用`;
}

function promptList(agentName: WorldSimulationAgentName_ACU): WorldSimulationPromptSegment_ACU[] | null {
  return settingsDraft.value?.agentPrompts[agentName] ?? null;
}

function addPrompt(agentName: WorldSimulationAgentName_ACU, position: 'top' | 'bottom' = 'bottom'): void {
  const prompts = promptList(agentName);
  if (!prompts) return;
  const segment: WorldSimulationPromptSegment_ACU = { role: 'user', content: '请填写提示词内容。', enabled: true, deletable: true, pinned: false };
  if (position === 'top') prompts.unshift(segment);
  else prompts.push(segment);
}

function deletePrompt(agentName: WorldSimulationAgentName_ACU, index: number): void {
  const prompts = promptList(agentName);
  if (!prompts || prompts[index]?.deletable === false) return;
  prompts.splice(index, 1);
}

/** 引擎 seam 段（pinned）的相对顺序由引擎锁定：涉及 pinned 段的移动一律忽略。 */
function movePrompt(agentName: WorldSimulationAgentName_ACU, index: number, delta: -1 | 1): void {
  const prompts = promptList(agentName);
  const target = index + delta;
  if (!prompts || target < 0 || target >= prompts.length) return;
  if (prompts[index]?.pinned || prompts[target]?.pinned) return;
  [prompts[index], prompts[target]] = [prompts[target], prompts[index]];
}

/** pinned 段只允许改内容：角色、启用与可删除性由引擎 seam 契约固定。 */
function updatePrompt(agentName: WorldSimulationAgentName_ACU, index: number, patch: Partial<WorldSimulationPromptSegment_ACU>): void {
  const prompts = promptList(agentName);
  const current = prompts?.[index];
  if (!prompts || !current) return;
  prompts[index] = current.pinned
    ? { ...current, ...(typeof patch.content === 'string' ? { content: patch.content } : {}) }
    : { ...current, ...patch, pinned: false };
}

function restorePrompt(agentName: WorldSimulationAgentName_ACU): void {
  if (!settingsDraft.value) return;
  settingsDraft.value = runtime.restorePromptDefault(settingsDraft.value, agentName);
}

const promptImportInput = ref<HTMLInputElement | null>(null);
const promptIoError = ref('');
const promptIoNotice = ref('');

/** 导出全部八组 Agent 提示词为 JSON 文件下载。 */
function exportPrompts(): void {
  if (!settingsDraft.value) return;
  promptIoError.value = '';
  try {
    const bundle = { version: 1, agentPrompts: cloneSettings(settingsDraft.value).agentPrompts };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'acu-world-simulation-prompts.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    promptIoNotice.value = '提示词 JSON 已导出。';
  } catch (error) {
    promptIoError.value = error instanceof Error ? error.message : '提示词导出失败。';
  }
}

/** 导入提示词 JSON：八组全部校验通过后整体写入草稿并立即保存，任何一组失败即整体拒绝。 */
async function onImportPromptsFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 允许连续选择同一个文件重复导入。
  input.value = '';
  if (!file || !settingsDraft.value) return;
  promptIoError.value = '';
  promptIoNotice.value = '';
  try {
    settingsDraft.value.agentPrompts = runtime.parsePromptBundle(await file.text());
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
}

/**
 * 当前聊天内楼层被删除 / swipe 后：任务锚点、Agent 会话与资料快照都锚定在楼层上，
 * 存储层已随楼层回退，会话流必须清空重灌，否则显示的仍是删楼前的记录。
 */
function refreshAfterChatMutation(): void {
  runtime.resyncAfterChatMutation();
}

onMounted(() => {
  apiStore.refreshFromSettings();
  runtime.refresh();
});
onBeforeUnmount(() => {
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
  // 每次刷新快照都会产生新的 settings 引用；只有持久化内容真的变了（保存成功、切换聊天）
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
</script>

<style scoped>
.acu-v2-world-simulation-page { min-height: 100%; padding: 20px; display: grid; gap: 18px; }
.acu-v2-world-simulation-page__layout { align-items: start; }
.acu-v2-world-simulation-page__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.acu-v2-world-simulation-page__actions--start { justify-content: flex-start; margin-top: 0; margin-bottom: 12px; }
.acu-v2-world-simulation-page__file-input { display: none; }
.acu-v2-world-simulation-page__error { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; color: var(--acu-danger, #d65b5b); white-space: pre-wrap; }
.acu-v2-world-simulation-page__meta { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-world-simulation-page__settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
.acu-v2-world-simulation-page__toggles { display: flex; flex-wrap: wrap; gap: 14px; margin: 14px 0; }
.acu-v2-world-simulation-page__groups { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.acu-v2-world-simulation-page__group {
  border: 1px solid var(--acu-border, color-mix(in srgb, var(--acu-text-3) 18%, transparent));
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-bg-2) 72%, transparent);
}
.acu-v2-world-simulation-page__group :deep(.acu-disclosure-group__header) { border-radius: var(--acu-radius-sm); }
.acu-v2-world-simulation-page__group :deep(.acu-disclosure-group--expanded .acu-disclosure-group__header) { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.acu-v2-world-simulation-page__group :deep(.acu-disclosure-group__body) { gap: 12px; padding: 12px; }
.acu-v2-world-simulation-page__group :deep(.acu-disclosure-group__meta) { max-width: 55%; overflow: hidden; text-overflow: ellipsis; }
.acu-v2-world-simulation-page__group .acu-v2-world-simulation-page__actions { margin-top: 0; }
.acu-v2-world-simulation-page__subheading { margin: 4px 0 0; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); font-weight: 600; }
.acu-v2-world-simulation-page__subheading:first-child { margin-top: 0; }
@media (max-width: 860px) { .acu-v2-world-simulation-page { padding: 14px; } }
@media (max-width: 640px) {
  .acu-v2-world-simulation-page { padding: 10px; gap: 12px; }
  .acu-v2-world-simulation-page__settings-grid { grid-template-columns: 1fr; }
  .acu-v2-world-simulation-page__actions > * { flex: 1 1 auto; }
  .acu-v2-world-simulation-page__group :deep(.acu-disclosure-group__meta) { display: none; }
}
</style>
