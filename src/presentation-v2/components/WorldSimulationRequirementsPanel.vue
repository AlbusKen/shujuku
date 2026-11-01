<template>
  <div class="acu-v2-ws-requirements">
    <p v-if="userRequirements.diagnostics.length" class="acu-v2-ws-requirements__error">{{ userRequirements.diagnostics.join('；') }}</p>
    <p v-else-if="!userRequirements.snapshot?.requirements.length" class="acu-v2-ws-requirements__empty">暂无用户要求。</p>
    <UserRequirementsEditor
      editor-id="simulation"
      :show-hint="false"
      :items="requirementsDraft"
      :dirty="requirementsDirty"
      :error="requirementsError"
      :saving="requirementsSaving"
      :disabled="busy || !!userRequirements.diagnostics.length"
      @update:items="updateRequirementsDraft"
      @discard="discardRequirementsDraft"
      @save="saveRequirementsDraft"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import UserRequirementsEditor from './UserRequirementsEditor.vue';
import type { WorldSimulationUserRequirementsReadResult_ACU } from '../../service/simulation/agent/agent-model';

const props = withDefaults(defineProps<{
  chatIdentity: string | null;
  userRequirements: WorldSimulationUserRequirementsReadResult_ACU;
  saveRequirements: (requirements: string[]) => Promise<boolean>;
  busy?: boolean;
}>(), { busy: false });
const requirementsDraft = ref<string[]>([]);
const requirementsDirty = ref(false);
const requirementsError = ref('');
const requirementsSaving = ref(false);
const awaitingRequirementsSnapshot = ref<string | null>(null);
let requirementsChatIdentity: string | null = null;
let latestRequirementsUpdatedAt = -1;

watch(() => [props.chatIdentity, props.userRequirements.snapshot] as const, () => {
  if (props.chatIdentity !== requirementsChatIdentity) {
    requirementsChatIdentity = props.chatIdentity;
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
  if (!requirementsDirty.value || requirementsSaving.value || props.busy || props.userRequirements.diagnostics.length) return;
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
      } else awaitingRequirementsSnapshot.value = JSON.stringify(observed?.requirements ?? []);
      requirementsDirty.value = false;
      requirementsDraft.value = [...payload];
      requirementsError.value = '';
    } else requirementsError.value = '保存失败，修改已保留。请检查提示后重试。';
  } catch (error) {
    requirementsError.value = error instanceof Error ? `保存失败，修改已保留：${error.message}` : '保存失败，修改已保留。';
  } finally { requirementsSaving.value = false; }
}
</script>

<style scoped>
.acu-v2-ws-requirements { display: grid; gap: 10px; }
.acu-v2-ws-requirements__error, .acu-v2-ws-requirements__empty { margin: 0; font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; overflow-wrap: anywhere; }
.acu-v2-ws-requirements__error { color: var(--acu-danger, #d65b5b); }
.acu-v2-ws-requirements__empty { color: var(--acu-text-3); }
</style>
