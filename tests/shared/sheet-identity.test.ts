import { describe, expect, it } from 'vitest';
import {
  allocateStableSheetKeys_ACU,
  buildStableSheetKeyCandidate_ACU,
  canonicalizeDisplayName_ACU,
  prepareStableSheetIdentities_ACU,
  SHEET_KEY_ALGORITHM_VERSION_ACU,
  toAsciiSlug_ACU,
} from '../../src/shared/sheet-identity';
import { buildDefaultTableTemplateObject_ACU } from '../../src/shared/table-defaults/index.js';
import {
  assertNoPhysicalTableNameCollision_ACU,
  detectPhysicalTableNameCollisions_ACU,
  PhysicalTableNameCollisionError_ACU,
  resolvePhysicalTableNames_ACU,
} from '../../src/shared/sheet-identity';

describe('sheet identity', () => {
  it('版本化并规范化显示名，但不要求调用方回写原名', () => {
    expect(SHEET_KEY_ALGORITHM_VERSION_ACU).toBe(1);
    expect(canonicalizeDisplayName_ACU('  ＨＥＲＯ\u3000 Inventory  ')).toBe('hero inventory');
  });

  it('为英文、中文和混合名称生成确定性的稳定 key', () => {
    expect(buildStableSheetKeyCandidate_ACU(' Hero Inventory ')).toBe('sheet_hero_inventory');
    expect(buildStableSheetKeyCandidate_ACU('背包物品表')).toBe('sheet_bei_bao_wu_pin_biao');
    expect(buildStableSheetKeyCandidate_ACU('背包物品表')).toBe('sheet_bei_bao_wu_pin_biao');
    expect(buildStableSheetKeyCandidate_ACU('角色 Inventory')).toBe('sheet_jue_se_inventory');
    expect(toAsciiSlug_ACU('重庆')).toBe('chong_qing');
  });

  it('标点、emoji 与空白不会产生随机兜底 key', () => {
    expect(buildStableSheetKeyCandidate_ACU('任务！清单')).toBe('sheet_ren_wu_qing_dan');
    expect(buildStableSheetKeyCandidate_ACU('  😀  ')).toBeNull();
  });

  it('拒绝 canonical 重名并报告可定位冲突', () => {
    const result = allocateStableSheetKeys_ACU(['Inventory', ' inventory ', '装备']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'duplicate_canonical_name', index: 1, conflictsWithIndex: 0,
    }));
    expect(result.keys[0]).toBe(result.keys[1]);
  });

  it('用 canonical 哈希消除不同名称的 slug 碰撞，且不依赖输入顺序', () => {
    const first = allocateStableSheetKeys_ACU(['a b', 'a-b']);
    const second = allocateStableSheetKeys_ACU(['a-b', 'a b']);
    expect(first.keys[0]).not.toBe(first.keys[1]);
    expect(first.keys[0]).toBe(second.keys[1]);
    expect(first.keys[1]).toBe(second.keys[0]);
  });


  it('保留历史 key，仅对后续撞 key 的新名称消歧', () => {
    const result = allocateStableSheetKeys_ACU(['a-b'], {
      existing: [{ canonicalName: 'a b', sheetKey: 'sheet_a_b' }],
    });
    expect(result.keys).toEqual([expect.stringMatching(/^sheet_a_b_[a-f0-9]{10}$/)]);
    expect(result.diagnostics).toEqual([]);

    const retained = allocateStableSheetKeys_ACU(['a b'], {
      existing: [{ canonicalName: 'a b', sheetKey: 'sheet_legacy_random' }],
    });
    expect(retained.keys).toEqual(['sheet_legacy_random']);
  });

  it('冻结简繁和多音字的算法基线', () => {
    expect(toAsciiSlug_ACU('重庆')).toBe('chong_qing');
    expect(toAsciiSlug_ACU('重慶')).toBe('zhong_qing');
    expect(toAsciiSlug_ACU('绿')).toBe('lv');
    expect(toAsciiSlug_ACU('綠')).toBe('lv');
  });

  it('截断长名称并在重复调用间保持一致', () => {
    const name = `表${'a'.repeat(100)}`;
    const key = buildStableSheetKeyCandidate_ACU(name)!;
    expect(key).toMatch(/^sheet_[a-z0-9_]+$/);
    expect(key.length).toBeLessThanOrEqual(54);
    expect(buildStableSheetKeyCandidate_ACU(name)).toBe(key);
  });
});

