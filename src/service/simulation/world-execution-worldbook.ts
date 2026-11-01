import {
  selectTriggeredWorldbookEntries_ACU,
  type AgentWorldbookEntryView_ACU,
  type AgentWorldbookSnapshot_ACU,
} from '../continuation/agent/agent-worldbook-read';
import {
  createWorldSimulationReadGateState_ACU,
  gateWorldSimulationReadBatch_ACU,
  type WorldSimulationReadGateConfig_ACU,
  type WorldSimulationReadRejectReason_ACU,
} from './agent/agent-read-gate';
import { countWorldSimulationTokens_ACU, type WorldSimulationTokenCounter_ACU } from './agent/agent-token-budget';

/** 单轮世界推演最多展示 64 条已确定命中的安全目录。 */
export const WORLD_EXECUTION_WORLDBOOK_DIRECTORY_LIMIT_ACU = 64;
/** 防止超大快照借 deferred 身份列表造成目录型内存放大。 */
export const WORLD_EXECUTION_WORLDBOOK_DEFERRED_LIMIT_ACU = 256;

export interface WorldExecutionWorldbookDirectoryEntry_ACU {
  bookName: string;
  uid: string;
  title: string;
  keys: readonly string[];
  /** 仅为目录提示，实际读取永远重新计数，不可作为预算依据。 */
  tokens: number;
}

export interface WorldExecutionWorldbookDeferredEntry_ACU {
  bookName: string;
  uid: string;
  reason: 'directory-limit';
}

const receiptBrand_ACU: unique symbol = Symbol('WorldExecutionWorldbookReceipt');
/** 不透明收据；有效性和冻结内容只保存在模块内 WeakMap。 */
export type WorldExecutionWorldbookReceipt_ACU = { readonly [receiptBrand_ACU]: true };

export type WorldExecutionWorldbookPrepareResult_ACU =
  | {
    allowed: true;
    receipt: WorldExecutionWorldbookReceipt_ACU;
    directory: readonly WorldExecutionWorldbookDirectoryEntry_ACU[];
    available: boolean;
    deferred: readonly WorldExecutionWorldbookDeferredEntry_ACU[];
  }
  | { allowed: false; reason: string };

export type WorldExecutionWorldbookReadResult_ACU =
  | { allowed: true; materials: AgentWorldbookEntryView_ACU[]; tokens: number }
  | { allowed: false; reason: string; tokens: number };

interface FrozenConfig_ACU {
  historyTokenBudget: number;
  readTokenBudget: number | string;
  fallbackTokens: number;
}

interface ReceiptState_ACU {
  available: boolean;
  config: FrozenConfig_ACU;
  directoryIds: ReadonlySet<string>;
  entriesById: ReadonlyMap<string, AgentWorldbookEntryView_ACU>;
  /** 同一 requestKey 的读取可复用被冻结的正文；不会重新计数、扩大引用或消耗业务读取许可。 */
  completedRequests: Map<string, { refs: string; materials: AgentWorldbookEntryView_ACU[]; tokens: number }>;
  /** 在任何 await 之前领取，避免同一个 requestKey 的并发/重复读取。 */
  claimedRequests: Set<string>;
}

const receiptStates_ACU = new WeakMap<WorldExecutionWorldbookReceipt_ACU, ReceiptState_ACU>();

function identityKey_ACU(bookName: string, uid: string): string {
  return JSON.stringify([bookName, uid]);
}

function freezeEntry_ACU(entry: AgentWorldbookEntryView_ACU): AgentWorldbookEntryView_ACU {
  const copy: AgentWorldbookEntryView_ACU = {
    bookName: entry.bookName,
    uid: entry.uid,
    title: entry.title,
    keys: [...entry.keys],
    constant: entry.constant,
    preventRecursion: entry.preventRecursion === true,
    excludeRecursion: entry.excludeRecursion === true,
    content: entry.content,
    tokens: entry.tokens,
  };
  Object.freeze(copy.keys);
  return Object.freeze(copy);
}

