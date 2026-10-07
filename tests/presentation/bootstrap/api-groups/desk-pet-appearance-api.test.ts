import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: {} as Record<string, any>,
  saveSettings: vi.fn((): any => ({ saved: true, storageType: 'tavern' })),
  notify: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../../src/service/runtime/state-manager', () => ({ settings_ACU: h.settings }));
vi.mock('../../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: () => h.saveSettings() }));
vi.mock('../../../../src/shared/notice-hub', () => ({ notifyNoticeSettingsChanged_ACU: () => h.notify() }));
vi.mock('../../../../src/shared/utils', () => ({ logWarn_ACU: (...args: unknown[]) => h.warn(...args) }));

import { createDeskPetAppearanceApi_ACU } from '../../../../src/presentation/bootstrap/api-groups/desk-pet-appearance-api';

const api = () => createDeskPetAppearanceApi_ACU();

describe('AutoCardUpdaterAPI.deskPet / noticeBubble 外观接口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.saveSettings.mockImplementation(() => ({ saved: true, storageType: 'tavern' }));
    for (const key of Object.keys(h.settings)) delete h.settings[key];
  });

  it('没有自定义时读取缺省值；每次返回新对象', () => {
    const { deskPet, noticeBubble } = api();
    const first = deskPet.getAppearance();
    expect(first.size.wide).toBe(88);
    expect(first.images.idle).toBeNull();
    first.size.wide = 1;
    first.jokes.items.push('改返回值');
    expect(deskPet.getAppearance().size.wide).toBe(88);
    expect(deskPet.getAppearance().jokes.items).toEqual([]);
    expect(deskPet.getOverrides()).toEqual({});
    expect(deskPet.getIssues()).toEqual([]);
    expect(noticeBubble.getAppearance().dock.corner).toBe('top-right');
    expect(deskPet.imageKeys()).toHaveLength(27);
    expect(Object.isFrozen(deskPet)).toBe(true);
    expect(Object.isFrozen(noticeBubble)).toBe(true);
  });

  it('补丁合并后只存改过的项，保存一次并通知桌宠与气泡刷新', () => {
    const { deskPet } = api();
    const saved = deskPet.updateAppearance({
      images: { idle: 'https://img.test/idle.png' },
      size: { wide: 120 },
      jokes: { mode: 'replace', items: ['自定义语录'] },
    });
    expect(saved.images.idle).toBe('https://img.test/idle.png');
    expect(saved.images.blink).toBeNull();
    expect(saved.size).toMatchObject({ wide: 120, narrow: 64 });
    expect(h.settings.deskPetAppearance).toEqual({
      images: { idle: 'https://img.test/idle.png' },
      size: { wide: 120 },
      jokes: { mode: 'replace', items: ['自定义语录'] },
    });
    expect(h.saveSettings).toHaveBeenCalledOnce();
    expect(h.notify).toHaveBeenCalledOnce();

    deskPet.updateAppearance({ size: { narrow: 72 }, jokes: { items: ['换一条'] } });
    expect(h.settings.deskPetAppearance.size).toEqual({ wide: 120, narrow: 72 });
    expect(h.settings.deskPetAppearance.jokes).toEqual({ mode: 'replace', items: ['换一条'] });
  });

  it('补丁不合法时抛错，不改设置、不保存、不通知', () => {
    const { deskPet, noticeBubble } = api();
    deskPet.updateAppearance({ size: { wide: 100 } });
    vi.clearAllMocks();
    const before = structuredClone(h.settings.deskPetAppearance);
    expect(() => deskPet.updateAppearance({ size: { wide: 100, narrow: 9999 } })).toThrow('deskPet.size.narrow');
    expect(() => deskPet.updateAppearance({ images: { cat: 'https://img.test/cat.png' } })).toThrow('deskPet.images.cat：不支持的设置项');
    expect(() => noticeBubble.updateAppearance({ size: { minWidth: 500 } })).toThrow('minWidth（500）');
    expect(h.settings.deskPetAppearance).toEqual(before);
    expect(h.settings.noticeBubbleAppearance).toBeUndefined();
    expect(h.saveSettings).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('null 恢复单项；resetAppearance 按路径恢复，全部恢复时删除字段', () => {
    const { deskPet } = api();
    deskPet.updateAppearance({ images: { idle: '/user/images/idle.png', blink: '/user/images/blink.png' }, size: { wide: 100 }, motion: { snoreAfterMs: 0 } });
    deskPet.updateAppearance({ images: { blink: null } });
    expect(h.settings.deskPetAppearance.images).toEqual({ idle: '/user/images/idle.png' });
    expect(deskPet.resetAppearance('images.idle').images.idle).toBeNull();
    expect(h.settings.deskPetAppearance).toEqual({ size: { wide: 100 }, motion: { snoreAfterMs: 0 } });
    expect(deskPet.resetAppearance(['size']).size.wide).toBe(88);
    expect(h.settings.deskPetAppearance).toEqual({ motion: { snoreAfterMs: 0 } });
    const reset = deskPet.resetAppearance();
    expect(reset.motion.snoreAfterMs).toBe(60000);
    expect('deskPetAppearance' in h.settings).toBe(false);
    expect(() => deskPet.resetAppearance('nope')).toThrow('deskPet.nope：不支持的设置项');
  });

  it('保存被拒绝时恢复原值并抛出保存提示，不通知刷新', () => {
    const { deskPet, noticeBubble } = api();
    h.saveSettings.mockImplementation(() => ({ saved: false, storageType: 'memory', code: 'settings_loading', warning: '设置仍在加载中，本次保存已被阻止以避免覆盖原配置。请稍后重试。' }));
    expect(() => noticeBubble.updateAppearance({ fontSize: 14 })).toThrow('设置仍在加载中');
    expect('noticeBubbleAppearance' in h.settings).toBe(false);

    h.saveSettings.mockImplementation(() => ({ saved: true, storageType: 'tavern' }));
    deskPet.updateAppearance({ size: { wide: 100 } });
    h.saveSettings.mockImplementation(() => ({ saved: false, storageType: 'memory', code: 'storage_error', error: '设置持久化失败。' }));
    vi.clearAllMocks();
    expect(() => deskPet.updateAppearance({ size: { wide: 140 } })).toThrow('设置持久化失败。');
    expect(() => deskPet.resetAppearance()).toThrow('设置持久化失败。');
    expect(h.settings.deskPetAppearance).toEqual({ size: { wide: 100 } });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('已存数据里的无效项列入 getIssues 并按缺省显示，下一次写入时丢弃并警告', () => {
    const { deskPet } = api();
    h.settings.deskPetAppearance = { size: { wide: 'big', narrow: 70 }, oldField: 1 };
    expect(deskPet.getIssues()).toHaveLength(2);
    expect(deskPet.getAppearance().size).toMatchObject({ wide: 88, narrow: 70 });
    expect(deskPet.getOverrides()).toEqual({ size: { narrow: 70 } });
    expect(h.settings.deskPetAppearance.oldField).toBe(1);
    deskPet.updateAppearance({ motion: { enabled: false } });
    expect(h.settings.deskPetAppearance).toEqual({ size: { narrow: 70 }, motion: { enabled: false } });
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('deskPet 已存数据里的无效项'), expect.any(Array));
  });

  it('气泡外观：配色、方位顺序与停靠角落', () => {
    const { noticeBubble } = api();
    const saved = noticeBubble.updateAppearance({
      colors: { background: '#202020', text: 'rgb(240, 240, 240)' },
      anchor: { sides: ['left', 'right'] },
      dock: { corner: 'bottom-left' },
      carousel: { slidesPerJoke: 0, idleJokeMs: 0 },
    });
    expect(saved.colors).toMatchObject({ background: '#202020', text: 'rgb(240, 240, 240)', border: '#e9cf8a' });
    expect(saved.anchor.sides).toEqual(['left', 'right']);
    expect(saved.carousel).toEqual({ slideMs: 5000, slidesPerJoke: 0, idleJokeMs: 0 });
    expect(noticeBubble.describe().some(field => field.path === 'colors.jokeBackground')).toBe(true);
    expect(noticeBubble.getDefaults().dock.corner).toBe('top-right');
  });

  it('位置：读取、校验后保存（保留 4 位小数）、恢复默认；保存失败时恢复原值', () => {
    const { deskPet } = api();
    expect(deskPet.getPosition()).toBeNull();
    expect(deskPet.setPosition({ x: 0.123456, y: 1 })).toEqual({ x: 0.1235, y: 1, edge: null });
    expect(h.settings.desktopPetPosition).toEqual({ x: 0.1235, y: 1, edge: null });
    expect(deskPet.setPosition({ x: 0, y: 0.5, edge: 'left' }).edge).toBe('left');
    expect(deskPet.getPosition()).toEqual({ x: 0, y: 0.5, edge: 'left' });
    expect(h.notify).toHaveBeenCalledTimes(2);
    expect(() => deskPet.setPosition({ x: 1.2, y: 0 })).toThrow('deskPet.position.x：应为 0~1 的比例');
    expect(() => deskPet.setPosition({ x: 0, y: 0, edge: 'middle' })).toThrow('deskPet.position.edge');
    expect(() => deskPet.setPosition({ x: 0, y: 0, z: 1 })).toThrow('deskPet.position.z：不支持的设置项');
    expect(() => deskPet.setPosition(null)).toThrow('应为 { x, y, edge? } 对象');

    h.saveSettings.mockImplementation(() => ({ saved: false, storageType: 'memory', code: 'storage_error', error: '设置持久化失败。' }));
    expect(() => deskPet.resetPosition()).toThrow('设置持久化失败。');
    expect(h.settings.desktopPetPosition).toEqual({ x: 0, y: 0.5, edge: 'left' });

    h.saveSettings.mockImplementation(() => ({ saved: true, storageType: 'tavern' }));
    expect(deskPet.resetPosition()).toBeNull();
    expect('desktopPetPosition' in h.settings).toBe(false);
    expect(deskPet.getPosition()).toBeNull();
  });
});
