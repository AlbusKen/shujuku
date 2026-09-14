import { describe, expect, it, vi } from 'vitest';
import {
  ContinuationWorldbookContext_ACU,
  normalizeAmCode_ACU,
  type ContinuationWorldbookAdapterDependencies_ACU,
} from '../../../src/service/continuation/worldbook-context';

function createDependencies_ACU(overrides: Partial<ContinuationWorldbookAdapterDependencies_ACU> = {}) {
  return {
    resolveRelevantBookNames: vi.fn().mockResolvedValue(['角色书', '附加书']),
    resolveInjectionTarget: vi.fn().mockResolvedValue('纪要书'),
    getIsolationPrefix: vi.fn().mockReturnValue('ACU-[chat-a]-'),
    buildRelevantWorldbookContent: vi.fn().mockResolvedValue('相关世界书背景'),
    readTargetLorebookEntries: vi.fn().mockResolvedValue([]),
    logReadFailure: vi.fn(),
    ...overrides,
  } satisfies ContinuationWorldbookAdapterDependencies_ACU;
}

describe('ContinuationWorldbookContext_ACU', () => {
  it('uses the configured relevant books and excludes generated entries from $1 selection', async () => {
    const dependencies = createDependencies_ACU();
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readRelevantBackground('最近剧情')).resolves.toBe('相关世界书背景');

    expect(dependencies.resolveRelevantBookNames).toHaveBeenCalledTimes(1);
    expect(dependencies.buildRelevantWorldbookContent).toHaveBeenCalledWith(expect.objectContaining({
      bookNames: ['角色书', '附加书'],
      baseScanText: '最近剧情',
    }));
    const options = vi.mocked(dependencies.buildRelevantWorldbookContent).mock.calls[0][0] as any;
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-总结条目1' })).toBe(true);
    expect(options.excludeEntry({ comment: '普通设定' })).toBe(false);
    expect(dependencies.resolveInjectionTarget).not.toHaveBeenCalled();
    expect(dependencies.readTargetLorebookEntries).not.toHaveBeenCalled();
  });

  it('returns empty background when configured book resolution fails', async () => {
    const dependencies = createDependencies_ACU({ resolveRelevantBookNames: vi.fn().mockRejectedValue(new Error('binding unavailable')) });
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readRelevantBackground('剧情')).resolves.toBe('');
    expect(dependencies.buildRelevantWorldbookContent).not.toHaveBeenCalled();
    expect(dependencies.logReadFailure).toHaveBeenCalledWith('background');
  });

  it('returns empty background without touching the pipeline when no book is configured', async () => {
    const dependencies = createDependencies_ACU({ resolveRelevantBookNames: vi.fn().mockResolvedValue([]) });
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readRelevantBackground('剧情')).resolves.toBe('');
    expect(dependencies.buildRelevantWorldbookContent).not.toHaveBeenCalled();
    expect(dependencies.logReadFailure).not.toHaveBeenCalled();
  });

  it('reads the single current-isolation summary index and preserves missing versus failed diagnostics', async () => {
    const dependencies = createDependencies_ACU({
      readTargetLorebookEntries: vi.fn().mockResolvedValue([
        { comment: 'TavernDB-ACU-CustomExport-纪要索引', content: '其他隔离空间' },
        { comment: 'ACU-[chat-a]-TavernDB-ACU-CustomExport-纪要索引', content: '当前索引内容' },
      ]),
    });
    const context = new ContinuationWorldbookContext_ACU(dependencies);
    await expect(context.readStoryOverview()).resolves.toMatchObject({ state: 'ready', content: '当前索引内容', worldbookName: '纪要书' });
    expect(dependencies.readTargetLorebookEntries).toHaveBeenCalledWith('纪要书');

    const failed = new ContinuationWorldbookContext_ACU(createDependencies_ACU({ readTargetLorebookEntries: vi.fn().mockRejectedValue(new Error('host offline')) }));
    await expect(failed.readStoryOverview()).resolves.toMatchObject({ state: 'failed', content: '' });
  });
});

describe('normalizeAmCode_ACU', () => {
  it('normalizes casing and whitespace of valid AM codes', () => {
    expect(normalizeAmCode_ACU(' am0010 ')).toBe('AM0010');
    expect(normalizeAmCode_ACU('AM0002')).toBe('AM0002');
  });

  it('rejects non-AM inputs instead of guessing', () => {
    expect(normalizeAmCode_ACU('not-an-am')).toBeNull();
    expect(normalizeAmCode_ACU('')).toBeNull();
    expect(normalizeAmCode_ACU(null)).toBeNull();
  });
});
