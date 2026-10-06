/**
 * tests/shared/log-buffer.test.ts
 * 日志缓冲区单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  pushLog,
  getAllLogs,
  getLogCount,
  clearLogs,
  getKnownTags,
  subscribe,
  unsubscribe,
  getSubscriberCount,
  extractTag,
  formatArgs,
  _resetForTesting,
  setDebugLogEnabled,
  setWarnLogEnabled,
  isWarnLogEnabled,
  setApiLogEnabled,
  isApiLogEnabled,
  MAX_BUFFER_CHARACTERS_ACU,
} from '../../src/shared/log-buffer';

beforeEach(() => {
  _resetForTesting();
  // 通用测试显式启用可选级别；默认关闭行为由独立用例验证
  setDebugLogEnabled(true);
  setWarnLogEnabled(true);
});

// ═══════════════════════════════════════════════════════════════
// pushLog + getAllLogs
// ═══════════════════════════════════════════════════════════════
describe('pushLog + getAllLogs', () => {
  it('推送一条日志后可以获取', () => {
    pushLog('debug', ['[ACU]', '[SQL] 查询成功']);
    const logs = getAllLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('debug');
    expect(logs[0].tag).toBe('SQL');
    expect(logs[0].message).toContain('[SQL] 查询成功');
  });

  it('推送多条日志按顺序排列', () => {
    pushLog('debug', ['[ACU]', '第一条']);
    pushLog('warn', ['[ACU]', '第二条']);
    pushLog('error', ['[ACU]', '第三条']);
    const logs = getAllLogs();
    expect(logs).toHaveLength(3);
    expect(logs[0].level).toBe('debug');
    expect(logs[1].level).toBe('warn');
    expect(logs[2].level).toBe('error');
  });

  it('ID 自增', () => {
    pushLog('debug', ['[ACU]', 'a']);
    pushLog('debug', ['[ACU]', 'b']);
    const logs = getAllLogs();
    expect(logs[1].id).toBe(logs[0].id + 1);
  });

  it('getAllLogs 返回副本（不影响内部缓冲区）', () => {
    pushLog('debug', ['[ACU]', 'test']);
    const logs = getAllLogs();
    logs.length = 0; // 清空副本
    expect(getLogCount()).toBe(1); // 内部缓冲区不受影响
  });
});

describe('Warn 日志开关', () => {
  it('默认关闭时不写入缓冲区且不通知订阅者', () => {
    _resetForTesting();
    const received: any[] = [];
    subscribe((entry) => received.push(entry));

    setDebugLogEnabled(true);
    pushLog('warn', ['[ACU]', '[SQL] 应被隐藏']);
    pushLog('api', ['[ACU]', '[API直连] 应被隐藏']);

    expect(isWarnLogEnabled()).toBe(false);
    expect(isApiLogEnabled()).toBe(false);
    expect(getAllLogs()).toEqual([]);
    expect(getKnownTags()).toEqual([]);
    expect(received).toEqual([]);
  });

  it('显式开启后恢复写入与订阅通知', () => {
    const received: any[] = [];
    subscribe((entry) => received.push(entry));

    pushLog('warn', ['[ACU]', '[SQL] 已显示']);

    expect(isWarnLogEnabled()).toBe(true);
    expect(getAllLogs()).toHaveLength(1);
    expect(received).toHaveLength(1);
    setDebugLogEnabled(false);
    setWarnLogEnabled(false);
    setApiLogEnabled(true);
    pushLog('api', ['[ACU]', '[API直连] 独立采集']);
    pushLog('debug', ['[ACU]', '[调试] 不采集']);
    expect(isApiLogEnabled()).toBe(true);
    expect(getAllLogs()).toHaveLength(2);
    expect(getAllLogs()[1].level).toBe('api');
    expect(received).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 环形缓冲区上限
// ═══════════════════════════════════════════════════════════════
describe('环形缓冲区', () => {
  it('超过 2000 条时丢弃最旧的', () => {
    for (let i = 0; i < 2100; i++) {
      pushLog('debug', ['[ACU]', `日志 ${i}`]);
    }
    expect(getLogCount()).toBe(2000);
    const logs = getAllLogs();
    // 最旧的应该是第 100 条（0-99 被丢弃）
    expect(logs[0].message).toContain('日志 100');
    expect(logs[logs.length - 1].message).toContain('日志 2099');
  });
});

describe('完整正文容量', () => {
  it('按字符预算淘汰旧条目，不截断最新条目，并保留订阅通知', () => {
    const received = vi.fn();
    subscribe(received);
    const body = '正文'.repeat(MAX_BUFFER_CHARACTERS_ACU / 4 + 1);
    pushLog('debug', [body]);
    pushLog('debug', [body]);
    expect(getAllLogs()).toHaveLength(1);
    expect(getAllLogs()[0].message).toBe(body);
    expect(received).toHaveBeenCalledTimes(2);
    const oversized = '长'.repeat(MAX_BUFFER_CHARACTERS_ACU + 1);
    pushLog('debug', [oversized]);
    expect(getAllLogs()).toHaveLength(1);
    expect(getAllLogs()[0].message).toBe(oversized);
  });

  it('清空及测试重置均重置字符计数', () => {
    pushLog('debug', ['长'.repeat(MAX_BUFFER_CHARACTERS_ACU + 1)]);
    clearLogs();
    pushLog('debug', ['a']); pushLog('debug', ['b']);
    expect(getLogCount()).toBe(2);
    _resetForTesting(); setDebugLogEnabled(true);
    pushLog('debug', ['c']); pushLog('debug', ['d']);
    expect(getLogCount()).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// clearLogs
// ═══════════════════════════════════════════════════════════════
describe('clearLogs', () => {
  it('清空所有日志', () => {
    pushLog('debug', ['[ACU]', 'test']);
    pushLog('error', ['[ACU]', 'test2']);
    clearLogs();
    expect(getLogCount()).toBe(0);
    expect(getAllLogs()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// extractTag
// ═══════════════════════════════════════════════════════════════
describe('extractTag', () => {
  it('从第二个参数提取 [模块名]', () => {
    expect(extractTag(['[ACU]', '[SQL] 查询成功'])).toBe('SQL');
  });

  it('提取中文模块名', () => {
    expect(extractTag(['[ACU]', '[条件模板] 解析完成'])).toBe('条件模板');
  });

  it('提取 ORM 标签', () => {
    expect(extractTag(['[ACU]', '[ORM] 查询执行失败: xxx'])).toBe('ORM');
  });

  it('无标签时返回"未分类"', () => {
    expect(extractTag(['[ACU]', '普通消息没有标签'])).toBe('未分类');
  });

  it('空参数返回"未分类"', () => {
    expect(extractTag([])).toBe('未分类');
  });

  it('第一个参数不是 [ACU] 时也能提取', () => {
    expect(extractTag(['[SQL] 直接标签'])).toBe('SQL');
  });

  it('多个参数时从第二个开始查找标签', () => {
    // extractTag 遍历 args[1] 开始的所有参数，找到第一个含 [xxx] 的
    expect(extractTag(['[ACU]', '无标签', '[SQL] 第三个参数'])).toBe('SQL');
  });
});

// ═══════════════════════════════════════════════════════════════
// formatArgs
// ═══════════════════════════════════════════════════════════════
describe('formatArgs', () => {
  it('字符串参数直接拼接', () => {
    expect(formatArgs(['hello', 'world'])).toBe('hello world');
  });

  it('数字参数转为字符串', () => {
    expect(formatArgs(['count:', 42])).toBe('count: 42');
  });

  it('null 和 undefined', () => {
    expect(formatArgs([null, undefined])).toBe('null undefined');
  });

  it('对象序列化为 JSON', () => {
    expect(formatArgs([{ a: 1 }])).toBe('{"a":1}');
  });

  it('Error 对象显示 name 和 message', () => {
    const err = new Error('test error');
    err.stack = ''; // 清空堆栈以便严格测试 header
    expect(formatArgs([err])).toBe('Error: test error');
  });

  it('布尔值转为字符串', () => {
    expect(formatArgs([true, false])).toBe('true false');
  });
});

// ═══════════════════════════════════════════════════════════════
// getKnownTags
// ═══════════════════════════════════════════════════════════════
describe('getKnownTags', () => {
  it('收集所有出现过的标签', () => {
    pushLog('debug', ['[ACU]', '[SQL] a']);
    pushLog('debug', ['[ACU]', '[ORM] b']);
    pushLog('debug', ['[ACU]', '[SQL] c']); // 重复标签
    pushLog('debug', ['[ACU]', '无标签']);
    const tags = getKnownTags();
    expect(tags).toContain('SQL');
    expect(tags).toContain('ORM');
    expect(tags).toContain('未分类');
    expect(tags).toHaveLength(3);
  });

  it('标签按字母排序', () => {
    pushLog('debug', ['[ACU]', '[C模块] x']);
    pushLog('debug', ['[ACU]', '[A模块] x']);
    pushLog('debug', ['[ACU]', '[B模块] x']);
    const tags = getKnownTags();
    expect(tags[0]).toBe('A模块');
    expect(tags[1]).toBe('B模块');
    expect(tags[2]).toBe('C模块');
  });
});

// ═══════════════════════════════════════════════════════════════
// subscribe / unsubscribe
// ═══════════════════════════════════════════════════════════════
describe('subscribe / unsubscribe', () => {
  it('订阅后收到新日志', () => {
    const received: any[] = [];
    subscribe((entry) => received.push(entry));
    pushLog('debug', ['[ACU]', 'test']);
    expect(received).toHaveLength(1);
    expect(received[0].message).toContain('test');
  });

  it('取消订阅后不再收到日志', () => {
    const received: any[] = [];
    const unsub = subscribe((entry) => received.push(entry));
    pushLog('debug', ['[ACU]', 'before']);
    unsub();
    pushLog('debug', ['[ACU]', 'after']);
    expect(received).toHaveLength(1);
  });

  it('unsubscribe 函数也能取消', () => {
    const received: any[] = [];
    const callback = (entry: any) => received.push(entry);
    subscribe(callback);
    pushLog('debug', ['[ACU]', 'before']);
    unsubscribe(callback);
    pushLog('debug', ['[ACU]', 'after']);
    expect(received).toHaveLength(1);
  });

  it('多个订阅者都能收到', () => {
    const r1: any[] = [];
    const r2: any[] = [];
    subscribe((entry) => r1.push(entry));
    subscribe((entry) => r2.push(entry));
    pushLog('debug', ['[ACU]', 'test']);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it('订阅者回调出错不影响其他订阅者', () => {
    const received: any[] = [];
    subscribe(() => { throw new Error('boom'); });
    subscribe((entry) => received.push(entry));
    pushLog('debug', ['[ACU]', 'test']);
    expect(received).toHaveLength(1);
  });

  it('同一个回调重复订阅只注册一次', () => {
    const received: any[] = [];
    const callback = (entry: any) => received.push(entry);
    subscribe(callback);
    subscribe(callback);
    expect(getSubscriberCount()).toBe(1);
    pushLog('debug', ['[ACU]', 'test']);
    expect(received).toHaveLength(1);
  });

  it('getSubscriberCount 正确计数', () => {
    expect(getSubscriberCount()).toBe(0);
    const unsub1 = subscribe(() => {});
    expect(getSubscriberCount()).toBe(1);
    const unsub2 = subscribe(() => {});
    expect(getSubscriberCount()).toBe(2);
    unsub1();
    expect(getSubscriberCount()).toBe(1);
    unsub2();
    expect(getSubscriberCount()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// _resetForTesting
// ═══════════════════════════════════════════════════════════════
describe('_resetForTesting', () => {
  it('重置所有状态', () => {
    pushLog('debug', ['[ACU]', '[SQL] test']);
    setWarnLogEnabled(true);
    setApiLogEnabled(true);
    subscribe(() => {});
    _resetForTesting();
    expect(getLogCount()).toBe(0);
    expect(getKnownTags()).toEqual([]);
    expect(getSubscriberCount()).toBe(0);
    expect(isWarnLogEnabled()).toBe(false);
    expect(isApiLogEnabled()).toBe(false);
  });
});
