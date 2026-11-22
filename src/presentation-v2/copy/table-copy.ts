export const tableCopy = {
  panels: {
    templatePreset: {
      title: "表格模板预设",
      description:
        "下拉框切换当前表格模板，点星标设为全局默认。可直接导出当前生效模板（在编辑器改过但未存进预设库时，按改后的导出）。内置默认预设不能修改，请使用“从默认新建”。",
    },
    injectionTarget: {
      title: "写入目标世界书",
      description:
        "表格数据写入的世界书。默认选择角色卡主世界书，也可另选；角色卡没世界书时需先新建并绑定。",
    },
    entries: {
      title: "附加世界书条目",
      description:
        "填表时附加给 AI 参考的世界书条目。默认跟随角色卡，也可手动指定并单独开关，与“写入目标世界书”互不影响。",
    },
  },
  worldbook: {
    emptyDefault: "所选世界书中无可显示的条目。",
    emptyCharacter:
      "未找到角色卡世界书。打开聊天后会显示条目，也可手动选一本。",
    emptyManual: "请先选择一本世界书。",
  },
};
