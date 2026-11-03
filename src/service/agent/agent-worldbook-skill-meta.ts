import type {
  AgentWorldbookControl_ACU,
  AgentWorldbookControlMode_ACU,
  WorldbookSkillMeta_ACU,
  WorldbookSkillMetaUpdatedBy_ACU,
} from '../../shared/models/agent-worldbook-model';
import { getLorebookEntries_ACU, setLorebookEntries_ACU } from '../../data/gateways/worldbook-gateway';
import type { StrictLorebookReadContext_ACU } from '../worldbook/pipeline';
import { getAgentRuntimeLorebookEntries_ACU } from './agent-worldbook-runtime-read';
export type { WorldbookSkillMeta_ACU, WorldbookSkillMetaUpdatedBy_ACU } from '../../shared/models/agent-worldbook-model';
import {
  readAgentWorldbookControlFromWorldbooks_ACU,
  resolveAgentWorldbookScopeBookNames_ACU,
  type AgentWorldbookConfigSource_ACU,
} from './agent-worldbook-config-meta';
import {
  ACU_SKILL_META_END_ACU,
  ACU_SKILL_META_START_ACU,
  buildWorldbookEntryDisplayLabel_ACU,
  createSkillMetaPattern_ACU,
  stripWorldbookSkillMetaBlockCore_ACU,
} from '../../shared/agent-worldbook-comment';

export { ACU_SKILL_META_START_ACU, ACU_SKILL_META_END_ACU };

export interface WorldbookSkillMetaSaveResult_ACU {
  updated: boolean;
  reason?: string;
  entry?: Record<string, any>;
}

export interface WorldbookSkillMetaReadResult_ACU {
  bookName: string;
  uid: string | number;
  comment: string;
  label: string;
  skillMeta: WorldbookSkillMeta_ACU;
}

export interface ClearWorldbookSkillMetaBlocksResult_ACU {
  total: number;
  cleared: number;
  skipped: number;
  failed: number;
  errors: Array<{ bookName: string; uid: string | number; reason: string }>;
}

export interface AgentWorldbookFilterAvailability_ACU {
  configuredMode: AgentWorldbookControlMode_ACU;
  control: AgentWorldbookControl_ACU;
  configSource: AgentWorldbookConfigSource_ACU;
  available: boolean;
  skillCount: number;
  bookNames: string[];
  configBookName: string;
  writableBookName: string;
  reason: 'available' | 'empty_scope' | 'no_card_agent_config' | 'not_agent_mode' | 'no_skill_data';
  skillMetas: WorldbookSkillMetaReadResult_ACU[];
}

function normalizeCommentText_ACU(comment: unknown): string {
  return typeof comment === 'string' ? comment : '';
}

function normalizeSkillMetaText_ACU(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSkillMetaTk_ACU(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.trunc(raw));
}

function isValidUpdatedBy_ACU(value: unknown): value is WorldbookSkillMetaUpdatedBy_ACU {
  return value === 'manual' || value === 'agent-skillify';
}

export function stripWorldbookSkillMetaBlock_ACU(comment: unknown): string {
  return stripWorldbookSkillMetaBlockCore_ACU(comment);
}

export function parseWorldbookSkillMetaFromComment_ACU(comment: unknown): WorldbookSkillMeta_ACU | null {
  const text = normalizeCommentText_ACU(comment);
  const pattern = createSkillMetaPattern_ACU();
  const match = pattern.exec(text);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[1].trim()) as Record<string, unknown>;
    if (raw.version !== 1) return null;
    const updatedBy = isValidUpdatedBy_ACU(raw.updatedBy) ? raw.updatedBy : 'manual';
    return {
      version: 1,
      description: normalizeSkillMetaText_ACU(raw.description),
      triggerWhen: normalizeSkillMetaText_ACU(raw.triggerWhen),
      tk: normalizeSkillMetaTk_ACU(raw.tk),
      updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0,
      updatedBy,
    };
  } catch {
    return null;
  }
}

export function hasUsableWorldbookSkillMeta_ACU(comment: unknown): boolean {
  const meta = parseWorldbookSkillMetaFromComment_ACU(comment);
  if (!meta) return false;
  return !!meta.description || !!meta.triggerWhen || meta.tk > 0;
}

