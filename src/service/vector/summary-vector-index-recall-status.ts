/**
 * 交火发送前召回的会话内成功标志。
 *
 * 只给 injection-engine-custom 判断「纪要索引」内容是否仍应保护。
 * 不落盘、不进入 tagData；跨会话默认 false，首轮失败时概览路径天然生效。
 */

let lastSummaryVectorRecallSucceeded_ACU = false;

export function didLastSummaryVectorRecallSucceed_ACU(): boolean {
    return lastSummaryVectorRecallSucceeded_ACU === true;
}

export function setLastSummaryVectorRecallSucceeded_ACU(value: boolean): void {
    lastSummaryVectorRecallSucceeded_ACU = value === true;
}

export function __resetLastSummaryVectorRecallSucceededForTests_ACU(): void {
    lastSummaryVectorRecallSucceeded_ACU = false;
}
