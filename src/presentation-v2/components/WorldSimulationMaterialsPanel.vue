<template>
  <div class="acu-v2-ws-materials">
    <div class="acu-v2-ws-materials__tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="acu-v2-ws-materials__tab"
        :class="{ 'acu-v2-ws-materials__tab--active': activeTab === tab.id }"
        @click="activeTab = tab.id"
      >{{ tab.label }}</button>
      <div class="acu-v2-ws-materials__tab-actions">
        <AcuButton :loading="busy" @click="emit('refresh')">刷新</AcuButton>
        <AcuButton variant="danger" :loading="busy" @click="clearPending = true">一键清空</AcuButton>
      </div>
    </div>

    <p v-if="clearPending" class="acu-v2-ws-materials__confirm">
      清空会删除当前世界推演任务、世界账本、主 Agent 的会话记录与各楼层上的资料快照（账本状态、候选与运行恢复状态）。
      小说正文楼层与已写进正文的〈与此同时〉段不受影响，清空后下一次正文完成或发送指令会从空账本重新推演。
      <span class="acu-v2-ws-materials__confirm-actions">
        <AcuButton variant="danger" :loading="busy" @click="confirmClear">确认清空</AcuButton>
        <AcuButton @click="clearPending = false">取消</AcuButton>
      </span>
    </p>

    <!-- 世界状态：锚点与时钟概览 + 分模块卡片，与 ContinuationMaterialsPanel 同一套视觉结构 -->
    <template v-if="activeTab === 'state'">
      <div class="acu-v2-ws-materials__overview">
        <div><strong>冻结锚点</strong><span>{{ anchorText }}</span></div>
        <div><strong>账本修订</strong><span>{{ ledger ? `revision ${ledger.revision}` : '尚未建立' }}</span></div>
        <div><strong>故事时间</strong><span>{{ ledger?.clock.storyTime || '未知' }}<template v-if="ledger"> · 第 {{ ledger.clock.day }} 天</template><template v-if="ledger?.clock.slot"> · {{ ledger.clock.slot }}</template></span></div>
      </div>
      <p v-if="materials.snapshot" class="acu-v2-ws-materials__meta">
        资料从最近基线折叠；删除楼层后随该楼增量一并回退。
        基线楼层 {{ materials.checkpointIndex ?? '无' }} · 已折叠 delta {{ materials.foldedDeltaCount ?? 0 }} 条 · revision {{ materials.snapshot.ledgerRevision }} · 证据引用 {{ materials.snapshot.evidenceRefs.length }} 条。
      </p>
      <p v-else class="acu-v2-ws-materials__meta">当前没有基线，也没有楼层增量。首次提交后会把账本增量写到冻结的 assistant 楼层。</p>

      <p v-if="!ledger || !ledgerGroups.some(group => group.items.length)" class="acu-v2-ws-materials__empty">世界账本还是空的。发送一条指令或等待正文生成完成后，主 Agent 会开始取证并建立维度、暗流与行动者。</p>
      <details v-for="group in ledgerGroups" :key="group.key" class="acu-v2-ws-materials__block" open>
        <summary>{{ group.label }} · {{ group.items.length }} 条</summary>
        <p v-if="!group.items.length" class="acu-v2-ws-materials__empty">暂无记录。</p>
        <div v-else class="acu-v2-ws-materials__cards">
          <article v-for="item in group.items" :key="item.id" class="acu-v2-ws-materials__card">
            <p class="acu-v2-ws-materials__card-head"><strong>{{ item.title }}</strong><span v-if="item.badge" class="acu-v2-ws-materials__badge">{{ item.badge }}</span></p>
            <p class="acu-v2-ws-materials__card-body">{{ item.detail }}</p>
            <p v-if="item.meta" class="acu-v2-ws-materials__card-meta">{{ item.meta }}</p>
          </article>
        </div>
      </details>
    </template>

    <!-- 候选轨迹：派工 / 阶段计划 / 交付 / 阻断，卡片结构与续写资料面板一致 -->
    <template v-else-if="activeTab === 'candidates'">
      <p v-if="!candidateEntries.length" class="acu-v2-ws-materials__empty">暂无候选、派工或终审记录。</p>
      <div v-else class="acu-v2-ws-materials__cards">
        <article v-for="item in candidateEntries" :key="item.id" class="acu-v2-ws-materials__card" :class="{ 'acu-v2-ws-materials__card--failed': item.status === 'failed' }">
          <p class="acu-v2-ws-materials__card-head"><strong>{{ item.title }}</strong><span>{{ agentLabel(item) }}</span></p>
          <p class="acu-v2-ws-materials__card-body">{{ item.detail }}</p>
        </article>
      </div>
    </template>

    <!-- 投影预览：将写入正文的〈与此同时〉段与可感知信号 -->
    <template v-else-if="activeTab === 'projection'">
      <p class="acu-v2-ws-materials__meta">Projection preview：按当前账本渲染的〈与此同时〉投影，提交时会写进冻结 assistant 楼层的正文；只呈现角色可通过合理渠道感知的世界信号。</p>
      <details class="acu-v2-ws-materials__block" open>
        <summary>可感知信号 · {{ ledger?.guidance.signals.length ?? 0 }} 条</summary>
        <p v-if="!ledger?.guidance.signals.length" class="acu-v2-ws-materials__empty">当前没有可投影信号。</p>
        <ul v-else class="acu-v2-ws-materials__list"><li v-for="(signal, index) in ledger.guidance.signals" :key="signal.sourceId || String(index)">{{ signal.text }}</li></ul>
      </details>
      <pre class="acu-v2-ws-materials__projection">{{ projectionPreview || '当前没有系统投影。' }}</pre>
    </template>

    <template v-else-if="activeTab === 'chronicle'">
      <p v-if="!chronicleRows.length" class="acu-v2-ws-materials__empty">编年还是空的。提交后会按发生日与玩家得知日对照。</p>
      <div v-else class="acu-v2-ws-materials__cards">
        <article v-for="row in chronicleRows" :key="row.id" class="acu-v2-ws-materials__card">
          <p class="acu-v2-ws-materials__card-head"><strong>{{ row.summary }}</strong></p>
          <p class="acu-v2-ws-materials__card-body">{{ row.at }}</p>
          <p class="acu-v2-ws-materials__card-meta">{{ chronicleMeta(row) }}</p>
        </article>
      </div>
    </template>

    <template v-else-if="activeTab === 'missed'">
      <p v-if="!missedItems.length" class="acu-v2-ws-materials__empty">当前没有错过的暗流或过期清扫记录。</p>
      <div v-else class="acu-v2-ws-materials__cards">
        <article v-for="item in missedItems" :key="`${item.source}:${item.id}`" class="acu-v2-ws-materials__card">
          <p class="acu-v2-ws-materials__card-head"><strong>{{ item.title }}</strong><span class="acu-v2-ws-materials__badge">{{ item.source === 'timeline' ? '清扫' : '错过' }}</span></p>
          <p class="acu-v2-ws-materials__card-body">{{ item.detail || '暂无摘要' }}</p>
          <p class="acu-v2-ws-materials__card-meta">{{ missedMeta(item) }}</p>
        </article>
      </div>
    </template>

    <template v-else-if="activeTab === 'rumors'">
      <p v-if="!rumorQueue" class="acu-v2-ws-materials__empty">当前没有可展示的传闻队列。</p>
      <template v-else>
        <p class="acu-v2-ws-materials__meta">接触状态：{{ CONTACT_LABELS[rumorQueue.contact] ?? rumorQueue.contact }} · 当前位置：{{ rumorQueue.playerRegion || '未知' }}</p>
        <details v-for="group in rumorQueueGroups" :key="group.key" class="acu-v2-ws-materials__block" open>
          <summary>{{ group.label }} · {{ group.items.length }} 条</summary>
          <p v-if="!group.items.length" class="acu-v2-ws-materials__empty">暂无记录。</p>
          <div v-else class="acu-v2-ws-materials__cards">
            <article v-for="item in group.items" :key="item.id" class="acu-v2-ws-materials__card">
              <p class="acu-v2-ws-materials__card-head"><strong>{{ item.fact }}</strong><span class="acu-v2-ws-materials__badge">{{ RUMOR_STATUS_LABELS[item.status] ?? item.status }}</span></p>
              <p class="acu-v2-ws-materials__card-meta">{{ rumorMeta(item) }}</p>
            </article>
          </div>
        </details>
      </template>
    </template>

    <!-- 读取诊断 -->
    <template v-else-if="activeTab === 'diagnostics'">
      <p v-if="!diagnostics.length" class="acu-v2-ws-materials__empty">当前没有读取诊断。</p>
      <ul v-else class="acu-v2-ws-materials__diagnostics"><li v-for="item in diagnostics" :key="item">{{ item }}</li></ul>
    </template>

    <template v-else-if="activeTab === 'userRequirements'">
      <p class="acu-v2-ws-materials__meta">
        用户要求在资料库里手动维护。创建任务时会把初始要求写成首条；每个标签是一条要求，保存时自动转换为字符串数组。
      </p>
      <p v-if="userRequirements.snapshot" class="acu-v2-ws-materials__meta">
        条目 {{ userRequirements.snapshot.requirements.length }} 条
      </p>
      <p v-if="userRequirements.diagnostics.length" class="acu-v2-ws-materials__error">{{ userRequirements.diagnostics.join('；') }}</p>
      <p v-if="userRequirements.snapshot && !userRequirements.snapshot.requirements.length" class="acu-v2-ws-materials__empty">
        还没有用户要求条目。可点击新增标签手动添加。
      </p>
      <UserRequirementsEditor
        editor-id="simulation"
        :items="requirementsDraft"
        :dirty="requirementsDirty"
        :error="requirementsError"
        :saving="requirementsSaving"
        :disabled="busy || !userRequirements.snapshot || !!userRequirements.diagnostics.length"
        @update:items="updateRequirementsDraft"
        @discard="discardRequirementsDraft"
        @save="saveRequirementsDraft"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AcuButton from './_lib/AcuButton.vue';
