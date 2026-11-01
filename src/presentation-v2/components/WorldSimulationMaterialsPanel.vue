<template>
  <div class="acu-v2-ws-materials">
    <p v-if="clearPending" class="acu-v2-ws-materials__confirm">
      清空推演任务、世界账本、会话记录及资料快照；小说正文不变。
      <span class="acu-v2-ws-materials__confirm-actions">
        <AcuButton variant="danger" :loading="busy" @click="confirmClear">确认清空</AcuButton>
        <AcuButton @click="clearPending = false">取消</AcuButton>
      </span>
    </p>

    <div class="acu-v2-ws-materials__overview">
      <div><strong>故事时间</strong><span>{{ storyClockText }}</span></div>
    </div>
    <p v-if="!ledger || !hasV7Materials" class="acu-v2-ws-materials__empty">暂无运行资料。</p>

      <details class="acu-v2-ws-materials__block" open>
        <summary><span>世界事件</span><small>繁忙的世界，不会为你驻足。</small></summary>
        <p v-if="!ledger?.worldEvents.length" class="acu-v2-ws-materials__empty">暂无世界事件。</p>
        <div v-else class="acu-v2-ws-materials__cards">
          <details v-for="event in ledger.worldEvents" :key="event.id" class="acu-v2-ws-materials__card acu-v2-ws-materials__entry">
            <summary class="acu-v2-ws-materials__entry-summary">
              <strong>{{ event.title }}</strong><span class="acu-v2-ws-materials__badge">{{ worldEventStatusLabel(event.status) }}</span>
              <span class="acu-v2-ws-materials__entry-state">{{ event.state || '尚无状态摘要' }}</span>
            </summary>
            <div class="acu-v2-ws-materials__entry-detail">
              <p class="acu-v2-ws-materials__card-meta">参与者：{{ event.actorIds.join('、') || '无' }}</p>
              <p class="acu-v2-ws-materials__card-meta">地点：{{ event.locationRefs.map(locationText).join('、') || '未定' }}</p>
              <p class="acu-v2-ws-materials__card-meta">下次检查：{{ nextCheckText(event.nextCheck) }}</p>
              <div v-if="deleteEventPendingId === event.id" class="acu-v2-ws-materials__confirm" role="group" :aria-label="`删除${event.title}确认`">
                <span>删除{{ event.title }}？只删除此事件及结构引用，事实、历史和正文保留；不保证后续推演不会再次生成。</span>
                <span class="acu-v2-ws-materials__confirm-actions">
                  <AcuButton size="sm" variant="danger" :disabled="busy" @click="confirmDeleteWorldEvent(event.id)">确认删除</AcuButton>
                  <AcuButton size="sm" :disabled="busy" @click="deleteEventPendingId = null">取消</AcuButton>
                </span>
              </div>
              <AcuButton v-else size="sm" variant="danger" class="acu-v2-ws-materials__delete-actor" :disabled="busy" @click="deleteEventPendingId = event.id">删除</AcuButton>
            </div>
          </details>
        </div>
      </details>

      <details class="acu-v2-ws-materials__block" open>
        <summary><span>人物谱</span><small>视界之外，我并没有忘记。</small></summary>
        <AcuButton size="sm" class="acu-v2-ws-materials__scan" :disabled="busy" @click="emit('scanWorldbooks')">扫描世界书</AcuButton>
        <p v-if="!ledger?.actors.length" class="acu-v2-ws-materials__empty">暂无人物记录。</p>
        <div v-else class="acu-v2-ws-materials__cards">
          <details v-for="actor in ledger.actors" :key="actor.id" class="acu-v2-ws-materials__card acu-v2-ws-materials__entry">
            <summary class="acu-v2-ws-materials__entry-summary">
              <strong>{{ actor.name }}</strong>
              <span class="acu-v2-ws-materials__badge">{{ actorSimulationStatusLabel(actor.simulationStatus) }}</span>
              <span class="acu-v2-ws-materials__badge">{{ actorLifeLabel(actor.life) }}</span>
              <span class="acu-v2-ws-materials__entry-state">当前动作：{{ actionText(actor.currentAction) }}</span>
              <span class="acu-v2-ws-materials__entry-result">上一轮行动的结果：{{ previousActionResultText(actor) }}</span>
              <span class="acu-v2-ws-materials__entry-location">位置：{{ actor.location || locationText(actor.locationRef) || '未知' }}</span>
            </summary>
            <div class="acu-v2-ws-materials__entry-detail">
              <p class="acu-v2-ws-materials__card-meta">短期目标：{{ actionText(actor.shortTermAction) }}</p>
              <p class="acu-v2-ws-materials__card-meta">长期目标：{{ actor.goals.join('；') || '无' }}</p>
              <p class="acu-v2-ws-materials__card-meta">资源：{{ actor.resources.join('、') || '无' }}</p>
              <p class="acu-v2-ws-materials__card-meta">限制：{{ actor.constraints.join('、') || '无' }}</p>
              <details class="acu-v2-ws-materials__timeline">
                <summary>认知渠道与已知事实</summary>
                <p class="acu-v2-ws-materials__card-meta">信息渠道：{{ actor.informationSources.join('、') || '无' }}</p>
                <p class="acu-v2-ws-materials__card-meta">已知事实：{{ actor.knownFacts.join('、') || '无' }}</p>
              </details>
              <details class="acu-v2-ws-materials__timeline">
                <summary>个人重要历史</summary>
                <p v-if="!actorHistory(actor.id).length" class="acu-v2-ws-materials__empty">暂无关联的重要历史。</p>
                <ol v-else class="acu-v2-ws-materials__list">
                  <li v-for="milestone in actorHistory(actor.id)" :key="milestone.id">{{ timeText(milestone.happenedAt) }} · {{ milestone.summary }}</li>
                </ol>
              </details>
              <div v-if="deletePendingId === actor.id" class="acu-v2-ws-materials__confirm" role="group" :aria-label="`删除${actor.name}确认`">
                <span>删除{{ actor.name }}？只删除此人物及关联引用，事件、事实、历史和正文保留。正文再次出现时可能重新登记。</span>
                <span class="acu-v2-ws-materials__confirm-actions">
                  <AcuButton size="sm" variant="danger" :disabled="busy" @click="confirmDeleteActor(actor.id)">确认删除</AcuButton>
                  <AcuButton size="sm" :disabled="busy" @click="deletePendingId = null">取消</AcuButton>
                </span>
              </div>
              <AcuButton v-else size="sm" variant="danger" class="acu-v2-ws-materials__delete-actor" :disabled="busy" @click="deletePendingId = actor.id">删除</AcuButton>
            </div>
          </details>
        </div>
      </details>

      <details class="acu-v2-ws-materials__block" open>
        <summary><span>确定事实</span><small>这一刻，世界确实如此。</small></summary>
        <p v-if="!visibleFacts.length" class="acu-v2-ws-materials__empty">暂无公开事实。</p>
        <div v-else class="acu-v2-ws-materials__cards">
          <article v-for="fact in visibleFacts" :key="fact.id" class="acu-v2-ws-materials__card">
            <p class="acu-v2-ws-materials__card-head"><strong>{{ fact.summary }}</strong><span class="acu-v2-ws-materials__badge">场景事实</span></p>
            <p class="acu-v2-ws-materials__card-meta">发生／有效时间 {{ factTimeText(fact) }} · 地点 {{ locationText(fact.locationRef) || '未定' }} · 关联人物 {{ fact.actorIds.join('、') || '无' }}</p>
          </article>
        </div>
      </details>

      <details
        class="acu-v2-ws-materials__block acu-v2-ws-materials__protected-facts"
        @toggle="setProtectedFactsExpanded"
      >
        <summary><span>内部管理事实</span><small>我们尚未知晓的那些事。</small></summary>
        <template v-if="protectedFactsExpanded">
          <p v-if="!protectedFacts.length" class="acu-v2-ws-materials__empty">暂无内部管理事实。</p>
          <div v-else class="acu-v2-ws-materials__cards">
            <article v-for="fact in protectedFacts" :key="fact.id" class="acu-v2-ws-materials__card">
              <p class="acu-v2-ws-materials__card-head"><strong>{{ fact.summary }}</strong><span class="acu-v2-ws-materials__badge">{{ protectedFactLabel(fact) }}</span></p>
              <p class="acu-v2-ws-materials__card-meta">事实 ID {{ fact.id }} · 状态 {{ fact.revealState === 'locked' ? '锁定' : '已解锁但受管理限制' }}</p>
            </article>
          </div>
        </template>
      </details>

      <details class="acu-v2-ws-materials__block acu-v2-ws-materials__archived-facts" @toggle="setArchivedFactsExpanded">
        <summary><span>过期事件</span><small>那些我们已经错过的</small></summary>
        <template v-if="archivedFactsExpanded">
          <p v-if="!ledger?.factArchive?.length" class="acu-v2-ws-materials__empty">暂无过期事件。</p>
          <article v-for="fact in ledger?.factArchive ?? []" :key="fact.id" class="acu-v2-ws-materials__card">
            <p class="acu-v2-ws-materials__card-head"><strong>{{ fact.summary }}</strong><span class="acu-v2-ws-materials__badge">已归档</span></p>
            <p class="acu-v2-ws-materials__card-meta">事实 {{ fact.id }} · {{ factTimeText(fact) }} · 来源 {{ fact.sourceRefs.join('、') || '无' }} · {{ fact.revealState === 'locked' ? '仍锁定' : '已解锁' }}</p>
          </article>
        </template>
      </details>

      <details class="acu-v2-ws-materials__block" open>
        <summary><span>重要历史</span><small>不想忘记他们的故事。</small></summary>
        <p v-if="!allHistoryMilestones.length" class="acu-v2-ws-materials__empty">暂无重要历史。</p>
        <div v-else class="acu-v2-ws-materials__cards">
          <article v-for="milestone in visibleHistoryMilestones" :key="milestone.id" class="acu-v2-ws-materials__card">
            <p class="acu-v2-ws-materials__card-head"><strong>{{ milestone.summary }}</strong><span class="acu-v2-ws-materials__badge">重要度 {{ milestone.importance }}</span></p>
            <p class="acu-v2-ws-materials__card-meta">{{ timeText(milestone.happenedAt) }} · 人物 {{ milestone.actorIds.join('、') || '无' }} · 世界事件 {{ milestone.worldEventIds.join('、') || '无' }}</p>
            <div v-if="deleteHistoryPendingId === milestone.id" class="acu-v2-ws-materials__confirm" role="group" :aria-label="`删除重要历史${milestone.id}确认`">
              <span>删除这条重要历史？只删除这条记录，人物、事件、事实和正文保留。</span>
              <span class="acu-v2-ws-materials__confirm-actions">
                <AcuButton size="sm" variant="danger" :disabled="busy" @click="confirmDeleteWorldHistory(milestone.id)">确认删除</AcuButton>
                <AcuButton size="sm" :disabled="busy" @click="deleteHistoryPendingId = null">取消</AcuButton>
              </span>
            </div>
            <AcuButton v-else size="sm" variant="danger" class="acu-v2-ws-materials__delete-actor" :disabled="busy" @click="deleteHistoryPendingId = milestone.id">删除</AcuButton>
          </article>
          <p v-if="allHistoryMilestones.length > visibleHistoryMilestones.length" class="acu-v2-ws-materials__meta">未展示 {{ allHistoryMilestones.length - visibleHistoryMilestones.length }} 条。</p>
        </div>
      </details>

      <details class="acu-v2-ws-materials__block" open>
        <summary><span>投送事件</span><small>幕后的变化，终会影响到我们。</small></summary>
        <p v-if="!ledger?.projection.deliveries.length" class="acu-v2-ws-materials__empty">暂无事实投送记录。</p>
        <template v-else>
          <p class="acu-v2-ws-materials__meta">当前投送锚点：{{ ledger.projection.anchor || '无' }}</p>
          <div class="acu-v2-ws-materials__cards">
            <article v-for="delivery in ledger.projection.deliveries" :key="delivery.factId" class="acu-v2-ws-materials__card">
              <p class="acu-v2-ws-materials__card-head"><strong>事实 {{ delivery.factId }}</strong><span class="acu-v2-ws-materials__badge">{{ projectionStatusLabel(delivery.status) }}</span></p>
              <p class="acu-v2-ws-materials__card-meta">投送尝试 {{ delivery.attempts }} 次</p>
            </article>
          </div>
        </template>
      </details>

      <details class="acu-v2-ws-materials__block">
        <summary><span>逐栏记录</span></summary>
        <template v-if="ledger?.pendingFixes.length">
          <p class="acu-v2-ws-materials__meta">待修复的写入（{{ ledger.pendingFixes.length }} 条）：</p>
          <div class="acu-v2-ws-materials__cards">
            <article v-for="(fix, fixIndex) in ledger.pendingFixes" :key="`${fix.module}-${fix.candidateId}-${fixIndex}`" class="acu-v2-ws-materials__card acu-v2-ws-materials__card--failed">
              <p class="acu-v2-ws-materials__card-head"><strong>{{ LEDGER_MODULE_LABELS[fix.module] ?? fix.module }} · {{ fix.candidateId }}</strong><span class="acu-v2-ws-materials__badge">{{ fix.completion === 'partial' ? '部分接受' : '失败' }}</span></p>
              <p class="acu-v2-ws-materials__card-meta">出错路径：{{ fix.violations.map(item => `${item.path}（${item.message}）`).join('；') || fix.lastError || '（未记录）' }}</p>
            </article>
          </div>
        </template>
        <p v-if="!fieldRecordGroups.length" class="acu-v2-ws-materials__empty">还没有逐栏写入记录。</p>
        <details v-for="group in fieldRecordGroups" :key="group.module" class="acu-v2-ws-materials__block">
          <summary>{{ group.label }}</summary>
          <div class="acu-v2-ws-materials__cards">
            <article v-for="record in group.records" :key="record.id" class="acu-v2-ws-materials__card">
              <p class="acu-v2-ws-materials__card-head"><strong>{{ record.id }}</strong><span class="acu-v2-ws-materials__badge">{{ FIELD_STATUS_LABELS[record.status] ?? record.status }}</span></p>
              <p class="acu-v2-ws-materials__card-meta">已写字段：{{ record.fieldNames.join('、') || '（无）' }}</p>
              <p v-if="record.missingFields.length" class="acu-v2-ws-materials__card-meta">缺栏：{{ record.missingFields.join('、') }}</p>
              <p class="acu-v2-ws-materials__card-meta">最近更新 {{ formatTimestamp(record.updatedAt) }}<template v-if="record.maxRevision > 0"> · 栏目修订号最高 {{ record.maxRevision }}</template></p>
            </article>
          </div>
        </details>
      </details>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AcuButton from './_lib/AcuButton.vue';
