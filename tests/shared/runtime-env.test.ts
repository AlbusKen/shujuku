/**
 * tests/shared/runtime-env.test.ts
 * 运行时环境检测 单元测试
 *
 * runtime-env.ts 使用模块级 _cachedMode 缓存检测结果，
 * 因此每个测试用例需要通过 vi.resetModules() + 动态 import 获取干净的模块实例。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/** 动态导入 runtime-env 模块的类型 */
type RuntimeEnvModule = typeof import('../../src/shared/runtime-env');

/** 辅助函数：获取干净的 runtime-env 模块实例 */
async function freshImport(): Promise<RuntimeEnvModule> {
    vi.resetModules();
    return await import('../../src/shared/runtime-env');
}

/** 辅助函数：安全地 mock window.parent 并在 finally 中恢复 */
async function withMockParent(mockParent: any, fn: () => Promise<void>): Promise<void> {
    const orig = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', {
        value: mockParent,
        writable: true,
        configurable: true,
    });
    try {
        await fn();
    } finally {
        if (orig) {
            Object.defineProperty(window, 'parent', orig);
        } else {
            Object.defineProperty(window, 'parent', { value: window, writable: true, configurable: true });
        }
    }
}

// ═══ ACU_INSTANCE_FLAG 常量 ═══
describe('ACU_INSTANCE_FLAG', () => {
    it('是一个非空字符串', async () => {
        const mod = await freshImport();
        expect(typeof mod.ACU_INSTANCE_FLAG).toBe('string');
        expect(mod.ACU_INSTANCE_FLAG.length).toBeGreaterThan(0);
    });

    it('值为 __ACU_STAR_DB_III_LOADED__', async () => {
        const mod = await freshImport();
        expect(mod.ACU_INSTANCE_FLAG).toBe('__ACU_STAR_DB_III_LOADED__');
    });
});

// ═══ detectRuntimeMode ═══
describe('detectRuntimeMode', () => {
    it('默认环境（window.parent === window）返回 extension', async () => {
        const mod = await freshImport();
        expect(mod.detectRuntimeMode()).toBe('extension');
    });

    it('缓存行为：多次调用返回相同结果', async () => {
        const mod = await freshImport();
        const first = mod.detectRuntimeMode();
        const second = mod.detectRuntimeMode();
        expect(first).toBe(second);
    });

    it('window.parent !== window 且 parent.document 可访问时返回 userscript', async () => {
        await withMockParent({ document: {} }, async () => {
            const mod = await freshImport();
            expect(mod.detectRuntimeMode()).toBe('userscript');
        });
    });

    it('window.parent !== window 但 parent.document 抛错（跨域）时返回 userscript', async () => {
        const mockParent = {} as any;
        Object.defineProperty(mockParent, 'document', {
            get() { throw new DOMException('Blocked a frame with origin'); },
            configurable: true,
        });
        await withMockParent(mockParent, async () => {
            const mod = await freshImport();
            expect(mod.detectRuntimeMode()).toBe('userscript');
        });
    });
});

// ═══ _forceExtensionMode ═══
describe('_forceExtensionMode', () => {
    it('调用后 detectRuntimeMode 返回 extension', async () => {
        const mod = await freshImport();
        mod._forceExtensionMode();
        expect(mod.detectRuntimeMode()).toBe('extension');
    });

    it('即使 window.parent !== window，调用后仍返回 extension', async () => {
        await withMockParent({ document: {} }, async () => {
            const mod = await freshImport();
            mod._forceExtensionMode();
            expect(mod.detectRuntimeMode()).toBe('extension');
            expect(mod.isExtensionMode()).toBe(true);
            expect(mod.isUserscriptMode()).toBe(false);
        });
    });
});

// ═══ isUserscriptMode / isExtensionMode ═══
describe('isUserscriptMode / isExtensionMode', () => {
    it('默认环境下 isExtensionMode 为 true，isUserscriptMode 为 false', async () => {
        const mod = await freshImport();
        expect(mod.isExtensionMode()).toBe(true);
        expect(mod.isUserscriptMode()).toBe(false);
    });

    it('两者互斥：不可能同时为 true', async () => {
        const mod = await freshImport();
        expect(mod.isExtensionMode() && mod.isUserscriptMode()).toBe(false);
    });

    it('iframe 环境下 isUserscriptMode 为 true，isExtensionMode 为 false', async () => {
        await withMockParent({ document: {} }, async () => {
            const mod = await freshImport();
            expect(mod.isUserscriptMode()).toBe(true);
            expect(mod.isExtensionMode()).toBe(false);
        });
    });
});

