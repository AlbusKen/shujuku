/**
 * page-registry — 一级页静态注册表（plan §4.1 + §D24）
 *
 * 注册项一旦合并到表里就不可变；需要新增页直接追加。可见性依赖运行时状态
 * 的页通过 requiresSqlite / featureGate / visibleWhen 表达，由 router store
 * 在请求 visiblePages 时计算。
 */
import { markRaw } from 'vue';
import type { AcuV2Page } from './page-types';

import BasicConfigPage from '../pages/BasicConfigPage.vue';
import DashboardPage from '../pages/DashboardPage.vue';
import FormFillPage from '../pages/FormFillPage.vue';
import TablePage from '../pages/TablePage.vue';
import ApiPage from '../pages/ApiPage.vue';
import PlotPage from '../pages/PlotPage.vue';
import AgentPage from '../pages/AgentPage.vue';
import ContinuationPage from '../pages/ContinuationPage.vue';
import WorldSimulationPage from '../pages/WorldSimulationPage.vue';
import ImportPage from '../pages/ImportPage.vue';
import VectorIndexPage from '../pages/VectorIndexPage.vue';
import DataMgmtPage from '../pages/DataMgmtPage.vue';
import ContentReplacePage from '../pages/ContentReplacePage.vue';
import AdvancedToolsPage from '../pages/AdvancedToolsPage.vue';
import DeveloperPage from '../pages/DeveloperPage.vue';
import { dashboardCopy } from '../copy/dashboard-copy';
import { useDevOptionsStore } from '../stores/dev-options-store';

/** 正文替换页对应的 feature gate key；页面可见性由仪表盘常驻的正文替换启用开关控制。 */
export const FEATURE_GATE_CONTENT_REPLACE = 'content-replace';
export const FEATURE_GATE_PLOT = 'plot';
export const FEATURE_GATE_CONTINUATION = 'continuation';
export const FEATURE_GATE_WORLD_SIMULATION = 'world-simulation';
export const FEATURE_GATE_IMPORT = 'import';
export const FEATURE_GATE_VECTOR_INDEX = 'vector-index';
export const ACU_V2_BASIC_PAGE_ID = 'basic-config';

export const ACU_V2_PAGE_REGISTRY: readonly AcuV2Page[] = Object.freeze([
  // 基础模式
  { id: ACU_V2_BASIC_PAGE_ID, title: '基础配置', group: 'overview', component: markRaw(BasicConfigPage) },

  // 概览
  { id: 'dashboard', title: dashboardCopy.pageTitle, group: 'overview', component: markRaw(DashboardPage) },

  // 配置
  { id: 'form-fill', title: '填表工作台', group: 'config', component: markRaw(FormFillPage) },
  { id: 'table', title: '填表规则', group: 'config', component: markRaw(TablePage) },
  { id: 'plot', title: '剧情推进', group: 'config', component: markRaw(PlotPage), featureGate: FEATURE_GATE_PLOT },
  { id: 'agent', title: 'Agent', group: 'config', component: markRaw(AgentPage) },
  { id: 'api', title: 'API', group: 'config', component: markRaw(ApiPage) },

  // 功能
  { id: 'continuation', title: '智能续写', group: 'feature', component: markRaw(ContinuationPage), featureGate: FEATURE_GATE_CONTINUATION },
  { id: 'world-simulation', title: '世界推演', group: 'feature', component: markRaw(WorldSimulationPage), featureGate: FEATURE_GATE_WORLD_SIMULATION },
  { id: 'import', title: '外部导入', group: 'feature', component: markRaw(ImportPage), featureGate: FEATURE_GATE_IMPORT },
  { id: 'vector-index', title: '交火模式', group: 'feature', component: markRaw(VectorIndexPage), featureGate: FEATURE_GATE_VECTOR_INDEX },
  {
    id: 'content-replace',
    title: '正文替换',
    group: 'feature',
    component: markRaw(ContentReplacePage),
    featureGate: FEATURE_GATE_CONTENT_REPLACE,
  },

  // 工具
  { id: 'data-mgmt', title: '数据管理', group: 'tool', component: markRaw(DataMgmtPage) },
  { id: 'advanced-tools', title: '高级工具', group: 'tool', component: markRaw(AdvancedToolsPage) },

  // 开发者（plan §D24：仪表盘"启用开发者选项"总开关 gate）
  {
    id: 'developer',
    title: '开发者选项',
    group: 'developer',
    component: markRaw(DeveloperPage),
    visibleWhen: () => useDevOptionsStore().developerOptionsEnabled,
  },
]);

export const ACU_V2_DEFAULT_PAGE_ID = 'dashboard';
