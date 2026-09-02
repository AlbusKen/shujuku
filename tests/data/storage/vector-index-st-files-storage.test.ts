import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLegacyVectorIndexLosslessScopeTokenV2_ACU,
  buildVectorIndexContentPackPathV2_ACU,
  buildVectorIndexSingleSnapshotV2FilePath_ACU,
  buildVectorIndexSingleSnapshotV2ScopeToken_ACU,
  buildVectorIndexStableDirectory_ACU,
  decodeVectorIndexScopeFromPath_ACU,
  extractVectorIndexContentPackScopeTokenFromPath_ACU,
  extractVectorIndexV2ScopeTokenFromPath_ACU,
  isLegacyLosslessVectorIndexV2Path_ACU,
  isVectorIndexContentPackPathV2_ACU,
  registerVectorIndexFiles_ACU,
  resolveVectorIndexRegistryFileScope_ACU,
  VECTOR_INDEX_SCOPE_FINGERPRINT_LENGTH_ACU,
} from '../../../src/data/storage/vector-index-st-files-storage';
import { sha256Base64UrlSync_ACU, sha256HexSync_ACU } from '../../../src/shared/sha256-sync';

import { buildVectorIndexSnapshotWriteGeneration_ACU } from '../../../src/service/vector/summary-vector-index-storage-service';


afterEach(() => vi.unstubAllGlobals());

describe('P4 内容寻址 pack 路径 (T10)', () => {
  const packBase = {
    chatKey: 'chat-main',
    isolationKey: 'profile-a',
    sourceTableKey: 'sheet_summary',
    packKey: 'pack_abcdef1234567890',
  };

  it('中文 chatKey 的两个不同聊天生成不同 pack 路径（不坍缩为 default）', () => {
    const chatA = '中文聊天甲';
    const chatB = '中文聊天乙';
    const pathA = buildVectorIndexContentPackPathV2_ACU({
      chatKey: chatA,
      isolationKey: 'iso',
      sourceTableKey: 'sheet_x',
      packKey: 'pack_same',
    });
    const pathB = buildVectorIndexContentPackPathV2_ACU({
      chatKey: chatB,
      isolationKey: 'iso',
      sourceTableKey: 'sheet_x',
      packKey: 'pack_same',
    });
    expect(pathA).not.toBe(pathB);
    expect(pathA).not.toContain('default');
    expect(pathB).not.toContain('default');
    expect(pathA.startsWith('TavernDB_ACU_vector_v2pack_')).toBe(true);
  });

  it('同 scope 同 packKey 生成稳定路径；packKey 变化路径变化', () => {
    const a = buildVectorIndexContentPackPathV2_ACU(packBase);
    expect(buildVectorIndexContentPackPathV2_ACU(packBase)).toBe(a);
    expect(buildVectorIndexContentPackPathV2_ACU({ ...packBase, packKey: 'pack_other' })).not.toBe(a);
  });

  it('路径不含 indexId/revision（跨 revision 复用前提）', () => {
    const path = buildVectorIndexContentPackPathV2_ACU(packBase);
    expect(path).not.toContain('snap_');
    expect(path).not.toContain('_snapshot');
  });

  it('超长中文 chatKey 也能构造 pack 路径，且长度与 chatKey 无关', () => {
    const shortPath = buildVectorIndexContentPackPathV2_ACU({
      chatKey: 'a',
      isolationKey: 'iso',
      sourceTableKey: 'sheet_x',
      packKey: 'pack_x',
    });
    const longPath = buildVectorIndexContentPackPathV2_ACU({
      chatKey: '超长'.repeat(200),
      isolationKey: 'iso',
      sourceTableKey: 'sheet_x',
      packKey: 'pack_x',
    });
    expect(longPath.length).toBe(shortPath.length);
    expect(longPath).not.toBe(shortPath);
    expect(longPath.length).toBeLessThanOrEqual(240);
  });

  it('前缀识别函数不把 snapshot 路径判成 pack，pack 路径可识别', () => {
    const snapshotPath = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      chatKey: 'chat-main',
      isolationKey: 'profile-a',
      sourceTableKey: 'sheet_summary',
      indexId: 'snap_one',
      writeGeneration: 'write_one',
    });
    expect(isVectorIndexContentPackPathV2_ACU(snapshotPath)).toBe(false);
    expect(isVectorIndexContentPackPathV2_ACU('TavernDB_ACU_vector_v2pack_scope_pack_x')).toBe(true);
    expect(isVectorIndexContentPackPathV2_ACU('')).toBe(false);
  });

  it('extractVectorIndexContentPackScopeTokenFromPath_ACU 提取 scope token，非 pack 路径返回 null', () => {
    const packPath = buildVectorIndexContentPackPathV2_ACU(packBase);
    const scopeToken = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(packBase);
    expect(extractVectorIndexContentPackScopeTokenFromPath_ACU(packPath)).toBe(scopeToken);
    expect(extractVectorIndexContentPackScopeTokenFromPath_ACU('TavernDB_ACU_vector_v2_scope_snap_x_snapshot')).toBe(null);
    expect(extractVectorIndexContentPackScopeTokenFromPath_ACU('')).toBe(null);
  });
});