function cloneSnapshotEntries_ACU(snapshot: AgentWorldbookSnapshot_ACU): { entries: AgentWorldbookEntryView_ACU[] } | { reason: string } {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.entries)) return { reason: 'worldbook-snapshot-invalid' };
  let cloned: AgentWorldbookEntryView_ACU[];
  try {
    cloned = structuredClone(snapshot.entries);
  } catch {
    return { reason: 'worldbook-snapshot-invalid' };
  }
  const identities = new Set<string>();
  const entries: AgentWorldbookEntryView_ACU[] = [];
  for (const entry of cloned) {
    if (!entry || typeof entry !== 'object' || typeof entry.bookName !== 'string' || !entry.bookName
      || typeof entry.uid !== 'string' || !entry.uid || typeof entry.title !== 'string'
      || !Array.isArray(entry.keys) || !entry.keys.every(key => typeof key === 'string')
      || typeof entry.constant !== 'boolean' || typeof entry.content !== 'string') {
      return { reason: 'worldbook-snapshot-invalid' };
    }
    const key = identityKey_ACU(entry.bookName, entry.uid);
    if (identities.has(key)) return { reason: 'worldbook-snapshot-duplicate-identity' };
    identities.add(key);
    entries.push(freezeEntry_ACU(entry));
  }
  return { entries };
}

function cloneFrozenConfig_ACU(config: WorldSimulationReadGateConfig_ACU): FrozenConfig_ACU | null {
  if (!config || typeof config !== 'object' || !Number.isFinite(config.historyTokenBudget)
    || !Number.isFinite(config.fallbackTokens)) return null;
  const readBudget = config.readTokenBudget;
  if (!(typeof readBudget === 'number' && Number.isFinite(readBudget)) && typeof readBudget !== 'string') return null;
  return Object.freeze({
    historyTokenBudget: config.historyTokenBudget,
    readTokenBudget: readBudget,
    fallbackTokens: config.fallbackTokens,
  });
}

function sameConfig_ACU(config: WorldSimulationReadGateConfig_ACU, frozen: FrozenConfig_ACU): boolean {
  return !!config && config.historyTokenBudget === frozen.historyTokenBudget
    && config.readTokenBudget === frozen.readTokenBudget && config.fallbackTokens === frozen.fallbackTokens;
}

function strictCounter_ACU(count: WorldSimulationTokenCounter_ACU): WorldSimulationTokenCounter_ACU {
  return async text => {
    const tokens = await count(text);
    // 0 / NaN / Infinity 都不能把正文当作「免费」内容放行。
    if (!Number.isFinite(tokens) || tokens <= 0) throw new Error('WORLD_EXECUTION_WORLDBOOK_TOKEN_COUNT_INVALID');
    return Math.ceil(tokens);
  };
}

async function gateItems_ACU(
  items: ReadonlyArray<{ label: string; text: string }>, config: FrozenConfig_ACU,
  count: WorldSimulationTokenCounter_ACU,
): Promise<{ allowed: true; tokens: number } | { allowed: false; reason: string; tokens: number }> {
  try {
    // 每次目录核验和每次正文请求都使用独立 state，收据不会携带可累积的额度。
    const decision = await gateWorldSimulationReadBatch_ACU(items, createWorldSimulationReadGateState_ACU(), config, 0, strictCounter_ACU(count));
    if (!decision.allowed) return { allowed: false, reason: decision.reason ?? 'worldbook-read-denied', tokens: decision.batchTokens };
    return { allowed: true, tokens: decision.batchTokens };
  } catch {
    return { allowed: false, reason: 'worldbook-token-count-invalid', tokens: 0 };
  }
}

