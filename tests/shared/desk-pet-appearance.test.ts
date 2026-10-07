import { describe, expect, it } from 'vitest';
import {
  applyAppearancePatch_ACU,
  describeAppearance_ACU,
  isAllowedImageUrl_ACU,
  isCssColor_ACU,
  readAppearanceOverrides_ACU,
  resetAppearanceOverrides_ACU,
  resolveAppearance_ACU,
  validateAppearancePatch_ACU,
} from '../../src/shared/appearance-schema';
import {
  DESK_PET_APPEARANCE_SCHEMA_ACU,
  DESK_PET_IMAGE_KEYS_ACU,
  DESK_PET_IMAGES_TOTAL_MAX_LENGTH_ACU,
  DESK_PET_IMAGE_MAX_LENGTH_ACU,
  DESK_PET_STATUS_GROUPS_ACU,
  NOTICE_BUBBLE_APPEARANCE_SCHEMA_ACU,
  checkDeskPetAppearance_ACU,
  checkNoticeBubbleAppearance_ACU,
  defaultDeskPetAppearance_ACU,
  defaultNoticeBubbleAppearance_ACU,
} from '../../src/shared/desk-pet-appearance';
import { deskPetJokes, pickDeskPetJoke, resolveDeskPetJokePool } from '../../src/presentation-v2/copy/desk-pet-jokes';
import { deskPetStatusWords, pickDeskPetStatusWord, resolveDeskPetStatusWords } from '../../src/presentation-v2/copy/desk-pet-status-words';

const PET = DESK_PET_APPEARANCE_SCHEMA_ACU;
const BUBBLE = NOTICE_BUBBLE_APPEARANCE_SCHEMA_ACU;

