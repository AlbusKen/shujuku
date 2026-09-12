export type AgentKernelJsonParser_ACU = (text: string) => unknown;

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function balancedObjectFrom_ACU(text: string, start: number): { json: string; end: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = inString; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return { json: text.slice(start, index + 1), end: index + 1 };
  }
  return null;
}

export function extractAgentKernelJsonObjects_ACU(text: string, limit = 6): string[] {
  if (typeof text !== 'string') return [];
  const result: string[] = [];
  let cursor = 0;
  while (result.length < limit) {
    const start = text.indexOf('{', cursor);
    if (start < 0) break;
    const balanced = balancedObjectFrom_ACU(text, start);
    if (!balanced) { cursor = start + 1; continue; }
    result.push(balanced.json);
    cursor = balanced.end;
  }
  return result;
}

export function selectAgentKernelJsonPayload_ACU(
  raw: string,
  prefill: string,
  requiredKeys: readonly string[],
  parse: AgentKernelJsonParser_ACU,
): Record<string, unknown> | null {
  const stripped = raw.replace(/```[a-zA-Z]*\n?/g, '').trim();
  const candidates = stripped.startsWith('{') || !prefill ? [raw, `${prefill}${raw}`] : [`${prefill}${raw}`, raw];
  let first: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    for (const text of extractAgentKernelJsonObjects_ACU(candidate)) {
      const parsed = parse(text);
      if (!isRecord_ACU(parsed)) continue;
      if (!requiredKeys.length || requiredKeys.some(key => key in parsed)) return parsed;
      if (!first) first = parsed;
    }
  }
  return first;
}
