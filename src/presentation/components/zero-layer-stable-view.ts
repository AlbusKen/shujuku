import { getHostWindow } from '../../shared/runtime-env';
import { captureZeroLayerCarrier_ACU, assertZeroLayerCarrier_ACU,
  type ZeroLayerCarrierContext_ACU } from '../../service/zero-layer/carrier-context';
import { zeroLayerHistoryReader_ACU } from '../../service/zero-layer/history-read';
import type { ZeroLayerSessionSnapshot_ACU } from '../../service/zero-layer/history-model';
import { subscribeZeroLayerViewPreview_ACU, type ZeroLayerViewPreview_ACU } from '../../service/zero-layer/view-preview';
import { ZeroLayerGameChannel_ACU } from './zero-layer-game-channel';

/** 只持有 shell 外的文本槽；不写 mes、不执行 markup、不替换消息或 iframe。 */
export class ZeroLayerStableView_ACU {
  private context: ZeroLayerCarrierContext_ACU | null = null;
  private root: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  private slot: HTMLElement | null = null;
  private snapshot: ZeroLayerSessionSnapshot_ACU | null = null;
  private preview: ZeroLayerViewPreview_ACU | null = null;
  private lastPreview: ZeroLayerViewPreview_ACU | null = null;
  private releaseHistory: (() => void) | null = null;
  private releasePreview: (() => void) | null = null;
  private epoch = 0;
  private syncing: Promise<void> | null = null;
  private dirty = false;
  private gameChannel: ZeroLayerGameChannel_ACU | null = null;
  /** 页面发送入口持有；跨挂载保留，只对同一聊天身份显示。 */
  private busyKey: string | null = null;

  /** 只在自有文本槽提示处理中；不进入游戏通道、快照或任何存档。 */
  setBusy(key: string | null): void {
    if (this.busyKey === key) return;
    this.busyKey = key;
    if (!this.snapshot) return;
    try {
      this.assertSlot();
      this.paint(this.preview?.body ?? this.publishedBody());
    } catch { this.markOutOfSync(); }
  }

  /** 编辑/更新事件后的核对；未挂载时无法确认返回 null。 */
  isSourceCurrent(): boolean | null {
    if (!this.context) return null;
    try { assertZeroLayerCarrier_ACU(this.context); return true; } catch { return false; }
  }

  async mount(): Promise<void> {
    this.dispose();
    const epoch = this.epoch;
    const context = captureZeroLayerCarrier_ACU();
    const result = await zeroLayerHistoryReader_ACU.getSnapshot({ version: 1 });
    if (epoch !== this.epoch) throw new Error('scope-changed');
    if (result.ok === false) throw new Error(result.error.code);
    assertZeroLayerCarrier_ACU(context);
    // 脚本 iframe 的 jQuery 默认查询自己的文档；载体楼层始终属于酒馆主窗口。
    const chat = getHostWindow().document.querySelector('#chat');
    const root = chat?.querySelector<HTMLElement>(`.mes[mesid="${context.carrierIndex}"]`);
    if (!root) throw new Error('view-out-of-sync');
    const slot = root.ownerDocument.createElement('div');
    slot.className = 'acu-zero-layer-body';
    slot.style.whiteSpace = 'pre-wrap';
    slot.style.overflowWrap = 'anywhere';
    slot.setAttribute('aria-live', 'polite');
    // 酒馆 .mes 是头像与 mes_block 的横向 flex；槽挂在 mes_text 之后，不进入会被宿主重绘的 mes_text。
    const container = ([...root.children].find(child => child.classList.contains('mes_block')) as HTMLElement | undefined) ?? root;
    const text = [...container.children].find(child => child.classList.contains('mes_text'));
    this.context = context;
    this.root = root;
    this.container = container;
    this.slot = slot;
    this.snapshot = result.value;
    if (text) text.after(slot);
    else container.appendChild(slot);
    try {
      this.render(result.value.headTurnId === null ? '' : result.value.currentBody);
      this.releasePreview = subscribeZeroLayerViewPreview_ACU(value => this.receivePreview(value));
      this.releaseHistory = zeroLayerHistoryReader_ACU.subscribe(change => {
        if (change.kind === 'scope-invalidated') { this.dispose(); return; }
        this.dirty = true;
        void this.resync().catch(() => { /* 展示错误已标记，不影响通知提交。 */ });
      });
    } catch (error) { this.dispose(); throw error; }
  }

  /** 通知遗漏或展示失败后仅回读，不重新生成或重载 shell。 */
  resync(): Promise<void> {
    this.dirty = true;
    if (!this.snapshot) return Promise.reject(new Error('view-out-of-sync'));
    if (this.syncing) return this.syncing;
    const epoch = this.epoch;
    const operation = this.readPublished(epoch).finally(() => {
      if (this.syncing === operation) this.syncing = null;
    });
    this.syncing = operation;
    return operation;
  }

  private async readPublished(epoch: number): Promise<void> {
    try {
      while (this.dirty && epoch === this.epoch) {
        this.dirty = false;
        const result = await zeroLayerHistoryReader_ACU.getSnapshot({ version: 1 });
        if (epoch !== this.epoch) throw new Error('scope-changed');
        if (result.ok === false) throw new Error(result.error.code);
        const previous = this.snapshot!;
        const current = result.value;
        if (current.sessionId !== previous.sessionId || current.branchId !== previous.branchId
          || current.carrierRef.carrierId !== previous.carrierRef.carrierId
          || current.carrierRef.swipeId !== previous.carrierRef.swipeId) {
          this.dispose();
          throw new Error('scope-changed');
        }
        if (current.revision < previous.revision) throw new Error('view-out-of-sync');
        this.snapshot = current;
        if (this.preview && (current.headTurnId === this.preview.turnId
          || current.revision >= this.preview.revision && current.status !== 'busy')) this.preview = null;
        this.render(this.preview?.body ?? this.publishedBody());
        this.slot?.removeAttribute('data-view-error');
      }
    } catch (error) {
      if (epoch === this.epoch) this.markOutOfSync();
      throw error;
    }
  }

