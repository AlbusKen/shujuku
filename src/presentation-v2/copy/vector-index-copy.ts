export const vectorIndexCopy = {
  nav: {
    status: "索引状态",
    keyword: "关键词",
    api: "向量服务",
    prompt: "提示词",
    recall: "召回参数",
    archive: "归档分块",
  },
  panels: {
    status: {
      title: "索引状态",
      description: "显示当前索引状态。清缓存只清临时数据；删除索引后需要重新构建。",
    },
    keyword: {
      title: "关键词生成",
      description: "发送前先用轻量 AI 生成关键词辅助召回记忆，失败也不影响正常发送。",
    },
    api: {
      title: "Embedding / Rerank",
      description:
        "向量表格与交火模式共用此配置。Embedding 负责初筛相关记忆；Rerank 负责二次精选，在交火模式中可选，在向量表格中必填。",
    },
    prompt: {
      title: "关键词生成提示词",
      description: "控制 AI 如何提炼关键词，建议保持默认。",
    },
    recall: {
      title: "召回参数",
      description:
        "控制纪要达到多少条才开启召回、每次召回几条及固定保留几条。填错会自动纠正；建议“触发阈值 ≥ 最近固定 + 每次召回条数”。",
    },
    archive: {
      title: "归档与分块",
      description:
        "纪要保存后自动拆分并归档。拆得越细找得越准，但碎片越多；同时请求数调低会变慢。",
    },
  },
};
