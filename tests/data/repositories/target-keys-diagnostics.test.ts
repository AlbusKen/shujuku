/**
 * tests/data/repositories/target-keys-diagnostics.test.ts
 * targetKeys 残留只读诊断单元测试
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
}));

import { scanTargetKeysResidue_ACU } from '../../../src/data/repositories/target-keys-diagnostics';

describe('scanTargetKeysResidue_ACU', () => {
  it('空输入或无目标表时返回零报告且不抛错', () => {
    expect(scanTargetKeysResidue_ACU(null, '', ['sheet_x'])).toEqual(expect.objectContaining({
      isolationKeyMatched: false,
      entryCount: 0,
      exactHits: 0,
      runtimeV1Hits: 0,
      checkpointDataRisk: false,
      checkpointDataRisks: [],
      scheduleSummaryRisk: false,
    }));
    expect(scanTargetKeysResidue_ACU({}, '', [])).toEqual(expect.objectContaining({ exactHits: 0, runtimeV1Hits: 0, checkpointDataRisks: [] }));
    expect(scanTargetKeysResidue_ACU({ TavernDB_ACU_IsolatedData: {} }, 'missing', ['sheet_x'])).toEqual(expect.objectContaining({
      isolationKeyMatched: false,
      entryCount: 0,
      checkpointDataRisks: [],
    }));
  });

  it('结构化扫描 exact、runtime-v1、checkpoint 与 scheduleSummary 风险且不修改 msg', () => {
    const msg: any = {
      TavernDB_ACU_IsolatedData: {
        tag1: {
          storageFrame: {
            checkpoint: {
              reason: 'manual',
              createdAt: 123456,
              data: { sheet_x: { name: '旧目标表' }, sheet_keep: { name: '保留表' } },
              scheduleSummary: { sheet_x: { lastFilledAiFloor: 1 } },
              event: {
                filledSheetKeys: ['sheet_x', 'sheet_keep'],
                changedSheetKeys: ['sheet_x'],
                groupKeys: ['sheet_keep'],
              },
              manualRefillProgress: {
                selectedSheetKeys: ['sheet_x', 'sheet_keep'],
                completedSheetMessageIndexByKey: { sheet_x: 2 },
              },
            },
            manualRefillProgress: {
              selectedSheetKeys: ['sheet_x', 'sheet_keep'],
              completedSheetMessageIndexByKey: { sheet_x: 3 },
            },
            logEntries: [
              {
                seq: 7,
                baseRevision: `runtime-v1:${JSON.stringify({ sheets: { sheet_x: 1, sheet_keep: 2 } })}`,
                parentRevision: `runtime-v1:${JSON.stringify({ sheets: { sheet_x: 3 } })}`,
                filledSheetKeys: ['sheet_x', 'sheet_keep'],
                changedSheetKeys: ['sheet_x'],
                groupKeys: ['sheet_keep'],
                operations: [

                  { kind: 'row_upsert', sheetKey: 'sheet_x', rowId: 'r1', cells: ['r1'] },
                  { kind: 'data_replace', data: { sheet_x: { name: '旧目标表' }, sheet_keep: { name: '保留表' } } },
                ],
                patches: [{ kind: 'row_delete', sheetKey: 'sheet_x', rowId: 'r2' }],
                writeSet: [{ kind: 'sheet', sheetKey: 'sheet_x' }, { kind: 'sheet', sheetKey: 'sheet_keep' }],
                manualRefillProgress: {
                  selectedSheetKeys: ['sheet_x', 'sheet_keep'],
                  completedSheetMessageIndexByKey: { sheet_x: 12 },
                },
                notes: '自由文本里残留 sheet_x',
              },
            ],
          },
        },
      },
    };
    const before = JSON.stringify(msg);

    const report = scanTargetKeysResidue_ACU(msg, 'tag1', ['sheet_x'], 42);

    expect(report).toEqual(expect.objectContaining({
      isolationKeyMatched: true,
      entryCount: 1,
      matchingEntries: [7],
      exactHits: 14,
      runtimeV1Hits: 2,
      checkpointDataRisk: true,
      scheduleSummaryRisk: true,
    }));
    expect(report.checkpointDataRisks).toEqual([
      {
        messageIndex: 42,
        tagKey: 'tag1',
        targetKey: 'sheet_x',
        reason: 'manual',
        createdAt: 123456,
      },
    ]);
    expect(report.substringOnlyPaths).toEqual(['logEntries[0].notes']);
    expect(JSON.stringify(msg)).toBe(before);
  });

  it('runtime-v1 异常形态不计入 revision 命中且不抛错', () => {
    const msg: any = {
      TavernDB_ACU_IsolatedData: {
        tag1: {
          storageFrame: {
            logEntries: [
              { baseRevision: 'runtime-v1:{bad json' },
              { baseRevision: `other-prefix:${JSON.stringify({ sheets: { sheet_x: 1 } })}` },
              { baseRevision: `runtime-v1:${JSON.stringify({ sheets: null })}` },
              { baseRevision: `runtime-v1:${JSON.stringify({ sheets: [] })}` },
            ],
          },
        },
      },
    };

    const report = scanTargetKeysResidue_ACU(msg, 'tag1', ['sheet_x']);

    expect(report.runtimeV1Hits).toBe(0);
    expect(report.exactHits).toBe(0);
    expect(report.checkpointDataRisks).toEqual([]);
    expect(report.substringOnlyPaths).toEqual([]);
  });

  it('substringOnlyPaths 最多保留 8 条且不把 runtime-v1 字符串当裸文本路径', () => {
    const logEntries = Array.from({ length: 12 }, (_, index) => ({
      seq: index + 1,
      note: `自由文本残留 sheet_x #${index}`,
    }));
    logEntries.push({
      seq: 99,
      baseRevision: `runtime-v1:${JSON.stringify({ sheets: { sheet_x: 1 } })}`,
      note: '保留 runtime-v1 结构化命中',
    });
    const msg: any = {
      TavernDB_ACU_IsolatedData: {
        tag1: { storageFrame: { logEntries } },
      },
    };

    const report = scanTargetKeysResidue_ACU(msg, 'tag1', ['sheet_x']);

    expect(report.runtimeV1Hits).toBe(1);
    expect(report.substringOnlyPaths).toHaveLength(8);
    expect(report.substringOnlyPaths).toEqual([
      'logEntries[0].note',
      'logEntries[1].note',
      'logEntries[2].note',
      'logEntries[3].note',
      'logEntries[4].note',
      'logEntries[5].note',
      'logEntries[6].note',
      'logEntries[7].note',
    ]);
  });

  it('把目标 perSheet checkpoint 纳入既有 checkpoint 风险报告', () => {
    const msg: any = {
      TavernDB_ACU_IsolatedData: {
        tag1: {
          storageFrame: {
            perSheetCheckpoints: {
              sheet_x: {
                kind: 'sheet_full',
                createdAt: 456,
                reason: 'manual',
                sheetKey: 'sheet_x',
                data: { name: '目标表' },
                scheduleSummary: { lastFilledAiFloor: 7 },
                event: { filledSheetKeys: ['sheet_x'], changedSheetKeys: [], groupKeys: [] },
              },
            },
            logEntries: [],
          },
        },
      },
    };

    const report = scanTargetKeysResidue_ACU(msg, 'tag1', ['sheet_x'], 9);

    expect(report.checkpointDataRisk).toBe(true);
    expect(report.scheduleSummaryRisk).toBe(true);
    expect(report.exactHits).toBe(1);
    expect(report.checkpointDataRisks).toEqual([{
      messageIndex: 9,
      tagKey: 'tag1',
      targetKey: 'sheet_x',
      kind: 'sheet_full',
      reason: 'manual',
      createdAt: 456,
    }]);
  });

  it('逐条报告同 key timeline 事件残留，并保持隔离和只读语义', () => {
    const checkpoint = {
      kind: 'sheet_full', sheetKey: 'sheet_x', reason: 'schema_change', createdAt: 789,
      data: { name: '目标表', content: [['row_id', '值'], ['1', '保留']] },
      scheduleSummary: { lastFilledAiFloor: 8 },
      event: { filledSheetKeys: ['sheet_x'], changedSheetKeys: [], groupKeys: [] },
      timeline: { kind: 'sheet_hide', activateAtMessageIndex: 9, afterSeq: 1 },
    };
    const msg = { TavernDB_ACU_IsolatedData: {
      tag1: { storageFrame: { logEntries: [], sheetTimelineEvents: [
        { ordinal: 2, checkpoint },
        { ordinal: 5, checkpoint: { ...checkpoint, timeline: { ...checkpoint.timeline, kind: 'sheet_reveal' } } },
      ] } },
      other: { storageFrame: { logEntries: [] } },
    } };
    const before = JSON.stringify(msg);

    const report = scanTargetKeysResidue_ACU(msg, 'tag1', ['sheet_x'], 9);

    expect(report).toMatchObject({ checkpointDataRisk: true, scheduleSummaryRisk: true, exactHits: 2 });
    expect(report.checkpointDataRisks).toEqual([0, 1].map(() => ({
      messageIndex: 9, tagKey: 'tag1', targetKey: 'sheet_x', kind: 'sheet_full',
      reason: 'schema_change', createdAt: 789,
    })));
    expect(scanTargetKeysResidue_ACU(msg, 'other', ['sheet_x']).checkpointDataRisk).toBe(false);
    expect(JSON.stringify(msg)).toBe(before);
  });

});