const base = {
  chatKey: 'chat-main',
  isolationKey: 'profile-a',
  sourceTableKey: 'sheet_summary',
  indexId: 'snap_one',
  writeGeneration: 'write_one',
};

describe('向量索引 V2 物理路径', () => {
  it('同一 scope 和 generation 的路径稳定，角色显示名不参与权威寻址', () => {
    expect(buildVectorIndexSingleSnapshotV2FilePath_ACU(base)).toBe(
      buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...base, chatName: 'Renamed Character' }),
    );
  });

  it.each([
    ['isolationKey', 'profile-b'],
    ['sourceTableKey', 'sheet_outline'],
    ['chatKey', 'chat-other'],
    ['indexId', 'snap_two'],
    ['writeGeneration', 'write_two'],
  ] as const)('任一身份维度 %s 改变时路径不同', (key, value) => {
    expect(buildVectorIndexSingleSnapshotV2FilePath_ACU(base)).not.toBe(
      buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...base, [key]: value }),
    );
  });

  it('不会把旧规范化会碰撞的 scope 段折叠为同一路径', () => {
    const slash = buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...base, isolationKey: 'iso/A' });
    const underscore = buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...base, isolationKey: 'iso_A' });
    expect(slash).not.toBe(underscore);
    expect(buildVectorIndexStableDirectory_ACU({
      chatKey: base.chatKey,
      isolationKey: 'iso/A',
      sourceTableKey: base.sourceTableKey,
    })).toBe(buildVectorIndexStableDirectory_ACU({
      chatKey: base.chatKey,
      isolationKey: 'iso_A',
      sourceTableKey: base.sourceTableKey,
    }));
  });

  it('极长 canonical scope 也能落在宿主安全上限内，且不与短 scope 碰撞', () => {
    const huge = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      ...base,
      chatKey: 'chat-'.repeat(40),
      isolationKey: 'isolation-'.repeat(40),
      sourceTableKey: 'summary-'.repeat(40),
    });
    const small = buildVectorIndexSingleSnapshotV2FilePath_ACU(base);
    expect(huge.length).toBe(small.length);
    expect(huge.length).toBeLessThanOrEqual(240);
    expect(huge).not.toBe(small);
  });

  it('报障场景：scopeToken 228 字符的中文聊天名现在可以正常建路径', () => {
    // 升级前该 scope 的无损 token 长达 228，整条路径 299 > 240 被拒绝写入。
    const scope = {
      chatKey: '这是一个非常非常长的中文角色名字用来复现用户报障时四十多个汉字的聊天文件名 - 2025-11-5@14h30m12s345ms',
      isolationKey: 'default',
      sourceTableKey: 'summary',
    };
    // 旧无损 token 约 228 字符，叠加固定段后 > 240。
    expect(buildLegacyVectorIndexLosslessScopeTokenV2_ACU(scope).length).toBeGreaterThan(200);
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      ...scope,
      indexId: 'snap_zzzzzzzz',
      writeGeneration: 'z'.repeat(24),
    });
    expect(path.length).toBeLessThanOrEqual(240);
  });
});

