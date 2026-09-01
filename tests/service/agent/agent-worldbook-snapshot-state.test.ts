import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAgentWorldbookSnapshotRevision_ACU,
  getAgentWorldbookSnapshotState_ACU,
  setAgentWorldbookSnapshotState_ACU,
  setAgentWorldbookSnapshotStateIfRevision_ACU,
} from '../../../src/service/agent/agent-worldbook-snapshot-state';

function buildSnapshot() {
  return {
    active: true,
    selectionSignature: 'sig-1',
    createdAt: 10,
    books: {
      角色A世界书: [{ uid: 1, previousEnabled: true, previousKeys: ['钥匙A'], previousType: 'selective' }],
    },
  } as any;
}

describe('agent worldbook snapshot state 引用隔离', () => {
  beforeEach(() => {
    setAgentWorldbookSnapshotState_ACU({ active: false, selectionSignature: '', createdAt: 0, books: {} });
  });

  it('修改 getter 返回的对象不会污染缓存', () => {
    setAgentWorldbookSnapshotState_ACU(buildSnapshot());
    const leaked = getAgentWorldbookSnapshotState_ACU();
    leaked.active = false;
    (leaked.books as any).角色A世界书[0].previousKeys.push('注入键');
    delete (leaked.books as any).角色A世界书;

    expect(getAgentWorldbookSnapshotState_ACU()).toStrictEqual(buildSnapshot());
  });

  it('set 之后继续修改传入对象不会污染缓存', () => {
    const source = buildSnapshot();
    setAgentWorldbookSnapshotState_ACU(source);
    source.selectionSignature = '被外部篡改';
    (source.books as any).角色A世界书[0].previousEnabled = false;

    expect(getAgentWorldbookSnapshotState_ACU()).toStrictEqual(buildSnapshot());
  });

  it('CAS 写入语义不受拷贝影响：revision 匹配才写入', () => {
    const revision = getAgentWorldbookSnapshotRevision_ACU();
    expect(setAgentWorldbookSnapshotStateIfRevision_ACU(revision, buildSnapshot())).toBe(true);
    expect(getAgentWorldbookSnapshotState_ACU()).toStrictEqual(buildSnapshot());
    // 旧 revision 再写必须被拒绝
    expect(setAgentWorldbookSnapshotStateIfRevision_ACU(revision, { active: false, selectionSignature: 'stale', createdAt: 0, books: {} })).toBe(false);
    expect(getAgentWorldbookSnapshotState_ACU()).toStrictEqual(buildSnapshot());
  });
});
