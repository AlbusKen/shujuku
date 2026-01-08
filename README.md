# shujuku（神·数据库）

## 触发规则（已修复“其它插件 API 调用误触发”）

为避免其它扩展/插件的后台调用（尤其是 quiet/后台生成、工具调用）误触发本脚本的逻辑，本项目对触发条件做了门控：

- **剧情推进**：仅在 **用户在酒馆界面真实发送消息** 时触发（`MESSAGE_SENT` → 紧随其后的 `GENERATION_AFTER_COMMANDS`），并且会过滤 `quiet_prompt` / `type === 'quiet'` / `automatic_trigger`。
- **自动填表更新**：仅在 **本次生成不是 quiet/后台生成** 时触发（通过 `GENERATION_STARTED` 记录上下文，在 `GENERATION_ENDED` 时过滤）。

如需调整“用户发送→生成”的容忍窗口，可在 `shujuku/index.js` 中搜索并修改 `USER_SEND_TRIGGER_TTL_MS_ACU`。