function directoryEntry_ACU(entry: AgentWorldbookEntryView_ACU): WorldExecutionWorldbookDirectoryEntry_ACU {
  return Object.freeze({
    bookName: entry.bookName,
    uid: entry.uid,
    title: entry.title,
    keys: Object.freeze([...entry.keys]),
    // 快照的 metadata 可以不精确；正文 gate 始终使用重新计数的真实文本。
    tokens: Number.isFinite(entry.tokens) && entry.tokens >= 0 ? entry.tokens : 0,
  });
}

/**
 * 从「已启用世界书快照 + 既有 selector」准备本轮有限目录。
 * 这不是宿主 trigger 采集：命中仅来自预取快照与确定性 selector，全文一律是不可信背景。
 */
export async function prepareWorldExecutionWorldbook_ACU(
  snapshot: AgentWorldbookSnapshot_ACU,
  scanText: string,
  config: WorldSimulationReadGateConfig_ACU,
  count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU,
  loreRefs: readonly string[] = [],
): Promise<WorldExecutionWorldbookPrepareResult_ACU> {
  const frozenConfig = cloneFrozenConfig_ACU(config);
  if (!frozenConfig) return { allowed: false, reason: 'worldbook-read-config-invalid' };
  const cloned = cloneSnapshotEntries_ACU(snapshot);
  if ('reason' in cloned) return { allowed: false, reason: cloned.reason };

  const receipt = Object.freeze({ [receiptBrand_ACU]: true as const });
  if (snapshot.available !== true) {
    receiptStates_ACU.set(receipt, {
      available: false, config: frozenConfig, directoryIds: new Set(), entriesById: new Map(), completedRequests: new Map(), claimedRequests: new Set(),
    });
    // unavailable 不是「已知为空」；收据存在只为了把该状态明确传递给 read。
    return { allowed: true, receipt, available: false, directory: Object.freeze([]), deferred: Object.freeze([]) };
  }

  const triggered = selectTriggeredWorldbookEntries_ACU(cloned.entries, String(scanText ?? ''));
  // 显式 loreRefs 只能精确指向已启用快照的 bookName/uid；不改变 constant、递归触发或精读权限。
  const explicitRefs = new Set(loreRefs.filter(ref => typeof ref === 'string'));
  const hitIds = new Set(triggered.map(entry => identityKey_ACU(entry.bookName, entry.uid)));
  // 冒号地址遇到书名/uid 自带冒号时可能碰撞；歧义地址不能授权多个条目，JSON tuple 仍可精确指定。
  const addressCounts = new Map<string, number>();
  for (const entry of cloned.entries) {
    const address = `${entry.bookName}:${entry.uid}`;
    addressCounts.set(address, (addressCounts.get(address) ?? 0) + 1);
  }
  const hits = cloned.entries.filter(entry => {
    const identity = identityKey_ACU(entry.bookName, entry.uid);
    const address = `${entry.bookName}:${entry.uid}`;
    return hitIds.has(identity) || explicitRefs.has(identity)
      || (addressCounts.get(address) === 1 && (explicitRefs.has(address) || explicitRefs.has(`$WORLDBOOK:${address}`)));
  });
  if (hits.length > WORLD_EXECUTION_WORLDBOOK_DIRECTORY_LIMIT_ACU + WORLD_EXECUTION_WORLDBOOK_DEFERRED_LIMIT_ACU) {
    return { allowed: false, reason: 'worldbook-deferred-identities-too-many' };
  }
  const selected = hits.slice(0, WORLD_EXECUTION_WORLDBOOK_DIRECTORY_LIMIT_ACU);
  const directory = Object.freeze(selected.map(directoryEntry_ACU));
  // 目录本身也必须经过 read gate；绝不借 tokens metadata 替代实际计数。
  const directoryGate = await gateItems_ACU(directory.map(item => ({ label: identityKey_ACU(item.bookName, item.uid), text: JSON.stringify(item) })), frozenConfig, count);
  if (directoryGate.allowed === false) return { allowed: false, reason: directoryGate.reason };

  const entriesById = new Map<string, AgentWorldbookEntryView_ACU>();
  for (const entry of selected) entriesById.set(identityKey_ACU(entry.bookName, entry.uid), entry);
  const deferred = Object.freeze(hits.slice(WORLD_EXECUTION_WORLDBOOK_DIRECTORY_LIMIT_ACU)
    .map(entry => Object.freeze({ bookName: entry.bookName, uid: entry.uid, reason: 'directory-limit' as const })));
  receiptStates_ACU.set(receipt, {
    available: true,
    config: frozenConfig,
    directoryIds: new Set(entriesById.keys()),
    entriesById,
    completedRequests: new Map(),
    claimedRequests: new Set(),
  });
  return { allowed: true, receipt, available: true, directory, deferred };
}

