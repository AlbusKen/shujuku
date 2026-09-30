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
      description: "显示当前索引信息。清缓存仅清临时数据；删除索引需重新构建。",
    },
    keyword: {
      title: "关键词生成",
      description: "发送前用轻量AI生成关键词辅助召回。失败时回退，不影响发送。",
    },
    api: {
      title: "Embedding / Rerank",
      description:
        "向量表格与交火模式共用的向量配置。Embedding 负责向量召回；Rerank 在交火模式中为可选增强，在向量表格中必填。",
    },
    prompt: {
      title: "关键词生成提示词",
      description: "控制AI如何理关键词。建议保持默认。",
    },
    recall: {
      title: "召回参数",
      description:
        "控制纪要启用召回的条件、每次注入条数及固定注入条数。配置错误（如候选上限 < TopK）会自动纠正；建议保持「触发阈值 ≥ 最近固定 + TopK」，避免无效工作。",
    },
    archive: {
      title: "归档与分块",
      description:
        "纪要保存后自动切句并分批上传。值越小召回越精细，分片越多。并发上限低会让归档变慢。",
    },
  },
};
