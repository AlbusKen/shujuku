type WorldRoundMessage_ACU = { role?: unknown; content?: unknown };

const TOKENS_ACU = [
  'WORLD_TASK', 'WORLD_USER_REQUIREMENTS', 'ANCHOR_MESSAGE', 'WORLD_RUNTIME_CONTEXT',
  'WORLD_CHRONICLE', 'WORLD_TABLES', 'WORLDBOOK_CATALOG', 'WORLDBOOK_HITS', 'READ_BUDGET',
] as const;
type Token_ACU = typeof TOKENS_ACU[number];
type DynamicMaterials_ACU = Partial<Record<Token_ACU, unknown>>;

/**
 * 仅测试 mock 使用：从提示词段替换或末尾补齐的纯 user JSON 块严格提取阶段资料，
 * 重建旧 mock 所需的阶段 payload；生产代码绝不读取或兼容此旧形状。
 */
export function readWorldRoundPayload_ACU(messages: readonly WorldRoundMessage_ACU[]): Record<string, unknown> {
  const materials: DynamicMaterials_ACU = {};
  for (const message of messages) {
    if (message.role !== undefined && message.role !== 'user') continue;
    if (typeof message.content !== 'string') continue;
    let value: unknown;
    try { value = JSON.parse(message.content); } catch { continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const block = value as Record<string, unknown>;
    const keys = Object.keys(block);
    if (!keys.length || keys.some(key => !(TOKENS_ACU as readonly string[]).includes(key))) continue;
    for (const [key, item] of Object.entries(block)) {
      if (item === '资料已提供，请勿重复请求。') continue;
      materials[key as Token_ACU] = item;
    }
  }
  const task = materials.WORLD_TASK;
  const runtime = materials.WORLD_RUNTIME_CONTEXT;
  const taskRecord = task && typeof task === 'object' && !Array.isArray(task) ? task as Record<string, unknown> : {};
  const runtimeRecord = runtime && typeof runtime === 'object' && !Array.isArray(runtime) ? runtime as Record<string, unknown> : {};
  const requirements = materials.WORLD_USER_REQUIREMENTS;
  const requirementsRecord = requirements && typeof requirements === 'object' && !Array.isArray(requirements) ? requirements as Record<string, unknown> : {};
  const catalog = materials.WORLDBOOK_CATALOG;
  const catalogRecord = catalog && typeof catalog === 'object' && !Array.isArray(catalog) ? catalog as Record<string, unknown> : {};
  const actorMaterials = runtimeRecord.actorMaterials && typeof runtimeRecord.actorMaterials === 'object' && !Array.isArray(runtimeRecord.actorMaterials)
    ? runtimeRecord.actorMaterials as Record<string, unknown> : {};
  return {
    ...runtimeRecord,
    stage: taskRecord.stage,
    anchor: materials.ANCHOR_MESSAGE,
    worldTables: materials.WORLD_TABLES ?? [],
    context: { instruction: requirementsRecord.instruction ?? '', userRequirements: requirementsRecord.requirements ?? [] },
    ...(materials.WORLD_CHRONICLE === undefined ? {} : { actorMaterials: { ...actorMaterials, historyMilestones: materials.WORLD_CHRONICLE } }),
    ...(runtimeRecord.candidates === undefined ? {} : { candidates: runtimeRecord.candidates }),
    ...(catalogRecord.directory === undefined ? {} : { directory: catalogRecord.directory }),
    ...(materials.WORLDBOOK_CATALOG === undefined && materials.WORLDBOOK_HITS === undefined ? {} : { worldbook: { ...catalogRecord, materials: materials.WORLDBOOK_HITS ?? [] } }),
  };
}
