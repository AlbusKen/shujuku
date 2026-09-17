import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { applyWorldSimulationProjection_ACU, buildWorldSimulationProjection_ACU, writeWorldSimulationActiveSwipeContent_ACU } from '../../../src/service/simulation/simulation-projection';

describe('world simulation projection', () => {
  it('只替换系统认领块并保留用户同名终端块', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.guidance.signals = ['远处钟声响起'];
    const projection = buildWorldSimulationProjection_ACU(ledger)!;
    const userBlock = '<与此同时>\n用户自有内容\n</与此同时>';
    const first = applyWorldSimulationProjection_ACU(`正文\n\n${userBlock}`, projection);
    expect(first).toContain(userBlock);
    expect(first).toContain('远处钟声响起');
    ledger.guidance.signals = ['新的信号'];
    const replaced = applyWorldSimulationProjection_ACU(first, buildWorldSimulationProjection_ACU(ledger));
    expect(replaced).toContain(userBlock);
    expect(replaced).not.toContain('远处钟声响起');
    expect(replaced.match(/qrf-world-simulation-projection:v1:start/g)).toHaveLength(1);
  });

  it('隐藏投影只移除系统块并同步 active swipe', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.guidance.signals = ['信号'];
    const owned = applyWorldSimulationProjection_ACU('正文', buildWorldSimulationProjection_ACU(ledger));
    expect(applyWorldSimulationProjection_ACU(owned, null)).toBe('正文');
    const message: Record<string, any> = { mes: '旧', swipe_id: 1, swipes: ['a', '旧'] };
    writeWorldSimulationActiveSwipeContent_ACU(message, '新');
    expect(message.mes).toBe('新');
    expect(message.swipes).toEqual(['a', '新']);
  });
});
