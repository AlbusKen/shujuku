export const contentReplaceCopy = {
  nav: {
    basic: "基础设置",
    mode: "替换模式",
    preset: "预设",
    filter: "标签筛选",
    test: "手动测试",
  },
  panels: {
    basic: {
      title: "基础设置",
      description: "选择使用的 API，以及短文本跳过和失败重试规则。",
    },
    mode: {
      title: "替换模式",
      description:
        "无感模式开启后会直接把优化结果写回聊天；关闭则需手动确认。排查误改时建议关闭，方便对比。",
    },
    preset: {
      title: "正文替换预设",
      description:
        "下拉框切换正文替换预设，点星标设为全局默认。内置默认预设无法修改，请使用“从默认新建”。",
    },
    filter: {
      title: "标签筛选",
      description:
        "按标签筛选要处理的正文范围。提取只保留指定范围，排除会跳过指定范围。",
    },
    test: {
      title: "手动测试",
      description:
        "用当前配置测试文本效果，不会写回聊天。失败通常是 API、提示词格式或标签筛选问题。",
    },
  },
};
