import {
  installHostGenerationInterceptor_ACU,
  type InterceptedHostRequest_ACU,
} from '../../data/gateways/host-generation-interceptor';
import {
  assertResolvedPresetDirectTransport_ACU,
  callAIWithResolvedPreset_ACU,
  getApiConfigByPreset_ACU,
  requireResolvedApiPreset_ACU,
} from '../ai/api-call';
import { settings_ACU } from '../runtime/state-manager';

export interface ZeroLayerRequestLease_ACU {
  readonly signal: AbortSignal;
  readonly presetName: string;
  isCurrent(): boolean;
  /** 发送许可须在 dispatching 严格保存并回读后取得。 */
  beforeDispatch(): Promise<void>;
  /** 接收完整正文并完成保存；回调成功不意味着宿主可继续入楼。 */
  commitReply(body: string): Promise<void>;
  /** 仅展示累计正文；不取得保存或发布资格。 */
  preview?(body: string): void;
  endPreview?(): void;
  fail(error: unknown): Promise<void>;
}

export interface ZeroLayerRequestForwarderOptions_ACU {
  isActive(): boolean;
  beforeForward?(request: Pick<InterceptedHostRequest_ACU, 'bodyText' | 'signal'>): void;
  /** 必须同步认领本轮身份；独占期内返回 null 也会阻断原发送。 */
  claim(request: InterceptedHostRequest_ACU): ZeroLayerRequestLease_ACU | null;
}

/** 目的地与鉴权由数据库预设决定；其余字段（包括扩展生成字段）不裁剪。 */
const DATABASE_TRANSPORT_FIELDS_ACU = new Set([
  'messages', 'model', 'stream', 'chat_completion_source', 'custom_api_format',
  'reverse_proxy', 'proxy_password', 'custom_url', 'custom_include_headers',
  'custom_include_body', 'custom_exclude_body', 'custom_prompt_post_processing', 'preserve_multiple_system',
  'vertexai_auth_mode', 'vertexai_region', 'vertexai_express_project_id',
  'azure_base_url', 'azure_deployment_name', 'azure_api_version',
]);

const ZERO_LAYER_REQUEST_ID_ACU = '_acu_zero_layer_attempt_id';

function assertCurrent_ACU(lease: ZeroLayerRequestLease_ACU, signal?: AbortSignal | null): void {
  if (lease.signal.aborted || signal?.aborted || !lease.isCurrent()) {
    const error = new Error('零层回合已中止或聊天身份已变化。');
    error.name = 'AbortError';
    throw error;
  }
}

export function installZeroLayerRequestForwarder_ACU(options: ZeroLayerRequestForwarderOptions_ACU): () => void {
  return installHostGenerationInterceptor_ACU({
    isActive: options.isActive,
    beforeForward: options.beforeForward,
    rejectUnclaimed: true,
    claim(request) {
      const lease = options.claim(request);
      if (!lease) return null;
      // 预设与流式设置在认领时冻结，不在异步读取 body 后重新选渠道。
      try {
        const resolved = getApiConfigByPreset_ACU(lease.presetName);
        requireResolvedApiPreset_ACU(lease.presetName, resolved);
        const preset = { ...resolved, apiConfig: structuredClone(resolved.apiConfig) };
        assertResolvedPresetDirectTransport_ACU(preset);
        const streaming = settings_ACU.streamingEnabled === true;
        return () => forward_ACU(request, lease, preset, streaming);
      } catch (error) {
        return async () => { await lease.fail(error); throw error; };
      }
    },
  });
}

async function forward_ACU(
  request: InterceptedHostRequest_ACU,
  lease: ZeroLayerRequestLease_ACU,
  preset: ReturnType<typeof getApiConfigByPreset_ACU>,
  streaming: boolean,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  lease.signal.addEventListener('abort', abort, { once: true });
  request.signal?.addEventListener('abort', abort, { once: true });
  try {
    assertCurrent_ACU(lease, request.signal);
    const payload = await request.readPayload();
    assertCurrent_ACU(lease, request.signal);
    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      throw new Error('酒馆最终请求缺少消息，数据库未发送请求。');
    }
    // 现有 CHAT_COMPLETION_SETTINGS_READY 处理器已处理模板；这里只消费最终消息。
    const parameters = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(payload)) {
      if (!DATABASE_TRANSPORT_FIELDS_ACU.has(key) && key !== ZERO_LAYER_REQUEST_ID_ACU) parameters[key] = payload[key];
    }
    if (payload.stream !== undefined && typeof payload.stream !== 'boolean') {
      throw new Error('酒馆最终请求的 stream 字段无效，数据库未发送请求。');
    }
    const requestStreaming = payload.stream as boolean | undefined ?? streaming;
    // 在 durable dispatch 意图之前复核；非直发回退不能丢参数或重入正文拦截器。
    assertResolvedPresetDirectTransport_ACU(preset);
    await lease.beforeDispatch();
    assertCurrent_ACU(lease, request.signal);
    const body = await callAIWithResolvedPreset_ACU(
      payload.messages, preset, controller.signal, undefined,
      { generationParameters: parameters, streaming: requestStreaming, requireDirectTransport: true,
        onTextPreview: body => {
          if (!controller.signal.aborted && !lease.signal.aborted && lease.isCurrent()) lease.preview?.(body);
        },
      },
    );
    assertCurrent_ACU(lease, request.signal);
    if (typeof body !== 'string' || !body.trim()) throw new Error('数据库 API 未返回有效正文。');
    await lease.commitReply(body);
  } catch (error) {
    // 即使失败回调自身出错，也保留本次请求的原始失败，原发送不会放行。
    try { await lease.fail(error); } catch { /* 保存失败保持恢复状态，不放行原发送。 */ }
    throw error;
  } finally {
    lease.endPreview?.();
    lease.signal.removeEventListener('abort', abort);
    request.signal?.removeEventListener('abort', abort);
  }
}
