// theme/builtins/default-dark.ts
// 深色科技主题（原默认主题）

import type { ACUTheme } from '../theme-types';

export const THEME_DEFAULT_DARK: ACUTheme = {
    id: 'default-dark',
    name: '深色科技',
    description: '深色中性背景 + 蓝紫高光，适合暗光环境',
    author: '龙血玄黄·数据库',
    version: '1.0.0',
    colorScheme: 'dark',

    variables: {
        '--acu-bg-0': '#0b0f15',
        '--acu-bg-1': '#101826',
        '--acu-bg-2': 'rgba(255, 255, 255, 0.06)',
        '--acu-bg-3': 'rgba(255, 255, 255, 0.09)',
        '--acu-border': 'rgba(255, 255, 255, 0.12)',
        '--acu-border-2': 'rgba(255, 255, 255, 0.18)',

        '--acu-text-1': 'rgba(255, 255, 255, 0.92)',
        '--acu-text-2': 'rgba(255, 255, 255, 0.74)',
        '--acu-text-3': 'rgba(255, 255, 255, 0.52)',

        '--acu-accent': '#7bb7ff',
        '--acu-accent-2': '#9b7bff',
        '--acu-accent-glow': 'rgba(123, 183, 255, 0.22)',
        '--acu-accent-glow-2': 'rgba(155, 123, 255, 0.18)',

        '--acu-success': '#4ad19f',
        '--acu-warning': '#ffb85c',
        '--acu-danger': '#ff6b6b',

        '--acu-radius-lg': '16px',
        '--acu-radius-md': '12px',
        '--acu-radius-sm': '10px',

        '--acu-shadow': '0 18px 60px rgba(0, 0, 0, 0.55)',

        // 兼容旧变量
        '--bg-primary': 'var(--acu-bg-0)',
        '--bg-secondary': 'var(--acu-bg-1)',
        '--background_light': 'rgba(255, 255, 255, 0.04)',
        '--background_default': 'rgba(255, 255, 255, 0.03)',
        '--background-color-light': 'rgba(255, 255, 255, 0.04)',
        '--input-background': 'rgba(0, 0, 0, 0.26)',
        '--input-text-color': 'var(--acu-text-1)',
        '--text-main': 'var(--acu-text-1)',
        '--text_primary': 'var(--acu-text-1)',
        '--text_secondary': 'var(--acu-text-2)',
        '--text_tertiary': 'var(--acu-text-3)',
        '--text-color': 'var(--acu-text-1)',
        '--text-color-dimmed': 'var(--acu-text-3)',
        '--border_color': 'var(--acu-border)',
        '--border_color_light': 'var(--acu-border)',
        '--border-normal': 'var(--acu-border-2)',
        '--warning-color': 'var(--acu-warning)',
        '--error-color': 'var(--acu-danger)',
        '--button-background': 'rgba(255, 255, 255, 0.06)',
        '--button-secondary-background': 'rgba(255, 255, 255, 0.04)',
        '--green': 'var(--acu-success)',
        '--orange': 'var(--acu-warning)',
        '--red': 'var(--acu-danger)',
        '--accent-primary': 'var(--acu-accent)',

        // 控件与扩展模块变量
        '--acu-control-bg': 'rgba(0, 0, 0, 0.26)',
        '--acu-control-text': 'var(--acu-text-1)',
        '--acu-select-arrow': 'var(--acu-text-2)',
        '--acu-radio-accent': 'var(--acu-accent)',
        '--acu-radio-bg': 'var(--acu-control-bg)',
        '--acu-checkbox-bg': 'rgba(255, 255, 255, 0.06)',
        '--acu-checkbox-checked-bg': 'var(--acu-accent)',
        '--acu-checkbox-checked-border': 'var(--acu-accent)',
        '--acu-checkbox-checked-icon': '#08111f',
        '--acu-danger-soft-bg': 'rgba(255, 107, 107, 0.10)',
        '--acu-danger-soft-border': 'rgba(255, 107, 107, 0.32)',
        '--acu-overlay-bg': 'rgba(0, 0, 0, 0.28)',
        '--acu-overlay-backdrop-blur': '3px',
        '--acu-confirm-bg': 'var(--acu-bg-1)',
        '--acu-confirm-border': 'var(--acu-border)',
        '--acu-confirm-title': 'var(--acu-text-1)',
        '--acu-confirm-text': 'var(--acu-text-2)',
        '--acu-confirm-cancel-bg': 'transparent',
        '--acu-confirm-cancel-border': 'var(--acu-border-2)',
        '--acu-confirm-cancel-text': 'var(--acu-text-2)',
        '--acu-confirm-cancel-hover-bg': 'var(--acu-bg-2)',
        '--acu-confirm-cancel-hover-border': 'var(--acu-border)',
        '--acu-confirm-cancel-hover-text': 'var(--acu-text-1)',
        '--acu-confirm-ok-bg': 'rgba(123, 183, 255, 0.16)',
        '--acu-confirm-ok-border': 'rgba(123, 183, 255, 0.38)',
        '--acu-confirm-ok-text': 'var(--acu-accent)',
        '--acu-confirm-ok-hover-bg': 'rgba(123, 183, 255, 0.24)',
        '--acu-confirm-ok-hover-border': 'rgba(123, 183, 255, 0.52)',
    },

    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "HarmonyOS Sans SC", "MiSans", Roboto, Helvetica, Arial, sans-serif',

    previewColors: {
        bg: '#0b0f15',
        card: '#101826',
        accent: '#7bb7ff',
        text: 'rgba(255, 255, 255, 0.92)',
    },
};
