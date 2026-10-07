/**
 * 桌宠 / 气泡 / 轮播按外观设置渲染：图片、尺寸、节奏、摆放、配色与语录池。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, defineComponent, effectScope, h, nextTick, ref, shallowRef, type App } from 'vue';

const pos = vi.hoisted(() => ({
  value: null as null | { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom' | null },
  save: vi.fn(),
}));

vi.mock('../../../src/presentation-v2/composables/useTaskActivity', () => ({
  readDeskPetPositionRatio: () => pos.value,
  saveDeskPetPositionRatio: (ratio: unknown) => pos.save(ratio),
}));

import DeskPet from '../../../src/presentation-v2/components/DeskPet.vue';
import NoticeBubble from '../../../src/presentation-v2/components/NoticeBubble.vue';
import { useNoticeCarousel, type NoticeSlide } from '../../../src/presentation-v2/composables/useNoticeCarousel';
import {
  defaultDeskPetAppearance_ACU,
  defaultNoticeBubbleAppearance_ACU,
  type DeskPetAppearance_ACU,
  type NoticeBubbleAppearance_ACU,
} from '../../../src/shared/desk-pet-appearance';
import { __resetNoticeHubForTests_ACU, getNoticeHubSnapshot_ACU, notify_ACU, subscribeNoticeHub_ACU } from '../../../src/shared/notice-hub';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountComponent(component: unknown, props: Record<string, unknown>): HTMLElement {
  const wrapper = defineComponent({ setup: () => () => h(component as any, props) });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  apps.push({ app, el });
  return el;
}

/** 测试里默认关掉随机待机小动作，避免抽签干扰断言。 */
function petAppearance(edit: (appearance: DeskPetAppearance_ACU) => void = () => undefined): DeskPetAppearance_ACU {
  const appearance = defaultDeskPetAppearance_ACU();
  for (const key of Object.keys(appearance.motion.idleActionWeights) as Array<keyof DeskPetAppearance_ACU['motion']['idleActionWeights']>) {
    appearance.motion.idleActionWeights[key] = 0;
  }
  edit(appearance);
  return appearance;
}

function mountPet(appearance: DeskPetAppearance_ACU) {
  const el = mountComponent(DeskPet, { busy: false, settingsVersion: 0, appearance });
  return {
    root: el.querySelector<HTMLElement>('.acu-desk-pet')!,
    img: () => el.querySelector<HTMLImageElement>('.acu-desk-pet__img'),
    peek: () => el.querySelector<HTMLImageElement>('.acu-desk-pet__peek-img'),
  };
}

function pointer(target: HTMLElement, type: string): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 20, clientY: 20 });
  target.dispatchEvent(event);
}

async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await nextTick();
}

afterEach(() => {
  while (apps.length) {
    const entry = apps.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
  pos.value = null;
  vi.useRealTimers();
});

describe('DeskPet 外观', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('缺省用内置图与 88px；自定义图替换动作帧、不套体型补偿，尺寸与动效开关生效', () => {
    const plain = mountPet(petAppearance());
    expect(plain.img()!.getAttribute('src')).toMatch(/idle/);
    expect(plain.img()!.classList.contains('is-custom')).toBe(false);
    expect(plain.root.style.width).toBe('88px');
    expect(plain.root.classList.contains('is-still')).toBe(false);

    const custom = mountPet(petAppearance(appearance => {
      appearance.images.idle = 'https://img.test/idle.png';
      appearance.size.wide = 120;
      appearance.motion.enabled = false;
    }));
    expect(custom.img()!.getAttribute('src')).toBe('https://img.test/idle.png');
    expect(custom.img()!.classList.contains('is-custom')).toBe(true);
    expect(custom.img()!.classList.contains('pose-idle')).toBe(true);
    expect(custom.root.style.width).toBe('120px');
    expect(custom.root.classList.contains('is-still')).toBe(true);
  });

  it('贴边后按设置的延时缩进，探头用自定义图；稀有造型概率与露出比例生效', async () => {
    pos.value = { x: 1, y: 0.5, edge: 'right' };
    const pet = mountPet(petAppearance(appearance => {
      appearance.images.peek = 'https://img.test/peek.png';
      appearance.motion.tuckDelayMs = 500;
      appearance.motion.peekOriginalChance = 0;
      appearance.size.peekDepthRatio = 0.5;
    }));
    await advance(499);
    expect(pet.peek()).toBeNull();
    await advance(1);
    expect(pet.peek()!.getAttribute('src')).toBe('https://img.test/peek.png');
    expect(pet.root.style.width).toBe('44px');

    const rare = mountPet(petAppearance(appearance => {
      appearance.images['peek-original'] = 'https://img.test/rare.png';
      appearance.motion.tuckDelayMs = 500;
      appearance.motion.peekOriginalChance = 1;
    }));
    await advance(500);
    expect(rare.peek()!.getAttribute('src')).toBe('https://img.test/rare.png');
  });

  it('缩进延时为 0 时不自动缩进；睡眠间隔为 0 时不睡', async () => {
    pos.value = { x: 1, y: 0.5, edge: 'right' };
    const pet = mountPet(petAppearance(appearance => {
      appearance.motion.tuckDelayMs = 0;
      appearance.motion.snoreAfterMs = 0;
    }));
    await advance(10 * 60 * 1000);
    expect(pet.peek()).toBeNull();
    expect(pet.img()!.classList.contains('pose-idle')).toBe(true);
  });

  it('按设置的时长睡着，互动反应按设置的时长结束', async () => {
    const pet = mountPet(petAppearance(appearance => {
      appearance.motion.snoreAfterMs = 5000;
      appearance.motion.reactionMs.shy = 300;
    }));
    await advance(4999);
    expect(pet.img()!.className).toMatch(/pose-idle/);
    await advance(1);
    expect(pet.img()!.className).toMatch(/pose-(snore|sit-snore)/);

    await advance(0);
    const awake = mountPet(petAppearance(appearance => {
      appearance.motion.reactionMs.shy = 300;
    }));
    pointer(awake.root, 'pointerdown');
    pointer(awake.root, 'pointerup');
    await nextTick();
    expect(awake.img()!.className).toMatch(/pose-shy/);
    await advance(299);
    expect(awake.img()!.className).toMatch(/pose-shy/);
    await advance(1);
    expect(awake.img()!.className).toMatch(/pose-idle/);
  });

  it('待机小动作按权重抽取、按设置的间隔触发', async () => {
    const pet = mountPet(petAppearance(appearance => {
      appearance.motion.idleActionWeights.eat = 5;
      appearance.motion.idleActionMinMs = 1000;
      appearance.motion.idleActionSpreadMs = 0;
    }));
    await advance(999);
    expect(pet.img()!.className).toMatch(/pose-idle/);
    await advance(1);
    expect(pet.img()!.className).toMatch(/pose-eat-a/);
  });
});

