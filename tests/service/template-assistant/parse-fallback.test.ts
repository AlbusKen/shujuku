import { describe, expect, it } from 'vitest';

import { buildTemplateAssistantEmbeddedReferenceText_ACU } from '../../../src/service/template-assistant/reference-docs';
import {
  parseTemplateAssistantDraft_ACU,
  resolveAssistantSystemPrompt_ACU,
  TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU,
  TEMPLATE_ASSISTANT_CORE_PROTOCOL_MARKER_ACU,
  buildCoreProtocolCard_ACU,
} from '../../../src/service/template-assistant/service';

const DRAFT_JSON = JSON.stringify({
  protocolVersion: 2,
  mode: 'modify_current_template_incremental',
  requestId: 'req-fallback',
  baseFingerprint: 'acu-struct:1',
  atomic: true,
  selectedSheetKey: 'sheet_a',
  summary: '容错解析成功',
  warnings: [],
  operations: [],
});

describe('template assistant 容错解析链', () => {
  it('标准 <templateAssistantDraft> 标签包裹路径不变', () => {
    const draft = parseTemplateAssistantDraft_ACU(`解释文本<templateAssistantDraft>${DRAFT_JSON}</templateAssistantDraft>尾巴`);
    expect(draft.summary).toBe('容错解析成功');
  });

  it('带 ```json 围栏且无标签时剥离围栏后可解析', () => {
    const text = `以下是草稿：\n\`\`\`json\n${DRAFT_JSON}\n\`\`\``;
    const draft = parseTemplateAssistantDraft_ACU(text);
    expect(draft.summary).toBe('容错解析成功');
  });

  it('裸 JSON（无标签无围栏）可通过首尾大括号截取解析', () => {
    const text = `好的，这是你要的草稿：\n${DRAFT_JSON}`;
    const draft = parseTemplateAssistantDraft_ACU(text);
    expect(draft.summary).toBe('容错解析成功');
  });

  it('纯垃圾文本抛错且错误信息包含定位说明', () => {
    expect(() => parseTemplateAssistantDraft_ACU('这段文字完全不是 JSON')).toThrow(/JSON|未找到|未闭合/);
  });

  it('标签内 JSON 非法时仍报 JSON 解析失败', () => {
    expect(() => parseTemplateAssistantDraft_ACU('<templateAssistantDraft>{not-json}</templateAssistantDraft>')).toThrow(/JSON 解析失败/);
  });

  it('字符串内部含 { } 的大括号配对扫描不会被误切', () => {
    const text = `说明：{模板} 中的内容将被替换。\n${JSON.stringify({ ...JSON.parse(DRAFT_JSON), summary: '含花括号 {x}' })}`;
    const draft = parseTemplateAssistantDraft_ACU(text);
    expect(draft.summary).toBe('含花括号 {x}');
  });

  it('容错解析成功后仍走完整协议校验，不放宽闸门', () => {
    const invalidDraft = JSON.stringify({
      protocolVersion: 2,
      mode: 'modify_current_template_incremental',
      baseFingerprint: 'acu-struct:1',
      atomic: true,
      selectedSheetKey: 'sheet_a',
      summary: '缺 requestId',
      warnings: [],
      operations: [],
    });
    expect(() => parseTemplateAssistantDraft_ACU(invalidDraft)).toThrow(/requestId/);
  });
});

