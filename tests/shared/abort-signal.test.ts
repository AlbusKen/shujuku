import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  abortWithReason_ACU,
  getAbortReason_ACU,
  runWithAbortSignal_ACU,
  throwIfAborted_ACU,
} from '../../src/shared/abort-signal';
import {
  anyAbortSignal_ACU,
  captureTakeoverLease_ACU,
  runTakeoverRequest_ACU,
  setTakeoverRuntimeEnabled_ACU,
} from '../../src/shared/takeover-control';
import { withApiRequestTimeout_ACU } from '../../src/service/ai/api-request-timeout';
import { fetchAvailableModels_ACU } from '../../src/service/ai/ai-service';

function withLegacyAbortWebView<T>(run: () => T): T {
  const signalProto = AbortSignal.prototype as unknown as Record<string, unknown>;
  const controllerProto = AbortController.prototype;
  const originalThrowIfAborted = Object.getOwnPropertyDescriptor(signalProto, 'throwIfAborted');
  const originalReason = Object.getOwnPropertyDescriptor(signalProto, 'reason');
  const originalAbort = controllerProto.abort;
  const originalAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any');

  Object.defineProperty(signalProto, 'throwIfAborted', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(signalProto, 'reason', {
    get: () => undefined,
    configurable: true,
  });
  Object.defineProperty(AbortSignal, 'any', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  controllerProto.abort = function legacyAbort() {
    // 模拟 Chrome < 98 / Safari < 15.4：忽略 abort(reason) 参数
    return originalAbort.call(this);
  };

  const restore = () => {
    controllerProto.abort = originalAbort;
    if (originalThrowIfAborted) Object.defineProperty(signalProto, 'throwIfAborted', originalThrowIfAborted);
    else delete signalProto.throwIfAborted;
    if (originalReason) Object.defineProperty(signalProto, 'reason', originalReason);
    else delete signalProto.reason;
    if (originalAny) Object.defineProperty(AbortSignal, 'any', originalAny);
    else delete (AbortSignal as unknown as Record<string, unknown>).any;
  };

  try {
    const result = run();
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(result).finally(restore) as unknown as T;
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx|js|mjs|vue)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

beforeEach(() => {
  setTakeoverRuntimeEnabled_ACU(true);
});

afterEach(() => {
  setTakeoverRuntimeEnabled_ACU(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('abort-signal 旧版 WebView 兼容封装', () => {
  it('未中止或空信号不抛错', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted_ACU(undefined)).not.toThrow();
    expect(() => throwIfAborted_ACU(null)).not.toThrow();
    expect(() => throwIfAborted_ACU(controller.signal)).not.toThrow();
  });

  it('旧 WebView（无 throwIfAborted / 无 signal.reason / abort 忽略参数）下保留自定义中止原因', () =>
    withLegacyAbortWebView(() => {
      const controller = new AbortController();
      expect((controller.signal as unknown as Record<string, unknown>).throwIfAborted).toBeUndefined();
      expect(() => throwIfAborted_ACU(controller.signal)).not.toThrow();

      const customError = new Error('自定义超时原因');
      customError.name = 'TimeoutError';
      abortWithReason_ACU(controller, customError);

      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBeUndefined();
      expect(getAbortReason_ACU(controller.signal)).toBe(customError);
      expect(() => throwIfAborted_ACU(controller.signal)).toThrow(customError);
    }));

  it('旧 WebView 上原生无参 abort() 不抛出 undefined，而是回退为标准 AbortError', () =>
    withLegacyAbortWebView(() => {
      const controller = new AbortController();
      controller.abort();

      const reason = getAbortReason_ACU(controller.signal);
      expect(reason).toBeInstanceOf(Error);
      expect((reason as Error).name).toBe('AbortError');
      expect(() => throwIfAborted_ACU(controller.signal)).toThrow(
        expect.objectContaining({ name: 'AbortError' }),
      );
    }));

  it('旧 WebView 下接管租约、信号合并与 runWithAbortSignal 均可正常执行与中止', async () =>
    withLegacyAbortWebView(async () => {
      const lease = captureTakeoverLease_ACU();
      expect(() => lease.assertActive()).not.toThrow();

      const parent = new AbortController();
      const merged = anyAbortSignal_ACU([lease.signal, parent.signal]);
      expect(() => throwIfAborted_ACU(merged)).not.toThrow();

      const parentReason = new DOMException('父任务取消', 'AbortError');
      abortWithReason_ACU(parent, parentReason);
      expect(merged.aborted).toBe(true);
      expect(getAbortReason_ACU(merged)).toBe(parentReason);
      expect(() => throwIfAborted_ACU(merged)).toThrow(parentReason);

      await expect(runTakeoverRequest_ACU(async () => 'ok')).resolves.toBe('ok');

      const pending = runWithAbortSignal_ACU(lease.signal, () => new Promise<string>(() => {}));
      setTakeoverRuntimeEnabled_ACU(false);
      await expect(pending).rejects.toMatchObject({
        name: 'AbortError',
        message: expect.stringContaining('数据库接管已暂停'),
      });
    }));

  it('旧 WebView 下 withApiRequestTimeout_ACU 超时仍抛出 TimeoutError 而非 undefined', async () =>
    withLegacyAbortWebView(async () => {
      vi.useFakeTimers();
      const pending = withApiRequestTimeout_ACU({ requestTimeoutSeconds: 5 }, undefined, () => new Promise<string>(() => {}));
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'TimeoutError',
        message: expect.stringContaining('API 请求超时'),
      });
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    }));

  it('旧 WebView 下 fetchAvailableModels_ACU（加载模型）不再触发 throwIfAborted is not a function', async () =>
    withLegacyAbortWebView(async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }),
        })),
      );

      const result = await fetchAvailableModels_ACU('https://api.deepseek.com', 'sk-test', {
        sendViaTavern: true,
        customApiFormat: 'openai_compat',
      });

      expect(result).toEqual({
        success: true,
        models: ['deepseek-chat', 'deepseek-reasoner'],
      });
    }));

  it('源码守卫：禁止在 src/shared/abort-signal.ts 之外直接调用 .throwIfAborted(', () => {
    const srcRoot = resolve(process.cwd(), 'src');
    const offenders: string[] = [];
    for (const filePath of collectSourceFiles(srcRoot)) {
      const rel = relative(srcRoot, filePath).replace(/\\/g, '/');
      if (rel === 'shared/abort-signal.ts') continue;
      const content = readFileSync(filePath, 'utf8');
      if (/\.throwIfAborted\s*\(/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
