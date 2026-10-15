import { reactive, ref } from "vue";
import {
  getCurrentVectorMemoryConfig_ACU,
  updateGlobalVectorMemoryConfigFields_ACU,
  validateSummaryVectorIndexConfig_ACU,
} from "../../service/vector/vector-memory-config";
import {
  normalizeRerankBatchSize_ACU,
  VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU,
  VECTOR_RERANK_MAX_BATCH_SIZE_ACU,
  VECTOR_RERANK_MIN_BATCH_SIZE_ACU,
} from "../../data/gateways/vector-rerank-gateway";
import { useToastStore } from "../stores/toast-store";

export interface VectorApiForm {
  embeddingEndpoint: string;
  embeddingModel: string;
  embeddingApiKey: string;
  rerankEndpoint: string;
  rerankModel: string;
  rerankApiKey: string;
  rerankInstruction: string;
  rerankBatchSize: number;
}

export const RERANK_BATCH_SIZE_LIMITS = {
  min: VECTOR_RERANK_MIN_BATCH_SIZE_ACU,
  max: VECTOR_RERANK_MAX_BATCH_SIZE_ACU,
  default: VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU,
} as const;

function createEmptyForm(): VectorApiForm {
  return {
    embeddingEndpoint: "",
    embeddingModel: "",
    embeddingApiKey: "",
    rerankEndpoint: "",
    rerankModel: "",
    rerankApiKey: "",
    rerankInstruction: "",
    rerankBatchSize: VECTOR_RERANK_DEFAULT_BATCH_SIZE_ACU,
  };
}

export function useVectorApiConfig() {
  const toast = useToastStore();
  const form = reactive<VectorApiForm>(createEmptyForm());
  const errors = ref<string[]>([]);
  const savedAt = ref<number | null>(null);

  function refresh(): void {
    const config = getCurrentVectorMemoryConfig_ACU();
    form.embeddingEndpoint = config.embeddingEndpoint || "";
    form.embeddingModel = config.embeddingModel || "";
    form.embeddingApiKey = config.embeddingApiKey || "";
    form.rerankEndpoint = config.rerankEndpoint || "";
    form.rerankModel = config.rerankModel || "";
    form.rerankApiKey = config.rerankApiKey || "";
    form.rerankInstruction = config.rerankInstruction ?? "";
    form.rerankBatchSize = normalizeRerankBatchSize_ACU(config.rerankBatchSize);
    errors.value = [];
  }

  function save(): boolean {
    const config = getCurrentVectorMemoryConfig_ACU();
    const patch: VectorApiForm = {
      embeddingEndpoint: form.embeddingEndpoint.trim(),
      embeddingModel: form.embeddingModel.trim(),
      embeddingApiKey: form.embeddingApiKey,
      rerankEndpoint: form.rerankEndpoint.trim(),
      rerankModel: form.rerankModel.trim(),
      rerankApiKey: form.rerankApiKey,
      rerankInstruction: form.rerankInstruction.trim(),
      rerankBatchSize: normalizeRerankBatchSize_ACU(form.rerankBatchSize),
    };

    // getter 返回权威引用；校验只能读取草稿，不能先把无效输入写入运行配置。
    const validation = validateSummaryVectorIndexConfig_ACU({ ...config, ...patch });
    if (!validation.valid) {
      errors.value = formatVectorApiErrors(validation.errors);
      return false;
    }

    try {
      const result = updateGlobalVectorMemoryConfigFields_ACU(patch);
      if (!result.ok) {
        errors.value = [result.message || "向量服务配置保存失败，请稍后重试。"];
        return false;
      }
    } catch (_) {
      errors.value = ["向量服务配置保存失败，请稍后重试。"];
      return false;
    }

    form.rerankBatchSize = patch.rerankBatchSize;
    errors.value = [];
    savedAt.value = Date.now();
    toast.success("向量服务配置已保存。");
    return true;
  }

  refresh();

  return {
    form,
    errors,
    savedAt,
    refresh,
    save,
  };
}

function formatVectorApiErrors(rawErrors: string[]): string[] {
  return rawErrors.map((error) => {
    if (error.includes("embeddingEndpoint")) {
      return "缺少“向量化URL”";
    }
    if (error.includes("embeddingModel")) {
      return "缺少“向量化模型名”";
    }
    if (error.includes("rerankEndpoint") || error.includes("rerankModel")) {
      return "“重排URL”和“重排模型名”需要同时填写，或者同时留空";
    }
    return error;
  });
}
