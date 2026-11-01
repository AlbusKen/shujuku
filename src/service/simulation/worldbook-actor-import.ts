import { getLorebookEntriesRequired_ACU } from '../../data/gateways/worldbook-gateway';
import { getCurrentCharacterWorldbookBinding_ACU } from '../../data/gateways/character-gateway';
import { logError_ACU } from '../../shared/utils';
import { appendWorldRoundPromptMessages_ACU } from './agent/world-round-prompts';
import { buildEmptyWorldSimulationLedger_ACU } from './defaults';
import { appendWorldActors_ACU } from './world-actor-import';
import type { WorldActor_ACU, WorldSimulationLedger_ACU, WorldSimulationSettings_ACU } from './model';

type Message = { role: string; content: string };
type Candidate = Record<string, unknown> & { name: string; loreRefs: string[] };
type Source = { bookName: string; uid: string; title: string; content: string };

const SYSTEM = '你是独立的人物谱补齐专员，按照人物谱规则，一次读取当前格林账本与当前角色卡关联世界书，判断并补建尚未在册的重要人物。只返回一个 JSON 对象 {"actors":[WorldActor]}。在这次回复内完成身份比较、跨书别名去重和新人物当前状态推演，不要求后续提取、合并或复核调用。已有角色可以直接省略，或用 existingActorId 标记后跳过，不更新已有角色。新人物应按当前世界时间、处境、目标、资源、关系与重要历史判断当前活动和短期事务；currentAction与shortTermAction必须写明具体在做的事并给出预计时长，禁止“具体事务未详”“行踪不明”“预计 未定”等占位或空字符串，没有直接依据时按人物设定和当前时间推断合理的具体活动；不要把未来计划写成已完成，不把全知秘密当认知。knownFacts、experiences为空，loreRefs可使用真实书名#uid或{bookName,uid}，没有来源引用也保留有效人物，不为满足格式编造来源。没有遗漏的重要人物就返回 {"actors":[]}。不输出或修改时间、事件、事实、重要历史、正文和表格。';

