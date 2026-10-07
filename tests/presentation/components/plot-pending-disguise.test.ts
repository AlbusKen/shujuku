/**
 * 剧情推进虚拟等待楼层：按酒馆真实楼层的模板与规则渲染。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  api: undefined as any,
  /** host-input 只用到 jQuery 的选择、val 与 trigger。 */
  jq(selector: string, context?: Document) {
    const nodes = [...(context ?? document).querySelectorAll<HTMLElement>(selector)];
    return Object.assign(nodes, {
      val(value?: string): any {
        const field = nodes[0] as HTMLTextAreaElement | undefined;
        if (value === undefined) return field?.value;
        if (field) field.value = value;
        return this;
      },
      trigger(): any {
        return this;
      },
    });
  },
}));

vi.mock('../../../src/shared/host-api', () => ({
  get SillyTavern_API_ACU() {
    return h.api;
  },
  jQuery_API_ACU: h.jq,
}));

import {
  beginPlotSendDisguise_ACU,
  beginPlotVirtualPendingFloor_ACU,
  disposePlotPendingDisguise_ACU,
} from '../../../src/presentation/components/plot-pending-disguise';

/** 与酒馆 1.13.5 public/index.html #message_template 同结构（省略按钮内的图标与 i18n 属性）。 */
const ST_MESSAGE_TEMPLATE = `
<div id="message_template" class="template_element">
  <div class="mes" mesid="" ch_name="" is_user="" is_system="" bookmark_link="">
    <div class="for_checkbox"></div><input type="checkbox" class="del_checkbox">
    <div class="mesAvatarWrapper">
      <div class="avatar"><img src=""></div>
      <div class="mesIDDisplay"></div>
      <div class="mes_timer"></div>
      <div class="tokenCounterDisplay"></div>
    </div>
    <div class="swipe_left fa-solid fa-chevron-left" style="display: none;"></div>
    <div class="mes_block">
      <div class="ch_name flex-container justifySpaceBetween">
        <div class="flex-container flex1 alignitemscenter">
          <div class="flex-container alignItemsBaseline">
            <span class="name_text">\${characterName}</span>
            <i class="mes_ghost fa-solid fa-ghost"></i>
            <small class="timestamp"></small>
          </div>
        </div>
        <div class="mes_buttons"><div class="mes_button mes_edit fa-solid fa-pencil"></div></div>
        <div class="mes_edit_buttons"><div class="mes_edit_done menu_button fa-solid fa-check"></div></div>
      </div>
      <details class="mes_reasoning_details">
        <summary class="mes_reasoning_summary flex-container">
          <div class="mes_reasoning_header_block flex-container">
            <div class="mes_reasoning_header flex-container">
              <span class="mes_reasoning_header_title" data-i18n="Thought for some time">Thought for some time</span>
              <div class="mes_reasoning_arrow fa-solid fa-chevron-up"></div>
            </div>
          </div>
          <div class="mes_reasoning_actions flex-container"><div class="mes_reasoning_copy mes_button fa-solid fa-copy"></div></div>
        </summary>
        <div class="mes_reasoning"></div>
      </details>
      <div class="mes_text"></div>
      <div class="mes_img_container"><img class="mes_img" src="" /></div>
      <div class="mes_bias"></div>
    </div>
    <div class="flex-container swipeRightBlock flexFlowColumn flexNoGap">
      <div class="swipe_right fa-solid fa-chevron-right" style="display: none;"></div>
      <div class="swipes-counter"></div>
    </div>
  </div>
</div>`;

const REAL_FLOORS = `
<div class="mes" mesid="1" ch_name="小明" is_user="true" is_system="false">
  <div class="mesAvatarWrapper"><div class="avatar"><img src="/thumbnail?type=persona&file=me.png"></div></div>
  <div class="mes_block"><span class="name_text">小明</span><div class="mes_text"><p>上一句</p></div></div>
</div>
<div class="mes last_mes" mesid="2" ch_name="旁白" is_user="false" is_system="false">
  <div class="mesAvatarWrapper"><div class="avatar"><img src="/thumbnail?type=avatar&file=narrator.png"></div></div>
  <div class="mes_block"><span class="name_text">旁白</span><div class="mes_text"><p>上一段回复</p></div></div>
</div>`;

