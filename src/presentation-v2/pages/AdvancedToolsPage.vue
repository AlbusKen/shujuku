<template>
  <section class="acu-v2-advanced-tools-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <AcuPanelGrid class="acu-v2-advanced-tools-page__tools-grid" collapse-at="lg">
      <AcuPanel
        id="advanced-tools-sql-panel"
        class="acu-v2-advanced-tools-page__sql-panel"
        :title="advancedToolsCopy.panels.sql.title"
        :description="advancedToolsCopy.panels.sql.description"
      >
        <template #actions>
          <AcuBadge :variant="sqlFlow.isSqliteAvailable.value ? 'success' : 'warning'">
            {{ sqlFlow.isSqliteAvailable.value ? 'SQLite 模式' : 'SQL 不可用' }}
          </AcuBadge>
        </template>

        <div class="acu-v2-advanced-tools-page__quick-actions" aria-label="SQL 快捷操作">
          <AcuButton size="sm" :disabled="!!sqlFlow.busyAction.value" @click="sqlFlow.showTables">
            <i class="fa-solid fa-list"></i>
            查看所有表
          </AcuButton>
          <AcuButton size="sm" :disabled="!!sqlFlow.busyAction.value" @click="sqlFlow.showSchema">
            <i class="fa-solid fa-sitemap"></i>
            查看表结构
          </AcuButton>
        </div>

        <AcuFormRow label="SQL 语句" hint="Ctrl / Command + Enter 执行；多行语句会原样交给 SQLite provider 处理。">
          <AcuTextarea
            :model-value="sqlFlow.sqlText.value"
            :rows="10"
            placeholder="SELECT * FROM 表名;&#10;&#10;UPDATE 表名 SET 列名 = '新值' WHERE row_id = 1;"
            class="acu-v2-advanced-tools-page__sql-textarea"
            aria-label="SQL 语句"
            @update:model-value="sqlFlow.sqlText.value = $event"
            @keydown="onSqlEditorKeydown"
          />
        </AcuFormRow>

        <div class="acu-v2-advanced-tools-page__sql-actions">
          <AcuButton
            variant="primary"
            :loading="sqlFlow.busyAction.value === 'execute'"
            :disabled="!sqlFlow.hasSqlText.value"
            @click="sqlFlow.executeCurrent"
          >
            <i class="fa-solid fa-play"></i>
            执行
          </AcuButton>
          <AcuButton :disabled="!sqlFlow.hasSqlText.value || !!sqlFlow.busyAction.value" @click="sqlFlow.clearSql">
            <i class="fa-solid fa-eraser"></i>
            清空
          </AcuButton>
          <span class="acu-v2-advanced-tools-page__sql-status" :class="`acu-v2-advanced-tools-page__sql-status--${sqlFlow.statusKind.value}`">
            {{ sqlFlow.statusLabel.value }}
          </span>
        </div>

        <section class="acu-v2-advanced-tools-page__sql-result-section" aria-label="SQL 执行结果">
          <h4 class="acu-v2-advanced-tools-page__section-title">结果</h4>
          <div v-if="sqlFlow.result.value.kind === 'idle'" class="acu-v2-advanced-tools-page__empty">
            执行 SQL 后结果会显示在这里
          </div>

          <AcuMessage v-else-if="sqlFlow.result.value.kind === 'mutation'" kind="success">
            执行成功，{{ sqlFlow.result.value.changes }} 行受影响，耗时 {{ sqlFlow.result.value.elapsedMs }}ms。
          </AcuMessage>

          <pre v-else-if="sqlFlow.result.value.kind === 'error'" class="acu-v2-advanced-tools-page__sql-error">{{ sqlFlow.result.value.error }}</pre>

          <template v-else>
            <div class="acu-v2-advanced-tools-page__sql-table-wrap">
              <table class="acu-v2-advanced-tools-page__sql-result-table">
                <thead>
                  <tr>
                    <th v-for="column in sqlFlow.result.value.columns" :key="column">{{ column }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!sqlFlow.result.value.values.length">
                    <td :colspan="Math.max(sqlFlow.result.value.columns.length, 1)" class="acu-v2-advanced-tools-page__empty-cell">
                      查询成功，没有返回行
                    </td>
                  </tr>
                  <tr v-for="(row, rowIndex) in sqlFlow.result.value.values" :key="rowIndex">
                    <td v-for="(cell, cellIndex) in row" :key="cellIndex" :class="{ 'acu-v2-advanced-tools-page__cell-null': cell === null }">
                      {{ formatSqlCell(cell) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="acu-v2-advanced-tools-page__sql-result-meta">
              {{ sqlFlow.result.value.rowCount }} 行 · {{ sqlFlow.result.value.elapsedMs }}ms
            </p>
          </template>
        </section>

        <section class="acu-v2-advanced-tools-page__sql-history-section" aria-label="SQL 执行历史">
          <h4 class="acu-v2-advanced-tools-page__section-title">执行历史</h4>
          <div v-if="!sqlFlow.history.value.length" class="acu-v2-advanced-tools-page__empty acu-v2-advanced-tools-page__empty--compact">
            暂无执行历史
          </div>
          <div v-else class="acu-v2-advanced-tools-page__sql-history-list">
            <AcuButton
              v-for="(item, index) in sqlFlow.history.value"
              :key="`${item.timestamp}-${index}`"
              class="acu-v2-advanced-tools-page__sql-history-item"
              :class="item.success ? 'acu-v2-advanced-tools-page__sql-history-item--success' : 'acu-v2-advanced-tools-page__sql-history-item--failure'"
              title="填入编辑器"
              @click="sqlFlow.useHistoryItem(item)"
            >
              <div class="acu-v2-advanced-tools-page__log-meta acu-v2-advanced-tools-page__sql-history-meta">
                <span class="acu-v2-advanced-tools-page__log-time">{{ formatTime(item.timestamp) }}</span>
                <AcuBadge :variant="item.success ? 'success' : 'danger'">
                  {{ item.success ? '成功' : '失败' }}
                </AcuBadge>
              </div>
              <code class="acu-v2-advanced-tools-page__log-message acu-v2-advanced-tools-page__log-body">{{ item.sql }}</code>
            </AcuButton>
          </div>
        </section>
      </AcuPanel>

      <AcuPanel
        id="advanced-tools-log-panel"
        class="acu-v2-advanced-tools-page__log-panel"
        :title="advancedToolsCopy.panels.logs.title"
        :description="advancedToolsCopy.panels.logs.description"
      >
        <template #actions>
          <AcuBadge :variant="logFlow.paused.value ? 'warning' : 'success'">
            {{ logFlow.statusLabel.value }}
          </AcuBadge>
          <AcuBadge :variant="logFlow.debugLogEnabled.value ? 'accent' : 'neutral'">
            {{ logFlow.debugLabel.value }}
          </AcuBadge>
          <AcuBadge :variant="logFlow.warnLogEnabled.value ? 'warning' : 'neutral'">
            {{ logFlow.warnLabel.value }}
          </AcuBadge>
        </template>

        <div class="acu-v2-advanced-tools-page__filter-grid">
          <AcuFormRow>
            <AcuSelect
              :options="logFlow.levelOptions"
              :model-value="logFlow.levelFilter.value"
              @update:model-value="setLogLevelFilter"
            />
          </AcuFormRow>
          <AcuFormRow>
            <AcuSelect
              :options="logFlow.tagOptions.value"
              :model-value="logFlow.tagFilter.value"
              @update:model-value="logFlow.tagFilter.value = $event"
            />
          </AcuFormRow>
          <AcuFormRow class="acu-v2-advanced-tools-page__keyword-row">
            <AcuInput
              :model-value="logFlow.keyword.value"
              type="text"
              placeholder="搜索日志内容"
              @update:model-value="logFlow.keyword.value = String($event)"
            />
          </AcuFormRow>
        </div>

        <div class="acu-v2-advanced-tools-page__log-control-row">
          <div class="acu-v2-advanced-tools-page__log-control-main">
            <div class="acu-v2-advanced-tools-page__log-actions">
              <AcuButton :variant="logFlow.paused.value ? 'primary' : 'default'" @click="logFlow.setPaused(!logFlow.paused.value)">
                <i :class="logFlow.paused.value ? 'fa-solid fa-play' : 'fa-solid fa-pause'"></i>
                暂停
              </AcuButton>
              <AcuButton :disabled="!logFlow.totalCount.value" @click="logFlow.exportFiltered">
                <i class="fa-solid fa-upload"></i>
                导出
              </AcuButton>
              <AcuButton variant="danger" :disabled="!logFlow.totalCount.value" @click="logFlow.clearAll">
                <i class="fa-solid fa-trash"></i>
                清空
              </AcuButton>
            </div>

            <div class="acu-v2-advanced-tools-page__toggles">
              <AcuToggle
                :model-value="logFlow.autoScroll.value"
                label="自动滚动"
                @update:model-value="logFlow.autoScroll.value = $event"
              />
              <AcuToggle
                :model-value="logFlow.warnLogEnabled.value"
                label="Warn"
                @update:model-value="logFlow.setWarnCollection"
              />
              <AcuToggle
                :model-value="logFlow.debugLogEnabled.value"
                label="Debug"
                @update:model-value="logFlow.setDebugCollection"
              />
            </div>
          </div>

          <p class="acu-v2-advanced-tools-page__hint">
            最多保留最近 2000 条；当前显示 {{ logFlow.filteredCount.value }} / {{ logFlow.totalCount.value }} 条。{{ logFlow.pendingCount.value ? `${logFlow.pendingCount.value} 条暂停期间新增日志等待显示。` : '没有暂停期间积压的日志。' }}
          </p>
        </div>

        <div ref="logListRef" class="acu-v2-advanced-tools-page__log-list" role="log" aria-live="polite">
          <div v-if="!logFlow.visibleLogs.value.length" class="acu-v2-advanced-tools-page__empty acu-v2-advanced-tools-page__empty--log">
            暂无匹配日志
          </div>
          <div
            v-for="entry in logFlow.visibleLogs.value"
            :key="entry.id"
            class="acu-v2-advanced-tools-page__log-row"
            :class="`acu-v2-advanced-tools-page__log-row--${entry.level}`"
          >
            <div class="acu-v2-advanced-tools-page__log-meta">
              <span class="acu-v2-advanced-tools-page__log-time">{{ formatTime(entry.timestamp) }}</span>
              <AcuBadge :variant="logLevelVariant(entry.level)">{{ entry.level.toUpperCase() }}</AcuBadge>
              <span class="acu-v2-advanced-tools-page__log-tag">{{ entry.tag }}</span>
            </div>
            <code class="acu-v2-advanced-tools-page__log-message acu-v2-advanced-tools-page__log-body">{{ entry.message }}</code>
            <details
              v-if="hintFor(entry)"
              class="acu-v2-advanced-tools-page__log-hint"
              :data-hint-id="hintFor(entry)!.id"
            >
              <summary class="acu-v2-advanced-tools-page__log-hint-summary">
                <i class="fa-solid fa-lightbulb acu-v2-advanced-tools-page__log-hint-icon" aria-hidden="true"></i>
                <span class="acu-v2-advanced-tools-page__log-hint-text">{{ hintFor(entry)!.summary }}</span>
                <span class="acu-v2-advanced-tools-page__log-hint-toggle">怎么处理</span>
              </summary>
              <ol class="acu-v2-advanced-tools-page__log-hint-steps">
                <li v-for="(step, stepIndex) in hintFor(entry)!.steps" :key="stepIndex">{{ step }}</li>
              </ol>
            </details>
          </div>
        </div>
      </AcuPanel>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import AcuBadge, { type AcuBadgeVariant } from '../components/_lib/AcuBadge.vue';
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuFormRow from '../components/_lib/AcuFormRow.vue';
import AcuInput from '../components/_lib/AcuInput.vue';
import AcuMessage from '../components/_lib/AcuMessage.vue';
import AcuMobilePanelNav from '../components/_lib/AcuMobilePanelNav.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import AcuSelect from '../components/_lib/AcuSelect.vue';
import AcuTextarea from '../components/_lib/AcuTextarea.vue';
import AcuToggle from '../components/_lib/AcuToggle.vue';
import { type LogEntry, type LogLevel } from '../../shared/log-buffer';
import { useSqlConsole } from '../composables/useSqlConsole';
import { type LogErrorHint, resolveLogErrorHint } from '../composables/log-error-hints';
import { type LogLevelFilter, useLogViewer } from '../composables/useLogViewer';
import { advancedToolsCopy } from '../copy/advanced-tools-copy';

const sqlFlow = useSqlConsole();
const logFlow = useLogViewer();
const logListRef = ref<HTMLElement | null>(null);

/** 日志条目不可变，按 id 缓存匹配结果，避免每次列表刷新都对全部条目重跑规则。 */
const hintCache = new Map<number, LogErrorHint | null>();

function hintFor(entry: LogEntry): LogErrorHint | null {
  if (entry.level !== 'error') return null;
  let hint = hintCache.get(entry.id);
  if (hint === undefined) {
    hint = resolveLogErrorHint(entry);
    // 缓冲区上限 2000 条，缓存略大于它即可；超出时整体清掉，避免长期运行后无限增长。
    if (hintCache.size > 4000) hintCache.clear();
    hintCache.set(entry.id, hint);
  }
  return hint;
}
const panelNavItems = [
  { id: 'advanced-tools-sql-panel', label: advancedToolsCopy.nav.sql },
  { id: 'advanced-tools-log-panel', label: advancedToolsCopy.nav.logs },
];

function onSqlEditorKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    sqlFlow.executeCurrent();
  }
}

function formatTime(timestamp: number): string {
  const time = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${time}.${String(timestamp % 1000).padStart(3, '0')}`;
}

function formatSqlCell(value: string | number | Uint8Array | null): string {
  if (value === null) return 'NULL';
  if (value instanceof Uint8Array) return `BLOB(${value.byteLength})`;
  return String(value);
}

function logLevelVariant(level: LogLevel): AcuBadgeVariant {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'warning';
  return 'accent';
}

function setLogLevelFilter(value: string): void {
  logFlow.levelFilter.value = value as LogLevelFilter;
}

async function scrollLogListToTop(): Promise<void> {
  if (!logFlow.autoScroll.value) return;
  await nextTick();
  if (logListRef.value) logListRef.value.scrollTop = 0;
}

onMounted(sqlFlow.refresh);
watch(() => logFlow.visibleLogs.value.length, scrollLogListToTop, { flush: 'post' });
</script>

<style scoped>
.acu-v2-advanced-tools-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-advanced-tools-page__sql-panel,
.acu-v2-advanced-tools-page__log-panel {
  min-width: 0;
}

.acu-v2-advanced-tools-page__quick-actions,
.acu-v2-advanced-tools-page__log-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.acu-v2-advanced-tools-page__sql-textarea {
  font-family: var(--acu-font-mono);
  min-height: 210px;
  white-space: pre;
}

.acu-v2-advanced-tools-page__sql-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  padding-top: 12px;
  margin-top: 4px;
}

.acu-v2-advanced-tools-page__sql-status {
  margin-left: auto;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.5;
}

.acu-v2-advanced-tools-page__sql-status--success {
  color: var(--acu-success);
}

.acu-v2-advanced-tools-page__sql-status--warning {
  color: var(--acu-warning);
}

.acu-v2-advanced-tools-page__sql-status--error {
  color: var(--acu-danger);
}

.acu-v2-advanced-tools-page__sql-result-section,
.acu-v2-advanced-tools-page__sql-history-section {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.acu-v2-advanced-tools-page__sql-history-section {
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
}

.acu-v2-advanced-tools-page__section-title {
  margin: 0;
  color: var(--acu-text-1);
  font-size: var(--acu-font-size-body-lg, 13px);
  font-weight: 600;
  line-height: 1.35;
}

.acu-v2-advanced-tools-page__empty {
  min-height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
  text-align: center;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-radius: 0;
  background: transparent;
}

.acu-v2-advanced-tools-page__empty--compact {
  min-height: 72px;
}

.acu-v2-advanced-tools-page__empty--log {
  min-height: 180px;
  border: 0;
}

.acu-v2-advanced-tools-page__sql-table-wrap {
  max-height: 330px;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-radius: var(--acu-radius-sm);
  background: transparent;
}

.acu-v2-advanced-tools-page__sql-result-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-body, 12px);
}

.acu-v2-advanced-tools-page__sql-result-table th,
.acu-v2-advanced-tools-page__sql-result-table td {
  max-width: 300px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--acu-border-2);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.acu-v2-advanced-tools-page__sql-result-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--acu-bg-1);
  color: var(--acu-text-1);
  font-weight: 600;
}

.acu-v2-advanced-tools-page__sql-result-table tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--acu-text-3) 5%, transparent);
}

.acu-v2-advanced-tools-page__cell-null,
.acu-v2-advanced-tools-page__empty-cell {
  color: var(--acu-text-3);
  font-style: italic;
}

.acu-v2-advanced-tools-page__sql-result-meta {
  margin: 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
  text-align: right;
}

.acu-v2-advanced-tools-page__sql-error {
  margin: 0;
  min-height: 96px;
  padding: 12px;
  border: 0;
  border-radius: var(--acu-radius-sm);
  background: color-mix(in srgb, var(--acu-danger) 8%, transparent);
  color: var(--acu-danger);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
}

.acu-v2-advanced-tools-page__filter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: stretch;
}

.acu-v2-advanced-tools-page__keyword-row {
  grid-column: 1 / -1;
}

.acu-v2-advanced-tools-page__log-control-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.acu-v2-advanced-tools-page__log-control-main {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: center;
  justify-content: space-between;
}

.acu-v2-advanced-tools-page__toggles {
  width: max-content;
  max-width: 100%;
  display: grid;
  grid-template-columns: max-content max-content;
  gap: 10px 18px;
  align-items: center;
  justify-content: flex-start;
}

.acu-v2-advanced-tools-page__toggles :deep(.acu-toggle) {
  width: max-content;
  max-width: none;
  min-width: max-content;
  white-space: nowrap;
}

.acu-v2-advanced-tools-page__toggles :deep(.acu-toggle__label) {
  white-space: nowrap;
}

.acu-v2-advanced-tools-page__hint {
  max-width: 100%;
  margin: 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.acu-v2-advanced-tools-page__sql-history-list,
.acu-v2-advanced-tools-page__log-list {
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-radius: var(--acu-radius-sm);
  background: transparent;
}

.acu-v2-advanced-tools-page__sql-history-list {
  max-height: 230px;
}

.acu-v2-advanced-tools-page__log-list {
  min-height: 360px;
  max-height: 58vh;
}

.acu-v2-advanced-tools-page__sql-history-item,
.acu-v2-advanced-tools-page__log-row {
  min-width: 0;
  display: grid;
  gap: 8px;
  align-items: baseline;
  padding: 7px 10px;
  border-bottom: 1px solid var(--acu-border-2);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
}

.acu-v2-advanced-tools-page__sql-history-item.acu-btn {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding-block: 9px;
  border: 0;
  border-bottom: 1px solid var(--acu-border-2);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.acu-v2-advanced-tools-page__log-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding-block: 9px;
}

.acu-v2-advanced-tools-page__log-meta {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  align-items: center;
}

.acu-v2-advanced-tools-page__sql-history-meta {
  flex-wrap: nowrap;
}

.acu-v2-advanced-tools-page__sql-history-item:last-child,
.acu-v2-advanced-tools-page__log-row:last-child {
  border-bottom: 0;
}

.acu-v2-advanced-tools-page__sql-history-item--failure,
.acu-v2-advanced-tools-page__log-row--error {
  background: color-mix(in srgb, var(--acu-danger) 7%, transparent);
}

.acu-v2-advanced-tools-page__log-row--warn {
  background: color-mix(in srgb, var(--acu-warning) 6%, transparent);
}

.acu-v2-advanced-tools-page__sql-history-item.acu-btn:hover {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), transparent;
}

.acu-v2-advanced-tools-page__sql-history-item.acu-btn:focus-visible {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), transparent;
  box-shadow: inset 0 0 0 2px var(--acu-accent-glow);
  outline: none;
}

.acu-v2-advanced-tools-page__log-time,
.acu-v2-advanced-tools-page__log-tag,
.acu-v2-advanced-tools-page__log-message {
  min-width: 0;
  font-family: var(--acu-font-mono);
}

.acu-v2-advanced-tools-page__log-time {
  color: var(--acu-text-3);
  white-space: nowrap;
}

.acu-v2-advanced-tools-page__log-tag {
  flex: 1 1 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--acu-text-2);
}

.acu-v2-advanced-tools-page__log-message {
  margin: 0;
  color: var(--acu-text-1);
  white-space: pre-wrap;
  word-break: break-word;
  background: transparent;
}

.acu-v2-advanced-tools-page__log-body {
  display: block;
  width: 100%;
}

.acu-v2-advanced-tools-page__log-hint {
  min-width: 0;
  margin-top: 2px;
  border-left: 2px solid color-mix(in srgb, var(--acu-warning) 70%, transparent);
  border-radius: 0 var(--acu-radius-sm) var(--acu-radius-sm) 0;
  background: color-mix(in srgb, var(--acu-warning) 6%, var(--acu-bg-1));
  font-family: var(--acu-font-sans, inherit);
  font-size: var(--acu-font-size-body, 12px);
  line-height: 1.55;
}

.acu-v2-advanced-tools-page__log-hint-summary {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 10px;
  color: var(--acu-text-2);
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.acu-v2-advanced-tools-page__log-hint-summary::-webkit-details-marker {
  display: none;
}

.acu-v2-advanced-tools-page__log-hint-summary:hover {
  background: var(--acu-hover-overlay);
}

.acu-v2-advanced-tools-page__log-hint-summary:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--acu-accent-glow);
}

.acu-v2-advanced-tools-page__log-hint-icon {
  flex: 0 0 auto;
  color: var(--acu-warning);
  font-size: var(--acu-font-size-caption, 11px);
}

.acu-v2-advanced-tools-page__log-hint-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.acu-v2-advanced-tools-page__log-hint-toggle {
  flex: 0 0 auto;
  color: var(--acu-accent);
  font-size: var(--acu-font-size-caption, 11px);
  white-space: nowrap;
}

.acu-v2-advanced-tools-page__log-hint-toggle::after {
  content: ' ▾';
}

.acu-v2-advanced-tools-page__log-hint[open] .acu-v2-advanced-tools-page__log-hint-toggle::after {
  content: ' ▴';
}

.acu-v2-advanced-tools-page__log-hint-steps {
  margin: 0;
  padding: 2px 10px 8px 30px;
  color: var(--acu-text-2);
}

.acu-v2-advanced-tools-page__log-hint-steps li {
  margin: 2px 0;
  overflow-wrap: anywhere;
}

@media (max-width: 1080px) {
  .acu-v2-advanced-tools-page {
    padding: 14px;
  }

  .acu-v2-advanced-tools-page__sql-actions {
    justify-content: stretch;
  }

  .acu-v2-advanced-tools-page__sql-status {
    width: 100%;
    margin-left: 0;
    text-align: right;
  }

  .acu-v2-advanced-tools-page__filter-grid {
    grid-template-columns: 1fr;
  }

  .acu-v2-advanced-tools-page__log-control-main {
    align-items: stretch;
    flex-direction: column;
    justify-content: flex-start;
  }

  .acu-v2-advanced-tools-page__toggles {
    align-self: flex-start;
  }

  .acu-v2-advanced-tools-page__sql-history-item,
  .acu-v2-advanced-tools-page__log-row {
    padding-inline: 9px;
  }
}
</style>
