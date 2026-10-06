import { jQuery_API_ACU, SillyTavern_API_ACU } from './host-api';
import { getHostWindow } from './runtime-env';

/** jQuery 可能来自脚本 iframe；宿主控件必须在酒馆主文档中查询。 */
function selectHostControl_ACU(selector: string): JQuery<HTMLElement> | undefined {
    const document = getHostWindow().document;
    if (!document) return undefined;
    return jQuery_API_ACU?.(selector, document);
}

/** 仅显示宿主生成中外观；返回恢复函数，不启动生成或派发宿主事件。 */
export function beginHostGenerationUi_ACU(): () => void {
    const stopButton = selectHostControl_ACU('#mes_stop')?.[0];
    const body = stopButton?.ownerDocument.body;
    if (!stopButton || !body) return () => {};

    const previousDisplay = stopButton.style.display;
    const previousGenerating = body.dataset.generating;
    stopButton.style.display = 'flex';
    body.dataset.generating = 'true';

    return () => {
        stopButton.style.display = previousDisplay;
        if (previousGenerating === undefined) delete body.dataset.generating;
        else body.dataset.generating = previousGenerating;
    };
}

/** 宿主发送框操作，不属于任何 V1 popup。 */
export function getSendTextareaValue_ACU(): string {
    try {
        return String(selectHostControl_ACU('#send_textarea')?.val() || '');
    } catch {
        return '';
    }
}

/** 写回宿主发送框，并在 input 监听执行后回读确认，不能把空选择器或被改写当作成功。 */
export function setSendTextareaValue_ACU(text: string): boolean {
    try {
        const $textarea = selectHostControl_ACU('#send_textarea');
        if (!$textarea || typeof $textarea.val !== 'function' || typeof $textarea.trigger !== 'function') return false;
        if (typeof $textarea.length === 'number' && $textarea.length === 0) return false;
        $textarea.val(text);
        notifySendTextareaInput_ACU($textarea);
        // textarea 会把 CRLF 归一化为 LF；这不是提示词内容丢失。
        const expected = String(text).replace(/\r\n?/g, '\n');
        const actual = String($textarea.val() ?? '').replace(/\r\n?/g, '\n');
        return actual === expected;
    } catch {
        return false;
    }
}

/**
 * 宿主的发送框自适应高度与输入暂存用原生 addEventListener('input') 监听；jQuery trigger('input')
 * 只调用 jQuery 处理器，原生监听收不到，清空后发送框会保持原高度。与宿主一致派发原生 input 事件
 * （jQuery 处理器同样会收到），拿不到原生元素时回落到 trigger。
 */
function notifySendTextareaInput_ACU($textarea: JQuery<HTMLElement>): void {
    const el = $textarea[0];
    if (el && typeof el.dispatchEvent === 'function') {
        const EventCtor = el.ownerDocument?.defaultView?.Event ?? Event;
        el.dispatchEvent(new EventCtor('input', { bubbles: true }));
        return;
    }
    $textarea.trigger('input');
}

/** Clicks the host send button and reports availability instead of swallowing it. */
export function clickSendButton_ACU(): boolean {
    try {
        const $button = selectHostControl_ACU('#send_but');
        if (!$button || typeof $button.click !== 'function') return false;
        if (typeof $button.length === 'number' && $button.length === 0) return false;
        $button.click();
        return true;
    } catch {
        return false;
    }
}

/**
 * 触发酒馆「重新生成」。优先点 #option_regenerate（与用户点击同一条链路，会自动删除最近一层 AI 楼），
 * 按钮不可用时回落到宿主 Generate('regenerate')。
 */
export function clickRegenerateButton_ACU(): boolean {
    try {
        const $button = selectHostControl_ACU('#option_regenerate');
        if ($button && typeof $button.length === 'number' && $button.length > 0 && typeof $button.trigger === 'function') {
            $button.trigger('click');
            return true;
        }
    } catch { /* 按钮路径失败时走 Generate 回落 */ }
    return triggerHostGenerate_ACU('regenerate');
}

/**
 * 直接调用宿主 Generate。无新楼层的失败重试用 'normal'：针对已有用户楼生成回复，不会删上一轮 AI 楼。
 */
export function triggerHostGenerate_ACU(type: 'regenerate' | 'normal'): boolean {
    try {
        const fromApi = (SillyTavern_API_ACU as { generate?: unknown } | undefined)?.generate;
        const fromWindow = (globalThis as { Generate?: unknown }).Generate;
        const generate = typeof fromApi === 'function' ? fromApi : typeof fromWindow === 'function' ? fromWindow : null;
        if (!generate) return false;
        void generate.call(typeof fromApi === 'function' ? SillyTavern_API_ACU : globalThis, type);
        return true;
    } catch {
        return false;
    }
}
