import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import { WorldSimulationValidationError_ACU, createWorldSimulationError_ACU, type WorldSimulationLedger_ACU } from '../model';
import { findUnauthorizedWorldSimulationEvidenceRefs_ACU, type WorldSimulationEvidenceRegistrySnapshot_ACU } from '../world-simulation-evidence-registry';
import { readWorldSimulationBucketEntry_ACU, resolveWorldSimulationAnchor_ACU, validateWorldSimulationLedger_ACU, writeWorldSimulationBucketEntry_ACU } from '../simulation-store';
import {
  WORLD_SIMULATION_MATERIALS_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_SCHEMA_VERSION_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU,
  type WorldSimulationAnchorIdentity_ACU,
  type WorldSimulationMaterialsReadResult_ACU,
  type WorldSimulationMaterialsSnapshot_ACU,
} from './agent-model';

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reject_ACU(message: string, details?: Record<string, unknown>): never {
  throw new WorldSimulationValidationError_ACU(createWorldSimulationError_ACU(
    'WORLD_SIMULATION_SNAPSHOT_INVALID', 'agent_persist', message, false, details,
  ));
}

function validateEvidenceRefs_ACU(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    reject_ACU('材料快照 evidenceRefs 必须是非空字符串数组');
  }
  return [...value] as string[];
}

export function validateWorldSimulationMaterialsSnapshot_ACU(raw: unknown): WorldSimulationMaterialsSnapshot_ACU {
  if (!isRecord_ACU(raw)) reject_ACU('世界推演材料快照必须是对象');
  const allowed = new Set(['schemaVersion', 'ledgerRevision', 'ledger', 'evidenceRefs', 'updatedAt']);
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(raw, key)) reject_ACU(`材料快照缺少字段：${key}`);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) reject_ACU(`材料快照存在未知字段：${key}`);
  if (raw.schemaVersion !== WORLD_SIMULATION_MATERIALS_SCHEMA_VERSION_ACU) reject_ACU('材料快照 schemaVersion 非法');
  if (typeof raw.ledgerRevision !== 'number' || !Number.isInteger(raw.ledgerRevision) || raw.ledgerRevision < 0) reject_ACU('材料快照 ledgerRevision 非法');
  if (typeof raw.updatedAt !== 'number' || !Number.isInteger(raw.updatedAt) || raw.updatedAt < 0) reject_ACU('材料快照 updatedAt 非法');
  const ledger = validateWorldSimulationLedger_ACU(raw.ledger, 'agent_persist');
  if (ledger.revision !== raw.ledgerRevision) reject_ACU('材料快照 ledgerRevision 与账本不一致');
  return { schemaVersion: WORLD_SIMULATION_MATERIALS_SCHEMA_VERSION_ACU, ledgerRevision: raw.ledgerRevision, ledger, evidenceRefs: validateEvidenceRefs_ACU(raw.evidenceRefs), updatedAt: raw.updatedAt };
}

export function readWorldSimulationLedgerAtAnchor_ACU(anchor: WorldSimulationAnchorIdentity_ACU, chat?: any[]): WorldSimulationLedger_ACU | null {
  return readWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, anchor, raw => validateWorldSimulationLedger_ACU(raw), chat);
}

export async function writeWorldSimulationLedgerAtAnchor_ACU(anchor: WorldSimulationAnchorIdentity_ACU, ledger: WorldSimulationLedger_ACU, chat?: any[]): Promise<void> {
  await writeWorldSimulationBucketEntry_ACU(WORLD_SIMULATION_STATE_FIELD_ACU, anchor, validateWorldSimulationLedger_ACU(ledger, 'persist'), chat);
}

/**
 * 从当前有效聊天分支尾部向前读取最近的合法材料快照。
 * 每个楼层只读取其当前 active swipe 对应的桶；损坏候选进入诊断并继续回退。
 */
export function readLatestWorldSimulationMaterials_ACU(chat?: any[]): WorldSimulationMaterialsReadResult_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const diagnostics: string[] = [];
  let sawBrokenSnapshot = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord_ACU(message) || message.is_user === true || message.is_system === true) continue;

    let anchor: WorldSimulationAnchorIdentity_ACU;
    try {
      anchor = resolveWorldSimulationAnchor_ACU(index, messages);
    } catch (error) {
      diagnostics.push(`楼层 ${index}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    try {
      const snapshot = readWorldSimulationBucketEntry_ACU(
        WORLD_SIMULATION_MATERIALS_FIELD_ACU,
        anchor,
        validateWorldSimulationMaterialsSnapshot_ACU,
        messages,
      );
      if (snapshot) {
        return { snapshot, diagnostics, adoptedIndex: index };
      }
    } catch (error) {
      sawBrokenSnapshot = true;
      diagnostics.push(`楼层 ${index}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (sawBrokenSnapshot) {
    diagnostics.push('当前有效分支存在材料快照字段，但没有任何候选通过严格校验。');
  }
  return { snapshot: null, diagnostics, adoptedIndex: null };
}

/** 向冻结 assistant 楼层的当前 swipe 保存一份完整材料快照。 */
export async function writeWorldSimulationMaterialsSnapshot_ACU(
  anchor: WorldSimulationAnchorIdentity_ACU,
  ledger: WorldSimulationLedger_ACU,
  evidenceRefs: readonly string[],
  evidenceRegistry: WorldSimulationEvidenceRegistrySnapshot_ACU,
  chat?: any[],
): Promise<void> {
  const validatedLedger = validateWorldSimulationLedger_ACU(ledger, 'agent_persist');
  const unauthorized = findUnauthorizedWorldSimulationEvidenceRefs_ACU(evidenceRefs, evidenceRegistry);
  if (unauthorized.length) reject_ACU('材料快照包含当前 run 未授权 evidenceRefs', { unauthorized });
  const snapshot: WorldSimulationMaterialsSnapshot_ACU = {
    schemaVersion: WORLD_SIMULATION_MATERIALS_SCHEMA_VERSION_ACU,
    ledgerRevision: validatedLedger.revision,
    ledger: validatedLedger,
    evidenceRefs: validateEvidenceRefs_ACU([...evidenceRefs]),
    updatedAt: Date.now(),
  };
  await writeWorldSimulationBucketEntry_ACU(
    WORLD_SIMULATION_MATERIALS_FIELD_ACU,
    anchor,
    snapshot,
    chat,
  );
}
