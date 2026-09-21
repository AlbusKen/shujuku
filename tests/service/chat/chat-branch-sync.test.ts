/**
 * tests/service/chat/chat-branch-sync.test.ts
 * 酒馆创建分支 / 检查点时，把截止楼层的 ACU 数据同步到新聊天。
 */
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockLoadTableStateFromFramesV2Detailed,
  mockCollectScheduleSummaryFromFramesV2,
  mockDeriveSheetLifecycleFromFramesV2,
  mockApi,
  mockTopWindow,
  mockSettings,
} = vi.hoisted(() => ({
  mockLoadTableStateFromFramesV2Detailed: vi.fn(),
  mockCollectScheduleSummaryFromFramesV2: vi.fn(() => ({})),
  mockDeriveSheetLifecycleFromFramesV2: vi.fn(() => ({
    statusBySheetKey: {},
    activeSheetKeys: [],
    hiddenSheetKeys: [],
    indeterminateSheetKeys: [],
    neverSeenSheetKeys: [],
  })),
  mockApi: {
    chatId: 'Parent Chat',
    getCurrentChatId: vi.fn(() => 'Parent Chat'),
    chatMetadata: {} as Record<string, unknown>,
    updateChatMetadata: vi.fn(),
  },
  mockTopWindow: {
    fetch: vi.fn(async () => new Response('ok')),
  },
  mockSettings: {
    dataIsolationEnabled: false,
    dataIsolationCode: '' as string | null,
  },
}));

vi.mock('../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: mockApi,
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: mockTopWindow,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../src/shared/utils')>('../../../src/shared/utils');
  return {
    ...actual,
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
    logError_ACU: vi.fn(),
  };
});

vi.mock('../../../src/service/table/storage-frame-v2-replay', () => ({
  loadTableStateFromFramesV2Detailed_ACU: mockLoadTableStateFromFramesV2Detailed,
  collectScheduleSummaryFromFramesV2_ACU: mockCollectScheduleSummaryFromFramesV2,
  deriveSheetLifecycleFromFramesV2_ACU: mockDeriveSheetLifecycleFromFramesV2,
}));

import {
  CHAT_SCOPED_CONFIG_FIELD_ACU,
  CHAT_SHEET_GUIDE_FIELD_ACU,
} from '../../../src/data/storage/chat-history';
import {
  __resetChatBranchSyncForTests_ACU,
  adoptCopiedChatMetadataOwnersForCurrentChat_ACU,
  getAcuChatMetadataOwnerField_ACU,
  injectBranchTableCheckpointIntoMessages_ACU,
  installChatBranchSync_ACU,
  isHostChatBranchOrCheckpointSave_ACU,
  isHostChatSaveUrl_ACU,
  prepareHostChatBranchSaveBody_ACU,
  rebindAcuChatMetadataOwners_ACU,
  resolveHostChatSaveDestId_ACU,
  rewriteHostChatBranchSaveRequest_ACU,
  splitHostChatSavePayload_ACU,
} from '../../../src/service/chat/chat-branch-sync';

function sheet(content: any[][] = [['row_id', '名称'], ['1', '铁剑']]) {
  return { uid: 'inventory', name: '背包', content, sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 };
}

function replayData(name = '铁剑') {
  return { mate: { type: 'acu' }, sheet_0: sheet([['row_id', '名称'], ['1', name]]) } as any;
}

function aiMsg(mes: string, frame?: any): any {
  const msg: any = { is_user: false, mes };
  if (frame) {
    msg.TavernDB_ACU_IsolatedData = { '': { storageFrame: frame, _acu_storage_version: 2 } };
  }
  return msg;
}

function userMsg(mes: string): any {
  return { is_user: true, mes };
}

function hostSaveBody(fileName: string, messages: any[], metadata: Record<string, unknown>) {
  return {
    ch_name: '角色',
    file_name: fileName,
    avatar_url: 'char.png',
    chat: [
      { chat_metadata: metadata, user_name: 'unused', character_name: 'unused' },
      ...messages,
    ],
  };
}

