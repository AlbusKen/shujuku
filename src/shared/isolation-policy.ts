/**
 * 标签隔离（dataIsolationEnabled / dataIsolationCode）已退役。
 *
 * 未开启隔离时，聊天槽位键固定为 ''。这是合法的默认槽，不是“没有隔离键”。
 * 新功能禁止再用 `if (!isolationKey)` / `if (!key)` 当读写门禁——空串会被当成 falsy，
 * 导致交火索引指针写不进、删不掉（9.0 回归）。
 *
 * 只拒绝 null / undefined；空字符串必须放行。
 * 存量 IsolatedData[''] 与历史隔离码槽位仍按原键读写，本文件不删除旧数据路径。
 */
export const TAG_ISOLATION_FEATURE_RETIRED_ACU = true;

export function isUsableIsolationSlotKey_ACU(key: unknown): key is string {
    return typeof key === 'string';
}
