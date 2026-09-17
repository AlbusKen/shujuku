<template>
  <section class="ws-page">
    <AcuPanelGrid :columns="2" collapse-at="lg">
      <WorldSimulationWorkspace />
    </AcuPanelGrid>
  </section>
</template>

<script setup lang="ts">
import AcuPanelGrid from '../components/_lib/AcuPanelGrid.vue';
import WorldSimulationWorkspace from '../components/WorldSimulationWorkspace.vue';
</script>

<style scoped>
.ws-page{min-height:100%;min-width:0;padding:20px}@media(max-width:860px){.ws-page{padding:14px}}
</style>
