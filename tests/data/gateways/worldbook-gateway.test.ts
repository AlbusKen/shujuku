/**
 * tests/data/gateways/worldbook-gateway.test.ts
 * 世界书 CRUD 操作网关 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTavernHelper, mockSillyTavern, mockLogWarn } = vi.hoisted(() => ({
  mockTavernHelper: {} as any,
  mockSillyTavern: {} as any,
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/shared/host-api', () => ({
  TavernHelper_API_ACU: mockTavernHelper,
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

import {
  isWorldbookApiAvailable_ACU,
  normalizeLorebookNameForMatch_ACU,
  resolveLorebookNameFromList_ACU,
  isLorebookNotFoundError_ACU,
  getLorebookEntries_ACU,
  setLorebookEntries_ACU,
  createLorebookEntries_ACU,
  deleteLorebookEntries_ACU,
  listLorebooks_ACU,
  getWorldBooks_ACU,
  getCurrentCharPrimaryLorebook_ACU,
  getCharLorebooks_ACU,
  invalidateLorebookListSnapshot_ACU,
} from '../../../src/data/gateways/worldbook-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockTavernHelper).forEach(k => delete mockTavernHelper[k]);
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
});

describe('isWorldbookApiAvailable_ACU', () => {
  it('API 不可用返回 false', () => {
    expect(isWorldbookApiAvailable_ACU()).toBe(false);
  });

  it('API 可用返回 true', () => {
    mockTavernHelper.getLorebookEntries = vi.fn();
    expect(isWorldbookApiAvailable_ACU()).toBe(true);
  });
});

describe('世界书名称匹配', () => {
  it('兼容全角字符、零宽字符、NBSP 与组合字符差异', () => {
    expect(normalizeLorebookNameForMatch_ACU('  ＡＢ\u200BＣ\u00A0e\u0301  ')).toBe('ABC é');
    expect(resolveLorebookNameFromList_ACU('ＡＢ\u200BＣ', ['ABC'])).toBe('ABC');
  });

  it('匹配时返回宿主列表中的原始真实名称', () => {
    expect(resolveLorebookNameFromList_ACU('剧情书', ['剧\u200B情书'])).toBe('剧\u200B情书');
  });

  it('归一化后出现重名时拒绝猜测', () => {
    expect(resolveLorebookNameFromList_ACU('ＡＢＣ', ['ABC', 'ＡＢＣ\u200B'])).toBeNull();
  });

  it('宿主书名带首尾空格时返回原始名（trim 仅用于匹配键），不得返回 trim 结果', () => {
    // 回归：resolver 返回 trim 后的名字会让后续宿主调用按不存在的名字索引 → not-found。
    expect(resolveLorebookNameFromList_ACU('剧情书', [' 剧情书 '])).toBe(' 剧情书 ');
    expect(resolveLorebookNameFromList_ACU(' 剧情书 ', [' 剧情书 '])).toBe(' 剧情书 ');
    expect(resolveLorebookNameFromList_ACU('剧情书', [{ name: '剧情书\u3000' }])).toBe('剧情书\u3000');
  });

  it('trim 后同名的多本书属于歧义，拒绝猜测；字节级精确命中优先生效', () => {
    expect(resolveLorebookNameFromList_ACU('剧情书', ['剧情书 ', ' 剧情书'])).toBeNull();
    expect(resolveLorebookNameFromList_ACU('剧情书 ', ['剧情书 ', ' 剧情书'])).toBe('剧情书 ');
  });
});

describe('isLorebookNotFoundError_ACU', () => {
  it.each([
    new Error('Worldbook "ghost" not found'),
    new Error('Could not find the lorebook'),
    new Error('世界书“旧书”不存在'),
    new Error('未能找到世界书'),
  ])('识别明确的世界书不存在错误', error => {
    expect(isLorebookNotFoundError_ACU(error)).toBe(true);
  });

  it.each([
    Object.assign(new Error('Worldbook "ghost" not found'), { name: 'AbortError' }),
    new Error('TaskAbortedByUser'),
    new Error('permission denied'),
    new Error('network unavailable'),
  ])('不把取消或其它读取故障归类为世界书不存在', error => {
    expect(isLorebookNotFoundError_ACU(error)).toBe(false);
  });
});

describe('getLorebookEntries_ACU', () => {
  it('API 不可用返回空数组', async () => {
    expect(await getLorebookEntries_ACU('book1')).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用返回条目', async () => {
    const entries = [{ uid: 1, content: '条目1' }];
    mockTavernHelper.getLorebookEntries = vi.fn().mockResolvedValue(entries);
    expect(await getLorebookEntries_ACU('book1')).toEqual(entries);
  });

  it('将宿主返回的非字符串 comment/name 归一为空串且不污染原对象', async () => {
    const entries: any[] = [
      { uid: 1, comment: 2024, name: { invalid: true } },
      { uid: 2, comment: '  保留空白  ', name: '正常名称' },
      { uid: 3, comment: null },
      null,
      'unexpected-entry',
    ];
    mockTavernHelper.getLorebookEntries = vi.fn().mockResolvedValue(entries);

    const result = await getLorebookEntries_ACU('book1');

    expect(result).toEqual([
      { uid: 1, comment: '', name: '' },
      { uid: 2, comment: '  保留空白  ', name: '正常名称' },
      { uid: 3, comment: '' },
      null,
      'unexpected-entry',
    ]);
    expect(result[0]).not.toBe(entries[0]);
    expect(result[1]).toBe(entries[1]);
    expect(entries[0]).toEqual({ uid: 1, comment: 2024, name: { invalid: true } });
    expect(mockLogWarn).toHaveBeenCalledWith(
      '[WorldbookGateway] 已归一化宿主返回的非字符串世界书条目文本字段。',
      expect.objectContaining({
        phase: 'normalize_entry_text_field',
        bookName: 'book1',
        normalizedFields: expect.arrayContaining([
          { uid: 1, field: 'comment', sourceType: 'number' },
          { uid: 1, field: 'name', sourceType: 'object' },
          { uid: 3, field: 'comment', sourceType: 'object' },
        ]),
      }),
    );
  });

  it('not-found 时只读取一次，不枚举列表、不替换名称也不重试', async () => {
    const error = new Error('Worldbook "ABC" not found');
    mockTavernHelper.getLorebookEntries = vi.fn().mockRejectedValue(error);
    mockTavernHelper.getLorebooks = vi.fn();

    await expect(getLorebookEntries_ACU('ABC')).rejects.toBe(error);
    expect(mockTavernHelper.getLorebooks).not.toHaveBeenCalled();
    expect(mockTavernHelper.getLorebookEntries).toHaveBeenCalledTimes(1);
  });
});

describe('setLorebookEntries_ACU', () => {
  it('API 不可用时静默跳过', async () => {
    await setLorebookEntries_ACU('book1', []);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用时调用', async () => {
    mockTavernHelper.setLorebookEntries = vi.fn().mockResolvedValue(undefined);
    await setLorebookEntries_ACU('book1', [{ uid: 1 }]);
    expect(mockTavernHelper.setLorebookEntries).toHaveBeenCalledWith('book1', [{ uid: 1 }]);
  });
});

describe('createLorebookEntries_ACU', () => {
  it('API 不可用时静默跳过', async () => {
    await createLorebookEntries_ACU('book1', []);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用时调用', async () => {
    mockTavernHelper.createLorebookEntries = vi.fn().mockResolvedValue(undefined);
    await createLorebookEntries_ACU('book1', [{ content: '新条目' }]);
    expect(mockTavernHelper.createLorebookEntries).toHaveBeenCalled();
  });
});

describe('deleteLorebookEntries_ACU', () => {
  it('API 不可用时静默跳过', async () => {
    await deleteLorebookEntries_ACU('book1', [1]);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用时调用', async () => {
    mockTavernHelper.deleteLorebookEntries = vi.fn().mockResolvedValue(undefined);
    await deleteLorebookEntries_ACU('book1', [1, 2]);
    expect(mockTavernHelper.deleteLorebookEntries).toHaveBeenCalledWith('book1', [1, 2]);
  });
});

describe('listLorebooks_ACU', () => {
  it('两个 API 都不可用返回空数组', async () => {
    expect(await listLorebooks_ACU()).toEqual([]);
  });

  it('优先使用 TavernHelper', async () => {
    mockTavernHelper.getLorebooks = vi.fn().mockResolvedValue(['book1', 'book2']);
    mockSillyTavern.getWorldBooks = vi.fn().mockResolvedValue(['book3']);
    expect(await listLorebooks_ACU()).toEqual(['book1', 'book2']);
    expect(mockSillyTavern.getWorldBooks).not.toHaveBeenCalled();
  });

  it('统一兼容 API 缺失时不调用 SillyTavern', async () => {
    mockSillyTavern.getWorldBooks = vi.fn().mockResolvedValue(['book3']);
    expect(await listLorebooks_ACU()).toEqual([]);
    expect(mockSillyTavern.getWorldBooks).not.toHaveBeenCalled();
  });

  it('forceRefresh 先失效快照再把选项传给 getLorebooks', async () => {
    mockTavernHelper.invalidateLorebookListSnapshot = vi.fn();
    mockTavernHelper.getLorebooks = vi.fn().mockResolvedValue(['fresh']);
    expect(await listLorebooks_ACU({ forceRefresh: true })).toEqual(['fresh']);
    expect(mockTavernHelper.invalidateLorebookListSnapshot).toHaveBeenCalledTimes(1);
    expect(mockTavernHelper.getLorebooks).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it('invalidateLorebookListSnapshot_ACU 优先调用兼容层同名方法', () => {
    mockTavernHelper.invalidateLorebookListSnapshot = vi.fn();
    mockTavernHelper.invalidateSettingsSnapshot = vi.fn();
    invalidateLorebookListSnapshot_ACU();
    expect(mockTavernHelper.invalidateLorebookListSnapshot).toHaveBeenCalledTimes(1);
    expect(mockTavernHelper.invalidateSettingsSnapshot).not.toHaveBeenCalled();
  });
});

describe('getWorldBooks_ACU', () => {
  it('API 不可用返回空数组', async () => {
    expect(await getWorldBooks_ACU()).toEqual([]);
  });

  it('复用统一兼容 API 的列表入口', async () => {
    mockTavernHelper.getLorebooks = vi.fn().mockResolvedValue(['book1']);
    expect(await getWorldBooks_ACU()).toEqual(['book1']);
    expect(mockTavernHelper.getLorebooks).toHaveBeenCalledTimes(1);
  });
});

describe('getCurrentCharPrimaryLorebook_ACU', () => {
  it('API 不可用返回 null', async () => {
    expect(await getCurrentCharPrimaryLorebook_ACU()).toBeNull();
  });

  it('API 可用返回世界书名', async () => {
    mockTavernHelper.getCurrentCharPrimaryLorebook = vi.fn().mockResolvedValue('主世界书');
    expect(await getCurrentCharPrimaryLorebook_ACU()).toBe('主世界书');
  });
});

describe('getCharLorebooks_ACU', () => {
  it('API 不可用返回空对象', async () => {
    const result = await getCharLorebooks_ACU();
    expect(result).toEqual({ primary: '', additional: [] });
  });

  it('API 可用返回世界书列表', async () => {
    const data = { primary: ['book1'], additional: ['book2'] };
    mockTavernHelper.getCharLorebooks = vi.fn().mockResolvedValue(data);
    expect(await getCharLorebooks_ACU()).toEqual(data);
  });
});