import UserRequirementsEditor from './UserRequirementsEditor.vue';
import type { WorldSimulationAnchorIdentity_ACU, WorldSimulationConversationView_ACU, WorldSimulationMaterialsReadResult_ACU, WorldSimulationUserRequirementsReadResult_ACU } from '../../service/simulation/agent/agent-model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationSessionEntry_ACU } from '../../service/simulation/agent/agent-session-log'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import type { WorldSimulationLedger_ACU, WorldSimulationTimelineEntry_ACU } from '../../service/simulation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖
import { worldSimulationAgentLabel_ACU } from '../copy/world-simulation-copy';
import { buildWorldChronicleContrast_ACU, buildWorldMissedList_ACU, buildWorldRumorQueue_ACU, type WorldChronicleContrastRow_ACU, type WorldMissedItem_ACU, type WorldRumorQueueItem_ACU } from '../simulation/world-simulation-dynamics-views';


const props = withDefaults(defineProps<{
  conversation: WorldSimulationConversationView_ACU;
  materials: WorldSimulationMaterialsReadResult_ACU;
  userRequirements: WorldSimulationUserRequirementsReadResult_ACU;
  saveRequirements: (requirements: string[]) => Promise<boolean>;
  session: WorldSimulationSessionEntry_ACU[];
  ledger: WorldSimulationLedger_ACU | null;
  anchor: WorldSimulationAnchorIdentity_ACU | null;
  projectionPreview: string | null;
  busy?: boolean;
  timeline?: WorldSimulationTimelineEntry_ACU[];
}>(), { busy: false, timeline: () => [] });
const emit = defineEmits<{
  (event: 'refresh' | 'clear'): void;
}>();