describe('NoticeBubble 外观', () => {
  const noticeSlide: NoticeSlide = {
    type: 'notice',
    key: 'n1',
    notice: { id: 'n1', kind: 'info', title: '标题', text: '内容', createdAt: 0, actions: [] },
    word: '忙活',
  };

  function mountBubble(props: Record<string, unknown> = {}): HTMLElement {
    const el = mountComponent(NoticeBubble, {
      slide: noticeSlide,
      task: null,
      anchor: null,
      viewportWidth: 1024,
      viewportHeight: 768,
      actionBusy: false,
      showRealWork: true,
      appearance: defaultNoticeBubbleAppearance_ACU(),
      ...props,
    });
    return el.querySelector<HTMLElement>('.acu-notice-bubble')!;
  }

  it('没有桌宠时按设置的角落停靠，配色、字号与边距经 CSS 变量下发', () => {
    const plain = mountBubble();
    expect([...plain.classList]).toEqual(expect.arrayContaining(['is-docked', 'is-dock-top', 'is-dock-right']));
    expect(plain.style.getPropertyValue('--acu-nb-bg')).toBe('#fffaf0');

    const appearance: NoticeBubbleAppearance_ACU = defaultNoticeBubbleAppearance_ACU();
    appearance.dock.corner = 'bottom-left';
    appearance.dock.offsetY = 30;
    appearance.colors.background = '#202020';
    appearance.fontSize = 14;
    appearance.size.detailMaxHeight = 240;
    const bubble = mountBubble({ appearance });
    expect([...bubble.classList]).toEqual(expect.arrayContaining(['is-docked', 'is-dock-bottom', 'is-dock-left']));
    expect(bubble.classList.contains('is-dock-top')).toBe(false);
    expect(bubble.style.getPropertyValue('--acu-nb-bg')).toBe('#202020');
    expect(bubble.style.getPropertyValue('--acu-nb-font-size')).toBe('14px');
    expect(bubble.style.getPropertyValue('--acu-nb-dock-y')).toBe('30px');
    expect(bubble.style.getPropertyValue('--acu-nb-detail-max-height')).toBe('240px');
  });

  it('语录标题取自轮播片，留空时不显示标题', () => {
    const titled = mountBubble({ slide: { type: 'joke', key: 'j1', text: '一条笑话', heading: '冷知识' } });
    expect(titled.querySelector('.acu-notice-bubble__heading')!.textContent).toBe('冷知识');
    const untitled = mountBubble({ slide: { type: 'joke', key: 'j2', text: '一条笑话', heading: '' } });
    expect(untitled.querySelector('.acu-notice-bubble__heading')).toBeNull();
  });

  it('贴桌宠时按方位顺序取第一个放得下的，间距生效；都放不下时用最后一个', () => {
    const anchor = { x: 500, y: 300, width: 88, height: 88 };
    expect(mountBubble({ anchor }).classList.contains('is-above')).toBe(true);

    const leftFirst = defaultNoticeBubbleAppearance_ACU();
    leftFirst.anchor.sides = ['left', 'above'];
    expect(mountBubble({ anchor, appearance: leftFirst }).classList.contains('is-left')).toBe(true);

    const wideGap = defaultNoticeBubbleAppearance_ACU();
    wideGap.anchor.gap = 30;
    expect(mountBubble({ anchor, appearance: wideGap }).style.transform).toBe('translate3d(544px, 270px, 0)');

    const cornered = defaultNoticeBubbleAppearance_ACU();
    cornered.anchor.sides = ['above', 'left'];
    const bubble = mountBubble({ anchor: { x: 0, y: 0, width: 88, height: 88 }, appearance: cornered });
    expect(bubble.classList.contains('is-left')).toBe(true);
  });
});

