import { describe, expect, it } from 'vitest';
import {
  prepareWorldExecutionWorldbook_ACU,
  readWorldExecutionWorldbook_ACU,
} from '../../../src/service/simulation/world-execution-worldbook';
import type { AgentWorldbookEntryView_ACU, AgentWorldbookSnapshot_ACU } from '../../../src/service/continuation/agent/agent-worldbook-read';

const config = { historyTokenBudget: 10_000, readTokenBudget: 1_000, fallbackTokens: 100 };
const count = async (text: string) => text.length;

function entry(
  uid: string, constant: boolean, keys: string[], content: string, extras: Partial<AgentWorldbookEntryView_ACU> = {},
): AgentWorldbookEntryView_ACU {
  return { bookName: '世界:书', uid, title: `标题 ${uid}`, keys, constant, content, tokens: 0, ...extras };
}

function snapshot(entries: AgentWorldbookEntryView_ACU[], available = true): AgentWorldbookSnapshot_ACU {
  return { available, entries };
}

function granted<T extends { allowed: boolean }>(result: T): Extract<T, { allowed: true }> {
  if (!result.allowed) throw new Error(`expected grant: ${result.reason}`);
  return result as Extract<T, { allowed: true }>;
}

describe('世界推演有限世界书背景', () => {
  it('显式精确引用只扩展已启用快照的候选，不改变常开标志或精读限制', async () => {
    const source = snapshot([
      entry('explicit', false, [], '人物设定'),
      entry('other', false, [], '不得外泄'),
    ]);
    const result = granted(await prepareWorldExecutionWorldbook_ACU(source, '', config, count,
      ['世界:书:explicit', '世界:书:missing', '$WORLDBOOK:别书:other']));
    expect(result.directory.map(item => item.uid)).toEqual(['explicit']);
    expect(source.entries[0].constant).toBe(false);
    expect(granted(await readWorldExecutionWorldbook_ACU(result.receipt, [{ bookName: '世界:书', uid: 'explicit' }], 'explicit', config, count)).materials[0].content).toBe('人物设定');
    expect(await readWorldExecutionWorldbook_ACU(result.receipt, [{ bookName: '世界:书', uid: 'other' }], 'hidden', config, count))
      .toMatchObject({ allowed: false, reason: 'worldbook-ref-not-in-directory' });
  });

  it('歧义冒号地址不授予两个身份，tuple 地址仅授予精确匹配', async () => {
    const source = snapshot([
      { ...entry('c', false, [], 'A'), bookName: 'a:b' },
      { ...entry('b:c', false, [], 'B'), bookName: 'a' },
    ]);
    const ambiguous = granted(await prepareWorldExecutionWorldbook_ACU(source, '', config, count, ['a:b:c']));
    expect(ambiguous.directory).toEqual([]);
    const precise = granted(await prepareWorldExecutionWorldbook_ACU(source, '', config, count, [JSON.stringify(['a:b', 'c'])]));
    expect(precise.directory.map(item => [item.bookName, item.uid])).toEqual([['a:b', 'c']]);
  });

  it('显式引用仍受目录 64 项限额和真实计数预算约束', async () => {
    const many = snapshot(Array.from({ length: 65 }, (_, index) => entry(`ref-${index}`, false, [], 'x')));
    const refs = many.entries.map(item => `${item.bookName}:${item.uid}`);
    const limited = granted(await prepareWorldExecutionWorldbook_ACU(many, '', { ...config, readTokenBudget: 100_000 }, count, refs));
    expect(limited.directory).toHaveLength(64);
    expect(limited.deferred).toHaveLength(1);
    const over = await prepareWorldExecutionWorldbook_ACU(snapshot([entry('long', false, [], 'body', { title: 'T'.repeat(300) })]), '',
      { ...config, readTokenBudget: 160 }, count, ['世界:书:long']);
    expect(over).toMatchObject({ allowed: false, reason: 'read-batch-too-large' });
    expect(over).not.toHaveProperty('receipt');
  });

  it('复用启用快照的常开、关键词和递归 selector，目录不泄漏正文', async () => {
    const source = snapshot([
      entry('always', true, [], '赤塔'),
      entry('child', false, ['赤塔'], '城门公告'),
      entry('deep', false, ['城门公告'], '绝密正文'),
      entry('other', false, ['别处'], '无关正文'),
    ]);
    const result = granted(await prepareWorldExecutionWorldbook_ACU(source, '街道', config, count));
    expect(result.available).toBe(true);
    expect(result.directory.map(item => item.uid)).toEqual(['always', 'child', 'deep']);
    expect(JSON.stringify(result.directory)).not.toContain('绝密正文');
    expect(JSON.stringify(result.directory)).not.toContain('无关正文');
  });

  it('65 个命中保留 64 项目录和一项 deferred；321 项命中 fail closed 且不签发 receipt', async () => {
    const directoryBudget = { ...config, readTokenBudget: 100_000 };
    const sixtyFive = snapshot(Array.from({ length: 65 }, (_, index) => entry(`hit-${index}`, true, [], 'x')));
    const limited = granted(await prepareWorldExecutionWorldbook_ACU(sixtyFive, '', directoryBudget, count));
    expect(limited.directory).toHaveLength(64);
    expect(limited.deferred).toEqual([{ bookName: '世界:书', uid: 'hit-64', reason: 'directory-limit' }]);

    const tooMany = await prepareWorldExecutionWorldbook_ACU(
      snapshot(Array.from({ length: 321 }, (_, index) => entry(`many-${index}`, true, [], 'x'))), '', config, count,
    );
    expect(tooMany).toEqual({ allowed: false, reason: 'worldbook-deferred-identities-too-many' });
    expect(tooMany).not.toHaveProperty('receipt');
  });

  it('真目录文本超过同一预算时 fail closed，既不公开目录也不签发 receipt', async () => {
    const smallBudget = { ...config, readTokenBudget: 160 };
    const result = await prepareWorldExecutionWorldbook_ACU(
      snapshot([entry('directory-overflow', true, ['K'.repeat(200)], 'body', { tokens: 1 })]), '', smallBudget, count,
    );
    expect(result).toMatchObject({ allowed: false, reason: 'read-batch-too-large' });
    expect(result).not.toHaveProperty('directory');
    expect(result).not.toHaveProperty('receipt');
    expect(JSON.stringify(result)).not.toContain('K'.repeat(20));
  });

  it('目录返回值被冻结，篡改副本也不能扩大 receipt 的精读范围', async () => {
    const result = granted(await prepareWorldExecutionWorldbook_ACU(snapshot([
      entry('allowed', true, [], 'SAFE'), entry('hidden', false, ['never'], 'SECRET'),
    ]), '', config, count));
    expect(Object.isFrozen(result.directory)).toBe(true);
    expect(Object.isFrozen(result.directory[0])).toBe(true);
    expect(() => (result.directory as Array<{ uid: string }>).push({ uid: 'hidden' })).toThrow();
    const tamperedDirectory = structuredClone(result.directory) as Array<{ bookName: string; uid: string; title: string; keys: string[]; tokens: number }>;
    tamperedDirectory.push({ bookName: '世界:书', uid: 'hidden', title: '伪造', keys: [], tokens: 0 });
    const denied = await readWorldExecutionWorldbook_ACU(result.receipt,
      [{ bookName: '世界:书', uid: tamperedDirectory[1].uid }], 'tampered-directory', config, count);
    expect(denied).toEqual({ allowed: false, reason: 'worldbook-ref-not-in-directory', tokens: 0 });
    expect(JSON.stringify(denied)).not.toContain('SECRET');
  });
  it('不可用快照明确不是已知空集，且绝不签发精读', async () => {
    const result = granted(await prepareWorldExecutionWorldbook_ACU(snapshot([], false), 'x', config, count));
    expect(result).toMatchObject({ available: false, directory: [], deferred: [] });
    await expect(readWorldExecutionWorldbook_ACU(result.receipt, [], 'no-host', config, count))
      .resolves.toEqual({ allowed: false, reason: 'worldbook-snapshot-unavailable', tokens: 0 });
  });

  it('无命中只给空目录；伪造收据、被篡改目录和超目录引用均不能得到正文', async () => {
    const source = snapshot([entry('one', false, ['needle'], 'SECRET'), entry('two', false, ['other'], 'OTHER')]);
    const result = granted(await prepareWorldExecutionWorldbook_ACU(source, 'none', config, count));
    expect(result.directory).toEqual([]);
    expect(await readWorldExecutionWorldbook_ACU({} as never, [], 'fake', config, count))
      .toEqual({ allowed: false, reason: 'worldbook-receipt-invalid', tokens: 0 });
    expect(await readWorldExecutionWorldbook_ACU(result.receipt, [{ bookName: '世界:书', uid: 'one' }], 'outside', config, count))
      .toEqual({ allowed: false, reason: 'worldbook-ref-not-in-directory', tokens: 0 });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('JSON tuple 身份可正确处理冒号，重复快照 identity 与重复引用均拒绝', async () => {
    const colons = snapshot([entry('uid:one', true, [], 'BODY')]);
    const result = granted(await prepareWorldExecutionWorldbook_ACU(colons, '', config, count));
    const read = granted(await readWorldExecutionWorldbook_ACU(result.receipt, [{ bookName: '世界:书', uid: 'uid:one' }], 'colon', config, count));
    expect(read.materials[0].content).toBe('BODY');

    await expect(prepareWorldExecutionWorldbook_ACU(snapshot([
      entry('same', true, [], 'a'), entry('same', false, ['a'], 'b'),
    ]), '', config, count)).resolves.toMatchObject({ allowed: false, reason: 'worldbook-snapshot-duplicate-identity' });

    const again = granted(await prepareWorldExecutionWorldbook_ACU(colons, '', config, count));
    const duplicate = await readWorldExecutionWorldbook_ACU(again.receipt, [
      { bookName: '世界:书', uid: 'uid:one' }, { bookName: '世界:书', uid: 'uid:one' },
    ], 'duplicate', config, count);
    expect(duplicate).toMatchObject({ allowed: false, reason: 'worldbook-refs-duplicate' });
    expect(JSON.stringify(duplicate)).not.toContain('BODY');
  });

  it('目录与全文都按实际文本计数，metadata token 不可替代预算或绕过配置冻结', async () => {
    const source = snapshot([entry('long', true, [], 'X'.repeat(1_000), { tokens: 1 })]);
    const wide = { ...config, readTokenBudget: 500 };
    const prepared = granted(await prepareWorldExecutionWorldbook_ACU(source, '', wide, count));
    const tooSmall = await readWorldExecutionWorldbook_ACU(prepared.receipt, [{ bookName: '世界:书', uid: 'long' }], 'small', { ...wide, readTokenBudget: 20 }, count);
    expect(tooSmall).toMatchObject({ allowed: false, reason: 'worldbook-read-config-mismatch', tokens: 0 });

    const actualBudget = { ...config, readTokenBudget: 160 };
    const preparedForRead = granted(await prepareWorldExecutionWorldbook_ACU(source, '', actualBudget, count));
    const overBudget = await readWorldExecutionWorldbook_ACU(preparedForRead.receipt,
      [{ bookName: '世界:书', uid: 'long' }], 'real-content-budget', actualBudget, count);
    expect(overBudget).toMatchObject({ allowed: false, reason: 'read-batch-too-large', tokens: 1_000 });
    expect(JSON.stringify(overBudget)).not.toContain('X'.repeat(20));
  });

  it('多个全文条目虽各自低于预算、合计超限时整包拒绝且不泄漏局部正文', async () => {
    const budget = { ...config, readTokenBudget: 160 };
    const prepared = granted(await prepareWorldExecutionWorldbook_ACU(snapshot([
      entry('first', true, [], 'A'.repeat(100)), entry('second', true, [], 'B'.repeat(100)),
    ]), '', budget, count));
    const result = await readWorldExecutionWorldbook_ACU(prepared.receipt, [
      { bookName: '世界:书', uid: 'first' }, { bookName: '世界:书', uid: 'second' },
    ], 'combined-too-large', budget, count);
    expect(result).toEqual({ allowed: false, reason: 'read-batch-too-large', tokens: 200 });
    expect(JSON.stringify(result)).not.toContain('A'.repeat(20));
    expect(JSON.stringify(result)).not.toContain('B'.repeat(20));
  });

  it.each([NaN, Infinity, 0])('目录计数为 %s 时 fail closed 且不泄漏目录或 receipt', async invalid => {
    const result = await prepareWorldExecutionWorldbook_ACU(snapshot([entry('bad-directory', true, [], 'BODY')]), '', config,
      async () => invalid);
    expect(result).toEqual({ allowed: false, reason: 'worldbook-token-count-invalid' });
    expect(result).not.toHaveProperty('directory');
    expect(result).not.toHaveProperty('receipt');
  });

  it.each([NaN, Infinity, 0])('精读计数为 %s 时整包 fail closed 且不返回正文', async invalid => {
    const prepared = granted(await prepareWorldExecutionWorldbook_ACU(snapshot([
      entry('first', true, [], 'ONE'), entry('second', true, [], 'TWO'),
    ]), '', config, count));
    const result = await readWorldExecutionWorldbook_ACU(prepared.receipt, [
      { bookName: '世界:书', uid: 'first' }, { bookName: '世界:书', uid: 'second' },
    ], `bad-count-${String(invalid)}`, config, async () => invalid);
    expect(result).toEqual({ allowed: false, reason: 'worldbook-token-count-invalid', tokens: 0 });
    expect(JSON.stringify(result)).not.toContain('ONE');
    expect(JSON.stringify(result)).not.toContain('TWO');
  });

  it('同一轮相同引用可跨阶段复用冻结全文，不会重新计数或混入不同 refs', async () => {
    let calls = 0;
    const prepared = granted(await prepareWorldExecutionWorldbook_ACU(snapshot([entry('one', true, [], 'FROZEN')]), '', config, async text => { calls += 1; return text.length; }));
    const first = granted(await readWorldExecutionWorldbook_ACU(prepared.receipt, [{ bookName: '世界:书', uid: 'one' }], 'clock', config, async text => { calls += 1; return text.length; }));
    const second = granted(await readWorldExecutionWorldbook_ACU(prepared.receipt, [{ bookName: '世界:书', uid: 'one' }], 'actor:0', config, async () => { throw new Error('不应重新计数'); }));
    expect(second.materials).toEqual(first.materials);
    expect(calls).toBe(2);
  });

  it('同 requestKey 在 await 前领取：并发、重复和改选均拒绝；外部异步修改不会改变冻结全文', async () => {
    const original = entry('one', true, [], 'FROZEN');
    const source = snapshot([original]);
    const prepared = granted(await prepareWorldExecutionWorldbook_ACU(source, '', config, async text => {
      source.entries[0].content = 'MUTATED';
      return text.length;
    }));
    const first = readWorldExecutionWorldbook_ACU(prepared.receipt, [{ bookName: '世界:书', uid: 'one' }], 'once', config, async text => {
      await Promise.resolve();
      return text.length;
    });
    const concurrent = readWorldExecutionWorldbook_ACU(prepared.receipt, [{ bookName: '世界:书', uid: 'one' }], 'once', config, count);
    const [accepted, refused] = await Promise.all([first, concurrent]);
    expect(granted(accepted).materials[0].content).toBe('FROZEN');
    expect(refused).toEqual({ allowed: false, reason: 'worldbook-request-already-claimed', tokens: 0 });
    expect(await readWorldExecutionWorldbook_ACU(prepared.receipt, [], 'once', config, count))
      .toEqual({ allowed: false, reason: 'worldbook-request-already-claimed', tokens: 0 });
  });
});
