<template>
  <AcuDrawer
    :is-open="isOpen"
    title="编辑 AI 改表助手提示词"
    width="720px"
    :before-close="confirmIfDirty"
    @close="emit('close')"
  >
    <AcuMessage v-if="message" :kind="message.kind">
      {{ message.text }}
    </AcuMessage>

    <details class="acu-assistant-prompt-drawer__placeholders">
      <summary>可用占位符（{{ placeholderDocs.length }}）</summary>
      <div class="acu-assistant-prompt-drawer__placeholder-group">
        <p class="acu-assistant-prompt-drawer__placeholder-note">
          提示词中出现任一数据占位符即视为你接管数据注入，系统不再自动追加数据消息；真实历史上下文会插入在最后一个
          <code>{{ userRequestToken }}</code> 之前。
        </p>
        <ul class="acu-assistant-prompt-drawer__placeholder-list">
          <li
            v-for="doc in dataDocs"
            :key="doc.token"
            class="acu-assistant-prompt-drawer__placeholder-item"
          >
            <code>{{ doc.token }}</code>
            <strong>{{ doc.label }}</strong>
            <span>{{ doc.description }}</span>
          </li>
        </ul>
      </div>
      <div v-if="referenceDocs.length > 0" class="acu-assistant-prompt-drawer__placeholder-group">
        <ul class="acu-assistant-prompt-drawer__placeholder-list">
          <li
            v-for="doc in referenceDocs"
            :key="doc.token"
            class="acu-assistant-prompt-drawer__placeholder-item"
          >
            <code>{{ doc.token }}</code>
            <strong>{{ doc.label }}</strong>
            <span>{{ doc.description }}</span>
          </li>
        </ul>
      </div>
    </details>

    <div class="acu-assistant-prompt-drawer__toolbar">
      <AcuFileButton size="sm" accept="application/json,.json" @file="$emit('import-file', $event)">
        <i class="fa-solid fa-download"></i> 导入 JSON
      </AcuFileButton>
      <AcuButton size="sm" @click="$emit('export')">
        <i class="fa-solid fa-upload"></i> 导出 JSON
      </AcuButton>
      <AcuButton size="sm" variant="primary" @click="$emit('reset')">载入默认提示词</AcuButton>
    </div>

    <AcuPromptSegments
      :segments="segments"
      :show-slot="false"
      :rows="8"
      empty-text="暂无提示词段。点击下方按钮添加第一段。"
      @add="$emit('add', $event)"
      @delete="$emit('delete', $event)"
      @update="(index, patch) => $emit('update', index, patch)"
    />

    <footer class="acu-assistant-prompt-drawer__actions">
      <AcuButton @click="requestClose">关闭</AcuButton>
      <AcuButton variant="primary" :disabled="!dirty" @click="$emit('save')">保存提示词</AcuButton>
    </footer>
  </AcuDrawer>
</template>

<script setup lang="ts">
import AcuButton from './_lib/AcuButton.vue';
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuFileButton from './_lib/AcuFileButton.vue';
import AcuInfoBanner from './_lib/AcuInfoBanner.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPromptSegments, { type PromptSegment } from './_lib/AcuPromptSegments.vue';
import { useDialogStore } from '../stores/dialog-store';
import { useTemplateAssistantPromptDocs } from '../composables/useTemplateAssistantPromptDocs';

const props = defineProps<{
  isOpen: boolean;
  segments: PromptSegment[];
  dirty: boolean;
  message: { kind: 'info' | 'success' | 'warning' | 'error'; text: string } | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save'): void;
  (e: 'reset'): void;
  (e: 'import-file', file: File): void;
  (e: 'export'): void;
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'update', index: number, patch: Partial<PromptSegment>): void;
}>();

const { placeholderDocs, dataDocs, referenceDocs, userRequestToken } = useTemplateAssistantPromptDocs();
const dialogStore = useDialogStore();

async function confirmIfDirty(): Promise<boolean> {
  if (!props.dirty) return true;
  return dialogStore.confirm({
    title: '关闭提示词编辑器',
    message: '你有未保存的提示词修改，确定要关闭吗？',
    confirmLabel: '关闭',
    confirmVariant: 'danger',
  });
}

async function requestClose(): Promise<void> {
  if (await confirmIfDirty()) emit('close');
}
</script>

<style scoped>
.acu-assistant-prompt-drawer__placeholders {
  margin-bottom: 12px;
}

.acu-assistant-prompt-drawer__placeholders summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--acu-text-2);
  user-select: none;
}

.acu-assistant-prompt-drawer__placeholder-group {
  margin-top: 8px;
}

.acu-assistant-prompt-drawer__placeholder-note {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--acu-text-2);
}

.acu-assistant-prompt-drawer__placeholder-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.acu-assistant-prompt-drawer__placeholder-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--acu-text-1);
}

.acu-assistant-prompt-drawer__placeholder-item code {
  flex-shrink: 0;
  font-size: 11px;
}

.acu-assistant-prompt-drawer__placeholder-item span {
  color: var(--acu-text-2);
}

.acu-assistant-prompt-drawer__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.acu-assistant-prompt-drawer__actions {
  position: sticky;
  bottom: -16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 0;
  background: var(--acu-bg-1);
}
</style>