describe('scope 指纹（SHA-256 base64url）', () => {
  const scope = { chatKey: '中文聊天甲', isolationKey: 'profile-a', sourceTableKey: 'sheet_summary' };

  it('同步 SHA-256 与 Web Crypto 结果一致', async () => {
    const samples = ['', 'abc', '中文聊天甲', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(1000)];
    for (const sample of samples) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(sample));
      const expected = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      expect(sha256HexSync_ACU(sample)).toBe(expected);
    }
    expect(sha256HexSync_ACU('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('指纹定长 43、字母表 [A-Za-z0-9_-]、确定性、对 canonical 归一稳定', () => {
    const token = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope);
    expect(token.length).toBe(VECTOR_INDEX_SCOPE_FINGERPRINT_LENGTH_ACU);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(buildVectorIndexSingleSnapshotV2ScopeToken_ACU({ ...scope })).toBe(token);
    expect(buildVectorIndexSingleSnapshotV2ScopeToken_ACU({ ...scope, isolationKey: '  profile-a ' })).toBe(token);
    expect(buildVectorIndexSingleSnapshotV2ScopeToken_ACU({ ...scope, isolationKey: '' }))
      .toBe(buildVectorIndexSingleSnapshotV2ScopeToken_ACU({ ...scope, isolationKey: 'default' }));
    expect(token).toBe(sha256Base64UrlSync_ACU(JSON.stringify([scope.chatKey, scope.isolationKey, scope.sourceTableKey])));
  });

  it('任一维度改变、哪怕只差一个字，指纹不同', () => {
    const token = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope);
    expect(buildVectorIndexSingleSnapshotV2ScopeToken_ACU({ ...scope, chatKey: '中文聊天乙' })).not.toBe(token);
    expect(buildVectorIndexSingleSnapshotV2ScopeToken_ACU({ ...scope, isolationKey: 'profile-b' })).not.toBe(token);
    expect(buildVectorIndexSingleSnapshotV2ScopeToken_ACU({ ...scope, sourceTableKey: 'sheet_outline' })).not.toBe(token);
  });

  it('指纹与旧版无损 token 不同，且不可反解', () => {
    const token = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope);
    expect(token).not.toBe(buildLegacyVectorIndexLosslessScopeTokenV2_ACU(scope));
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...scope, indexId: 'snap_one', writeGeneration: 'write_one' });
    expect(decodeVectorIndexScopeFromPath_ACU(path)).toBeNull();
    expect(isLegacyLosslessVectorIndexV2Path_ACU(path)).toBe(false);
  });
});

describe('向量索引 registry 持久化', () => {
  it('registry 上传返回失败时向调用方传播错误，不能伪装成已登记', async () => {
    class FakeFileReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(): void {
        this.result = 'data:application/json;base64,e30=';
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => 'registry backend unavailable' }));

    await expect(registerVectorIndexFiles_ACU([{
      role: 'manifest', path: 'orphan-v2-path', byteSize: 1, checksum: 'checksum', createdAt: '', updatedAt: '', status: 'ready',
    }])).rejects.toThrow('registry 保存失败');
  });
});