// ═══ getHostWindow ═══
describe('getHostWindow', () => {
    it('插件模式下返回 window 自身', async () => {
        const mod = await freshImport();
        mod._forceExtensionMode();
        expect(mod.getHostWindow()).toBe(window);
    });

    it('油猴模式下返回 window.parent', async () => {
        const mockParent = { document: {} } as any;
        await withMockParent(mockParent, async () => {
            const mod = await freshImport();
            expect(mod.getHostWindow()).toBe(mockParent);
        });
    });
});

// ═══ checkAndMarkInstance ═══
describe('checkAndMarkInstance', () => {
    afterEach(() => {
        delete (window as any).__ACU_STAR_DB_III_LOADED__;
    });

    it('首次调用返回 false（无已有实例）', async () => {
        const mod = await freshImport();
        expect(mod.checkAndMarkInstance()).toBe(false);
    });

    it('首次调用后在 hostWindow 上设置标记', async () => {
        const mod = await freshImport();
        mod.checkAndMarkInstance();
        expect((window as any).__ACU_STAR_DB_III_LOADED__).toBe(true);
    });

    it('第二次调用返回 true（已有实例）', async () => {
        const mod = await freshImport();
        mod.checkAndMarkInstance();
        expect(mod.checkAndMarkInstance()).toBe(true);
    });

    it('标记已存在时返回 true 并输出警告', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        (window as any).__ACU_STAR_DB_III_LOADED__ = true;

        const mod = await freshImport();
        expect(mod.checkAndMarkInstance()).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('检测到另一个实例已在运行')
        );

        warnSpy.mockRestore();
    });

    it('清理标记后可以重新注册', async () => {
        const mod = await freshImport();
        mod.checkAndMarkInstance();
        expect((window as any).__ACU_STAR_DB_III_LOADED__).toBe(true);

        delete (window as any).__ACU_STAR_DB_III_LOADED__;

        const mod2 = await freshImport();
        expect(mod2.checkAndMarkInstance()).toBe(false);
    });
});


describe('内部请求保留宿主传输包装', () => {
    it.each(['before', 'after', 'without'])('第三方包装顺序 %s 不影响调用与内部放行', async order => {
        const reply = {} as Response;
        const network = vi.fn(async function (this: unknown) {
            expect(this).toBe(host);
            return reply;
        });
        const host = { document: {}, location: { href: 'https://tavern.test/', origin: 'https://tavern.test' }, fetch: network } as any;
        const iframeFetch = vi.fn(() => { throw new Error('不应绕开宿主发送链'); });
        const beforeForward = vi.fn();
        const claim = vi.fn(() => { throw new Error('内部请求不应被认领'); });
        let thirdParty: any;
        const wrap = () => {
            const original = host.fetch;
            thirdParty = vi.fn(function (this: unknown, input, init) {
                // 与传输插件一样，复制 init 并改写字符串请求体。
                const body = JSON.parse(init.body);
                body.transportTest = true;
                return original.call(this, input, { ...init, body: JSON.stringify(body) });
            });
            host.fetch = thirdParty;
        };
        vi.stubGlobal('fetch', iframeFetch);
        try {
            await withMockParent(host, async () => {
                await freshImport();
                const { installHostGenerationInterceptor_ACU, INTERNAL_GENERATION_FETCH_ACU } = await import('../../src/data/gateways/host-generation-interceptor');
                const { pristineFetch_ACU } = await import('../../src/data/gateways/pristine-fetch');
                if (order !== 'after') wrap();
                const dispose = order === 'without' ? () => {} : installHostGenerationInterceptor_ACU({ isActive: () => true, beforeForward, claim }, host);
                if (order === 'after') wrap();
                const activeFetch = host.fetch;
                const controller = new AbortController();
                try {
                    expect(await pristineFetch_ACU('/api/backends/chat-completions/generate', {
                        method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: '继续' }] }), signal: controller.signal,
                    })).toBe(reply);
                    expect(thirdParty).toHaveBeenCalledTimes(1);
                    expect(network).toHaveBeenCalledTimes(1);
                    const init = network.mock.calls[0][1] as any;
                    expect(init[INTERNAL_GENERATION_FETCH_ACU]).toBe(true);
                    expect(init.signal).toBe(controller.signal);
                    expect(JSON.parse(init.body).transportTest).toBe(true);
                    expect(beforeForward).not.toHaveBeenCalled();
                    expect(claim).not.toHaveBeenCalled();
                    expect(iframeFetch).not.toHaveBeenCalled();
                    expect(host.fetch).toBe(activeFetch);
                } finally { dispose(); }
            });
        } finally { vi.unstubAllGlobals(); }
    });
});
