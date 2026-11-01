import { settings_ACU } from '../runtime/state-manager';
import { callAIWithResolvedPreset_ACU, getApiConfigByPreset_ACU, requireResolvedApiPreset_ACU } from '../ai/api-call';
import { runPlotTasksRuntime_ACU } from '../runtime/plot-runtime/plot-task-engine';
import type { PlotRequestContext_ACU } from '../runtime/plot-runtime/plot-request-context';
import type { AgentWorldbookRef_ACU } from '../agent/agent-decision-engine';
import { tryRenderPlotTemplateWithEjs_ACU, renderPlotTaskContentWithIsolatedVariables_ACU } from '../runtime/plot-runtime/plot-tag-utils';
import { createDetachedSqlTableService_ACU } from '../table/table-storage-strategy';
import { compareWorldbookEntriesForPlaceholder_ACU } from '../worldbook/pipeline';
import { ZeroLayerError_ACU, type ZeroLayerEnvelope_ACU, type ZeroLayerTurn_ACU, type ZeroLayerPlotCandidate_ACU } from './model';
import { readPreparedSimulationCausalView_ACU } from './prepared-simulation-causal-view';
import type { ConfirmedSimulationCausalView_ACU } from './simulation-causal-view';
import { validateZeroLayerEnvelope_ACU, validateZeroLayerPlotCandidate_ACU } from './validation';
import { sha256HexSync_ACU } from '../../shared/sha256-sync';
import { validateWorldSimulationLedger_ACU } from '../simulation/simulation-store';
import { countWorldSimulationTokens_ACU } from '../simulation/agent/agent-token-budget';
import { reviewWorldNarrativeScene_ACU } from '../simulation/agent/world-scene-review';
import { buildPlotInternalCausalMessage_ACU } from '../runtime/plot-runtime/plot-internal-causal';
import { parsePlotInternalCausalResult_ACU, type PlotInternalCausalResult_ACU } from '../runtime/plot-runtime/plot-internal-causal-result';
import { attachPreparedPlotCausalDelivery_ACU, preparePlotCausalDelivery_ACU } from '../runtime/plot-runtime/plot-causal-delivery-bridge';
import { checkpointPath_ACU } from './checkpoint-payload';
import { buildPlotWorldContext_ACU, PLOT_WORLD_SIMULATION_TOKEN_ACU } from '../runtime/plot-runtime/plot-world-context';

function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function freezeDeep_ACU<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep_ACU(child);
  }
  return value;
}

function assertNotAborted_ACU(signal: AbortSignal): void {
  if (signal.aborted) throw new ZeroLayerError_ACU('scope-changed', '剧情请求已中止。');
}

function readCausalViewSnapshot_ACU(
  source: ZeroLayerEnvelope_ACU, turn: ZeroLayerTurn_ACU,
): ConfirmedSimulationCausalView_ACU | null {
  const envelope = validateZeroLayerEnvelope_ACU(source);
  const matches = envelope.turns.filter(item => item.turnId === turn.turnId && item.attemptId === turn.attemptId);
  if (matches.length !== 1 || matches[0].branchId !== envelope.activeBranchId
    || canonicalJson_ACU(matches[0]) !== canonicalJson_ACU(turn)) {
    throw new ZeroLayerError_ACU('revision-conflict', '剧情准备回合与活动会话快照不一致。');
  }
  const branch = envelope.branches.filter(item => item.branchId === envelope.activeBranchId);
  if (branch.length !== 1 || branch[0].branchId !== matches[0].branchId) {
    throw new ZeroLayerError_ACU('revision-conflict', '剧情准备活动分支与回合快照不一致。');
  }
  return readPreparedSimulationCausalView_ACU(envelope, turn.turnId, turn.attemptId);
}

