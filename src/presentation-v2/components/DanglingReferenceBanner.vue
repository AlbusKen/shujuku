<template>
  <AcuMessage v-if="audit.items.value.length || audit.error.value" kind="warning">
    <p v-if="audit.error.value" class="acu-dangling-reference-banner__error">{{ audit.error.value }}</p>
    <p class="acu-dangling-reference-banner__intro">
      下列引用指向已不存在的{{ kindLabel }}，不会自动改写已保存的设置。可一键清除后重新选择。
    </p>
    <ul class="acu-dangling-reference-banner__list">
      <li v-for="item in audit.items.value" :key="item.id" class="acu-dangling-reference-banner__item">
        <span>
          {{ item.label }}「{{ item.name }}」已不存在
        </span>
        <AcuButton
          size="sm"
          :disabled="audit.clearingId.value === item.id"
          @click="audit.clear(item)"
        >
          清除引用
        </AcuButton>
      </li>
    </ul>
  </AcuMessage>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import { useDanglingReferenceAudit, type DanglingReferenceScope_ACU } from '../composables/useDanglingReferenceAudit';

const props = defineProps<{
  scope: DanglingReferenceScope_ACU;
}>();

const audit = useDanglingReferenceAudit(props.scope);
const kindLabel = computed(() => (props.scope === 'worldbook' ? '世界书' : 'API 预设'));
</script>

<style scoped>
.acu-dangling-reference-banner__intro,
.acu-dangling-reference-banner__error {
  margin: 0 0 8px;
}

.acu-dangling-reference-banner__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acu-dangling-reference-banner__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>
