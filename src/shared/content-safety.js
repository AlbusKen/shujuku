/** 各 LLM 默认提示词的首条身份声明。 */
export const CONTENT_SAFETY_CLAUSE_ACU = '严禁生成、编写或传播涉及未成年人的色情内容、血腥猎奇内容，以及教唆、指导或协助违法行为的内容；虚构设定或创作目的不构成例外。';

/** 仅用于默认提示词构造，历史默认与用户正文不在运行时改写。 */
export function withContentSafetyIdentity_ACU(content) {
  if (typeof content !== 'string' || content.includes(CONTENT_SAFETY_CLAUSE_ACU)) return content;
  const start = content.indexOf('你是');
  if (start < 0) return content;
  const period = content.indexOf('。', start);
  const lineEnd = content.indexOf('\n', start);
  const hasPeriod = period >= 0 && (lineEnd < 0 || period < lineEnd);
  const end = hasPeriod ? period + 1 : (lineEnd >= 0 ? lineEnd : content.length);
  return `${content.slice(0, end)}${hasPeriod ? '' : '。'}${CONTENT_SAFETY_CLAUSE_ACU}${content.slice(end)}`;
}
