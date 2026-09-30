// theme/builtins/default-light.ts
// 默认浅色管理台主题

import type { ACUTheme } from '../theme-types';

export const THEME_DEFAULT_LIGHT: ACUTheme = {
    id: 'default-light',
    name: '浅色管理台',
    description: '默认浅色风格，细边框、弱阴影、蓝色主强调，适合日常使用',
    author: '龙血玄黄·数据库',
    version: '1.0.0',
    colorScheme: 'light',

    variables: {
        '--acu-bg-0': '#f5f7fa',
        '--acu-bg-1': '#ffffff',
        '--acu-bg-2': 'rgba(0, 0, 0, 0.03)',
        '--acu-bg-3': 'rgba(0, 0, 0, 0.05)',
        '--acu-border': '#e0e4ea',
        '--acu-border-2': '#c8cdd5',

        '--acu-text-1': '#1a2332',
        '--acu-text-2': '#4a5568',
        '--acu-text-3': '#8896a8',

        '--acu-accent': '#2563eb',
        '--acu-accent-2': '#3b82f6',
        '--acu-accent-glow': 'rgba(37, 99, 235, 0.12)',
        '--acu-accent-glow-2': 'rgba(59, 130, 246, 0.10)',

        '--acu-success': '#10b981',
        '--acu-warning': '#f59e0b',
        '--acu-danger': '#ef4444',

        '--acu-radius-lg': '10px',
        '--acu-radius-md': '8px',
        '--acu-radius-sm': '6px',

        '--acu-shadow': '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',

        // 兼容旧变量
        '--bg-primary': 'var(--acu-bg-0)',
        '--bg-secondary': 'var(--acu-bg-1)',
        '--background_light': 'rgba(0, 0, 0, 0.02)',
        '--background_default': '#ffffff',
        '--background-color-light': 'rgba(0, 0, 0, 0.02)',
        '--input-background': '#ffffff',
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
        '--button-background': '#ffffff',
        '--button-secondary-background': '#f8f9fb',
        '--green': 'var(--acu-success)',
        '--orange': 'var(--acu-warning)',
        '--red': 'var(--acu-danger)',
        '--accent-primary': 'var(--acu-accent)',

        // 控件与扩展模块变量
        '--acu-control-bg': '#ffffff',
        '--acu-control-text': 'var(--acu-text-1)',
        '--acu-select-arrow': 'var(--acu-text-2)',
        '--acu-radio-accent': 'var(--acu-accent)',
        '--acu-radio-bg': 'var(--acu-control-bg)',
        '--acu-checkbox-bg': 'var(--acu-control-bg)',
        '--acu-checkbox-checked-bg': 'var(--acu-accent)',
        '--acu-checkbox-checked-border': 'var(--acu-accent)',
        '--acu-checkbox-checked-icon': '#ffffff',
        '--acu-danger-soft-bg': 'rgba(239, 68, 68, 0.08)',
        '--acu-danger-soft-border': 'rgba(239, 68, 68, 0.25)',
        '--acu-overlay-bg': 'rgba(0, 0, 0, 0.16)',
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
        '--acu-confirm-ok-bg': 'rgba(37, 99, 235, 0.08)',
        '--acu-confirm-ok-border': 'rgba(37, 99, 235, 0.30)',
        '--acu-confirm-ok-text': 'var(--acu-accent)',
        '--acu-confirm-ok-hover-bg': 'rgba(37, 99, 235, 0.14)',
        '--acu-confirm-ok-hover-border': 'rgba(37, 99, 235, 0.45)',
    },

    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "HarmonyOS Sans SC", "MiSans", Roboto, Helvetica, Arial, sans-serif',

    previewColors: {
        bg: '#f5f7fa',
        card: '#ffffff',
        accent: '#2563eb',
        text: '#1a2332',
    },
};