function hostContext(overrides: Record<string, unknown> = {}) {
  return {
    chat: [{}, {}, {}],
    name1: '小明',
    name2: '艾琳',
    characters: [{ name: '艾琳', avatar: 'ailin.png' }],
    characterId: '0',
    groupId: null,
    timestampToMoment: vi.fn((time: number) => ({
      isValid: () => true,
      format: (pattern: string) => (pattern === 'LL LT' ? `LLLT@${time}` : `${pattern}@${time}`),
    })),
    messageFormatting: vi.fn((text: string) => `<p data-formatted="1">${text}</p>`),
    getThumbnailUrl: vi.fn((type: string, file: string) => `/thumbnail?type=${type}&file=${file}`),
    translate: vi.fn((text: string) => text),
    ...overrides,
  };
}

const virtualFloors = () => [...document.querySelectorAll<HTMLElement>('#chat [data-acu-virtual-floor]')];
const text = (root: Element, selector: string) => root.querySelector(selector)?.textContent ?? null;
const sendBox = () => document.querySelector<HTMLTextAreaElement>('#send_textarea')!;
const stopButton = () => document.querySelector<HTMLElement>('#mes_stop')!;
const lastRealFloor = () => document.querySelector<HTMLElement>('#chat .mes[mesid="2"]')!;

/** 用户在发送框里打字。 */
function typeInSendBox(value: string): void {
  sendBox().value = value;
  sendBox().dispatchEvent(new Event('input', { bubbles: true }));
}

/** 与宿主 Generate 相同：读出发送框后清空并派发 input。 */
function hostReadsSendBox(): string {
  const value = sendBox().value;
  sendBox().value = '';
  sendBox().dispatchEvent(new Event('input', { bubbles: true }));
  return value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T10:05:00Z'));
  document.head.innerHTML = '';
  document.body.innerHTML = `<div id="chat">${REAL_FLOORS}</div>${ST_MESSAGE_TEMPLATE}`
    + '<textarea id="send_textarea"></textarea><div id="send_but"></div>'
    + '<div id="mes_stop" class="mes_stop" style="display: none;"><div class="fa-solid fa-circle-stop"></div></div>';
  delete document.body.dataset.generating;
  h.api = undefined;
  (window as any).SillyTavern = { getContext: () => hostContext() };
});

