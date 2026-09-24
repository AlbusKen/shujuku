import { WORLD_SIMULATION_RUN_WRITE_FIELD_ACU, type WorldChronicleArchiveSnapshot_ACU, type WorldSimulationAnchorIdentity_ACU, type WorldSimulationCandidate_ACU } from './agent/agent-model';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldSimulationLedger_ACU, type WorldSimulationLedgerFieldSnapshot_ACU, type WorldSimulationRunIdentity_ACU } from './model';
import { buildWorldSimulationBucketKey_ACU, readWorldSimulationBucketEntry_ACU } from './simulation-store';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';

export interface WorldSimulationRunWriteView_ACU {
  ledger: WorldSimulationLedger_ACU;
  fields: WorldSimulationLedgerFieldSnapshot_ACU | undefined;
  archive: WorldChronicleArchiveSnapshot_ACU;
}

/** 与逐栏帧同次宿主保存的运行证明；不复用其他功能的私有字段。 */
export interface WorldSimulationRunWriteProof_ACU {
  schemaVersion: 1;
  runId: string;
  taskId: string;
  stageId: string;
  stageRevision: number;
  baseLedgerRevision: number;
  confirmedWrites: number;
  ledgerRevision: number;
  fingerprint: string;
  stateDigest: string;
  evidenceRefs: string[];
  written: Record<string, string[]>;
}

function invalidProof_ACU(path: string): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_SNAPSHOT_INVALID', 'load', `${path} 运行写入证明损坏`, false, { path }));
}

function validateProof_ACU(raw: unknown): WorldSimulationRunWriteProof_ACU {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidProof_ACU(WORLD_SIMULATION_RUN_WRITE_FIELD_ACU);
  const value = raw as Record<string, unknown>;
  const keys = ['schemaVersion', 'runId', 'taskId', 'stageId', 'stageRevision', 'baseLedgerRevision', 'confirmedWrites', 'ledgerRevision', 'fingerprint', 'stateDigest', 'evidenceRefs', 'written'];
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))
    || value.schemaVersion !== 1 || ['runId', 'taskId', 'stageId', 'fingerprint', 'stateDigest'].some(key => typeof value[key] !== 'string' || !(value[key] as string).trim())
    || ['stageRevision', 'baseLedgerRevision', 'confirmedWrites', 'ledgerRevision'].some(key => !Number.isSafeInteger(value[key]) || (value[key] as number) < 0)
    || (value.confirmedWrites as number) < 1 || (value.ledgerRevision as number) < (value.baseLedgerRevision as number)
    || !Array.isArray(value.evidenceRefs) || value.evidenceRefs.some(ref => typeof ref !== 'string' || !ref.trim())
    || !value.written || typeof value.written !== 'object' || Array.isArray(value.written)
    || Object.entries(value.written as Record<string, unknown>).some(([module, ids]) => !module.trim() || !Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id.trim()))) {
    invalidProof_ACU(WORLD_SIMULATION_RUN_WRITE_FIELD_ACU);
  }
  const proof = value as unknown as WorldSimulationRunWriteProof_ACU;
  if (proof.stateDigest !== sha256HexSync_ACU(canonical_ACU(Object.fromEntries(Object.entries(proof).filter(([key]) => key !== 'stateDigest'))))) invalidProof_ACU(WORLD_SIMULATION_RUN_WRITE_FIELD_ACU);
  return proof;
}

export function readWorldSimulationRunWriteProof_ACU(anchor: WorldSimulationAnchorIdentity_ACU, chat: any[]): WorldSimulationRunWriteProof_ACU | null {
  return readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_RUN_WRITE_FIELD_ACU, anchor, validateProof_ACU, chat);
}

/** 只写入影子聊天；持久化与失败补偿由逐栏提交适配器共同管理。 */
export function stageWorldSimulationRunWriteProof_ACU(chat: unknown[], anchor: WorldSimulationAnchorIdentity_ACU, proof: WorldSimulationRunWriteProof_ACU, updatedAt: number): void {
  const message = chat[anchor.messageIndex] as Record<string, unknown>;
  const previous = message[WORLD_SIMULATION_RUN_WRITE_FIELD_ACU];
  const entries = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? (previous as { entries: Record<string, unknown> }).entries : {};
  message[WORLD_SIMULATION_RUN_WRITE_FIELD_ACU] = { schemaVersion: 1, entries: { ...entries,
    [buildWorldSimulationBucketKey_ACU(anchor)]: { anchor: { ...anchor }, value: proof, updatedAt } } };
}

