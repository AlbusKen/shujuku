import type { WorldSeed_ACU, WorldSimulationLedger_ACU } from './model';
import type { WorldRelevanceReport_ACU } from './relevance-gate';

export type WorldSeedCircle_ACU = 'core' | 'medium' | 'edge';
export type WorldSeedAdvance_ACU = 'none' | 'tick' | 'catalyze';

export interface WorldProgressionDirective_ACU {
  seedId: string;
  advance: WorldSeedAdvance_ACU;
  reason: string;
  circle: WorldSeedCircle_ACU;
}

export interface WorldProgressionPlanInput_ACU {
  ledger: WorldSimulationLedger_ACU;
  daysAdvanced: number;
  relevance: WorldRelevanceReport_ACU;
  lastCatalyzedAtDayBySeed: Readonly<Record<string, number>>;
}

const FREQUENCY_DAYS_ACU: Record<WorldSeedCircle_ACU, number> = { core: 3, medium: 3, edge: 15 };
const COOLDOWN_DAYS_ACU: Record<WorldSeedCircle_ACU, number> = { core: 1, medium: 3, edge: 7 };

export function seedCircle_ACU(seed: WorldSeed_ACU, collidedIds: ReadonlySet<string>): WorldSeedCircle_ACU {
  if (collidedIds.has(seed.id) || seed.visibility === 'public') return 'core';
  if (seed.visibility === 'limited') return 'medium';
  return 'edge';
}

function cooled_ACU(clockDay: number, lastCatalyzed: number, cooldown: number): boolean {
  if (!lastCatalyzed) return true;
  return clockDay - lastCatalyzed >= cooldown;
}

export function progressionPlan_ACU(input: WorldProgressionPlanInput_ACU): WorldProgressionDirective_ACU[] {
  const collided = new Set(input.relevance.collided);
  const day = input.ledger.clock.day;
  const days = input.daysAdvanced;
  return input.ledger.seeds.map(seed => {
    const circle = seedCircle_ACU(seed, collided);
    const expired = seed.expiresAtDay !== null && seed.expiresAtDay < day;
    const last = input.lastCatalyzedAtDayBySeed[seed.id] ?? 0;
    const cool = cooled_ACU(day, last, COOLDOWN_DAYS_ACU[circle]);
    const frequentEnough = cooled_ACU(day, last, FREQUENCY_DAYS_ACU[circle]);
    if (expired || seed.status === 'resolved' || seed.status === 'retired') {
      return { seedId: seed.id, advance: 'none', reason: 'R4 到期或已结束，交清扫不推进', circle };
    }
    if (days <= 0) {
      return { seedId: seed.id, advance: 'tick', reason: 'R1 正文未过时间，只 tick', circle };
    }
    if (!cool) {
      return { seedId: seed.id, advance: 'tick', reason: `R7 ${circle} 圈催化冷却中`, circle };
    }
    if (collided.has(seed.id)) {
      return { seedId: seed.id, advance: 'catalyze', reason: 'R6 碰撞种子本轮优先催化', circle };
    }
    if (!frequentEnough) {
      return { seedId: seed.id, advance: 'tick', reason: `R2 ${circle} 圈未到催化频率`, circle };
    }
    return { seedId: seed.id, advance: 'catalyze', reason: `R2 ${circle} 圈允许催化`, circle };
  });
}
