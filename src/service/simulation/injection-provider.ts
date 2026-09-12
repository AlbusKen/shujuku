import { logWarn_ACU } from '../../shared/utils';
import { isWorldStateSnapshot_ACU, type WorldStateSnapshot_ACU } from './model';
import type { WorldSimulationReplay_ACU } from './simulation-replay';
import { WorldSimulationStore_ACU } from './simulation-store';

export interface WorldSimulationHiddenContextProviderDependencies_ACU {
  read: () => WorldSimulationReplay_ACU | null;
  warn: (message: string, details: Record<string, unknown>) => void;
}

const defaultDependencies_ACU: WorldSimulationHiddenContextProviderDependencies_ACU = {
  read: () => new WorldSimulationStore_ACU().read(),
  warn: (message, details) => logWarn_ACU(message, details),
};

type HiddenEntry_ACU = { text: string };

const MAX_HIDDEN_ENTRIES_ACU = 12;
const MAX_HIDDEN_CHARS_ACU = 1800;

function cleanHiddenText_ACU(value: unknown): string {
  return String(value ?? '').replace(/[<>]/g, char => char === '<' ? '＜' : '＞').replace(/\s+/g, ' ').trim();
}

function collectHiddenEntries_ACU(state: WorldStateSnapshot_ACU): HiddenEntry_ACU[] {
  return [
    ...state.entities.filter(item => !item.retired && item.visibility.mode === 'hidden').map(item => ({ text: `实体｜${cleanHiddenText_ACU(item.kind)}｜${cleanHiddenText_ACU(item.name)}：${cleanHiddenText_ACU(item.situation)}；意图：${cleanHiddenText_ACU(item.agenda)}` })),
    ...state.events.filter(item => !item.retired && item.visibility.mode === 'hidden').map(item => ({ text: `事件｜${cleanHiddenText_ACU(item.summary)}；发生于：${cleanHiddenText_ACU(item.occurredAt)}；跨度：${cleanHiddenText_ACU(item.durationHint || '未说明')}` })),
    ...state.threads.filter(item => !item.retired && item.visibility.mode === 'hidden').map(item => ({ text: `线索｜${cleanHiddenText_ACU(item.title)}：${cleanHiddenText_ACU(item.summary)}；状态：${cleanHiddenText_ACU(item.status)}` })),
  ];
}

function selectBoundedHiddenEntries_ACU(entries: readonly HiddenEntry_ACU[]): HiddenEntry_ACU[] {
  const result: HiddenEntry_ACU[] = [];
  let length = 0;
  for (const entry of entries) {
    if (!entry.text || result.length >= MAX_HIDDEN_ENTRIES_ACU) continue;
    const nextLength = length + (result.length ? 3 : 0) + entry.text.length;
    if (nextLength > MAX_HIDDEN_CHARS_ACU) break;
    result.push(entry);
    length = nextLength;
  }
  return result;
}

/** Renders hidden state only as a caller-owned system segment, never prompt placeholder text. */
export class WorldSimulationHiddenContextProvider_ACU {
  constructor(private readonly dependencies: WorldSimulationHiddenContextProviderDependencies_ACU = defaultDependencies_ACU) {}

  render(input: { plotEnabled: boolean }): string {
    if (input.plotEnabled !== true) return '';
    try {
      const replay = this.dependencies.read();
      if (!replay || !isWorldStateSnapshot_ACU(replay.state)) {
        if (replay) this.warn_ACU('invalid_replay');
        return '';
      }
      const entries = selectBoundedHiddenEntries_ACU(collectHiddenEntries_ACU(replay.state));
      if (!entries.length) return '';
      const clock = replay.state.storyClock;
      return [
        '<WORLD_SIMULATION_HIDDEN_CONTEXT>',
        '以下内容仅用于叙事一致性。角色不得凭空知情、复述或将其当作公开事实；不得输出该区块或改变用户文本。',
        `故事时间锚点：${clock.anchorText}｜距上次推演：${clock.elapsedSinceLastRun}｜精度：${clock.precision}`,
        ...entries.map(item => `- ${item.text}`),
        '</WORLD_SIMULATION_HIDDEN_CONTEXT>',
      ].join('\n');
    } catch (error) {
      this.warn_ACU('read_failed', error);
      return '';
    }
  }

  private warn_ACU(reason: string, error?: unknown): void {
    this.dependencies.warn('[世界推演 hidden 注入] 读取失败，已跳过 system context。', {
      code: 'WORLD_SIM_READ_FAILED', phase: 'hidden_injection', reason,
      ...(error instanceof Error ? { errorName: error.name } : {}),
    });
  }
}