function canonical_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_ACU).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical_ACU(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Only confirmed writes of this in-flight run can advance its expected ledger. */
export class WorldSimulationRunWriteState_ACU {
  private expected: string;
  private confirmed = 0;
  private ledgerRevision: number;
  private readonly refs = new Set<string>();
  private readonly written = new Map<string, Set<string>>();

  constructor(private readonly read: () => WorldSimulationRunWriteView_ACU, baseRevision: number, proof?: WorldSimulationRunWriteProof_ACU) {
    const initial = read();
    if (proof) {
      if (proof.baseLedgerRevision !== baseRevision || proof.ledgerRevision !== initial.ledger.revision
        || proof.fingerprint !== canonical_ACU(initial)) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
      this.confirmed = proof.confirmedWrites;
      for (const ref of proof.evidenceRefs) this.refs.add(ref);
      for (const [module, ids] of Object.entries(proof.written)) this.written.set(module, new Set(ids));
    } else if (initial.ledger.revision !== baseRevision) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
    this.expected = canonical_ACU(initial);
    this.ledgerRevision = initial.ledger.revision;
  }

  assertCurrent(view = this.read()): void {
    if (canonical_ACU(view) !== this.expected) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
  }

  assertPersistedProof(identity: WorldSimulationRunIdentity_ACU, proof: WorldSimulationRunWriteProof_ACU | null): void {
    this.assertCurrent();
    if (!this.confirmed) {
      if (proof?.runId === identity.runId && proof.taskId === identity.taskId) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
      return;
    }
    if (!proof || proof.runId !== identity.runId || proof.taskId !== identity.taskId
      || proof.stageId !== identity.stageId || proof.stageRevision !== identity.stageRevision
      || proof.baseLedgerRevision !== identity.baseLedgerRevision || proof.confirmedWrites !== this.confirmed
      || proof.ledgerRevision !== this.ledgerRevision || proof.fingerprint !== this.expected
      || canonical_ACU(proof.evidenceRefs) !== canonical_ACU([...this.refs])
      || canonical_ACU(proof.written) !== canonical_ACU(Object.fromEntries([...this.written].map(([module, ids]) => [module, [...ids]])))) {
      throw new Error('WORLD_SIMULATION_LEDGER_STALE');
    }
  }

  /** 预构造随 SQL 影子帧保存的下一份证明，不提前确认写入。 */
  prepareConfirmation(identity: WorldSimulationRunIdentity_ACU, view: WorldSimulationRunWriteView_ACU,
    evidenceRefs: readonly string[], accepted: readonly { module: string; id: string }[]): WorldSimulationRunWriteProof_ACU {
    this.assertCurrent();
    const written = Object.fromEntries([...this.written].map(([module, ids]) => [module, [...ids]]));
    for (const item of accepted) written[item.module] = [...new Set([...(written[item.module] ?? []), item.id])];
    const next = { schemaVersion: 1 as const, runId: identity.runId, taskId: identity.taskId, stageId: identity.stageId,
      stageRevision: identity.stageRevision, baseLedgerRevision: identity.baseLedgerRevision,
      confirmedWrites: this.confirmed + 1, ledgerRevision: view.ledger.revision, fingerprint: canonical_ACU(view),
      evidenceRefs: [...new Set([...this.refs, ...evidenceRefs])], written };
    return { ...next, stateDigest: sha256HexSync_ACU(canonical_ACU(next)) };
  }

  confirm(view: WorldSimulationRunWriteView_ACU, evidenceRefs: readonly string[], accepted: readonly { module: string; id: string }[] = []): void {
    this.expected = canonical_ACU(view);
    this.ledgerRevision = view.ledger.revision;
    this.confirmed += 1;
    for (const ref of evidenceRefs) this.refs.add(ref);
    for (const item of accepted) {
      const ids = this.written.get(item.module) ?? new Set<string>();
      ids.add(item.id);
      this.written.set(item.module, ids);
    }
  }

  assertCandidatesDisjoint(candidates: readonly WorldSimulationCandidate_ACU[]): void {
    for (const candidate of candidates) for (const [key, patch] of Object.entries(candidate.patch)) {
      const module = key === 'chronicleArchive' ? 'chronicle' : key;
      const written = this.written.get(module);
      if (!written?.size) continue;
      if (key === 'clock' || key === 'player' || key === 'guidance' || key === 'chronicle' || key === 'chronicleArchive') {
        throw new Error(`WORLD_SIMULATION_RUN_WRITE_OVERLAP:${module}`);
      }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(`WORLD_SIMULATION_RUN_WRITE_OVERLAP:${module}`);
      const changes = patch as { upsert?: unknown; remove?: unknown };
      for (const row of [...(Array.isArray(changes.upsert) ? changes.upsert : []), ...(Array.isArray(changes.remove) ? changes.remove : [])]) {
        if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id.trim()) {
          throw new Error(`WORLD_SIMULATION_RUN_WRITE_OVERLAP:${module}`);
        }
        if (written.has(row.id)) throw new Error(`WORLD_SIMULATION_RUN_WRITE_OVERLAP:${module}:${row.id}`);
      }
    }
  }

  get confirmedWrites(): number { return this.confirmed; }
  get currentLedgerRevision(): number { return this.ledgerRevision; }
  get hasConfirmedWrites(): boolean { return this.confirmed > 0; }
  get evidenceRefs(): string[] { return [...this.refs]; }
}

