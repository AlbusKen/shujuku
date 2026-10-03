/**
 * page-registry — 一级页静态注册表（plan §4.1 + §D24）
 *
 * 页面 id 保持稳定；退役页面通过路由别名兼容。可见性依赖运行时状态
 * 的页通过 minUiTier / requiresSqlite / featureGate / visibleWhen 表达，由 router store
 * 在请求 visiblePages 时计算。
 */
import { markRaw } from 'vue';
import type { AcuV2Page } from './page-types';


import DashboardPage from '../pages/DashboardPage.vue';
import FillModePage from '../pages/FillModePage.vue';
import FormFillPage from '../pages/FormFillPage.vue';
import ApiPage from '../pages/ApiPage.vue';
import AgentPage from '../pages/AgentPage.vue';
import ContinuationPage from '../pages/ContinuationPage.vue';
import WorldSimulationPage from '../pages/WorldSimulationPage.vue';
import ImportPage from '../pages/ImportPage.vue';
import DataMgmtPage from '../pages/DataMgmtPage.vue';
import ContentReplacePage from '../pages/ContentReplacePage.vue';
import AdvancedToolsPage from '../pages/AdvancedToolsPage.vue';
import DeveloperPage from '../pages/DeveloperPage.vue';
import { dashboardCopy } from '../copy/dashboard-copy';
import { fillModeCopy } from '../copy/fill-mode-copy';
import { useDevOptionsStore } from '../stores/dev-options-store';

/** 正文替换页对应的 feature gate key；页面可见性由仪表盘常驻的正文替换启用开关控制。 */
export const FEATURE_GATE_CONTENT_REPLACE = 'content-replace';
export const FEATURE_GATE_CONTINUATION = 'continuation';
export const FEATURE_GATE_WORLD_SIMULATION = 'world-simulation';
export const FEATURE_GATE_IMPORT = 'import';
export const ACU_V2_FORM_FILL_PAGE_ID = 'form-fill';
export const ACU_V2_FILL_MODE_PAGE_ID = 'fill-mode';

export const ACU_V2_PAGE_REGISTRY: readonly AcuV2Page[] = Object.freeze([

  // 概览
  { id: 'dashboard', title: dashboardCopy.pageTitle, group: 'overview', component: markRaw(DashboardPage) },

  // 配置
  { id: ACU_V2_FILL_MODE_PAGE_ID, title: fillModeCopy.pageTitle, group: 'config', component: markRaw(FillModePage) },
  { id: ACU_V2_FORM_FILL_PAGE_ID, title: '填表工作台', group: 'config', component: markRaw(FormFillPage) },
  { id: 'agent', title: 'Agent', group: 'config', component: markRaw(AgentPage), minUiTier: 'medium' },
  { id: 'api', title: 'API', group: 'config', component: markRaw(ApiPage) },

  // 功能
  { id: 'continuation', title: '智能续写', group: 'feature', component: markRaw(ContinuationPage), minUiTier: 'medium', featureGate: FEATURE_GATE_CONTINUATION },
  { id: 'world-simulation', title: '格林推演', group: 'feature', component: markRaw(WorldSimulationPage), minUiTier: 'high', featureGate: FEATURE_GATE_WORLD_SIMULATION },
  { id: 'import', title: '外部导入', group: 'feature', component: markRaw(ImportPage), minUiTier: 'medium', featureGate: FEATURE_GATE_IMPORT },
  {
    id: 'content-replace',
    title: '正文替换',
    group: 'feature',
    component: markRaw(ContentReplacePage),
    minUiTier: 'high',
    featureGate: FEATURE_GATE_CONTENT_REPLACE,
  },

  // 工具
  // 高级工具页轻量模式即可见：轻量 / 进阶只显示运行日志，SQL 控制台由页内按高级档位开放。
  // 数据管理（含删除表格数据）随进阶模式开放。
  { id: 'data-mgmt', title: '数据管理', group: 'tool', component: markRaw(DataMgmtPage), minUiTier: 'medium' },
  { id: 'advanced-tools', title: '高级工具', group: 'tool', component: markRaw(AdvancedToolsPage) },

  // 开发者（plan §D24：仪表盘"启用开发者选项"总开关 gate）
  {
    id: 'developer',
    title: '开发者选项',
    group: 'developer',
    component: markRaw(DeveloperPage),
    minUiTier: 'high',
    visibleWhen: () => useDevOptionsStore().developerOptionsEnabled,
  },
]);

export const ACU_V2_DEFAULT_PAGE_ID = 'dashboard';
