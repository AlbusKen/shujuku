import { getCurrentCharacterWorldbookBinding_ACU } from '../../data/gateways/character-gateway';
import { getIsolationPrefix_ACU, getInjectionTargetLorebook_ACU } from '../worldbook/injection-engine-state';
import { buildCombinedWorldbookContentByStrategy_ACU, getLorebookEntriesByNames_ACU } from '../worldbook/pipeline';
import { getCurrentWorldbookConfig_ACU } from '../settings/settings-readers';
import { logWarn_ACU } from '../../shared/utils';

export interface ContinuationWorldbookAdapterDependencies_ACU {
  resolveRelevantBookNames: () => Promise<string[]>;
  resolveInjectionTarget: () => Promise<string | null>;
  getIsolationPrefix: () => string;
  buildRelevantWorldbookContent: (options: Record<string, unknown>) => Promise<string>;
  readLorebookEntries: (bookNames: string[]) => Promise<Record<string, unknown[]>>;
  logReadFailure: (phase: 'background' | 'history') => void;
}

const AM_CODE_PATTERN_ACU = /^AM\d+$/i;

/** 归一化 AM 码（纪要地址码）；非法返回 null。同时供 Agent 世界书读取工具使用。 */
export function normalizeAmCode_ACU(value: unknown): string | null {
  const code = String(value ?? '').trim().toUpperCase();
  return AM_CODE_PATTERN_ACU.test(code) ? code : null;
}

/** 去掉隔离前缀后的条目显示名。 */
export function normalizeGeneratedComment_ACU(entry: Record<string, unknown>, isolationPrefix: string): string {
  const raw = String(entry.comment ?? entry.name ?? '').trim();
  return isolationPrefix && raw.startsWith(isolationPrefix) ? raw.slice(isolationPrefix.length) : raw;
}

/** 纪要索引和数字分片由纪要快照负责；普通表格的索引不得误屏蔽。 */
export function isSummaryIndexEntryComment_ACU(comment: string): boolean {
  return /^TavernDB-ACU-CustomExport-纪要索引(?:-[1-9]\d*)?$/.test(comment);
}

/** 是否为纪要（总结）条目的显示名。 */
export function isSummaryEntryComment_ACU(comment: string): boolean {
  return /^(?:总结条目|小总结条目)\d+$/.test(comment);
}

function isGeneratedEntryComment_ACU(comment: string): boolean {
  // 纪要由快照显示；其他已启用世界书条目（包括表格导出）仍由世界书方案决定是否注入。
  return isSummaryIndexEntryComment_ACU(comment) || isSummaryEntryComment_ACU(comment);
}

/** 解析当前生效的世界书名单（手动选择或角色绑定）。同时供 Agent 世界书读取工具使用。 */
export async function resolveRelevantBookNames_ACU(): Promise<string[]> {
  const config = getCurrentWorldbookConfig_ACU();
  if (config?.source === 'manual') {
    const manualSelection: unknown[] = Array.isArray(config.manualSelection)
      ? config.manualSelection
      : [];
    return [...new Set(manualSelection
      .map((name: unknown) => String(name ?? '').trim())
      .filter(Boolean))];
  }
  return (await getCurrentCharacterWorldbookBinding_ACU()).orderedNames;
}

// 依赖表里的函数一律延迟绑定：直接引用会在模块求值时就解析 pipeline 的导出，
// 让「谁先被 import」决定本模块能否加载。改成调用时解析后，加载顺序不再影响可用性。
const defaultDependencies_ACU: ContinuationWorldbookAdapterDependencies_ACU = {
  resolveRelevantBookNames: resolveRelevantBookNames_ACU,
  resolveInjectionTarget: () => getInjectionTargetLorebook_ACU(),
  getIsolationPrefix: () => getIsolationPrefix_ACU(),
  buildRelevantWorldbookContent: options => buildCombinedWorldbookContentByStrategy_ACU(options),
  readLorebookEntries: bookNames => getLorebookEntriesByNames_ACU(bookNames),
  logReadFailure: phase => logWarn_ACU('[Continuation] 世界书只读失败。', { phase, error: { category: 'read_failed' } }),
};

/**
 * Continuation 的只读世界书 seam。它只读取当前注入目标世界书，绝不调度剧情任务或写入宿主状态。
 */
export class ContinuationWorldbookContext_ACU {
  constructor(private readonly dependencies: ContinuationWorldbookAdapterDependencies_ACU = defaultDependencies_ACU) {}

  async readRelevantBackground(scanText: string): Promise<string> {
    try {
      const bookNames = await this.dependencies.resolveRelevantBookNames();
      if (!bookNames.length) return '';
      const isolationPrefix = this.dependencies.getIsolationPrefix();
      return await this.dependencies.buildRelevantWorldbookContent({
        logPrefix: '[Continuation]',
        bookNames,
        baseScanText: typeof scanText === 'string' ? scanText : '',
        excludeEntry: (entry: Record<string, unknown>) => isGeneratedEntryComment_ACU(normalizeGeneratedComment_ACU(entry, isolationPrefix)),
        formatEntry: (entry: Record<string, unknown>) => String(entry.content ?? '').trim(),
      });
    } catch {
      this.dependencies.logReadFailure('background');
      return '';
    }
  }
}