export function normalizeWorldbookSkillMetaDraft_ACU(
  draft: Partial<WorldbookSkillMeta_ACU>,
  updatedBy: WorldbookSkillMetaUpdatedBy_ACU = 'manual',
  now = Date.now(),
): WorldbookSkillMeta_ACU {
  return {
    version: 1,
    description: normalizeSkillMetaText_ACU(draft.description),
    triggerWhen: normalizeSkillMetaText_ACU(draft.triggerWhen),
    tk: normalizeSkillMetaTk_ACU(draft.tk),
    updatedAt: Number.isFinite(Number(draft.updatedAt)) && Number(draft.updatedAt) > 0 ? Number(draft.updatedAt) : now,
    updatedBy: isValidUpdatedBy_ACU(draft.updatedBy) ? draft.updatedBy : updatedBy,
  };
}


export function buildWorldbookSkillMetaComment_ACU(comment: unknown, metaDraft: Partial<WorldbookSkillMeta_ACU>): string {
  const meta = normalizeWorldbookSkillMetaDraft_ACU(metaDraft);
  const baseComment = stripWorldbookSkillMetaBlock_ACU(comment);
  if (!meta.description && !meta.triggerWhen) return baseComment;

  const metaJson = JSON.stringify(meta);
  const metaBlock = `<!-- ${ACU_SKILL_META_START_ACU}\n${metaJson}\n${ACU_SKILL_META_END_ACU} -->`;
  return [baseComment, metaBlock].filter(Boolean).join('\n\n');
}

export function findWorldbookEntryByUid_ACU(entries: Record<string, any>[], uid: string | number): Record<string, any> | null {
  return entries.find(entry => entry?.uid === uid || String(entry?.uid) === String(uid)) || null;
}

function validateWorldbookSkillMetaTarget_ACU(bookName: string, uid: string | number | null | undefined): string | null {
  if (!bookName || !bookName.trim()) return '世界书名称为空';
  if (uid === null || uid === undefined || uid === '') return '世界书条目 uid 为空';
  return null;
}

export async function saveWorldbookEntrySkillMeta_ACU(
  bookName: string,
  uid: string | number,
  metaDraft: Partial<WorldbookSkillMeta_ACU>,
  updatedBy: WorldbookSkillMetaUpdatedBy_ACU = 'manual',
): Promise<WorldbookSkillMetaSaveResult_ACU> {
  const targetError = validateWorldbookSkillMetaTarget_ACU(bookName, uid);
  if (targetError) return { updated: false, reason: targetError };

  const entries = await getLorebookEntries_ACU(bookName);
  const entry = findWorldbookEntryByUid_ACU(entries, uid);
  if (!entry) return { updated: false, reason: '未找到世界书条目' };

  const meta = normalizeWorldbookSkillMetaDraft_ACU(metaDraft, updatedBy);
  const nextComment = buildWorldbookSkillMetaComment_ACU(entry.comment, meta);
  if (nextComment === normalizeCommentText_ACU(entry.comment)) {
    return { updated: false, reason: '世界书 Skill 元数据未变化', entry };
  }

  await setLorebookEntries_ACU(bookName, [{ uid: entry.uid, comment: nextComment }]);
  return { updated: true, entry: { ...entry, comment: nextComment } };
}

export async function deleteWorldbookEntrySkillMeta_ACU(
  bookName: string,
  uid: string | number,
): Promise<WorldbookSkillMetaSaveResult_ACU> {
  const targetError = validateWorldbookSkillMetaTarget_ACU(bookName, uid);
  if (targetError) return { updated: false, reason: targetError };

  const entries = await getLorebookEntries_ACU(bookName);
  const entry = findWorldbookEntryByUid_ACU(entries, uid);
  if (!entry) return { updated: false, reason: '未找到世界书条目' };

  const currentComment = normalizeCommentText_ACU(entry.comment);
  const nextComment = stripWorldbookSkillMetaBlock_ACU(currentComment);
  if (nextComment === currentComment) {
    return { updated: false, reason: '世界书条目没有 Skill 元数据', entry };
  }

  await setLorebookEntries_ACU(bookName, [{ uid: entry.uid, comment: nextComment }]);
  return { updated: true, entry: { ...entry, comment: nextComment } };
}

