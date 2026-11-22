export const importCopy = {
  panels: {
    worldbookTarget: {
      title: "写入目标",
      description:
        "导入内容写入的世界书。建议选独立世界书，避免与角色卡混用。",
    },
    splitEncoding: {
      title: "拆分与编码",
      description:
        "文件按字数分段，每段一条目。非 UTF-8 文件请选对编码，避免乱码。",
    },
    tableSelection: {
      title: "写入表格选择",
      description:
        "需先选用制卡专用表格模板，且至少勾选一项表格才能点击“写入”。",
    },
    operations: {
      title: "状态 / 操作区",
      description:
        "先点“选择并拆分”载入 TXT 文件，再点“写入”存进世界书。“清空缓存”只丢弃未写入内容，“删除条目”会移除已写入的条目。",
    },
  },
};
