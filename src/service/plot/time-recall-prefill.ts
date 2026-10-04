import { CREATIVE_IDENTITY_LEGACY_PROMPTS_ACU, DEFAULT_TIME_RECALL_PLOT_PRESET_ACU } from '../../shared/defaults-json.js';
import { USER_PREFILL_CONTENT_ACU } from '../../shared/user-prefill.js';

const LEGACY_TIME_RECALL_TAIL_ACU = '收到，天之音开始执行！';

function isLegacyTail_ACU(tail: any): boolean {
    return String(tail?.role || '').toLowerCase() === 'assistant'
        && (tail.content === LEGACY_TIME_RECALL_TAIL_ACU || tail.content === USER_PREFILL_CONTENT_ACU)
        && !tail.mainSlot && !tail.isMain && !tail.isMain2;
}

/** 比较消息身份与完整正文；开关及其他用户段元数据不作为默认指纹。 */
function matchesGroup_ACU(group: unknown, reference: unknown): boolean {
    if (!Array.isArray(group) || !Array.isArray(reference) || group.length < 2 || group.length !== reference.length) return false;
    return group.every((segment, index) => index === group.length - 1
        ? isLegacyTail_ACU(segment) && (isLegacyTail_ACU(reference[index])
            || (reference[index]?.role === 'user' && reference[index]?.content === USER_PREFILL_CONTENT_ACU))
        : segment?.content === reference[index]?.content
            && String(segment?.role || '').toLowerCase() === String(reference[index]?.role || '').toLowerCase());
}

function matchesDefaultGroup_ACU(group: unknown): boolean {
    const legacy = CREATIVE_IDENTITY_LEGACY_PROMPTS_ACU;
    const current = DEFAULT_TIME_RECALL_PLOT_PRESET_ACU;
    return [legacy.timeRecallGroup, legacy.timeRecallTask, current.promptGroup, current.plotTasks[0].promptGroup]
        .some(reference => matchesGroup_ACU(group, reference));
}

function isTimeRecallPreset_ACU(source: Record<string, any>): boolean {
    if (source._acuBuiltinPresetId) return source._acuBuiltinPresetId === 'time-recall';
    return source.name === '时间召回' && (matchesDefaultGroup_ACU(source.promptGroup)
        || source.plotTasks?.some((task: any) => matchesDefaultGroup_ACU(task?.promptGroup)) === true);
}

/** 仅升级仍匹配旧内置尾段的配置，保留其余提示词、开关和段元数据。 */
export function upgradeTimeRecallPrefill_ACU(holder: Record<string, any> | null): Record<string, any> | null {
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) return null;
    const presets = Array.isArray(holder.promptPresets) ? holder.promptPresets : [];
    const activePreset = presets.find((preset: any) => preset?.name === holder.lastUsedPresetName);
    const builtin = holder._acuBuiltinPresetId === 'time-recall';
    const legacyPreset = !holder._acuBuiltinPresetId && isTimeRecallPreset_ACU(holder);
    const activeTimeRecall = !holder.name && !holder._acuBuiltinPresetId
        && activePreset && isTimeRecallPreset_ACU(activePreset);
    const rootCandidate = builtin || (legacyPreset && matchesDefaultGroup_ACU(holder.promptGroup))
        || (activeTimeRecall && matchesGroup_ACU(holder.promptGroup, activePreset.promptGroup));
    let changed = false;
    const upgradeGroup = (group: unknown): unknown => {
        if (!Array.isArray(group) || group.length === 0) return group;
        const tail = group[group.length - 1];
        if (!isLegacyTail_ACU(tail)) return group;
        changed = true;
        return [...group.slice(0, -1), { ...tail, role: 'user', content: USER_PREFILL_CONTENT_ACU }];
    };
    const promptGroup = rootCandidate ? upgradeGroup(holder.promptGroup) : holder.promptGroup;
    const plotTasks = Array.isArray(holder.plotTasks) ? holder.plotTasks.map((task: any) => {
        if (!task || typeof task !== 'object') return task;
        // 主任务使用稳定 ID；活动副本还必须匹配同一任务的完整提示词。
        const activeTask = activeTimeRecall && activePreset.plotTasks?.find((item: any) => item?.id === task.id);
        const candidate = (builtin && (task.id === 'defaultPlotTask' || matchesDefaultGroup_ACU(task.promptGroup)))
            || (legacyPreset && matchesDefaultGroup_ACU(task.promptGroup))
            || (activeTask && (activeTask.id === 'defaultPlotTask' || matchesDefaultGroup_ACU(activeTask.promptGroup))
                && matchesGroup_ACU(task.promptGroup, activeTask.promptGroup));
        const group = candidate ? upgradeGroup(task.promptGroup) : task.promptGroup;
        return group === task.promptGroup ? task : { ...task, promptGroup: group };
    }) : holder.plotTasks;
    const promptPresets = Array.isArray(holder.promptPresets) ? holder.promptPresets.map((preset: any) => {
        const upgraded = upgradeTimeRecallPrefill_ACU(preset);
        if (!upgraded) return preset;
        changed = true;
        return upgraded;
    }) : holder.promptPresets;
    return changed ? {
        ...holder,
        ...(promptGroup !== holder.promptGroup ? { promptGroup } : {}),
        ...(plotTasks !== undefined ? { plotTasks } : {}),
        ...(promptPresets !== undefined ? { promptPresets } : {}),
    } : null;
}
