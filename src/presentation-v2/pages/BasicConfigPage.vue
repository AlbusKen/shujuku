<template>
  <section class="acu-v2-basic-config-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <AcuPanelGrid class="acu-v2-basic-config-page__grid">
      <ApiConfigPanel
        id="basic-config-api-panel"
        class="acu-v2-basic-config-page__api"
      />
      <FormFillUpdateSettingsPanel
        id="basic-config-update-panel"
        class="acu-v2-basic-config-page__update"
        :show-advanced="false"
      />
      <TableTemplatePresetPanel
        id="basic-config-table-panel"
        class="acu-v2-basic-config-page__table"
      />
      <PlotPresetPanel
        id="basic-config-plot-panel"
        class="acu-v2-basic-config-page__plot"
      />
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import AcuMobilePanelNav from '../components/_lib/AcuMobilePanelNav.vue';
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import ApiConfigPanel from '../components/ApiConfigPanel.vue';
import FormFillUpdateSettingsPanel from '../components/FormFillUpdateSettingsPanel.vue';
import PlotPresetPanel from '../components/PlotPresetPanel.vue';
import TableTemplatePresetPanel from '../components/TableTemplatePresetPanel.vue';
import { basicConfigCopy } from '../copy/basic-config-copy';

const panelNavItems = [
  { id: 'basic-config-api-panel', label: basicConfigCopy.nav.api },
  { id: 'basic-config-update-panel', label: basicConfigCopy.nav.update },
  { id: 'basic-config-table-panel', label: basicConfigCopy.nav.table },
  { id: 'basic-config-plot-panel', label: basicConfigCopy.nav.plot },
];
</script>

<style scoped>
.acu-v2-basic-config-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.acu-v2-basic-config-page__grid {
  grid-template-areas:
    "api update"
    "api table"
    "api plot";
}

.acu-v2-basic-config-page__api {
  grid-area: api;
}

.acu-v2-basic-config-page__update {
  grid-area: update;
}

.acu-v2-basic-config-page__table {
  grid-area: table;
}

.acu-v2-basic-config-page__plot {
  grid-area: plot;
}

@media (max-width: 860px) {
  .acu-v2-basic-config-page {
    padding: 14px;
  }

  .acu-v2-basic-config-page__grid {
    grid-template-areas:
      "api"
      "update"
      "table"
      "plot";
  }
}
</style>
