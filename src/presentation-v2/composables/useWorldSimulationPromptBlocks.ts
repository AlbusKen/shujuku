/**
 * presentation-v2/composables/useWorldSimulationPromptBlocks.ts — 世界推演提示词块语义
 *
 * v6 布局把每个持久化 segment 映射为一个具名块：名称、类型（引擎占位符/引擎锚点/
 * 用户自定义指导）、用途描述与锁定状态。锁定块（引擎锚点/内置占位符）在 UI 中
 * 不可改 role、内容，不可删除、不可禁用，只允许调整位置；用户自定义指导段保持
 * 完整编辑能力。
 */

import { buildDefaultWorldSimulationAgentGuidance_ACU, buildDefaultWorldSimulationAgentPrompts_ACU, WORLD_SIMULATION_AGENT_PROMPT_PLACEHOLDERS_ACU } from '../../service/simulation/defaults';
import type { WorldSimulationAgentName_ACU, WorldSimulationPromptSegment_ACU } from '../../service/simulation/model';

export interface WorldSimulationPromptBlockView_ACU {
  index: number;
  /** UI 显示名；占位符 token 不作为普通正文展示。 */
  name: string;
  kind: 'placeholder' | 'anchor' | 'custom';
  /** kind=placeholder 时给出对应 token，用于折叠展示而不是裸 token 正文。 */
  token?: string;
  role: WorldSimulationPromptSegment_ACU['role'];
  description: string;
  locked: boolean;
  /** kind=custom 时返回可编辑正文；其余为空。 */
  editableContent?: string;
}

/** 与 settings 迁移一致的默认静态识别：与 defaults/simulation-settings 保持同源。 */
function defaultStaticContents_ACU(agent: WorldSimulationAgentName_ACU): Set<string> {
  return new Set(buildDefaultWorldSimulationAgentPrompts_ACU()[agent].map(segment => segment.content));
}

const KNOWN_PLACEHOLDERS_ACU = new Set<string>(WORLD_SIMULATION_AGENT_PROMPT_PLACEHOLDERS_ACU);

const PLACEHOLDER_META_ACU: Record<string, { name: string; description: string }> = {
  '$WORLD_SIMULATION_ROOT': { name: '世界推演宪章', description: '稳定 system 层：世界认知、事实层级与角色权限。' },
  '$WORLD_SIMULATION_SPECIALIST_RULES': { name: '领域检查矩阵', description: '仅子代理：模块内领域检查矩阵。' },
  '$WORLD_SIMULATION_PROTOCOL': { name: '动作协议', description: '严格的输出动作协议（引擎内容，v6 起为 system 角色）。' },
  '$WORLD_SIMULATION_WORKFLOW_RULES': { name: '工作流补充', description: '资料定位与派工补充规则（v6 起为 system 角色）。' },
  '$WORLD_SIMULATION_HISTORY': { name: '真实 run 历史锚点', description: '真实对话历史注入点；不可改 role/内容，不可删除或禁用。' },
  '$WORLD_SIMULATION_RUNTIME_CONTEXT': { name: '运行时上下文', description: '单一冻结运行上下文 user 段；不可改 role/内容，不可删除或禁用。' },
  '$WORLD_SIMULATION_EXECUTION_BOUNDARY': { name: '执行边界', description: '最高约束力的执行边界声明；不可改 role/内容，不可删除或禁用。' },
};

/** 把一个角色的 segment 列表渲染为块视图；锁定 = 引擎占位符或 v6 默认静态段。 */
export function buildWorldSimulationPromptBlocks_ACU(agent: WorldSimulationAgentName_ACU, segments: readonly WorldSimulationPromptSegment_ACU[]): WorldSimulationPromptBlockView_ACU[] {
  const defaults = defaultStaticContents_ACU(agent);
  const guidanceDefaults = buildDefaultWorldSimulationAgentGuidance_ACU();
  return segments.map((segment, index) => {
    const token = segment.content.trim();
    if (KNOWN_PLACEHOLDERS_ACU.has(token)) {
      const meta = PLACEHOLDER_META_ACU[token]!;
      return { index, name: meta.name, kind: 'placeholder' as const, token, role: segment.role, description: meta.description, locked: true };
    }
    if (defaults.has(segment.content)) {
      if (token === guidanceDefaults[agent]) {
        return { index, name: '用户自定义指导（默认）', kind: 'custom' as const, role: segment.role, description: '默认指导区：用户静态指导，可编辑、可移动、可删除。', locked: false, editableContent: segment.content };
      }
      return { index, name: token.includes('收到。以上真实 run 历史') ? '上下文确认' : '默认静态段', kind: 'anchor' as const, role: segment.role, description: 'v6 默认布局静态段；不可删除，内容默认。', locked: true };
    }
    return { index, name: '用户自定义段', kind: 'custom' as const, role: segment.role, description: '可编辑的用户静态提示词。', locked: false, editableContent: segment.content };
  });
}