describe('T0a writeGeneration 紧凑化', () => {
  it('生成结果长度 ≤ 24 且字符集 [a-zA-Z0-9]，不被 normalizeFileNamePart_ACU 改写', () => {
    const entropy = new Uint32Array([0, 0]);
    const gen = buildVectorIndexSnapshotWriteGeneration_ACU(1234567890123, entropy);
    expect(gen.length).toBeLessThanOrEqual(24);
    expect(gen).toMatch(/^[a-zA-Z0-9]+$/);
    // 与路径规范化一致：不含下划线/连字符外的非法字符，且 round-trip 后不变
    const normalized = gen.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    expect(normalized).toBe(gen);
  });

  it('同一毫秒内连续生成 1000 次无重复（64 位熵 + 时间戳兜底）', () => {
    const now = 1700000000000;
    const seen = new Set<string>();
    // 模拟 1000 个不同熵值：前 1000 个 Uint32 组合
    for (let i = 0; i < 1000; i += 1) {
      const entropy = new Uint32Array([i, i * 2654435761]);
      const gen = buildVectorIndexSnapshotWriteGeneration_ACU(now, entropy);
      expect(seen.has(gen)).toBe(false);
      seen.add(gen);
    }
    expect(seen.size).toBe(1000);
  });

  it('熵值定宽 7 位，无分隔符也可无歧义解析', () => {
    const entropy = new Uint32Array([1, 2]);
    const gen = buildVectorIndexSnapshotWriteGeneration_ACU(1700000000000, entropy);
    // 时间戳 1700000000000 的 base36 为 8 位 + 7 + 7 = 22
    expect(gen).toMatch(/^[a-z0-9]{8}[a-z0-9]{7}[a-z0-9]{7}$/);
  });

  it('旧格式 writeGeneration 的路径构造不受影响（旧快照兼容）', () => {
    // 旧格式：时间戳base36-4×Uint32base36（连字符分隔），~40 字符
    const legacyWriteGeneration = 'm3o6k5a1-2gk3-4m5o-6p7q-8r9s';
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      ...base,
      writeGeneration: legacyWriteGeneration,
    });
    expect(path).toContain(legacyWriteGeneration);
    expect(path.length).toBeLessThanOrEqual(240);
  });

  it('报障用户规模 scope（三 key UTF-8 合计 110 字节）：新旧 writeGeneration 格式路径都 ≤ 240', () => {
    const longChatKey = '中文角色名A-2025-11-5@14h30m12s345ms';
    const longIsolation = 'isolation-'.repeat(5);
    const longSourceTable = 'source-'.repeat(3);
    const indexId = 'snap_zzzzzzz';

    // 升级前：40 字符旧格式 writeGeneration 叠加 160 字符无损 token → 246 > 240 被拒。
    // 现在 scopeToken 定长 43，旧格式 generation 也不再是问题。
    const legacyGeneration = 'm3o6k5a1-2gk3abc-4m5odef-6p7qghi-8r9sjkl';
    const legacyGenPath = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      chatKey: longChatKey,
      isolationKey: longIsolation,
      sourceTableKey: longSourceTable,
      indexId,
      writeGeneration: legacyGeneration,
    });
    expect(legacyGenPath.length).toBeLessThanOrEqual(240);

    const gen = buildVectorIndexSnapshotWriteGeneration_ACU(1700000000000, new Uint32Array([4294967295, 4294967295]));
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({
      chatKey: longChatKey,
      isolationKey: longIsolation,
      sourceTableKey: longSourceTable,
      indexId,
      writeGeneration: gen,
    });
    expect(path.length).toBeLessThanOrEqual(240);
  });

  // 路径 = 前缀(23) + scopeToken(43) + '_' + indexId + '_' + writeGeneration + '_snapshot'(9)。
  // scopeToken 已定长，路径长度只由 indexId / writeGeneration 两个上界决定，与用户数据无关。
  // 若未来有人动前缀/后缀/分隔符，或放宽 indexId / writeGeneration 长度，本用例先失败。
  it('路径长度恒定：任意 scope 下 = 23 + 43 + 1 + indexId + 1 + writeGeneration + 9，上界 114', () => {
    const FIXED_PREFIX = 'TavernDB_ACU_vector_v2_';
    const FIXED_SUFFIX = '_snapshot';
    const MAX_INDEX_ID = 13; // 'snap_'(5) + hashUserInput_ACU 上界 8（含负号）
    const MAX_WRITE_GENERATION = 24; // T0a 格式：时间戳 base36 8 + 7 + 7 = 22，留2 字符余量

    expect(FIXED_PREFIX.length).toBe(23);
    expect(FIXED_SUFFIX.length).toBe(9);
    const expectedMax = FIXED_PREFIX.length + VECTOR_INDEX_SCOPE_FINGERPRINT_LENGTH_ACU + 1 + MAX_INDEX_ID + 1 + MAX_WRITE_GENERATION + FIXED_SUFFIX.length;
    expect(expectedMax).toBe(114);

    const scopes = [
      { chatKey: 'a', isolationKey: 'b', sourceTableKey: 'c' },
      { chatKey: '中'.repeat(500), isolationKey: 'isolation-'.repeat(50), sourceTableKey: 'summary-'.repeat(50) },
      { chatKey: 'Renamed Character - 2025-11-5@14h30m12s345ms', isolationKey: 'default', sourceTableKey: 'summary' },
    ];
    for (const scope of scopes) {
      const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({
        ...scope,
        indexId: 'z'.repeat(MAX_INDEX_ID),
        writeGeneration: 'z'.repeat(MAX_WRITE_GENERATION),
      });
      expect(path.length).toBe(expectedMax);
      expect(path.startsWith(FIXED_PREFIX)).toBe(true);
      expect(path.endsWith(FIXED_SUFFIX)).toBe(true);
    }
  });

});