import type { WorldActorAction_ACU, WorldFact_ACU, WorldHistoryMilestone_ACU, WorldLocationRef_ACU, WorldNextCheck_ACU, WorldSimulationLedger_ACU, WorldSimulationLedgerFieldSnapshot_ACU, WorldSimulationLedgerModule_ACU, WorldTime_ACU } from '../../service/simulation/model';

const props = withDefaults(defineProps<{
  fieldSnapshot: WorldSimulationLedgerFieldSnapshot_ACU;
  ledger: WorldSimulationLedger_ACU | null;
  busy?: boolean;
}>(), { busy: false });
const emit = defineEmits<{ (event: 'clear'): void; (event: 'deleteActor', id: string): void; (event: 'deleteWorldEvent', id: string): void; (event: 'deleteWorldHistory', id: string): void; (event: 'scanWorldbooks'): void }>();

const clearPending = ref(false);
const deletePendingId = ref<string | null>(null);
const deleteEventPendingId = ref<string | null>(null);
const deleteHistoryPendingId = ref<string | null>(null);
watch(() => props.ledger?.actors.map(actor => actor.id), ids => {
  if (deletePendingId.value && !ids?.includes(deletePendingId.value)) deletePendingId.value = null;
});
watch(() => props.ledger?.worldEvents.map(event => event.id), ids => {
  if (deleteEventPendingId.value && !ids?.includes(deleteEventPendingId.value)) deleteEventPendingId.value = null;
});
watch(() => [...(props.ledger?.historyMilestones ?? []), ...(props.ledger?.historyArchive ?? [])].map(item => item.id), ids => {
  if (deleteHistoryPendingId.value && !ids.includes(deleteHistoryPendingId.value)) deleteHistoryPendingId.value = null;
});
function confirmDeleteWorldHistory(id: string): void {
  if (props.busy || deleteHistoryPendingId.value !== id) return;
  emit('deleteWorldHistory', id);
}
function confirmDeleteWorldEvent(id: string): void {
  if (props.busy || deleteEventPendingId.value !== id) return;
  emit('deleteWorldEvent', id);
}
function confirmDeleteActor(id: string): void {
  if (props.busy || deletePendingId.value !== id) return;
  emit('deleteActor', id);
}
function requestClear(): void { clearPending.value = true; }
defineExpose({ requestClear });
const protectedFactsExpanded = ref(false);
const archivedFactsExpanded = ref(false);