const TABS = [
  { id: 'state', label: '世界状态' },
  { id: 'userRequirements', label: '用户要求' },
  { id: 'candidates', label: '候选轨迹' },
  { id: 'chronicle', label: '编年对照' },
  { id: 'missed', label: '错过清单' },
  { id: 'rumors', label: '传闻队列' },
  { id: 'projection', label: '投影预览' },
  { id: 'diagnostics', label: '读取诊断' },
] as const;

type TabId = typeof TABS[number]['id'];
const activeTab = ref<TabId>('state');
const clearPending = ref(false);
const requirementsDraft = ref<string[]>([]);
const requirementsDirty = ref(false);
const requirementsError = ref('');
const requirementsSaving = ref(false);
const awaitingRequirementsSnapshot = ref<string | null>(null);
let requirementsChatIdentity: string | null = null;
let latestRequirementsUpdatedAt = -1;

watch(() => [props.anchor?.chatIdentity, props.userRequirements.snapshot] as const, () => {
  const chatIdentity = props.anchor?.chatIdentity ?? null;
  if (chatIdentity !== requirementsChatIdentity) {
    requirementsChatIdentity = chatIdentity;
    latestRequirementsUpdatedAt = -1;
    awaitingRequirementsSnapshot.value = null;
    requirementsDirty.value = false;
  }
  if (requirementsDirty.value) return;
  const snapshot = props.userRequirements.snapshot;
  if (snapshot && snapshot.updatedAt < latestRequirementsUpdatedAt) return;
  const incoming = snapshot?.requirements ?? [];
  if (awaitingRequirementsSnapshot.value !== null) {
    if (JSON.stringify(incoming) === awaitingRequirementsSnapshot.value) return;
    awaitingRequirementsSnapshot.value = null;
  }
  if (snapshot) latestRequirementsUpdatedAt = snapshot.updatedAt;
  requirementsDraft.value = [...incoming];
  requirementsError.value = '';
}, { immediate: true });

