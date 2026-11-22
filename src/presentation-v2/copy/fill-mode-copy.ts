/**
 * fill-mode-copy — 填表模式页文案。
 *
 * 四种模式的完整名称、简介与优缺点集中在此，供下拉菜单与说明面板共用。
 */
import type { FillMode_ACU } from '../../service/fill-mode/fill-mode-preferences';

export interface FillModeIntro {
  label: string;
  summary: string;
  pros: string;
  cons: string;
}

export const FILL_MODE_INTROS: Record<FillMode_ACU, FillModeIntro> = {
  classic: {
    label: '经典表格模式',
    summary: '稳定的经典模式，把纪要交给大总结逐步归纳。',
    pros: '快速且无感，无需额外配置，也不会增加请求次数。',
    cons: '大总结可能会压缩部分细节。',
  },
  vector: {
    label: '向量表格模式',
    summary: '用 Embedding 和 Rerank 直接挑出与当前剧情相关的纪要并转为蓝灯注入，不触发剧情推进。',
    pros: '快速且无感，写正文前不额外调用 AI。',
    cons: '需要单独配置向量参数；准确度不如 AI 逻辑召回。',
  },
  llm: {
    label: 'LLM模型逻辑召回模式',
    summary: '剧情推进 AI 先看纪要目录并输出关键词，用来触发对应的记忆条目给正文 AI。',
    pros: '无可比拟的精准。',
    cons: '每次写正文前需额外调用一次 AI 分析记忆。',
  },
  crossfire: {
    label: '交火模式',
    summary: '先用关键词和向量筛选并重排纪要，再交给 AI 做逻辑分析。',
    pros: '结合向量模式与 AI 召回两者的优点。',
    cons: '既要配置向量参数，写正文前也会额外调用一次 AI。',
  },
};

export const fillModeCopy = {
  pageTitle: '填表模式',
  nav: {
    mode: '填表模式',
    plot: '剧情推进',
  },
  reject: {
    title: '无法切换填表模式',
    message(reason: string, currentLabel: string, error?: string): string {
      if (reason === 'classic_locked') {
        return `当前聊天使用「${currentLabel}」，纪要已超出经典模式上限，无法切回。想用回经典模式请新开聊天，记得先把它设为默认。`;
      }
      if (reason === 'record_invalid') {
        return '当前对话的填表模式记录无法识别，为避免纪要表超出经典模式的纪要窗口，已拒绝切回经典表格模式。';
      }
      if (reason === 'no_active_chat') {
        return '当前没有打开的对话，无法切换对话的填表模式。点击五角星可以设置新对话的偏好模式。';
      }
      if (reason === 'classic_enable_failed') {
        return `无法启用经典表格模式，当前对话仍使用「${currentLabel}」。${error ? `原因：${error}` : ''}`;
      }
      if (reason === 'classic_disable_failed') {
        return `无法退出经典表格模式，当前对话仍使用经典表格模式。${error ? `原因：${error}` : ''}`;
      }
      return `填表模式保存失败，当前对话仍使用「${currentLabel}」。${error ? `原因：${error}` : ''}`;
    },
  },
  leaveClassic: {
    title: '退出经典表格模式',
    confirmLabel: '确认切换',
    message(targetLabel: string): string {
      return `即将切换为「${targetLabel}」。切换后会删掉大总结表并恢复旧纪要显示，且之后不能再切回经典模式。`;
    },
  },
  templateChanged: {
    title: '表格模板已修改',
    confirmLabel: '恢复模板并切换',
    message: '启用经典模式后模板被改过，继续切换会恢复成切换前的模板，覆盖这些修改。',
  },
  classicReadiness: {
    label: '经典表格状态',
    retryLabel: '重新启用',
    pendingTitle: '未就绪',
    failedTitle: '启用失败',
    pending(reason: string): string {
      if (reason === 'table_not_loaded') return '表格数据还没加载完成，加载后重新打开聊天或点“重新启用”。';
      if (reason === 'chat_changed') return '启用过程中切换了聊天，请点“重新启用”。';
      return '经典表格尚未启用，已按经典模式跳过剧情推进和向量召回。';
    },
    failed(error: string): string {
      return `经典表格启用失败，已按经典模式跳过剧情推进和向量召回。原因：${error}`;
    },
  },
  panels: {
    mode: {
      title: '填表模式',
      description: '选择当前聊天用哪种方式召回记忆。各模式参数独立保存，切换不会互相覆盖。',
      selectHint: '点星标设为新聊天的默认模式。经典模式可切去其它模式，但其他模式不能切换到经典模式。',
      preferActiveTitle: '新对话偏好模式',
      preferInactiveTitle: '设为新对话偏好模式',
      nativeToolLabel: '填表使用工具调用',
      nativeToolHint:
        '默认关闭。开启后改用工具调用方式填表，默认提示词会同步切换；部分渠道不支持工具调用，开启后会直接报错。',
    },
    plot: {
      title: '剧情推进',
      description: 'AI 逻辑召回和交火模式依赖剧情推进在写正文前分析记忆。关闭后只保留表格召回，不再做剧情规划。',
      enableLabel: '启用剧情推进',
      enableHint: '关闭后写正文前不再额外调用 AI，其它记忆功能不变。',
      disguiseDisabledLabel: '解除发送伪装',
      disguiseDisabledHint: '默认关闭。开启后你发的话会留在输入框里等剧情推进跑完再发，不显示临时楼层；失败或手动终止则取消发送。',
    },
    worldbook: {
      title: '剧情推进世界书',
      description: '选择剧情推进分析时读取的世界书条目。',
    },
  },
};
