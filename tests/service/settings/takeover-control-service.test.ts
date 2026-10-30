import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ meta: {} as Record<string, any>, save: vi.fn(() => true) }));
vi.mock('../../../src/data/repositories/profile-repo', () => ({ globalMeta_ACU: m.meta, saveGlobalMeta_ACU: m.save }));
import { setTakeoverEnabled_ACU } from '../../../src/service/settings/takeover-control-service';
import { isTakeoverEnabled_ACU, setTakeoverRuntimeEnabled_ACU } from '../../../src/shared/takeover-control';
beforeEach(() => {
  for (const key of Object.keys(m.meta)) delete m.meta[key];
  Object.assign(m.meta, { takeoverEnabledGlobal: true, plotEnabledGlobal: true,
    vectorMemoryConfigGlobal: { embeddingModel: 'original', rerankModel: 'original-rerank', keywordGenerationEnabled: true },
    summaryVectorIndexModeGlobal: true });
  m.save.mockReturnValue(true); m.save.mockClear(); setTakeoverRuntimeEnabled_ACU(true);
});
afterEach(() => setTakeoverRuntimeEnabled_ACU(true));
describe('全局暂停标记持久化', () => {
  it('只写独立标记，关闭再开启不会修改API/交火/剧情配置', () => {
    const before = structuredClone(m.meta);
    setTakeoverEnabled_ACU(false);
    expect(isTakeoverEnabled_ACU()).toBe(false);
    expect(m.meta).toEqual({ ...before, takeoverEnabledGlobal: false });
    setTakeoverEnabled_ACU(true);
    expect(m.meta).toEqual(before); expect(isTakeoverEnabled_ACU()).toBe(true);
    expect(m.save).toHaveBeenCalledTimes(2);
  });
  it('保存失败回滚，运行状态不变化', () => {
    m.save.mockReturnValue(false);
    expect(() => setTakeoverEnabled_ACU(false)).toThrow('保存失败');
    expect(m.meta.takeoverEnabledGlobal).toBe(true);
    expect(isTakeoverEnabled_ACU()).toBe(true);
  });
});