describe('physical table name (deterministic)', () => {
  const sheet = (name: string) => ({ name } as any);

  it('物理名与入参集合无关：全量与子集对同一 sheetKey 结果一致', () => {
    const full = {
      mate: {},
      sheet_beibao: sheet('背包'),
      sheet_juese: sheet('角色'),
      sheet_renwu: sheet('任务'),
    } as any;
    const subset = { mate: {}, sheet_juese: sheet('角色') } as any;
    const fromFull = resolvePhysicalTableNames_ACU(full).get('sheet_juese');
    const fromSubset = resolvePhysicalTableNames_ACU(subset).get('sheet_juese');
    expect(fromFull).toBe(fromSubset);
    expect(fromFull).toBeTruthy();
  });

  it('物理名是纯拼音，不带 hash 后缀', () => {
    const data = { mate: {}, sheet_beibao: sheet('背包物品表') } as any;
    expect(resolvePhysicalTableNames_ACU(data).get('sheet_beibao')).toBe('beibaowupinbiao');
  });

  it('同音不同 sheetKey 触发冲突：resolve 抛错，detect 报告，assert 抛错', () => {
    const data = { mate: {}, sheet_beibao: sheet('背包'), sheet_beibao2: sheet('被包') } as any;
    expect(() => resolvePhysicalTableNames_ACU(data)).toThrow(PhysicalTableNameCollisionError_ACU);
    const collisions = detectPhysicalTableNameCollisions_ACU(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].physicalTableName).toBe('beibao');
    expect(new Set(collisions[0].sheetKeys)).toEqual(new Set(['sheet_beibao', 'sheet_beibao2']));
    expect(() => assertNoPhysicalTableNameCollision_ACU(data)).toThrow(PhysicalTableNameCollisionError_ACU);
  });


  it('规范名相同的物理名冲突标记为身份归并失败，并提供完整显示名', () => {
    const data = { mate: {}, sheet_legacy: sheet('重要角色表'), sheet_guide: sheet(' 重要角色表 ') } as any;

    const collisions = detectPhysicalTableNameCollisions_ACU(data);

    expect(collisions).toEqual([expect.objectContaining({
      reason: 'identity_merge_failed',
      sheetNames: [' 重要角色表 ', '重要角色表'],
    })]);
    expect(() => assertNoPhysicalTableNameCollision_ACU(data)).toThrow(/身份归并未完成/);
  });

  it('同音但规范名不同的物理名冲突要求用户改名', () => {
    const data = { mate: {}, sheet_beibao: sheet('背包'), sheet_beibao2: sheet('被包') } as any;

    const collisions = detectPhysicalTableNameCollisions_ACU(data);

    expect(collisions[0]).toMatchObject({ reason: 'homophone_distinct_names', sheetNames: ['背包', '被包'] });
    expect(() => assertNoPhysicalTableNameCollision_ACU(data)).toThrow(/请重命名/);
  });

  it('无冲突时 detect 返回空、assert 不抛', () => {
    const data = { mate: {}, sheet_beibao: sheet('背包'), sheet_juese: sheet('角色') } as any;
    expect(detectPhysicalTableNameCollisions_ACU(data)).toEqual([]);
    expect(() => assertNoPhysicalTableNameCollision_ACU(data)).not.toThrow();
  });
});

describe('prepareStableSheetIdentities_ACU', () => {
  it('真实默认模板：按显示名分配稳定 key，key===uid，原 key/uid 保留为别名且不修改输入', () => {
    const template = buildDefaultTableTemplateObject_ACU() as any;
    const before = JSON.stringify(template);

    const first = prepareStableSheetIdentities_ACU(template);
    const second = prepareStableSheetIdentities_ACU(buildDefaultTableTemplateObject_ACU() as any);

    expect(first.diagnostics).toEqual([]);
    expect(first.malformedSheetKeys).toEqual([]);
    expect(JSON.stringify(template)).toBe(before);
    expect(Object.keys(first.data).sort()).toEqual(Object.keys(second.data).sort());
    expect(first.keyMap.get('sheet_in05z9vz')).toBe('sheet_bei_bao_wu_pin_biao');
    expect(first.data.sheet_in05z9vz).toBeUndefined();
    expect(first.data.mate).toEqual(template.mate);
    for (const [oldKey, newKey] of first.keyMap) {
      const sheet = first.data[newKey];
      expect(sheet.uid).toBe(newKey);
      expect(newKey).toBe(buildStableSheetKeyCandidate_ACU(template[oldKey].name));
      expect(sheet.sourceData.tableAliases).toContain(oldKey);
      expect(sheet.content).toEqual(template[oldKey].content);
    }
  });

  it('已是稳定 key 的输入幂等，不追加自引用别名', () => {
    const once = prepareStableSheetIdentities_ACU({ mate: {}, sheet_random: { uid: 'legacy-uid', name: '背包', content: [['row_id']] } });
    const twice = prepareStableSheetIdentities_ACU(once.data);

    expect(twice.data).toEqual(once.data);
    expect(once.data.sheet_bei_bao.sourceData.tableAliases).toEqual(['sheet_random', 'legacy-uid']);
  });

  it('空名、重名或畸形表返回诊断与空结果，由调用方决定处理', () => {
    expect(prepareStableSheetIdentities_ACU({ sheet_a: { name: '' } }).diagnostics[0].code).toBe('empty_name');
    const duplicate = prepareStableSheetIdentities_ACU({ sheet_a: { name: '背包' }, sheet_b: { name: ' 背包 ' } });
    expect(duplicate.diagnostics.map(item => item.code)).toContain('duplicate_canonical_name');
    expect(duplicate.data).toEqual({});
    expect(prepareStableSheetIdentities_ACU({ sheet_a: [] as any }).malformedSheetKeys).toEqual(['sheet_a']);
  });
});
