/**
 * line-icons — V2 界面的线条图标（自绘，24×24，1.8 描边，圆角端点）。
 *
 * 通过 CSS mask 覆盖同名 Font Awesome 类的 ::before 字形：模板仍写 fa-* 类名，
 * 颜色继承 currentColor，尺寸沿用 1em；未收录的图标自动回落到 Font Awesome。
 * 回退方式：在 theme-injector 中移除 buildLineIconCss 调用。
 */

const C9 = '<circle cx="12" cy="12" r="9"/>';
const STAR = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z';
const TRASH = 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13';

const p = (d: string): string => `<path d="${d}"/>`;

/** 图标名（不含 fa- 前缀）到 SVG 内部元素。 */
export const ACU_LINE_ICONS: Readonly<Record<string, string>> = {
  plus: p('M12 5v14M5 12h14'),
  xmark: p('M6 6l12 12M18 6 6 18'),
  check: p('M5 12.5l4.5 4.5L19 7'),
  'check-circle': C9 + p('M8 12.5l2.8 2.8 5.7-5.8'),
  'chevron-down': p('M6 9l6 6 6-6'),
  'chevron-up': p('M6 15l6-6 6 6'),
  'chevron-right': p('M9 6l6 6-6 6'),
  'arrow-left': p('M19 12H5M11 6l-6 6 6 6'),
  'arrow-right': p('M5 12h14M13 6l6 6-6 6'),
  'arrow-up': p('M12 19V5M6 11l6-6 6 6'),
  'arrow-down': p('M12 5v14M6 13l6 6 6-6'),
  bars: p('M4 7h16M4 12h16M4 17h16'),
  list: p('M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01'),
  upload: p('M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4h16v-4'),
  download: p('M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v4h16v-4'),
  trash: p(TRASH),
  'trash-can': p(`${TRASH}M10 11v5M14 11v5`),
  star: p(STAR),
  pen: p('M4 20l1-4L16 5l3 3L8 19zM14 7l3 3'),
  'pen-to-square': p('M11 4H5v15h15v-6M18 3.5l2.5 2.5-8.5 8.5-3.3.8.8-3.3z'),
  gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/>'
    + p('M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1'),
  spinner: p('M12 3a9 9 0 1 1-9 9'),
  'circle-info': C9 + p('M12 11v5M12 7.5h.01'),
  'circle-exclamation': C9 + p('M12 7.5v5M12 16h.01'),
  'triangle-exclamation': p('M12 4 2.8 19.5h18.4zM12 10v4M12 17h.01'),
  database: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/>'
    + p('M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5'),
  'i-cursor': p('M9 4h6M9 20h6M12 4v16'),
  'table-columns': '<rect x="4" y="5" width="16" height="14" rx="1.5"/>' + p('M4 9.5h16M12 9.5V19'),
  play: p('M8 5v14l11-7z'),
  pause: p('M9 5v14M15 5v14'),
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  'rotate-right': p('M19 12a7 7 0 1 1-2.1-5M19 4v4h-4'),
  'clock-rotate-left': p('M5 12a7 7 0 1 0 2.1-5M5 4v4h4M12 8.5V12l2.5 2'),
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/>' + p('M8 11V8a4 4 0 0 1 8 0v3'),
  'file-lines': p('M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6'),
  brain: p('M9 4.5A2.5 2.5 0 0 0 6.5 7 3 3 0 0 0 5 12.5a3 3 0 0 0 2 4.8A2.5 2.5 0 0 0 12 18V6a1.8 1.8 0 0 0-3-1.5zM15 4.5A2.5 2.5 0 0 1 17.5 7a3 3 0 0 1 1.5 5.5 3 3 0 0 1-2 4.8A2.5 2.5 0 0 1 12 18'),
  'link-slash': p('M9.5 14.5l5-5M10.5 6.5 12 5a4 4 0 0 1 5.7 5.7l-1.5 1.5M13.5 17.5 12 19a4 4 0 0 1-5.7-5.7l1.5-1.5M4 4l16 16'),
  sitemap: '<rect x="9" y="3.5" width="6" height="4.5" rx="1"/><rect x="3" y="16" width="6" height="4.5" rx="1"/>'
    + '<rect x="15" y="16" width="6" height="4.5" rx="1"/>' + p('M12 8v4M6 16v-4h12v4'),
  eraser: p('M9 20h11M5 15.5l9-9a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L10 19.5H8.5L5 16a.4.4 0 0 1 0-.5zM9.5 11l4.5 4.5'),
  lightbulb: p('M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z'),
  'paper-plane': p('M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z'),
};

/** 需要实心填充的变体（fa-solid fa-star 表示当前默认项）。 */
const FILLED_VARIANTS: ReadonlyArray<readonly [selector: string, icon: string]> = [
  ['.fa-solid.fa-star', 'star'],
];

function toMaskUrl(inner: string, fill = 'none'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill}" stroke="#000"`
    + ` stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** 生成覆盖 Font Awesome 字形的线条图标 CSS，作用域限定在 V2 根容器。 */
export function buildLineIconCss(rootId: string): string {
  const names = Object.keys(ACU_LINE_ICONS);
  const selectors = names.map(name => `.fa-${name}`).join(', ');
  const rules = [
    `#${rootId} :is(${selectors})::before {`,
    '  content: "" !important;',
    '  display: inline-block;',
    '  width: 1em;',
    '  height: 1em;',
    '  vertical-align: -0.125em;',
    '  background-color: currentColor;',
    '  -webkit-mask: var(--acu-line-icon) center / contain no-repeat;',
    '  mask: var(--acu-line-icon) center / contain no-repeat;',
    '}',
  ];
  for (const name of names) {
    rules.push(`#${rootId} .fa-${name}::before { --acu-line-icon: ${toMaskUrl(ACU_LINE_ICONS[name])}; }`);
  }
  for (const [selector, name] of FILLED_VARIANTS) {
    rules.push(`#${rootId} ${selector}::before { --acu-line-icon: ${toMaskUrl(ACU_LINE_ICONS[name], '#000')}; }`);
  }
  return `${rules.join('\n')}\n`;
}

