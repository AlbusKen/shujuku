/**
 * Vector API composable — Embedding / Rerank 校验和保存
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveSettingsResult_ACU } from "../../../src/service/settings/settings-service";

async function importComposable(config: any) {
  vi.resetModules();
  const saveSettings = vi.fn((): SaveSettingsResult_ACU => ({ saved: true, storageType: "memory" }));
  // 保留真实 getter、校验器和配置写入口，只替换存储边界。
  vi.doUnmock("../../../src/service/vector/vector-memory-config");
  vi.doMock("../../../src/data/repositories/profile-repo", () => ({
    globalMeta_ACU: { vectorMemoryConfigGlobal: config },
    saveGlobalMeta_ACU: vi.fn(),
  }));
  vi.doMock("../../../src/service/settings/settings-service", () => ({
    saveSettings_ACU: saveSettings,
  }));
  vi.doMock("../../../src/service/runtime/state-manager", () => ({
    settings_ACU: { toastMuteEnabled: false },
    currentChatFileIdentifier_ACU: "vector-config-test",
  }));
  vi.doMock("../../../src/service/settings/settings-readers", () => ({
    getCurrentWorldbookConfig_ACU: () => ({}),
  }));
  const [{ createPinia, setActivePinia }, { useVectorApiConfig }] =
    await Promise.all([
      import("pinia"),
      import("../../../src/presentation-v2/composables/useVectorApiConfig"),
    ]);
  setActivePinia(createPinia());
  const { useToastStore } = await import("../../../src/presentation-v2/stores/toast-store");
  const success = vi.spyOn(useToastStore(), "success").mockImplementation(() => "test-toast");
  return { vector: useVectorApiConfig(), saveSettings, success };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useVectorApiConfig", () => {
  it("Embedding 缺失时阻止保存并返回错误", async () => {
    const config: any = {};
    const { vector, saveSettings } = await importComposable(config);

    expect(vector.save()).toBe(false);

    expect(vector.errors.value).toContain("缺少“向量化URL”");
    expect(vector.errors.value).toContain("缺少“向量化模型名”");
    expect(vector.errors.value.join(" ")).not.toContain("embeddingEndpoint");
    expect(vector.errors.value.join(" ")).not.toContain("embeddingModel");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("Rerank endpoint/model 不成对时阻止保存", async () => {
    const config: any = {
      embeddingEndpoint: "https://embed.test",
      embeddingModel: "embed-model",
      rerankEndpoint: "https://rerank.test",
      rerankModel: "",
    };
    const { vector } = await importComposable(config);

    expect(vector.save()).toBe(false);

    expect(vector.errors.value).toContain(
      "“重排URL”和“重排模型名”需要同时填写，或者同时留空",
    );
    expect(vector.errors.value.join(" ")).not.toContain("rerankEndpoint");
    expect(vector.errors.value.join(" ")).not.toContain("rerankModel");
  });

  it("合法配置写回全局向量配置并保存 settings", async () => {
    const config: any = {
      embeddingEndpoint: "",
      embeddingModel: "",
      embeddingApiKey: "",
      rerankEndpoint: "",
      rerankModel: "",
      rerankApiKey: "",
      rerankInstruction: "默认指令",
    };
    const { vector, saveSettings } = await importComposable(config);
    vector.form.embeddingEndpoint = " https://embed.test ";
    vector.form.embeddingModel = " embed-model ";
    vector.form.rerankEndpoint = "https://rerank.test";
    vector.form.rerankModel = "rerank-model";
    vector.form.rerankInstruction = " 自定义指令 ";

    expect(vector.save()).toBe(true);

    expect(config.embeddingEndpoint).toBe("https://embed.test");
    expect(config.embeddingModel).toBe("embed-model");
    expect(config.rerankModel).toBe("rerank-model");
    expect(config.rerankInstruction).toBe("自定义指令");
    expect(saveSettings).toHaveBeenCalled();
  });

  it("rerankInstruction 清空后保存为空字符串", async () => {
    const config: any = {
      embeddingEndpoint: "https://embed.test",
      embeddingModel: "embed-model",
      rerankEndpoint: "",
      rerankModel: "",
      rerankApiKey: "",
      rerankInstruction: "原始指令",
    };
    const { vector, saveSettings } = await importComposable(config);

    expect(vector.form.rerankInstruction).toBe("原始指令");

    vector.form.rerankInstruction = "";
    expect(vector.save()).toBe(true);

    expect(config.rerankInstruction).toBe("");
    expect(saveSettings).toHaveBeenCalled();
  });

  it("refresh 读取配置中的 rerankInstruction", async () => {
    const config: any = {
      embeddingEndpoint: "https://embed.test",
      embeddingModel: "embed-model",
      rerankEndpoint: "",
      rerankModel: "",
      rerankApiKey: "",
      rerankInstruction: "测试指令内容",
    };
    const { vector } = await importComposable(config);

    expect(vector.form.rerankInstruction).toBe("测试指令内容");
  });

  const validConfig = () => ({
    embeddingEndpoint: "https://embed.test", embeddingModel: "valid-model", embeddingApiKey: "old-key",
    rerankEndpoint: "https://rerank.test", rerankModel: "valid-rerank", rerankApiKey: "old-rerank-key",
    rerankInstruction: "旧指令", rerankBatchSize: 50,
    topK: 7, vectorNamespace: "keep-namespace", keywordGenerationEnabled: false,
    summaryIndexV2WriteScopeAllowlist: ["scope-a"],
  });

  it.each(["embeddingEndpoint", "embeddingModel", "rerankEndpoint", "rerankModel"] as const)(
    "清空 %s 校验失败，不污染任何权威字段", async (field) => {
      const config = validConfig();
      const { vector, saveSettings, success } = await importComposable(config);
      const before = JSON.parse(JSON.stringify(config));
      vector.form[field] = "   ";
      vector.form.embeddingApiKey = "draft-key";
      vector.form.rerankBatchSize = 999;
      expect(vector.save()).toBe(false);
      expect(config).toEqual(before);
      expect(vector.form[field]).toBe("   ");
      expect(vector.form.embeddingApiKey).toBe("draft-key");
      expect(vector.form.rerankBatchSize).toBe(999);
      expect(vector.errors.value.length).toBeGreaterThan(0);
      expect(vector.savedAt.value).toBeNull();
      expect(saveSettings).not.toHaveBeenCalled();
      expect(success).not.toHaveBeenCalled();
    },
  );

  it.each(["settings_loading", "storage_error", "exception"] as const)(
    "%s 恢复权威配置并保留草稿，重试成功才更新时间与提示", async (failure) => {
      const config = validConfig();
      const { vector, saveSettings, success } = await importComposable(config);
      const { globalMeta_ACU } = await import("../../../src/data/repositories/profile-repo");
      const { settings_ACU } = await import("../../../src/service/runtime/state-manager");
      vi.spyOn(Date, "now").mockReturnValue(1000);
      expect(vector.save()).toBe(true);
      const before = JSON.parse(JSON.stringify(config));
      success.mockClear();
      saveSettings.mockClear();
      vi.mocked(Date.now).mockReturnValue(2000);
      vector.form.embeddingModel = " new-model ";
      vector.form.embeddingApiKey = "draft-secret";
      vector.form.rerankModel = "new-rerank";
      vector.form.rerankBatchSize = 999;
      if (failure === "exception") {
        saveSettings.mockImplementationOnce(() => { throw new Error("storage payload draft-secret"); });
      } else {
        saveSettings.mockReturnValueOnce({
          saved: false, storageType: "memory", code: failure,
          ...(failure === "settings_loading" ? { warning: "设置仍在加载中，请稍后重试。" } : { error: "设置持久化失败。" }),
        });
      }
      expect(vector.save()).toBe(false);
      expect(config).toEqual(before);
      expect(globalMeta_ACU.vectorMemoryConfigGlobal).toBe(config);
      expect(settings_ACU.vectorMemoryConfig).toBe(config);
      expect(vector.form.embeddingModel).toBe(" new-model ");
      expect(vector.form.embeddingApiKey).toBe("draft-secret");
      expect(vector.form.rerankBatchSize).toBe(999);
      expect(vector.savedAt.value).toBe(1000);
      expect(success).not.toHaveBeenCalled();
      expect(vector.errors.value.join(" ")).not.toContain("draft-secret");
      expect(vector.errors.value.join(" ")).toContain(failure === "exception" ? "存储异常" : failure === "settings_loading" ? "加载中" : "持久化失败");

      expect(vector.save()).toBe(true);
      expect(saveSettings).toHaveBeenCalledTimes(2);
      expect(config.embeddingModel).toBe("new-model");
      expect(config.embeddingApiKey).toBe("draft-secret");
      expect(config.rerankModel).toBe("new-rerank");
      expect(config.rerankBatchSize).toBe(500);
      expect(config.topK).toBe(before.topK);
      expect(config.vectorNamespace).toBe(before.vectorNamespace);
      expect(config.summaryIndexV2WriteScopeAllowlist).toEqual(before.summaryIndexV2WriteScopeAllowlist);
      expect(config.keywordGenerationEnabled).toBe(false);
      expect(vector.errors.value).toEqual([]);
      expect(vector.savedAt.value).toBe(2000);
      expect(success).toHaveBeenCalledOnce();
    },
  );

  it("首次保存被拒绝不生成保存时间，缺少失败文案时仍显示错误", async () => {
    const config = validConfig();
    const { vector, saveSettings, success } = await importComposable(config);
    const before = JSON.parse(JSON.stringify(config));
    vector.form.embeddingModel = "new-model";
    saveSettings.mockReturnValueOnce({ saved: false, storageType: "memory" });
    expect(vector.save()).toBe(false);
    expect(config).toEqual(before);
    expect(vector.savedAt.value).toBeNull();
    expect(vector.errors.value.join(" ")).toContain("保存失败");
    expect(success).not.toHaveBeenCalled();
  });

});
