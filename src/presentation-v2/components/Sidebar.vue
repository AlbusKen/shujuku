<template>
  <nav :class="['acu-v2-sidebar', `acu-v2-sidebar--${variant}`]" aria-label="一级页导航">
    <div class="acu-v2-sidebar__brand">
      <span class="acu-v2-sidebar__brand-mark" aria-hidden="true">SP</span>
      <span class="acu-v2-sidebar__brand-copy">
        <button
          type="button"
          class="acu-v2-sidebar__brand-title"
          aria-label="SP·数据库 IX（连续点击五次打开功能档位设置）"
          @click="onBrandTitleClick"
        >SP·数据库 IX</button>
        <span class="acu-v2-sidebar__brand-tag">新 UI · {{ uiMode.modeLabel }}</span>
      </span>
    </div>

    <template v-for="group in router.groups" :key="group.id">
      <div
        v-if="(router.visiblePagesByGroup[group.id] || []).length"
        class="acu-v2-sidebar__group"
      >
        <div class="acu-v2-sidebar__group-title">{{ group.title }}</div>
        <button
          v-for="page in router.visiblePagesByGroup[group.id]"
          :key="page.id"
          type="button"
          :class="[
            'acu-v2-sidebar__item',
            page.id === router.activePageId ? 'acu-v2-sidebar__item--active' : '',
          ]"
          :aria-current="page.id === router.activePageId ? 'page' : undefined"
          :data-page-id="page.id"
          @click="setActivePage(page.id)"
        >
          {{ page.title }}
        </button>
      </div>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from '../bootstrap/host-env';
import { useDialogStore } from '../stores/dialog-store';
import { useRouterStore } from '../stores/router-store';
import {
  ACU_UI_TIER_LABELS,
  useUiModeStore,
  type AcuUiTier,
} from '../stores/ui-mode-store';

withDefaults(defineProps<{
  variant?: 'desktop' | 'drawer';
}>(), {
  variant: 'desktop',
});

const emit = defineEmits<{
  (event: 'navigate'): void;
}>();

const router = useRouterStore();
const uiMode = useUiModeStore();
const dialogStore = useDialogStore();
const brandClickCount = ref(0);
let brandClickTimer: AcuTimerHandle | undefined;

const tierDescriptions: Record<AcuUiTier, string> = {
  low: '显示日常填表、模板与基础 API 配置。',
  medium: '在基础功能上显示填表调节、剧情与逻辑召回配置。',
  high: '显示完整诊断、索引维护、数据管理与开发者工具。',
};

function resetBrandClickSequence(): void {
  brandClickCount.value = 0;
  if (brandClickTimer !== undefined) {
    acuClearTimeout(brandClickTimer);
    brandClickTimer = undefined;
  }
}

function onBrandTitleClick(): void {
  brandClickCount.value += 1;
  if (brandClickTimer !== undefined) acuClearTimeout(brandClickTimer);
  brandClickTimer = acuSetTimeout(resetBrandClickSequence, 2000);
  if (brandClickCount.value < 5) return;
  resetBrandClickSequence();
  void openTierDialog();
}

async function openTierDialog(): Promise<void> {
  const currentTier = uiMode.tier;
  const selectableTiers: AcuUiTier[] = currentTier === 'low'
    ? ['low', 'medium']
    : ['low', 'medium', 'high'];
  const selected = await dialogStore.choose<AcuUiTier>({
    title: '功能档位设置',
    badge: { label: `当前：${ACU_UI_TIER_LABELS[currentTier]}`, variant: 'accent' },
    message: [
      ...selectableTiers.map((tier) => `${ACU_UI_TIER_LABELS[tier]}：${tierDescriptions[tier]}`),
      '',
      '档位只影响界面显示，不会改变填表模式或已保存的模式参数。',
    ].join('\n'),
    actions: selectableTiers.map((tier) => ({
      value: tier,
      label: ACU_UI_TIER_LABELS[tier],
      variant: tier === currentTier ? 'default' : tier === 'high' ? 'danger' : 'primary',
    })),
  });
  if (!selected || selected === currentTier) return;

  if (selected === 'medium' && currentTier === 'low') {
    const confirmed = await dialogStore.confirm({
      title: '开启进阶模式',
      message: '将显示更多配置项与诊断入口，但不会改变填表模式、模式参数或历史数据。',
      confirmLabel: '开启进阶模式',
    });
    if (!confirmed) return;
  }

  if (selected === 'high') {
    const confirmed = await dialogStore.confirm({
      title: '准备开启高级模式',
      message: '高级模式会显示索引维护、数据管理、完整诊断和开发者工具。显示这些入口不会自动执行危险操作。',
      confirmLabel: '继续',
      confirmVariant: 'danger',
      confirmCountdownSeconds: 2,
    });
    if (!confirmed) return;
    const phrase = await dialogStore.prompt({
      title: '确认开启高级模式',
      message: '请输入“开启高级功能”以完成解锁。',
      label: '确认短语',
      placeholder: '开启高级功能',
      confirmLabel: '解锁高级模式',
      confirmVariant: 'danger',
    });
    if (phrase !== '开启高级功能') return;
  }

  uiMode.setTier(selected);
  router.ensureActiveVisible();
  emit('navigate');
}

