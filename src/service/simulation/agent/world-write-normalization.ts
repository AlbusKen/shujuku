import type { WorldClock_ACU, WorldEvent_ACU, WorldFact_ACU, WorldLocationRef_ACU, WorldNextCheck_ACU, WorldTime_ACU } from '../model';

type WriteContext_ACU = {
  baseClock: WorldClock_ACU;
  candidateClock: WorldClock_ACU;
  location: WorldLocationRef_ACU | null;
};

type CalendarDate_ACU = { year: number; month: number; day: number };

function record_ACU(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function calendarDate_ACU(value: string): CalendarDate_ACU | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
    ?? /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const stamp = new Date(0);
  stamp.setUTCHours(0, 0, 0, 0);
  stamp.setUTCFullYear(year, month - 1, day);
  return stamp.getUTCFullYear() === year && stamp.getUTCMonth() + 1 === month && stamp.getUTCDate() === day
    ? { year, month, day } : null;
}

function storyDate_ACU(storyTime: string): CalendarDate_ACU | null {
  const matches = storyTime.match(/\d{4}-\d{1,2}-\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日/g) ?? [];
  const dates = matches.map(calendarDate_ACU).filter((date): date is CalendarDate_ACU => date !== null);
  // 故事日期有歧义或无效时不能用作锚点。
  return matches.length === 1 && dates.length === 1 ? dates[0] : null;
}

function utcDay_ACU(date: CalendarDate_ACU): number {
  const stamp = new Date(0);
  stamp.setUTCHours(0, 0, 0, 0);
  stamp.setUTCFullYear(date.year, date.month - 1, date.day);
  return stamp.getTime() / 86400000;
}

function dateTime_ACU(value: string): { date: CalendarDate_ACU; slot: string } | null {
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{1,2}-\d{1,2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(trimmed);
  if (!match) {
    const date = calendarDate_ACU(trimmed);
    return date ? { date, slot: '' } : null;
  }
  const date = calendarDate_ACU(match[1]);
  if (!date) return null;
  if (match[2] === undefined) return { date, slot: '' };
  const hours = Number(match[2]); const minutes = Number(match[3]); const seconds = Number(match[4] ?? '0');
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  if (match[5] && match[5] !== 'Z' && (Number(match[5].slice(1, 3)) > 23 || Number(match[5].slice(4)) > 59)) return null;
  // 时区标记仅校验格式；故事当地日期/时刻不能换算到另一天，UTC 只用于日历日差。
  return { date, slot: `${match[2]}:${match[3]}:${match[4] ?? '00'}` };
}

function time_ACU(value: unknown, context: WriteContext_ACU): WorldTime_ACU | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const parsed = dateTime_ACU(value);
    if (!parsed) return value as unknown as WorldTime_ACU;
    const anchor = [context.candidateClock, context.baseClock].map(clock => ({ clock, date: storyDate_ACU(clock.storyTime) }))
      .find(item => item.date !== null);
    if (!anchor?.date) return value as unknown as WorldTime_ACU;
    return { day: anchor.clock.day + utcDay_ACU(parsed.date) - utcDay_ACU(anchor.date), slot: parsed.slot };
  }
  const fields = record_ACU(value);
  if (!fields) return value as WorldTime_ACU;
  const day = typeof fields.day === 'string' && /^\d+$/.test(fields.day.trim()) ? Number(fields.day.trim()) : fields.day;
  const dated = typeof day === 'string' ? time_ACU(day, context) : null;
  return { day: (dated !== null && typeof dated === 'object' ? dated.day : day) as number, slot: (fields.slot ?? '') as string };
}

function nextCheck_ACU(value: unknown, context: WriteContext_ACU): WorldNextCheck_ACU | null {
  const time = time_ACU(value, context);
  if (time === null) return null;
  const fields = record_ACU(value);
  if (typeof value === 'string') return typeof time === 'string' ? time as unknown as WorldNextCheck_ACU
    : { ...time, reason: '后续复查' };
  return fields ? { ...time, reason: (fields.reason ?? '后续复查') as string }
    : time as WorldNextCheck_ACU;
}

