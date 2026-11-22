<template>
  <div class="acu-viz-global" data-acu-visualizer-global>
    <AcuPanel
      title="全局注入配置"
      description="整套模板的全局配置，控制数据条目的整体注入位置；所有表在世界书里的位置整体不对时检查这里。"
    >
      <PlacementEditor
        title="可读数据条目位置"
        :placement="config.getGlobalPlacement('readableEntryPlacement')"
        :options="config.placementOptions"
        :update-field="(field, value) => config.updateGlobalPlacement('readableEntryPlacement', field, value)"
      />

      <PlacementEditor
        title="包裹条目位置"
        :placement="config.getGlobalPlacement('wrapperPlacement')"
        :options="config.placementOptions"
        :update-field="(field, value) => config.updateGlobalPlacement('wrapperPlacement', field, value)"
      />
    </AcuPanel>
  </div>
</template>

<script setup lang="ts">
import AcuPanel from '../../components/_lib/AcuPanel.vue';
import { useVisualizerConfigEditing } from '../../composables/visualizer/useVisualizerConfigEditing';
import PlacementEditor from './VisualizerPlacementEditor.vue';

const config = useVisualizerConfigEditing();
</script>

<style scoped>
.acu-viz-global {
  min-width: 0;
  display: grid;
  gap: 12px;
}

</style>