/** 复用任务引擎，只产生请求内候选；不持有物理消息或世界书写权限。 */
export async function prepareZeroLayerPlot_ACU(
  turn: ZeroLayerTurn_ACU, history: readonly Record<string, unknown>[],
  signal: AbortSignal, assertCurrent: () => void, simulationSource?: ZeroLayerEnvelope_ACU,
): Promise<ZeroLayerPlotCandidate_ACU> {
  const checkCurrent = () => {
    assertCurrent();
    assertNotAborted_ACU(signal);
  };
  checkCurrent();
  const frozenTurn = structuredClone(turn);
  const frozenHistory = structuredClone(history);
  const frozenSource = simulationSource === undefined ? undefined : structuredClone(simulationSource);
  const plotSettings = structuredClone(settings_ACU.plotSettings);
  const presetName = String(plotSettings?.lastUsedPresetName || '');
  const candidate: ZeroLayerPlotCandidate_ACU = {
    floorId: frozenTurn.userFloor.floorId, presetName, outcome: 'disabled',
    finalMessage: null, content: '', taskContents: {}, finalPrompts: [], filterEntries: [], agentActive: false,
  };
  const plotEnabled = plotSettings?.enabled === true;
  if (!plotEnabled && frozenTurn.simulationDeliveryTarget === 'plot') return candidate;
  const simulationCausalView = frozenSource === undefined ? null : freezeDeep_ACU(structuredClone(
    readCausalViewSnapshot_ACU(frozenSource, frozenTurn),
  ));
  const bodyAlreadyInHistory = simulationCausalView && frozenSource?.turns.some(turn =>
    turn.turnId === simulationCausalView.source.turnId && turn.attemptId === simulationCausalView.source.attemptId
    && (turn.assistantFloor.data.simulation as { delivery?: string } | undefined)?.delivery === 'body');
  // 显式 token 只认冻结配置中的原始任务提示词；正文投送或没有已确认因果回执时也可读当前已保存账本。
  const usesWorldSimulationToken = plotEnabled && plotSettings?.plotTasks?.some((task: Record<string, any>) =>
    task.enabled !== false && task.internalCausalRead !== true
    && task.promptGroup?.some((segment: { content?: unknown }) =>
      typeof segment?.content === 'string' && segment.content.includes(PLOT_WORLD_SIMULATION_TOKEN_ACU))) === true;
  const frozenLedger = frozenTurn.materialBaseline?.simulation?.envelope?.ledger;
  const plotWorldContext = plotEnabled && frozenLedger
    && ((frozenTurn.simulationDeliveryTarget === 'plot' && simulationCausalView) || usesWorldSimulationToken)
    ? (() => {
      const current = validateWorldSimulationLedger_ACU(frozenLedger, 'load');
      // 仅可信的已发布父回合允许计算差异；否则本轮变化明确标为 unavailable。
      const sourceTurn = simulationCausalView && frozenSource?.turns.find(item => item.turnId === simulationCausalView.source.turnId
        && item.attemptId === simulationCausalView.source.attemptId);
      const previous = sourceTurn?.materialBaseline?.simulation?.envelope?.ledger;
      const previousRevision = frozenTurn.materialBaseline?.simulation?.envelope?.task?.completedRun?.baseLedgerRevision;
      const previousLedger = previous && previousRevision === previous.revision
        ? validateWorldSimulationLedger_ACU(previous, 'load') : null;
      const summary = sourceTurn
        ? (sourceTurn.assistantFloor.data.simulation as { summary: string }).summary : '';
      return freezeDeep_ACU(buildPlotWorldContext_ACU({ ledger: current, previousLedger, summary }));
    })() : null;
  if (!plotEnabled && !simulationCausalView) return candidate;
  if (!frozenTurn.tableInput) throw new ZeroLayerError_ACU('effects-pending', '剧情准备缺少本轮表格快照。');
  const input = frozenTurn.tableInput;
  const streaming = settings_ACU.streamingEnabled === true;
  const defaultPreset = String(settings_ACU.plotApiPreset || '').trim();
  const overrides = structuredClone(settings_ACU.plotTaskApiPresetOverridesById || {});
  const presets = new Map<string, ReturnType<typeof getApiConfigByPreset_ACU>>();
  // 在任何异步操作前冻结渠道；Agent 从世界书取得的名字只能命中这份快照。
  for (const name of new Set<string>(['', ...(settings_ACU.apiPresets || []).map((preset: { name: string }) => preset.name)])) {
    presets.set(name, structuredClone(getApiConfigByPreset_ACU(name)));
  }
  const provider = input.storageMode === 'sqlite' ? createDetachedSqlTableService_ACU() : null;
  try {
    if (provider) {
      const loaded = await provider.loadFromData(structuredClone(input.tableData));
      checkCurrent();
      if (loaded.error || !provider.isReady()) throw new ZeroLayerError_ACU('effects-pending', '剧情独立 SQLite 快照未就绪。');
    }
    const tableData = provider?.getCurrentDataStrict_ACU() ?? structuredClone(input.tableData);
    const entries: Record<string, any>[] = [];
    const internalResults: PlotInternalCausalResult_ACU[] = [];

    const requestContext: PlotRequestContext_ACU = {
      history: frozenHistory, tableData, presetName, signal,
      sqlReadContext: provider ? { provider, mapper: provider.createReadNameMapper_ACU(), tableData } : null,
      ejsContext: { chat: structuredClone(frozenHistory), allTablesJson: structuredClone(tableData), userMessage: frozenTurn.input },
      finalPromptEntries: entries, assertCurrent: checkCurrent,
      acceptInternalCausalResult(result) {
        checkCurrent();
        if (!simulationCausalView || result.viewFingerprint !== simulationCausalView.fingerprint) {
          throw new ZeroLayerError_ACU('revision-conflict', '内部因果结果不属于本轮冻结资料。');
        }
        internalResults.push(structuredClone(result));
      },
      readSimulationCausalView: simulationCausalView === null ? undefined : () => {
        checkCurrent();
        return structuredClone(simulationCausalView);
      },
      readWorldSimulationContext: plotWorldContext === null ? undefined : () => {
        checkCurrent();
        return structuredClone(plotWorldContext);
      },
      resolveTaskApiPreset: task => String(overrides[String(task.id || '')] || task.taskApiPreset || defaultPreset).trim(),
      async callInternalApi(messages, name) {
        checkCurrent();
        const resolved = presets.get(name);
        if (!resolved) throw new ZeroLayerError_ACU('effects-pending', '内部剧情 API 预设不在本轮冻结配置中。');
        requireResolvedApiPreset_ACU(name, resolved);
        if (resolved.apiMode !== 'custom' || !resolved.apiConfig.url || !resolved.apiConfig.model) {
          throw new ZeroLayerError_ACU('effects-pending', '内部剧情必须配置数据库独立 API。');
        }
        let response: string | null;
        try {
          response = await callAIWithResolvedPreset_ACU(messages,
            { ...resolved, apiConfig: { ...resolved.apiConfig, useMainApi: false } }, signal, undefined,
            { streaming: false, requireDirectTransport: true, suppressPayloadLogging: true });
        } catch {
          checkCurrent();
          throw new ZeroLayerError_ACU('effects-pending', '内部剧情 API 调用失败。');
        }
        checkCurrent();
        if (!response?.trim()) throw new ZeroLayerError_ACU('effects-pending', '内部剧情 API 未返回有效文本。');
        return response;
      },
      async callApi(messages, name) {
        checkCurrent();
        const resolved = presets.get(name);
        if (!resolved) throw new ZeroLayerError_ACU('effects-pending', '剧情 API 预设不在本轮冻结配置中。');
        requireResolvedApiPreset_ACU(name, resolved);
        if (resolved.apiMode !== 'custom' || !resolved.apiConfig.url || !resolved.apiConfig.model) {
          throw new ZeroLayerError_ACU('effects-pending', '零层剧情必须配置数据库独立 API。');
        }
        const response = await callAIWithResolvedPreset_ACU(messages,
          { ...resolved, apiConfig: { ...resolved.apiConfig, useMainApi: false } }, signal, undefined,
          { streaming });
        checkCurrent();
        if (!response?.trim()) throw new ZeroLayerError_ACU('effects-pending', '剧情 API 未返回有效文本。');
        return response;
      },
    };
    const buildDelivery = async () => {
      const priorDeliveries = frozenSource ? checkpointPath_ACU(frozenSource, frozenTurn.branchId)
        .flatMap(item => item.worldDelivery?.records ?? []) : [];
      const selectedFactIds = [...new Set(internalResults.flatMap(item => item.selectedFactIds))].filter(id => {
        const attempts = priorDeliveries.filter(item => item.factIds.includes(id));
        return attempts.length === 0;
      });
      if (!selectedFactIds.length || !simulationCausalView || !frozenSource) return null;
      const sourceTurn = frozenSource.turns.find(item => item.turnId === simulationCausalView.source.turnId
        && item.attemptId === simulationCausalView.source.attemptId)!;
      const ledger = validateWorldSimulationLedger_ACU(frozenTurn.materialBaseline!.simulation!.envelope!.ledger, 'load');
      const chatIdentity = JSON.stringify(['zero-layer-simulation',
        JSON.stringify([frozenSource.scope.characterKey, frozenSource.scope.chatId]), frozenSource.sessionId, frozenTurn.branchId]);
      const sourceAnchor = { kind: 'logical' as const, chatIdentity,
        logicalRef: structuredClone(simulationCausalView.source), contentDigest: sha256HexSync_ACU(sourceTurn.body!) };
      const targetAnchor = { kind: 'logical' as const, chatIdentity,
        logicalRef: { sessionId: frozenSource.sessionId, branchId: frozenTurn.branchId, turnId: frozenTurn.turnId,
          attemptId: frozenTurn.attemptId, floorId: frozenTurn.assistantFloor.floorId },
        contentDigest: sha256HexSync_ACU(frozenTurn.input) };
      const scene = await reviewWorldNarrativeScene_ACU({ ledger,
        settings: frozenTurn.materialBaseline!.simulation!.envelope!.settings, anchor: sourceAnchor, anchorText: sourceTurn.body!,
        needsSemanticReview: false, signal, assertCurrent: checkCurrent,
        invoke: async messages => {
          const response = await requestContext.callInternalApi!([...messages], defaultPreset);
          if (response === null) throw new ZeroLayerError_ACU('effects-pending', '场景判断未返回有效结果。');
          return response;
        } });
      checkCurrent();
      const delivery = preparePlotCausalDelivery_ACU({ ledger, sourceAnchor, targetAnchor, anchorText: sourceTurn.body!,
        selectedFactIds, sceneReceipt: scene.receipt, signal, assertCurrent: checkCurrent });
      if (!delivery) return null;
      const tokenCount = await countWorldSimulationTokens_ACU(delivery.message);
      checkCurrent();
      if (!Number.isFinite(tokenCount) || tokenCount <= 0 || tokenCount > 4096) {
        throw new ZeroLayerError_ACU('effects-pending', '场景事实投送超出预算。');
      }
      return delivery;
    };
    let bodyDelivery: Awaited<ReturnType<typeof buildDelivery>> = null;
    checkCurrent();
    if (simulationCausalView && !bodyAlreadyInHistory && frozenTurn.simulationDeliveryTarget !== 'plot'
      && !plotSettings?.plotTasks?.some((task: Record<string, unknown>) => task.enabled !== false && task.internalCausalRead === true)) {
      const message = await buildPlotInternalCausalMessage_ACU(simulationCausalView, { signal, assertCurrent: checkCurrent });
      const response = await requestContext.callInternalApi!([
        { role: 'user', content: `依据既有因果和本轮意图选择应参与剧情规划的既有事实，不把意图当已发生事件。\n${frozenTurn.input}` }, message,
      ], defaultPreset);
      checkCurrent();
      internalResults.push(parsePlotInternalCausalResult_ACU(response!, simulationCausalView));
      bodyDelivery = await buildDelivery();
    }
    requestContext.readSafeCausalFacts = () => bodyDelivery?.message ?? '';
    const result = plotEnabled
      ? await runPlotTasksRuntime_ACU(plotSettings, frozenTurn.input, { requestContext, inputForHash: frozenTurn.input })
      : { successfulResults: [] as Array<{ taskId: string; rawResponse: string }>, failedResults: [] as unknown[],
        finalMessage: null as string | null, saveContent: '', agentActive: false };
    checkCurrent();
    if (result.failedResults.length || ('apiRetriesExhausted' in result && result.apiRetriesExhausted)) {
      throw new ZeroLayerError_ACU('effects-pending', '剧情任务未全部完成，正文请求未发送。');
    }
    candidate.outcome = result.successfulResults.length ? 'generated' : 'no-tasks';
    candidate.finalMessage = result.finalMessage;
    candidate.content = 'saveContent' in result ? String(result.saveContent || '') : '';
    for (const task of result.successfulResults) {
      Object.defineProperty(candidate.taskContents, task.taskId, {
        value: task.rawResponse, enumerable: true, writable: true, configurable: true,
      });
    }
    candidate.agentActive = 'agentActive' in result && result.agentActive === true;
    if (candidate.agentActive) {
      const refs = 'finalGenerationGreenlights' in result ? result.finalGenerationGreenlights : [];
      await prepareFinalPrompts_ACU(candidate, entries, refs, requestContext);
      checkCurrent();
    }
    const delivery = frozenTurn.simulationDeliveryTarget !== 'plot' && !bodyAlreadyInHistory ? bodyDelivery ?? await buildDelivery() : null;
    if (delivery) {
      candidate.finalMessage = [candidate.finalMessage, delivery.message].filter(Boolean).join('\n\n');
      if (candidate.outcome !== 'generated') {
        candidate.outcome = 'generated';
        candidate.content = delivery.message;
      }
      attachPreparedPlotCausalDelivery_ACU(candidate, delivery.manifest);
    }
    checkCurrent();
    validateZeroLayerPlotCandidate_ACU(candidate, frozenTurn.userFloor.floorId);
    return candidate;
  } finally { provider?.dispose(); }
}