function updateRequirementsDraft(value: string[]): void {
  requirementsDraft.value = value;
  requirementsDirty.value = JSON.stringify(value) !== JSON.stringify(props.userRequirements.snapshot?.requirements ?? []);
  requirementsError.value = '';
}

function discardRequirementsDraft(): void {
  requirementsDraft.value = [...(props.userRequirements.snapshot?.requirements ?? [])];
  requirementsDirty.value = false;
  requirementsError.value = '';
}

async function saveRequirementsDraft(): Promise<void> {
  if (!requirementsDirty.value || requirementsSaving.value || props.busy || !props.userRequirements.snapshot) return;
  const payload = requirementsDraft.value.map(item => item.trim());
  if (payload.some(item => !item || item.length > 8000)) {
    requirementsError.value = '每条要求不能为空或超过 8000 字；请修改或删除空标签。';
    return;
  }
  requirementsSaving.value = true;
  try {
    const saved = await props.saveRequirements(payload);
    if (saved) {
      const observed = props.userRequirements.snapshot;
      if (observed && JSON.stringify(observed.requirements) === JSON.stringify(payload)) {
        latestRequirementsUpdatedAt = Math.max(latestRequirementsUpdatedAt, observed.updatedAt);
        awaitingRequirementsSnapshot.value = null;
      } else {
        awaitingRequirementsSnapshot.value = JSON.stringify(observed?.requirements ?? []);
      }
      requirementsDirty.value = false;
      requirementsDraft.value = [...payload];
      requirementsError.value = '';
    } else {
      requirementsError.value = '保存失败，修改已保留。请检查提示后重试。';
    }
  } catch (error) {
    requirementsError.value = error instanceof Error ? `保存失败，修改已保留：${error.message}` : '保存失败，修改已保留。';
  } finally {
    requirementsSaving.value = false;
  }
}

function confirmClear(): void {
  clearPending.value = false;
  emit('clear');
}

const anchorText = computed(() => (props.anchor
  ? `第 ${props.anchor.messageIndex + 1} 楼 · swipe ${Number(props.anchor.swipeId) + 1}`
  : '当前未解析到 assistant 楼层'));

const diagnostics = computed(() => [...props.conversation.diagnostics, ...props.materials.diagnostics]);

const candidateEntries = computed(() => props.session.filter(item => ['delegation', 'finalize', 'block', 'stage_plan'].includes(item.kind)));

function agentLabel(item: WorldSimulationSessionEntry_ACU): string {
  return item.agentName ? worldSimulationAgentLabel_ACU(item.agentName) : '主 Agent';
}