async function gzipText(text: string): Promise<Uint8Array> {
  const source = new Response(text).body!;
  return new Uint8Array(await new Response(source.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}

async function gunzipText(bytes: Uint8Array): Promise<string> {
  const source = new Response(bytes).body!;
  return await new Response(source.pipeThrough(new DecompressionStream('gzip'))).text();
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetChatBranchSyncForTests_ACU();
  mockApi.chatId = 'Parent Chat';
  mockApi.getCurrentChatId.mockReturnValue('Parent Chat');
  mockApi.chatMetadata = {};
  mockSettings.dataIsolationEnabled = false;
  mockSettings.dataIsolationCode = '';
  mockTopWindow.fetch = vi.fn(async () => new Response('ok'));
  mockLoadTableStateFromFramesV2Detailed.mockResolvedValue({ data: replayData() });
  mockCollectScheduleSummaryFromFramesV2.mockReturnValue({});
  mockDeriveSheetLifecycleFromFramesV2.mockReturnValue({
    statusBySheetKey: {},
    activeSheetKeys: [],
    hiddenSheetKeys: [],
    indeterminateSheetKeys: [],
    neverSeenSheetKeys: [],
  });
});

afterEach(() => {
  __resetChatBranchSyncForTests_ACU();
});

describe('rebindAcuChatMetadataOwners_ACU', () => {
  it('把父聊天 owner 改绑到新分支 id', () => {
    const metadata: Record<string, unknown> = {
      [CHAT_SCOPED_CONFIG_FIELD_ACU]: { version: 1, tags: { '': { mode: 'chat_override', templateStr: '{}' } } },
      [getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]: 'Parent Chat',
      [CHAT_SHEET_GUIDE_FIELD_ACU]: { version: 2, tags: {} },
      [getAcuChatMetadataOwnerField_ACU(CHAT_SHEET_GUIDE_FIELD_ACU)]: 'Parent Chat',
    };

    expect(rebindAcuChatMetadataOwners_ACU(metadata, 'Parent Chat - Branch #1')).toBe(true);
    expect(metadata[getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]).toBe('Parent Chat - Branch #1');
    expect(metadata[getAcuChatMetadataOwnerField_ACU(CHAT_SHEET_GUIDE_FIELD_ACU)]).toBe('Parent Chat - Branch #1');
  });

  it('owner 已是目标或为空时不改写', () => {
    const metadata: Record<string, unknown> = {
      [CHAT_SCOPED_CONFIG_FIELD_ACU]: { version: 1 },
      [getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]: 'Parent Chat - Branch #1',
      [CHAT_SHEET_GUIDE_FIELD_ACU]: { version: 2 },
    };
    expect(rebindAcuChatMetadataOwners_ACU(metadata, 'Parent Chat - Branch #1')).toBe(false);
    expect(metadata[getAcuChatMetadataOwnerField_ACU(CHAT_SHEET_GUIDE_FIELD_ACU)]).toBeUndefined();
  });
});

describe('adoptCopiedChatMetadataOwnersForCurrentChat_ACU', () => {
  it('改写当前 chatMetadata 并通知宿主缓存', () => {
    mockApi.chatMetadata = {
      [CHAT_SCOPED_CONFIG_FIELD_ACU]: { version: 1, tags: { '': { mode: 'chat_override' } } },
      [getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]: 'Parent Chat',
    };
    mockApi.getCurrentChatId.mockReturnValue('Parent Chat - Branch #1');

    expect(adoptCopiedChatMetadataOwnersForCurrentChat_ACU('Parent Chat - Branch #1')).toBe(true);
    expect(mockApi.chatMetadata[getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]).toBe('Parent Chat - Branch #1');
    expect(mockApi.updateChatMetadata).toHaveBeenCalledWith(
      { [getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]: 'Parent Chat - Branch #1' },
      false,
    );
  });
});

describe('宿主分支存档识别', () => {
  it('识别单聊 / 群聊保存 URL 与目标文件名', () => {
    expect(isHostChatSaveUrl_ACU('/api/chats/save')).toBe(true);
    expect(isHostChatSaveUrl_ACU('https://host/api/chats/group/save')).toBe(true);
    expect(isHostChatSaveUrl_ACU('/api/chats/get')).toBe(false);
    expect(resolveHostChatSaveDestId_ACU({ file_name: 'Name - Branch #1.jsonl' }, '/api/chats/save')).toBe('Name - Branch #1');
    expect(resolveHostChatSaveDestId_ACU({ id: 'Group - Branch #2' }, '/api/chats/group/save')).toBe('Group - Branch #2');
  });

  it('仅在另存新文件且带 main_chat 时视为分支/检查点', () => {
    const body = hostSaveBody('Parent Chat - Branch #1', [userMsg('hi')], { main_chat: 'Parent Chat' });
    expect(isHostChatBranchOrCheckpointSave_ACU(body, 'Parent Chat', '/api/chats/save')).toBe(true);
    expect(isHostChatBranchOrCheckpointSave_ACU(body, 'Parent Chat - Branch #1', '/api/chats/save')).toBe(false);

    const sameFile = hostSaveBody('Parent Chat', [userMsg('hi')], { main_chat: 'Parent Chat' });
    expect(isHostChatBranchOrCheckpointSave_ACU(sameFile, 'Parent Chat', '/api/chats/save')).toBe(false);

    const noMain = hostSaveBody('Other Chat', [userMsg('hi')], {});
    expect(isHostChatBranchOrCheckpointSave_ACU(noMain, 'Parent Chat', '/api/chats/save')).toBe(false);
  });

  it('main_chat 与当前聊天不一致（切换窗口期的在途保存）时不拦截', () => {
    const body = hostSaveBody('Parent Chat - Branch #1', [userMsg('hi')], { main_chat: 'Parent Chat' });
    // 当前聊天已切到 'Other Chat'：这是 'Parent Chat - Branch #1' 之外的另存，
    // 但 main_chat 指向 'Parent Chat' 而非当前聊天，说明不是此刻创建的分支。
    expect(isHostChatBranchOrCheckpointSave_ACU(body, 'Other Chat', '/api/chats/save')).toBe(false);
    // 真分支另存：保存发生时 main_chat 必为当前聊天。
    expect(isHostChatBranchOrCheckpointSave_ACU(body, 'Parent Chat', '/api/chats/save')).toBe(true);
  });

  it('把 JSONL 文件头从消息里拆出来', () => {
    const body = hostSaveBody('X', [userMsg('u'), aiMsg('a')], { main_chat: 'Parent Chat' });
    const split = splitHostChatSavePayload_ACU(body);
    expect(split.messages).toHaveLength(2);
    expect(split.messages[0].mes).toBe('u');
    expect(split.metadata?.main_chat).toBe('Parent Chat');
  });
});

describe('injectBranchTableCheckpointIntoMessages_ACU', () => {
  it('在最后一条 AI 楼上写入截止该楼层的 full checkpoint，且 logEntries 为空', async () => {
    const messages = [
      userMsg('u0'),
      aiMsg('a1', { version: 2, checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: replayData('旧') }, logEntries: [] }),
      userMsg('u1'),
      aiMsg('a2', { version: 2, logEntries: [{ seq: 1, operations: [{ kind: 'data_replace', data: replayData('新') }] }] }),
    ];

    const result = await injectBranchTableCheckpointIntoMessages_ACU(messages);

    expect(result.changed).toBe(true);
    expect(result.injectedKeys).toEqual(['']);
    expect(mockLoadTableStateFromFramesV2Detailed).toHaveBeenCalledWith(messages, '', {
      maxMessageIndex: 3,
      updateRuntimeState: false,
    });
    const tip = messages[3].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(tip.checkpoint).toMatchObject({ kind: 'full', reason: 'integrity_repair' });
    expect(tip.checkpoint.data.sheet_0.content[1][1]).toBe('铁剑');
    expect(tip.logEntries).toEqual([]);
  });

  it('分支点落在用户楼时，把 checkpoint 写到前一条 AI 楼', async () => {
    const messages = [
      aiMsg('a1', { version: 2, logEntries: [{ seq: 1, operations: [] }] }),
      userMsg('最后一句'),
    ];

    await injectBranchTableCheckpointIntoMessages_ACU(messages);

    expect(messages[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.kind).toBe('full');
    expect(messages[1].TavernDB_ACU_IsolatedData).toBeUndefined();
  });

  it('把隐藏表 hide checkpoint 迁到分支尖端', async () => {
    mockDeriveSheetLifecycleFromFramesV2.mockReturnValue({
      statusBySheetKey: {
        sheet_hidden: {
          status: 'hidden',
          restoreSourceData: sheet([['row_id', '备注'], ['1', '尘封']]),
        },
      },
      activeSheetKeys: [],
      hiddenSheetKeys: ['sheet_hidden'],
      indeterminateSheetKeys: [],
      neverSeenSheetKeys: [],
    });
    const messages = [
      aiMsg('a1', { version: 2, logEntries: [{ seq: 1, operations: [] }] }),
    ];

    await injectBranchTableCheckpointIntoMessages_ACU(messages);

    expect(messages[0].TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_hidden).toMatchObject({
      kind: 'sheet_full',
      sheetKey: 'sheet_hidden',
      timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
    });
  });

  it('注入后按当前隔离配置补写锚点消息 Identity', async () => {
    mockSettings.dataIsolationEnabled = true;
    mockSettings.dataIsolationCode = 'ISO-1';
    const messages = [
      aiMsg('a1', { version: 2, logEntries: [{ seq: 1, operations: [] }] }),
    ];

    const result = await injectBranchTableCheckpointIntoMessages_ACU(messages);

    expect(result.changed).toBe(true);
    expect(messages[0].TavernDB_ACU_Identity).toBe('ISO-1');
  });

  it('隔离关闭时注入后锚点消息不携带 Identity', async () => {
    const messages = [
      aiMsg('a1', { version: 2, logEntries: [{ seq: 1, operations: [] }] }),
    ];

    await injectBranchTableCheckpointIntoMessages_ACU(messages);

    expect(messages[0].TavernDB_ACU_Identity).toBeUndefined();
  });
});

describe('prepareHostChatBranchSaveBody_ACU', () => {
  it('同时改绑 header metadata 并注入截止 checkpoint', async () => {
    const body = hostSaveBody(
      'Parent Chat - Branch #1',
      [
        userMsg('u'),
        aiMsg('a', { version: 2, logEntries: [{ seq: 1, operations: [] }] }),
      ],
      {
        main_chat: 'Parent Chat',
        [CHAT_SCOPED_CONFIG_FIELD_ACU]: { version: 1, tags: { '': { mode: 'chat_override' } } },
        [getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]: 'Parent Chat',
      },
    );

    const result = await prepareHostChatBranchSaveBody_ACU(body, 'Parent Chat - Branch #1');

    expect(result.reboundOwners).toBe(true);
    expect(result.injectedKeys).toEqual(['']);
    const header = (body.chat as any[])[0];
    expect(header.chat_metadata[getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]).toBe('Parent Chat - Branch #1');
    expect((body.chat as any[])[2].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.kind).toBe('full');
  });
});

describe('rewriteHostChatBranchSaveRequest_ACU / fetch 拦截', () => {
  it('改写分支 POST /api/chats/save 的 JSON 体', async () => {
    const body = hostSaveBody(
      'Parent Chat - Branch #1',
      [aiMsg('a', { version: 2, logEntries: [{ seq: 1, operations: [] }] })],
      {
        main_chat: 'Parent Chat',
        [CHAT_SCOPED_CONFIG_FIELD_ACU]: { version: 1 },
        [getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]: 'Parent Chat',
      },
    );

    const rewritten = await rewriteHostChatBranchSaveRequest_ACU('/api/chats/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(rewritten).not.toBeNull();
    const parsed = JSON.parse(String(rewritten!.init.body));
    expect(parsed.chat[0].chat_metadata[getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]).toBe('Parent Chat - Branch #1');
    expect(parsed.chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
  });

  it('gzip 请求体（compressRequest 产物）解压改写后重压缩放行', async () => {
    const body = hostSaveBody(
      'Parent Chat - Branch #1',
      [aiMsg('a', { version: 2, logEntries: [{ seq: 1, operations: [] }] })],
      {
        main_chat: 'Parent Chat',
        [CHAT_SCOPED_CONFIG_FIELD_ACU]: { version: 1 },
        [getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]: 'Parent Chat',
      },
    );
    const compressed = await gzipText(JSON.stringify(body));

    const rewritten = await rewriteHostChatBranchSaveRequest_ACU('/api/chats/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: compressed,
    });

    expect(rewritten).not.toBeNull();
    const sentBody = rewritten!.init.body as Uint8Array;
    expect(sentBody).toBeInstanceOf(Uint8Array);
    const parsed = JSON.parse(await gunzipText(sentBody));
    expect(parsed.chat[0].chat_metadata[getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]).toBe('Parent Chat - Branch #1');
    expect(parsed.chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([]);
    const headers = new Headers(rewritten!.init.headers);
    expect(headers.get('Content-Encoding')).toBe('gzip');
    expect(headers.get('content-length')).toBeNull();
  });

  it('非 gzip 压缩编码（br）或损坏的 gzip 数据不拦截', async () => {
    const br = await rewriteHostChatBranchSaveRequest_ACU('/api/chats/save', {
      method: 'POST',
      headers: { 'Content-Encoding': 'br' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(br).toBeNull();

    const brokenGzip = await rewriteHostChatBranchSaveRequest_ACU('/api/chats/save', {
      method: 'POST',
      headers: { 'Content-Encoding': 'gzip' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(brokenGzip).toBeNull();
  });

  it('普通保存（无 main_chat）直接放行', async () => {
    const body = hostSaveBody('Some Other Chat', [aiMsg('a')], {});
    const rewritten = await rewriteHostChatBranchSaveRequest_ACU('/api/chats/save', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(rewritten).toBeNull();
  });

  it('当前聊天的普通保存不拦截', async () => {
    const body = hostSaveBody('Parent Chat', [aiMsg('a')], { main_chat: 'Parent Chat' });
    const rewritten = await rewriteHostChatBranchSaveRequest_ACU('/api/chats/save', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(rewritten).toBeNull();
  });

  it('install 后包装 topLevelWindow.fetch，并把改写后的 body 交给原始 fetch', async () => {
    const original = mockTopWindow.fetch;
    installChatBranchSync_ACU();
    installChatBranchSync_ACU();
    expect(mockTopWindow.fetch).not.toBe(original);

    const body = hostSaveBody(
      'Parent Chat - Branch #1',
      [aiMsg('a', { version: 2, logEntries: [{ seq: 1, operations: [] }] })],
      {
        main_chat: 'Parent Chat',
        [CHAT_SCOPED_CONFIG_FIELD_ACU]: { version: 1 },
        [getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]: 'Parent Chat',
      },
    );

    await mockTopWindow.fetch('/api/chats/save', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    expect(original).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(original.mock.calls[0][1].body));
    expect(sent.file_name).toBe('Parent Chat - Branch #1');
    expect(sent.chat[0].chat_metadata[getAcuChatMetadataOwnerField_ACU(CHAT_SCOPED_CONFIG_FIELD_ACU)]).toBe('Parent Chat - Branch #1');
  });
});