async function prepareFinalPrompts_ACU(
  candidate: ZeroLayerPlotCandidate_ACU, entries: Record<string, any>[],
  refs: AgentWorldbookRef_ACU[], context: PlotRequestContext_ACU,
): Promise<void> {
  const keyOf = (entry: { bookName: string; uid: string | number }) => `${entry.bookName}\u0000${entry.uid}`;
  const allowed = new Set(refs.map(keyOf));
  const found = new Set<string>();
  for (const entry of [...entries].sort(compareWorldbookEntriesForPlaceholder_ACU)) {
    context.assertCurrent();
    const content = typeof entry.content === 'string' ? entry.content : '';
    const comment = String(entry.comment || entry.rawComment || entry.name || '');
    candidate.filterEntries.push({ content, comment });
    const key = keyOf(entry as { bookName: string; uid: string | number });
    if (!allowed.has(key) || found.has(key)) continue;
    found.add(key);
    let position: ZeroLayerPlotCandidate_ACU['finalPrompts'][number]['position'];
    let role: ZeroLayerPlotCandidate_ACU['finalPrompts'][number]['role'] = 'system';
    switch (String(entry.position ?? '').toLowerCase()) {
      case 'before_character_definition': case 'before_char': case 'before_character': case '0':
        position = 'before_character_definition'; break;
      case 'after_character_definition': case 'after_char': case 'after_character': case '1':
        position = 'after_character_definition'; break;
      case 'at_depth_as_system': case 'system': case '4':
        position = 'at_depth';
        if (entry.role === 1 || entry.role === 'user') role = 'user';
        else if (entry.role === 2 || entry.role === 'assistant') role = 'assistant';
        else if (entry.role !== undefined && entry.role !== 0 && entry.role !== 'system') {
          throw new ZeroLayerError_ACU('effects-pending', '正文世界书角色不受支持。');
        }
        break;
      default: throw new ZeroLayerError_ACU('effects-pending', '正文世界书位置不受支持，拒绝猜测注入位置。');
    }
    const depth = position === 'at_depth' ? Number(entry.depth) : 0;
    if (!Number.isSafeInteger(depth) || depth < 0) {
      throw new ZeroLayerError_ACU('effects-pending', '正文世界书深度无效。');
    }
    const rendered = await tryRenderPlotTemplateWithEjs_ACU(content, context);
    context.assertCurrent();
    const text = renderPlotTaskContentWithIsolatedVariables_ACU(rendered, {
      requestContext: context, allTablesJson: context.tableData,
      seedContentForConditional: context.ejsContext.userMessage, lastPlotContent: candidate.content,
    });
    if (text.trim()) candidate.finalPrompts.push({ role, content: text, position, depth });
  }
  if ([...allowed].some(key => !found.has(key))) {
    throw new ZeroLayerError_ACU('effects-pending', '正文绿灯条目不在本轮冻结目录中，拒绝遗漏注入。');
  }
}