/**
 * builtin-themes — 内置主题色值（D14）
 *
 * 仅保留 v2 稳定主题契约；丢弃旧的兼容变量、子模块变量、customCSS、
 * windowChromeVariables 等。
 */
import type { AcuV2Theme } from "./theme-types";

export const THEME_DEFAULT_LIGHT: AcuV2Theme = {
  id: "default-light",
  name: "浅色",
  colorScheme: "light",
  tokens: {
    bg0: "#f8f5ee",
    bg1: "#fbfaf6",
    bg2: "#ebe9e3",
    sidebarBg: "#f5f2eb",
    hoverOverlay: "rgba(17, 17, 15, 0.07)",
    border: "rgba(23, 23, 20, 0.06)",
    border2: "rgba(23, 23, 20, 0.10)",
    text1: "#11110f",
    text2: "#46443d",
    text3: "#77736a",
    accent: "#11110f",
    accent2: "#2d2b26",
    onAccent: "#fbfaf7",
    accentGlow: "rgba(17, 17, 15, 0.14)",
    success: "#4d6b56",
    warning: "#836434",
    danger: "#95514b",
    fontUi: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontMono: 'Consolas, Menlo, Monaco, "Courier New", monospace',
    radiusLg: "6px",
    radiusMd: "6px",
    radiusSm: "6px",
    shadow: "0 12px 32px rgba(23, 23, 20, 0.12)",
  },
};

export const THEME_DEFAULT_DARK: AcuV2Theme = {
  id: "default-dark",
  name: "深色",
  colorScheme: "dark",
  tokens: {
    bg0: "#1F2428",
    bg1: "#24292E",
    bg2: "#2D343B",
    sidebarBg: "#1F2428",
    hoverOverlay: "rgba(201, 209, 217, 0.08)",
    border: "rgba(205, 217, 229, 0.08)",
    border2: "rgba(205, 217, 229, 0.14)",
    text1: "#F0F3F6",
    text2: "#C9D1D9",
    text3: "#8B949E",
    accent: "#7FD6CA",
    accent2: "#69C7BC",
    onAccent: "#1F2428",
    accentGlow: "rgba(127, 214, 202, 0.26)",
    success: "#8DBA9A",
    warning: "#C9A35E",
    danger: "#D07A74",
    fontUi: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontMono: 'Consolas, Menlo, Monaco, "Courier New", monospace',
    radiusLg: "6px",
    radiusMd: "6px",
    radiusSm: "6px",
    shadow: "0 18px 48px rgba(1, 4, 9, 0.36)",
  },
};

export const THEME_CREAMY_MINIMAL: AcuV2Theme = {
  id: "creamy-minimal",
  name: "奶油风",
  colorScheme: "light",
  tokens: {
    bg0: "#F7F0E6",
    bg1: "#FCF8F1",
    bg2: "#EFE4D7",
    sidebarBg: "#F6ECDD",
    hoverOverlay: "rgba(116, 91, 62, 0.08)",
    border: "rgba(116, 91, 62, 0.12)",
    border2: "rgba(116, 91, 62, 0.18)",
    text1: "#514638",
    text2: "#735F4A",
    text3: "#9A8268",
    accent: "#85A76A",
    accent2: "#738F5B",
    onAccent: "#FCF8F1",
    accentGlow: "rgba(133, 167, 106, 0.24)",
    success: "#7F9B69",
    warning: "#AA8050",
    danger: "#A76561",
    fontUi: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontMono: 'Consolas, Menlo, Monaco, "Courier New", monospace',
    radiusLg: "18px",
    radiusMd: "16px",
    radiusSm: "12px",
    shadow: "0 8px 24px rgba(92, 70, 44, 0.10)",
  },
};

export const THEME_JIRAI_KEI: AcuV2Theme = {
  id: "jirai-kei",
  name: "地雷色",
  colorScheme: "dark",
  tokens: {
    bg0: "#2B2B2B",
    bg1: "#1F1F1F",
    bg2: "rgba(255, 196, 212, 0.08)",
    sidebarBg: "#1F1F1F",
    hoverOverlay: "rgba(255, 196, 212, 0.12)",
    border: "transparent",
    border2: "transparent",
    text1: "#FFFFFF",
    text2: "rgba(255, 255, 255, 0.70)",
    text3: "rgba(255, 255, 255, 0.50)",
    accent: "#FFC4D4",
    accent2: "#FFD9E4",
    onAccent: "#2B2B2B",
    accentGlow: "rgba(255, 196, 212, 0.25)",
    success: "#E5A0B5",
    warning: "#FFB38B",
    danger: "#D96C6C",
    fontUi: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontMono: 'Consolas, Menlo, Monaco, "Courier New", monospace',
    radiusLg: "18px",
    radiusMd: "16px",
    radiusSm: "12px",
    shadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
  },
};

export const THEME_MILK_DRAGON: AcuV2Theme = {
  id: "milk-dragon",
  name: "奶龙配色",
  colorScheme: "dark",
  tokens: {
    // 中性炭灰底 + 暖灰文字，奶油黄只用于强调位；边框压到近乎不可见，保持扁平。
    bg0: "#16171A",
    bg1: "#1C1D21",
    bg2: "#25262B",
    sidebarBg: "#131417",
    hoverOverlay: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.05)",
    border2: "rgba(255, 255, 255, 0.07)",
    text1: "#EDEBE6",
    text2: "#B4B1AA",
    text3: "#807D77",
    accent: "#EFD37A",
    accent2: "#E2C160",
    onAccent: "#1A1812",
    accentGlow: "rgba(239, 211, 122, 0.18)",
    success: "#93BE8C",
    warning: "#DDAA6B",
    danger: "#DE837C",
    fontUi: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontMono: 'Consolas, Menlo, Monaco, "Courier New", monospace',
    radiusLg: "8px",
    radiusMd: "8px",
    radiusSm: "6px",
    shadow: "0 16px 40px rgba(0, 0, 0, 0.32)",
  },
};

export const ACU_V2_BUILTIN_THEMES: readonly AcuV2Theme[] = [
  THEME_DEFAULT_LIGHT,
  THEME_DEFAULT_DARK,
  THEME_CREAMY_MINIMAL,
  THEME_JIRAI_KEI,
  THEME_MILK_DRAGON,
];

export const ACU_V2_DEFAULT_THEME_ID = THEME_MILK_DRAGON.id;
export const ACU_V2_THEME_MIGRATION_VERSION = 1;
