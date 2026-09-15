export function renderWorldSimulationRequirementsRetryHint_ACU(pendingSourceIds: readonly string[]): string {
  const required = pendingSourceIds.length === 1
    ? `本轮 appliedUserMessageId 必须逐字复制：${JSON.stringify(pendingSourceIds[0])}`
    : `仍待吸收的用户输入 source id：${JSON.stringify(pendingSourceIds)}`;
  return `${required}\n在该列表清空前，只能输出一个完整 maintain_requirements JSON 对象。`;
}
