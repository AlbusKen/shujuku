/**
 * theme-store — 新 UI 主题状态（D14 / D16 / P0-4）
 *
 * 设计要点：
 * - 内置主题 id 不可变，切换主题 = 切 activeId
 * - 持久化走 acu_v2_ui_state.theme（独立于旧 settings_ACU）
 * - 切换 / 初始化时通过订阅触发 theme-injector 把 tokens 写到 host document
 *   的 <style id="acu-v2-theme">；注入逻辑放 theme-injector.ts，store 只发数据
 */
import { defineStore } from 'pinia';
import {
  ACU_V2_BUILTIN_THEMES,
  ACU_V2_DEFAULT_THEME_ID,
  ACU_V2_THEME_MIGRATION_VERSION,
} from '../theme/builtin-themes';
import {
  ACU_V2_CUSTOM_THEME_FILE_KIND,
  ACU_V2_CUSTOM_THEME_FILE_VERSION,
  TOKEN_VAR_MAP,
  type AcuV2BuiltinThemeId,
  type AcuV2ColorScheme,
  type AcuV2CustomThemeFile,
  type AcuV2CustomThemeId,
  type AcuV2Theme,
  type AcuV2ThemeId,
  type AcuV2ThemeTokens,
} from '../theme/theme-types';
import { readSection, writeSection } from './persistence';

const SECTION_KEY = 'theme';
const CUSTOM_THEME_ID_PREFIX = 'custom:';
const LEGACY_BUILTIN_THEME_ID_ALIASES: Record<string, AcuV2BuiltinThemeId> = {
  'strawberry-dragon': 'creamy-minimal',
};
const MAX_CUSTOM_THEMES = 24;
const MAX_THEME_NAME_LENGTH = 40;
const MAX_TOKEN_VALUE_LENGTH = 240;

interface PersistedTheme {
  migrationVersion?: unknown;
  activeId?: unknown;
  customThemes?: unknown;
}

interface ThemeState {
  activeId: AcuV2ThemeId;
  customThemes: AcuV2Theme[];
}

interface InitialThemeState {
  activeId: AcuV2ThemeId;
  customThemes: AcuV2Theme[];
}

interface SanitizedPersistedCustomThemes {
  customThemes: AcuV2Theme[];
  builtinOverridesByCustomId: Record<string, AcuV2BuiltinThemeId>;
}

type ThemeImportSource = AcuV2CustomThemeFile | {
  id?: unknown;
  name?: unknown;
  colorScheme?: unknown;
  tokens?: unknown;
};

function isBuiltinThemeId(id: unknown): id is AcuV2BuiltinThemeId {
  return typeof id === 'string' && ACU_V2_BUILTIN_THEMES.some(t => t.id === id);
}

export function isCustomThemeId(id: unknown): id is AcuV2CustomThemeId {
  return typeof id === 'string' && id.startsWith(CUSTOM_THEME_ID_PREFIX);
}

function isSafeCustomThemeId(id: unknown): id is AcuV2CustomThemeId {
  return isCustomThemeId(id) && /^custom:[a-z0-9][a-z0-9_-]{2,48}$/i.test(id);
}

function themeExists(id: unknown, customThemes: readonly AcuV2Theme[]): id is AcuV2ThemeId {
  return isBuiltinThemeId(id) || customThemes.some(t => t.id === id);
}

function normalizePersistedActiveThemeId(
  id: unknown,
  customThemes: readonly AcuV2Theme[],
  builtinOverridesByCustomId: Record<string, AcuV2BuiltinThemeId> = {},
): AcuV2ThemeId {
  if (themeExists(id, customThemes)) return id;
  if (typeof id === 'string' && builtinOverridesByCustomId[id]) {
    return builtinOverridesByCustomId[id];
  }
  if (typeof id === 'string' && LEGACY_BUILTIN_THEME_ID_ALIASES[id]) {
    return LEGACY_BUILTIN_THEME_ID_ALIASES[id];
  }
  return ACU_V2_DEFAULT_THEME_ID;
}

function sanitizeThemeName(value: unknown): string {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, MAX_THEME_NAME_LENGTH);
  return name || '自定义主题';
}

function sanitizeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return slug || 'theme';
}

function isColorScheme(value: unknown): value is AcuV2ColorScheme {
  return value === 'light' || value === 'dark';
}

function isSafeTokenValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TOKEN_VALUE_LENGTH) return false;
  if (/[;{}<>!]/.test(trimmed)) return false;
  if (trimmed.includes('/*') || trimmed.includes('*/')) return false;
  if (/url\s*\(/i.test(trimmed)) return false;
  return true;
}

function sanitizeThemeTokens(value: unknown): AcuV2ThemeTokens | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const result: Partial<AcuV2ThemeTokens> = {};
  const keys = Object.keys(TOKEN_VAR_MAP) as Array<keyof AcuV2ThemeTokens>;
  for (const key of keys) {
    if (!isSafeTokenValue(source[key])) return null;
    result[key] = source[key].trim();
  }
  return result as AcuV2ThemeTokens;
}

function makeUniqueCustomThemeId(
  name: string,
  customThemes: readonly AcuV2Theme[],
): AcuV2CustomThemeId {
  const base = `${CUSTOM_THEME_ID_PREFIX}${sanitizeSlug(name)}`;
  let candidate = base as AcuV2CustomThemeId;
  let index = 2;
  while (customThemes.some(t => t.id === candidate)) {
    candidate = `${base}-${index}` as AcuV2CustomThemeId;
    index += 1;
  }
  return candidate;
}

function findBuiltinThemeByName(name: string): AcuV2Theme | undefined {
  const normalizedName = sanitizeThemeName(name);
  return ACU_V2_BUILTIN_THEMES.find(t => sanitizeThemeName(t.name) === normalizedName);
}

function normalizeThemeSource(
  source: ThemeImportSource,
  customThemes: readonly AcuV2Theme[],
): AcuV2Theme {
  const isWrapped =
    source &&
    typeof source === 'object' &&
    (source as Partial<AcuV2CustomThemeFile>).kind === ACU_V2_CUSTOM_THEME_FILE_KIND;
  if (isWrapped && (source as Partial<AcuV2CustomThemeFile>).version !== ACU_V2_CUSTOM_THEME_FILE_VERSION) {
    throw new Error('主题文件版本不受支持。');
  }

  const wrapped = isWrapped
    ? (source as Partial<AcuV2CustomThemeFile>).theme
    : source;
  if (!wrapped || typeof wrapped !== 'object') {
    throw new Error('主题文件格式不正确。');
  }

  const theme = wrapped as Record<string, unknown>;
  const name = sanitizeThemeName(theme.name);
  const colorScheme = theme.colorScheme;
  const tokens = sanitizeThemeTokens(theme.tokens);
  if (!isColorScheme(colorScheme) || !tokens) {
    throw new Error('主题文件缺少 v2 主题所需的颜色模式或 token。');
  }

  const id = isSafeCustomThemeId(theme.id)
    ? theme.id
    : makeUniqueCustomThemeId(name, customThemes);

  return { id, name, colorScheme, tokens };
}

function sanitizePersistedCustomThemes(value: unknown): SanitizedPersistedCustomThemes {
  if (!Array.isArray(value)) return { customThemes: [], builtinOverridesByCustomId: {} };
  const themes: AcuV2Theme[] = [];
  const builtinOverridesByCustomId: Record<string, AcuV2BuiltinThemeId> = {};
  for (const item of value) {
    if (themes.length >= MAX_CUSTOM_THEMES) break;
    try {
      const normalized = normalizeThemeSource(item as ThemeImportSource, themes);
      if (!isSafeCustomThemeId((item as { id?: unknown })?.id)) continue;
      const builtinOverride = findBuiltinThemeByName(normalized.name);
      if (builtinOverride) {
        builtinOverridesByCustomId[normalized.id] = builtinOverride.id as AcuV2BuiltinThemeId;
        continue;
      }
      const index = themes.findIndex(t => t.id === normalized.id);
      if (index >= 0) themes[index] = normalized;
      else themes.push(normalized);
    } catch {
      /* 忽略损坏的持久化主题，保留其余可用项。 */
    }
  }
  return { customThemes: themes, builtinOverridesByCustomId };
}

function readInitialThemeState(): InitialThemeState {
  const persisted = readSection<PersistedTheme>(SECTION_KEY);
  const { customThemes, builtinOverridesByCustomId } = sanitizePersistedCustomThemes(persisted?.customThemes);
  // 一次性主题迁移：迁移版本不匹配时，本次启动的活动主题落到奶龙配色。
  // 只在内存中生效，不在读取阶段写回存储，避免清洗后的自定义主题或损坏的根状态被隐式覆盖；
  // 用户下一次切换、导入或删除主题时由 persist() 写入 migrationVersion，写入前每次启动结果一致。
  const needsMigration = persisted?.migrationVersion !== ACU_V2_THEME_MIGRATION_VERSION;
  const activeId = needsMigration
    ? ACU_V2_DEFAULT_THEME_ID
    : normalizePersistedActiveThemeId(persisted?.activeId, customThemes, builtinOverridesByCustomId);
  return { activeId, customThemes };
}