function buildWorldbookSkillMetaReadResult_ACU(
  bookName: string,
  entry: Record<string, any>,
): WorldbookSkillMetaReadResult_ACU | null {
  const uid = entry?.uid;
  if (uid === null || uid === undefined || String(uid).trim() === '') return null;
  const comment = normalizeCommentText_ACU(entry?.comment || entry?.name);
  const skillMeta = parseWorldbookSkillMetaFromComment_ACU(comment);
  if (!skillMeta) return null;
  return {
    bookName,
    uid,
    comment,
    label: buildWorldbookEntryDisplayLabel_ACU(comment, uid),
    skillMeta,
  };
}

export async function getWorldbookEntrySkillMeta_ACU(
  bookName: string,
  uid: string | number,
): Promise<WorldbookSkillMetaReadResult_ACU | null> {
  const targetError = validateWorldbookSkillMetaTarget_ACU(bookName, uid);
  if (targetError) return null;
  const entries = await getLorebookEntries_ACU(bookName);
  const entry = findWorldbookEntryByUid_ACU(entries, uid);
  if (!entry) return null;
  return buildWorldbookSkillMetaReadResult_ACU(bookName, entry);
}

export async function listWorldbookSkillMetas_ACU(
  bookNames: string[] = [],
  readContext?: StrictLorebookReadContext_ACU,
): Promise<WorldbookSkillMetaReadResult_ACU[]> {
  const uniqueBookNames = [...new Set((Array.isArray(bookNames) ? bookNames : [])
    .map(name => String(name || '').trim())
    .filter(Boolean))];
  const results: WorldbookSkillMetaReadResult_ACU[] = [];
  for (const bookName of uniqueBookNames) {
    const entries = await getAgentRuntimeLorebookEntries_ACU(bookName, readContext);
    for (const entry of Array.isArray(entries) ? entries : []) {
      const item = buildWorldbookSkillMetaReadResult_ACU(bookName, entry);
      if (item) results.push(item);
    }
  }
  return results;
}

export async function clearWorldbookSkillMetaBlocks_ACU(
  bookNames: string[] = [],
): Promise<ClearWorldbookSkillMetaBlocksResult_ACU> {
  const targets = await listWorldbookSkillMetas_ACU(bookNames);
  const result: ClearWorldbookSkillMetaBlocksResult_ACU = {
    total: targets.length,
    cleared: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const target of targets) {
    try {
      const deleteResult = await deleteWorldbookEntrySkillMeta_ACU(target.bookName, target.uid);
      if (deleteResult.updated) result.cleared += 1;
      else result.skipped += 1;
    } catch (error: any) {
      result.failed += 1;
      result.errors.push({ bookName: target.bookName, uid: target.uid, reason: error?.message || '清除 Skill 元数据失败' });
    }
  }

  return result;
}

export async function resolveAgentWorldbookFilterAvailability_ACU(
  readContext?: StrictLorebookReadContext_ACU,
): Promise<AgentWorldbookFilterAvailability_ACU> {
  const config = await readAgentWorldbookControlFromWorldbooks_ACU(readContext);
  const enabled = config.source === 'worldbook' && config.control.enabled === true && config.control.mode === 'agent';
  const bookNames = enabled ? await resolveAgentWorldbookScopeBookNames_ACU(config.control.worldbookScope, readContext) : [];
  const skillMetas = enabled && bookNames.length > 0 ? await listWorldbookSkillMetas_ACU(bookNames, readContext) : [];
  const base = {
    configuredMode: config.control.mode,
    control: config.control,
    configSource: config.source,
    skillCount: skillMetas.length,
    bookNames,
    configBookName: config.bookName || '',
    writableBookName: config.writableBookName || '',
    skillMetas,
  };

  if (config.source !== 'worldbook') return { ...base, available: false, reason: 'no_card_agent_config' };
  if (!enabled) return { ...base, available: false, reason: 'not_agent_mode' };
  if (bookNames.length === 0) return { ...base, available: false, reason: 'empty_scope' };
  return { ...base, available: true, reason: 'available' };
}
