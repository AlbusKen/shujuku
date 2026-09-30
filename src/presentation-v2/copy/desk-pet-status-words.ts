/**
 * 桌宠任务气泡的状态词：似是而非的短词，后面再接真实进度。
 * 按功能分组；未识别的功能落到 generic。
 */
export const deskPetStatusWords = {
  table: ["翻账本", "对表格", "抄小本本", "数格子", "描边框", "誊写中", "对账中", "补漏项", "排行列", "盖戳"],
  plan: ["掐指", "摆沙盘", "看星象", "推演中", "琢磨", "画路线", "扔骰子", "排兵布阵"],
  polish: ["抛光", "捋句子", "修边角", "润色中", "挑错字", "磨字眼", "顺语气", "打蜡"],
  continuation: ["构思", "打腹稿", "咬笔头", "憋大招", "起承转合", "续墨中", "想下文", "铺伏笔"],
  simulation: ["推沙盘", "算因果", "拨时钟", "看天下", "摇签筒", "牵线头", "观棋中", "排因缘"],
  import: ["嚼书页", "切块", "翻页中", "啃目录", "拆包裹", "吞文字", "分装中", "码书脊"],
  index: ["翻旧账", "找线头", "对暗号", "嗅线索", "理卷宗", "串珠子", "查底档", "扫书架"],
  skill: ["贴标签", "归档", "分门别类", "写说明书", "装盒子", "编号中", "理抽屉", "做卡片"],
  generic: ["忙活中", "发功", "嘀咕", "搬砖", "埋头苦干", "转圈圈", "冒热气", "咕噜咕噜"],
} as const;

export type DeskPetStatusGroup = keyof typeof deskPetStatusWords;

const FEATURE_GROUP_RULES: Array<[RegExp, DeskPetStatusGroup]> = [
  [/填表|追平/, "table"],
  [/规划/, "plan"],
  [/优化/, "polish"],
  [/续写/, "continuation"],
  [/推演/, "simulation"],
  [/导入/, "import"],
  [/交火|索引|召回/, "index"],
  [/skill/i, "skill"],
];

export function resolveDeskPetStatusGroup(feature: string): DeskPetStatusGroup {
  const text = String(feature || "");
  for (const [pattern, group] of FEATURE_GROUP_RULES) {
    if (pattern.test(text)) return group;
  }
  return "generic";
}

/** 为某个功能随机挑一个状态词。 */
export function pickDeskPetStatusWord(feature: string, random: () => number = Math.random): string {
  const words = deskPetStatusWords[resolveDeskPetStatusGroup(feature)];
  return words[Math.floor(random() * words.length) % words.length];
}
