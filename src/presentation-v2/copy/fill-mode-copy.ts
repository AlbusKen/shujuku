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
    summary: '沿用稳定的经典填表流程，把纪要交给大总结逐步归纳，是新安装的默认模式。',
    pros: '快速无感，不需要额外配置，也不会增加请求次数。',
    cons: '大总结可能会压缩部分细节。',
  },
  vector: {
    label: '向量表格模式',
    summary: '用 embedding 与 rerank 直接选出与当前情节相关的纪要，并把选中的纪要条目切为蓝灯注入；纪要索引保持完整目录。不生成关键词、不做混合召回，也不触发剧情推进。',
    pros: '快速无感，不额外增加正文生成前的 LLM 调用。',
    cons: '需要单独配置向量参数；向量的语义匹配不如 LLM 召回的逻辑匹配精准。',
  },
  llm: {
    label: 'LLM模型逻辑召回模式',
    summary: '由 LLM 先读纪要概览与目录，再按信息缺口精读具体纪要区间。',
    pros: '无可比拟的精准。',
    cons: '需要在每次正文生成前额外调用一次 LLM 进行记忆分析。',
  },
  crossfire: {
    label: '交火模式',
    summary: '关键词生成、向量与 BM25 混合召回、rerank 精排，再交给 LLM 做逻辑分析的完整流程。',
    pros: '完全结合向量模式与 LLM 召回的优点。',
    cons: '需要配置向量参数，并且保留正文生成前的额外 LLM 调用。',
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
        return `当前对话使用「${currentLabel}」，纪要表会持续累积，切回经典表格模式会超出经典模式的纪要窗口，因此不能切回。需要经典表格模式时请新开对话，可先点击五角星把经典表格模式设为新对话的偏好模式。`;
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
      return `即将把当前对话切换为「${targetLabel}」。切换后会删除大总结表，已被大总结归纳的纪要恢复可见，纪要表恢复原导出方式。切换后当前对话不能再切回经典表格模式。`;
    },
  },
  templateChanged: {
    title: '表格模板已修改',
    confirmLabel: '恢复模板并切换',
    message: '启用经典表格模式后，当前对话的表格模板被修改过。继续切换会恢复为启用经典表格模式前的模板，覆盖这些修改。',
  },
  panels: {
    mode: {
      title: '填表模式',
      description: '选择当前对话如何为正文生成召回记忆。模式按对话记录；每种模式的参数独立保存，切换模式不会覆盖其它模式，也不会改变功能档位。',
      selectHint: '五角星设为新对话偏好模式。经典表格模式可切换为其它模式，其它模式不能切回经典。',
      preferActiveTitle: '新对话偏好模式',
      preferInactiveTitle: '设为新对话偏好模式',
      nativeToolLabel: '填表使用工具调用',
      nativeToolHint:
        '默认关闭，四种模式通用。开启后填表改走 table_edit / table_sql 原生工具提交，默认提示词同步切换；部分渠道不支持工具调用，收到 tools 字段会直接报错。',
    },
    plot: {
      title: '剧情推进',
      description: 'LLM模型逻辑召回模式与交火模式依赖剧情推进在正文生成前分析记忆。关闭后这两种模式只保留表格召回，不再执行剧情规划。',
      enableLabel: '启用剧情推进',
      enableHint: '关闭后不再在正文生成前额外调用 LLM；当前模式的其余召回行为不变。',
      disguiseDisabledLabel: '解除发送伪装',
      disguiseDisabledHint: '默认关闭。开启后原文停留在输入框等待剧情 AI 返回，再写入最终提示词；不显示临时用户楼层和思考楼层。最终发送仍受交接保护。',
    },
    worldbook: {
      title: '剧情推进世界书',
      description: '选择剧情推进分析时读取的世界书条目。',
    },
  },
};
