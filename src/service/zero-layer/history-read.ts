import { ZeroLayerStore_ACU } from './store';
import { captureZeroLayerCarrier_ACU, assertZeroLayerCarrier_ACU,
  type ZeroLayerCarrierContext_ACU } from './carrier-context';
import type { ZeroLayerEnvelope_ACU } from './model';
import { ZeroLayerHistoryReadError_ACU as ReadError, zeroLayerHistoryFailure_ACU } from './history-errors';
import { validateZeroLayerHistoryQuery_ACU } from './history-query';
import { projectZeroLayerHistory_ACU, isZeroLayerHistoryRetained_ACU,
  zeroLayerHistoryStatus_ACU } from './history-projection';
import type { ZeroLayerHistoryApi_ACU, ZeroLayerHistoryItem_ACU, ZeroLayerHistoryPage_ACU,
  ZeroLayerHistoryQuery_ACU, ZeroLayerHistoryResult_ACU, ZeroLayerSessionSnapshot_ACU,
  ZeroLayerHistoryChange_ACU } from './history-model';
import { subscribeZeroLayerChanges_ACU } from './notifications';

type Binding_ACU = { context: ZeroLayerCarrierContext_ACU; sessionId: string; branchId: string; token: string };
type Cursor_ACU = { direction: 'older' | 'newer'; boundary: string };
type Snapshot_ACU = { binding: Binding_ACU; value: ZeroLayerSessionSnapshot_ACU;
  items: ZeroLayerHistoryItem_ACU[]; cursors: Map<string, Cursor_ACU> };

/** 当前页面的只读端口；不装配生成 runtime，不初始化、迁移或恢复存档。 */
export class ZeroLayerHistoryReader_ACU implements ZeroLayerHistoryApi_ACU {
  private readonly store = new ZeroLayerStore_ACU();
  private binding: Binding_ACU | null = null;
  private readonly snapshots = new Map<string, Snapshot_ACU>();
  private readonly subscriptions = new Set<(revoked?: boolean) => void>();
  private epoch = 0;
  private revoking = false;

  invalidate(): void {
    if (this.revoking) return;
    this.revoking = true;
    try {
      this.epoch += 1;
      this.binding = null;
      this.snapshots.clear();
      for (const release of [...this.subscriptions]) release(true);
    } finally { this.revoking = false; }
  }

  private assertReadable(): void {
    if (this.revoking) throw new ReadError('scope-changed', '作用域正在撤销，不能重新取得旧权限。');
  }

  private bind(context: ZeroLayerCarrierContext_ACU, envelope: ZeroLayerEnvelope_ACU): Binding_ACU {
    this.assertReadable();
    const previous = this.binding;
    if (previous && (previous.context.key !== context.key || previous.context.chat !== context.chat
      || previous.context.carrier !== context.carrier || previous.context.swipeId !== context.swipeId
      || previous.sessionId !== envelope.sessionId || previous.branchId !== envelope.activeBranchId)) {
      this.invalidate();
    }
    return this.binding ??= { context, sessionId: envelope.sessionId,
      branchId: envelope.activeBranchId, token: crypto.randomUUID() };
  }

  private requireEnabled(envelope: ZeroLayerEnvelope_ACU | null): ZeroLayerEnvelope_ACU {
    if (!envelope?.enabled) {
      this.invalidate();
      throw new ReadError('mode-disabled', '当前聊天未启用零层历史读取。');
    }
    return envelope;
  }

  private async readCurrent() {
    this.assertReadable();
    const epoch = this.epoch;
    const context = captureZeroLayerCarrier_ACU();
    const envelope = await this.store.read();
    assertZeroLayerCarrier_ACU(context);
    if (epoch !== this.epoch) throw new ReadError('scope-changed', '读取期间作用域已撤销。');
    const confirmed = this.store.readSnapshot();
    if (confirmed?.sessionId !== envelope?.sessionId || confirmed?.activeBranchId !== envelope?.activeBranchId) {
      this.invalidate();
      throw new ReadError('scope-changed', '异步读取后会话或分支已变化。');
    }
    if (JSON.stringify(confirmed) !== JSON.stringify(envelope)) {
      throw new ReadError('snapshot-stale', '异步读取后存档已变化，请重新取得快照。');
    }
    const current = this.requireEnabled(envelope);
    return { envelope: current, binding: this.bind(context, current) };
  }

