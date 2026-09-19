interface WorldSimulationInternalRequest_ACU {
  requestId: string;
  runId: string;
  role: string;
}
interface RequestRecord_ACU {
  identity: WorldSimulationInternalRequest_ACU;
  mainApiActive: boolean;
  generationSeq: number | null;
  expiresAt: number;
}
const TTL_MS_ACU = 60_000;
const requests_ACU = new Map<string, RequestRecord_ACU>();
function purge_ACU(now = Date.now()): void {
  for (const [id, record] of requests_ACU) if (record.expiresAt <= now) requests_ACU.delete(id);
}
export function beginWorldSimulationInternalAiRequest_ACU(identity: WorldSimulationInternalRequest_ACU): void {
  purge_ACU();
  if (requests_ACU.has(identity.requestId)) throw new Error(`WORLD_SIMULATION_INTERNAL_REQUEST_DUPLICATE:${identity.requestId}`);
  requests_ACU.set(identity.requestId, { identity, mainApiActive: false, generationSeq: null, expiresAt: Date.now() + TTL_MS_ACU });
}
export function beginWorldSimulationInternalAiMainApiInvocation_ACU(requestId: string): void {
  const record = requests_ACU.get(requestId);
  if (record) { record.mainApiActive = true; record.expiresAt = Date.now() + TTL_MS_ACU; }
}
export function endWorldSimulationInternalAiMainApiInvocation_ACU(requestId: string): void {
  const record = requests_ACU.get(requestId);
  if (record) record.mainApiActive = false;
}
export function settleWorldSimulationInternalAiRequest_ACU(requestId: string): void {
  const record = requests_ACU.get(requestId);
  if (!record) return;
  if (record.generationSeq === null) requests_ACU.delete(requestId);
  else record.expiresAt = Date.now() + TTL_MS_ACU;
}
export function cancelWorldSimulationInternalAiRequest_ACU(requestId: string): void { requests_ACU.delete(requestId); }
export function bindWorldSimulationInternalAiGenerationStarted_ACU(generationSeq: number): WorldSimulationInternalRequest_ACU | null {
  purge_ACU();
  const matches = [...requests_ACU.values()].filter(item => item.mainApiActive && item.generationSeq === null);
  if (matches.length !== 1) return null;
  matches[0].generationSeq = generationSeq;
  matches[0].expiresAt = Date.now() + TTL_MS_ACU;
  return matches[0].identity;
}
export function consumeWorldSimulationInternalAiGenerationEnded_ACU(generationSeq: number | undefined): WorldSimulationInternalRequest_ACU | null {
  if (generationSeq === undefined) return null;
  purge_ACU();
  const match = [...requests_ACU.values()].find(item => item.generationSeq === generationSeq);
  if (!match) return null;
  requests_ACU.delete(match.identity.requestId);
  return match.identity;
}
/**
 * 主正文 GENERATION_ENDED 到达时，是否仍存在可能错配消费共享生成上下文栈的内部请求：
 * - mainApiActive：GENERATION_STARTED 同步归属窗口打开，下一次 STARTED 可能被绑到内部记录；
 * - generationSeq 已绑定：其 GENERATION_ENDED 尚未到达，届时会从共享栈弹栈。
 * 任一为真时，当前 ENDED 的上下文配对不可信，禁止据此触发自动推演。
 */
export function hasWorldSimulationInternalAiInflight_ACU(): boolean {
  purge_ACU();
  for (const record of requests_ACU.values()) if (record.mainApiActive || record.generationSeq !== null) return true;
  return false;
}
export function resetWorldSimulationInternalAiEventsForTests_ACU(): void { requests_ACU.clear(); }
