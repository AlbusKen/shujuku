import { computed } from 'vue';
import {
  TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU,
  TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU,
} from '../../service/template-assistant/service';

/** 编辑器只消费占位符展示模型；协议词汇仍由服务维护。 */
export function useTemplateAssistantPromptDocs() {
  const placeholderDocs = TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU;
  return {
    placeholderDocs,
    dataDocs: computed(() => placeholderDocs.filter(doc => doc.kind === 'data')),
    referenceDocs: computed(() => placeholderDocs.filter(doc => doc.kind === 'reference')),
    userRequestToken: TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU,
  };
}