/**
 * 精读已签发目录中的一个子集。正文只作为不可信背景；本模块不执行其指令，亦不写账本、解锁事实或人物 knownFacts。
 */
export async function readWorldExecutionWorldbook_ACU(
  receipt: WorldExecutionWorldbookReceipt_ACU,
  refs: readonly { bookName: string; uid: string }[],
  requestKey: string,
  config: WorldSimulationReadGateConfig_ACU,
  count: WorldSimulationTokenCounter_ACU = countWorldSimulationTokens_ACU,
): Promise<WorldExecutionWorldbookReadResult_ACU> {
  const saved = receipt && typeof receipt === 'object' ? receiptStates_ACU.get(receipt) : undefined;
  if (!saved) return { allowed: false, reason: 'worldbook-receipt-invalid', tokens: 0 };
  if (!saved.available) return { allowed: false, reason: 'worldbook-snapshot-unavailable', tokens: 0 };
  if (!sameConfig_ACU(config, saved.config)) return { allowed: false, reason: 'worldbook-read-config-mismatch', tokens: 0 };
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref || typeof ref.bookName !== 'string' || typeof ref.uid !== 'string') {
      return { allowed: false, reason: 'worldbook-refs-invalid', tokens: 0 };
    }
    const key = identityKey_ACU(ref.bookName, ref.uid);
    if (seen.has(key)) return { allowed: false, reason: 'worldbook-refs-duplicate', tokens: 0 };
    if (!saved.directoryIds.has(key)) return { allowed: false, reason: 'worldbook-ref-not-in-directory', tokens: 0 };
    seen.add(key);
    keys.push(key);
  }

  const refsKey = JSON.stringify(keys);
  const completed = saved.completedRequests.get(requestKey);
  if (completed) {
    if (completed.refs !== refsKey) return { allowed: false, reason: 'worldbook-request-already-claimed', tokens: 0 };
    return { allowed: true, materials: completed.materials.map(entry => structuredClone(entry)), tokens: completed.tokens };
  }
  const cached = [...saved.completedRequests.values()].find(item => item.refs === refsKey);
  if (cached) {
    saved.completedRequests.set(requestKey, cached);
    return { allowed: true, materials: cached.materials.map(entry => structuredClone(entry)), tokens: cached.tokens };
  }
  if (saved.claimedRequests.has(requestKey)) return { allowed: false, reason: 'worldbook-request-already-claimed', tokens: 0 };
  // 先领取再 await，确保并发调用与不同 selection 不能借同一 requestKey 获得第二次读取。
  saved.claimedRequests.add(requestKey);
  const materials = keys.map(key => saved.entriesById.get(key)!);
  const decision = await gateItems_ACU(materials.map(entry => ({ label: identityKey_ACU(entry.bookName, entry.uid), text: entry.content })), saved.config, count);
  if (decision.allowed === false) return { allowed: false, reason: decision.reason, tokens: decision.tokens };
  const frozenMaterials = materials.map(entry => structuredClone(entry));
  saved.completedRequests.set(requestKey, { refs: refsKey, materials: frozenMaterials, tokens: decision.tokens });
  return { allowed: true, materials: frozenMaterials.map(entry => structuredClone(entry)), tokens: decision.tokens };
}

export type { WorldSimulationReadGateConfig_ACU, WorldSimulationReadRejectReason_ACU };
