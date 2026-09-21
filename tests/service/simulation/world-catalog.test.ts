import { describe, expect, it } from 'vitest';
import { buildEmptyWorldSimulationLedger_ACU } from '../../../src/service/simulation/defaults';
import { eventFingerprint_ACU } from '../../../src/service/simulation/event-similarity';
import { WORLD_CHRONICLE_HOT_WINDOW_ACU, type WorldSimulationLedger_ACU } from '../../../src/service/simulation/model';
import {
  WORLD_CATALOG_READ_HINT_ACU,
  WORLD_SUBAGENT_DEDUP_HINT_ACU,
  buildInUseWorldCatalog_ACU,
  catalogArchiveHints_ACU,
  sliceModuleCatalog_ACU,
  summarizeCandidatePatches_ACU,
} from '../../../src/service/simulation/world-catalog';
import { createWorldSimulationPlaceholderResolvers_ACU } from '../../../src/service/simulation/agent/agent-placeholder-resolver';
import { createWorldSimulationEvidenceRegistry_ACU, snapshotWorldSimulationEvidenceRegistry_ACU } from '../../../src/service/simulation/world-simulation-evidence-registry';
import { WORLD_SIMULATION_TOOL_ADDRESSES_ACU } from '../../../src/service/simulation/world-simulation-agent-tools';

const seed = (id: string, title: string, region = '北岭') => ({
  id, title, status: 'active' as const, level: 10, catalyst: '', visibility: 'hidden' as const, actorIds: [] as string[],
  location: { region }, expiresAtDay: 20, missedOutcome: null, exposePolicy: 'on_collision' as const,
  evidenceRefs: [] as string[], retiredReason: null, revision: 0,
});
const actor = (id: string, name: string) => ({
  id, name, interests: [] as string[], location: '北岭', locationRef: { region: '北岭' },
  life: 'alive' as const, diedAtDay: null, deathSummary: null, resources: [] as string[], goals: [] as string[],
  constraints: [] as string[], informationSources: [] as string[], knownFacts: [] as string[], visibility: 'public' as const, revision: 0,
});
const fatLedger = (): WorldSimulationLedger_ACU => {
  const ledger = buildEmptyWorldSimulationLedger_ACU();
  ledger.seeds = Array.from({ length: 40 }, (_, index) => seed(`seed-${index}`, `暗流${index}`));
  ledger.actors = Array.from({ length: 40 }, (_, index) => actor(`actor-${index}`, `人物${index}`));
  ledger.rumors = Array.from({ length: 20 }, (_, index) => ({
    id: `rumor-${index}`, fact: `传闻${index}`, originDay: 1, earliestRevealDay: 2, channels: ['北岭'],
    relatedActorIds: [], status: 'ripe' as const, revealedAtDay: null, revision: 0,
  }));
  ledger.chronicle = Array.from({ length: WORLD_CHRONICLE_HOT_WINDOW_ACU + 8 }, (_, index) => ({
    id: `ch-${index}`, at: `第${index + 1}日`, summary: `编年${index} `.repeat(40), relatedIds: [], evidenceRefs: [],
  }));
  ledger.chronicleOverview = [{
    fingerprint: eventFingerprint_ACU('北岭矿洞塌方', '第三日', ['seed-0']),
    day: 3,
    oneLine: '北岭矿洞塌方压伤三人',
    archiveRef: 'arc-mine',
  }];
  return ledger;
};

