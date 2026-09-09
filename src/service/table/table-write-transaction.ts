import type { TableDataObject_ACU } from '../../shared/models/table-data';
import type { TableMutationSourceV2_ACU, TableWriteConflictUnitV2_ACU } from './storage-frame-v2-types';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';

type ReleaseLock_ACU = () => void;
type LockMode_ACU = 'read' | 'write';

interface QueuedLockRequest_ACU {
  mode: LockMode_ACU;
  resolve: (release: ReleaseLock_ACU) => void;
}

class ReadWriteLock_ACU {
  private activeReaders = 0;
  private activeWriter = false;
  private queue: QueuedLockRequest_ACU[] = [];

  acquireRead(): Promise<ReleaseLock_ACU> {
    return this.enqueue('read');
  }

  acquireWrite(): Promise<ReleaseLock_ACU> {
    return this.enqueue('write');
  }

  private enqueue(mode: LockMode_ACU): Promise<ReleaseLock_ACU> {
    return new Promise((resolve) => {
      this.queue.push({ mode, resolve });
      this.drain();
    });
  }

  private drain(): void {
    if (this.activeWriter || this.queue.length === 0) return;

    const first = this.queue[0];
    if (first.mode === 'write') {
      if (this.activeReaders > 0) return;
      this.queue.shift();
      this.activeWriter = true;
      first.resolve(() => {
        this.activeWriter = false;
        this.drain();
      });
      return;
    }

    while (this.queue.length > 0 && this.queue[0].mode === 'read' && !this.activeWriter) {
      const request = this.queue.shift()!;
      this.activeReaders += 1;
      request.resolve(() => {
        this.activeReaders = Math.max(0, this.activeReaders - 1);
        if (this.activeReaders === 0) this.drain();
      });
    }
  }
}

const keyedLocks_ACU = new Map<string, ReadWriteLock_ACU>();

type RuntimeRevisionState_ACU = {
  global: number;
  allRevision: number;
  sheets: Map<string, number>;
};

const runtimeRevisions_ACU = new Map<string, RuntimeRevisionState_ACU>();

function getRuntimeRevisionState_ACU(scopeKey: string): RuntimeRevisionState_ACU {
  let state = runtimeRevisions_ACU.get(scopeKey);
  if (!state) {
    state = { global: 0, allRevision: 0, sheets: new Map<string, number>() };
    runtimeRevisions_ACU.set(scopeKey, state);
  }
  return state;
}

function getRuntimeScopeKey_ACU(parts: { chatKey?: string | null; isolationKey?: string | null }): string {
  return [
    normalizeScopePart_ACU(parts.chatKey, 'current-chat'),
    normalizeScopePart_ACU(parts.isolationKey, 'default'),
    'runtime',
  ].join('::');
}

function encodeRuntimeRevisionSnapshot_ACU(snapshot: unknown): string {
  return `runtime-v1:${JSON.stringify(snapshot)}`;
}

interface ParsedRuntimeRevisionSnapshot_ACU {
  scopeKey: string;
  all: boolean;
  global: number;
  allRevision: number;
  sheets: Record<string, number>;
}

/**
 * 解析 captureRuntimeRevisionSnapshotForScope_ACU 产出的版本快照。
 * 非 runtime-v1 格式（哨兵字符串、旧调用方传入的任意值）返回 null——
 * 调用方对不可解析的基线不做冲突校验，保持向后兼容。
 */
