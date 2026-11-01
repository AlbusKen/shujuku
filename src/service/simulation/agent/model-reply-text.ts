type ReplyLike_ACU = { content?: unknown; toolCalls?: unknown };

function toolCallText_ACU(args: string): string {
  try {
    const parsed: unknown = JSON.parse(args);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const values = Object.values(parsed as Record<string, unknown>);
      if (values.length === 1 && typeof values[0] === 'string') return values[0];
    }
  } catch {
    // 非 JSON 参数按原文交给后续宽容解析。
  }
  return args;
}

/**
 * 格林推演请求不挂工具，但部分中转会把模型回答放进工具调用参数。
 * 正文含 JSON 时用正文；正文为空或只有说明文字时取第一个非空工具调用参数。
 */
export function worldModelReplyText_ACU(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  const reply = value as ReplyLike_ACU;
  const content = typeof reply.content === 'string' ? reply.content : '';
  const calls = Array.isArray(reply.toolCalls) ? reply.toolCalls : [];
  const toolText = calls
    .map(call => (call && typeof call === 'object' ? (call as { arguments?: unknown }).arguments : undefined))
    .find((args): args is string => typeof args === 'string' && args.trim().length > 0);
  if (content.trim() && (/[{[]/.test(content) || toolText === undefined)) return content;
  if (toolText !== undefined) return toolCallText_ACU(toolText);
  return typeof reply.content === 'string' ? content : null;
}
