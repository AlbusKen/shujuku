/**
 * service/worldbook/entry-diff.ts — 世界书条目字段等价判定（纯函数、零外部模块依赖）
 *
 * 用于幂等刷新：内容与有效字段完全一致时不写回世界书，已有条目保持原 order。
 */

function readFiniteOrder_ACU(entry: any): number | null {
    const v = entry?.order;
    const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : null;
}

function normalizePositionStrict_ACU(position: unknown): string {
    const raw = String(position ?? '').trim().toLowerCase();
    if (raw === 'at_depth_as_system' || raw === 'system') return 'at_depth_as_system';
    if (raw === 'before_char' || raw === 'before_character' || raw === 'before_character_definition' || raw === '0') {
        return 'before_character_definition';
    }
    if (raw === 'after_char' || raw === 'after_character' || raw === 'after_character_definition' || raw === '1') {
        return 'after_character_definition';
    }
    return raw;
}

export function normalizeLorebookEntryTypeForCompare_ACU(type: unknown): string {
    const raw = String(type ?? '').trim().toLowerCase();
    // 宿主读写链会把旧版 'keyword' 归一为 'selective'，二者在语义上等价。
    if (raw === 'keyword' || raw === 'selective') return 'selective';
    return raw;
}

export function normalizeLorebookEntryKeysForCompare_ACU(entry: any): string[] | null {
    const raw = Array.isArray(entry?.keys)
        ? entry.keys
        : (Array.isArray(entry?.key) ? entry.key : null);
    if (!raw) return null;
    return raw.map((k: unknown) => (k instanceof RegExp ? String(k) : String(k ?? '')));
}

export function areLorebookEntryKeysEqual_ACU(existing: any, desiredKeys: readonly string[]): boolean {
    const existingKeys = normalizeLorebookEntryKeysForCompare_ACU(existing);
    if (!existingKeys || existingKeys.length !== desiredKeys.length) return false;
    for (let i = 0; i < desiredKeys.length; i++) {
        if (existingKeys[i] !== String(desiredKeys[i] ?? '')) return false;
    }
    return true;
}

export function isLorebookEntryPlacementStrictMatched_ACU(entry: any, placement: any): boolean {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.position === undefined || entry.position === null || entry.position === '') return false;
    const targetPos = normalizePositionStrict_ACU(placement?.position ?? 'at_depth_as_system');
    const actualPos = normalizePositionStrict_ACU(entry.position);
    if (actualPos !== targetPos) return false;
    if (targetPos === 'at_depth_as_system') {
        const expectedDepth = typeof placement?.depth === 'number'
            ? placement.depth
            : parseInt(String(placement?.depth ?? 2), 10);
        const actualDepth = typeof entry.depth === 'number'
            ? entry.depth
            : parseInt(String(entry.depth ?? ''), 10);
        return Number.isFinite(actualDepth) && Number.isFinite(expectedDepth) && actualDepth === expectedDepth;
    }
    return true;
}

export function isLorebookEntryFieldsMatched_ACU(
    existing: any,
    desired: {
        content?: string;
        keys?: readonly string[];
        enabled: boolean;
        type: string;
        prevent_recursion: boolean;
    },
    placement: any,
    options?: { ignoreContent?: boolean; ignoreKeys?: boolean },
): boolean {
    if (!existing || typeof existing !== 'object') return false;
    if (!options?.ignoreContent && existing.content !== desired.content) return false;
    if (existing.enabled !== desired.enabled) return false;
    if (normalizeLorebookEntryTypeForCompare_ACU(existing.type) !== normalizeLorebookEntryTypeForCompare_ACU(desired.type)) return false;
    if (existing.prevent_recursion !== desired.prevent_recursion) return false;
    if (!options?.ignoreKeys && desired.keys !== undefined && !areLorebookEntryKeysEqual_ACU(existing, desired.keys)) return false;
    if (!isLorebookEntryPlacementStrictMatched_ACU(existing, placement)) return false;
    return true;
}

/** 构造更新已有条目的 patch：已有条目保留原 order，不覆写 order 字段。 */
export function buildExistingEntryUpdatePatch_ACU(
    existing: any,
    desiredPatch: Record<string, any>,
    options?: { ignoreContent?: boolean },
): Record<string, any> {
    const patch: Record<string, any> = { ...desiredPatch, uid: existing.uid };
    if (options?.ignoreContent) {
        delete patch.content;
    }
    if (readFiniteOrder_ACU(existing) !== null) {
        delete patch.order;
    }
    return patch;
}

/** 仅在新建条目后校验宿主是否改写了请求的 order/placement，避免无意义的二次回写。 */
export function doesCreatedEntryNeedOrderFix_ACU(
    createdEntry: any,
    expectedOrder: number,
    placement: any,
): boolean {
    if (!createdEntry || createdEntry.uid == null || !Number.isFinite(expectedOrder)) return false;
    if (readFiniteOrder_ACU(createdEntry) !== expectedOrder) return true;
    return !isLorebookEntryPlacementStrictMatched_ACU(createdEntry, placement);
}