describe('P7 旧版无损 scopeToken 路径反解（decodeVectorIndexScopeFromPath_ACU）', () => {
  // 升级前写出的路径：TavernDB_ACU_vector_v2_<base64url(JSON 三元组)>_...；GC 仍要能认出并回收它们。
  const legacySnapshotPath = (scope: { chatKey: string; isolationKey: string; sourceTableKey: string }, indexId: string, writeGeneration: string) =>
    `TavernDB_ACU_vector_v2_${buildLegacyVectorIndexLosslessScopeTokenV2_ACU(scope)}_${indexId}_${writeGeneration}_snapshot`;
  const legacyPackPath = (scope: { chatKey: string; isolationKey: string; sourceTableKey: string }, packKey: string) =>
    `TavernDB_ACU_vector_v2pack_${buildLegacyVectorIndexLosslessScopeTokenV2_ACU(scope)}_${packKey}`;

  it('token 含 base64url 下划线（base64 `/` 替换而来）的旧 snapshot 路径正确反解', () => {
    // 该 chatKey 的旧 token 确定含 `_`，验证"首个下划线切分"会失配的场景被逐分割点解码正确处理。
    const scope = { chatKey: '聊天10o号', isolationKey: 'profile-a', sourceTableKey: '纪要表' };
    expect(buildLegacyVectorIndexLosslessScopeTokenV2_ACU(scope)).toContain('_');
    const path = legacySnapshotPath(scope, 'snap_abc123', 'wg_0001');
    expect(decodeVectorIndexScopeFromPath_ACU(path)).toEqual(scope);
    expect(isLegacyLosslessVectorIndexV2Path_ACU(path)).toBe(true);
    expect(extractVectorIndexV2ScopeTokenFromPath_ACU(path)).toBe(buildLegacyVectorIndexLosslessScopeTokenV2_ACU(scope));
  });

  it('旧 v2pack 路径正确反解 scope', () => {
    const scope = { chatKey: '中文聊天甲', isolationKey: 'profile-a', sourceTableKey: 'sheet_summary' };
    const path = legacyPackPath(scope, 'pack_abcdef1234567890');
    expect(decodeVectorIndexScopeFromPath_ACU(path)).toEqual(scope);
    expect(extractVectorIndexContentPackScopeTokenFromPath_ACU(path)).toBe(buildLegacyVectorIndexLosslessScopeTokenV2_ACU(scope));
  });

  it('ASCII scope 的旧 snapshot 路径正确反解', () => {
    const scope = { chatKey: 'chat-main', isolationKey: 'default', sourceTableKey: 'summary' };
    expect(decodeVectorIndexScopeFromPath_ACU(legacySnapshotPath(scope, 'snap_one', 'write_one'))).toEqual(scope);
  });

  it('新指纹路径：extract 取定长 43 token，decode 返回 null', () => {
    const scope = { chatKey: '聊天10o号', isolationKey: 'profile-a', sourceTableKey: '纪要表' };
    const token = buildVectorIndexSingleSnapshotV2ScopeToken_ACU(scope);
    const snapshotPath = buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...scope, indexId: 'snap_abc123', writeGeneration: 'wg_0001' });
    const packPath = buildVectorIndexContentPackPathV2_ACU({ ...scope, packKey: 'pack_x' });
    expect(extractVectorIndexV2ScopeTokenFromPath_ACU(snapshotPath)).toBe(token);
    expect(extractVectorIndexContentPackScopeTokenFromPath_ACU(packPath)).toBe(token);
    expect(decodeVectorIndexScopeFromPath_ACU(snapshotPath)).toBeNull();
    expect(decodeVectorIndexScopeFromPath_ACU(packPath)).toBeNull();
  });

  it('legacy 路径 / 非法输入返回 null', () => {
    expect(decodeVectorIndexScopeFromPath_ACU('TavernDB_ACU_vector_chat_iso_table_snapshot')).toBeNull();
    expect(decodeVectorIndexScopeFromPath_ACU('TavernDB_ACU_vector_v2_notatoken_snap_x_wg_snapshot')).toBeNull();
    expect(decodeVectorIndexScopeFromPath_ACU('')).toBeNull();
    expect(decodeVectorIndexScopeFromPath_ACU('unrelated_file.json')).toBeNull();
  });
});

