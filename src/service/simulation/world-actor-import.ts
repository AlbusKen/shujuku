import { logError_ACU } from '../../shared/utils';
import { WorldSimulationValidationError_ACU, type WorldActor_ACU, type WorldSimulationLedger_ACU } from './model';
import { validateWorldSimulationLedger_ACU } from './simulation-store';

const normalizeText_ACU = (text: string): string => text.normalize('NFKC').trim();
const normalizeIdentity_ACU = (text: string): string => normalizeText_ACU(text).toLowerCase();
const normalizeName_ACU = (name: string): string => normalizeIdentity_ACU(name).replace(/\s+/g, ' ');
const optionalStrings_ACU = (value: unknown): unknown => value == null ? []
  : typeof value === 'string' ? (normalizeText_ACU(value) ? [normalizeText_ACU(value)] : [])
    : Array.isArray(value) ? value.map(item => typeof item === 'string' ? normalizeText_ACU(item) : item) : value;
const loreRefs_ACU = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((ref): ref is string => typeof ref === 'string').map(normalizeIdentity_ACU).filter(Boolean) : [];

/** 已获用户批准的世界书人物只追加到人物谱；同名只有共享明确 lore 引用时才判重。 */
export function appendWorldActors_ACU(ledger: WorldSimulationLedger_ACU, actors: readonly WorldActor_ACU[]): WorldSimulationLedger_ACU {
  const added: WorldActor_ACU[] = [];
  const seen = [...ledger.actors];
  for (const candidate of actors) {
    const raw = candidate as Partial<WorldActor_ACU> | null;
    const rawId = raw?.id as unknown;
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? normalizeText_ACU(String(rawId)) : '';
    if (id && seen.some(actor => normalizeIdentity_ACU(actor.id) === normalizeIdentity_ACU(id))) continue;
    if (!id) {
      logError_ACU('世界书人物候选校验跳过', { id, field: 'id' });
      continue;
    }
    const name = typeof raw?.name === 'string' ? normalizeName_ACU(raw.name) : '';
    const references = loreRefs_ACU(raw?.loreRefs);
    if (name && references.length && seen.some(actor => normalizeName_ACU(actor.name) === name
      && loreRefs_ACU(actor.loreRefs).some(ref => references.includes(ref)))) continue;
    // 只投影 schema 已知字段：旧人物原封不动，新候选的未来扩展字段不进入持久化。
    const actor: WorldActor_ACU = {
      id,
      name: typeof raw?.name === 'string' ? normalizeText_ACU(raw.name) : raw?.name as string,
      interests: optionalStrings_ACU(raw?.interests) as string[],
      location: raw?.location ?? '',
      locationRef: raw?.locationRef ?? null,
      life: raw?.life as WorldActor_ACU['life'],
      diedAtDay: raw?.diedAtDay ?? null,
      deathSummary: raw?.deathSummary ?? null,
      resources: optionalStrings_ACU(raw?.resources) as string[],
      goals: optionalStrings_ACU(raw?.goals) as string[],
      constraints: optionalStrings_ACU(raw?.constraints) as string[],
      informationSources: optionalStrings_ACU(raw?.informationSources) as string[],
      knownFacts: [],
      visibility: raw?.visibility as WorldActor_ACU['visibility'],
      currentAction: raw?.currentAction ?? null,
      longTermAction: raw?.longTermAction ?? null,
      ...(raw?.shortTermAction === undefined ? {} : { shortTermAction: raw.shortTermAction }),
      ...(raw?.previousActionResult === undefined ? {} : { previousActionResult: raw.previousActionResult }),
      simulationStatus: raw?.life === 'dead' ? 'archived' : 'active',
      loreRefs: optionalStrings_ACU(raw?.loreRefs) as string[],
      experiences: [],
      revision: 1,
    };
    try {
      validateWorldSimulationLedger_ACU({ ...ledger, actors: [...seen, actor] }, 'persist');
      seen.push(actor);
      added.push(actor);
    } catch (error) {
      if (!(error instanceof WorldSimulationValidationError_ACU)) throw error;
      // 不记录候选正文或错误详情（校验器可能在错误中带入原始值）。
      const field = /ledger\.actors\[\d+\]\.([A-Za-z]+)\b/.exec(error.message)?.[1] ?? 'actor';
      logError_ACU('世界书人物候选校验跳过', { id, field });
    }
  }
  return added.length ? { ...ledger, actors: [...ledger.actors, ...added], revision: ledger.revision + 1 } : ledger;
}