function confirmClear(): void { clearPending.value = false; emit('clear'); }
function setProtectedFactsExpanded(event: Event): void { protectedFactsExpanded.value = (event.currentTarget as HTMLDetailsElement).open; }
function setArchivedFactsExpanded(event: Event): void { archivedFactsExpanded.value = (event.currentTarget as HTMLDetailsElement).open; }

const storyClockText = computed(() => !props.ledger ? '未知' : `${props.ledger.clock.storyTime || '未知'} · 第 ${props.ledger.clock.day} 天${props.ledger.clock.slot ? ` · ${props.ledger.clock.slot}` : ''}`);
const hasV7Materials = computed(() => !!props.ledger && ([props.ledger.worldEvents, props.ledger.actors, props.ledger.facts, props.ledger.factArchive ?? [], props.ledger.historyMilestones, props.ledger.historyArchive ?? [], props.ledger.projection.deliveries, props.ledger.pendingFixes].some(items => items.length > 0) || fieldRecordTotal.value > 0));
const visibleFacts = computed(() => (props.ledger?.facts ?? []).filter(fact => fact.projectionPolicy === 'scene' && fact.revealState === 'unlocked'));
const protectedFacts = computed(() => (props.ledger?.facts ?? []).filter(fact => fact.projectionPolicy !== 'scene' || fact.revealState !== 'unlocked'));
const allHistoryMilestones = computed<WorldHistoryMilestone_ACU[]>(() => [
  ...(props.ledger?.historyMilestones ?? []),
  ...(props.ledger?.historyArchive ?? []),
]);
const visibleHistoryMilestones = computed(() => allHistoryMilestones.value.slice(0, 32));

