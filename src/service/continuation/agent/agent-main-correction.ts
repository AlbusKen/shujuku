/** 主会话纠正：领域 SQL 沿用逐栏提交；追溯边界单独保存，不推进结算水位。 */
import type { AgentConversationSnapshot_ACU, AgentCorrectMaterialsAction_ACU, AgentModuleSnapshot_ACU, AgentPendingFix_ACU } from './agent-model';
import { commitAgentModuleFieldWrites_ACU, type AgentModuleFieldReceipt_ACU } from './agent-module-field-commit';
import { captureAgentModuleCommitBaseline_ACU, readAgentModuleFoldState_ACU, writeAgentModuleCommitDelta_ACU } from './agent-module-store';
import { agentStoryEvidenceFloorIndexes_ACU } from './agent-placeholder-resolver';
import { readMessageSwipeId_ACU } from './agent-module-frame';

export function renderAgentCorrectionGuide_ACU(conversation: AgentConversationSnapshot_ACU, snapshot: AgentModuleSnapshot_ACU): string {
  const users = conversation.messages.filter(message => message.kind === 'user');
  const user = users[users.length - 1];
  return [
    '【主会话纠正权限】可用 correct_materials 的 sql 直接纠正 hooks、info_gap、chronology、story_arc；按正文证据和当前修订号提交，只有 committed 回执证明保存。不能写用户要求、结算水位或其它表。',
    '用户明确要求跳过旧历史、从指定 AI 楼层开始时，单独给 settlementStartIndex（包含该楼）、userMessageId 与 reason。不得仅因容量失败自行跳过。旧缺口保留为跳过记录，不算已结算；成功后再 open_round，不重发同一超限范围。',
    `最新真实用户消息 ID：${user?.id ?? '无'}；模块修订号：${JSON.stringify(snapshot.revisions)}。`,
    snapshot.settlementBoundary ? `当前追溯起点：${snapshot.settlementBoundary.startIndex}；此前历史未结算。` : '',
  ].filter(Boolean).join('\n');
}

/** 只按回执确认为已保存的同一条目、同一栏目清除字段拒绝，不能用无关成功清空模块。 */
function repairedPending_ACU(fixes: AgentPendingFix_ACU[], receipt: AgentModuleFieldReceipt_ACU): AgentPendingFix_ACU[] {
  const confirmed = new Set([...receipt.accepted, ...(receipt.alreadySaved ?? [])].map(item => `${item.module}#${item.id}.${item.field}`));
  return fixes.flatMap(fix => {
    if (fix.source !== 'transaction_rejected' && fix.source !== 'contract_rejected') return [fix];
    const violations = fix.violations.filter(issue => !confirmed.has(issue.path));
    return violations.length === fix.violations.length ? [fix] : violations.length ? [{ ...fix, violations }] : [];
  });
}

