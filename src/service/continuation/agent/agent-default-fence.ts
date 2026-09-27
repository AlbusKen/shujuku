/**
 * service/continuation/agent/agent-default-fence.ts — 60% 默认上围栏的范围解析
 *
 * 方案契约（fixed-workflow-material-injection-optimization §2.3）：
 * - 未显式提供 requestedFence 时，默认上围栏预算 =（max_tokens - 最终请求已占用）× 60%，向下取整；
 * - 预算只是地址适配器的解析输入：适配器在自身坐标系内解析默认读取范围并生成 resolvedFence；
 * - 预算不是正文截断阈值；resolvedFence 内的正文必须完整、逐字返回；
 * - 连最小范围都容纳不下时 fail-closed，由批次层整批拒绝且不消耗成功读取额度。
 *
 * 本函数只处理连续整数坐标的地址（故事区间、表格行等）。字符串 ID 坐标的地址
 * 由调用方把 ID 列表长度映射为整数上界后复用；token 预算禁止直接写入字符串坐标。
 */

import type { AgentReadFence_ACU, AgentReadFenceProof_ACU } from './agent-model';
import type { AgentReadAddressAxis_ACU } from './agent-placeholder-resolver';
import type { TokenCounter_ACU } from './agent-token-budget';

export type AgentDefaultReadFenceOutcome_ACU =
  | { status: 'resolved'; upper: number; measuredTokens: number }
  | { status: 'exhausted'; measuredTokens: number };

/**
 * 在 [lower, naturalUpper] 内二分出预算可容纳的最大上界。
 * measure(upper) 必须返回完整解析 [lower, upper] 所得正文的 token 数；
 * 计量单调递增时返回值是最大可容纳范围，非单调时仍保证返回值的实测 token 不超预算。
 */
