import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerBranch_ACU } from './model';
import { checkpointPath_ACU } from './checkpoint-payload';

/** lineage 只声明共享前缀；父链跨越未声明分支时拒绝，不改写任何回合身份。 */
export function validateBranchPath_ACU(source: ZeroLayerEnvelope_ACU, branch: ZeroLayerBranch_ACU): void {
  const fail = (): never => { throw new ZeroLayerError_ACU('corrupt-data', '分支共享前缀或 lineage 无效。'); };
  const fork = branch.fork;
  const index = source.branches.findIndex(item => item.branchId === branch.branchId);
  const path = checkpointPath_ACU(source, branch.branchId);
  let prefix: typeof path = [];
  if (fork !== undefined) {
    if (!fork || typeof fork !== 'object' || Array.isArray(fork)
      || !Number.isSafeInteger(fork.sourceRevision) || fork.sourceRevision < 0 || fork.sourceRevision >= source.revision
      || !Object.keys(fork).every(key => ['sourceBranchId', 'headTurnId', 'sourceRevision'].includes(key))) fail();
    const parentIndex = source.branches.findIndex(item => item.branchId === fork.sourceBranchId);
    if (parentIndex < 0 || parentIndex >= index) fail();
    const parentPath = checkpointPath_ACU(source, fork.sourceBranchId);
    const cut = fork.headTurnId === null ? -1 : parentPath.findIndex(turn => turn.turnId === fork.headTurnId);
    if (fork.headTurnId !== null && cut < 0) fail();
    prefix = parentPath.slice(0, cut + 1);
  }
  if (path.length < prefix.length || prefix.some((turn, at) => path[at]?.turnId !== turn.turnId)
    || path.slice(prefix.length).some(turn => turn.branchId !== branch.branchId)) fail();
  const own = new Set(source.turns.filter(turn => turn.branchId === branch.branchId).map(turn => turn.turnId));
  for (const turn of source.turns.filter(item => item.branchId === branch.branchId)) {
    if (turn.parentTurnId !== (fork?.headTurnId ?? null) && !own.has(turn.parentTurnId!)) fail();
  }
}

/** 当前读侧允许原分支的历史锚点，但写租约仍绑定当前 branch。 */
export function isReachableBranchAnchor_ACU(source: ZeroLayerEnvelope_ACU,
  branchId: string, headTurnId: string | null): boolean {
  const path = checkpointPath_ACU(source, source.activeBranchId);
  if (headTurnId !== null) return path.some(turn => turn.turnId === headTurnId)
    && source.branches.some(branch => branch.branchId === branchId
      && checkpointPath_ACU(source, branchId).some(turn => turn.turnId === headTurnId));
  let branch = source.branches.find(item => item.branchId === source.activeBranchId);
  while (branch) {
    if (branch.branchId === branchId) return true;
    branch = source.branches.find(item => item.branchId === branch!.fork?.sourceBranchId);
  }
  return false;
}
