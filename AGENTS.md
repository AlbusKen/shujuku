# 项目工程规则

## 项目概况
- 本项目是 TypeScript/Vue 的 SillyTavern 扩展与 userscript，服务代码位于 `src/service/`，Vue 页面位于 `src/presentation-v2/`，测试位于 `tests/`。
- 构建入口为 `src/index.ts`（userscript）与 `src/entry-extension.ts`（extension）；Rollup 配置见 `rollup.config.js`。

## 工具链与验证
- 使用 pnpm、TypeScript 5.7、Vitest 3.2、Rollup 4、Vue 3。
- Windows 下直接调用本地 `.cmd`：`& .\node_modules\.bin\tsc.cmd --noEmit`、`& .\node_modules\.bin\vitest.cmd run <tests>`。
- 变更后先运行最接近改动的定向测试，再运行类型检查与风险相关回归；完整交付还需 `git diff --check`。
- Vitest 默认最多 4 workers；资源或稳定性受限时使用 `--maxWorkers=1`，不得据此声称并行套件已验证。

## 本地打包与发布
- 本地打包入口是 `package.json` 的 `build` 脚本；在当前工作区直接执行，不为范围明确的发布另建隔离工作区或委派子代理。PowerShell 命令：`$env:ACU_BUILD_VERSION='1.2.9'; & npm.cmd run build`。未要求升级版本时保持安装版本 1.2.9，不使用 package.json 的 1.0.0 作为安装版本。
- 构建会同步根目录 `index.js` 与 `酒馆助手脚本-龙血玄黄·数据库.json`；提交前核对脚本语法、版本头及 JSON 的 `content` 与 `index.js` 完全一致。
- 发布暂存直接执行 `git add -A`；`dist/` 是构建中间目录，不纳入发布提交。已有被跟踪的 dist 产物会被 add all 暂存，因此紧接着执行 `git restore --staged -- dist/`，仅排除暂存，不删除或还原本地产物。
- `AGENTS.md` 是项目规则文档；因根目录 Markdown 被忽略，明确需要提交规则时仅对该文件使用 `git add -f -- AGENTS.md`，不强制添加其他忽略文件。
- 助手明确授权发布后，直接完成本地打包、产物核验、`git add -A` 全量暂存（排除 `dist`）、提交和推送，不重复询问已明确的流程。提交推送到 `main`；同版本发布按授权覆盖标签 `naiv1.2.9`。覆盖标签使用远端旧标签对象的 `--force-with-lease`，主分支不强推。
- 推送前核对暂存文件清单及远端基线；推送后回读远端 `main` 与标签的 peeled commit，二者须指向本次提交。远端并发变化或合并冲突时停止，不擅自改写业务代码解决冲突。

## 稳定边界
- 宿主 API 与消息数据访问通过现有 shared/data gateway 或已验证的 service adapter；不要凭字段名猜测 active swipe、聊天身份或保存语义。
- 持久化读取须保留结构化错误；损坏数据不得静默伪装为空状态或在读取时隐式改写。
- 多个独立宿主保存不是跨字段事务；只有实际存在的提交原语才能称为原子提交。
- 新功能必须使用独立持久化字段和类型，不得复用或污染其他功能的私有字段。
- 修改前搜索定义、调用方与测试；涉及存储时同时核对生产适配器和失败恢复路径。

## 文档与状态
- `.limcode/plans/` 是用户方案来源，实施核实结论写入任务缓存或进度，不直接回写方案正文。
- `.analysis-cache.md` 是当前复杂任务的临时状态锚，不作为长期项目日志。