describe('桌宠 / 气泡外观缺省值', () => {
  it('与改造前写死在组件里的常量一致', () => {
    const pet = defaultDeskPetAppearance_ACU();
    expect(Object.keys(pet.images)).toEqual([...DESK_PET_IMAGE_KEYS_ACU]);
    expect(Object.keys(pet.images)).toHaveLength(27);
    expect(Object.values(pet.images).every(value => value === null)).toBe(true);
    expect(pet.size).toEqual({ wide: 88, narrow: 64, peekDepthRatio: 0.56, peekOriginalDepthRatio: 0.61 });
    expect(pet.motion).toEqual({
      enabled: true,
      idleActionMinMs: 15000,
      idleActionSpreadMs: 5000,
      idleActionWeights: { blink: 16, doubleBlink: 8, lookAround: 14, walk: 18, roll: 10, eat: 14, yawn: 10, glance: 10 },
      snoreAfterMs: 60000,
      tuckDelayMs: 4000,
      peekRotateMs: 30000,
      peekOriginalChance: 0.01,
      waveCooldownMs: 30000,
      reactionMs: { shy: 1600, tickle: 1600, angry: 2200, happy: 1100, dizzy: 2400, surprised: 1300, wave: 1600, huff: 1000, pound: 1300, knockdown: 2200 },
    });
    expect(pet.jokes).toEqual({ mode: 'append', heading: '你知道吗？', items: [] });
    expect(pet.statusWords.mode).toBe('append');
    expect(Object.keys(pet.statusWords.groups)).toEqual([...DESK_PET_STATUS_GROUPS_ACU]);

    const bubble = defaultNoticeBubbleAppearance_ACU();
    expect(bubble.colors).toEqual({
      background: '#fffaf0', text: '#3d3122', muted: '#7a6a52', border: '#e9cf8a',
      info: '#d4a93a', success: '#6f9a4d', warning: '#d08a2c', error: '#c2503a',
      joke: '#e6b93c', jokeBackground: '#fff6d8', jokeHeading: '#a47a12', danger: '#c2503a', dangerText: '#a33d29',
    });
    expect(bubble.fontSize).toBe(12);
    expect(bubble.fontFamily).toBe('-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
    expect(bubble.borderRadius).toBe(12);
    expect(bubble.size).toEqual({ minWidth: 200, maxWidth: 400, dockedMaxWidth: 360, detailMaxHeight: 160 });
    expect(bubble.anchor).toEqual({ gap: 12, sides: ['above', 'below', 'left', 'right'] });
    expect(bubble.dock).toEqual({ corner: 'top-right', offsetX: 18, offsetY: 62, narrowOffsetY: 58 });
    expect(bubble.carousel).toEqual({ slideMs: 5000, slidesPerJoke: 2, idleJokeMs: 300000 });
  });

  it('每次返回新对象，改返回值不影响下一次', () => {
    const first = defaultNoticeBubbleAppearance_ACU();
    first.anchor.sides.push('right');
    first.colors.text = '#000';
    expect(defaultNoticeBubbleAppearance_ACU().anchor.sides).toEqual(['above', 'below', 'left', 'right']);
    expect(defaultNoticeBubbleAppearance_ACU().colors.text).toBe('#3d3122');
  });

  it('状态词分组与内置文案的分组一一对应', () => {
    expect(Object.keys(deskPetStatusWords)).toEqual([...DESK_PET_STATUS_GROUPS_ACU]);
  });
});

describe('补丁校验', () => {
  it('未知键、类型、范围、整数与 0 档都按字段路径报错', () => {
    expect(() => validateAppearancePatch_ACU(PET, { sizes: {} }, 'deskPet')).toThrow('deskPet.sizes：不支持的设置项');
    expect(() => validateAppearancePatch_ACU(PET, { size: { wide: '100' } }, 'deskPet')).toThrow('deskPet.size.wide：应为 32~256 的整数');
    expect(() => validateAppearancePatch_ACU(PET, { size: { wide: 300 } }, 'deskPet')).toThrow('deskPet.size.wide');
    expect(() => validateAppearancePatch_ACU(PET, { size: { wide: 90.5 } }, 'deskPet')).toThrow('整数');
    expect(() => validateAppearancePatch_ACU(PET, { motion: { snoreAfterMs: 100 } }, 'deskPet')).toThrow('0 或 5000~86400000');
    expect(validateAppearancePatch_ACU(PET, { motion: { snoreAfterMs: 0, tuckDelayMs: 0 } }, 'deskPet')).toEqual({ motion: { snoreAfterMs: 0, tuckDelayMs: 0 } });
    expect(() => validateAppearancePatch_ACU(PET, { motion: { enabled: 'no' } }, 'deskPet')).toThrow('true 或 false');
    expect(() => validateAppearancePatch_ACU(PET, { jokes: { mode: 'merge' } }, 'deskPet')).toThrow('可选 append / replace');
    expect(() => validateAppearancePatch_ACU(PET, [], 'deskPet')).toThrow('补丁必须是对象');
    expect(() => validateAppearancePatch_ACU(PET, { images: 'x' }, 'deskPet')).toThrow('deskPet.images：补丁必须是对象');
  });

  it('文本列表去掉首尾空白，空条目与超长条目报错；undefined 忽略、null 保留为恢复缺省', () => {
    expect(validateAppearancePatch_ACU(PET, { jokes: { items: ['  第一条 \n第二行  '], heading: undefined } }, 'deskPet'))
      .toEqual({ jokes: { items: ['第一条 \n第二行'] } });
    expect(() => validateAppearancePatch_ACU(PET, { jokes: { items: ['ok', '  '] } }, 'deskPet')).toThrow('deskPet.jokes.items[1]：应为非空字符串');
    expect(() => validateAppearancePatch_ACU(PET, { statusWords: { groups: { table: ['x'.repeat(21)] } } }, 'deskPet')).toThrow('不能超过 20 字');
    expect(validateAppearancePatch_ACU(PET, { images: { idle: null }, jokes: null }, 'deskPet')).toEqual({ images: { idle: null }, jokes: null });
    expect(validateAppearancePatch_ACU(PET, { jokes: { heading: '' } }, 'deskPet')).toEqual({ jokes: { heading: '' } });
  });

  it('方位顺序必须是不重复的合法方位', () => {
    expect(validateAppearancePatch_ACU(BUBBLE, { anchor: { sides: ['right', 'above'] } }, 'noticeBubble')).toEqual({ anchor: { sides: ['right', 'above'] } });
    expect(() => validateAppearancePatch_ACU(BUBBLE, { anchor: { sides: [] } }, 'noticeBubble')).toThrow('不重复的 1~4 项');
    expect(() => validateAppearancePatch_ACU(BUBBLE, { anchor: { sides: ['above', 'above'] } }, 'noticeBubble')).toThrow('不重复');
    expect(() => validateAppearancePatch_ACU(BUBBLE, { anchor: { sides: ['up'] } }, 'noticeBubble')).toThrow('noticeBubble.anchor.sides');
  });

  it('颜色只收十六进制、rgb()/hsl() 与颜色名，挡住能改写其它样式的值', () => {
    for (const color of ['#fff', '#FFFA', '#112233', '#11223344', 'rgb(1, 2, 3)', 'rgba(0,0,0,0.5)', 'hsl(30deg 50% 50% / 0.4)', 'transparent', 'white']) {
      expect(isCssColor_ACU(color)).toBe(true);
    }
    for (const color of ['url(https://x.test/a.png)', 'red; background: blue', '#12', 'var(--x)', 'rgb(1,2)', '"red"', 'expression(alert(1))']) {
      expect(isCssColor_ACU(color)).toBe(false);
    }
    expect(validateAppearancePatch_ACU(BUBBLE, { colors: { background: '  #222  ' } }, 'noticeBubble')).toEqual({ colors: { background: '#222' } });
    expect(() => validateAppearancePatch_ACU(BUBBLE, { colors: { text: 'url(x)' } }, 'noticeBubble')).toThrow('noticeBubble.colors.text：颜色格式不对');
  });

  it('字体名不允许分号、括号等 CSS 语法', () => {
    expect(validateAppearancePatch_ACU(BUBBLE, { fontFamily: '"霞鹜文楷", "Microsoft YaHei", sans-serif' }, 'noticeBubble'))
      .toEqual({ fontFamily: '"霞鹜文楷", "Microsoft YaHei", sans-serif' });
    expect(() => validateAppearancePatch_ACU(BUBBLE, { fontFamily: 'serif; color: red' }, 'noticeBubble')).toThrow('只能包含');
    expect(() => validateAppearancePatch_ACU(BUBBLE, { fontFamily: '   ' }, 'noticeBubble')).toThrow('不能为空');
  });

  it('图片只收 http(s)、站内路径与 data:image，并限制单张长度', () => {
    for (const url of ['https://img.test/pet.png', 'http://img.test/a.gif?x=1:2', '/user/images/pet.webp', 'user/images/pet.png', '//cdn.test/pet.png', 'data:image/png;base64,iVBORw0KGgo=', 'data:image/svg+xml;charset=utf-8,%3Csvg%3E']) {
      expect(isAllowedImageUrl_ACU(url)).toBe(true);
    }
    for (const url of ['javascript:alert(1)', 'blob:https://x.test/1', 'file:///C:/a.png', 'data:text/html;base64,PGgxPg==', 'C:/pics/a.png', 'https://x.test/a\n.png']) {
      expect(isAllowedImageUrl_ACU(url)).toBe(false);
    }
    expect(validateAppearancePatch_ACU(PET, { images: { idle: ' https://img.test/idle.png ' } }, 'deskPet')).toEqual({ images: { idle: 'https://img.test/idle.png' } });
    expect(() => validateAppearancePatch_ACU(PET, { images: { idle: '' } }, 'deskPet')).toThrow('要恢复内置图请传 null');
    expect(() => validateAppearancePatch_ACU(PET, { images: { idle: 'javascript:alert(1)' } }, 'deskPet')).toThrow('只支持 http(s)');
    const tooLong = `data:image/png;base64,${'A'.repeat(DESK_PET_IMAGE_MAX_LENGTH_ACU)}`;
    expect(() => validateAppearancePatch_ACU(PET, { images: { idle: tooLong } }, 'deskPet')).toThrow('超过上限');
  });
});

describe('覆盖项合并、读取与恢复', () => {
  it('对象逐层合并、数组整体替换、null 删除该项并清掉空分组，不改入参', () => {
    const overrides = { size: { wide: 100 }, jokes: { items: ['a', 'b'] }, images: { idle: 'https://img.test/idle.png' } };
    const snapshot = structuredClone(overrides);
    const next = applyAppearancePatch_ACU(PET, overrides, { size: { narrow: 70 }, jokes: { items: ['c'] }, images: { idle: null } });
    expect(next).toEqual({ size: { wide: 100, narrow: 70 }, jokes: { items: ['c'] } });
    expect(overrides).toEqual(snapshot);
    expect(applyAppearancePatch_ACU(PET, next, { size: null })).toEqual({ jokes: { items: ['c'] } });
  });

  it('生效值是缺省值叠加覆盖项，数组为新副本', () => {
    const overrides = { jokes: { items: ['a'] } };
    const effective = resolveAppearance_ACU(PET, overrides) as any;
    expect(effective.jokes).toEqual({ mode: 'append', heading: '你知道吗？', items: ['a'] });
    effective.jokes.items.push('b');
    expect(overrides.jokes.items).toEqual(['a']);
  });

  it('读取已存数据时逐项校验：无效项列入 issues 并按缺省处理，不改写存储', () => {
    const stored = {
      size: { wide: 999, narrow: 70 },
      images: { idle: 'javascript:alert(1)', blink: 'https://img.test/blink.png' },
      legacyKey: true,
      motion: 'fast',
    };
    const snapshot = structuredClone(stored);
    const { overrides, issues } = readAppearanceOverrides_ACU(PET, stored, 'deskPet');
    expect(overrides).toEqual({ size: { narrow: 70 }, images: { blink: 'https://img.test/blink.png' } });
    expect(issues).toHaveLength(4);
    expect(issues.join('\n')).toContain('deskPet.size.wide');
    expect(issues.join('\n')).toContain('deskPet.images.idle');
    expect(issues.join('\n')).toContain('deskPet.legacyKey：无法识别的设置项');
    expect(issues.join('\n')).toContain('deskPet.motion：已存数据不是对象');
    expect(stored).toEqual(snapshot);
    expect(readAppearanceOverrides_ACU(PET, undefined, 'deskPet')).toEqual({ overrides: {}, issues: [] });
    expect(readAppearanceOverrides_ACU(PET, 'broken', 'deskPet').issues).toEqual(['deskPet：已存数据不是对象，按缺省处理']);
  });

  it('按路径恢复缺省；不传全部恢复；路径不存在时抛错', () => {
    const overrides = { size: { wide: 100, narrow: 70 }, images: { idle: 'https://img.test/idle.png' }, jokes: { mode: 'replace' } };
    expect(resetAppearanceOverrides_ACU(PET, overrides, 'images.idle', 'deskPet')).toEqual({ size: { wide: 100, narrow: 70 }, jokes: { mode: 'replace' } });
    expect(resetAppearanceOverrides_ACU(PET, overrides, ['size.wide', 'jokes'], 'deskPet')).toEqual({ size: { narrow: 70 }, images: { idle: 'https://img.test/idle.png' } });
    expect(resetAppearanceOverrides_ACU(PET, overrides, undefined, 'deskPet')).toEqual({});
    expect(() => resetAppearanceOverrides_ACU(PET, overrides, 'images.cat', 'deskPet')).toThrow('deskPet.images.cat：不支持的设置项');
    expect(() => resetAppearanceOverrides_ACU(PET, overrides, 'size.wide.x', 'deskPet')).toThrow('不是分组');
    expect(() => resetAppearanceOverrides_ACU(PET, overrides, 3, 'deskPet')).toThrow('字符串或字符串数组');
  });

  it('字段说明列出全部叶子字段的路径、类型、缺省值与范围', () => {
    const fields = describeAppearance_ACU(PET);
    expect(fields.find(field => field.path === 'images.peek-sleepy')).toMatchObject({ type: 'image', default: null, maxLength: DESK_PET_IMAGE_MAX_LENGTH_ACU });
    expect(fields.find(field => field.path === 'motion.snoreAfterMs')).toMatchObject({ type: 'number', default: 60000, min: 5000, zeroAllowed: true, integer: true });
    expect(fields.find(field => field.path === 'statusWords.groups.generic')).toMatchObject({ type: 'textList', default: [], maxItems: 200, maxLength: 20 });
    expect(describeAppearance_ACU(BUBBLE).find(field => field.path === 'dock.corner')).toMatchObject({ type: 'enum', default: 'top-right', values: ['top-right', 'top-left', 'bottom-right', 'bottom-left'] });
  });

  it('跨字段检查：图片总量与最小宽度', () => {
    const pet = defaultDeskPetAppearance_ACU();
    const big = `data:image/png;base64,${'A'.repeat(DESK_PET_IMAGE_MAX_LENGTH_ACU - 30)}`;
    pet.images.idle = big;
    pet.images.blink = big;
    pet.images.shy = big;
    expect(() => checkDeskPetAppearance_ACU(pet)).not.toThrow();
    pet.images.wave = big;
    pet.images.huff = big;
    expect(big.length * 5).toBeGreaterThan(DESK_PET_IMAGES_TOTAL_MAX_LENGTH_ACU);
    expect(() => checkDeskPetAppearance_ACU(pet)).toThrow('deskPet.images：自定义图片合计');

    const bubble = defaultNoticeBubbleAppearance_ACU();
    bubble.size.minWidth = 380;
    expect(() => checkNoticeBubbleAppearance_ACU(bubble)).toThrow('dockedMaxWidth（360）');
  });
});

describe('语录池与状态词', () => {
  it('append 追加到内置之后；replace 只用自定义；自定义为空时仍用内置', () => {
    expect(resolveDeskPetJokePool({ mode: 'append', items: [] })).toBe(deskPetJokes);
    expect(resolveDeskPetJokePool({ mode: 'replace', items: [] })).toBe(deskPetJokes);
    expect(resolveDeskPetJokePool({ mode: 'replace', items: ['只有这条'] })).toEqual(['只有这条']);
    const appended = resolveDeskPetJokePool({ mode: 'append', items: ['新的一条'] });
    expect(appended).toHaveLength(deskPetJokes.length + 1);
    expect(appended[appended.length - 1]).toBe('新的一条');
    expect(pickDeskPetJoke(undefined, () => 0.99, ['只有这条'])).toBe('只有这条');
  });

  it('状态词按组合成，replace 模式下空组仍用内置', () => {
    const groups = Object.fromEntries(DESK_PET_STATUS_GROUPS_ACU.map(group => [group, [] as string[]])) as Record<string, string[]>;
    groups.table = ['自定义填表'];
    const replaced = resolveDeskPetStatusWords({ mode: 'replace', groups: groups as any });
    expect(replaced.table).toEqual(['自定义填表']);
    expect(replaced.plan).toBe(deskPetStatusWords.plan);
    expect(pickDeskPetStatusWord('自动填表', () => 0.5, replaced)).toBe('自定义填表');
    const appended = resolveDeskPetStatusWords({ mode: 'append', groups: groups as any });
    expect(appended.table).toEqual([...deskPetStatusWords.table, '自定义填表']);
    expect(resolveDeskPetStatusWords()).toBe(deskPetStatusWords);
  });
});
