import { ZERO_LAYER_HISTORY_DEFAULT_LIMIT_ACU, ZERO_LAYER_HISTORY_MAX_LIMIT_ACU,
  type ZeroLayerHistoryQuery_ACU } from './history-model';
import { ZeroLayerHistoryReadError_ACU } from './history-errors';

/** 公开查询只接受版本、分页和回合身份；不能指定聊天、分支或私有读取模式。 */
export function validateZeroLayerHistoryQuery_ACU(raw: unknown, snapshotOnly = false): ZeroLayerHistoryQuery_ACU {
  const fail = (message: string): never => { throw new ZeroLayerHistoryReadError_ACU('invalid-query', message); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('历史查询必须为对象。');
  const query = raw as Record<string, unknown>;
  const allowed = snapshotOnly ? ['version'] : ['version', 'snapshotToken', 'cursor', 'direction', 'limit', 'turnId'];
  if (Object.keys(query).some(key => !allowed.includes(key))) fail('查询包含未授权字段。');
  if (query.version !== 1) throw new ZeroLayerHistoryReadError_ACU('unsupported-version', '只读历史接口仅支持版本 1。');
  for (const key of ['snapshotToken', 'cursor', 'turnId']) {
    if (query[key] !== undefined && (typeof query[key] !== 'string' || !(query[key] as string).trim())) {
      fail(`${key} 必须为非空字符串。`);
    }
  }
  if (query.direction !== undefined && query.direction !== 'older' && query.direction !== 'newer') fail('分页方向无效。');
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || Number(query.limit) < 1
    || Number(query.limit) > ZERO_LAYER_HISTORY_MAX_LIMIT_ACU)) fail('分页数量必须为 1 至 100 的整数。');
  if (query.turnId !== undefined && (query.cursor !== undefined || query.direction !== undefined || query.limit !== undefined)) {
    fail('回合详情不能与分页参数组合。');
  }
  return { ...query, version: 1, ...(snapshotOnly || query.turnId ? {} : {
    limit: query.limit ?? ZERO_LAYER_HISTORY_DEFAULT_LIMIT_ACU,
  }) } as ZeroLayerHistoryQuery_ACU;
}
