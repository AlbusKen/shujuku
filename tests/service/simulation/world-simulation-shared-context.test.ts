import { describe, expect, it } from 'vitest';
import {
  buildWorldSimulationSharedContext_ACU,
  captureSummaryOverview_ACU,
  captureSummaryOverviewText_ACU,
  WORLD_SIMULATION_SHARED_BRIDGE_FLOORS_ACU,
  WORLD_SIMULATION_SUMMARY_OVERVIEW_ROWS_ACU,
} from '../../../src/service/simulation/world-simulation-shared-context';

const ledger: any = { anchorMessageIndex: 3, storyClock: { anchorText: '港口', elapsedSinceLastRun: '即时', precision: 'unknown', evidenceIndexes: [], updatedIndex: 3 }, entities: [], events: [], threads: [], revisions: { entities: 0, events: 0, threads: 0 } };
const tableData = {
  sheetA: { name: '纪要表', content: [['轮次', '概要'], ...Array.from({ length: 40 }, (_, index) => [`第 ${index + 1} 轮`, `概要 ${index + 1}`])] },
  sheetB: { name: '角色表', content: [['名称', '位置'], ['密探', '码头']] },
};

describe('world simulation shared frozen context', () => {
  it('captures the chronicle overview window with full-table row numbers and availability facts', () => {
    const overview = captureSummaryOverview_ACU(tableData);
    expect(overview.available).toBe(true);
    expect(overview.tableName).toBe('纪要表');
    expect(overview.coveredRows).toEqual({ start: 11, end: 40 });
    expect(overview.text).toContain('第 40 行');
    expect(overview.text).not.toContain('第 10 行');
  });

  it('reports a missing or empty chronicle table honestly instead of inventing content', () => {
    const missing = captureSummaryOverview_ACU({});
    expect(missing.available).toBe(false);
    expect(missing.coveredRows).toBeNull();
    const empty = captureSummaryOverview_ACU({ sheetA: { name: '纪要表', content: [['轮次', '概要']] } });
    expect(empty.available).toBe(false);
    expect(empty.tableName).toBe('纪要表');
  });

  it('freezes one shared context at the run start and reuses the identical object for gate, director and specialists', () => {
    const shared = buildWorldSimulationSharedContext_ACU({ ledger, tableData });
    expect(shared.ledger).toBe(ledger);
    expect(shared.summaryOverview.coveredRows).toEqual({ start: 11, end: 40 });
    expect(captureSummaryOverviewText_ACU(tableData)).toBe(shared.summaryOverview.text);
    expect(WORLD_SIMULATION_SUMMARY_OVERVIEW_ROWS_ACU).toBe(30);
    expect(WORLD_SIMULATION_SHARED_BRIDGE_FLOORS_ACU).toBe(3);
  });

  it('rejects a shared context without a ledger snapshot (fail-closed)', () => {
    expect(() => buildWorldSimulationSharedContext_ACU({ ledger: undefined as any })).toThrow('WORLD_SIM_SHARED_CONTEXT_INVALID');
  });
});