const SEED_STATUS_LABELS: Record<string, string> = {
  established: '已建立', incubating: '酝酿中', active: '活跃', converging: '汇聚中', resolved: '已收束', retired: '已退役',
};
const VISIBILITY_LABELS: Record<string, string> = { hidden: '幕后', limited: '有限可见', public: '公开' };
const TREND_LABELS: Record<string, string> = { rising: '上升', stable: '平稳', falling: '下降' };
const DIMENSION_KIND_LABELS: Record<string, string> = { pressure: '压力', growth: '生长' };

interface LedgerCard { id: string; title: string; detail: string; badge?: string; meta?: string }

const ledgerGroups = computed<Array<{ key: string; label: string; items: LedgerCard[] }>>(() => {
  const ledger = props.ledger;
  if (!ledger) return [];
  return [
    {
      key: 'dimensions', label: '世界维度',
      items: ledger.dimensions.map(item => ({
        id: item.id, title: item.name,
        badge: `${DIMENSION_KIND_LABELS[item.kind] ?? item.kind} ${item.value} · ${TREND_LABELS[item.trend] ?? item.trend}`,
        detail: item.rationale || '暂无依据摘要',
        meta: `revision ${item.revision} · 证据 ${item.evidenceRefs.join(', ') || '无'}`,
      })),
    },
    {
      key: 'seeds', label: '暗流种子',
      items: ledger.seeds.map(item => ({
        id: item.id, title: item.title,
        badge: `${SEED_STATUS_LABELS[item.status] ?? item.status} · L${item.level} · ${VISIBILITY_LABELS[item.visibility] ?? item.visibility}`,
        detail: item.catalyst || '暂无催化条件',
        meta: `${item.actorIds.length ? `关联行动者 ${item.actorIds.join('、')} · ` : ''}revision ${item.revision}${item.retiredReason ? ` · 退役原因：${item.retiredReason}` : ''}`,
      })),
    },
    {
      key: 'actors', label: '行动者',
      items: ledger.actors.map(item => ({
        id: item.id, title: item.name,
        badge: VISIBILITY_LABELS[item.visibility] ?? item.visibility,
        detail: `位置：${item.location || '未知'} · 目标：${item.goals.join('、') || '无'}`,
        meta: `利益：${item.interests.join('、') || '无'} · 已知：${item.knownFacts.join('、') || '无'}`,
      })),
    },
    {
      key: 'chronicle', label: '世界编年',
      items: ledger.chronicle.map(item => ({
        id: item.id, title: item.at, detail: item.summary,
        meta: `${item.relatedIds.length ? `关联 ${item.relatedIds.join('、')} · ` : ''}证据 ${item.evidenceRefs.join(', ') || '无'}`,
      })),
    },
  ];
});

const CONTACT_LABELS: Record<string, string> = { open: '开放', secluded: '隔绝' };
const RUMOR_STATUS_LABELS: Record<string, string> = { latent: '潜伏', ripe: '待命', revealed: '已得知', dead: '已失效' };
const HIT_STATE_LABELS: Record<string, string> = { 'open-hit': '开放可命中', 'secluded-delay': '隔绝延迟中', waiting: '等待到访' };

const chronicleRows = computed(() => (props.ledger ? buildWorldChronicleContrast_ACU(props.ledger) : []));
const missedItems = computed(() => (props.ledger ? buildWorldMissedList_ACU(props.ledger, props.timeline) : []));
const rumorQueue = computed(() => (props.ledger ? buildWorldRumorQueue_ACU(props.ledger) : null));
const rumorQueueGroups = computed(() => {
  const queue = rumorQueue.value;
  if (!queue) return [];
  return [
    { key: 'latent', label: '潜伏', items: queue.latent },
    { key: 'ripe', label: '待命', items: queue.ripe },
    { key: 'revealed', label: '已得知', items: queue.revealed },
    { key: 'dead', label: '已失效', items: queue.dead },
  ];
});

function chronicleMeta(row: WorldChronicleContrastRow_ACU): string {
  const occurred = row.occurredDay === null ? '发生日未知' : `发生日 第 ${row.occurredDay} 天`;
  if (row.revealedAtDay === null || row.lagDays === null) return occurred;
  return `${occurred} / 得知日 第 ${row.revealedAtDay} 天（滞后 ${row.lagDays} 天）`;
}