  private remember(envelope: ZeroLayerEnvelope_ACU, binding: Binding_ACU): Snapshot_ACU {
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.binding === binding && snapshot.value.revision === envelope.revision) return snapshot;
    }
    const items = projectZeroLayerHistory_ACU(envelope);
    const token = crypto.randomUUID();
    const snapshot: Snapshot_ACU = { binding, items, cursors: new Map(), value: {
      protocolVersion: 1, sessionId: envelope.sessionId, branchId: envelope.activeBranchId,
      carrierRef: { carrierId: envelope.carrierId, swipeId: envelope.carrierSwipeId },
      revision: envelope.revision, headTurnId: items[items.length - 1]?.turnId ?? null,
      currentBody: items[items.length - 1]?.body ?? envelope.seedBody,
      currentPublicState: { availability: 'unavailable', value: null },
      status: zeroLayerHistoryStatus_ACU(envelope), snapshotToken: token,
    } };
    this.snapshots.set(token, snapshot);
    return snapshot;
  }

  async getSnapshot(raw: { readonly version: 1 }): Promise<ZeroLayerHistoryResult_ACU<ZeroLayerSessionSnapshot_ACU>> {
    try {
      validateZeroLayerHistoryQuery_ACU(raw, true);
      const { envelope, binding } = await this.readCurrent();
      return { ok: true, value: structuredClone(this.remember(envelope, binding).value) };
    } catch (error) { return zeroLayerHistoryFailure_ACU(error); }
  }

  async readHistory(raw: ZeroLayerHistoryQuery_ACU): Promise<ZeroLayerHistoryResult_ACU<ZeroLayerHistoryPage_ACU>> {
    try {
      const query = validateZeroLayerHistoryQuery_ACU(raw);
      let snapshot = query.snapshotToken ? this.snapshots.get(query.snapshotToken) : undefined;
      if (query.snapshotToken && !snapshot) throw new ReadError('snapshot-stale', '快照已失效，请重新读取。');
      if (query.cursor && !snapshot) {
        snapshot = [...this.snapshots.values()].find(item => item.cursors.has(query.cursor!));
      }
      if (query.cursor && !snapshot?.cursors.has(query.cursor)) {
        throw new ReadError('snapshot-stale', '游标不属于可用快照。');
      }
      const { envelope, binding } = await this.readCurrent();
      if (snapshot && snapshot.binding !== binding) throw new ReadError('scope-changed', '快照所属作用域已变化。');
      snapshot ??= this.remember(envelope, binding);
      if (envelope.revision < snapshot.value.revision
        || !isZeroLayerHistoryRetained_ACU(snapshot.items, projectZeroLayerHistory_ACU(envelope))) {
        this.snapshots.delete(snapshot.value.snapshotToken);
        throw new ReadError('snapshot-stale', '快照历史已被删除或改写，禁止静默改读最新版。');
      }
      if (query.turnId) {
        const item = snapshot.items.find(turn => turn.turnId === query.turnId);
        if (!item) throw new ReadError('not-found', '该快照内不存在所选回合。');
        return { ok: true, value: this.page(snapshot, [item], null) };
      }
      const cursor = query.cursor ? snapshot.cursors.get(query.cursor)! : null;
      const direction = query.direction ?? cursor?.direction ?? 'older';
      if (cursor && cursor.direction !== direction) throw new ReadError('invalid-query', '游标方向与查询不一致。');
      const boundary = cursor ? snapshot.items.findIndex(turn => turn.turnId === cursor.boundary) : -1;
      if (cursor && boundary < 0) throw new ReadError('snapshot-stale', '游标引用的回合已不可用。');
      const start = direction === 'newer' ? (cursor ? boundary + 1 : 0)
        : Math.max(0, (cursor ? boundary : snapshot.items.length) - query.limit!);
      const end = direction === 'newer' ? Math.min(snapshot.items.length, start + query.limit!)
        : cursor ? boundary : snapshot.items.length;
      const items = snapshot.items.slice(start, end);
      const hasMore = direction === 'newer' ? end < snapshot.items.length : start > 0;
      let nextCursor: string | null = null;
      if (hasMore) {
        const nextBoundary = direction === 'newer' ? items[items.length - 1].turnId : items[0].turnId;
        nextCursor = [...snapshot.cursors].find(([, value]) =>
          value.direction === direction && value.boundary === nextBoundary)?.[0] ?? crypto.randomUUID();
        snapshot.cursors.set(nextCursor, { direction, boundary: nextBoundary });
      }
      return { ok: true, value: this.page(snapshot, items, nextCursor) };
    } catch (error) { return zeroLayerHistoryFailure_ACU(error); }
  }

  private page(snapshot: Snapshot_ACU, items: readonly ZeroLayerHistoryItem_ACU[], nextCursor: string | null): ZeroLayerHistoryPage_ACU {
    return structuredClone({ items, snapshotToken: snapshot.value.snapshotToken,
      sourceRevision: snapshot.value.revision, nextCursor, hasMore: nextCursor !== null });
  }

  subscribe(listener: (change: ZeroLayerHistoryChange_ACU) => void): () => void {
    this.assertReadable();
    if (typeof listener !== 'function') throw new ReadError('invalid-query', '订阅回调必须为函数。');
    const context = captureZeroLayerCarrier_ACU();
    const envelope = this.requireEnabled(this.store.readSnapshot());
    const binding = this.bind(context, envelope);
    let active = true;
    let lastRevision = -1;
    let lastState = '';
    let lastChange: ZeroLayerHistoryChange_ACU = {
      kind: 'snapshot', sessionId: binding.sessionId, branchId: binding.branchId,
      revision: envelope.revision,
      headTurnId: envelope.branches.find(branch => branch.branchId === binding.branchId)!.headTurnId,
    };
    let unsubscribe = () => {};
    const release = (revoked = false) => {
      if (!active) return;
      active = false;
      unsubscribe();
      this.subscriptions.delete(release);
      if (revoked) {
        try { listener({ ...lastChange, kind: 'scope-invalidated' }); }
        catch { /* 撤销通知失败不恢复旧权限。 */ }
      }
    };
    const emit = (current: ZeroLayerEnvelope_ACU, kind: ZeroLayerHistoryChange_ACU['kind']) => {
      if (!active || current.revision <= lastRevision) return;
      const headTurnId = current.branches.find(branch => branch.branchId === current.activeBranchId)!.headTurnId;
      const state = JSON.stringify([headTurnId, zeroLayerHistoryStatus_ACU(current)]);
      if (kind !== 'snapshot' && state === lastState) return;
      lastRevision = current.revision;
      lastState = state;
      lastChange = { kind, sessionId: current.sessionId, branchId: current.activeBranchId,
        revision: current.revision, headTurnId };
      try { listener({ ...lastChange }); }
      catch { /* 回调异常不能影响已确认存档。 */ }
    };
    this.subscriptions.add(release);
    unsubscribe = subscribeZeroLayerChanges_ACU(change => {
      if (!active) return;
      try {
        assertZeroLayerCarrier_ACU(binding.context);
        const current = this.store.readSnapshot();
        if (!current?.enabled || current.sessionId !== binding.sessionId
          || current.activeBranchId !== binding.branchId || this.binding !== binding) {
          this.invalidate();
          return;
        }
        if (change.scope.chatId !== current.scope.chatId || change.scope.characterKey !== current.scope.characterKey
          || change.carrierId !== current.carrierId || change.carrierSwipeId !== current.carrierSwipeId) return;
        if (change.kind === 'stored' || change.kind === 'snapshot' || change.kind === 'LogicalTurnPublished') emit(current, 'changed');
        if (change.kind === 'scope-invalidated') this.invalidate();
      } catch { this.invalidate(); }
    });
    // 注册监听与同步取得已确认基准在同一调用栈内，发布不会夹在两者之间。
    emit(envelope, 'snapshot');
    return () => release();
  }
}

export const zeroLayerHistoryReader_ACU = new ZeroLayerHistoryReader_ACU();