function buildPersistedTheme(state: ThemeState): PersistedTheme {
  const payload: PersistedTheme = {
    migrationVersion: ACU_V2_THEME_MIGRATION_VERSION,
    activeId: state.activeId,
  };
  if (state.customThemes.length > 0) {
    payload.customThemes = state.customThemes.map(t => ({
      id: t.id,
      name: t.name,
      colorScheme: t.colorScheme,
      tokens: { ...t.tokens },
    }));
  }
  return payload;
}

function findThemeById(id: AcuV2ThemeId, customThemes: readonly AcuV2Theme[]): AcuV2Theme | undefined {
  return ACU_V2_BUILTIN_THEMES.find(t => t.id === id) ?? customThemes.find(t => t.id === id);
}

function parseThemeFileText(text: string): ThemeImportSource {
  try {
    return JSON.parse(text) as ThemeImportSource;
  } catch {
    throw new Error('主题文件不是有效 JSON。');
  }
}

export const useThemeStore = defineStore('acu-v2-theme', {
  state: (): ThemeState => readInitialThemeState(),
  getters: {
    themes: (state): readonly AcuV2Theme[] => [
      ...ACU_V2_BUILTIN_THEMES,
      ...state.customThemes,
    ],
    activeTheme(state): AcuV2Theme {
      const found = findThemeById(state.activeId, state.customThemes);
      // 启动时从 localStorage 读到合法 id；不存在的 id 不会被 isValidId 放进 state，
      // 所以这里走 fallback 仅是兜底（手动篡改 storage 之类）
      return found ?? ACU_V2_BUILTIN_THEMES[0];
    },
  },
  actions: {
    setTheme(id: AcuV2ThemeId): void {
      if (!themeExists(id, this.customThemes)) return;
      if (this.activeId === id) return;
      this.activeId = id;
      this.persist();
    },
    importCustomThemeFromJsonText(text: string): AcuV2Theme {
      const source = parseThemeFileText(text);
      const theme = normalizeThemeSource(source, this.customThemes);
      const builtinOverride = findBuiltinThemeByName(theme.name);
      if (builtinOverride) {
        this.customThemes = this.customThemes.filter(t => sanitizeThemeName(t.name) !== sanitizeThemeName(theme.name));
        this.activeId = builtinOverride.id;
        this.persist();
        return builtinOverride;
      }
      const index = this.customThemes.findIndex(t => t.id === theme.id);
      if (index >= 0) this.customThemes.splice(index, 1, theme);
      else {
        if (this.customThemes.length >= MAX_CUSTOM_THEMES) {
          throw new Error(`最多只能保存 ${MAX_CUSTOM_THEMES} 个自定义主题。`);
        }
        this.customThemes.push(theme);
      }
      this.activeId = theme.id;
      this.persist();
      return theme;
    },
    deleteCustomTheme(id: AcuV2ThemeId): boolean {
      if (!isCustomThemeId(id)) return false;
      const before = this.customThemes.length;
      this.customThemes = this.customThemes.filter(t => t.id !== id);
      if (this.customThemes.length === before) return false;
      if (this.activeId === id) this.activeId = ACU_V2_DEFAULT_THEME_ID;
      this.persist();
      return true;
    },
    buildThemeFile(id: AcuV2ThemeId): AcuV2CustomThemeFile {
      const theme = findThemeById(id, this.customThemes);
      if (!theme) throw new Error('主题不存在。');
      const isCustom = isCustomThemeId(theme.id);
      return {
        kind: ACU_V2_CUSTOM_THEME_FILE_KIND,
        version: ACU_V2_CUSTOM_THEME_FILE_VERSION,
        theme: {
          ...(isCustom ? { id: theme.id as AcuV2CustomThemeId } : {}),
          name: theme.name,
          colorScheme: theme.colorScheme,
          tokens: { ...theme.tokens },
        },
      };
    },
    persist(): void {
      writeSection(SECTION_KEY, buildPersistedTheme(this.$state));
    },
  },
});
