export const continuationCopy = {
  panels: {
    conditions: {
      title: "循环条件",
      description: "控制续写条件与续写时间。",
    },
    prompts: {
      title: "循环提示词",
      description:
        "按顺序自动发送，队列结束后将从头循环。为空无法启动，请确保至少一条可发送内容。",
    },
    controls: {
      title: "运行控制",
      description:
        "启动后自动填入下一条提示词并发送，每次 AI 回复后继续。停止仅停止后续，不影响已发送内容。",
    },
  },
  workflow: {
    title: "固定工作流",
    description: "主会话每轮只做开局决策。结算、策划、条件审查、容错提交和写作指令由程序按固定顺序执行。这里只改配置，提示词仍在下方各角色分组里改。",
  },
  composer: {
    title: "写作指令编排子代理（instruction-composer）提示词",
    note: "固定工作流在策划与审查之后调用，是唯一产出本轮写作指令的角色。不进入主 Agent 可派工目录。契约 JSON 为 {instruction, summary, constraints}。",
  },
};
