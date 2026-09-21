import type { AgentPendingFix_ACU } from '../../service/continuation/agent/agent-model';

const MODULE_LABELS_ACU: Record<AgentPendingFix_ACU['module'], string> = {
  hooks: '伏笔账本',
  infoGap: '信息差',
  constraints: '长期约束',
  storyArc: '故事总纲',
  chronology: '故事年代学',
  webRefs: '百科资料库',
  userRequirements: '用户要求',
};

export interface ContinuationPendingFixCard_ACU {
  module: AgentPendingFix_ACU['module'];
  title: string;
  attempts: number;
  detail: string;
  meta: string;
}

/** 空数组不产生卡片，资料面板据此整段隐藏。 */
export function buildContinuationPendingFixCards_ACU(fixes: readonly AgentPendingFix_ACU[] | null | undefined): ContinuationPendingFixCard_ACU[] {
  return (fixes ?? []).map(item => ({
    module: item.module,
    title: MODULE_LABELS_ACU[item.module] ?? item.module,
    attempts: item.attempts,
    detail: item.violations.map(violation => violation.message).filter(Boolean).join('；') || item.lastError,
    meta: `${item.agentName || '未记录角色'} · 第 ${item.attempts} 次 · 自楼层 ${item.firstFailedAtIndex} · ${item.lastError}`,
  }));
}