describe('world catalog injection', () => {
  it('主会话目录含在用行与 read 地址，不含归档 overview', () => {
    const ledger = fatLedger();
    const catalog = buildInUseWorldCatalog_ACU(ledger);
    expect(catalog.readHint).toBe(WORLD_CATALOG_READ_HINT_ACU);
    expect(catalog.seeds[0]).toMatchObject({ id: 'seed-0', readAddress: 'seeds:seed-0' });
    expect(catalog.chronicleHot).toHaveLength(WORLD_CHRONICLE_HOT_WINDOW_ACU);
    expect(catalog.chronicleHot.at(-1)?.readAddress).toBe(`chronicle:ch-${ledger.chronicle.length - 1}`);
    expect(JSON.stringify(catalog)).not.toContain('chronicleOverview');
    expect(JSON.stringify(catalog)).not.toContain('arc-mine');

    const resolvers = createWorldSimulationPlaceholderResolvers_ACU({
      task: {}, history: [], runtimeContext: {}, agentCatalog: [],
      toolCatalog: WORLD_SIMULATION_TOOL_ADDRESSES_ACU, evidence: [], userGuidance: '',
      worldState: ledger, anchorMessage: '正文', anchorIdentity: {}, worldStagePlan: {},
      worldChronicle: ledger.chronicle, worldCandidates: [], worldCollisions: {},
      evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(createWorldSimulationEvidenceRegistry_ACU('catalog')),
      projectionPreview: {},
    });
    const state = resolvers['$WORLD_STATE']();
    const chronicle = resolvers['$WORLD_CHRONICLE']();
    const tools = resolvers['$WORLD_TOOL_CATALOG']();
    expect(state).toContain('seeds:seed-0');
    expect(state).not.toContain('chronicleOverview');
    expect(state).not.toContain('arc-mine');
    expect(chronicle).toContain('chronicle:');
    expect(chronicle).not.toContain('arc-mine');
    expect(tools).toContain('目录中任一条目可通过 read 工具按地址调阅详细信息');
  });

  it('子代理切片含模块在用目录、归档概览与 similar hints', () => {
    const ledger = fatLedger();
    const catalog = buildInUseWorldCatalog_ACU(ledger);
    const slice = sliceModuleCatalog_ACU(catalog, ledger.chronicleOverview, ['chronicle', 'seeds']);
    expect(slice.seeds).toEqual(catalog.seeds);
    expect(slice.actors).toBeUndefined();
    expect(slice.dedupHint).toBe(WORLD_SUBAGENT_DEDUP_HINT_ACU);
    expect(slice.chronicleOverview).toEqual([expect.objectContaining({
      archiveRef: 'arc-mine',
      readAddress: 'chronicle-archive:arc-mine',
      oneLine: '北岭矿洞塌方压伤三人',
    })]);
    const hints = catalogArchiveHints_ACU([{
      patch: { chronicle: { append: [{ summary: '北岭矿洞今夜塌方压伤了三人', at: '第四日', relatedIds: ['seed-other'] }] } },
    }], ledger.chronicleOverview);
    expect(hints).toEqual([expect.objectContaining({ level: 'similar', matchedDay: 3, matchedOneLine: '北岭矿洞塌方压伤三人' })]);

    const resolvers = createWorldSimulationPlaceholderResolvers_ACU({
      task: {}, history: [], runtimeContext: {}, agentCatalog: [],
      toolCatalog: WORLD_SIMULATION_TOOL_ADDRESSES_ACU, evidence: [], userGuidance: '',
      worldState: ledger, anchorMessage: '正文', anchorIdentity: {}, worldStagePlan: {},
      worldChronicle: ledger.chronicle,
      worldCandidates: [{
        candidateId: 'candidate:1', agentName: 'world-analyst', summary: '归档对照',
        patch: { chronicle: { append: [{ summary: '北岭矿洞今夜塌方压伤了三人', at: '第四日', relatedIds: ['seed-other'] }] } },
      }],
      worldCollisions: {},
      evidenceRegistry: snapshotWorldSimulationEvidenceRegistry_ACU(createWorldSimulationEvidenceRegistry_ACU('slice')),
      projectionPreview: {},
      writableModules: ['chronicle', 'seeds'],
    });
    const state = resolvers['$WORLD_STATE']();
    expect(state).toContain('chronicle-archive:arc-mine');
    expect(state).toContain('similar');
    expect(state).toContain(WORLD_SUBAGENT_DEDUP_HINT_ACU);
  });

  it('大规模账本的主会话目录远小于全文，候选对 director 只给 diff 摘要', () => {
    const ledger = fatLedger();
    const catalogJson = JSON.stringify(buildInUseWorldCatalog_ACU(ledger));
    const fullJson = JSON.stringify(ledger);
    expect(catalogJson.length).toBeLessThan(fullJson.length / 2);
    const summary = summarizeCandidatePatches_ACU([{
      candidateId: 'candidate:1',
      agentName: 'world-analyst',
      summary: '推进',
      patch: { clock: { days: 1 }, chronicle: { append: [{ id: 'ch-x' }] }, chronicleArchive: { overviewRows: [{ archiveRef: 'arc-1' }] } },
    }]);
    expect(summary).toEqual([expect.objectContaining({
      candidateId: 'candidate:1',
      diff: { clock: 'keys:days', chronicle: 'append+1', chronicleArchive: 'archive+1' },
    })]);
    expect(JSON.stringify(summary)).not.toContain('ch-x');
  });
});
