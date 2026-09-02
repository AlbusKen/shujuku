/**
 * service/table/runtime-only-pending-state.ts — 运行时未落盘变更登记。
 *
 * 开放 API 的 CRUD/SQL 写入允许 skipChatSave（skipSave / isImportMode）：只改 live runtime，
 * 不写聊天 V2 帧。V2 是 operation log 语义，后续任何普通写入只追加自己的 operation，
 * 不会像旧版那样把整份运行时快照带回聊天。于是这些行只存在于 runtime：
 * 楼层帧里没有对应数据、表格状态显示未初始、填表基底（聊天回放）看不到它们，
 * AI 把已存在的行重新 INSERT，提交时撞 live SQLite 的 UNIQUE 约束或把行数翻倍。
 *
 * 本模块按 (chatKey, isolationKey) 登记「哪些表有未落盘的运行时变更」；
 * 真正的落盘由 runtime-only-pending-flush 在下一次普通持久化写入 / 填表开始前完成。
 * 这里刻意不依赖任何 service 模块，避免与提交模型形成循环导入。
 */

export type RuntimeOnlyPendingScope_ACU = {
  chatKey?: string | null;
  isolationKey?: string | null;
};

export type RuntimeOnlyPendingSnapshot_ACU = {
  /** true 表示曾有 kind:'all' 的写入，需按当前运行时全部表处理。 */
  all: boolean;
  sheetKeys: string[];
};

type PendingState_ACU = {
  all: boolean;
  sheetKeys: Set<string>;
};

type PendingFlusher_ACU = (reason: string) => Promise<RuntimeOnlyPendingFlushResult_ACU>;

export type RuntimeOnlyPendingFlushResult_ACU = {
  flushed: boolean;
  sheetKeys: string[];
  messageIndex?: number;
  error?: string;
};

const pendingByScope_ACU = new Map<string, PendingState_ACU>();
let registeredFlusher_ACU: PendingFlusher_ACU | null = null;

function normalizeScopePart_ACU(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || fallback).trim();
  return normalized || fallback;
}

export function buildRuntimeOnlyPendingScopeKey_ACU(scope: RuntimeOnlyPendingScope_ACU): string {
  return [
    normalizeScopePart_ACU(scope.chatKey, 'current-chat'),
    normalizeScopePart_ACU(scope.isolationKey, 'default'),
  ].join('::');
}

/**
 * 从写集提取受影响的表。任何 kind:'all' 或缺少 sheetKey 的单元都视为「全部表」，
 * 宁可多登记也不能漏掉 runtime-only 变更。
 */
export function extractPendingSheetKeysFromWriteSet_ACU(
  writeSet: ReadonlyArray<{ kind: string; sheetKey?: string } | null | undefined> | null | undefined,
): { all: boolean; sheetKeys: string[] } {
  if (!Array.isArray(writeSet) || writeSet.length === 0) return { all: true, sheetKeys: [] };
  const sheetKeys = new Set<string>();
  for (const unit of writeSet) {
    if (!unit || unit.kind === 'all') return { all: true, sheetKeys: [] };
    const sheetKey = String(unit.sheetKey || '').trim();
    if (!sheetKey.startsWith('sheet_')) return { all: true, sheetKeys: [] };
    sheetKeys.add(sheetKey);
  }
  return { all: false, sheetKeys: [...sheetKeys].sort() };
}

export function markRuntimeOnlyPendingSheets_ACU(
  scope: RuntimeOnlyPendingScope_ACU,
  pending: { all: boolean; sheetKeys: readonly string[] },
): void {
  const scopeKey = buildRuntimeOnlyPendingScopeKey_ACU(scope);
  const state = pendingByScope_ACU.get(scopeKey) || { all: false, sheetKeys: new Set<string>() };
  if (pending.all) state.all = true;
  for (const sheetKey of pending.sheetKeys) {
    if (typeof sheetKey === 'string' && sheetKey.startsWith('sheet_')) state.sheetKeys.add(sheetKey);
  }
  pendingByScope_ACU.set(scopeKey, state);
}

export function readRuntimeOnlyPendingSheets_ACU(scope: RuntimeOnlyPendingScope_ACU): RuntimeOnlyPendingSnapshot_ACU | null {
  const state = pendingByScope_ACU.get(buildRuntimeOnlyPendingScopeKey_ACU(scope));
  if (!state || (!state.all && state.sheetKeys.size === 0)) return null;
  return { all: state.all, sheetKeys: [...state.sheetKeys].sort() };
}

export function hasRuntimeOnlyPendingSheets_ACU(scope: RuntimeOnlyPendingScope_ACU): boolean {
  return readRuntimeOnlyPendingSheets_ACU(scope) !== null;
}

/** 不传 scope 时清空全部登记（测试/聊天切换收尾用）。 */
export function clearRuntimeOnlyPendingSheets_ACU(scope?: RuntimeOnlyPendingScope_ACU): void {
  if (!scope) {
    pendingByScope_ACU.clear();
    return;
  }
  pendingByScope_ACU.delete(buildRuntimeOnlyPendingScopeKey_ACU(scope));
}

/**
 * 落盘器由 runtime-only-pending-flush 注册；提交模型通过本入口触发，
 * 避免 table-update-commit ↔ flush 之间的直接循环导入。未注册时静默跳过。
 */
export function registerRuntimeOnlyPendingFlusher_ACU(flusher: PendingFlusher_ACU | null): void {
  registeredFlusher_ACU = flusher;
}

export async function runRegisteredRuntimeOnlyPendingFlush_ACU(
  scope: RuntimeOnlyPendingScope_ACU,
  reason: string,
): Promise<RuntimeOnlyPendingFlushResult_ACU> {
  if (!registeredFlusher_ACU || !hasRuntimeOnlyPendingSheets_ACU(scope)) {
    return { flushed: false, sheetKeys: [] };
  }
  return registeredFlusher_ACU(reason);
}