function actionText(action: WorldActorAction_ACU | null | undefined): string {
  if (!action) return '无';
  const duration = action.expectedDuration?.trim();
  return duration ? `${action.text}（预计 ${duration}）` : action.text;
}
function previousActionResultText(actor: WorldSimulationLedger_ACU['actors'][number] & { previousActionResult?: string }): string { return actor.previousActionResult?.trim() || '无'; }
function locationText(location: WorldLocationRef_ACU | null): string { return location ? [location.region, location.place].filter(Boolean).join('／') : ''; }
function timeText(time: WorldTime_ACU | null): string { return time ? `第 ${time.day} 天${time.slot ? ` · ${time.slot}` : ''}` : '时间未定'; }
function nextCheckText(next: WorldNextCheck_ACU | null): string { return next ? `${timeText(next)}${next.reason ? `（${next.reason}）` : ''}` : '未定'; }
function factTimeText(fact: WorldFact_ACU): string { return fact.temporalKind === 'occurrence' ? timeText(fact.happenedAt) : `${timeText(fact.validFrom)} 至 ${timeText(fact.validUntil)}`; }
function worldEventStatusLabel(status: string): string { return ({ scheduled: '待开始', active: '进行中', paused: '暂停', resolved: '已收束', cancelled: '已取消' } as Record<string, string>)[status] ?? status; }
function actorSimulationStatusLabel(status: string | undefined): string { return status === 'archived' ? '已归档' : '参与推演'; }
function actorLifeLabel(life: string): string { return ({ alive: '存活', missing: '失踪', dead: '已故' } as Record<string, string>)[life] ?? life; }
function protectedFactLabel(fact: WorldFact_ACU): string { return fact.projectionPolicy === 'internal' ? '内部' : fact.revealState === 'locked' ? '锁定' : 'Gated 管理资料'; }
function projectionStatusLabel(status: string): string { return ({ delivered: '已记录投送', acknowledged: '已记录后继核对', expired: '已过期' } as Record<string, string>)[status] ?? status; }
function actorHistory(actorId: string) { return allHistoryMilestones.value.filter(item => item.actorIds.includes(actorId)).slice().sort((left, right) => right.happenedAt.day - left.happenedAt.day); }

