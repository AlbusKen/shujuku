export const continuationCopy = {
  panels: {
    conditions: {
      title: "循环条件",
      description: "控制续写条件与续写时间。",
    },
    prompts: {
      title: "循环提示词",
      description:
        "按顺序自动发送，发完后从头循环。至少填一条内容才能启动。",
    },
    controls: {
      title: "运行控制",
      description:
        "启动后自动填入下一条提示词并发送，AI 回复完继续。停止只停后续，不影响已发送的内容。",
    },
  },
  workflow: {
    title: "固定工作流",
    description: "主 Agent 每轮只做开局决策，后面的结算、策划、审查和写作指令按固定顺序自动跑完。这里只改参数，提示词在下方各角色分组里改。",
  },
  composer: {
    title: "写作指令编排子代理（instruction-composer）提示词",
    note: "在策划与审查之后运行，专门负责产出本轮的最终写作指令。",
  },
};