describe('提示词占位符与默认等价', () => {
  it('自定义 segments 含占位符时只替换一次，不重复追加', () => {
    const messages = resolveAssistantSystemPrompt_ACU([
      { role: 'SYSTEM', content: `规则一\n${TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU}` },
      { role: 'USER', content: '用户补充规则' },
    ]);
    expect(messages).toHaveLength(2);
    const systemContent = messages[0]?.content || '';
    expect(systemContent).not.toContain(TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU);
    expect(systemContent).toContain('【原文嵌入 / syntax-reference (1).md');
    // 占位符替换为引用文档全文且未二次追加：以完整引用文本作为整体子串只出现一次
    const referenceText = buildTemplateAssistantEmbeddedReferenceText_ACU();
    expect(systemContent.split(referenceText).length - 1).toBe(1);
    expect(messages[1]?.role).toBe('USER');
    expect(messages[1]?.content).toBe('用户补充规则');
  });

  it('自定义 segments 无占位符时在最后一个 SYSTEM 卡末尾自动追加引用文档', () => {
    const messages = resolveAssistantSystemPrompt_ACU([
      { role: 'SYSTEM', content: '第一条规则' },
      { role: 'SYSTEM', content: '第二条规则' },
      { role: 'USER', content: '提示' },
    ]);
    expect(messages).toHaveLength(3);
    expect(messages[2]?.role).toBe('USER');
    const secondSystem = messages[1]?.content || '';
    expect(secondSystem).toContain('第二条规则');
    expect(secondSystem).toContain('【原文嵌入 / syntax-reference (1).md');
    expect(messages[0]?.content).not.toContain('【原文嵌入');
  });

  it('空 segments 回退到默认提示词（存量用户行为不变）', () => {
    const messages = resolveAssistantSystemPrompt_ACU([]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('你是 visualizer 内的模板改表助手，你生活在一个虚拟的世界');
    expect(messages[0]?.content).toContain('【原文嵌入');
  });

  it('默认回退路径 role 为小写 system，与旧版 buildTemplateAssistantMessages 消息结构字节级一致', () => {
    // 旧版：messages[0] = { role: 'system', content: buildSystemPrompt_ACU() }（system 小写，内容含引用原文）
    // 回归点：默认路径必须保留小写 role，避免发送给 AI 的存量消息结构被改变
    const messages = resolveAssistantSystemPrompt_ACU(null);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('system');
    // 占位符已被替换为引用文档全文，且未残留占位符
    expect(messages[0]?.content).not.toContain(TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU);
    // 内容以默认提示词开头、以引用文档收尾，与旧版 buildSystemPrompt_ACU 的 join 结构一致
    expect(messages[0]?.content.startsWith('你是 visualizer 内的模板改表助手，你生活在一个虚拟的世界')).toBe(true);
    expect(messages[0]?.content.endsWith(
      buildTemplateAssistantEmbeddedReferenceText_ACU(),
    )).toBe(true);
  });

  it('非法 role 归一为 SYSTEM，空内容段被过滤', () => {
    const messages = resolveAssistantSystemPrompt_ACU([
      { role: 'weird', content: '自定义段' },
      { role: 'USER', content: '   ' },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('SYSTEM');
    expect(messages[0]?.content).toContain('自定义段');
  });

  it('旧自定义提示词（无核心协议标记）自动追加核心协议卡到最后一个 SYSTEM 卡', () => {
    const messages = resolveAssistantSystemPrompt_ACU([
      { role: 'SYSTEM', content: '我的自定义规则' },
      { role: 'USER', content: '用户补充规则' },
    ], null, 2);
    expect(messages).toHaveLength(2);
    const systemContent = messages[0]?.content || '';
    // 核心协议卡被追加（含操作路由标记）
    expect(systemContent).toContain(TEMPLATE_ASSISTANT_CORE_PROTOCOL_MARKER_ACU);
    expect(systemContent).toContain('【操作路由】');
    expect(systemContent).toContain('patch_sheet_update_config');
    expect(systemContent).toContain('patch_sheet_source_data');
    expect(systemContent).toContain('patch_sheet_content');
    expect(systemContent).toContain('patch_sheet_schema');
    // 不改变用户消息顺序：USER 卡保持原位
    expect(messages[1]?.role).toBe('USER');
    expect(messages[1]?.content).toBe('用户补充规则');
  });

  it('已含核心协议标记的自定义提示词不重复追加（幂等）', () => {
    const messages = resolveAssistantSystemPrompt_ACU([
      { role: 'SYSTEM', content: `${TEMPLATE_ASSISTANT_CORE_PROTOCOL_MARKER_ACU}\n我的规则` },
      { role: 'USER', content: '用户补充规则' },
    ]);
    expect(messages).toHaveLength(2);
    const systemContent = messages[0]?.content || '';
    // 标记只出现一次（未重复追加核心协议卡）
    expect(systemContent.split(TEMPLATE_ASSISTANT_CORE_PROTOCOL_MARKER_ACU).length - 1).toBe(1);
  });

  it('默认路径（无自定义 segments）不追加核心协议卡（存量字节级兼容）', () => {
    const messages = resolveAssistantSystemPrompt_ACU(null);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).not.toContain(TEMPLATE_ASSISTANT_CORE_PROTOCOL_MARKER_ACU);
  });

  it('核心协议卡不依赖占位符（$1-$4 与 referenceDocs 均不出现）', () => {
    const coreCard = buildCoreProtocolCard_ACU();
    expect(coreCard).not.toContain('$1');
    expect(coreCard).not.toContain('$2');
    expect(coreCard).not.toContain('$3');
    expect(coreCard).not.toContain('$4');
    expect(coreCard).not.toContain(TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU);
  });
});
