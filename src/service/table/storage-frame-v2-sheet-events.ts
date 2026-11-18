import type { TableSheetCheckpointV2_ACU, TableStorageFrameV2_ACU } from './storage-frame-v2-types';

export interface FrameSheetCheckpointRecord_ACU {
  recordKey: string;
  checkpoint: TableSheetCheckpointV2_ACU;
  ordinal?: number;
  position: number;
}

export function getFrameSheetCheckpointRecords_ACU(frame: TableStorageFrameV2_ACU): FrameSheetCheckpointRecord_ACU[] {
  const records: FrameSheetCheckpointRecord_ACU[] = [];
  const legacy = frame.perSheetCheckpoints;
  if (legacy !== undefined) {
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
      throw new Error('perSheetCheckpoints 必须是按 sheetKey 索引的对象');
    }
    for (const [recordKey, checkpoint] of Object.entries(legacy)) {
      records.push({ recordKey, checkpoint, position: records.length });
    }
  }
  if (frame.sheetTimelineEvents !== undefined) {
    if (!Array.isArray(frame.sheetTimelineEvents)) throw new Error('sheetTimelineEvents 必须是数组');
    const ordinals = new Set<number>();
    for (const [index, event] of frame.sheetTimelineEvents.entries()) {
      if (!event || !Number.isSafeInteger(event.ordinal) || event.ordinal < 0 || ordinals.has(event.ordinal)) {
        throw new Error(`sheetTimelineEvents[${index}] 包含非法或重复 ordinal`);
      }
      ordinals.add(event.ordinal);
      records.push({ recordKey: event.checkpoint?.sheetKey, checkpoint: event.checkpoint, ordinal: event.ordinal, position: records.length });
    }
  }
  return records;
}

function legacyBarrier_ACU(frame: TableStorageFrameV2_ACU, checkpoint: TableSheetCheckpointV2_ACU): number {
  const barrier = checkpoint.timeline!.afterSeq;
  if (!Number.isInteger(barrier) || barrier < 1 || !Number.isFinite(checkpoint.createdAt)) return barrier;
  const raw = frame.logEntries;
  const entries = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const target = entries.find(entry => entry?.seq === barrier);
  if (target && !(Number.isFinite(target.createdAt) && target.createdAt > checkpoint.createdAt)) return barrier;
  const preceding = entries.filter(entry => Number.isInteger(entry?.seq) && entry.seq < barrier);
  if (!preceding.length || preceding.some(entry => !Number.isFinite(entry.createdAt))) return barrier;
  const committed = preceding.filter(entry => entry.createdAt <= checkpoint.createdAt);
  if (!committed.length) return barrier;
  return Math.max(...committed.map(entry => entry.seq));
}


export function getOrderedFrameSheetCheckpointRecords_ACU(frame: TableStorageFrameV2_ACU): FrameSheetCheckpointRecord_ACU[] {
  return getFrameSheetCheckpointRecords_ACU(frame).map(record => {
    const checkpoint = record.checkpoint;
    if (record.ordinal !== undefined || !checkpoint?.timeline) return record;
    const afterSeq = legacyBarrier_ACU(frame, checkpoint);
    return afterSeq === checkpoint.timeline.afterSeq ? record : {
      ...record, checkpoint: { ...checkpoint, timeline: { ...checkpoint.timeline, afterSeq } },
    };
  }).sort((left, right) => {
    const a = left.checkpoint?.timeline;
    const b = right.checkpoint?.timeline;
    if (!a || !b) return a ? 1 : b ? -1 : left.position - right.position;
    const barrier = a.afterSeq - b.afterSeq;
    if (barrier) return barrier;
    if (left.ordinal !== undefined || right.ordinal !== undefined) {
      if (left.ordinal === undefined) return -1;
      if (right.ordinal === undefined) return 1;
      return left.ordinal - right.ordinal;
    }
    const time = left.checkpoint.createdAt - right.checkpoint.createdAt;
    return Number.isFinite(time) && time !== 0 ? time : left.position - right.position;
  });
}

export function getLatestFrameSheetCheckpoint_ACU(frame: TableStorageFrameV2_ACU | undefined, sheetKey: string): TableSheetCheckpointV2_ACU | undefined {
  if (!frame) return undefined;
  const records = getOrderedFrameSheetCheckpointRecords_ACU(frame)
    .filter(record => record.recordKey === sheetKey || record.checkpoint?.sheetKey === sheetKey);
  return records[records.length - 1]?.checkpoint;
}

export function appendFrameSheetTimelineEvents_ACU(frame: TableStorageFrameV2_ACU, checkpoints: readonly TableSheetCheckpointV2_ACU[]): void {
  if (!checkpoints.length) return;
  const records = getFrameSheetCheckpointRecords_ACU(frame);
  let ordinal = Math.max(-1, ...records.map(record => record.ordinal ?? -1));
  frame.sheetTimelineEvents = [
    ...(frame.sheetTimelineEvents || []),
    ...checkpoints.map(checkpoint => ({ ordinal: ++ordinal, checkpoint })),
  ];
}

export function frameHasSheetTimelineArtifacts_ACU(frame: TableStorageFrameV2_ACU): boolean {
  return frame.sheetTimelineEvents !== undefined
    && (!Array.isArray(frame.sheetTimelineEvents) || frame.sheetTimelineEvents.length > 0);
}
