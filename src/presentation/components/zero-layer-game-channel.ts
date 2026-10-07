import type { ZeroLayerHistoryApi_ACU, ZeroLayerSessionSnapshot_ACU } from '../../service/zero-layer/history-model';

export const ZERO_LAYER_GAME_PROTOCOL_ACU = 'acu-zero-layer-game';
export interface ZeroLayerGameUpdate_ACU {
  snapshot: ZeroLayerSessionSnapshot_ACU;
  body: string;
  preview: { turnId: string; attemptId: string; sequence: number } | null;
}

/** 宿主选择实际 iframe 后建立只读通道；不会设置 src/srcdoc 或重建 shell。 */
export class ZeroLayerGameChannel_ACU {
  private readonly token = crypto.randomUUID();
  private readonly target: Window;
  private readonly host: Window;
  private active = true;
  private ready = false;
  private incoming = 0;
  private outgoing = 0;
  private latest: ZeroLayerGameUpdate_ACU;
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly attributes: readonly (string | null)[];

  constructor(private readonly frame: HTMLIFrameElement, private readonly origin: string,
    initial: ZeroLayerGameUpdate_ACU, private readonly api: Readonly<ZeroLayerHistoryApi_ACU>,
    private readonly assertCurrent: () => void, private readonly onChange: () => void) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || origin === 'null'
      || !frame.contentWindow || !frame.ownerDocument.defaultView
      || frame.hasAttribute('sandbox') && !frame.sandbox.contains('allow-same-origin')) {
      throw new Error('iframe-origin-not-supported');
    }
    this.target = frame.contentWindow;
    this.host = frame.ownerDocument.defaultView;
    this.latest = structuredClone(initial);
    this.attributes = ['src', 'srcdoc', 'sandbox'].map(name => frame.getAttribute(name));
    try {
      this.check();
      this.host.addEventListener('message', this.receive);
      frame.addEventListener('load', this.dispose);
      const Observer = (this.host as Window & typeof globalThis).MutationObserver;
      this.observer = new Observer(records => {
        // 即使属性改后又改回，也不能复用原 Window 的授权。
        if (records.some(record => record.type === 'attributes' && record.target === frame)) {
          this.dispose();
          return;
        }
        try { this.check(); } catch { this.dispose(); }
      });
      this.observer.observe(frame.ownerDocument.documentElement, { childList: true, subtree: true });
      this.observer.observe(frame, { attributes: true, attributeFilter: ['src', 'srcdoc', 'sandbox'] });
      this.timer = setTimeout(this.dispose, 10000);
      this.send('offer', { token: this.token, scope: this.scope() });
    } catch (error) { this.dispose(); throw error; }
  }

  private scope() {
    const s = this.latest.snapshot;
    return { sessionId: s.sessionId, branchId: s.branchId, carrierRef: s.carrierRef };
  }
  private check(): void {
    if (!this.active || !this.frame.isConnected || this.frame.contentWindow !== this.target) throw new Error('view-out-of-sync');
    if (['src', 'srcdoc', 'sandbox'].some((name, index) => this.frame.getAttribute(name) !== this.attributes[index])) {
      throw new Error('scope-changed');
    }
    this.assertCurrent();
  }
  get isReady(): boolean { try { this.check(); return this.ready; } catch { return false; } }

  private send(kind: string, payload: Record<string, unknown>): void {
    this.check();
    this.target.postMessage({ protocol: ZERO_LAYER_GAME_PROTOCOL_ACU, version: 1,
      kind, token: this.token, scope: this.scope(), sequence: ++this.outgoing, ...payload }, this.origin);
  }

  private readonly receive = (event: MessageEvent): void => {
    if (!this.active || event.source !== this.target || event.origin !== this.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.protocol !== ZERO_LAYER_GAME_PROTOCOL_ACU
      || data.version !== 1 || data.token !== this.token || !Number.isSafeInteger(data.sequence)
      || data.sequence <= this.incoming) return;
    const scope = data.scope;
    const current = this.scope();
    if (!scope || scope.sessionId !== current.sessionId || scope.branchId !== current.branchId
      || scope.carrierRef?.carrierId !== current.carrierRef.carrierId
      || scope.carrierRef?.swipeId !== current.carrierRef.swipeId) return;
    try {
      this.check();
      if (data.kind === 'accept' && !this.ready) {
        this.incoming = data.sequence;
        this.ready = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.send('update', { update: this.latest });
        this.onChange();
      } else if (this.ready && ['snapshot', 'history', 'close'].includes(data.kind)) {
        this.incoming = data.sequence;
        if (data.kind === 'close') { this.dispose(); return; }
        if (typeof data.requestId !== 'string' || !data.requestId) return;
        void this.read(data.kind, data.requestId, data.query);
      }
    } catch { this.dispose(); }
  };

  private async read(kind: string, requestId: string, query: any): Promise<void> {
    try {
      this.check();
      const result = kind === 'history' ? await this.api.readHistory(query) : await this.api.getSnapshot(query);
      this.check();
      if (!this.ready) return;
      this.send('result', { requestId, result });
    } catch { this.dispose(); }
  }

  publish(update: ZeroLayerGameUpdate_ACU): void {
    this.check();
    const before = this.latest.snapshot;
    const next = update.snapshot;
    if (next.sessionId !== before.sessionId || next.branchId !== before.branchId
      || next.carrierRef.carrierId !== before.carrierRef.carrierId
      || next.carrierRef.swipeId !== before.carrierRef.swipeId || next.revision < before.revision) {
      this.dispose();
      throw new Error('scope-changed');
    }
    this.latest = structuredClone(update);
    if (this.ready) this.send('update', { update: this.latest });
  }

  readonly dispose = (): void => {
    if (!this.active) return;
    this.active = false;
    this.ready = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.host.removeEventListener('message', this.receive);
    this.frame.removeEventListener('load', this.dispose);
    this.observer?.disconnect();
    this.observer = null;
    this.onChange();
  };
}
