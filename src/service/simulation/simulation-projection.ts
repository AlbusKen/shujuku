import { hashWorldSimulationBody_ACU } from './simulation-swipe';

export const WORLD_SIMULATION_PROJECTION_OPEN_TAG_ACU = '<与此同时>' as const;
export const WORLD_SIMULATION_PROJECTION_CLOSE_TAG_ACU = '</与此同时>' as const;

export interface WorldSimulationProjection_ACU {
  baseText: string;
  publicText: string;
  block: string;
  fullText: string;
  baseTextHash: string;
  blockHash: string;
}

function hasProjectionTag_ACU(value: string): boolean {
  return value.includes(WORLD_SIMULATION_PROJECTION_OPEN_TAG_ACU)
    || value.includes(WORLD_SIMULATION_PROJECTION_CLOSE_TAG_ACU);
}

/** Renders one system-owned terminal projection without permitting tag injection. */
export function renderWorldSimulationProjection_ACU(baseText: string, publicText: string): WorldSimulationProjection_ACU | null {
  if (typeof baseText !== 'string' || typeof publicText !== 'string' || !publicText.trim() || hasProjectionTag_ACU(baseText) || hasProjectionTag_ACU(publicText)) return null;
  const block = `${WORLD_SIMULATION_PROJECTION_OPEN_TAG_ACU}\n${publicText}\n${WORLD_SIMULATION_PROJECTION_CLOSE_TAG_ACU}`;
  const fullText = `${baseText}\n\n${block}`;
  return {
    baseText,
    publicText,
    block,
    fullText,
    baseTextHash: hashWorldSimulationBody_ACU(baseText),
    blockHash: hashWorldSimulationBody_ACU(block),
  };
}

/** Parses exactly one terminal system block; anything after it or a duplicate tag is not system-owned. */
export function parseWorldSimulationProjection_ACU(fullText: unknown): WorldSimulationProjection_ACU | null {
  if (typeof fullText !== 'string') return null;
  const prefix = `\n\n${WORLD_SIMULATION_PROJECTION_OPEN_TAG_ACU}\n`;
  const suffix = `\n${WORLD_SIMULATION_PROJECTION_CLOSE_TAG_ACU}`;
  const start = fullText.lastIndexOf(prefix);
  if (start < 0 || !fullText.endsWith(suffix)) return null;
  const baseText = fullText.slice(0, start);
  const publicText = fullText.slice(start + prefix.length, fullText.length - suffix.length);
  if (!publicText.trim() || hasProjectionTag_ACU(baseText) || hasProjectionTag_ACU(publicText)) return null;
  const block = fullText.slice(start + 2);
  return {
    baseText,
    publicText,
    block,
    fullText,
    baseTextHash: hashWorldSimulationBody_ACU(baseText),
    blockHash: hashWorldSimulationBody_ACU(block),
  };
}