describe('registry 条目 scope 解析（resolveVectorIndexRegistryFileScope_ACU）', () => {
  const scope = { chatKey: '中文聊天甲', isolationKey: 'profile-a', sourceTableKey: 'sheet_summary' };

  it('新条目：优先取 registry 自带 scope，并做 canonical 归一', () => {
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...scope, indexId: 'snap_one', writeGeneration: 'wg' });
    expect(resolveVectorIndexRegistryFileScope_ACU({ path, scope: { ...scope, isolationKey: ' profile-a ' } })).toEqual(scope);
  });

  it('新条目缺 scope 字段时无法归属（指纹不可逆）', () => {
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...scope, indexId: 'snap_one', writeGeneration: 'wg' });
    expect(resolveVectorIndexRegistryFileScope_ACU({ path })).toBeNull();
  });

  it('旧条目：无 scope 字段时从无损路径 token 反解', () => {
    const path = `TavernDB_ACU_vector_v2_${buildLegacyVectorIndexLosslessScopeTokenV2_ACU(scope)}_snap_one_wg_snapshot`;
    expect(resolveVectorIndexRegistryFileScope_ACU({ path })).toEqual(scope);
  });

  it('scope 字段残缺（缺任一维度）视为无效，不会用 fallback 值伪造身份', () => {
    const path = buildVectorIndexSingleSnapshotV2FilePath_ACU({ ...scope, indexId: 'snap_one', writeGeneration: 'wg' });
    expect(resolveVectorIndexRegistryFileScope_ACU({ path, scope: { chatKey: 'x', isolationKey: '', sourceTableKey: 'y' } })).toBeNull();
    expect(resolveVectorIndexRegistryFileScope_ACU(null)).toBeNull();
  });
});

describe('registry 登记保留 scope', () => {
  class FakeFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob): void {
      void blob.text().then((text) => {
        this.result = `data:application/json;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
        this.onload?.();
      });
    }
  }

  it('状态更新（prepared → published）未带 scope 时不会擦掉已有 scope', async () => {
    vi.stubGlobal('FileReader', FakeFileReader);
    const scope = { chatKey: 'chat-main', isolationKey: 'profile-a', sourceTableKey: 'sheet_summary' };
    const existing = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      files: [{
        role: 'manifest', path: 'p1', byteSize: 1, checksum: 'c', createdAt: '', updatedAt: '', status: 'ready',
        publicationState: 'prepared', scope,
      }],
    };
    let uploadedBody: any = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).startsWith('/user/files/')) {
        return { ok: true, status: 200, json: async () => existing };
      }
      uploadedBody = JSON.parse(init.body);
      return { ok: true, status: 200 };
    }));

    await registerVectorIndexFiles_ACU([{
      role: 'manifest', path: 'p1', byteSize: 1, checksum: 'c', createdAt: '', updatedAt: '', status: 'ready',
      publicationState: 'published',
    }]);
    expect(uploadedBody).not.toBeNull();
    const saved = JSON.parse(Buffer.from(uploadedBody.data, 'base64').toString('utf8'));
    expect(saved.files).toHaveLength(1);
    expect(saved.files[0].publicationState).toBe('published');
    expect(saved.files[0].scope).toEqual(scope);
  });
});
