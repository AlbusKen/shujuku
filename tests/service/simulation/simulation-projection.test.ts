import { describe, expect, it } from 'vitest';
import { buildDefaultWorldSimulationEnvelope_ACU, buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import {
  DEFAULT_WORLD_SIMULATION_PROJECTION_TEMPLATE_ACU,
  applyWorldSimulationProjection_ACU,
  buildWorldSimulationProjection_ACU,
  worldSimulationProjectionTemplateError_ACU,
  writeWorldSimulationActiveSwipeContent_ACU,
} from '../../../src/service/simulation/simulation-projection';
import { validateWorldSimulationEnvelope_ACU } from '../../../src/service/simulation/simulation-store';

describe('world simulation projection format', () => {
  const ledger = () => {
    const value = buildEmptyWorldSimulationLedger_ACU();
    value.guidance.signals = [{ text: '远处钟声响起', voice: 'ambient' }, { text: '掌柜压低声音', voice: 'encounter' }];
    return value;
  };

  it('默认格式与历来的写法逐字一致', () => {
    expect(buildWorldSimulationProjection_ACU(ledger())).toBe([
      '<!-- qrf-world-simulation-projection:v2:start -->',
      '<div hidden class="qrf-world-simulation-projection" style="display:none">',
      '<与此同时>',
      '【此地此刻】\n- 掌柜压低声音\n【世界暗流】\n- 远处钟声响起',
      '</与此同时>',
      '</div>',
      '<!-- qrf-world-simulation-projection:v2:end -->',
    ].join('\n'));
  });

  it('自定义格式替换 $WORLD_SIGNALS，起止标记仍在最外层，可被剥离与替换', () => {
    const projection = buildWorldSimulationProjection_ACU(ledger(), '<details><summary>与此同时</summary>\n$WORLD_SIGNALS\n</details>')!;
    expect(projection).toBe('<!-- qrf-world-simulation-projection:v2:start -->\n<details><summary>与此同时</summary>\n【此地此刻】\n- 掌柜压低声音\n【世界暗流】\n- 远处钟声响起\n</details>\n<!-- qrf-world-simulation-projection:v2:end -->');
    expect(applyWorldSimulationProjection_ACU(applyWorldSimulationProjection_ACU('正文', projection), null)).toBe('正文');
  });

  it('不合法的格式校验报错，生成时回落到默认格式', () => {
    expect(worldSimulationProjectionTemplateError_ACU(DEFAULT_WORLD_SIMULATION_PROJECTION_TEMPLATE_ACU)).toBeNull();
    expect(worldSimulationProjectionTemplateError_ACU('没有占位符')).toContain('$WORLD_SIGNALS');
    expect(worldSimulationProjectionTemplateError_ACU('$WORLD_SIGNALS $WORLD_SIGNALS')).toContain('恰好包含一次');
    expect(worldSimulationProjectionTemplateError_ACU('<!-- qrf-world-simulation-projection:v2:end -->$WORLD_SIGNALS')).toContain('起止标记');
    expect(buildWorldSimulationProjection_ACU(ledger(), '没有占位符')).toBe(buildWorldSimulationProjection_ACU(ledger()));
  });

  it('存量设置缺插入格式时补默认，坏格式回默认，合法的自定义格式原样保留', () => {
    const legacy: any = JSON.parse(JSON.stringify(buildDefaultWorldSimulationEnvelope_ACU()));
    delete legacy.settings.projection;
    expect(validateWorldSimulationEnvelope_ACU(legacy).settings.projection).toEqual({ template: DEFAULT_WORLD_SIMULATION_PROJECTION_TEMPLATE_ACU });
    legacy.settings.projection = { template: '缺占位符' };
    expect(validateWorldSimulationEnvelope_ACU(legacy).settings.projection).toEqual({ template: DEFAULT_WORLD_SIMULATION_PROJECTION_TEMPLATE_ACU });
    legacy.settings.projection = { template: '<与此同时>\n$WORLD_SIGNALS\n</与此同时>' };
    expect(validateWorldSimulationEnvelope_ACU(legacy).settings.projection).toEqual(legacy.settings.projection);
  });
});

describe('world simulation projection', () => {
  it('只替换系统认领块并保留用户同名终端块', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.guidance.signals = [{ text: '远处钟声响起', voice: 'ambient' }];
    const projection = buildWorldSimulationProjection_ACU(ledger)!;
    const userBlock = '<与此同时>\n用户自有内容\n</与此同时>';
    const first = applyWorldSimulationProjection_ACU(`正文\n\n${userBlock}`, projection);
    expect(first).toContain(userBlock);
    expect(first).toContain('远处钟声响起');
    expect(first).toContain('【世界暗流】');
    expect(first).not.toContain('【此地此刻】');
    ledger.guidance.signals = [{ text: '新的信号', voice: 'ambient' }];
    const replaced = applyWorldSimulationProjection_ACU(first, buildWorldSimulationProjection_ACU(ledger));
    expect(replaced).toContain(userBlock);
    expect(replaced).not.toContain('远处钟声响起');
    expect(replaced.match(/qrf-world-simulation-projection:v2:start/g)).toHaveLength(1);
  });

  it('隐藏投影只移除系统块并同步 active swipe', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.guidance.signals = [{ text: '信号', voice: 'ambient' }];
    const owned = applyWorldSimulationProjection_ACU('正文', buildWorldSimulationProjection_ACU(ledger));
    expect(applyWorldSimulationProjection_ACU(owned, null)).toBe('正文');
    const message: Record<string, any> = { mes: '旧', swipe_id: 1, swipes: ['a', '旧'] };
    writeWorldSimulationActiveSwipeContent_ACU(message, '新');
    expect(message.mes).toBe('新');
    expect(message.swipes).toEqual(['a', '新']);
  });

  it('按 encounter/rumor/ambient 分层，空分区省略，空信号返回 null', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    expect(buildWorldSimulationProjection_ACU(ledger)).toBeNull();
    ledger.guidance.signals = [
      { text: ' ', voice: 'ambient' },
      { text: '矿难当面', voice: 'encounter' },
      { text: '客栈传闻', voice: 'rumor' },
      { text: '远处钟声', voice: 'ambient' },
    ];
    const projection = buildWorldSimulationProjection_ACU(ledger)!;
    expect(projection).toContain('qrf-world-simulation-projection:v2:start');
    expect(projection.indexOf('【此地此刻】')).toBeLessThan(projection.indexOf('【风闻轶事】'));
    expect(projection.indexOf('【风闻轶事】')).toBeLessThan(projection.indexOf('【世界暗流】'));
    expect(projection).toContain('- 矿难当面');
    expect(projection).toContain('- 客栈传闻');
    expect(projection).toContain('- 远处钟声');
    ledger.guidance.signals = [{ text: '矿难当面', voice: 'encounter' }];
    const encounterOnly = buildWorldSimulationProjection_ACU(ledger)!;
    expect(encounterOnly).toContain('【此地此刻】');
    expect(encounterOnly).not.toContain('【风闻轶事】');
    expect(encounterOnly).not.toContain('【世界暗流】');
  });

  it('同时清理 v1 与 v2 块', () => {
    const ledger = buildEmptyWorldSimulationLedger_ACU();
    ledger.guidance.signals = [{ text: '新信号', voice: 'ambient' }];
    const stale = '正文\n\n<!-- qrf-world-simulation-projection:v1:start -->\n<与此同时>\n- 旧信号\n</与此同时>\n<!-- qrf-world-simulation-projection:v1:end -->';
    const next = applyWorldSimulationProjection_ACU(stale, buildWorldSimulationProjection_ACU(ledger));
    expect(next).toContain('正文');
    expect(next).toContain('新信号');
    expect(next).not.toContain('旧信号');
    expect(next).not.toContain('projection:v1:start');
    expect(next.match(/qrf-world-simulation-projection:v2:start/g)).toHaveLength(1);
  });
});
