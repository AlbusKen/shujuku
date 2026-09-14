export const AGENT_STORY_OVERVIEW_COMMENT_SUFFIX_ACU = 'TavernDB-ACU-CustomExport-纪要索引';
export const AGENT_STORY_OVERVIEW_STATES_ACU = ['ready', 'empty', 'missing', 'failed', 'invalid'] as const;
export type AgentStoryOverviewState_ACU = typeof AGENT_STORY_OVERVIEW_STATES_ACU[number];
export interface AgentStoryOverviewProviderResult_ACU {
  state: AgentStoryOverviewState_ACU; content: string; digest: string; diagnostic: string; worldbookName: string | null; comment: string;
}
export interface AgentStoryOverviewProviderDependencies_ACU {
  resolveTarget: () => Promise<string | null>;
  getIsolationPrefix: () => string;
  readEntries: (worldbookName: string) => Promise<unknown[]>;
}
function fingerprint_ACU(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function result_ACU(state: AgentStoryOverviewState_ACU, content: string, diagnostic: string, worldbookName: string | null, comment: string): AgentStoryOverviewProviderResult_ACU {
  return { state, content, diagnostic, worldbookName, comment, digest: fingerprint_ACU(`${state}\n${content}\n${diagnostic}\n${worldbookName ?? ''}\n${comment}`) };
}
function record_ACU(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/**
 * 唯一事件概要来源：当前注入目标世界书中由数据库生成、并可能被交火覆盖的纪要索引条目。
 * 不重建表格，也不根据交火开关猜测内容；读到的就是当前宿主实际会注入的版本。
 */
export class AgentStoryOverviewProvider_ACU {
  constructor(private readonly dependencies: AgentStoryOverviewProviderDependencies_ACU) {}

  async read(): Promise<AgentStoryOverviewProviderResult_ACU> {
    const comment = `${this.dependencies.getIsolationPrefix()}${AGENT_STORY_OVERVIEW_COMMENT_SUFFIX_ACU}`;
    let worldbookName: string | null = null;
    try {
      worldbookName = await this.dependencies.resolveTarget();
      if (!worldbookName) return result_ACU('missing', '', '当前没有可读取的注入目标世界书。', null, comment);
      const entries = await this.dependencies.readEntries(worldbookName);
      if (!Array.isArray(entries)) return result_ACU('invalid', '', '世界书读取返回的条目集合不是数组。', worldbookName, comment);
      const matches = entries.filter(record_ACU).filter(entry => entry.comment === comment);
      if (matches.length === 0) return result_ACU('missing', '', `当前目标世界书中不存在数据库生成的纪要索引条目（${comment}）。`, worldbookName, comment);
      if (matches.length !== 1 || typeof matches[0].content !== 'string') return result_ACU('invalid', '', '纪要索引条目重复或 content 不是字符串。', worldbookName, comment);
      const content = String(matches[0].content).trim();
      return content
        ? result_ACU('ready', content, '', worldbookName, comment)
        : result_ACU('empty', '', '纪要索引条目存在但当前没有内容。', worldbookName, comment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return result_ACU('failed', '', `读取纪要索引失败：${message}`, worldbookName, comment);
    }
  }
}

export function renderAgentStoryOverviewProviderResult_ACU(result: AgentStoryOverviewProviderResult_ACU | null | undefined): string {
  if (!result) return '事件概览尚未在本次运行起点装配，不能回退读取纪要表。';
  if (result.state === 'ready') return result.content;
  if (result.state === 'empty') return '当前纪要索引为空：尚无可用的事件概要。';
  return `事件概览不可用（${result.state}）：${result.diagnostic}`;
}