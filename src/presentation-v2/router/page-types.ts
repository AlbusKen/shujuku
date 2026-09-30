/**
 * page-types — 一级页注册项的类型契约（D3 / D18 / P0-3）
 *
 * 阶段 0 锁定字段：
 * - id：唯一标识，全局稳定，未来 setActivePage(id) / 外部深链都用它
 * - title：sidebar 显示文案
 * - group：4 分组之一（沿用旧 main-popup.ts 的分组体系）
 * - component：Vue 组件，在主区通过 <component :is> 渲染
 *
 * 可见性控制（按出现顺序短路求值）：
 * - requiresSqlite：true 时仅在 SQLite 存储模式下可见（保留给需要整页隐藏的 SQLite 专属页）
 * - featureGate：与 router store 的 featureGates 对应；为 false / 未提供时隐藏
 *   → 用于 D7 中"暂不公开"的正文替换页
 * - minUiTier：功能档位达到该等级后才可见
 * - visibleWhen：兜底自定义函数，true 才可见；不写视为 true
 *
 * 显隐串接顺序：minUiTier -> requiresSqlite -> featureGate -> visibleWhen，任一不通过就隐藏。
 */
import type { Component } from 'vue';
import type { AcuUiTier } from '../stores/ui-mode-store';

export type AcuV2PageGroup = 'overview' | 'config' | 'feature' | 'tool' | 'developer';

export interface AcuV2Page {
  id: string;
  title: string;
  group: AcuV2PageGroup;
  component: Component;
  minUiTier?: AcuUiTier;
  requiresSqlite?: boolean;
  featureGate?: string;
  visibleWhen?: () => boolean;
}

export interface AcuV2PageGroupMeta {
  id: AcuV2PageGroup;
  title: string;
}

export const ACU_V2_PAGE_GROUPS: readonly AcuV2PageGroupMeta[] = [
  { id: 'overview', title: '概览' },
  { id: 'config', title: '配置' },
  { id: 'feature', title: '功能' },
  { id: 'tool', title: '工具' },
  { id: 'developer', title: '开发者' },
];