const FIELD_STATUS_LABELS: Record<string, string> = { complete: '完整', partial: '部分', legacy_unknown: '旧账本条目' };
const LEDGER_MODULE_LABELS: Record<WorldSimulationLedgerModule_ACU, string> = { clock: '时序', dimensions: '局势刻度', seeds: '伏线', actors: '人物谱', chronicle: '幕后纪要', guidance: '场外信号', rumors: '风声', player: '玩家状态' };
const fieldRecordGroups = computed(() => (Object.keys(LEDGER_MODULE_LABELS) as WorldSimulationLedgerModule_ACU[])
  .map(module => {
    const entries = Object.values(props.fieldSnapshot.records[module] ?? {});
    if (!entries.length) return null;
    return { module, label: LEDGER_MODULE_LABELS[module], records: entries.map(record => ({ id: record.id, status: record.status, fieldNames: Object.keys(record.fields), missingFields: record.missingFields, maxRevision: Object.values(record.fields).reduce((max, field) => Math.max(max, field.revision), 0), updatedAt: record.updatedAt })).sort((left, right) => left.id.localeCompare(right.id)) };
  }).filter((group): group is NonNullable<typeof group> => group !== null));
const fieldRecordTotal = computed(() => fieldRecordGroups.value.reduce((total, group) => total + group.records.length, 0));
function formatTimestamp(value: number): string { return value > 0 ? new Date(value).toLocaleString() : '（未记录）'; }
</script>

