import { assertZeroLayerCarrier_ACU } from './carrier-context';
import { readOrdinaryZeroLayerState_ACU } from './ordinary-state';
import { bindZeroLayerPromptContext_ACU, onZeroLayerTemplateReady_ACU } from './request-context';
import { buildZeroLayerTimeline_ACU, projectZeroLayerPromptHistory_ACU, getPublishedZeroLayerPath_ACU } from './timeline';
import { ZeroLayerError_ACU } from './model';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import type { InterceptedHostRequest_ACU } from '../../data/gateways/host-generation-interceptor';

const boundRequests_ACU = new WeakSet<object>();
const permits_ACU = new Map<string, { fingerprint: string; assertCurrent: () => void }>();
const requestLeases_ACU = new Map<string, symbol>();
let permitEpoch_ACU = 0;

/** 撤销已准备和仍在模板处理中的凭据；不保存请求正文。 */
export function invalidateOrdinaryZeroLayerRequests_ACU(): void {
  permitEpoch_ACU += 1;
  permits_ACU.clear();
  requestLeases_ACU.clear();
}

/** 只消费本请求的成功装配凭据；不修改请求体，不替代宿主传输。 */
export function assertOrdinaryZeroLayerRequest_ACU(
  request: Pick<InterceptedHostRequest_ACU, 'bodyText' | 'signal'>, allowActive = false,
): void {
  const state = readOrdinaryZeroLayerState_ACU(allowActive);
  if (!state) return;
  const permit = permits_ACU.get(state.context.key);
  permits_ACU.delete(state.context.key);
  if (request.signal?.aborted || !permit || request.bodyText === null) {
    throw new ZeroLayerError_ACU('history-unavailable', '普通请求尚未完成归档与模板装配，禁止发送。');
  }
  let payload: unknown;
  try { payload = JSON.parse(request.bodyText); }
  catch { throw new ZeroLayerError_ACU('corrupt-data', '普通请求不是已确认的 JSON 请求。'); }
  if (!payload || typeof payload !== 'object' || !('messages' in payload)
    || !Array.isArray(payload.messages)
    || sha256HexSync_ACU(JSON.stringify(payload.messages)) !== permit.fingerprint) {
    throw new ZeroLayerError_ACU('revision-conflict', '普通请求消息与成功装配快照不一致，禁止发送。');
  }
  try {
    permit.assertCurrent();
  } finally {
    // 一次消费后撤销原请求租约，迟到回调不能重新登记发送资格。
    requestLeases_ACU.delete(state.context.key);
  }
}

/** 只改本次提示词；宿主的物理历史及发送路径不变。 */
export function bindOrdinaryZeroLayerContext_ACU(request: Record<string, unknown>, allowActive = false): void {
  const state = readOrdinaryZeroLayerState_ACU(allowActive);
  if (!state || boundRequests_ACU.has(request)) return;
  const { context, envelope } = state;
  permits_ACU.delete(context.key);
  const lease = Symbol();
  requestLeases_ACU.set(context.key, lease);
  const epoch = permitEpoch_ACU;
  if (!Array.isArray(request.messages)) throw new ZeroLayerError_ACU('history-unavailable', '普通请求缺少可绑定的消息数组。');
  const messages = request.messages as Record<string, unknown>[];
  const target = context.chat[envelope.exitManifest!.target.messageIndex] as Record<string, unknown>;
  // 只接受宿主保留的唯一接入正文；裁剪、合并或改写后不猜测插入位置。
  const anchors = messages.flatMap((message, index) => message?.role === 'assistant'
    && message.content === target.mes && message.injected !== true ? [index] : []);
  if (anchors.length !== 1) throw new ZeroLayerError_ACU('history-unavailable', '普通提示词缺少唯一退出接入点，请恢复上下文范围后再生成。');
  const timeline = buildZeroLayerTimeline_ACU(envelope,
    context.chat.slice(0, envelope.activationMessageCount) as Record<string, unknown>[]);
  const history = [...projectZeroLayerPromptHistory_ACU(timeline),
    ...context.chat.slice(envelope.activationMessageCount).map(value => {
      const message = value as Record<string, unknown>;
      return { mes: message.mes, is_user: message.is_user === true, is_system: message.is_system === true,
        ...Object.fromEntries(['qrf_plot', 'qrf_plot_tasks', 'qrf_plot_preset'].filter(key => message[key] !== undefined)
          .map(key => [key, structuredClone(message[key])])) };
    })];
  const assertCurrent = () => {
    if (epoch !== permitEpoch_ACU || requestLeases_ACU.get(context.key) !== lease) {
      throw new ZeroLayerError_ACU('scope-changed', '普通请求已停止、被新请求替代或聊天租约已撤销。');
    }
    assertZeroLayerCarrier_ACU(context);
    const current = readOrdinaryZeroLayerState_ACU();
    if (!current || JSON.stringify(current.envelope) !== JSON.stringify(envelope)) {
      throw new ZeroLayerError_ACU('revision-conflict', '普通请求的退出归档已变化。');
    }
  };
  assertCurrent();
  const archive = getPublishedZeroLayerPath_ACU(envelope).flatMap(turn => [
    { role: 'user', content: turn.input }, { role: 'assistant', content: turn.body! },
  ]);
  bindZeroLayerPromptContext_ACU(request, { history, assertCurrent });
  messages.splice(anchors[0] + 1, 0, ...archive);
  boundRequests_ACU.add(request);
  onZeroLayerTemplateReady_ACU(request, () => {
    assertCurrent();
    permits_ACU.set(context.key, {
      fingerprint: sha256HexSync_ACU(JSON.stringify(request.messages)), assertCurrent,
    });
  });
}