export async function resolveAgentDefaultReadFenceUpper_ACU(input: {
  lower: number;
  naturalUpper: number;
  budgetTokens: number;
  measure: (upper: number) => Promise<number>;
}): Promise<AgentDefaultReadFenceOutcome_ACU> {
  if (!Number.isSafeInteger(input.lower) || !Number.isSafeInteger(input.naturalUpper)
    || input.naturalUpper < input.lower
    || !Number.isSafeInteger(input.budgetTokens) || input.budgetTokens <= 0) {
    throw new Error('READ_FENCE_CAPACITY_INVALID');
  }
  const probe = async (upper: number): Promise<number> => {
    const measured = await input.measure(upper);
    if (!Number.isFinite(measured) || measured < 0) throw new Error('READ_FENCE_CAPACITY_INVALID');
    return measured;
  };
  let bestTokens = await probe(input.lower);
  if (bestTokens > input.budgetTokens) return { status: 'exhausted', measuredTokens: bestTokens };
  let lo = input.lower;
  let hi = input.naturalUpper;
  let best = input.lower;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    const measured = await probe(mid);
    if (measured <= input.budgetTokens) {
      best = mid;
      bestTokens = measured;
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { status: 'resolved', upper: best, measuredTokens: bestTokens };
}

/** 一条已完整解析、未显式提供上围栏的读取候选。 */
export interface AgentDefaultFenceCandidate_ACU {
  /** 模型请求的原始地址。 */
  key: string;
  /** 模型给出的 requestedFence（此处至多含 lower）；收窄后的地址仍须通过同一包含校验。 */
  requestedFence?: AgentReadFence_ACU;
  title: string;
  /** 原地址完整解析所得正文（不含分节标题）。 */
  text: string;
}

/** 按默认上围栏放行的一条读取。未收窄时 address 即原地址、text 即原正文。 */
export interface AgentDefaultFenceRead_ACU {
  key: string;
  address: string;
  title: string;
  text: string;
  /** 收窄后子范围的围栏证明；未收窄时沿用调用方已有的证明，此处省略。 */
  proof?: AgentReadFenceProof_ACU;
  /** 收窄时原地址中未读取部分的稳定地址；供模型改读剩余部分，也供重复请求原地址时如实提示。 */
  remainder?: string;
  tokens: number;
  narrowed: boolean;
}

export interface AgentDefaultFenceFailure_ACU {
  key: string;
  reason: 'default-fence-budget-unavailable' | 'default-fence-exhausted' | 'default-fence-proof-invalid';
  message: string;
  details: Record<string, unknown>;
}

export type AgentDefaultFenceAllocation_ACU =
  | { status: 'resolved'; reads: AgentDefaultFenceRead_ACU[] }
  | { status: 'failed'; failures: AgentDefaultFenceFailure_ACU[] };

class AgentDefaultFenceProofError_ACU extends Error {
  constructor(readonly failure: AgentDefaultFenceFailure_ACU) {
    super(failure.message);
  }
}

/**
 * 在一个读取批次内分配 60% 默认上围栏预算。
 *
 * - 全部候选完整正文加上批次内其他资料（reservedTokens）不超预算时原样放行，不收窄；
 * - 否则先为原子地址保留完整正文、为可收窄地址保留其最小可证明范围；连这一底线都放不下时整批失败；
 * - 可收窄地址按请求顺序依次取得「预算 − 已分配 − 后续地址最小范围」内的最大前缀子范围；
 * - 收窄后的地址重新走地址适配器解析，stableAddress 必须等于收窄地址且 completeWithinFence 成立，
 *   注入的是该子范围的完整逐字正文，并在正文前如实标注原地址、预算与 resolvedFence。
 * 任何失败都不返回部分结果，由批次层整批拒绝且不消耗成功读取额度。
 */
export async function allocateAgentDefaultReadFences_ACU(input: {
  candidates: readonly AgentDefaultFenceCandidate_ACU[];
  budgetTokens: number | undefined;
  reservedTokens: number;
  axis: (key: string) => AgentReadAddressAxis_ACU | null;
  resolve: (address: string, requestedFence?: AgentReadFence_ACU) => { title: string; text: string; status?: 'failed'; proof?: AgentReadFenceProof_ACU };
  count: TokenCounter_ACU;
}): Promise<AgentDefaultFenceAllocation_ACU> {
  const { candidates } = input;
  if (!candidates.length) return { status: 'resolved', reads: [] };
  const budget = input.budgetTokens;
  // 预算为 0 表示同一模型回合内已被前序批次用尽，按 exhausted 报告；缺失或非法才是 unavailable。
  if (budget === undefined || !Number.isSafeInteger(budget) || budget < 0
    || !Number.isSafeInteger(input.reservedTokens) || input.reservedTokens < 0) {
    return {
      status: 'failed',
      failures: candidates.map(candidate => ({
        key: candidate.key,
        reason: 'default-fence-budget-unavailable',
        message: `地址「${candidate.key}」未提供上围栏，但本次请求的默认上围栏预算不可用，无法解析默认读取范围；整批未注入、未消耗读取额度。`,
        details: { budgetTokens: budget ?? null, reservedTokens: input.reservedTokens },
      })),
    };
  }
  const measure = async (title: string, address: string, text: string): Promise<number> => {
    const tokens = await input.count(`### ${title}（${address}）\n${text}`);
    if (!Number.isFinite(tokens) || tokens < 0) throw new Error('READ_FENCE_CAPACITY_INVALID');
    return tokens;
  };
  const full = await Promise.all(candidates.map(candidate => measure(candidate.title, candidate.key, candidate.text)));
  const fullRead = (index: number): AgentDefaultFenceRead_ACU => ({
    key: candidates[index].key,
    address: candidates[index].key,
    title: candidates[index].title,
    text: candidates[index].text,
    tokens: full[index],
    narrowed: false,
  });
  if (input.reservedTokens + full.reduce((sum, tokens) => sum + tokens, 0) <= budget) {
    return { status: 'resolved', reads: candidates.map((_, index) => fullRead(index)) };
  }

  const axes = candidates.map(candidate => {
    // 字符串坐标（世界书 uid、模块 ID）按列表位置取前缀，与显式下围栏的字典序语义不一致：
    // 收窄可能丢掉下围栏指名的条目而证明仍成立，因此带字符串下围栏的地址按原子地址处理。
    if (typeof candidate.requestedFence?.lower === 'string') return null;
    const axis = input.axis(candidate.key);
    return axis && Number.isSafeInteger(axis.length) && axis.length > 1 ? axis : null;
  });
  const narrowedCache = new Map<string, AgentDefaultFenceRead_ACU>();
  const narrowed = async (index: number, upper: number): Promise<AgentDefaultFenceRead_ACU> => {
    const cacheKey = `${index}:${upper}`;
    const cached = narrowedCache.get(cacheKey);
    if (cached) return cached;
    const candidate = candidates[index];
    const address = axes[index]!.addressAt(upper);
    const resolved = input.resolve(address, candidate.requestedFence);
    const proof = resolved.proof;
    if (resolved.status === 'failed' || !proof || proof.stableAddress !== address || proof.completeWithinFence !== true) {
      throw new AgentDefaultFenceProofError_ACU({
        key: candidate.key,
        reason: 'default-fence-proof-invalid',
        message: `地址「${candidate.key}」按默认上围栏解析出的子范围「${address}」无法证明完整，整批未注入、未消耗读取额度。`,
        details: { address, resolvedStatus: resolved.status ?? 'ok', proof: proof ?? null },
      });
    }
    const remainder = axes[index]!.remainderAfter(upper);
    const notice = `【默认上围栏】原地址「${candidate.key}」未提供上围栏，按默认上围栏预算 ${budget} tokens 解析为「${address}」（resolvedFence ${JSON.stringify(proof.resolvedFence)}，revision ${proof.revision}）。以下是该围栏内的完整逐字正文，未截断；围栏之外的部分本次未读取、未注入${remainder ? `，需要时请改读「${remainder}」` : ''}。`;
    const text = `${notice}\n${resolved.text}`;
    const read: AgentDefaultFenceRead_ACU = {
      key: candidate.key,
      address,
      title: resolved.title,
      text,
      proof,
      ...(remainder ? { remainder } : {}),
      tokens: await measure(resolved.title, address, text),
      narrowed: true,
    };
    narrowedCache.set(cacheKey, read);
    return read;
  };

  try {
    const minimum = await Promise.all(candidates.map(async (_, index) => (axes[index] ? (await narrowed(index, 0)).tokens : full[index])));
    const floor = input.reservedTokens + minimum.reduce((sum, tokens) => sum + tokens, 0);
    if (floor > budget) {
      return {
        status: 'failed',
        failures: candidates.map((candidate, index) => ({
          key: candidate.key,
          reason: 'default-fence-exhausted',
          message: `地址「${candidate.key}」未提供上围栏：默认上围栏预算 ${budget} tokens，本批其他资料已占 ${input.reservedTokens} tokens，各地址最小可证明范围合计 ${floor - input.reservedTokens} tokens（本地址 ${minimum[index]} tokens${axes[index] ? '' : '，不可再分'}），无法在预算内完整读取。整批未注入、未消耗读取额度；请改读更小的地址范围后重试。`,
          details: {
            budgetTokens: budget,
            reservedTokens: input.reservedTokens,
            remainingTokens: Math.max(0, budget - input.reservedTokens),
            measuredTokens: minimum[index],
            fullTokens: full[index],
            narrowable: axes[index] !== null,
          },
        })),
      };
    }

    let allocated = input.reservedTokens;
    let laterMinimum = 0;
    candidates.forEach((_, index) => {
      if (axes[index]) laterMinimum += minimum[index];
      else allocated += full[index];
    });
    const reads: AgentDefaultFenceRead_ACU[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const axis = axes[index];
      if (!axis) {
        reads.push(fullRead(index));
        continue;
      }
      laterMinimum -= minimum[index];
      const available = Math.floor(budget - allocated - laterMinimum);
      if (full[index] <= available) {
        reads.push(fullRead(index));
        allocated += full[index];
        continue;
      }
      const outcome = available > 0
        ? await resolveAgentDefaultReadFenceUpper_ACU({
          lower: 0,
          naturalUpper: axis.length - 2,
          budgetTokens: available,
          measure: async upper => (await narrowed(index, upper)).tokens,
        })
        : { status: 'exhausted' as const, measuredTokens: minimum[index] };
      if (outcome.status === 'exhausted') {
        return {
          status: 'failed',
          failures: [{
            key: candidates[index].key,
            reason: 'default-fence-exhausted',
            message: `地址「${candidates[index].key}」未提供上围栏：默认上围栏预算 ${budget} tokens 分配到本地址时仅余 ${Math.max(0, available)} tokens，最小可证明范围需要 ${outcome.measuredTokens} tokens。整批未注入、未消耗读取额度；请改读更小的地址范围后重试。`,
            details: {
              budgetTokens: budget,
              reservedTokens: input.reservedTokens,
              remainingTokens: Math.max(0, available),
              measuredTokens: outcome.measuredTokens,
              fullTokens: full[index],
              narrowable: true,
            },
          }],
        };
      }
      const read = await narrowed(index, outcome.upper);
      reads.push(read);
      allocated += read.tokens;
    }
    return { status: 'resolved', reads };
  } catch (error) {
    if (error instanceof AgentDefaultFenceProofError_ACU) return { status: 'failed', failures: [error.failure] };
    throw error;
  }
}
