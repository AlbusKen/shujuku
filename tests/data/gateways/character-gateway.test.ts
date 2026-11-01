/**
 * tests/data/gateways/character-gateway.test.ts
 * 角色数据读取网关 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTavernHelper, mockLogWarn } = vi.hoisted(() => ({
  mockTavernHelper: {} as any,
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/shared/host-api', () => ({
  TavernHelper_API_ACU: mockTavernHelper,
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

import {
  CharacterWorldbookBindingError_ACU,
  getCurrentCharData_ACU,
  getCurrentCharacterWorldbookBinding_ACU,
  getCharLorebooks_ACU,
  getChatMessages_ACU,
} from '../../../src/data/gateways/character-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockTavernHelper).forEach(k => delete mockTavernHelper[k]);
});

describe('getCurrentCharData_ACU', () => {
  it('API 不可用返回 null', () => {
    expect(getCurrentCharData_ACU()).toBeNull();
  });

  it('API 可用返回角色数据', () => {
    const charData = { name: '角色A', description: '描述' };
    mockTavernHelper.getCharData = vi.fn().mockReturnValue(charData);
    expect(getCurrentCharData_ACU()).toEqual(charData);
  });

  it('传入 target 参数', () => {
    mockTavernHelper.getCharData = vi.fn().mockReturnValue({ name: '角色B' });
    getCurrentCharData_ACU('specific');
    expect(mockTavernHelper.getCharData).toHaveBeenCalledWith('specific');
  });
});

describe('getCharLorebooks_ACU', () => {
  it('API 不可用返回结构化空结果', async () => {
    expect(await getCharLorebooks_ACU()).toEqual({ primary: '', additional: [] });
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用返回世界书列表', async () => {
    const data = { primary: ['book1'], additional: ['book2'] };
    mockTavernHelper.getCharLorebooks = vi.fn().mockResolvedValue(data);
    expect(await getCharLorebooks_ACU({ type: 'all' })).toEqual(data);
  });
});

describe('getCurrentCharacterWorldbookBinding_ACU', () => {
  it('保留宿主原始名称，仅过滤空白并按精确身份去重', async () => {
    mockTavernHelper.getCharWorldbookNames = vi.fn().mockResolvedValue({
      primary: ' 主书 ', additional: [' 副书 ', '', '主书', '副书'],
    });
    mockTavernHelper.getCharLorebooks = vi.fn();

    await expect(getCurrentCharacterWorldbookBinding_ACU()).resolves.toEqual({
      primary: ' 主书 ',
      additional: [' 副书 ', '主书', '副书'],
      orderedNames: [' 主书 ', ' 副书 ', '主书', '副书'],
      apiSource: 'getCharWorldbookNames',
    });
    expect(mockTavernHelper.getCharWorldbookNames).toHaveBeenCalledWith('current');
    expect(mockTavernHelper.getCharLorebooks).not.toHaveBeenCalled();
  });

  it('统一入口缺失时不调用旧 API，而是抛 API 不可用错误', async () => {
    mockTavernHelper.getCharLorebooks = vi.fn().mockResolvedValue({
      primary: null, additional: ['书A', '书B', '书A'],
    });

    await expect(getCurrentCharacterWorldbookBinding_ACU()).rejects.toMatchObject({
      name: 'CharacterWorldbookApiUnavailableError_ACU',
    });
    expect(mockTavernHelper.getCharLorebooks).not.toHaveBeenCalled();
  });

  it('两个 API 都不可用时记录 capability 警告并抛具名错误', async () => {
    await expect(getCurrentCharacterWorldbookBinding_ACU()).rejects.toMatchObject({
      name: 'CharacterWorldbookApiUnavailableError_ACU',
    });
    expect(mockLogWarn).toHaveBeenCalledWith(
      '[CharacterGateway] 当前角色世界书 API 不可用。',
      { phase: 'character_worldbook_binding' },
    );
  });

  it('新 API 调用失败时不降级调用旧 API', async () => {
    const error = new Error('permission denied');
    mockTavernHelper.getCharWorldbookNames = vi.fn().mockRejectedValue(error);
    mockTavernHelper.getCharLorebooks = vi.fn();

    await expect(getCurrentCharacterWorldbookBinding_ACU()).rejects.toBe(error);
    expect(mockTavernHelper.getCharLorebooks).not.toHaveBeenCalled();
  });

  it.each([
    ['非对象', null],
    ['primary 非字符串', { primary: 1, additional: [] }],
    ['additional 非数组', { primary: '主书', additional: '副书' }],
    ['additional 含非字符串', { primary: '主书', additional: ['副书', 1] }],
  ])('宿主返回%s时抛契约错误', async (_description, response) => {
    mockTavernHelper.getCharWorldbookNames = vi.fn().mockResolvedValue(response);

    await expect(getCurrentCharacterWorldbookBinding_ACU()).rejects.toBeInstanceOf(CharacterWorldbookBindingError_ACU);
    await expect(getCurrentCharacterWorldbookBinding_ACU()).rejects.toMatchObject({
      name: 'CharacterWorldbookBindingContractError_ACU',
    });
  });
});

describe('getChatMessages_ACU', () => {
  it('API 不可用返回空数组', async () => {
    expect(await getChatMessages_ACU()).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用返回消息数组', async () => {
    const messages = [{ mes: '消息1' }, { mes: '消息2' }];
    mockTavernHelper.getChatMessages = vi.fn().mockResolvedValue(messages);
    expect(await getChatMessages_ACU('all', {})).toEqual(messages);
  });
});