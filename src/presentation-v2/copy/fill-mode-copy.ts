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
    summary: '用 embedding 与 rerank 直接选出与当前情节相关的纪要，不生成关键词，也不做混合召回。',
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
  panels: {
    mode: {
      title: '填表模式',
      description: '选择数据库如何为本次正文生成召回记忆。每种模式的参数独立保存，切换模式不会覆盖其它模式，也不会改变功能档位。',
    },
    intro: {
      title: '模式对比',
      description: '四种模式的适用场景与代价。拿不定主意时保持经典表格模式即可。',
    },
    plot: {
      title: '剧情推进',
      description: 'LLM模型逻辑召回模式与交火模式依赖剧情推进在正文生成前分析记忆。关闭后这两种模式只保留表格召回，不再执行剧情规划。',
      enableLabel: '启用剧情推进',
      enableHint: '关闭后不再在正文生成前额外调用 LLM；当前模式的其余召回行为不变。',
    },
    worldbook: {
      title: '剧情推进世界书',
      description: '选择剧情推进分析时读取的世界书条目。',
    },
  },
};