function missedMeta(item: WorldMissedItem_ACU): string {
  const parts: string[] = [];
  if (item.expiresAtDay !== null) parts.push(`过期日 第 ${item.expiresAtDay} 天`);
  if (item.missedOutcome) parts.push(item.missedOutcome);
  return parts.join(' · ') || '过期清扫';
}

function rumorMeta(item: WorldRumorQueueItem_ACU): string {
  const channels = item.channels.length ? `渠道 ${item.channels.join('、')}` : '无渠道';
  if (item.status === 'latent' && item.countdownDays !== null) {
    return item.countdownDays > 0 ? `${channels} · ${item.countdownDays} 日后可揭` : `${channels} · 已到期待流转`;
  }
  if (item.status === 'ripe' && item.hitState) return `${channels} · ${HIT_STATE_LABELS[item.hitState] ?? item.hitState}`;
  if (item.status === 'revealed' && item.revealedAtDay !== null) return `${channels} · 得知日 第 ${item.revealedAtDay} 天`;
  return channels;
}

</script>

<style scoped>
/* 与 ContinuationMaterialsPanel 保持同一套视觉语言：页签行、概览块、卡片、诊断列表。 */
.acu-v2-ws-materials { display: grid; gap: 12px; }
.acu-v2-ws-materials__tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.acu-v2-ws-materials__tab { padding: 5px 12px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 22%, transparent); border-radius: 999px; background: transparent; color: var(--acu-text-2); cursor: pointer; font: inherit; font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__tab--active { border-color: color-mix(in srgb, var(--acu-primary, #5b8def) 55%, transparent); background: color-mix(in srgb,var(--acu-primary, #5b8def) 14%, transparent); color: var(--acu-text-1); }
.acu-v2-ws-materials__tab-actions { display: flex; gap: 6px; margin-left: auto; }
.acu-v2-ws-materials__confirm { display: grid; gap: 8px; margin: 0; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--acu-danger, #d65b5b) 45%, transparent); border-radius: 7px; background: color-mix(in srgb, var(--acu-danger, #d65b5b) 8%, var(--acu-bg-2)); color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__confirm-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.acu-v2-ws-materials__overview { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.acu-v2-ws-materials__overview > div { display: grid; gap: 5px; padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 7px; }
.acu-v2-ws-materials__overview strong { color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__overview span { color: var(--acu-text-3); font-size: 12px; }
.acu-v2-ws-materials__block { padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 7px; display: grid; gap: 8px; }
.acu-v2-ws-materials__block > summary { cursor: pointer; color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__cards { display: grid; gap: 8px; }
.acu-v2-ws-materials__card { display: grid; gap: 4px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent); border-radius: 7px; }
.acu-v2-ws-materials__card--failed { border-left: 3px solid color-mix(in srgb, var(--acu-danger, #d65b5b) 75%, transparent); }
.acu-v2-ws-materials__card-head { margin: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__card-head span { color: var(--acu-text-3); font-size: 11px; }
.acu-v2-ws-materials__badge { padding: 1px 7px; border-radius: 999px; background: color-mix(in srgb, var(--acu-text-3) 18%, transparent); color: var(--acu-text-2); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-ws-materials__card-body { margin: 0; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; word-break: break-word; }
.acu-v2-ws-materials__card-meta { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); white-space: pre-wrap; word-break: break-word; }
.acu-v2-ws-materials__meta { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-ws-materials__empty { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__error { margin: 0; color: var(--acu-danger, #d65b5b); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__json { display: grid; gap: 8px; padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 7px; }
.acu-v2-ws-materials__json > summary { cursor: pointer; color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.acu-v2-ws-materials__list { margin: 0; padding-left: 18px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__projection { max-height: 320px; overflow: auto; margin: 0; padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 7px; background: var(--acu-bg-2); color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; word-break: break-word; }
.acu-v2-ws-materials__diagnostics { margin: 0; padding: 10px 10px 10px 28px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 7px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
@media (max-width: 640px) {
  .acu-v2-ws-materials__overview { grid-template-columns: 1fr; }
  .acu-v2-ws-materials__tab-actions { width: 100%; margin-left: 0; }
  .acu-v2-ws-materials__tab-actions > * { flex: 1 1 auto; }
}
</style>
