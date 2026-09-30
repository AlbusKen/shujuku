// theme/builtins/classical-silk.ts
// 古典素纱主题（浅色）

import type { ACUTheme } from '../theme-types';

export const THEME_CLASSICAL_SILK: ACUTheme = {
    id: 'classical-silk',
    name: '古典·素纱',
    description: '淡雅浅色纱质感，暖褐色调，宋体排版',
    author: '龙血玄黄·数据库',
    version: '1.0.0',
    colorScheme: 'light',

    variables: {
        '--acu-bg-0': '#f4f1eb',
        '--acu-bg-1': '#f9f8f5',
        '--acu-bg-2': '#ebe7de',
        '--acu-bg-3': 'rgba(74, 69, 63, 0.05)',
        '--acu-border': '#e0dacb',
        '--acu-border-2': 'rgba(110, 103, 94, 0.18)',

        '--acu-text-1': '#4a453f',
        '--acu-text-2': '#6e675e',
        '--acu-text-3': '#9e978e',

        '--acu-accent': '#8a6b5e',
        '--acu-accent-2': '#9d7c6f',
        '--acu-accent-glow': 'rgba(138, 107, 94, 0.14)',
        '--acu-accent-glow-2': 'rgba(138, 107, 94, 0.10)',

        '--acu-success': '#6f7b62',
        '--acu-warning': '#a2835b',
        '--acu-danger': '#a06a65',

        '--acu-radius-lg': '2px',
        '--acu-radius-md': '2px',
        '--acu-radius-sm': '1px',

        '--acu-shadow': '0 2px 8px rgba(74, 69, 63, 0.08)',

        // 兼容旧变量
        '--bg-primary': 'var(--acu-bg-0)',
        '--bg-secondary': 'var(--acu-bg-1)',
        '--background_light': 'rgba(255, 255, 255, 0.58)',
        '--background_default': 'rgba(255, 255, 255, 0.42)',
        '--background-color-light': 'rgba(255, 255, 255, 0.48)',
        '--input-background': 'rgba(255, 255, 255, 0.70)',
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
        '--button-background': 'rgba(255, 255, 255, 0.50)',
        '--button-secondary-background': 'rgba(255, 255, 255, 0.36)',
        '--green': 'var(--acu-success)',
        '--orange': 'var(--acu-warning)',
        '--red': 'var(--acu-danger)',
        '--accent-primary': 'var(--acu-accent)',

        '--acu-control-bg': 'rgba(255, 255, 255, 0.70)',
        '--acu-control-text': 'var(--acu-text-1)',
        '--acu-select-arrow': 'var(--acu-text-2)',
        '--acu-radio-accent': 'var(--acu-accent)',
        '--acu-radio-bg': 'var(--acu-control-bg)',
        '--acu-checkbox-bg': 'rgba(255, 255, 255, 0.82)',
        '--acu-checkbox-checked-bg': 'var(--acu-accent)',
        '--acu-checkbox-checked-border': 'var(--acu-accent)',
        '--acu-checkbox-checked-icon': '#fffaf4',
        '--acu-danger-soft-bg': 'rgba(160, 106, 101, 0.12)',
        '--acu-danger-soft-border': 'rgba(160, 106, 101, 0.28)',
        '--acu-overlay-bg': 'rgba(74, 69, 63, 0.18)',
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
        '--acu-confirm-ok-bg': 'rgba(138, 107, 94, 0.14)',
        '--acu-confirm-ok-border': 'rgba(138, 107, 94, 0.32)',
        '--acu-confirm-ok-text': 'var(--acu-accent)',
        '--acu-confirm-ok-hover-bg': 'rgba(138, 107, 94, 0.22)',
        '--acu-confirm-ok-hover-border': 'rgba(138, 107, 94, 0.42)',
    },

    fontFamily: '"Noto Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", serif',

    customCSS: `
        /* 素纱主题特有：header 前缀字 */
        #popup .acu-header::before {
            content: '录';
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            border: 1px solid var(--acu-accent);
            color: var(--acu-accent);
            font-size: 12px;
            border-radius: 1px;
            opacity: 0.85;
            letter-spacing: 1px;
            flex-shrink: 0;
        }
        #popup .acu-header {
            background: transparent;
            box-shadow: none;
        }
    `,

    previewColors: {
        bg: '#f4f1eb',
        card: '#f9f8f5',
        accent: '#8a6b5e',
        text: '#4a453f',
    },
};
