import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginWorldSimulationSessionRun_ACU,
  clearWorldSimulationSessionLog_ACU,
  finishWorldSimulationSessionRun_ACU,
  hasWorldSimulationSessionEntries_ACU,
  hydrateWorldSimulationSessionLog_ACU,
  isWorldSimulationSessionRunning_ACU,
  logWorldSimulationSession_ACU,
  readWorldSimulationSessionLog_ACU,
  resetWorldSimulationSessionLogForTests_ACU,
  subscribeWorldSimulationSessionLog_ACU,
  updateWorldSimulationSession_ACU,
} from '../../../src/service/simulation/world-simulation-agent-session-log';

beforeEach(() => resetWorldSimulationSessionLogForTests_ACU());

describe('world-simulation-agent-session-log', () => {
  it('logs entries with id/status defaults and notifies subscribers', () => {
    const seen: number[] = [];
    const off = subscribeWorldSimulationSessionLog_ACU(() => { seen.push(readWorldSimulationSessionLog_ACU().length); });
    const id = logWorldSimulationSession_ACU({ kind: 'main_action', title: '派工', detail: '推进港口' });
    expect(id).toBe(1);
    const entries = readWorldSimulationSessionLog_ACU();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 1, kind: 'main_action', title: '派工', detail: '推进港口', ok: true, status: 'done' });
    expect(seen).toEqual([1]);
    off();
    logWorldSimulationSession_ACU({ kind: 'user_message', title: 'x' });
    expect(seen).toEqual([1]);
  });

  it('tracks running across begin/finish and forces terminal reset', () => {
    beginWorldSimulationSessionRun_ACU('开始', '运行中');
    expect(isWorldSimulationSessionRunning_ACU()).toBe(true);
    finishWorldSimulationSessionRun_ACU('完成', '结束', true);
    expect(isWorldSimulationSessionRunning_ACU()).toBe(false);
    beginWorldSimulationSessionRun_ACU('开始2');
    logWorldSimulationSession_ACU({ kind: 'run_failed', title: '失败', ok: false });
    expect(isWorldSimulationSessionRunning_ACU()).toBe(false);
  });

  it('hydrates only into an empty log and skips empty input', () => {
    expect(hydrateWorldSimulationSessionLog_ACU([])).toBe(0);
    expect(hasWorldSimulationSessionEntries_ACU()).toBe(false);
    const count = hydrateWorldSimulationSessionLog_ACU([
      { kind: 'user_message', title: '补充', detail: '推进' },
      { kind: 'delegation', title: '派工', agentName: '子代理' },
    ]);
    expect(count).toBe(2);
    expect(hydrateWorldSimulationSessionLog_ACU([{ kind: 'user_message', title: '晚到' }])).toBe(0);
    const entries = readWorldSimulationSessionLog_ACU();
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ kind: 'delegation', agentName: '子代理' });
  });

  it('applies patch updates only to the matching entry and tolerates unknown ids', () => {
    const id = logWorldSimulationSession_ACU({ kind: 'delegation', title: '派工', detail: '进行中', status: 'running' });
    updateWorldSimulationSession_ACU(id, { title: '派工完成', detail: '已提交账本', ok: true, status: 'done' });
    const entry = readWorldSimulationSessionLog_ACU().find(item => item.id === id);
    expect(entry).toMatchObject({ title: '派工完成', detail: '已提交账本', ok: true, status: 'done' });
    const before = readWorldSimulationSessionLog_ACU();
    updateWorldSimulationSession_ACU(999, { title: '不存在' });
    expect(readWorldSimulationSessionLog_ACU()).toEqual(before);
  });

  it('truncates oversized details and enforces the 300-entry cap', () => {
    const id = logWorldSimulationSession_ACU({ kind: 'main_action', title: '长文', detail: 'x'.repeat(2500) });
    const entry = readWorldSimulationSessionLog_ACU().find(item => item.id === id);
    expect(entry!.detail).toBe(`${'x'.repeat(2000)}\n（内容过长，已截断）`);
    for (let i = 0; i < 310; i += 1) logWorldSimulationSession_ACU({ kind: 'user_message', title: `m${i}` });
    expect(readWorldSimulationSessionLog_ACU().length).toBe(300);
    expect(readWorldSimulationSessionLog_ACU()[299].title).toBe('m309');
  });

  it('clearWorldSimulationSessionLog_ACU can keep running state', () => {
    beginWorldSimulationSessionRun_ACU('开始');
    clearWorldSimulationSessionLog_ACU({ keepRunning: true });
    expect(isWorldSimulationSessionRunning_ACU()).toBe(true);
    expect(hasWorldSimulationSessionEntries_ACU()).toBe(false);
    clearWorldSimulationSessionLog_ACU();
    expect(isWorldSimulationSessionRunning_ACU()).toBe(false);
  });
});