function location_ACU(value: unknown, known: WorldLocationRef_ACU | null): WorldLocationRef_ACU | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const name = value.trim();
    if (!name) return null;
    if (known && (name === known.region || name === known.place || (known.place && (name === `${known.region}-${known.place}` || name === `${known.region}${known.place}`)))) {
      return { region: known.region, ...(known.place === undefined ? {} : { place: known.place }) };
    }
    return { region: name };
  }
  const fields = record_ACU(value);
  return fields ? { region: fields.region as string, ...(fields.place === undefined ? {} : { place: fields.place as string }) }
    : value as WorldLocationRef_ACU;
}

function locations_ACU(value: unknown, known: WorldLocationRef_ACU | null): WorldLocationRef_ACU[] {
  if (value == null) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map(item => location_ACU(item, known) as WorldLocationRef_ACU);
}

function strings_ACU(value: unknown): string[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : typeof value === 'string' ? [value] : value) as string[];
}

/** 将模型回复投影到严格账本字段，不臆造业务信息或放宽引用权限。 */
export function normalizeWorldEventWrite_ACU(event: WorldEvent_ACU, context: WriteContext_ACU): WorldEvent_ACU {
  const raw = event as unknown as Record<string, unknown>;
  const status = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() : raw.status;
  const allowed = ['scheduled', 'active', 'paused', 'resolved', 'cancelled'];
  const normalizedStatus = allowed.includes(status as string) ? status : raw.status;
  return {
    id: raw.id as string, title: raw.title as string, state: raw.state as string,
    status: normalizedStatus as WorldEvent_ACU['status'],
    actorIds: strings_ACU(raw.actorIds), organizationIds: strings_ACU(raw.organizationIds),
    locationRefs: locations_ACU(raw.locationRefs, context.location),
    startedAt: time_ACU(raw.startedAt, context), deadline: time_ACU(raw.deadline, context),
    nextCheck: nextCheck_ACU(raw.nextCheck, context),
    relatedEventIds: strings_ACU(raw.relatedEventIds), loreRefs: strings_ACU(raw.loreRefs),
    evidenceRefs: strings_ACU(raw.evidenceRefs), tags: strings_ACU(raw.tags),
    revision: raw.revision as number,
    legacy: record_ACU(raw.legacy) ?? null,
  };
}

export function normalizeWorldFactWrite_ACU(fact: WorldFact_ACU, context: WriteContext_ACU): WorldFact_ACU {
  const raw = fact as unknown as Record<string, unknown>;
  const kind = raw.temporalKind;
  return {
    id: raw.id as string, summary: raw.summary as string,
    temporalKind: kind as WorldFact_ACU['temporalKind'],
    happenedAt: kind === 'condition' ? null : time_ACU(raw.happenedAt, context),
    validFrom: kind === 'occurrence' ? null : time_ACU(raw.validFrom, context),
    validUntil: kind === 'occurrence' ? null : time_ACU(raw.validUntil, context),
    locationRef: location_ACU(raw.locationRef, context.location),
    actorIds: strings_ACU(raw.actorIds), worldEventIds: strings_ACU(raw.worldEventIds),
    projectionPolicy: raw.projectionPolicy as WorldFact_ACU['projectionPolicy'],
    revealState: raw.revealState as WorldFact_ACU['revealState'],
    revealGate: (raw.revealGate ?? null) as WorldFact_ACU['revealGate'],
    nextCheck: kind === 'condition' && raw.validUntil == null && raw.nextCheck == null
      ? { day: context.candidateClock.day + 1, slot: context.candidateClock.slot, reason: '后续复查' }
      : nextCheck_ACU(raw.nextCheck, context),
    sourceRefs: strings_ACU(raw.sourceRefs), evidenceRefs: strings_ACU(raw.evidenceRefs),
    supersedesFactIds: strings_ACU(raw.supersedesFactIds), revision: raw.revision as number,
  };
}
