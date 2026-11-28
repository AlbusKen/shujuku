/**
 * service/ai/prompt-builder/index.ts
 * AI prompt-builder 入口 — re-export 所有公共 API
 * 保持与原 prompt-builder.ts 完全相同的公共接口
 */

// AI 输入准备
export { prepareAIInput_ACU } from './prompt-prepare';

// API 调用 + 响应处理
export { callCustomOpenAI_ACU, handleApiResponse_ACU, extractAiUsageMetadata_ACU, RetryableAiResponseError_ACU, type AiUsageMetadata_ACU } from './prompt-api-call';

// 表格编辑解析
export {
  extractTableEditInner_ACU,
  extractTableEditTagContent_ACU,
  isEmptyOrSqlCommentOnlyTableEdit_ACU,
  normalizeTableEditContent_ACU,
  parseAndApplyTableEdits_ACU,
  parseAndApplyTableEditsToData_ACU,
} from './table-edit-parser';

// 严格 JSON 填表响应
export { buildStrictJsonTableFillResponseFormat_ACU, cloneStrictPromptSegments_ACU, convertStrictOpsToTableEdit_ACU, extractStrictJsonTableFillResponse_ACU } from './strict-json-table-fill';
