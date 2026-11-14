/**
 * 按 WHATWG Server-Sent Events 规则拆分事件流。
 * 只负责行与事件边界：CR/LF/CRLF 行结束、`data:` 冒号后可选单个空格、多 data 行以 \n 拼接、空行派发、注释行忽略。
 * 事件内容的 JSON 解析与业务累积由调用方负责。
 */

export interface SseEvent_ACU {
    event: string;
    data: string;
    dataLines: string[];
}

export interface SseEventParser_ACU {
    push(text: string): void;
    end(): void;
}

export function createSseEventParser_ACU(onEvent: (event: SseEvent_ACU) => void): SseEventParser_ACU {
    let buffer = '';
    let dataLines: string[] = [];
    let eventName = '';

    const dispatch = (): void => {
        const lines = dataLines;
        const name = eventName;
        dataLines = [];
        eventName = '';
        if (lines.length) onEvent({ event: name || 'message', data: lines.join('\n'), dataLines: lines });
    };

    const processLine = (line: string): void => {
        if (line === '') {
            dispatch();
            return;
        }
        if (line.startsWith(':')) return;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') dataLines.push(value);
        else if (field === 'event') eventName = value;
    };

    const drain = (final: boolean): void => {
        let start = 0;
        for (let i = 0; i < buffer.length; i++) {
            const char = buffer[i];
            if (char !== '\n' && char !== '\r') continue;
            // 末尾 CR 可能与下一块的 LF 组成 CRLF，非终态时等待后续数据。
            if (char === '\r' && i === buffer.length - 1 && !final) break;
            processLine(buffer.slice(start, i));
            if (char === '\r' && buffer[i + 1] === '\n') i++;
            start = i + 1;
        }
        buffer = buffer.slice(start);
    };

    return {
        push(text: string): void {
            if (!text) return;
            buffer += text;
            drain(false);
        },
        end(): void {
            drain(true);
            if (buffer) {
                processLine(buffer);
                buffer = '';
            }
            dispatch();
        },
    };
}