describe('useNoticeCarousel 外观节奏', () => {
  beforeEach(() => {
    __resetNoticeHubForTests_ACU();
    vi.useFakeTimers();
  });

  function startCarousel(pet: { value: DeskPetAppearance_ACU }, bubble: { value: NoticeBubbleAppearance_ACU }) {
    const snapshot = shallowRef(getNoticeHubSnapshot_ACU());
    const unsubscribe = subscribeNoticeHub_ACU(() => {
      snapshot.value = getNoticeHubSnapshot_ACU();
    });
    const hubState = {
      snapshot,
      silent: computed(() => false),
      petEnabled: computed(() => true),
      jokesEnabled: computed(() => true),
      showRealWork: computed(() => false),
      petAppearance: computed(() => pet.value),
      bubbleAppearance: computed(() => bubble.value),
    };
    const scope = effectScope();
    const carousel = scope.run(() => useNoticeCarousel(hubState, computed(() => [])))!;
    return {
      carousel,
      stop: () => {
        scope.stop();
        unsubscribe();
      },
    };
  }

  it('停留时长、插播频率、语录池、语录标题与状态词都取自设置', async () => {
    const pet = ref(defaultDeskPetAppearance_ACU());
    pet.value.jokes = { mode: 'replace', heading: '冷知识', items: ['自定义笑话'] };
    pet.value.statusWords.mode = 'replace';
    pet.value.statusWords.groups.generic = ['自定义忙'];
    const bubble = ref(defaultNoticeBubbleAppearance_ACU());
    bubble.value.carousel = { slideMs: 1000, slidesPerJoke: 1, idleJokeMs: 0 };
    const { carousel, stop } = startCarousel(pet, bubble);
    try {
      notify_ACU('info', '第一条通知');
      notify_ACU('info', '第二条通知');
      notify_ACU('info', '第三条通知');
      await nextTick();
      expect(carousel.slide.value).toMatchObject({ type: 'notice', word: '自定义忙', notice: { text: '第一条通知' } });
      await advance(999);
      expect(carousel.slide.value).toMatchObject({ notice: { text: '第一条通知' } });
      await advance(1);
      expect(carousel.slide.value).toMatchObject({ type: 'joke', text: '自定义笑话', heading: '冷知识' });
      await advance(1000);
      expect(carousel.slide.value).toMatchObject({ notice: { text: '第二条通知' } });
      await advance(3000);
      expect(carousel.slide.value).toBeNull();
      await advance(60 * 60 * 1000);
      expect(carousel.slide.value).toBeNull();
    } finally {
      stop();
    }
  });

  it('不插播时消息连续播放；空闲间隔改了以后立即按新值计时', async () => {
    const pet = ref(defaultDeskPetAppearance_ACU());
    pet.value.jokes = { mode: 'replace', heading: '你知道吗？', items: ['空闲笑话'] };
    const bubble = ref(defaultNoticeBubbleAppearance_ACU());
    bubble.value.carousel = { slideMs: 1000, slidesPerJoke: 0, idleJokeMs: 0 };
    const { carousel, stop } = startCarousel(pet, bubble);
    try {
      notify_ACU('info', '甲');
      notify_ACU('info', '乙');
      notify_ACU('info', '丙');
      await nextTick();
      await advance(1000);
      expect(carousel.slide.value).toMatchObject({ notice: { text: '乙' } });
      await advance(1000);
      expect(carousel.slide.value).toMatchObject({ notice: { text: '丙' } });
      await advance(1000);
      expect(carousel.slide.value).toBeNull();

      bubble.value = { ...bubble.value, carousel: { ...bubble.value.carousel, idleJokeMs: 10000 } };
      await nextTick();
      await advance(9999);
      expect(carousel.slide.value).toBeNull();
      await advance(1);
      expect(carousel.slide.value).toMatchObject({ type: 'joke', text: '空闲笑话' });
    } finally {
      stop();
    }
  });
});
