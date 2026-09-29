import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginAgentSessionRun_ACU,
  isAgentSessionRunning_ACU,
  logAgentSession_ACU,
  readAgentSessionLog_ACU,
  resetAgentSessionLogForTests_ACU,
  subscribeAgentSessionLog_ACU,
  updateAgentSession_ACU,
} from '../../../../src/service/continuation/agent/agent-session-log';

beforeEach(() => { resetAgentSessionLogForTests_ACU(); });

describe('Agent 会话日志', () => {
  it('新一次运行不清空既有记录，只追加分隔条并置运行标记', () => {
    beginAgentSessionRun_ACU('第 1 阶段 · 第 1/6 轮');
    logAgentSession_ACU({ kind: 'main_action', title: '迭代 1 · 派工 2 项' });
    beginAgentSessionRun_ACU('第 1 阶段 · 第 2/6 轮', '推进');

    // 会话流是滚动累积的：自动续写每轮开新运行，清空会让界面每轮塌缩重来。
    const entries = readAgentSessionLog_ACU();
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ kind: 'run_started', title: '第 1 阶段 · 第 1/6 轮' });
    expect(entries[1]).toMatchObject({ kind: 'main_action', title: '迭代 1 · 派工 2 项' });
    expect(entries[2]).toMatchObject({ kind: 'run_started', title: '第 1 阶段 · 第 2/6 轮', detail: '推进', ok: true });
    expect(isAgentSessionRunning_ACU()).toBe(true);
  });

  it('终态事件（完成/失败/阻断）清除运行标记', () => {
    beginAgentSessionRun_ACU('运行');
    logAgentSession_ACU({ kind: 'run_completed', title: '完成' });
    expect(isAgentSessionRunning_ACU()).toBe(false);

    beginAgentSessionRun_ACU('运行');
    logAgentSession_ACU({ kind: 'run_failed', title: '失败', ok: false });
    expect(isAgentSessionRunning_ACU()).toBe(false);
  });

  it('条目超过上限后丢最旧的，超长 detail 被截断', () => {
    beginAgentSessionRun_ACU('运行');
    for (let index = 0; index < 320; index += 1) {
      logAgentSession_ACU({ kind: 'delegation', title: `条目 ${index}`, agentName: 'mainline-planner' });
    }
    const entries = readAgentSessionLog_ACU();
    expect(entries).toHaveLength(300);
    expect(entries[0].title).toBe('条目 20');

    logAgentSession_ACU({ kind: 'main_action', title: '长内容', detail: '长'.repeat(3000) });
    const last = readAgentSessionLog_ACU().at(-1)!;
    expect(last.detail.length).toBeLessThan(2100);
    expect(last.detail).toContain('已截断');
  });
  it('write_sql 的 detail 上限单独放宽，其它 kind 仍按 2000 截断', () => {
    beginAgentSessionRun_ACU('运行');
    // SQL 原文按 2000 截断会把多语句批次切断，write_sql 单独放宽到 6000。
    logAgentSession_ACU({ kind: 'write_sql', title: '提交 SQL', detail: 'S'.repeat(5000) });
    const sqlEntry = readAgentSessionLog_ACU().at(-1)!;
    expect(sqlEntry.detail).toHaveLength(5000);
    expect(sqlEntry.detail).not.toContain('已截断');
    // 超过放宽后的上限仍然截断，不允许无界增长。
    logAgentSession_ACU({ kind: 'write_sql', title: '提交 SQL', detail: 'S'.repeat(7000) });
    expect(readAgentSessionLog_ACU().at(-1)!.detail).toContain('已截断');
    // 其它 kind 不受影响。
    logAgentSession_ACU({ kind: 'main_action', title: '长内容', detail: '长'.repeat(3000) });
    expect(readAgentSessionLog_ACU().at(-1)!.detail).toContain('已截断');
    // 原地更新按条目自身 kind 判定上限，不会把已写入的 SQL 原文再截短。
    const id = logAgentSession_ACU({ kind: 'write_sql', title: '提交 SQL', detail: 'x' });
    updateAgentSession_ACU(id, { detail: 'S'.repeat(5000) });
    expect(readAgentSessionLog_ACU().find(entry => entry.id === id)!.detail).toHaveLength(5000);
  });



  it('恢复运行时保留既有条目并追加 run_resumed 分隔', () => {
    beginAgentSessionRun_ACU('第 1 阶段 · 第 2/9 轮');
    logAgentSession_ACU({ kind: 'delegation', title: 'mainline-planner 完成', agentName: 'mainline-planner' });
    beginAgentSessionRun_ACU('第 1 阶段 · 第 2/9 轮', '从中断点恢复', true);

    const entries = readAgentSessionLog_ACU();
    expect(entries).toHaveLength(3);
    expect(entries[0].kind).toBe('run_started');
    expect(entries[1].kind).toBe('delegation');
    expect(entries[2]).toMatchObject({ kind: 'run_resumed', detail: '从中断点恢复' });
    expect(isAgentSessionRunning_ACU()).toBe(true);
  });

  it('status 缺省按 ok 推导，running 条目可原地更新为终态', () => {
    beginAgentSessionRun_ACU('运行');
    const runningId = logAgentSession_ACU({ kind: 'delegation', title: 'maintainer 执行中', agentName: 'maintainer', status: 'running' });
    const doneId = logAgentSession_ACU({ kind: 'delegation', title: '完成条目' });
    const failedId = logAgentSession_ACU({ kind: 'delegation', title: '失败条目', ok: false });

    let entries = readAgentSessionLog_ACU();
    expect(entries.find(entry => entry.id === runningId)).toMatchObject({ status: 'running', ok: true });
    expect(entries.find(entry => entry.id === doneId)).toMatchObject({ status: 'done' });
    expect(entries.find(entry => entry.id === failedId)).toMatchObject({ status: 'failed' });

    updateAgentSession_ACU(runningId, { title: 'maintainer 完成', detail: '已结算 2 条', ok: true });
    entries = readAgentSessionLog_ACU();
    expect(entries.find(entry => entry.id === runningId)).toMatchObject({ title: 'maintainer 完成', detail: '已结算 2 条', status: 'done', ok: true });

    // 不存在的 id（如被上限截断淘汰）静默忽略。
    expect(() => updateAgentSession_ACU(99999, { ok: false })).not.toThrow();
  });

  it('订阅者收到变化通知，退订后不再通知，订阅者抛错不影响写入', () => {
    const listener = vi.fn();
    const broken = vi.fn(() => { throw new Error('订阅者坏了'); });
    const unsubscribe = subscribeAgentSessionLog_ACU(listener);
    subscribeAgentSessionLog_ACU(broken);

    logAgentSession_ACU({ kind: 'main_action', title: '事件' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readAgentSessionLog_ACU()).toHaveLength(1);

    unsubscribe();
    logAgentSession_ACU({ kind: 'main_action', title: '事件 2' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readAgentSessionLog_ACU()).toHaveLength(2);
  });
});