<style scoped>
.acu-v2-ws-materials { display: grid; gap: 12px; }
.acu-v2-ws-materials details > summary { list-style: none; }
.acu-v2-ws-materials details > summary::marker { content: ''; }
.acu-v2-ws-materials details > summary::-webkit-details-marker { display: none; }
.acu-v2-ws-materials__confirm { display: grid; gap: 8px; margin: 0; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--acu-danger, #d65b5b) 45%, transparent); border-radius: 7px; background: color-mix(in srgb, var(--acu-danger, #d65b5b) 8%, var(--acu-bg-2)); color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__confirm-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.acu-v2-ws-materials__overview { display: grid; gap: 8px; }
.acu-v2-ws-materials__overview > div { display: grid; gap: 5px; padding: 10px; text-align: center; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 7px; }
.acu-v2-ws-materials__overview strong { color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__overview span { color: var(--acu-text-3); font-size: 12px; }
.acu-v2-ws-materials__block { padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 7px; display: grid; gap: 8px; }
.acu-v2-ws-materials__block > summary { cursor: pointer; color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); padding: 4px; border-radius: 6px; }
.acu-v2-ws-materials > .acu-v2-ws-materials__block > summary { display: grid; gap: 5px; text-align: center; }
.acu-v2-ws-materials__block > summary > small { color: var(--acu-text-3); font-size: var(--acu-font-size-caption, 11px); font-weight: 400; line-height: 1.5; }
.acu-v2-ws-materials__block > summary:hover { background: color-mix(in srgb, var(--acu-text-3) 8%, transparent); }
.acu-v2-ws-materials__cards { display: grid; gap: 8px; }
.acu-v2-ws-materials__card { display: grid; gap: 4px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent); border-radius: 7px; }
.acu-v2-ws-materials__entry { display: block; padding: 0; }
.acu-v2-ws-materials__entry[open] { background: color-mix(in srgb, var(--acu-text-3) 4%, transparent); }
.acu-v2-ws-materials__entry-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; cursor: pointer; padding: 10px; border-radius: 7px; color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__entry-summary:hover { background: color-mix(in srgb, var(--acu-text-3) 8%, transparent); }
.acu-v2-ws-materials__entry-state, .acu-v2-ws-materials__entry-result, .acu-v2-ws-materials__entry-location { flex-basis: 100%; min-width: 0; color: var(--acu-text-2); }
.acu-v2-ws-materials__entry-result { white-space: pre-wrap; overflow-wrap: anywhere; }
.acu-v2-ws-materials__entry-detail { display: grid; gap: 8px; padding: 0 10px 10px; }
.acu-v2-ws-materials__scan { justify-self: start; }
.acu-v2-ws-materials__delete-actor { justify-self: start; }
.acu-v2-ws-materials__card--failed { border-left: 3px solid color-mix(in srgb, var(--acu-danger, #d65b5b) 75%, transparent); }
.acu-v2-ws-materials__card-head { margin: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-ws-materials__card-head span { color: var(--acu-text-3); font-size: 11px; }
.acu-v2-ws-materials__badge { padding: 1px 7px; border-radius: 999px; background: color-mix(in srgb, var(--acu-text-3) 18%, transparent); color: var(--acu-text-2); font-size: var(--acu-font-size-caption, 11px); }
.acu-v2-ws-materials__card-meta, .acu-v2-ws-materials__meta, .acu-v2-ws-materials__empty { margin: 0; font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; word-break: break-word; }
.acu-v2-ws-materials__card-meta, .acu-v2-ws-materials__meta, .acu-v2-ws-materials__empty { color: var(--acu-text-3); }
.acu-v2-ws-materials__timeline { display: grid; gap: 8px; margin: 0; padding: 0; border: 0; background: transparent; }
.acu-v2-ws-materials__timeline > summary { margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); cursor: pointer; }
.acu-v2-ws-materials__list { margin: 0; padding-left: 18px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
</style>