function parseRuntimeRevisionSnapshot_ACU(revision: string | null | undefined): ParsedRuntimeRevisionSnapshot_ACU | null {
  if (typeof revision !== 'string' || !revision.startsWith('runtime-v1:')) return null;
  try {
    const parsed = JSON.parse(revision.slice('runtime-v1:'.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const sheets: Record<string, number> = {};
    if (parsed.sheets && typeof parsed.sheets === 'object' && !Array.isArray(parsed.sheets)) {
      for (const [sheetKey, value] of Object.entries(parsed.sheets)) {
        const revisionValue = Number(value);
        if (Number.isFinite(revisionValue)) sheets[sheetKey] = revisionValue;
      }
    }
    const globalValue = Number(parsed.global);
    const allRevisionValue = Number(parsed.allRevision);
    if (!Number.isFinite(globalValue) || !Number.isFinite(allRevisionValue)) return null;
    return {
      scopeKey: String(parsed.scopeKey || ''),
      all: parsed.all === true,
      global: globalValue,
      allRevision: allRevisionValue,
      sheets,
    };
  } catch {
    return null;
  }
}


function captureRuntimeRevisionSnapshotForScope_ACU(scopeKey: string, writeSet: TableWriteConflictUnitV2_ACU[]): string {
  const state = getRuntimeRevisionState_ACU(scopeKey);
  const normalized = normalizeTableWriteSet_ACU(writeSet);
  const sheetKeys = [...new Set(normalized
    .filter(unit => unit.kind !== 'all')
    .map(unit => (unit as any).sheetKey)
    .filter(Boolean))].sort();
  return encodeRuntimeRevisionSnapshot_ACU({
    scopeKey,
    all: normalized.some(unit => unit.kind === 'all'),
    global: state.global,
    allRevision: state.allRevision,
    sheets: Object.fromEntries(sheetKeys.map(sheetKey => [sheetKey, state.sheets.get(sheetKey) || 0])),
  });
}


function normalizeRevisionBumpWriteSet_ACU(
  revisionWriteSet: TableWriteConflictUnitV2_ACU[] | undefined,
  fallbackWriteSet: TableWriteConflictUnitV2_ACU[],
): TableWriteConflictUnitV2_ACU[] {
  if (revisionWriteSet === undefined) return normalizeTableWriteSet_ACU(fallbackWriteSet);
  if (!Array.isArray(revisionWriteSet) || revisionWriteSet.length === 0) return [];
  return normalizeTableWriteSet_ACU(revisionWriteSet);
}

function bumpRuntimeRevision_ACU(scopeKey: string, writeSet: TableWriteConflictUnitV2_ACU[]): string {
  const state = getRuntimeRevisionState_ACU(scopeKey);
  const normalized = Array.isArray(writeSet) ? writeSet : [];
  if (normalized.length === 0) return `runtime:${state.global}`;
  state.global += 1;
  const revision = state.global;
  if (normalized.some(unit => unit.kind === 'all')) {
    state.allRevision = revision;
  } else {
    for (const unit of normalized) {
      const sheetKey = (unit as any).sheetKey;
      if (sheetKey) state.sheets.set(sheetKey, revision);
    }
  }
  return `runtime:${revision}`;
}

export function invalidateTableRuntimeRevision_ACU(parts: {
  chatKey?: string | null;
  isolationKey?: string | null;
  reason?: string;
} = {}): string {
  const chatKey = normalizeScopePart_ACU(parts.chatKey ?? currentChatFileIdentifier_ACU, 'current-chat');
  const isolationKey = normalizeScopePart_ACU(parts.isolationKey ?? getCurrentIsolationKey_ACU(), 'default');
  const scopeKey = getRuntimeScopeKey_ACU({ chatKey, isolationKey });
  return bumpRuntimeRevision_ACU(scopeKey, [{ kind: 'all' }]);
}

function getLock_ACU(scopeKey: string): ReadWriteLock_ACU {
  let lock = keyedLocks_ACU.get(scopeKey);
  if (!lock) {
    lock = new ReadWriteLock_ACU();
    keyedLocks_ACU.set(scopeKey, lock);
  }
  return lock;
}

async function acquireRead_ACU(scopeKey: string): Promise<ReleaseLock_ACU> {
  return getLock_ACU(scopeKey).acquireRead();
}

async function acquireWrite_ACU(scopeKey: string): Promise<ReleaseLock_ACU> {
  return getLock_ACU(scopeKey).acquireWrite();
}

function normalizeScopePart_ACU(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || fallback).trim();
  return normalized || fallback;
}

function deepClone_ACU<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function buildTableMaintenanceScopeKey_ACU(parts: {
  chatKey?: string | null;
  isolationKey?: string | null;
}): string {
  return [
    normalizeScopePart_ACU(parts.chatKey, 'current-chat'),
    normalizeScopePart_ACU(parts.isolationKey, 'default'),
    'maintenance',
  ].join('::');
}

export function buildTableSheetMutationScopeKey_ACU(parts: {
  chatKey?: string | null;
  isolationKey?: string | null;
  sheetKey: string | '*';
}): string {
  return [
    normalizeScopePart_ACU(parts.chatKey, 'current-chat'),
    normalizeScopePart_ACU(parts.isolationKey, 'default'),
    'sheet',
    parts.sheetKey || '*',
  ].join('::');
}

export function buildTableCommitScopeKey_ACU(parts: {
  chatKey?: string | null;
  isolationKey?: string | null;
}): string {
  return [
    normalizeScopePart_ACU(parts.chatKey, 'current-chat'),
    normalizeScopePart_ACU(parts.isolationKey, 'default'),
    'commit',
  ].join('::');
}

export function captureTableRuntimeRevisionForWriteSet_ACU(
  writeSet: TableWriteConflictUnitV2_ACU[] | null | undefined,
  parts: { chatKey?: string | null; isolationKey?: string | null } = {},
): string {
  const chatKey = normalizeScopePart_ACU(parts.chatKey ?? currentChatFileIdentifier_ACU, 'current-chat');
  const isolationKey = normalizeScopePart_ACU(parts.isolationKey ?? getCurrentIsolationKey_ACU(), 'default');
  return captureRuntimeRevisionSnapshotForScope_ACU(getRuntimeScopeKey_ACU({ chatKey, isolationKey }), normalizeTableWriteSet_ACU(writeSet));
}

export type TableWriteMaintenanceMode_ACU = 'shared' | 'exclusive';
export type TableWriteTransactionSource_ACU = TableMutationSourceV2_ACU | 'system_cleanup' | 'system_reload' | 'vector_mirror';

export function resolveTableWriteTargetMessageIndex_ACU(
  chat: any[] | null | undefined,
  requestedTargetMessageIndex?: number | null,
): number {
  if (!Array.isArray(chat) || chat.length === 0) return -1;

  if (Number.isInteger(requestedTargetMessageIndex) && requestedTargetMessageIndex !== -1) {
    const index = requestedTargetMessageIndex as number;
    return chat[index] && !chat[index].is_user ? index : -1;
  }

  for (let i = chat.length - 1; i >= 0; i -= 1) {
    if (chat[i] && !chat[i].is_user) return i;
  }
  return -1;
}

export interface TableWriteTransactionContext_ACU {
  readonly transactionId: string;
  readonly chatKey: string;
  readonly isolationKey: string;
  readonly source: TableWriteTransactionSource_ACU;
  readonly baseRevision: string | null;
  readonly writeSet: TableWriteConflictUnitV2_ACU[];
  assertFresh?(reason?: string): void;
  runCommit<R>(task: () => Promise<R> | R, revisionWriteSet?: TableWriteConflictUnitV2_ACU[] | ((result: R) => TableWriteConflictUnitV2_ACU[] | undefined)): Promise<R>;
}

export interface RunTableWriteTransactionOptions_ACU {
  source: TableWriteTransactionSource_ACU;
  reason: string;
  chatKey?: string;
  isolationKey?: string;
  writeSet: TableWriteConflictUnitV2_ACU[];
  maintenanceMode?: TableWriteMaintenanceMode_ACU;
  baseRevision?: string | null;
  initialData?: TableDataObject_ACU | null;
  /** 已在事务外构建不可变结果、task 不读取 workingData 时跳过完整数据克隆。 */
  workingDataMode?: 'clone' | 'none';
}

function generateTransactionId_ACU(): string {
  return `twtx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeTableWriteSet_ACU(writeSet: TableWriteConflictUnitV2_ACU[] | null | undefined): TableWriteConflictUnitV2_ACU[] {
  if (!Array.isArray(writeSet) || writeSet.length === 0) {
    return [{ kind: 'all' }];
  }

  if (writeSet.some(unit => unit?.kind === 'all')) {
    return [{ kind: 'all' }];
  }

  const seen = new Set<string>();
  const normalized: TableWriteConflictUnitV2_ACU[] = [];
  for (const unit of writeSet) {
    if (!unit || unit.kind === 'all') continue;
    const sheetKey = String((unit as any).sheetKey || '').trim();
    if (!sheetKey) return [{ kind: 'all' }];

    let key = '';
    let next: TableWriteConflictUnitV2_ACU;
    if (unit.kind === 'row') {
      const rowId = String(unit.rowId || '').trim();
      if (!rowId) return [{ kind: 'sheet', sheetKey }];
      next = { kind: 'row', sheetKey, rowId };
      key = `row:${sheetKey}:${rowId}`;
    } else if (unit.kind === 'cell') {
      const rowId = String(unit.rowId || '').trim();
      const columnKey = String(unit.columnKey || '').trim();
      if (!rowId || !columnKey) return [{ kind: 'sheet', sheetKey }];
      next = { kind: 'cell', sheetKey, rowId, columnKey };
      key = `cell:${sheetKey}:${rowId}:${columnKey}`;
    } else if (unit.kind === 'schema') {
      next = { kind: 'schema', sheetKey };
      key = `schema:${sheetKey}`;
    } else {
      next = { kind: 'sheet', sheetKey };
      key = `sheet:${sheetKey}`;
    }

    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(next);
    }
  }

  return normalized.length > 0 ? normalized : [{ kind: 'all' }];
}

function extractSheetKeysForLocks_ACU(writeSet: TableWriteConflictUnitV2_ACU[]): string[] | '*' {
  if (writeSet.some(unit => unit.kind === 'all')) return '*';
  return [...new Set(writeSet.map(unit => (unit as any).sheetKey).filter(Boolean))].sort();
}

function getConflictSheetKey_ACU(unit: TableWriteConflictUnitV2_ACU): string | null {
  return unit.kind === 'all' ? null : unit.sheetKey;
}

export function tableWriteUnitsConflict_ACU(a: TableWriteConflictUnitV2_ACU, b: TableWriteConflictUnitV2_ACU): boolean {
  if (a.kind === 'all' || b.kind === 'all') return true;

  const sheetA = getConflictSheetKey_ACU(a);
  const sheetB = getConflictSheetKey_ACU(b);
  if (!sheetA || !sheetB || sheetA !== sheetB) return false;

  if (a.kind === 'sheet' || b.kind === 'sheet') return true;
  if (a.kind === 'schema' || b.kind === 'schema') return true;

  if (a.kind === 'row' && b.kind === 'row') return a.rowId === b.rowId;
  if (a.kind === 'row' && b.kind === 'cell') return a.rowId === b.rowId;
  if (a.kind === 'cell' && b.kind === 'row') return a.rowId === b.rowId;
  if (a.kind === 'cell' && b.kind === 'cell') return a.rowId === b.rowId && a.columnKey === b.columnKey;

  return true;
}

export function tableWriteSetsConflict_ACU(
  left: TableWriteConflictUnitV2_ACU[] | null | undefined,
  right: TableWriteConflictUnitV2_ACU[] | null | undefined,
): boolean {
  const normalizedLeft = normalizeTableWriteSet_ACU(left);
  const normalizedRight = normalizeTableWriteSet_ACU(right);
  return normalizedLeft.some(a => normalizedRight.some(b => tableWriteUnitsConflict_ACU(a, b)));
}

async function acquireTransactionLocks_ACU(options: {
  chatKey: string;
  isolationKey: string;
  writeSet: TableWriteConflictUnitV2_ACU[];
  maintenanceMode: TableWriteMaintenanceMode_ACU;
}): Promise<ReleaseLock_ACU[]> {
  const releases: ReleaseLock_ACU[] = [];
  try {
    const maintenanceKey = buildTableMaintenanceScopeKey_ACU(options);
    releases.push(options.maintenanceMode === 'exclusive'
      ? await acquireWrite_ACU(maintenanceKey)
      : await acquireRead_ACU(maintenanceKey));

    const sheetLockTarget = extractSheetKeysForLocks_ACU(options.writeSet);
    const wildcardKey = buildTableSheetMutationScopeKey_ACU({ ...options, sheetKey: '*' });
    if (sheetLockTarget === '*') {
      releases.push(await acquireWrite_ACU(wildcardKey));
      return releases;
    }

    releases.push(await acquireRead_ACU(wildcardKey));
    for (const sheetKey of sheetLockTarget) {
      releases.push(await acquireWrite_ACU(buildTableSheetMutationScopeKey_ACU({ ...options, sheetKey })));
    }
    return releases;
  } catch (error) {
    for (const release of releases.reverse()) release();
    throw error;
  }
}

export async function runTableWriteTransaction_ACU<T>(
  options: RunTableWriteTransactionOptions_ACU,
  task: (ctx: TableWriteTransactionContext_ACU, workingData: TableDataObject_ACU | null) => Promise<T> | T,
): Promise<T> {
  const chatKey = normalizeScopePart_ACU(options.chatKey ?? currentChatFileIdentifier_ACU, 'current-chat');
  const isolationKey = normalizeScopePart_ACU(options.isolationKey ?? getCurrentIsolationKey_ACU(), 'default');
  const writeSet = normalizeTableWriteSet_ACU(options.writeSet);
  const maintenanceMode = options.maintenanceMode || 'shared';
  const releases = await acquireTransactionLocks_ACU({ chatKey, isolationKey, writeSet, maintenanceMode });
  const transactionId = generateTransactionId_ACU();
  const runtimeScopeKey = getRuntimeScopeKey_ACU({ chatKey, isolationKey });
  const baseRevision = options.baseRevision ?? captureRuntimeRevisionSnapshotForScope_ACU(runtimeScopeKey, writeSet);
  // 事务内多次 runCommit 会推进自身版本；每次成功提交后刷新有效基线，
  // 使后续 assertFresh 只检测外部并发写入而不被自己的 bump 误判。
  let effectiveBaseRevision = baseRevision;

  try {
    const ctx: TableWriteTransactionContext_ACU = {
      transactionId,
      chatKey,
      isolationKey,
      source: options.source,
      baseRevision,
      writeSet,
      assertFresh: (reason?: string): void => {
        const base = parseRuntimeRevisionSnapshot_ACU(effectiveBaseRevision);
        // 不可解析的基线（哨兵字符串/旧调用方）没有可比对的版本信息，跳过校验。
        if (!base) return;
        const label = reason || 'unspecified';
        if (base.scopeKey && base.scopeKey !== runtimeScopeKey) {
          throw new Error(
            `runtime revision conflict: ${label}: 基线快照属于其他聊天作用域（base=${base.scopeKey}, current=${runtimeScopeKey}），已拒绝陈旧提交。`,
          );
        }
        const state = getRuntimeRevisionState_ACU(runtimeScopeKey);
        if (writeSet.some(unit => unit.kind === 'all')) {
          // all 写入会覆盖全部表：基线也是 all 捕获时，任何期间写入（global 变化）都构成冲突。
          if (base.all && base.global !== state.global) {
            throw new Error(
              `runtime revision conflict: ${label}: 全表基线已过期（base global=${base.global}, current global=${state.global}），请重新读取当前表格后重试。`,
            );
          }
          // 基线是具体表捕获：只校验基线覆盖到的表；其余表无基线信息，无从校验。
          if (!base.all) {
            for (const [sheetKey, sheetRevision] of Object.entries(base.sheets)) {
              const baseEffective = Math.max(sheetRevision, base.allRevision);
              const currentEffective = Math.max(state.sheets.get(sheetKey) || 0, state.allRevision);
              if (baseEffective !== currentEffective) {
                throw new Error(
                  `runtime revision conflict: ${label}: sheetKey=${sheetKey} 基线已过期（base=${baseEffective}, current=${currentEffective}），请重新读取当前表格后重试。`,
                );
              }
            }
          }
          return;
        }
        for (const unit of writeSet) {
          const sheetKey = getConflictSheetKey_ACU(unit);
          if (!sheetKey) continue;
          // 基线未覆盖该表（例如模板路径用 all 捕获、提交时才确定具体表）：
          // 无逐表版本可比，保持放行——这是模板切回场景的既有语义（误杀修复）。
          if (!(sheetKey in base.sheets)) continue;
          const baseEffective = Math.max(base.sheets[sheetKey], base.allRevision);
          const currentEffective = Math.max(state.sheets.get(sheetKey) || 0, state.allRevision);
          if (baseEffective !== currentEffective) {
            throw new Error(
              `runtime revision conflict: ${label}: sheetKey=${sheetKey} 基线已过期（base=${baseEffective}, current=${currentEffective}），请重新读取当前表格后重试。`,
            );
          }
        }
      },
      runCommit: async <R>(commitTask: () => Promise<R> | R, revisionWriteSet?: TableWriteConflictUnitV2_ACU[] | ((result: R) => TableWriteConflictUnitV2_ACU[] | undefined)): Promise<R> => {
        const releaseCommit = await acquireWrite_ACU(buildTableCommitScopeKey_ACU({ chatKey, isolationKey }));
        try {
          const result = await commitTask();
          const resolvedRevisionWriteSet = typeof revisionWriteSet === 'function' ? revisionWriteSet(result) : revisionWriteSet;
          bumpRuntimeRevision_ACU(runtimeScopeKey, normalizeRevisionBumpWriteSet_ACU(resolvedRevisionWriteSet, writeSet));
          effectiveBaseRevision = captureRuntimeRevisionSnapshotForScope_ACU(runtimeScopeKey, writeSet);
          return result;
        } finally {
          releaseCommit();
        }
      },
    };

    const workingData = options.workingDataMode === 'none'
      ? null
      : deepClone_ACU(options.initialData !== undefined ? options.initialData : currentJsonTableData_ACU);
    return await task(ctx, workingData);
  } finally {
    for (const release of releases.reverse()) release();
  }
}

export function _resetTableWriteTransactionLocksForTest_ACU(): void {
  keyedLocks_ACU.clear();
  runtimeRevisions_ACU.clear();
}
