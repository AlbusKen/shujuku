/**
 * theme-types — 新主题系统类型（D14）
 *
 * 与旧 src/presentation/theme/theme-types.ts 互不依赖。新主题不暴露兼容旧
 * inline-style 的兼容变量、不暴露 visualizer / toast / window-chrome 子集，
 * 也不维护 ACUThemeFile 导入导出契约。这些都按 D14 的"丢弃"决策处理。
 */

export type AcuV2BuiltinThemeId =
  | 'default-light'
  | 'default-dark'
  | 'creamy-minimal'
  | 'jirai-kei'
  | 'milk-dragon';

export type AcuV2CustomThemeId = `custom:${string}`;

export type AcuV2ThemeId = AcuV2BuiltinThemeId | AcuV2CustomThemeId;

export type AcuV2ColorScheme = 'light' | 'dark';

/**
 * 主题 token 表（v2 稳定主题契约）。
 * 按属性分组：背景 / 交互 / 边框 / 文本 / 强调 / 状态 / 字体 / 圆角 / 阴影。
 */
export interface AcuV2ThemeTokens {
  bg0: string;
  bg1: string;
  bg2: string;
  sidebarBg: string;
  hoverOverlay: string;
  border: string;
  border2: string;
  text1: string;
  text2: string;
  text3: string;
  accent: string;
  accent2: string;
  onAccent: string;
  accentGlow: string;
  success: string;
  warning: string;
  danger: string;
  fontUi: string;
  fontMono: string;
  radiusLg: string;
  radiusMd: string;
  radiusSm: string;
  shadow: string;
}

export interface AcuV2Theme {
  id: AcuV2ThemeId;
  name: string;
  colorScheme: AcuV2ColorScheme;
  tokens: AcuV2ThemeTokens;
}

export const ACU_V2_CUSTOM_THEME_FILE_KIND = 'acu-v2-theme';
export const ACU_V2_CUSTOM_THEME_FILE_VERSION = 1;

export interface AcuV2CustomThemeFile {
  kind: typeof ACU_V2_CUSTOM_THEME_FILE_KIND;
  version: typeof ACU_V2_CUSTOM_THEME_FILE_VERSION;
  theme: {
    id?: AcuV2CustomThemeId;
    name: string;
    colorScheme: AcuV2ColorScheme;
    tokens: AcuV2ThemeTokens;
  };
}

/** token key 到 CSS 变量名的映射，集中保存供 store 与注入器共用。 */
export const TOKEN_VAR_MAP: Record<keyof AcuV2ThemeTokens, string> = {
  bg0: '--acu-bg-0',
  bg1: '--acu-bg-1',
  bg2: '--acu-bg-2',
  sidebarBg: '--acu-sidebar-bg',
  hoverOverlay: '--acu-hover-overlay',
  border: '--acu-border',
  border2: '--acu-border-2',
  text1: '--acu-text-1',
  text2: '--acu-text-2',
  text3: '--acu-text-3',
  accent: '--acu-accent',
  accent2: '--acu-accent-2',
  onAccent: '--acu-on-accent',
  accentGlow: '--acu-accent-glow',
  success: '--acu-success',
  warning: '--acu-warning',
  danger: '--acu-danger',
  fontUi: '--acu-font-ui',
  fontMono: '--acu-font-mono',
  radiusLg: '--acu-radius-lg',
  radiusMd: '--acu-radius-md',
  radiusSm: '--acu-radius-sm',
  shadow: '--acu-shadow',
};