  private publishedBody(): string {
    return this.snapshot?.headTurnId === null ? '' : this.snapshot?.currentBody ?? '';
  }

  private assertSlot(): void {
    if (!this.context || !this.root?.isConnected || !this.slot || !this.container
      || this.slot.parentElement !== this.container || !this.root.contains(this.container)
      || this.slot.childElementCount !== 0) {
      throw new Error('view-out-of-sync');
    }
    assertZeroLayerCarrier_ACU(this.context);
  }

  /** 只替换自有叶节点文本；模型返回的 HTML、script 和 iframe 均不会执行。 */
  private paint(body: string): void {
    const busy = this.busyKey !== null && this.busyKey === this.context?.key && !this.preview;
    this.slot!.textContent = busy ? `${body}${body ? '\n\n' : ''}（零层回合处理中…）` : body;
  }

  private render(body: string): void {
    this.assertSlot();
    this.paint(body);
    if (this.gameChannel) {
      try {
        this.gameChannel.publish({ snapshot: this.snapshot!, body,
          preview: this.preview ? { turnId: this.preview.turnId, attemptId: this.preview.attemptId,
            sequence: this.preview.sequence } : null });
      } catch {
        this.gameChannel.dispose();
        this.gameChannel = null;
        this.markOutOfSync();
      }
    }
  }

  /** 宿主显式选取当前载体的 iframe；不扫描猜测、不改写 src/srcdoc。 */
  bindGameFrame(frame: HTMLIFrameElement, origin: string) {
    const context = this.context;
    const root = this.root;
    const snapshot = this.snapshot;
    const epoch = this.epoch;
    if (!context || !root || !snapshot || frame?.tagName !== 'IFRAME'
      || frame.ownerDocument !== root.ownerDocument || !root.contains(frame)) {
      throw new Error('access-denied');
    }
    const address = frame.hasAttribute('srcdoc') ? root.ownerDocument.location.href
      : frame.getAttribute('src') || root.ownerDocument.location.href;
    const actualOrigin = new URL(address, root.ownerDocument.baseURI).origin;
    if (actualOrigin !== origin || actualOrigin === 'null') throw new Error('iframe-origin-not-supported');
    const assertCurrent = () => {
      if (epoch !== this.epoch || this.context !== context || this.root !== root
        || !root.isConnected || !root.contains(frame)) throw new Error('scope-changed');
      assertZeroLayerCarrier_ACU(context);
    };
    assertCurrent();
    this.gameChannel?.dispose();
    const api = Object.freeze({
      getSnapshot: zeroLayerHistoryReader_ACU.getSnapshot.bind(zeroLayerHistoryReader_ACU),
      readHistory: zeroLayerHistoryReader_ACU.readHistory.bind(zeroLayerHistoryReader_ACU),
      subscribe: zeroLayerHistoryReader_ACU.subscribe.bind(zeroLayerHistoryReader_ACU),
    });
    const channel = new ZeroLayerGameChannel_ACU(frame, origin, {
      snapshot, body: this.preview?.body ?? this.publishedBody(),
      preview: this.preview ? { turnId: this.preview.turnId, attemptId: this.preview.attemptId,
        sequence: this.preview.sequence } : null,
    }, api, assertCurrent, () => {});
    this.gameChannel = channel;
    return Object.freeze({ get isReady() { return channel.isReady; }, dispose: channel.dispose });
  }

  private markOutOfSync(): void {
    if (!this.slot) return;
    this.slot.dataset.viewError = 'view-out-of-sync';
    this.slot.title = '正文显示未同步，请使用数据重同步；不会重新生成或重载游戏。';
  }

  get isMounted(): boolean { return this.snapshot !== null; }

  private receivePreview(value: ZeroLayerViewPreview_ACU): void {
    const snapshot = this.snapshot;
    if (!snapshot || value.sessionId !== snapshot.sessionId || value.branchId !== snapshot.branchId
      || value.carrierId !== snapshot.carrierRef.carrierId
      || value.carrierSwipeId !== snapshot.carrierRef.swipeId) return;
    const previous = this.lastPreview;
    if (previous) {
      const sameAttempt = previous.turnId === value.turnId && previous.attemptId === value.attemptId;
      if (sameAttempt ? value.sequence <= previous.sequence || previous.body === null
        : value.revision <= previous.revision) return;
    }
    if (value.body !== null && (value.revision < snapshot.revision || value.turnId === snapshot.headTurnId)) return;
    this.lastPreview = { ...value };
    this.preview = value.body === null ? null : { ...value };
    try {
      this.render(this.preview?.body ?? this.publishedBody());
      if (value.body === null) void this.resync().catch(() => { /* 展示错误已标记。 */ });
    } catch { this.markOutOfSync(); }
  }

  dispose(): void {
    this.epoch += 1;
    this.gameChannel?.dispose();
    this.gameChannel = null;
    const releaseHistory = this.releaseHistory;
    const releasePreview = this.releasePreview;
    this.releaseHistory = null;
    this.releasePreview = null;
    releaseHistory?.();
    releasePreview?.();
    // 只移除自有叶节点；绝不删除载体楼层或 shell。
    this.slot?.remove();
    this.context = null;
    this.root = null;
    this.container = null;
    this.slot = null;
    this.snapshot = null;
    this.preview = null;
    this.lastPreview = null;
    this.syncing = null;
    this.dirty = false;
  }
}