afterEach(() => {
  disposePlotPendingDisguise_ACU();
  delete (window as any).SillyTavern;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('beginPlotVirtualPendingFloor_ACU', () => {
  it('克隆酒馆消息模板：序号、名字、时间、头像与正文按酒馆规则填写，不占真实楼号', () => {
    const handle = beginPlotVirtualPendingFloor_ACU('你好\n\n第二段');
    expect(handle).toBeDefined();
    const [user, ai] = virtualFloors();
    expect(document.querySelectorAll('#chat [mesid]')).toHaveLength(2);
    expect(user.hasAttribute('mesid')).toBe(false);
    expect(ai.hasAttribute('mesid')).toBe(false);
    expect(user.querySelector('.mesAvatarWrapper .mesIDDisplay')).not.toBeNull();
    expect(user.querySelector('.mes_buttons')).not.toBeNull();

    const now = Date.now();
    expect(user.getAttribute('is_user')).toBe('true');
    expect(user.getAttribute('ch_name')).toBe('小明');
    expect(text(user, '.name_text')).toBe('小明');
    expect(text(user, '.timestamp')).toBe(`LLLT@${now}`);
    expect(text(user, '.mesIDDisplay')).toBe('#3');
    expect(user.querySelector('.avatar img')?.getAttribute('src')).toBe('/thumbnail?type=persona&file=me.png');
    expect(user.querySelector('.mes_text')?.innerHTML).toBe('<p data-formatted="1">你好\n\n第二段</p>');
    expect(user.classList.contains('reasoning')).toBe(false);

    expect(ai.getAttribute('is_user')).toBe('false');
    expect(ai.getAttribute('is_system')).toBe('false');
    expect(text(ai, '.name_text')).toBe('艾琳');
    expect(text(ai, '.mesIDDisplay')).toBe('#4');
    expect(ai.querySelector('.avatar img')?.getAttribute('src')).toBe('/thumbnail?type=avatar&file=ailin.png');
    expect(ai.querySelector('.mes_text')?.innerHTML).toBe('<p data-formatted="1">...</p>');
  });

  it('AI 楼呈现思考中：reasoning 状态、Thinking...、计时器走秒；接过 last_mes，结束后归还并停表', () => {
    const previous = document.querySelector<HTMLElement>('#chat .mes[mesid="2"]')!;
    const handle = beginPlotVirtualPendingFloor_ACU('你好')!;
    const ai = virtualFloors()[1];
    expect(ai.classList.contains('reasoning')).toBe(true);
    expect(ai.dataset.reasoningState).toBe('thinking');
    const details = ai.querySelector<HTMLDetailsElement>('.mes_reasoning_details')!;
    expect(details.tagName).toBe('DETAILS');
    expect(details.dataset.state).toBe('thinking');
    expect(details.open).toBe(false);
    const title = ai.querySelector<HTMLElement>('.mes_reasoning_header_title')!;
    expect(title.textContent).toBe('Thinking...');
    expect(title.getAttribute('data-i18n')).toBe('Thinking...');

    const timer = ai.querySelector<HTMLElement>('.mes_timer')!;
    expect(timer.textContent).toBe('0.0s');
    expect(timer.title).toMatch(/^Generation queued: HH:mm:ss D MMM YYYY@/);
    vi.advanceTimersByTime(1500);
    expect(timer.textContent).toBe('1.5s');

    expect(ai.classList.contains('last_mes')).toBe(true);
    expect(previous.classList.contains('last_mes')).toBe(false);
    expect(document.querySelector('#chat .mes:last-child')).toBe(ai);

    handle.finish();
    expect(virtualFloors()).toHaveLength(0);
    expect(previous.classList.contains('last_mes')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(timer.textContent).toBe('1.5s');
  });

  it('群聊参照最近一层 AI 楼的名字与头像；已有用户楼时只建 AI 楼，序号取 chat.length', () => {
    (window as any).SillyTavern = { getContext: () => hostContext({ groupId: 'g1', chat: [{}, {}] }) };
    beginPlotVirtualPendingFloor_ACU();
    const floors = virtualFloors();
    expect(floors).toHaveLength(1);
    expect(text(floors[0], '.name_text')).toBe('旁白');
    expect(floors[0].querySelector('.avatar img')?.getAttribute('src')).toBe('/thumbnail?type=avatar&file=narrator.png');
    expect(text(floors[0], '.mesIDDisplay')).toBe('#2');
  });

  it('宿主模板与实时上下文都缺失时用内置同结构模板，正文按段落与换行渲染', () => {
    document.querySelector('#message_template')!.remove();
    delete (window as any).SillyTavern;
    h.api = { chat: [{}], name1: '旅人' };
    beginPlotVirtualPendingFloor_ACU('第一行\n第二行\n\n<b>第二段</b>');
    const [user, ai] = virtualFloors();
    expect(user.querySelector('.mesAvatarWrapper .mesIDDisplay')).not.toBeNull();
    expect(text(user, '.name_text')).toBe('旅人');
    expect(text(user, '.mesIDDisplay')).toBe('#1');
    expect(user.querySelector('.avatar img')?.getAttribute('src')).toBe('/thumbnail?type=persona&file=me.png');
    expect(user.querySelector('.mes_text')?.innerHTML).toBe('<p>第一行<br>第二行</p><p>&lt;b&gt;第二段&lt;/b&gt;</p>');
    expect(text(ai, '.name_text')).toBe('旁白');
    expect(text(ai, '.mesIDDisplay')).toBe('#2');
    expect(text(ai, '.mes_reasoning_header_title')).toBe('Thinking...');
    expect(ai.querySelector('.mes_text')?.innerHTML).toBe('<p>...</p>');
  });

  it('样式只藏可操作控件，序号、计时与 token 数交给酒馆自身设置', () => {
    beginPlotVirtualPendingFloor_ACU('你好');
    const css = document.getElementById('acu-plot-pending-disguise-style')!.textContent!;
    for (const hidden of ['.mes_buttons', '.mes_edit_buttons', '.swipe_right', '.mes_reasoning_actions', '.del_checkbox']) {
      expect(css).toContain(`.acu-plot-pending-mes ${hidden}`);
    }
    for (const shown of ['.mesIDDisplay', '.mes_timer', '.tokenCounterDisplay', '.timestamp', '.name_text']) {
      expect(css).not.toContain(shown);
    }
  });

  it('再次开始时先清掉上一组虚拟楼层', () => {
    beginPlotVirtualPendingFloor_ACU('第一次');
    beginPlotVirtualPendingFloor_ACU('第二次');
    const floors = virtualFloors();
    expect(floors).toHaveLength(2);
    expect(floors[0].querySelector('.mes_text')?.textContent).toBe('第二次');
    expect(document.querySelectorAll('#chat .last_mes')).toHaveLength(1);
  });

  it('建楼中途出错不留节点，last_mes 还给原楼层', () => {
    const append = vi.spyOn(document.getElementById('chat')!, 'appendChild');
    append.mockImplementationOnce(node => Node.prototype.appendChild.call(document.getElementById('chat'), node));
    append.mockImplementationOnce(() => { throw new Error('聊天区拒绝插入'); });
    expect(beginPlotVirtualPendingFloor_ACU('你好')).toBeUndefined();
    expect(virtualFloors()).toHaveLength(0);
    expect(lastRealFloor().classList.contains('last_mes')).toBe(true);
  });

  it('被移出聊天区后自行停表并通知 onLost', () => {
    const onLost = vi.fn();
    beginPlotVirtualPendingFloor_ACU('你好', { onLost });
    document.getElementById('chat')!.replaceChildren();
    vi.advanceTimersByTime(100);
    expect(onLost).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(onLost).toHaveBeenCalledOnce();
  });
});

describe('beginPlotSendDisguise_ACU', () => {
  const begin = (onStop?: () => void) => {
    sendBox().value = '本轮原输入';
    return beginPlotSendDisguise_ACU({ userInput: '本轮原输入', onStop });
  };

  it('只换等待外观：虚拟楼层、生成中状态与空发送框；宿主继续读取时原文回到发送框、外观撤掉', () => {
    const handle = begin()!;
    expect(virtualFloors()).toHaveLength(2);
    expect(sendBox().value).toBe('');
    expect(document.body.dataset.generating).toBe('true');
    expect(stopButton().style.display).toBe('flex');
    handle.release(true);
    expect(virtualFloors()).toHaveLength(0);
    expect(sendBox().value).toBe('本轮原输入');
    expect(document.body.dataset.generating).toBeUndefined();
    expect(stopButton().style.display).toBe('none');
    expect(lastRealFloor().classList.contains('last_mes')).toBe(true);
    handle.release(false);
    expect(sendBox().value).toBe('本轮原输入');
  });

  it('交付最终指令时收起伪装期间写的草稿，宿主读走后放回', () => {
    const handle = begin()!;
    typeInSendBox('下一轮草稿');
    expect(handle.deliver('最终指令')).toBe(true);
    handle.release(true);
    expect(hostReadsSendBox()).toBe('最终指令');
    expect(sendBox().value).toBe('');
    vi.advanceTimersByTime(0);
    expect(sendBox().value).toBe('下一轮草稿');
  });

  it('不交付时宿主读到原文而不是草稿，读走后草稿放回', () => {
    const handle = begin()!;
    typeInSendBox('下一轮草稿');
    handle.release(true);
    expect(hostReadsSendBox()).toBe('本轮原输入');
    vi.advanceTimersByTime(0);
    expect(sendBox().value).toBe('下一轮草稿');
  });

  it('停发时发送框空着就放回原文，已有新内容则保留', () => {
    begin()!.release(false);
    expect(sendBox().value).toBe('本轮原输入');
    const handle = begin()!;
    typeInSendBox('新写的内容');
    handle.release(false);
    expect(sendBox().value).toBe('新写的内容');
    vi.advanceTimersByTime(60_000);
    expect(sendBox().value).toBe('新写的内容');
  });

  it.each([
    ['找不到聊天区', () => { document.getElementById('chat')!.remove(); }],
    ['消息模板克隆失败', () => {
      vi.spyOn(document.querySelector('#message_template .mes')!, 'cloneNode').mockImplementation(() => { throw new Error('模板损坏'); });
    }],
    ['发送框写不进去', () => { vi.spyOn(sendBox(), 'value', 'set').mockImplementation(() => {}); }],
  ])('%s：不建伪装、不留痕迹，原文仍在发送框', (_name, breakHost) => {
    sendBox().value = '本轮原输入';
    breakHost();
    expect(beginPlotSendDisguise_ACU({ userInput: '本轮原输入' })).toBeUndefined();
    expect(document.querySelectorAll('[data-acu-virtual-floor]')).toHaveLength(0);
    expect(document.body.dataset.generating).toBeUndefined();
    expect(stopButton().style.display).toBe('none');
    expect(sendBox().value).toBe('本轮原输入');
    if (document.getElementById('chat')) expect(lastRealFloor().classList.contains('last_mes')).toBe(true);
  });

  it('虚拟楼层中途被移出聊天区：撤掉外观与拦截、原文回到发送框，之后按解除伪装继续', () => {
    const hostKeydown = vi.fn();
    document.addEventListener('keydown', hostKeydown);
    try {
      const handle = begin()!;
      document.getElementById('chat')!.replaceChildren();
      vi.advanceTimersByTime(100);
      expect(sendBox().value).toBe('本轮原输入');
      expect(document.body.dataset.generating).toBeUndefined();
      expect(stopButton().style.display).toBe('none');
      sendBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(hostKeydown).toHaveBeenCalledOnce();
      expect(handle.deliver('最终指令')).toBe(true);
      handle.release(true);
      expect(hostReadsSendBox()).toBe('最终指令');
      vi.advanceTimersByTime(60_000);
      expect(sendBox().value).toBe('');
    } finally {
      document.removeEventListener('keydown', hostKeydown);
    }
  });

  it('拦下发送框 Enter、Ctrl/Alt+Enter 与发送按钮；Shift+Enter 和楼层编辑的 Ctrl+Enter 放行；停止键交给 onStop', () => {
    const hostKeydown = vi.fn();
    const hostClick = vi.fn();
    document.addEventListener('keydown', hostKeydown);
    document.addEventListener('click', hostClick);
    const press = (target: Element, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    try {
      const onStop = vi.fn();
      const handle = begin(onStop)!;
      expect(press(sendBox())).toBe(true);
      expect(press(sendBox(), { ctrlKey: true })).toBe(true);
      expect(press(document.body, { altKey: true })).toBe(true);
      expect(press(document.body, { ctrlKey: true })).toBe(true);
      expect(hostKeydown).not.toHaveBeenCalled();
      press(sendBox(), { shiftKey: true });
      const editor = document.createElement('textarea');
      lastRealFloor().appendChild(editor);
      press(editor, { ctrlKey: true });
      expect(hostKeydown).toHaveBeenCalledTimes(2);

      document.getElementById('send_but')!.click();
      expect(hostClick).not.toHaveBeenCalled();
      stopButton().querySelector<HTMLElement>('.fa-circle-stop')!.click();
      expect(onStop).toHaveBeenCalledOnce();
      expect(hostClick).toHaveBeenCalledOnce();

      handle.release(false);
      press(sendBox());
      document.getElementById('send_but')!.click();
      expect(hostKeydown).toHaveBeenCalledTimes(3);
      expect(hostClick).toHaveBeenCalledTimes(2);
    } finally {
      document.removeEventListener('keydown', hostKeydown);
      document.removeEventListener('click', hostClick);
    }
  });
});
