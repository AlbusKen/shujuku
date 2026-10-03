import { jQuery_API_ACU, SillyTavern_API_ACU } from './host-api';

export interface ProtectedSendTextarea_ACU {
    readonly element: HTMLTextAreaElement;
    /** 保护期被其它写入者提交的下一轮草稿，不作为本次发送内容。 */
    getDraft(): string;
    release(value: string): void;
}

/**
 * 最终交接租约：普通 value / jQuery.val 读始终得到本次提示词，异步写入不能覆盖它。
 * 不以空值或一次读取判断宿主已消费；调用方须在真实入楼确认或取消时释放。
 * 仅包装当前原生元素，不修改宿主原型，也不覆盖其它扩展已安装的自有 value 属性。
 */
export function protectSendTextareaValue_ACU(text: string): ProtectedSendTextarea_ACU | null {
    const element = jQuery_API_ACU?.('#send_textarea')?.[0] as HTMLTextAreaElement | undefined;
    const ctor = element?.ownerDocument?.defaultView?.HTMLTextAreaElement;
    if (!element || !ctor || !(element instanceof ctor) || Object.prototype.hasOwnProperty.call(element, 'value')) return null;
    const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, 'value');
    if (!descriptor?.get || !descriptor.set) return null;
    const expected = String(text).replace(/\r\n?/g, '\n');
    const read = () => String(descriptor.get!.call(element));
    const write = (value: string) => descriptor.set!.call(element, value);
    const previousValue = read();
    const previousReadOnly = element.readOnly;
    let draft = '';
    let released = false;
    const captureDraft = (value: string) => {
        if (value && value !== expected) draft = value;
    };
    const onBeforeInput = (event: Event) => event.preventDefault();
    const onInput = () => {
        captureDraft(read());
        write(expected);
    };
    try {
        write(expected);
        Object.defineProperty(element, 'value', {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: () => expected,
            set: (value: unknown) => { captureDraft(String(value ?? '')); },
        });
        element.readOnly = true;
        element.addEventListener('beforeinput', onBeforeInput, true);
        element.addEventListener('input', onInput, true);
        const handle: ProtectedSendTextarea_ACU = {
            element,
            getDraft: () => draft,
            release(value: string): void {
                if (released) return;
                released = true;
                delete (element as any).value;
                element.readOnly = previousReadOnly;
                element.removeEventListener('beforeinput', onBeforeInput, true);
                element.removeEventListener('input', onInput, true);
                write(value);
            },
        };
        if (!setSendTextareaValue_ACU(expected)) {
            handle.release(previousValue);
            return null;
        }
        return handle;
    } catch {
        delete (element as any).value;
        element.readOnly = previousReadOnly;
        element.removeEventListener('beforeinput', onBeforeInput, true);
        element.removeEventListener('input', onInput, true);
        write(previousValue);
        return null;
    }
}

/** 宿主发送框操作，不属于任何 V1 popup。 */
export function getSendTextareaValue_ACU(): string {
    try {
        return String(jQuery_API_ACU?.('#send_textarea').val() || '');
    } catch {
        return '';
    }
}

/** 写回宿主发送框，并在 input 监听执行后回读确认，不能把空选择器或被改写当作成功。 */
export function setSendTextareaValue_ACU(text: string): boolean {
    try {
        const $textarea = jQuery_API_ACU?.('#send_textarea');
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
        const $button = jQuery_API_ACU?.('#send_but');
        if (!$button || typeof $button.click !== 'function') return false;
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
        const $button = jQuery_API_ACU?.('#option_regenerate');
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
