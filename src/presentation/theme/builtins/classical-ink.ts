// theme/builtins/classical-ink.ts
// 古典墨纸主题（深色）

import type { ACUTheme } from '../theme-types';

export const THEME_CLASSICAL_INK: ACUTheme = {
    id: 'classical-ink',
    name: '古典·墨纸',
    description: '古雅深色纸墨质感，赤褐为饰，宋体排版',
    author: '龙血玄黄·数据库',
    version: '1.0.0',
    colorScheme: 'dark',

    variables: {
        '--acu-bg-0': '#24221f',
        '--acu-bg-1': '#211f1c',
        '--acu-bg-2': '#2a2824',
        '--acu-bg-3': 'rgba(193, 185, 173, 0.06)',
        '--acu-border': '#36332e',
        '--acu-border-2': 'rgba(193, 185, 173, 0.16)',

        '--acu-text-1': '#c1b9ad',
        '--acu-text-2': '#9e978e',
        '--acu-text-3': '#645e55',

        '--acu-accent': '#7d4940',
        '--acu-accent-2': '#8f5a4e',
        '--acu-accent-glow': 'rgba(125, 73, 64, 0.16)',
        '--acu-accent-glow-2': 'rgba(138, 107, 94, 0.12)',

        '--acu-success': '#85725f',
        '--acu-warning': '#9c7e56',
        '--acu-danger': '#8b5a55',

        '--acu-radius-lg': '2px',
        '--acu-radius-md': '2px',
        '--acu-radius-sm': '1px',

        '--acu-shadow': '0 14px 32px rgba(0, 0, 0, 0.20)',

        // 兼容旧变量
        '--bg-primary': 'var(--acu-bg-0)',
        '--bg-secondary': 'var(--acu-bg-1)',
        '--background_light': 'rgba(193, 185, 173, 0.04)',
        '--background_default': 'rgba(193, 185, 173, 0.03)',
        '--background-color-light': 'rgba(193, 185, 173, 0.04)',
        '--input-background': 'rgba(26, 24, 22, 0.36)',
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
        '--button-background': 'rgba(193, 185, 173, 0.03)',
        '--button-secondary-background': 'rgba(193, 185, 173, 0.02)',
        '--green': 'var(--acu-success)',
        '--orange': 'var(--acu-warning)',
        '--red': 'var(--acu-danger)',
        '--accent-primary': 'var(--acu-accent)',

        '--acu-control-bg': 'rgba(26, 24, 22, 0.36)',
        '--acu-control-text': 'var(--acu-text-1)',
        '--acu-select-arrow': 'var(--acu-text-2)',
        '--acu-radio-accent': 'var(--acu-accent)',
        '--acu-radio-bg': 'var(--acu-control-bg)',
        '--acu-checkbox-bg': 'rgba(26, 24, 22, 0.48)',
        '--acu-checkbox-checked-bg': 'var(--acu-accent)',
        '--acu-checkbox-checked-border': 'var(--acu-accent)',
        '--acu-checkbox-checked-icon': '#f2ebe1',
        '--acu-danger-soft-bg': 'rgba(139, 90, 85, 0.14)',
        '--acu-danger-soft-border': 'rgba(139, 90, 85, 0.32)',
        '--acu-overlay-bg': 'rgba(18, 16, 14, 0.30)',
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
        '--acu-confirm-ok-bg': 'rgba(125, 73, 64, 0.14)',
        '--acu-confirm-ok-border': 'rgba(125, 73, 64, 0.34)',
        '--acu-confirm-ok-text': 'var(--acu-accent)',
        '--acu-confirm-ok-hover-bg': 'rgba(125, 73, 64, 0.22)',
        '--acu-confirm-ok-hover-border': 'rgba(125, 73, 64, 0.46)',
    },

    fontFamily: '"Noto Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", serif',

    customCSS: `
        /* 墨纸主题特有：header 前缀字 */
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
        bg: '#24221f',
        card: '#2a2824',
        accent: '#7d4940',
        text: '#c1b9ad',
    },
};