function live(input: { signal: AbortSignal; isCurrent(): boolean }): void {
  if (input.signal.aborted || !input.isCurrent()) throw new Error('世界书人物扫描已取消或失效');
}
function identity(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase() : '';
}
function strings(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [value]).flatMap(item =>
    typeof item === 'string' || typeof item === 'number' ? [String(item).trim()] : []).filter(Boolean))];
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function fields(raw: Record<string, unknown>): Record<string, unknown> {
  const aliases: Record<string, string> = { charactername: 'name', actorname: 'name', 姓名: 'name', 名字: 'name', 名称: 'name',
    sources: 'loreRefs', sourcerefs: 'loreRefs', 世界书来源: 'loreRefs', 来源: 'loreRefs',
    当前动作: 'currentAction', 短期事务: 'shortTermAction', 长期目标: 'goals', 位置: 'location',
    book: 'bookName', booktitle: 'bookName', 世界书: 'bookName', 书名: 'bookName', entryid: 'uid', 条目: 'uid' };
  const names = ['id', 'name', 'existingActorId', 'aliases', 'loreRefs', 'interests', 'location', 'locationRef', 'life', 'diedAtDay',
    'deathSummary', 'resources', 'goals', 'constraints', 'informationSources', 'visibility', 'currentAction',
    'shortTermAction', 'longTermAction', 'text', 'description', 'expectedDuration', 'region', 'place', 'bookName', 'uid'];
  const canonical = new Map(names.map(name => [name.toLowerCase(), name]));
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => {
    const normalized = identity(key).replace(/[\s_-]/g, '');
    return [aliases[normalized] ?? canonical.get(normalized) ?? key, value];
  }));
}
function replyJSON(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { /* 接受JSON外围说明。 */ }
  const found: unknown[] = [];
  let start = -1; const stack: string[] = []; let quoted = false; let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"' && stack.length) quoted = true;
    else if (character === '{' || character === '[') { if (!stack.length) start = index; stack.push(character); }
    else if ((character === '}' || character === ']') && stack.length) {
      if (stack[stack.length - 1] !== (character === '}' ? '{' : '[')) { stack.length = 0; continue; }
      stack.pop();
      if (!stack.length) {
        try { found.push(JSON.parse(text.slice(start, index + 1))); } catch { /* 忽略非JSON片段。 */ }
      }
    }
  }
  if (!found.length) throw new Error('人物扫描回复没有可读取的 JSON');
  return found.length === 1 ? found[0] : found;
}
function rows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw.flatMap(item => rows(item));
  const value = object(raw);
  if (!value) return [];
  const containers = new Map(Object.entries(value).map(([key, entry]) => [identity(key).replace(/[\s_-]/g, ''), entry]));
  for (const key of ['actors', 'actorRegistrations', 'characters', '人物', '角色', 'candidates', 'data', 'result', 'actor']) {
    const entry = containers.get(key.toLowerCase());
    if (entry != null) return rows(entry);
  }
  if (object(value.value)) return rows(value.value);
  return [fields(value)];
}
function sourceRefs(raw: unknown, sources: readonly Source[]): string[] {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const result: string[] = [];
  for (const value of values) {
    const ref = object(value);
    const normalized = ref ? fields(ref) : null;
    const text = identity(value).replace(/\s*([#/:\\|])\s*/g, '$1');
    const matches = sources.filter(source => {
      const book = identity(source.bookName); const uid = identity(source.uid);
      if (normalized) return identity(normalized.uid) === uid && (!normalized.bookName || identity(normalized.bookName) === book);
      if (text === uid) return true;
      return ['#', '/', ':', '\\', '|', '::'].some(separator => text === `${book}${separator}${uid}`)
        || text === `${book}[${uid}]` || text === `${book}(${uid})`;
    });
    if (matches.length === 1) result.push(`${matches[0].bookName}#${matches[0].uid}`);
  }
  return [...new Set(result)];
}
function parseCandidates(raw: string, sources: readonly Source[]): Candidate[] {
  return rows(replyJSON(raw)).flatMap(row => {
    const value = object(row);
    if (!value || typeof value.name !== 'string' || !value.name.trim()) return [];
    const name = value.name.normalize('NFKC').trim();
    let refs = sourceRefs(value.loreRefs, sources);
    if (!refs.length) {
      const titles = sources.filter(source => identity(source.title) === identity(name));
      if (titles.length === 1) refs = [`${titles[0].bookName}#${titles[0].uid}`];
    }
    return [{ ...value, name, loreRefs: refs }];
  });
}
function hash(text: string): string {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
  return (value >>> 0).toString(36);
}
function actor(candidate: Candidate, ledger: WorldSimulationLedger_ACU): WorldActor_ACU {
  const lifeText = identity(candidate.life);
  const life = ({ 存活: 'alive', 在世: 'alive', 死亡: 'dead', 已故: 'dead', 失踪: 'missing' } as Record<string, string>)[lifeText] ?? lifeText;
  const actualLife = ['alive', 'missing', 'dead'].includes(life) ? life as WorldActor_ACU['life'] : 'alive';
  const locationRef = object(candidate.locationRef) ? fields(object(candidate.locationRef)!) : null;
  const action = (raw: unknown, ongoing: boolean) => {
    const item = typeof raw === 'string' && raw.trim() ? { text: raw.trim() } : object(raw);
    const value = item ? fields(item) : null;
    const text = value?.text ?? value?.description;
    if (typeof text !== 'string' || !text.trim()) return null;
    return { text: text.trim(), expectedDuration: typeof value?.expectedDuration === 'string' ? value.expectedDuration : '',
      startedAtDay: ledger.clock.day, startedAt: ledger.clock.storyTime,
      ...(ongoing ? { status: 'ongoing' as const, outcome: null } : {}) };
  };
  const shortTermAction = action(candidate.shortTermAction ?? candidate.longTermAction, true) as WorldActor_ACU['longTermAction'];
  const region = typeof locationRef?.region === 'string' ? locationRef.region.trim() : '';
  const place = typeof locationRef?.place === 'string' ? locationRef.place.trim() : '';
  const name = identity(candidate.name);
  const existing = ledger.actors.find(item => identity(item.id) === identity(candidate.existingActorId)
    || !!candidate.id && identity(item.id) === identity(candidate.id)
    || identity(item.name) === name && (!candidate.loreRefs.length || !item.loreRefs?.length
      || item.loreRefs.some(ref => candidate.loreRefs.some(source => identity(ref).replace(/\s*[/#]\s*/g, '#') === identity(source)))));
  return {
    id: existing?.id ?? `worldbook-actor-${hash(`${name}|${[...candidate.loreRefs].sort().join('|')}`)}`,
    name: candidate.name, interests: strings(candidate.interests),
    location: typeof candidate.location === 'string' ? candidate.location.trim() : place || region,
    locationRef: region || place ? { region: region || place, ...(region && place ? { place } : {}) }
      : typeof candidate.locationRef === 'string' && candidate.locationRef.trim() ? { region: candidate.locationRef.trim() } : null,
    life: actualLife, diedAtDay: actualLife === 'dead' ? Number(candidate.diedAtDay) : null,
    deathSummary: actualLife === 'dead' ? (typeof candidate.deathSummary === 'string' && candidate.deathSummary.trim() || '世界书记载已故') : null,
    resources: strings(candidate.resources), goals: strings(candidate.goals), constraints: strings(candidate.constraints),
    informationSources: strings(candidate.informationSources), knownFacts: [],
    visibility: ['hidden', 'limited', 'public'].includes(identity(candidate.visibility)) ? identity(candidate.visibility) as WorldActor_ACU['visibility'] : 'hidden',
    currentAction: action(candidate.currentAction, false) as WorldActor_ACU['currentAction'],
    longTermAction: shortTermAction, shortTermAction, simulationStatus: actualLife === 'dead' ? 'archived' : 'active',
    loreRefs: candidate.loreRefs, experiences: [], revision: 1,
  };
}

export async function scanWorldbookActors_ACU(input: {
  settings: WorldSimulationSettings_ACU;
  actors: readonly WorldActor_ACU[];
  ledger?: WorldSimulationLedger_ACU;
  signal: AbortSignal;
  isCurrent(): boolean;
  invoke(messages: readonly Message[]): Promise<string>;
  onProgress?(message: string): void | Promise<void>;
}): Promise<{ actors: WorldActor_ACU[]; bookCount: number; failedBookNames: string[] }> {
  live(input);
  const ledger = structuredClone(input.ledger ?? { ...buildEmptyWorldSimulationLedger_ACU(), actors: [...input.actors] });
  const books = [...new Set((await getCurrentCharacterWorldbookBinding_ACU()).orderedNames)];
  live(input);
  const failedBookNames: string[] = [];
  const entries: Source[] = [];
  let bookCount = 0;
  for (const bookName of books) {
    live(input);
    try {
      const values = await getLorebookEntriesRequired_ACU(bookName);
      live(input);
      bookCount++;
      for (const row of values) {
        const item = object(row);
        if (!item || (typeof item.uid !== 'string' && typeof item.uid !== 'number')) continue;
        const uid = String(item.uid).trim();
        if (!uid || typeof item.content !== 'string' || !item.content.trim()) continue;
        entries.push({ bookName, uid, title: String(item.comment ?? item.title ?? ''), content: item.content });
      }
      await input.onProgress?.(`已读取世界书：${bookName}`);
    } catch (error) {
      live(input);
      failedBookNames.push(bookName);
      logError_ACU('世界书人物扫描读取失败', { bookName, message: error instanceof Error ? error.message : '读取失败' });
      await input.onProgress?.(`世界书读取失败：${bookName}`);
    }
  }
  if (books.length && !bookCount) throw new Error(`世界书人物扫描失败：所有世界书读取失败（${failedBookNames.join('、')}）`);
  if (!entries.length) return { actors: [], bookCount, failedBookNames };
  await input.onProgress?.('正在一次请求中补齐重要人物。');
  live(input);
  const messages = appendWorldRoundPromptMessages_ACU([{ role: 'system', content: SYSTEM }], input.settings, 'worldbook-registrar', {
    stage: 'worldbook-actor-scan', materials: {
      WORLD_RUNTIME_CONTEXT: { stage: 'worldbook-actor-scan', ledger, existingActors: ledger.actors },
      WORLDBOOK_HITS: entries,
    },
  });
  const raw = await input.invoke(messages);
  live(input);
  const candidates = parseCandidates(raw, entries).flatMap(candidate => {
    const normalized = actor(candidate, ledger);
    if (ledger.actors.some(item => identity(item.id) === identity(normalized.id))) return [];
    if (normalized.life === 'dead' && (!Number.isInteger(normalized.diedAtDay) || normalized.diedAtDay! < 1)) {
      logError_ACU('世界书已故人物缺少死亡日，跳过候选', { name: candidate.name, loreRefs: candidate.loreRefs });
      return [];
    }
    return [normalized];
  });
  const next = appendWorldActors_ACU(ledger, candidates);
  const actors = next.actors.slice(ledger.actors.length);
  await input.onProgress?.(`模型返回 ${candidates.length} 位可用人物，待确认新增 ${actors.length} 位。`);
  return { actors, bookCount, failedBookNames };
}