/** 终局投影改变正文锚点后，为下一运行保留仍在的 partial 来源；不是新增一次逐栏确认。 */
export function rebaseWorldSimulationRunWriteProof_ACU(proof: WorldSimulationRunWriteProof_ACU,
  before: WorldSimulationRunWriteView_ACU, after: WorldSimulationRunWriteView_ACU): WorldSimulationRunWriteProof_ACU {
  if (proof.ledgerRevision !== before.ledger.revision || proof.fingerprint !== canonical_ACU(before)) {
    throw new Error('WORLD_SIMULATION_LEDGER_STALE');
  }
  const next = { schemaVersion: proof.schemaVersion, runId: proof.runId, taskId: proof.taskId, stageId: proof.stageId,
    stageRevision: proof.stageRevision, baseLedgerRevision: proof.baseLedgerRevision,
    confirmedWrites: proof.confirmedWrites, ledgerRevision: after.ledger.revision,
    fingerprint: canonical_ACU(after), evidenceRefs: [...proof.evidenceRefs], written: proof.written };
  return { ...next, stateDigest: sha256HexSync_ACU(canonical_ACU(next)) };
}

export function hasPartialWorldSimulationRunWrites_ACU(view: WorldSimulationRunWriteView_ACU): boolean {
  return Object.values(view.fields?.records ?? {}).some(records =>
    Object.values(records ?? {}).some(record => record.status === 'partial' && Object.keys(record.fields).length > 0));
}

/** 旧运行无证明时仍遵守原始 revision；其他运行的证明不可借用。 */
export function restoreWorldSimulationRunWrites_ACU(read: () => WorldSimulationRunWriteView_ACU,
  identity: WorldSimulationRunIdentity_ACU, anchor: WorldSimulationAnchorIdentity_ACU, chat: any[]): WorldSimulationRunWriteState_ACU {
  const stored = readWorldSimulationRunWriteProof_ACU(anchor, chat);
  const proof = stored?.runId === identity.runId && stored.taskId === identity.taskId ? stored : undefined;
  if (proof && (proof.stageId !== identity.stageId || proof.stageRevision !== identity.stageRevision
    || proof.baseLedgerRevision !== identity.baseLedgerRevision)) throw new Error('WORLD_SIMULATION_LEDGER_STALE');
  // revision 不前进的 partial 仍是持久写入；无证明不能把它当作本次运行的起点。
  // 别的运行的证明仅可证明与当前完全一致的旧基线，不能为本运行签发已确认写入。
  if (!proof) {
    const current = read();
    if (hasPartialWorldSimulationRunWrites_ACU(current) && (!stored || stored.fingerprint !== canonical_ACU(current))) {
      throw new Error('WORLD_SIMULATION_LEDGER_STALE');
    }
  }
  return new WorldSimulationRunWriteState_ACU(read, identity.baseLedgerRevision, proof);
}
