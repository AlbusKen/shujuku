/**
 * tests/data/storage/chat-history.test.ts
 * 聊天消息自定义字段读写 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetChatFirstLayerMessage,
  mockCloneScopedConfigData,
} = vi.hoisted(() => ({
  mockGetChatFirstLayerMessage: vi.fn(() => null),
  mockCloneScopedConfigData: vi.fn((data: any) => data ? JSON.parse(JSON.stringify(data)) : null),
}));

vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
}));

vi.mock('../../../src/shared/utils', () => ({
  getChatFirstLayerMessage_ACU: mockGetChatFirstLayerMessage,
  cloneScopedConfigData_ACU: mockCloneScopedConfigData,
}));

import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import {
  CHAT_SCOPED_CONFIG_FIELD_ACU,
  CHAT_SCOPED_CONFIG_VERSION_ACU,
  CHAT_SHEET_GUIDE_FIELD_ACU,
  CHAT_SHEET_GUIDE_VERSION_ACU,
  LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU,
  CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU,
  CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU,
  MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU,
  getChatScopedConfigContainer_ACU,
  getChatScopedConfigField_ACU,
  peekChatScopedConfigContainer_ACU,
  peekChatScopedConfigField_ACU,
  normalizeChatScopedConfigContainer_ACU,
  getChatSheetGuideContainer_ACU,
  peekChatSheetGuideContainer_ACU,
  setChatScopedConfigContainer_ACU,
  setChatSheetGuideContainer_ACU,
} from '../../../src/data/storage/chat-history';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetChatFirstLayerMessage.mockReturnValue(null);
  mockCloneScopedConfigData.mockImplementation((data: any) => data ? JSON.parse(JSON.stringify(data)) : null);
  _set_SillyTavern_API_ACU(undefined);
});

// ═══ 常量验证 ═══
describe('常量导出', () => {
  it('CHAT_SCOPED_CONFIG_FIELD_ACU 是字符串', () => {
    expect(typeof CHAT_SCOPED_CONFIG_FIELD_ACU).toBe('string');
    expect(CHAT_SCOPED_CONFIG_FIELD_ACU).toBe('TavernDB_ACU_ScopedConfig');
  });

  it('CHAT_SCOPED_CONFIG_VERSION_ACU 是数字', () => {
    expect(CHAT_SCOPED_CONFIG_VERSION_ACU).toBe(1);
  });

  it('CHAT_SHEET_GUIDE_FIELD_ACU 是字符串', () => {
    expect(typeof CHAT_SHEET_GUIDE_FIELD_ACU).toBe('string');
  });

  it('CHAT_SHEET_GUIDE_VERSION_ACU 是 2', () => {
    expect(CHAT_SHEET_GUIDE_VERSION_ACU).toBe(2);
  });

  it('LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU 是字符串', () => {
    expect(typeof LEGACY_CHAT_TABLE_HEADER_GUIDE_FIELD_ACU).toBe('string');
  });

  it('CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU 是字符串', () => {
    expect(typeof CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU).toBe('string');
  });

  it('CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU 是字符串', () => {
    expect(typeof CHAT_TEMPLATE_ARCHIVE_OPTION_PREFIX_ACU).toBe('string');
  });

  it('MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU 是正整数', () => {
    expect(MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_CHAT_TEMPLATE_ARCHIVES_PER_TAG_ACU)).toBe(true);
  });
});

// ═══ getChatScopedConfigContainer_ACU ═══
describe('getChatScopedConfigContainer_ACU', () => {
  it('无 chat 首条消息返回 null', () => {
    mockGetChatFirstLayerMessage.mockReturnValue(null);
    expect(getChatScopedConfigContainer_ACU([])).toBeNull();
  });

  it('首条消息无 ScopedConfig 字段返回 null', () => {
    mockGetChatFirstLayerMessage.mockReturnValue({});
    expect(getChatScopedConfigContainer_ACU([{}])).toBeNull();
  });

  it('ScopedConfig 为 JSON 字符串时正确解析', () => {
    const config = { version: 1, template: {} };
    const result = getChatScopedConfigContainer_ACU([{
      [CHAT_SCOPED_CONFIG_FIELD_ACU]: JSON.stringify(config),
    }]);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
  });

  it('ScopedConfig 为对象时直接返回', () => {
    const config = { version: 1, plot: { mode: 'chat_override' } };
    const result = getChatScopedConfigContainer_ACU([{
      [CHAT_SCOPED_CONFIG_FIELD_ACU]: config,
    }]);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
  });

  it('ScopedConfig 为数组时返回 null', () => {
    expect(getChatScopedConfigContainer_ACU([{
      [CHAT_SCOPED_CONFIG_FIELD_ACU]: [1, 2],
    }])).toBeNull();
  });

  it('chatMetadata 已有槽位优先于 chat[0] 旧字段', () => {
    const metadataConfig = { version: 1, template: { '': { mode: 'inherit_global' } } };
    const chatConfig = { version: 1, template: { '': { mode: 'chat_override', templateStr: '{"sheet_a":{"content":[["row_id"]]}}' } } };
    const metadata: any = { [CHAT_SCOPED_CONFIG_FIELD_ACU]: metadataConfig };
    _set_SillyTavern_API_ACU({ chatMetadata: metadata } as any);

    const result = getChatScopedConfigContainer_ACU([{ [CHAT_SCOPED_CONFIG_FIELD_ACU]: chatConfig }]);

    expect((result!.template as any)[''].mode).toBe('inherit_global');
    expect((metadata[CHAT_SCOPED_CONFIG_FIELD_ACU].template as any)[''].mode).toBe('inherit_global');
  });

  it('chatMetadata 缺失槽位时从 chat[0] 迁移补齐', () => {
    const metadataConfig = { version: 1, template: { other: { mode: 'inherit_global' } } };
    const chatConfig = { version: 1, template: { '': { mode: 'chat_override', templateStr: '{"sheet_a":{"content":[["row_id"]]}}' } } };
    const metadata: any = { [CHAT_SCOPED_CONFIG_FIELD_ACU]: metadataConfig };
    _set_SillyTavern_API_ACU({ chatMetadata: metadata } as any);

    const result = getChatScopedConfigContainer_ACU([{ [CHAT_SCOPED_CONFIG_FIELD_ACU]: chatConfig }]);

    expect((result!.template as any).other.mode).toBe('inherit_global');
    expect((result!.template as any)[''].mode).toBe('chat_override');
    expect((metadata[CHAT_SCOPED_CONFIG_FIELD_ACU].template as any)[''].mode).toBe('chat_override');
  });

  it('事务快照纯读取会合并 legacy ScopedConfig 但不回写 chatMetadata', () => {
    const metadataConfig = { version: 1, template: { other: { mode: 'inherit_global' } } };
    const chatConfig = { version: 1, template: { '': { mode: 'chat_override' } } };
    const metadata: any = { [CHAT_SCOPED_CONFIG_FIELD_ACU]: metadataConfig };
    const updateChatMetadata = vi.fn();
    _set_SillyTavern_API_ACU({
      chatId: 'current-chat',
      getCurrentChatId: () => 'current-chat',
      chatMetadata: metadata,
      updateChatMetadata,
    } as any);

    const result = peekChatScopedConfigContainer_ACU([{ [CHAT_SCOPED_CONFIG_FIELD_ACU]: chatConfig }]);

    expect((result!.template as any)[''].mode).toBe('chat_override');
    expect((metadata[CHAT_SCOPED_CONFIG_FIELD_ACU].template as any)['']).toBeUndefined();
    expect(updateChatMetadata).not.toHaveBeenCalled();
  });

  it('事务快照在 ScopedConfig metadata 整字段缺失时仍只读 legacy 数据', () => {
    const chatConfig = { version: 1, template: { '': { mode: 'chat_override' } } };
    const metadata: any = {};
    const updateChatMetadata = vi.fn();
    _set_SillyTavern_API_ACU({
      chatId: 'current-chat',
      getCurrentChatId: () => 'current-chat',
      chatMetadata: metadata,
      updateChatMetadata,
    } as any);

    const result = peekChatScopedConfigContainer_ACU([{ [CHAT_SCOPED_CONFIG_FIELD_ACU]: chatConfig }]);

    expect((result!.template as any)[''].mode).toBe('chat_override');
    expect(result).not.toBe(chatConfig);
    expect(metadata[CHAT_SCOPED_CONFIG_FIELD_ACU]).toBeUndefined();
    expect(updateChatMetadata).not.toHaveBeenCalled();
  });

  it('chat[0] 被删除或无字段时回退到 chatMetadata', () => {
    const metadataConfig = { version: 1, template: { '': { mode: 'chat_override', templateStr: '{"sheet_b":{"content":[["row_id"]]}}' } } };
    _set_SillyTavern_API_ACU({ chatMetadata: { [CHAT_SCOPED_CONFIG_FIELD_ACU]: metadataConfig } } as any);

    const result = getChatScopedConfigContainer_ACU([{}]);

    expect((result!.template as any)[''].mode).toBe('chat_override');
  });

  it('无活动聊天时不读取残留 chatMetadata', () => {
    const metadataConfig = { version: 1, templateArchives: { '': [{ presetName: '少女前线', templateStr: '{"sheet_b":{"content":[["row_id"]]}}' }] } };
    _set_SillyTavern_API_ACU({ chatMetadata: { [CHAT_SCOPED_CONFIG_FIELD_ACU]: metadataConfig } } as any);

    expect(getChatScopedConfigContainer_ACU([])).toBeNull();
  });

  it('宿主明确无当前聊天时不读取残留 chatMetadata', () => {
    const metadataConfig = { version: 1, templateArchives: { '': [{ presetName: '少女前线', templateStr: '{"sheet_b":{"content":[["row_id"]]}}' }] } };
    _set_SillyTavern_API_ACU({
      chatId: '',
      getCurrentChatId: () => '',
      chatMetadata: { [CHAT_SCOPED_CONFIG_FIELD_ACU]: metadataConfig },
    } as any);

    expect(getChatScopedConfigContainer_ACU([{}])).toBeNull();
  });

  it('新聊天不读取属于旧 chatId 的残留 chatMetadata', () => {
    const metadataConfig = { version: 1, templateArchives: { '': [{ presetName: '少女前线', templateStr: '{"sheet_b":{"content":[["row_id"]]}}' }] } };
    _set_SillyTavern_API_ACU({
      chatId: 'new-chat',
      getCurrentChatId: () => 'new-chat',
      chatMetadata: {
        [CHAT_SCOPED_CONFIG_FIELD_ACU]: metadataConfig,
        [`${CHAT_SCOPED_CONFIG_FIELD_ACU}__chatId`]: 'old-chat',
      },
    } as any);

    expect(getChatScopedConfigContainer_ACU([{}])).toBeNull();
  });

  it('无归属旧 chatMetadata 按旧数据兼容读取', () => {
    const metadataConfig = { version: 1, template: { '': { mode: 'chat_override', templateStr: '{"sheet_b":{"content":[["row_id"]]}}' } } };
    _set_SillyTavern_API_ACU({
      chatId: 'new-chat',
      getCurrentChatId: () => 'new-chat',
      chatMetadata: { [CHAT_SCOPED_CONFIG_FIELD_ACU]: metadataConfig },
    } as any);

    const result = getChatScopedConfigContainer_ACU([{}]);
    expect((result!.template as any)[''].mode).toBe('chat_override');
  });

  it('chatMetadata 归属当前 chatId 时允许读取', () => {
    const metadataConfig = { version: 1, template: { '': { mode: 'chat_override', templateStr: '{"sheet_b":{"content":[["row_id"]]}}' } } };
    _set_SillyTavern_API_ACU({
      chatId: 'current-chat',
      getCurrentChatId: () => 'current-chat',
      chatMetadata: {
        [CHAT_SCOPED_CONFIG_FIELD_ACU]: metadataConfig,
        [`${CHAT_SCOPED_CONFIG_FIELD_ACU}__chatId`]: 'current-chat',
      },
    } as any);

    const result = getChatScopedConfigContainer_ACU([{}]);
    expect((result!.template as any)[''].mode).toBe('chat_override');
  });

  it('无活动聊天时不写入残留 chatMetadata', () => {
    const metadata: any = {};
    _set_SillyTavern_API_ACU({
      chatId: '',
      getCurrentChatId: () => '',
      chatMetadata: metadata,
      updateChatMetadata: vi.fn((next: any) => Object.assign(metadata, next)),
    } as any);

    setChatScopedConfigContainer_ACU([{}], { version: 1, templateArchives: { '': [{ presetName: '少女前线' }] } });

    expect(metadata[CHAT_SCOPED_CONFIG_FIELD_ACU]).toBeUndefined();
  });

  it('写入 chatMetadata 时记录当前 chatId 归属', () => {
    const metadata: any = {};
    _set_SillyTavern_API_ACU({
      chatId: 'current-chat',
      getCurrentChatId: () => 'current-chat',
      chatMetadata: metadata,
      updateChatMetadata: vi.fn((next: any) => Object.assign(metadata, next)),
    } as any);

    setChatScopedConfigContainer_ACU([{}], { version: 1, templateArchives: { '': [{ presetName: '少女前线' }] } });

    expect(metadata[CHAT_SCOPED_CONFIG_FIELD_ACU]).toBeDefined();
    expect(metadata[`${CHAT_SCOPED_CONFIG_FIELD_ACU}__chatId`]).toBe('current-chat');
  });
});

describe('ScopedConfig 字段级读取', () => {
  const field = 'flightModeByIsolationKey';
  const readers = [getChatScopedConfigField_ACU, peekChatScopedConfigField_ACU];

  function install(config: unknown, chatId = 'current-chat') {
    const updateChatMetadata = vi.fn();
    const metadata: any = {
      [CHAT_SCOPED_CONFIG_FIELD_ACU]: config,
      [`${CHAT_SCOPED_CONFIG_FIELD_ACU}__chatId`]: chatId,
    };
    _set_SillyTavern_API_ACU({ chatId, chatMetadata: metadata, updateChatMetadata } as any);
    return { metadata, updateChatMetadata };
  }

  it.each([0, 256 * 1024, 3 * 1024 * 1024])('重复读取不序列化无关归档（%i 字节）', size => {
    const archiveToJSON = vi.fn(() => ({ payload: 'x'.repeat(size) }));
    const config = {
      version: 1,
      templateArchives: { '': [{ toJSON: archiveToJSON }] },
      [field]: { '': { enabled: false, hiddenRowIds: [] } },
    };
    const { metadata, updateChatMetadata } = install(config);
    const chat = [{}];
    for (const read of readers) {
      for (let i = 0; i < 20; i++) {
        const result = read(chat, field) as any;
        expect(result).toEqual(config[field]);
        expect(result).not.toBe(config[field]);
        result[''].hiddenRowIds.push('仅修改副本');
      }
    }
    expect(config[field][''].hiddenRowIds).toEqual([]);
    expect(archiveToJSON).not.toHaveBeenCalled();
    expect(mockCloneScopedConfigData.mock.calls.every(([value]) => Object.keys(value).every(key => key === field))).toBe(true);
    expect(metadata[CHAT_SCOPED_CONFIG_FIELD_ACU]).toBe(config);
    expect(updateChatMetadata).not.toHaveBeenCalled();
    // 确认探针能识别原完整容器读取的归档序列化。
    getChatScopedConfigContainer_ACU(chat);
    expect(archiveToJSON).toHaveBeenCalledOnce();
  });

  it('metadata 与 legacy 并存且无缺项时不复制归档、不回写', () => {
    const archiveToJSON = vi.fn(() => ({ payload: '归档正文' }));
    const config = { version: 1, templateArchives: { '': [{ toJSON: archiveToJSON }] },
      [field]: { '': { enabled: true, hiddenRowIds: ['metadata'] } } };
    const legacy = { ...config, [field]: { '': { enabled: false } } };
    const { updateChatMetadata } = install(config);
    for (const read of readers) {
      expect(read([{ [CHAT_SCOPED_CONFIG_FIELD_ACU]: legacy }], field)).toEqual(config[field]);
    }
    expect(archiveToJSON).not.toHaveBeenCalled();
    expect(updateChatMetadata).not.toHaveBeenCalled();
  });

  it('peek 仅合并请求字段，metadata 优先且不改写任一来源', () => {
    const config = { version: 1, [field]: { '': { enabled: false, hiddenRowIds: [] } } };
    const legacy = { version: 1, [field]: { '': { enabled: true }, other: { enabled: true, hiddenRowIds: [] } } };
    const { metadata, updateChatMetadata } = install(config);
    const result = peekChatScopedConfigField_ACU([{ [CHAT_SCOPED_CONFIG_FIELD_ACU]: legacy }], field) as any;
    expect(result).toEqual({ ...legacy[field], ...config[field] });
    result[''].hiddenRowIds.push('副本');
    result.other.hiddenRowIds.push('副本');
    expect(config[field][''].hiddenRowIds).toEqual([]);
    expect(legacy[field].other.hiddenRowIds).toEqual([]);
    expect(metadata[CHAT_SCOPED_CONFIG_FIELD_ACU]).toBe(config);
    expect(updateChatMetadata).not.toHaveBeenCalled();
  });

  it('get 保留完整 legacy 迁移，迁移后返回值仍与宿主隔离', () => {
    const config = { version: 1, [field]: { '': { enabled: false, hiddenRowIds: [] } } };
    const legacy = { version: 1, template: { tag: { mode: 'inherit_global' } },
      [field]: { other: { enabled: true, hiddenRowIds: [] } } };
    const { metadata, updateChatMetadata } = install(config);
    const result = getChatScopedConfigField_ACU([{ [CHAT_SCOPED_CONFIG_FIELD_ACU]: legacy }], field) as any;
    expect(result).toEqual({ ...config[field], ...legacy[field] });
    const saved = metadata[CHAT_SCOPED_CONFIG_FIELD_ACU];
    expect(saved.template).toEqual(legacy.template);
    expect(saved[field]).toEqual(result);
    expect(updateChatMetadata).toHaveBeenCalledOnce();
    result.other.hiddenRowIds.push('副本');
    expect(saved[field].other.hiddenRowIds).toEqual([]);
    expect(legacy[field].other.hiddenRowIds).toEqual([]);
    getChatScopedConfigField_ACU([{ [CHAT_SCOPED_CONFIG_FIELD_ACU]: legacy }], field);
    expect(updateChatMetadata).toHaveBeenCalledOnce();
  });

  it('legacy-only 的 peek 只读，get 迁移完整容器并记录归属', () => {
    const legacy = { version: 1, template: {}, [field]: { '': { enabled: true } } };
    const { metadata, updateChatMetadata } = install(undefined);
    const chat = [{ [CHAT_SCOPED_CONFIG_FIELD_ACU]: JSON.stringify(legacy) }];
    expect(peekChatScopedConfigField_ACU(chat, field)).toEqual(legacy[field]);
    expect(metadata[CHAT_SCOPED_CONFIG_FIELD_ACU]).toBeUndefined();
    expect(updateChatMetadata).not.toHaveBeenCalled();
    expect(getChatScopedConfigField_ACU(chat, field)).toEqual(legacy[field]);
    expect(metadata[CHAT_SCOPED_CONFIG_FIELD_ACU]).toEqual(legacy);
    expect(metadata[`${CHAT_SCOPED_CONFIG_FIELD_ACU}__chatId`]).toBe('current-chat');
  });

  it('切换聊天后忽略旧 owner，缺少活动聊天时不读取残留配置', () => {
    const { metadata } = install({ version: 1, [field]: { '': { enabled: true } } }, 'old-chat');
    _set_SillyTavern_API_ACU({ chatId: 'new-chat', chatMetadata: metadata } as any);
    const legacy = { version: 1, [field]: { '': { enabled: false } } };
    expect(peekChatScopedConfigField_ACU([{}], field)).toBeUndefined();
    expect(peekChatScopedConfigField_ACU([{ [CHAT_SCOPED_CONFIG_FIELD_ACU]: legacy }], field)).toEqual(legacy[field]);
    _set_SillyTavern_API_ACU({ chatId: '', chatMetadata: metadata } as any);
    for (const read of readers) {
      expect(read([{}], field)).toBeUndefined();
      expect(read([], field)).toBeUndefined();
    }
  });

  it('strict 区分缺失与损坏，并保持模板槽位检查', () => {
    install(undefined);
    expect(peekChatScopedConfigField_ACU([{}], field, { strict: true })).toBeUndefined();
    for (const damaged of ['{invalid', [], false]) {
      install(damaged);
      expect(() => peekChatScopedConfigField_ACU([{}], field, { strict: true })).toThrow('配置容器损坏');
      expect(peekChatScopedConfigField_ACU([{}], field)).toBeUndefined();
    }
    install({ version: 1, template: [] });
    expect(() => peekChatScopedConfigField_ACU([{}], field, { strict: true })).toThrow('模板槽位容器损坏');
    const { metadata } = install('{invalid', 'old-chat');
    _set_SillyTavern_API_ACU({ chatId: 'new-chat', chatMetadata: metadata } as any);
    expect(peekChatScopedConfigField_ACU([{}], field, { strict: true })).toBeUndefined();
  });
});

// ═══ normalizeChatScopedConfigContainer_ACU ═══
describe('normalizeChatScopedConfigContainer_ACU', () => {
  it('null 输入返回带 version 的空对象', () => {
    mockCloneScopedConfigData.mockReturnValue(null);
    const result = normalizeChatScopedConfigContainer_ACU(null);
    expect(result.version).toBe(CHAT_SCOPED_CONFIG_VERSION_ACU);
  });

  it('有效输入保留内容并确保 version', () => {
    const input = { version: 1, template: { '': { mode: 'chat_override' } } };
    mockCloneScopedConfigData.mockReturnValue(JSON.parse(JSON.stringify(input)));
    const result = normalizeChatScopedConfigContainer_ACU(input);
    expect(result.version).toBe(1);
    expect(result.template).toBeDefined();
  });

  it('version 缺失时补齐为默认版本', () => {
    mockCloneScopedConfigData.mockReturnValue({ template: {} });
    const result = normalizeChatScopedConfigContainer_ACU({ template: {} });
    expect(result.version).toBe(CHAT_SCOPED_CONFIG_VERSION_ACU);
  });

  it('version 小于默认版本时提升到默认版本', () => {
    mockCloneScopedConfigData.mockReturnValue({ version: 0 });
    const result = normalizeChatScopedConfigContainer_ACU({ version: 0 });
    expect(result.version).toBe(CHAT_SCOPED_CONFIG_VERSION_ACU);
  });
});

// ═══ getChatSheetGuideContainer_ACU ═══
describe('getChatSheetGuideContainer_ACU', () => {
  it('无首条消息返回 null', () => {
    mockGetChatFirstLayerMessage.mockReturnValue(null);
    expect(getChatSheetGuideContainer_ACU([])).toBeNull();
  });

  it('无 SheetGuide 字段返回 null', () => {
    mockGetChatFirstLayerMessage.mockReturnValue({});
    expect(getChatSheetGuideContainer_ACU([{}])).toBeNull();
  });

  it('SheetGuide 为 JSON 字符串时正确解析', () => {
    const guide = { version: 2, tags: {} };
    const result = getChatSheetGuideContainer_ACU([{
      [CHAT_SHEET_GUIDE_FIELD_ACU]: JSON.stringify(guide),
    }]);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(2);
  });

  it('SheetGuide 为对象时直接返回', () => {
    const guide = { version: 2, tags: { '': { data: {} } } };
    const result = getChatSheetGuideContainer_ACU([{
      [CHAT_SHEET_GUIDE_FIELD_ACU]: guide,
    }]);
    expect(result).not.toBeNull();
    expect(result!.tags).toBeDefined();
  });

  it('SheetGuide 的 chatMetadata 已有 tag 优先于 chat[0] 旧字段', () => {
    const metadataGuide = { version: 2, tags: { '': { data: { sheet_old: { name: '旧' } } } } };
    const chatGuide = { version: 2, tags: { '': { data: { sheet_new: { name: '新' } } } } };
    const metadata: any = { [CHAT_SHEET_GUIDE_FIELD_ACU]: metadataGuide };
    _set_SillyTavern_API_ACU({ chatMetadata: metadata } as any);

    const result = getChatSheetGuideContainer_ACU([{ [CHAT_SHEET_GUIDE_FIELD_ACU]: chatGuide }]);

    expect((result!.tags as any)[''].data.sheet_old.name).toBe('旧');
    expect((result!.tags as any)[''].data.sheet_new).toBeUndefined();
  });

  it('SheetGuide 的 chatMetadata 缺失 tag 时从 chat[0] 迁移补齐', () => {
    const metadataGuide = { version: 2, tags: { other: { data: { sheet_old: { name: '旧' } } } } };
    const chatGuide = { version: 2, tags: { '': { data: { sheet_new: { name: '新' } } } } };
    const metadata: any = { [CHAT_SHEET_GUIDE_FIELD_ACU]: metadataGuide };
    _set_SillyTavern_API_ACU({ chatMetadata: metadata } as any);

    const result = getChatSheetGuideContainer_ACU([{ [CHAT_SHEET_GUIDE_FIELD_ACU]: chatGuide }]);

    expect((result!.tags as any).other.data.sheet_old.name).toBe('旧');
    expect((result!.tags as any)[''].data.sheet_new.name).toBe('新');
    expect((metadata[CHAT_SHEET_GUIDE_FIELD_ACU].tags as any)[''].data.sheet_new.name).toBe('新');
  });

  it('事务快照纯读取会合并 legacy SheetGuide 但不回写 chatMetadata', () => {
    const metadataGuide = { version: 2, tags: { other: { data: { sheet_old: { name: '旧' } } } } };
    const chatGuide = { version: 2, tags: { '': { data: { sheet_new: { name: '新' } } } } };
    const metadata: any = { [CHAT_SHEET_GUIDE_FIELD_ACU]: metadataGuide };
    const updateChatMetadata = vi.fn();
    _set_SillyTavern_API_ACU({
      chatId: 'current-chat',
      getCurrentChatId: () => 'current-chat',
      chatMetadata: metadata,
      updateChatMetadata,
    } as any);

    const result = peekChatSheetGuideContainer_ACU([{ [CHAT_SHEET_GUIDE_FIELD_ACU]: chatGuide }]);

    expect((result!.tags as any).other.data.sheet_old.name).toBe('旧');
    expect((result!.tags as any)[''].data.sheet_new.name).toBe('新');
    expect((metadata[CHAT_SHEET_GUIDE_FIELD_ACU].tags as any)['']).toBeUndefined();
    expect(updateChatMetadata).not.toHaveBeenCalled();
  });

  it('事务快照在 SheetGuide metadata 整字段缺失时仍只读 legacy 数据', () => {
    const chatGuide = { version: 2, tags: { '': { data: { sheet_new: { name: '新' } } } } };
    const metadata: any = {};
    const updateChatMetadata = vi.fn();
    _set_SillyTavern_API_ACU({
      chatId: 'current-chat',
      getCurrentChatId: () => 'current-chat',
      chatMetadata: metadata,
      updateChatMetadata,
    } as any);

    const result = peekChatSheetGuideContainer_ACU([{ [CHAT_SHEET_GUIDE_FIELD_ACU]: chatGuide }]);

    expect((result!.tags as any)[''].data.sheet_new.name).toBe('新');
    expect(result).not.toBe(chatGuide);
    expect(metadata[CHAT_SHEET_GUIDE_FIELD_ACU]).toBeUndefined();
    expect(updateChatMetadata).not.toHaveBeenCalled();
  });

  it('SheetGuide 在首条消息字段不存在时回退到 chatMetadata', () => {
    const metadataGuide = { version: 2, tags: { '': { data: { sheet_meta: { name: '元数据' } } } } };
    _set_SillyTavern_API_ACU({ chatMetadata: { [CHAT_SHEET_GUIDE_FIELD_ACU]: metadataGuide } } as any);

    const result = getChatSheetGuideContainer_ACU([{}]);

    expect((result!.tags as any)[''].data.sheet_meta.name).toBe('元数据');
  });

  it('无活动聊天时不读取残留 SheetGuide metadata', () => {
    const metadataGuide = { version: 2, tags: { '': { data: { sheet_meta: { name: '元数据' } } } } };
    _set_SillyTavern_API_ACU({
      chatId: '',
      getCurrentChatId: () => '',
      chatMetadata: { [CHAT_SHEET_GUIDE_FIELD_ACU]: metadataGuide },
    } as any);

    expect(getChatSheetGuideContainer_ACU([{}])).toBeNull();
  });

  it('新聊天不读取属于旧 chatId 的残留 SheetGuide metadata', () => {
    const metadataGuide = { version: 2, tags: { '': { data: { sheet_meta: { name: '元数据' } } } } };
    _set_SillyTavern_API_ACU({
      chatId: 'new-chat',
      getCurrentChatId: () => 'new-chat',
      chatMetadata: {
        [CHAT_SHEET_GUIDE_FIELD_ACU]: metadataGuide,
        [`${CHAT_SHEET_GUIDE_FIELD_ACU}__chatId`]: 'old-chat',
      },
    } as any);

    expect(getChatSheetGuideContainer_ACU([{}])).toBeNull();
  });

  it('无活动聊天时不写入残留 SheetGuide metadata', () => {
    const metadata: any = {};
    _set_SillyTavern_API_ACU({
      chatId: '',
      getCurrentChatId: () => '',
      chatMetadata: metadata,
      updateChatMetadata: vi.fn((next: any) => Object.assign(metadata, next)),
    } as any);

    setChatSheetGuideContainer_ACU([{}], { version: 2, tags: { '': { data: { sheet_meta: { name: '元数据' } } } } });

    expect(metadata[CHAT_SHEET_GUIDE_FIELD_ACU]).toBeUndefined();
  });
});