onBeforeUnmount(resetBrandClickSequence);

function setActivePage(pageId: string): void {
  router.setActivePage(pageId);
  emit('navigate');
}

</script>

<style scoped>
.acu-v2-sidebar {
  min-width: 0;
  min-height: 0;
  background: var(--acu-sidebar-bg);
  padding: var(--acu-space-6, 24px) var(--acu-space-3, 12px) var(--acu-panel-padding, 16px);
  overflow-y: auto;
}

.acu-v2-sidebar--desktop {
  width: var(--acu-sidebar-width, 220px);
  flex: 0 0 var(--acu-sidebar-width, 220px);
  border-right: 1px solid var(--acu-border-2);
}

.acu-v2-sidebar--drawer {
  width: 100%;
  flex: 1 1 auto;
}

.acu-v2-sidebar__brand {
  display: flex;
  align-items: center;
  gap: var(--acu-space-250, 10px);
  padding: var(--acu-space-1, 4px) var(--acu-space-1, 4px) var(--acu-space-5, 20px);
  margin-bottom: var(--acu-page-gap, 14px);
}

.acu-v2-sidebar__brand-mark {
  width: var(--acu-space-850, 34px);
  height: var(--acu-space-850, 34px);
  flex: 0 0 var(--acu-space-850, 34px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--acu-radius-md);
  background: var(--acu-accent);
  color: var(--acu-on-accent);
  font-size: var(--acu-font-size-caption, 11px);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.acu-v2-sidebar__brand-copy {
  min-width: 0;
  display: block;
}

.acu-v2-sidebar__brand-title {
  appearance: none;
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  font-size: var(--acu-font-size-panel-title, 15px);
  line-height: 1.25;
  font-weight: 700;
  color: var(--acu-text-1);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acu-v2-sidebar__brand-title:hover,
.acu-v2-sidebar__brand-title:focus-visible {
  color: var(--acu-accent);
}

.acu-v2-sidebar__brand-tag {
  display: block;
  margin-top: var(--acu-space-075, 3px);
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-3);
}

.acu-v2-sidebar__group {
  margin-bottom: var(--acu-panel-gap, 12px);
}

.acu-v2-sidebar__group-title {
  padding: var(--acu-space-175, 7px) var(--acu-space-3, 12px) var(--acu-space-150, 6px);
  font-size: var(--acu-font-size-caption, 11px);
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--acu-text-3);
  text-transform: uppercase;
}

.acu-v2-sidebar__item {
  display: block;
  width: 100%;
  padding: var(--acu-space-250, 10px) var(--acu-space-3, 12px);
  border: 0;
  background: transparent;
  text-align: left;
  font-size: var(--acu-font-size-body-lg, 13px);
  color: var(--acu-text-2);
  cursor: pointer;
  border-radius: var(--acu-radius-sm);
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.acu-v2-sidebar__item:not(.acu-v2-sidebar__item--active):hover {
  background: var(--acu-hover-overlay);
  color: var(--acu-text-1);
}

.acu-v2-sidebar__item--active {
  background: var(--acu-accent);
  color: var(--acu-on-accent);
  font-weight: 600;
}
</style>
