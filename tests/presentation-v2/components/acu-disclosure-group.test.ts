/**
 * AcuDisclosureGroup — 统一折叠组边框 / header / 三角动画
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h, ref } from 'vue';
import AcuDisclosureGroup from '../../../src/presentation-v2/components/_lib/AcuDisclosureGroup.vue';

interface Mounted {
  app: App<Element>;
  el: HTMLElement;
}

const mounted: Mounted[] = [];

function mountGroup(opts: {
  expanded?: boolean;
  bodyMode?: 'if' | 'show';
} = {}): Mounted {
  const wrapper = defineComponent({
    setup() {
      const expanded = ref(opts.expanded ?? false);
      return () => h(AcuDisclosureGroup, {
        label: '世界书',
        meta: '2 条',
        expanded: expanded.value,
        bodyId: 'body-a',
        bodyMode: opts.bodyMode ?? 'show',
        chevronOpenClass: 'legacy-chevron-open',
        onToggle: () => {
          expanded.value = !expanded.value;
        },
      }, {
        default: () => h('span', { class: 'body-content' }, '内容'),
      });
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  const entry = { app, el };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

describe('AcuDisclosureGroup', () => {
  it('渲染统一展开组 header，并同步 aria-expanded 与 chevron class', async () => {
    const { el } = mountGroup();

    const root = el.querySelector('.acu-disclosure-group') as HTMLElement;
    const header = el.querySelector('.acu-disclosure-group__header') as HTMLButtonElement;
    const chevron = el.querySelector('.acu-disclosure-group__chevron') as HTMLElement;

    expect(root).not.toBeNull();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.getAttribute('aria-controls')).toBe('body-a');
    expect(header.textContent).toContain('世界书');
    expect(header.textContent).toContain('2 条');
    expect(chevron.classList.contains('acu-disclosure-group__chevron--open')).toBe(false);
    expect(chevron.classList.contains('legacy-chevron-open')).toBe(false);

    header.click();
    await Promise.resolve();

    expect(root.classList.contains('acu-disclosure-group--expanded')).toBe(true);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(chevron.classList.contains('acu-disclosure-group__chevron--open')).toBe(true);
    expect(chevron.classList.contains('legacy-chevron-open')).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 180));
  });

  it('展开动画结束后 body 不再裁切溢出内容（下拉菜单等浮层要能越出折叠组）', async () => {
    const { el } = mountGroup();
    const header = el.querySelector('.acu-disclosure-group__header') as HTMLButtonElement;

    header.click();
    await Promise.resolve();
    // 动画进行中允许临时裁切。
    const body = el.querySelector('.acu-disclosure-group__body') as HTMLElement;
    expect(body.style.overflowY).toBe('hidden');

    await new Promise(resolve => setTimeout(resolve, 320));

    expect(body.style.overflowY).toBe('visible');
    expect(body.style.overflowX).toBe('visible');
    expect(body.style.height).toBe('');
  });

  it('bodyMode=if 时只在展开态挂载 body', async () => {
    const { el } = mountGroup({ bodyMode: 'if' });

    const header = el.querySelector('.acu-disclosure-group__header') as HTMLButtonElement;
    expect(el.querySelector('.acu-disclosure-group__body')).toBeNull();

    header.click();
    await Promise.resolve();

    expect(el.querySelector('.acu-disclosure-group__body')).not.toBeNull();

    await new Promise(resolve => setTimeout(resolve, 180));
  });

  it('bodyMode=if 收起时保留 body 到离场动画结束后再卸载', async () => {
    const { el } = mountGroup({ expanded: true, bodyMode: 'if' });

    const header = el.querySelector('.acu-disclosure-group__header') as HTMLButtonElement;
    expect(el.querySelector('.acu-disclosure-group__body')).not.toBeNull();

    header.click();
    await Promise.resolve();

    const leavingBody = el.querySelector('.acu-disclosure-group__body') as HTMLElement | null;
    expect(leavingBody).not.toBeNull();
    expect(leavingBody?.getAttribute('aria-hidden')).toBe('true');

    await new Promise(resolve => setTimeout(resolve, 180));

    expect(el.querySelector('.acu-disclosure-group__body')).toBeNull();
  });
});
