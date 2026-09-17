export interface WorldSimulationPromptMessage_ACU { role: string; content: string; }
export interface WorldSimulationPromptDriftReport_ACU {
  baseline: boolean;
  identical: boolean;
  messageCount: number;
  sharedMessages: number;
  divergedMessageIndex: number | null;
  previousRole: string | null;
  currentRole: string | null;
}

const lastByScope_ACU = new Map<string, WorldSimulationPromptMessage_ACU[]>();

export function compareWorldSimulationPromptMessages_ACU(
  previous: readonly WorldSimulationPromptMessage_ACU[] | null,
  current: readonly WorldSimulationPromptMessage_ACU[],
): WorldSimulationPromptDriftReport_ACU {
  if (!previous) return { baseline: true, identical: false, messageCount: current.length, sharedMessages: 0, divergedMessageIndex: null, previousRole: null, currentRole: null };
  let sharedMessages = 0;
  const limit = Math.min(previous.length, current.length);
  while (sharedMessages < limit && previous[sharedMessages].role === current[sharedMessages].role && previous[sharedMessages].content === current[sharedMessages].content) sharedMessages += 1;
  const identical = sharedMessages === previous.length && sharedMessages === current.length;
  return {
    baseline: false,
    identical,
    messageCount: current.length,
    sharedMessages,
    divergedMessageIndex: identical ? null : sharedMessages,
    previousRole: previous[sharedMessages]?.role ?? null,
    currentRole: current[sharedMessages]?.role ?? null,
  };
}

export function trackWorldSimulationPromptDrift_ACU(scope: string, messages: readonly WorldSimulationPromptMessage_ACU[]): WorldSimulationPromptDriftReport_ACU {
  const report = compareWorldSimulationPromptMessages_ACU(lastByScope_ACU.get(scope) ?? null, messages);
  lastByScope_ACU.set(scope, messages.map(message => ({ ...message })));
  return report;
}

export function resetWorldSimulationPromptDrift_ACU(scope?: string): void {
  if (scope === undefined) lastByScope_ACU.clear();
  else lastByScope_ACU.delete(scope);
}
