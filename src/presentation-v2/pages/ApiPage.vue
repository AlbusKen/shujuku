<template>
  <section class="acu-v2-api-page">
    <AcuPanelGrid class="acu-v2-api-page__grid">
      <div class="acu-v2-api-page__col">
        <DanglingReferenceBanner scope="api" />
        <ApiConfigPanel />
      </div>
      <div class="acu-v2-api-page__spacer" aria-hidden="true"></div>
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import ApiConfigPanel from '../components/ApiConfigPanel.vue';
import DanglingReferenceBanner from '../components/DanglingReferenceBanner.vue';
</script>

<style scoped>
.acu-v2-api-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-api-page__spacer {
  min-width: 0;
}

.acu-v2-api-page__col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

@media (max-width: 860px) {
  .acu-v2-api-page {
    padding: 14px;
  }

  .acu-v2-api-page__spacer {
    display: none;
  }
}
</style>
