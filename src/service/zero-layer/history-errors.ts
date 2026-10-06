import { ZeroLayerError_ACU } from './model';
import type { ZeroLayerHistoryErrorCode_ACU, ZeroLayerHistoryResult_ACU } from './history-model';

export class ZeroLayerHistoryReadError_ACU extends Error {
  constructor(readonly code: ZeroLayerHistoryErrorCode_ACU, message: string) {
    super(message);
    this.name = 'ZeroLayerHistoryReadError_ACU';
  }
}

const recovery_ACU: Record<ZeroLayerHistoryErrorCode_ACU, [boolean, string]> = {
  'mode-disabled': [false, '由宿主显式启用零层模式。'],
  loading: [true, '等待聊天加载后重新读取。'],
  'not-ready': [true, '等待宿主完成零层装配或桥接恢复。'],
  'access-denied': [false, '由宿主重新授权当前只读作用域。'],
  'unsupported-version': [false, '使用受支持的接口或存档版本。'],
  'invalid-query': [false, '修正查询参数后重新读取。'],
  'not-found': [false, '选择当前快照内存在的回合。'],
  'storage-read-failed': [true, '由宿主检查存储并显式回读；读取接口不会自动恢复。'],
  'corrupt-data': [false, '由宿主检查损坏存档，禁止以空历史替代。'],
  'snapshot-stale': [true, '重新取得 snapshot 后重启分页。'],
  'scope-changed': [true, '在当前作用域重新取得 snapshot 和订阅。'],
  'history-unavailable': [false, '由宿主检查历史来源和可用恢复素材。'],
};

/** 不把上游错误载荷、凭据或私有日志透传至公开 Interface。 */
export function zeroLayerHistoryFailure_ACU<T>(error: unknown): ZeroLayerHistoryResult_ACU<T> {
  let code: ZeroLayerHistoryErrorCode_ACU = 'storage-read-failed';
  let message = '零层历史读取失败。';
  if (error instanceof ZeroLayerHistoryReadError_ACU) {
    code = error.code;
    message = error.message;
  } else if (error instanceof ZeroLayerError_ACU) {
    switch (error.code) {
      case 'mode-disabled': case 'scope-changed': case 'corrupt-data':
      case 'unsupported-version': case 'history-unavailable':
        code = error.code; break;
      case 'chat-unavailable': code = 'loading'; break;
      case 'carrier-unavailable': code = 'not-ready'; break;
      case 'source-changed': code = 'history-unavailable'; break;
      case 'revision-conflict': code = 'snapshot-stale'; break;
    }
    message = `零层历史读取被拒绝（${code}）。`;
  }
  const [retryable, recoveryAction] = recovery_ACU[code];
  return { ok: false, error: { code, message, retryable, recoveryAction } };
}
