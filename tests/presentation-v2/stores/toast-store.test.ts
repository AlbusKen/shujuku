/**
 * toast-store - v2 scoped toast queue forwarded to notice-hub.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createSettings() {
  return { silentModeEnabled: false } as any;
}

async function freshStore(settings = createSettings()) {
  vi.resetModules();
  vi.doMock("../../../src/service/runtime/state-manager", () => ({
    settings_ACU: settings,
  }));
  const [{ createPinia, setActivePinia }, { useToastStore }] =
    await Promise.all([
      import("pinia"),
      import("../../../src/presentation-v2/stores/toast-store"),
    ]);
  setActivePinia(createPinia());
  return { store: useToastStore(), settings };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("toast-store", () => {
  it("adds toast items and dismisses them automatically", async () => {
    const { store } = await freshStore();

    const id = store.success("已保存", { durationMs: 1000 });

    expect(id).toBeTruthy();
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({
      kind: "success",
      text: "已保存",
      durationMs: 1000,
      dismissible: true,
    });

    vi.advanceTimersByTime(999);
    expect(store.items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.items).toHaveLength(0);
  });

  it("keeps durationMs zero toasts until manual dismissal", async () => {
    const { store } = await freshStore();

    store.info("不会自动消失", { durationMs: 0 });
    vi.advanceTimersByTime(10000);

    expect(store.items.map((item) => item.text)).toEqual(["不会自动消失"]);
  });

  it("keeps only the newest max stack items", async () => {
    const { store } = await freshStore();

    for (let i = 1; i <= 5; i++) {
      store.info(`消息 ${i}`, { durationMs: 0 });
    }

    expect(store.items.map((item) => item.text)).toEqual([
      "消息 2",
      "消息 3",
      "消息 4",
      "消息 5",
    ]);
  });

  it("supports manual dismiss and clear", async () => {
    const { store } = await freshStore();

    const first = store.info("第一条", { durationMs: 5000 })!;
    store.error("第二条", { durationMs: 0 });

    store.dismiss(first);
    expect(store.items.map((item) => item.text)).toEqual(["第二条"]);

    vi.advanceTimersByTime(5000);
    expect(store.items.map((item) => item.text)).toEqual(["第二条"]);

    store.clear();
    expect(store.items).toHaveLength(0);
  });

  it("updates an existing toast without adding a new item", async () => {
    const { store } = await freshStore();

    const id = store.info("处理中", { durationMs: 0 });
    const updated = store.update(id!, "success", "已完成", { durationMs: 1000 });

    expect(updated).toBe(true);
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({
      id,
      kind: "success",
      text: "已完成",
      durationMs: 1000,
    });

    vi.advanceTimersByTime(1000);
    expect(store.items).toHaveLength(0);
  });

  it("ignores blank text", async () => {
    const { store } = await freshStore();

    expect(store.success("   ")).toBeNull();
    expect(store.items).toHaveLength(0);
  });

  it("静默模式丢弃一次性通知，常驻进度仍登记为任务", async () => {
    const { store } = await freshStore();
    const hub = await import("../../../src/shared/notice-hub");
    hub.configureNoticeHub_ACU({ isSilent: () => true });

    expect(store.success("已保存")).toBeNull();
    expect(store.error("操作失败")).toBeNull();
    expect(
      store.warning("需要处理", {
        muteable: false,
        action: { label: "查看", onClick: vi.fn() },
      }),
    ).toBeNull();
    const progressId = store.info("正在处理", { durationMs: 0, feature: "外部导入" });
    expect(progressId).toBeTruthy();

    expect(store.items.map((item) => item.text)).toEqual(["正在处理"]);
    expect(hub.getNoticeHubSnapshot_ACU().notices).toHaveLength(0);
    expect(hub.getNoticeHubSnapshot_ACU().tasks).toEqual([
      expect.objectContaining({ feature: "外部导入", detail: "正在处理", busy: true }),
    ]);
  });
});