export async function correctAgentMaterials_ACU(input: {
  action: AgentCorrectMaterialsAction_ACU;
  chat: any[];
  conversation: AgentConversationSnapshot_ACU;
  isCurrent: () => boolean;
  completedStages: readonly number[];
}) {
  const { action, chat } = input;
  let sqlReceipt: AgentModuleFieldReceipt_ACU | undefined;
  const reject = (reason: string) => ({ status: 'rejected' as const, reason, ...(sqlReceipt ? { sqlReceipt } : {}) });
  const targetIndex = chat.length - 1;
  const target = chat[targetIndex];
  const dispatchTarget = { message: target, swipeId: readMessageSwipeId_ACU(target), content: target?.mes };
  const current = () => input.isCurrent() && chat.length - 1 === targetIndex
    && chat[targetIndex] === target && readMessageSwipeId_ACU(target) === dispatchTarget.swipeId;
  if (!current() || !agentStoryEvidenceFloorIndexes_ACU(chat).has(targetIndex)) return reject('当前聊天或承载正文楼层不可用');
  let folded = readAgentModuleFoldState_ACU(chat);
  if (folded.salvaged || folded.candidates.some(item => !item.valid)) return reject('资料帧损坏，不能在抢救结果上纠正');
  if (action.settlementStartIndex !== undefined) {
    const users = input.conversation.messages.filter(message => message.kind === 'user');
    const user = users[users.length - 1];
    if (!user || user.id !== action.userMessageId) return reject('追溯起点必须依据最新真实用户消息');
    if (!agentStoryEvidenceFloorIndexes_ACU(chat).has(action.settlementStartIndex)) return reject('追溯起点必须是已存在的 AI 正文楼层');
    if (action.settlementStartIndex < (folded.snapshot.settlementBoundary?.startIndex ?? 0)) return reject('不能把已跳过历史隐式恢复为待结算，请先明确恢复范围');
  }
  if (action.sql) {
    sqlReceipt = await commitAgentModuleFieldWrites_ACU({ chat, targetIndex, dispatchTarget,
      sql: action.sql, role: 'main', completedStages: input.completedStages, isCurrent: current });
    if (sqlReceipt.status !== 'committed') return { status: sqlReceipt.status, sqlReceipt };
    folded = readAgentModuleFoldState_ACU(chat);
    if (!current() || folded.salvaged || folded.candidates.some(item => !item.valid)) return reject('纠正后权威资料状态无法确认');
  }
  const before = folded.snapshot;
  const now = Date.now();
  let pendingFixes = sqlReceipt ? repairedPending_ACU(before.pendingFixes, sqlReceipt) : before.pendingFixes;
  let settlementBoundary = before.settlementBoundary;

  if (action.settlementStartIndex !== undefined) {
    const startIndex = action.settlementStartIndex;
    const skipped = [...(settlementBoundary?.skippedPendingFixes ?? [])];
    const active: AgentPendingFix_ACU[] = [];
    for (const fix of pendingFixes) {
      if (!['hooks', 'infoGap', 'chronology'].includes(fix.module) || fix.rangeStartIndex < 0 || fix.rangeStartIndex >= startIndex) {
        active.push(fix); continue;
      }
      const historical = { ...fix, rangeEndIndex: Math.min(fix.rangeEndIndex, startIndex - 1) };
      if (!skipped.some(item => JSON.stringify(item) === JSON.stringify(historical))) skipped.push(historical);
      if (fix.rangeEndIndex >= startIndex) active.push({ ...fix, rangeStartIndex: startIndex });
    }
    if (skipped.length > 128) return reject('跳过记录超过可保存上限，未改变追溯起点');
    pendingFixes = active;
    settlementBoundary = { startIndex, userMessageId: action.userMessageId!, reason: action.reason, updatedAt: now, skippedPendingFixes: skipped };
  }
  const changed = JSON.stringify(pendingFixes) !== JSON.stringify(before.pendingFixes)
    || JSON.stringify(settlementBoundary) !== JSON.stringify(before.settlementBoundary);
  if (!changed) return { status: 'committed' as const, sqlReceipt, settlementBoundary };
  const baseline = captureAgentModuleCommitBaseline_ACU(chat);
  const result = await writeAgentModuleCommitDelta_ACU(chat, targetIndex, {
    writes: {}, revisions: {}, pendingFixes,
    ...(settlementBoundary ? { settlementBoundary } : {}),
  }, now, readback => !readback.salvaged && readback.candidates.every(item => item.valid)
    && readback.snapshot.settledThroughIndex === Math.max(0, before.settledThroughIndex)
    && JSON.stringify(readback.snapshot.pendingFixes) === JSON.stringify(pendingFixes)
    && JSON.stringify(readback.snapshot.settlementBoundary) === JSON.stringify(settlementBoundary), baseline, current);
  return { ...result, sqlReceipt,
    ...(result.status === 'committed' ? { settlementBoundary, pendingFixes } : {}),
  };
}
