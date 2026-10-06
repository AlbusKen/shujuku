import { CONTINUATION_FIRST_FLOOR_FIELD_ACU } from '../continuation/model';
import { AGENT_MODULE_FIELD_ACU, AGENT_CONVERSATION_FIELD_ACU } from '../continuation/agent/agent-model';
import { WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU } from '../simulation/model';
import { WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU, WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU } from '../simulation/agent/agent-model';
import type { ZeroLayerExitAssignment_ACU } from './exit-model';
import { ZeroLayerError_ACU } from './model';

export const ZERO_LAYER_EXIT_FIELDS_ACU: readonly string[] = [
  'TavernDB_ACU_IsolatedData', 'TavernDB_ACU_IndependentData', 'TavernDB_ACU_Data',
  'TavernDB_ACU_SummaryData', 'TavernDB_ACU_Identity', 'TavernDB_ACU_ModifiedKeys',
  'TavernDB_ACU_UpdateGroupKeys', CONTINUATION_FIRST_FLOOR_FIELD_ACU,
  AGENT_MODULE_FIELD_ACU, AGENT_CONVERSATION_FIELD_ACU, WORLD_SIMULATION_FIRST_FLOOR_FIELD_ACU,
  WORLD_SIMULATION_STATE_FIELD_ACU, WORLD_SIMULATION_CHRONICLE_ARCHIVE_FIELD_ACU,
  WORLD_SIMULATION_CONVERSATION_FIELD_ACU, WORLD_SIMULATION_USER_REQUIREMENTS_FIELD_ACU,
  WORLD_SIMULATION_MATERIALS_FIELD_ACU,
];

export function exitFieldValue_ACU(message: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(message, field)
    ? { exists: true, value: structuredClone(message[field]) } : { exists: false };
}
export function applyExitAssignments_ACU(chat: Record<string, unknown>[],
  assignments: readonly ZeroLayerExitAssignment_ACU[], side: 'before' | 'after'): void {
  for (const item of assignments) {
    const message = chat[item.messageIndex];
    if (!message || !ZERO_LAYER_EXIT_FIELDS_ACU.includes(item.field)) {
      throw new ZeroLayerError_ACU('corrupt-data', '退出候选包含非法写入位置或字段。');
    }
    const value = item[side];
    if (value.exists) message[item.field] = structuredClone(value.value);
    else delete message[item.field];
  }
}
export function exitAssignmentsMatch_ACU(chat: Record<string, unknown>[],
  assignments: readonly ZeroLayerExitAssignment_ACU[], side: 'before' | 'after'): boolean {
  return assignments.every(item => chat[item.messageIndex]
    && JSON.stringify(exitFieldValue_ACU(chat[item.messageIndex], item.field)) === JSON.stringify(item[side]));
}
