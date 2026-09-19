import { WORLD_SIMULATION_PROMPT_VERSION_ACU, buildDefaultWorldSimulationAgentPrompts_ACU } from './agent/agent-defaults';
import { WORLD_LEDGER_SCHEMA_VERSION_ACU, WORLD_SIMULATION_SCHEMA_VERSION_ACU, type WorldSimulationEnvelope_ACU, type WorldSimulationLedger_ACU, type WorldSimulationSettings_ACU } from './model';

export function buildDefaultWorldSimulationSettings_ACU(): WorldSimulationSettings_ACU {
  return {
    autoTriggerEnabled: true,
    agentHistoryTokenBudget: 120000,
    agentReadTokenBudget: '20%',
    agentReadFallbackTokens: 6000,
    agentRunBudget: { maxIterations: 12, maxDelegations: 12, maxSameAgent: 4, maxConcurrent: 3, maxReads: 24, maxExtraReads: 3 },
    webResearch: { enabled: false, sources: { moegirl: true, wikipediaZh: true, wikipediaEn: false }, searchProvider: 'duckduckgo', searxngBaseUrl: '', pageCharLimit: 4000, blockedDomains: '' },
    apiPresetMode: 'current',
    fixedApiPresetName: '',
    agentApiPresets: {},
    agentPrompts: buildDefaultWorldSimulationAgentPrompts_ACU(),
    promptForceDefaultVersion: WORLD_SIMULATION_PROMPT_VERSION_ACU,
  };
}

export function buildEmptyWorldSimulationLedger_ACU(): WorldSimulationLedger_ACU {
  return {
    schemaVersion: WORLD_LEDGER_SCHEMA_VERSION_ACU,
    revision: 0,
    clock: { storyTime: '', elapsed: '', precision: 'unknown', evidenceRefs: [] },
    dimensions: [],
    seeds: [],
    actors: [],
    chronicle: [],
    guidance: { signals: [], excludedFacts: [], evidenceRefs: [] },
  };
}

export function buildDefaultWorldSimulationEnvelope_ACU(): WorldSimulationEnvelope_ACU {
  return { schemaVersion: WORLD_SIMULATION_SCHEMA_VERSION_ACU, settings: buildDefaultWorldSimulationSettings_ACU(), task: null, stages: [], activeStageId: null, timeline: [], lastError: null, ledger: buildEmptyWorldSimulationLedger_ACU(), updatedAt: 0 };
}
