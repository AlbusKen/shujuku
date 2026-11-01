# 龙血玄黄·数据库（shujuku）外部 API 调用文档

本文档详细说明了 `龙血玄黄·数据库` 插件对外暴露的 API 接口，供其他插件或扩展调用。

## 访问 API

所有 API 方法通过全局对象 `window.AutoCardUpdaterAPI` 访问：

```javascript
// 检查 API 是否可用
if (window.AutoCardUpdaterAPI) {
    // 调用 API 方法
    const presets = window.AutoCardUpdaterAPI.getPlotPresetNames();
}
```

---

## 目录

- [剧情推进预设管理 API](#剧情推进预设管理-api)
- [数据导入导出 API](#数据导入导出-api)
- [表格操作 API](#表格操作-api)
- [设置与更新 API](#设置与更新-api)
- [世界书操作 API](#世界书操作-api)
- [TXT导入链路 API](#txt导入链路-api)
- [外部导入 Headless API](#外部导入-headless-api)
- [Agent 世界书 API](#agent-世界书-api)
- [表格锁定 API](#表格锁定-api)
- [回调注册 API](#回调注册-api)
- [更新配置参数 API](#更新配置参数-api)
- [手动更新表选择 API](#手动更新表选择-api)
- [API 预设管理 API](#api-预设管理-api)
- [AI 调用 API](#ai-调用-api)
- [格林推演 API](#格林推演-api)
- [智能续写 API](#智能续写-api)
- [功能开关 API（桌宠 / 气泡 / 功能页）](#功能开关-api桌宠--气泡--功能页)
- [桌宠与气泡外观 API](#桌宠与气泡外观-api)

---

## 剧情推进预设管理 API

### `getPlotPresets()`

获取所有剧情预设列表（完整数据）。

**返回值**: `Array<Object>` - 预设数组的深拷贝，每个预设包含完整配置

**示例**:
```javascript
const presets = window.AutoCardUpdaterAPI.getPlotPresets();
// 返回: [
//   { name: "默认预设", promptGroup: [...], rateMain: 1.0, ... },
//   { name: "战斗场景", promptGroup: [...], rateMain: 1.2, ... }
// ]
```

---

### `getPlotPresetNames()`

获取预设名称列表（简化版，仅返回名称数组）。

**返回值**: `Array<string>` - 预设名称数组

**示例**:
```javascript
const names = window.AutoCardUpdaterAPI.getPlotPresetNames();
// 返回: ["默认预设", "战斗场景", "日常对话"]
```

---

### `getCurrentPlotPreset()`

获取当前正在使用的预设名称。

**返回值**: `string` - 当前预设名称，如果没有选择任何预设则返回空字符串

**示例**:
```javascript
const current = window.AutoCardUpdaterAPI.getCurrentPlotPreset();
// 返回: "默认预设" 或 ""
```

---

### `switchPlotPreset(presetName)`

切换到指定的剧情预设。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| presetName | string | 是 | 要切换到的预设名称 |

**返回值**: `boolean` - 切换是否成功

**说明**:
- 如果预设名称无效或未找到，返回 `false`
- 切换成功后会自动保存设置
- 如果设置面板已打开，UI 会自动同步更新
- **数据隔离特性**：切换预设后，剧情推进功能（`$6` 占位符）将只回溯读取带有该预设名称标签的历史数据，实现不同预设间的剧情规划隔离。

**示例**:
```javascript
const success = window.AutoCardUpdaterAPI.switchPlotPreset("战斗场景");
if (success) {
    console.log("预设切换成功");
} else {
    console.log("预设切换失败：预设不存在");
}
```

---

### `injectPlotPresetToCurrentChat(presetName)`

仅将指定剧情预设注入当前聊天，不修改全局当前剧情预设。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| presetName | string | 是 | 要注入到当前聊天的预设名称；传空字符串表示当前聊天跟随全局剧情预设 |

**返回值**: `boolean` - 注入是否成功

**说明**:
- 成功后会保存当前聊天的剧情预设绑定状态。
- 不会修改全局 `lastUsedPresetName`，适合外部插件只影响当前聊天的场景。
- 如果传入不存在的预设名称，返回 `false`。

**示例**:
```javascript
const success = window.AutoCardUpdaterAPI.injectPlotPresetToCurrentChat("战斗场景");
```

---

### `getPlotPresetDetails(presetName)`

获取指定预设的详细信息。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| presetName | string | 是 | 预设名称 |

**返回值**: `Object | null` - 预设对象的深拷贝，如果未找到则返回 `null`

**预设对象结构**:
```javascript
{
    name: "预设名称",
    promptGroup: [
        { role: "system", content: "...", enabled: true, mainSlot: "A" },
        { role: "user", content: "...", enabled: true }
        // ...
    ],
    finalSystemDirective: "最终系统指令",
    rateMain: 1.0,        // 主线剧情权重
    ratePersonal: 1.0,    // 个人剧情权重
    rateErotic: 0,        // 情色内容权重
    rateCuckold: 1.0,     // NTR内容权重
    extractTags: "",      // 提取标签
    minLength: 0,         // 最小长度
    contextTurnCount: 3,  // 上下文轮次数
    loopSettings: {
        quickReplyContent: "",
        loopTags: "",
        loopDelay: 5,
        loopTotalDuration: 0,
        maxRetries: 3
    }
}
```

**示例**:
```javascript
const details = window.AutoCardUpdaterAPI.getPlotPresetDetails("战斗场景");
if (details) {
    console.log("预设权重:", details.rateMain);
    console.log("提示词数量:", details.promptGroup.length);
}
```

---

## 数据导入导出 API

### `exportTableAsJson()`

导出当前表格数据（同步函数）。

**返回值**: `Object` - 当前合并后的表格数据对象

**示例**:
```javascript
const tableData = window.AutoCardUpdaterAPI.exportTableAsJson();
console.log("表格数据:", JSON.stringify(tableData, null, 2));
```

---

### `importTableAsJson(jsonString, options?)`

导入并覆盖当前表格数据。默认作为外部 JSON 导入，会写入当前聊天持久化；如果用于删除楼层后的备份恢复，应传入运行时恢复模式，避免制造新的持久化事件。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| jsonString | string | 是 | JSON 格式的表格数据字符串 |
| options | object | 否 | 导入选项；`{ persist: false }` 或 `{ mode: 'restore' }` 表示只恢复运行时，不写入聊天持久化 |

**返回值**: `Promise<boolean>` - 导入是否成功

**示例**:
```javascript
const jsonData = '{"mate": {...}, "sheet_0": {...}}';
// 外部 JSON 导入：写入聊天持久化
const success = await window.AutoCardUpdaterAPI.importTableAsJson(jsonData);

// 删除楼层/备份恢复：只恢复运行时，不新增 data_replace/checkpoint/log
const restored = await window.AutoCardUpdaterAPI.importTableAsJson(jsonData, { persist: false });
```

---

### `restoreTableAsJson(jsonString)`

删除楼层/备份恢复专用：只把 JSON 表格数据恢复到当前运行时，不写入聊天持久化，不推进自动更新楼层标记。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| jsonString | string | 是 | JSON 格式的表格数据字符串 |

**返回值**: `Promise<boolean>` - 恢复是否成功

**示例**:
```javascript
const restored = await window.AutoCardUpdaterAPI.restoreTableAsJson(jsonData);
```

---

### `exportJsonData()`

导出当前 JSON 数据到文件（会弹出保存对话框）。

**返回值**: `Promise<boolean>`

---

### `updateCell(tableName, rowIndex, colIdentifier, value)`

更新指定表格中单个单元格的值。

**参数**:
| 参数名| 类型 | 必填 | 说明 |
|--------|------|------|------|
| tableName | string | 是 | 表格名称 |
| rowIndex | number \| string | 是 | 行索引（0为表头，1为第一行数据；数字字符串会被规范化） |
| colIdentifier | string \| number | 是 | 列标识（列名或列索引） |
| value | any | 是 | 新的单元格值 |

**返回值**: `Promise<boolean>` - 成功返回true，失败返回false

**说明**:
- 使用列名时，会自动查找对应的列索引
- 更新后会自动保存到聊天历史
- 支持对象参数形式：`updateCell({ tableName, rowIndex, colIdentifier, value, skipNotify })`
- `skipNotify: true` 或 `silent: true` 会跳过外部表格更新回调通知，适合批量写入时避免前端回调风暴；不会跳过数据写入
- 如果表格不存在或参数无效，返回false

**示例**:
```javascript
// 使用列名更新
const success = await window.AutoCardUpdaterAPI.updateCell('主角信息', 1, '自由点数', 5);

// 使用列索引更新（假设第3列是自由点数）
const success2 = await window.AutoCardUpdaterAPI.updateCell('主角信息', 1, 3, 5);

// 批量写入时可使用静默模式，避免每次写入都触发表格更新回调
await window.AutoCardUpdaterAPI.updateCell({
    tableName: '主角信息',
    rowIndex: 1,
    colIdentifier: '自由点数',
    value: 6,
    skipNotify: true
});
```

---

### `updateRow(tableName, rowIndex, data)`

更新指定表格中整行的数据（按列名-值映射）。

**参数**:
| 参数名| 类型 | 必填 | 说明 |
| -------- | ------ | ------ | ------ |
| tableName | string | 是 | 表格名称 |
| rowIndex | number \| string | 是 | 行索引（1为第一行数据；数字字符串会被规范化） |
| data | object | 是 | 列名-值映射对象 |

**返回值**: `Promise<boolean>` - 成功返回true，失败返回false

**说明**:
- data对象中的键值对应于表格的列名和单元格值
- 只更新data中指定的列，其他列保持不变
- 支持对象参数形式：`updateRow({ tableName, rowIndex, data, skipNotify })`
- `skipNotify: true` 或 `silent: true` 会跳过外部表格更新回调通知，适合批量写入时避免前端回调风暴；不会跳过数据写入
- `data.isImportMode: true` 或对象参数 `isImportMode: true` 会跳过聊天保存和纪要向量同步，保留旧版导入模式兼容。这类只写运行时的改动会被登记为「未落盘变更」，在下一次不带该选项的写入、任何一次填表开始前、以及首楼初始基线建立前自动写回聊天楼层；重开聊天前若没有发生这些动作，改动仍会丢失
- **表的最新楼层保存**：更新后会自动查找该表数据最后一次出现的楼层，并保存到该楼层
- **世界书刷新**：保存后会自动触发世界书重新写入，确保前端能读取到最新数据
- 如果找不到该表的楼层（新表格），会保存到最新AI楼层

**示例**:
```javascript
const success = await window.AutoCardUpdaterAPI.updateRow('主角信息', 1, {
    '力量': 15,
    '敏捷': 12,
    '体质': 14,
    '智力': 8,
    '感知': 16,
    '魅力': 10,
    '自由点数': 2
});

// 批量写入时使用对象参数静默回调通知
await window.AutoCardUpdaterAPI.updateRow({
    tableName: '主角信息',
    rowIndex: 1,
    data: { '自由点数': 1 },
    skipNotify: true
});
```

---

### `insertRow(tableName, data)`

在指定表格的表尾插入新行。

**参数**:
| 参数名| 类型 | 必填 | 说明 |
|--------|------|------|------|
| tableName | string | 是 | 表格名称 |
| data | object | 是 | 列名-值映射对象 |

**返回值**: `Promise<number>` - 成功返回新行索引，失败返回-1

**说明**:
- 新行会插入到表头之后（索引为行数）
- 插入后会自动保存到聊天历史
- 支持对象参数形式：`insertRow({ tableName, data, skipNotify })`
- `skipNotify: true` 或 `silent: true` 会跳过外部表格更新回调通知，适合批量写入时避免前端回调风暴；不会跳过数据写入

**示例**:
```javascript
const rowIndex = await window.AutoCardUpdaterAPI.insertRow('背包物品', {
    '物品名称': '治疗药水',
    '数量': 3,
    '类别': '消耗品',
    '描述/效果': '恢复50点生命值'
});

if (rowIndex !== -1) {
    console.log("新行索引:", rowIndex);
}

// 批量插入时使用静默模式
await window.AutoCardUpdaterAPI.insertRow({
    tableName: '背包物品',
    data: { '物品名称': '绷带', '数量': 2 },
    skipNotify: true
});
```

---

### `deleteRow(tableName, rowIndex)`

删除指定表格中的某行。

**参数**:
| 参数名| 类型 | 必填 | 说明 |
|--------|------|------|------|
| tableName | string | 是 | 表格名称 |
| rowIndex | number \| string | 是 | 要删除的行索引（1为第一行数据；数字字符串会被规范化） |

**返回值**: `Promise<boolean>` - 成功返回true，失败返回false

**说明**:
- 不能删除表头（rowIndex=0）
- 删除后会自动保存到聊天历史
- 支持对象参数形式：`deleteRow({ tableName, rowIndex, skipNotify })`
- `skipNotify: true` 或 `silent: true` 会跳过外部表格更新回调通知，适合批量写入时避免前端回调风暴；不会跳过数据写入

**示例**:
```javascript
const success = await window.AutoCardUpdaterAPI.deleteRow('背包物品', 3);

// 批量删除时使用静默模式
await window.AutoCardUpdaterAPI.deleteRow({
    tableName: '背包物品',
    rowIndex: 3,
    skipNotify: true
});
```

---

### `importCombinedSettings()`

导入组合设置（会弹出文件选择对话框）。

**返回值**: `Promise<boolean>`

---

### `exportCombinedSettings()`

导出组合设置到文件（会弹出保存对话框）。

**返回值**: `Promise<boolean>`

---

### `scanSeedPollution()`

seed 双池污染只读诊断（阶段 F）。扫描 global preset、当前聊天 template scope、
chat guide seedRows、runtime/V2 当前数据四个来源，报告同表同 UNIQUE 值重复、
content 与 seedRows 双池重复、模板数据与 runtime 数据不一致。

**性质**: 纯只读。不写存储、不修改聊天数据、不触发迁移。

**返回值**: `Promise<SeedPollutionScanResult_ACU>`（同步函数经 async 包装）

```typescript
interface SeedPollutionScanResult_ACU {
    diagnostics: SeedPollutionDiagnostic_ACU[];
    scanned: {
        globalPresets: number; // 已扫描的 global preset 模板数
        chatScope: number;     // 已扫描的 chat_override scope 数（0 或 1）
        guideSheets: number;   // 已扫描的 guide sheet 数
        runtimeSheets: number; // 已扫描的 runtime 当前数据 sheet 数
    };
}

interface SeedPollutionDiagnostic_ACU {
    severity: 'error' | 'warning' | 'info';
    code:
        | 'content_seed_duplicate'   // content 数据行与 seedRows 双池存在相同 UNIQUE 业务键
        | 'content_runtime_mismatch' // 模板/guide 数据与 runtime 当前数据行不一致
        | 'guide_seed_pending'       // guide 声明 seedRows 但 runtime 未物化（待定/延迟状态）
        | 'guide_seed_duplicate'     // guide seedRows 与 runtime 数据存在相同 UNIQUE 业务键
        | 'seed_row_id_conflict'     // seedRows 池内 row_id 重复或与既有数据冲突
        | 'info_no_issue';           // 该 sheet 未发现问题
    source: 'global_preset' | 'chat_scope' | 'guide' | 'runtime' | 'template';
    sheetKey: string;
    sheetName: string;
    businessKeyColumns: string[]; // 由 DDL 解析出的 UNIQUE 业务键列
    conflictingKeys: string[];    // 冲突的具体业务键值
    message: string;
}
```

**扫描范围**:
- chat_scope：当前聊天 `chat_override` 模板快照中的 content/seedRows
- global_preset：global 预设模板库（可枚举时全量，退化时仅已知常用名）
- guide：当前隔离键下 chat guide 的 seedRows 字段
- runtime：`currentJsonTableData_ACU` 当前数据视图的 content/seedRows 双池

---
### `prepareSeedMigration()`

seed 双池污染显式迁移（阶段 F2-F4）——准备阶段。读取当前聊天 guide，
计算每张表的 seedRows 清理动作（与 runtime/模板 content 同业务键的 seed 视为重复），
并导出备份快照。**只读**，不写任何存储。

**性质**: 手动触发；不自动运行；global preset 只诊断不迁移。

**参数**: `{ isolationKey?: string }`（缺省用当前隔离键）

**返回值**: `Promise<{ status: 'plan_ready' | 'no_issue'; ... }>`

```typescript
type PrepareSeedMigrationResult_ACU =
  | { status: 'plan_ready'; plan: SeedMigrationPlan_ACU }
  | { status: 'no_issue'; isolationKey: string; message: string };
```

**语义（已确认）**:
- 冲突默认 template-wins：模板 content 优先，重复的 seedRows 清理掉；
- 已物化的 guide seed（与 runtime 同业务键）只清理残留 seed，保留 runtime 数据；
- 每次迁移生成备份（guide container / scoped config / 聊天快照），commit 后可回滚；
- 版本开关：`settings_ACU.seedMigrationEnabled` 默认开启；显式置 `false` 时进入纯诊断观察模式，prepare/commit/rollback 全部拒绝执行（fail-closed）。

---

### `commitSeedMigration(planId, options)`

seed 双池污染显式迁移——提交阶段。校验计划有效与作用域未变后，
在事务内写入修正后的 guide、宿主保存，并在 SQLite 模式下 reload 后置校验。

**参数**: `planId: string`，`options: { confirm?: boolean }`（计划含清理动作时必须 `confirm: true`）

**返回值**: `Promise<SeedMigrationCommitResult_ACU>`

```typescript
interface SeedMigrationCommitResult_ACU {
    status: 'committed' | 'commit_failed_rolled_back' | 'committed_postcondition_failed';
    planId: string;
    error?: string;
    appliedActions?: SeedMigrationAction_ACU[];
}
```

**失败语义**: 宿主保存失败即回滚内存聊天并返回 `commit_failed_rolled_back`；
提交后 reload 失败返回 `committed_postcondition_failed`（数据已提交，需人工核查）。

---

### `rollbackSeedMigration(planId)`

seed 双池污染显式迁移——回滚阶段。从计划备份恢复 guide container、scoped config
与聊天快照，重新 hydrate 并验证。仅对尚未失效的计划可用。

**参数**: `planId: string`

**返回值**: `Promise<SeedMigrationCommitResult_ACU>`（`error: 'rollback_applied'` 表示回滚已执行）

---


## 设置与更新 API

### `openSettings()`

打开神·数据库设置面板。

**返回值**: `Promise<boolean>`

**示例**:
```javascript
await window.AutoCardUpdaterAPI.openSettings();
```

---

### `openVisualizer()`

打开可视化编辑器。

**返回值**: `void`

**示例**:
```javascript
window.AutoCardUpdaterAPI.openVisualizer();
```

---

## 新 UI v2 API

所有新 UI v2 方法通过全局对象 `window.AutoCardUpdaterV2API` 访问。

### `open()`

打开 SP·数据库 VII 新 UI 主界面。

**返回值**: `Promise<boolean>`

**示例**:
```javascript
await window.AutoCardUpdaterV2API.open();
```

---

### `openVisualizer()`

打开新 UI v2 内的数据库可视化表格编辑器。

**返回值**: `Promise<boolean>`

**示例**:
```javascript
await window.AutoCardUpdaterV2API.openVisualizer();
```

---

### `manualUpdate()`

立即执行手动更新（等价于点击"立即手动更新"按钮）。

**返回值**: `Promise<boolean>`

---

### `triggerUpdate()`

外部触发增量更新。

**返回值**: `Promise<boolean>`

---

### `setZeroTkOccupyMode(modeEnabled)`

设置 0TK 占用模式。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| modeEnabled | boolean | 是 | `true`=世界书条目禁用；`false`=世界书条目启用 |

**返回值**: `Promise<boolean>`

---

### `setOutlineEntryEnabled(enabled)`

设置"总结大纲/总体大纲"条目在世界书中的启用状态。

> **注意**: 推荐使用 `setZeroTkOccupyMode(mode)` 代替。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| enabled | boolean | 是 | 是否启用 |

**返回值**: `Promise<boolean>`

---

## 世界书操作 API

### `syncWorldbookEntries(options)`

立即同步世界书注入条目。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| options.createIfNeeded | boolean | 否 | 如果条目不存在是否创建，默认 `true` |

**返回值**: `Promise<boolean>`

**示例**:
```javascript
await window.AutoCardUpdaterAPI.syncWorldbookEntries({ createIfNeeded: true });
```

---

### `refreshDataAndWorldbook()`

强制刷新数据并重新注入世界书。用于前端完成数据写入后，强制触发一次完整的数据合并和世界书更新。

**返回值**: `Promise<boolean>` - 刷新是否成功

**说明**:
- 重新加载聊天记录中的所有表格数据
- 合并所有独立表的数据
- 更新世界书条目
- 通知前端刷新 UI

**使用场景**:
- 前端通过 `updateRow`、`insertRow`、`deleteRow` 等 API 修改表格数据后
- 需要确保世界书中的数据与表格数据同步时

**示例**:
```javascript
// 修改表格数据后刷新世界书
await window.AutoCardUpdaterAPI.updateRow('主角信息', 1, { '力量': 15 });
await window.AutoCardUpdaterAPI.refreshDataAndWorldbook();
```

---

### `deleteInjectedEntries()`

删除当前注入目标世界书里的"本插件生成条目"。

**返回值**: `Promise<boolean>`

---

## TXT导入链路 API

### `importTxtAndSplit()`

导入 TXT 文件并分割。

**返回值**: `Promise<boolean>`

---

### `importTxtTextAndSplit(text, options)`

Headless TXT 文本拆分入口。该方法不打开文件选择器，不依赖导入界面，适合外部脚本或自动化流程直接传入文本并写入导入暂存区。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| text | string | 是 | 需要拆分的 TXT 原文。空文本会返回 `success:false`。 |
| options.splitSize | number \| string | 否 | 每段目标长度；字符串会按数字解析。 |
| options.clearPrevious | boolean | 否 | 是否先清空已有导入暂存，默认沿用 core 行为。 |

**返回值**: `Promise<Object>` - 结构化结果。成功时包含 `success:true` 与拆分/暂存统计；失败时返回 `{ success:false, error:string }`。

**示例**:
```javascript
const result = await window.AutoCardUpdaterAPI.importTxtTextAndSplit(longText, {
    splitSize: 1200,
    clearPrevious: true,
});
if (!result.success) throw new Error(result.error);
```

---

### `injectImportedSelected(options)`

Headless 注入选中的导入内容。该方法复用导入注入 core，不打开 UI，不触发 DOM/toast 流程。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| options.targetWorldbook | string | 否 | 目标世界书名称；缺省时使用当前配置的目标世界书。 |
| options.selectedSheetKeys | Array<string> | 否 | 需要注入的表/分组 key；缺省时使用暂存区当前选择。 |
| options.maxRetries | number \| string | 否 | 单项注入最大重试次数；字符串会按数字解析。 |
| options.requestOptions | Object | 否 | 透传给底层 AI/请求流程的选项。 |

**返回值**: `Promise<Object>` - 结构化注入结果。失败时返回 `{ success:false, error:string }`。

**示例**:
```javascript
const inject = await window.AutoCardUpdaterAPI.injectImportedSelected({
    targetWorldbook: '主世界书',
    selectedSheetKeys: ['人物', '地点'],
    maxRetries: 2,
});
if (!inject.success) throw new Error(inject.error);
```

---

## 外部导入 Headless API

`importTxtTextAndSplit(text, options)` 与 `injectImportedSelected(options)` 是 TXT 导入链路的 headless 入口。它们面向脚本调用，不打开文件选择器，不依赖导入面板状态，不直接操作 DOM。

典型流程：

```javascript
const split = await window.AutoCardUpdaterAPI.importTxtTextAndSplit(text, { clearPrevious: true });
if (!split.success) throw new Error(split.error);

const injected = await window.AutoCardUpdaterAPI.injectImportedSelected({ targetWorldbook: '主世界书' });
if (!injected.success) throw new Error(injected.error);
```

---

### `injectImportedStandard()`

标准方式注入分割的条目。

**返回值**: `Promise<boolean>`

---

### `injectImportedSummary()`

以总结方式注入分割的条目。

**返回值**: `Promise<boolean>`

---

### `injectImportedFull()`

完整注入分割的条目。

**返回值**: `Promise<boolean>`

---

### `deleteImportedEntries()`

删除导入的条目。

**返回值**: `Promise<boolean>`

---

### `clearImportedEntries(clearAll)`

清除导入的条目缓存。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| clearAll | boolean | 否 | 是否清除全部，默认 `true` |

**返回值**: `Promise<boolean>`

---

### 导入清理 API 语义对照

| API | 主要作用 | 是否删除世界书条目 | 是否清理本地导入缓存 | 推荐场景 |
|-----|----------|--------------------|----------------------|----------|
| `deleteImportedEntries()` | 兼容旧调用入口，按既有流程删除导入条目 | 是 | 否 | 旧脚本兼容，保留原行为 |
| `clearImportedEntries(clearAll)` | 清除导入条目缓存，保留旧 API 语义 | 可能涉及旧流程条目 | 是 | 旧 UI 或旧脚本清理导入状态 |
| `clearImportedLorebookEntries(options)` | 删除指定世界书中外部导入最终注入生成的条目 | 是，仅删除外部导入注入条目 | 否 | 明确撤回已注入到世界书的外部导入内容 |
| `clearImportCache(clearAll)` | 清除本地导入缓存和状态 | 否 | 是 | 只重置导入暂存状态，不碰世界书 |

---

### `clearImportedLorebookEntries(options)`

删除外部导入注入到指定世界书中的条目。该 API 只删除 comment 命中外部导入标记的世界书条目，不清理导入暂存缓存；开启数据隔离时，只删除当前隔离标识下的外部导入条目，不会删除其他隔离标识的条目；需要清理缓存时继续使用 `clearImportedEntries(clearAll)` 或 `clearImportCache(clearAll)`。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| options | object | 是 | 删除选项 |
| options.targetWorldbook | string | 是 | 目标世界书名称，会自动去除首尾空白 |

**返回值**: `Promise<Object>` - 成功时返回 `{ success:true, deletedCount:number, targetWorldbook:string }`；失败时返回 `{ success:false, error:string }`。

---

### `clearImportCache(clearAll)`

清除导入缓存（localStorage）。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| clearAll | boolean | 否 | 是否清除全部，默认 `true` |

**返回值**: `Promise<boolean>`

---

## Agent 世界书 API

Agent 世界书 API 通过世界书状态条目作为单事实源，提供控制模式、Skill 化、Skill 元数据维护与批量清理能力。

### `getAgentWorldbookControl()`

读取 Agent 世界书控制状态。

**返回值**: `Promise<Object>` - 成功时返回 `{ success:true, control, source, bookName, entryUid, duplicateCount, writableBookName }`；失败时返回 `{ success:false, error:string }`。

---

### `setAgentWorldbookMode(mode, options)`

设置 Agent 世界书模式，并按选项执行接管或恢复。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| mode | `'disabled' \| 'passive' \| 'agent'` | 是 | `disabled` 关闭并默认恢复；`passive` 只写控制状态；`agent` 启用并默认接管世界书绿灯。 |
| options.runTakeover | boolean | 否 | `mode='agent'` 时是否执行接管，默认执行。 |
| options.restoreOnDisable | boolean | 否 | `mode='disabled'` 时是否恢复受控条目，默认恢复。 |

**返回值**: `Promise<Object>` - 包含 `success`、`mode`、`control`、`write`，以及可选 `takeover` 或 `restore`。

---

### `runAgentWorldbookSkillify(options)`

对当前剧情世界书选择范围执行 Skill 化。若本次有更新且 `runTakeover !== false`，会同步执行世界书接管并刷新快照。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| options.runTakeover | boolean | 否 | Skill 化后是否同步接管，默认执行。 |
| options.presetName | string | 否 | 使用的 API 预设名称。 |
| options.maxConcurrency | number | 否 | 并发处理数量。 |
| options.maxEntries | number | 否 | 本批最多处理的候选条目数。 |
| options.cursor | `{ bookName:string; uid:number\|string }` | 否 | 从上一次返回的 `skillify.nextCursor` 继续处理；游标条目必须仍在当前待处理范围内。 |
| options.overwriteManual | boolean | 否 | 是否覆盖人工维护的 Skill 元数据。 |

**返回值**: `Promise<Object>` - 成功时至少包含 `{ success:true, skillify }`。`skillify` 包含本批实际处理数 `totalCandidates`、待处理匹配总数 `totalMatched`、本批选择数 `selectedForRun`、剩余数 `remaining`、是否截断 `truncated` 和可用于下一批的 `nextCursor`；同步接管时还可能包含 `takeover` 与 `snapshot`。

---

### `skillifyWorldbookEntries(options)`

计划名 API。可对指定世界书执行 Skill 化；未传 `options.bookNames` 时，回退为当前剧情世界书选择范围，与 `runAgentWorldbookSkillify(options)` 行为一致。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| options.bookNames | Array<string> \| string | 否 | 指定要处理的世界书名称。字符串支持逗号、中文逗号或换行分隔。未传或解析为空时使用当前剧情世界书选择。 |
| options.selectedEntries | Array<{ bookName:string; uid:number\|string }> | 否 | 精确限定要处理的世界书条目。 |
| options.runTakeover | boolean | 否 | Skill 化后是否同步接管，默认执行。 |
| options.presetName | string | 否 | 使用的 API 预设名称。 |
| options.maxConcurrency | number | 否 | 并发处理数量。 |
| options.maxAiRetries | number | 否 | 单条目 AI 最大重试次数。 |
| options.maxEntries | number | 否 | 本次最多处理候选条目数。 |
| options.cursor | `{ bookName:string; uid:number\|string }` | 否 | 从上一次 `skillify.nextCursor` 继续处理当前稳定候选序列。 |
| options.overwriteManual | boolean | 否 | 是否覆盖人工维护的 Skill 元数据。 |

**返回值**: `Promise<Object>` - 成功时至少包含 `{ success:true, skillify }`。`skillify` 返回 `totalCandidates`、`totalMatched`、`selectedForRun`、`remaining`、`truncated`、`nextCursor`、`updated`、`skipped`、`failed` 与逐条 `results`；同步接管时还可能包含 `takeover` 与 `snapshot`。

**示例**:
```javascript
const result = await window.AutoCardUpdaterAPI.skillifyWorldbookEntries({
    bookNames: ['主世界书'],
    selectedEntries: [{ bookName: '主世界书', uid: 12 }],
    runTakeover: true,
});
if (!result.success) throw new Error(result.error);
```

---

### `saveAgentWorldbookSkillMeta(bookName, uid, metaDraft, updatedBy)`

保存指定世界书条目的 Skill 元数据。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| bookName | string | 是 | 世界书名称。 |
| uid | number \| string | 是 | 世界书条目 UID。 |
| metaDraft | Object | 是 | 要写入的 Skill 元数据草稿。 |
| updatedBy | `'manual' \| 'agent-skillify'` | 否 | 更新来源，默认 `manual`。 |

**返回值**: `Promise<Object>` - 成功时返回 `{ success:true, result }`；失败时返回 `{ success:false, error:string }`。

**兼容别名**: `saveWorldbookEntrySkillMeta(bookName, uid, metaDraft, options)` 与本方法等价；`options` 可为 updatedBy 字符串或 `{ updatedBy }`。

---

### `deleteAgentWorldbookSkillMeta(bookName, uid)`

删除指定世界书条目的 Skill 元数据块。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| bookName | string | 是 | 世界书名称。 |
| uid | number \| string | 是 | 世界书条目 UID。 |

**返回值**: `Promise<Object>` - 成功时返回 `{ success:true, result }`。

**兼容别名**: `deleteWorldbookEntrySkillMeta(bookName, uid)` 与本方法等价。

---

### `clearAgentWorldbookSkillMetas(bookNames)`

批量清理指定世界书中的 Agent Skill 元数据块。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| bookNames | Array<string> | 否 | 需要清理的世界书名称列表；缺省为空数组。 |

**返回值**: `Promise<Object>` - 返回 `{ success, error?, result }`，其中 `result` 包含 `total`、`cleared`、`skipped`、`failed` 与 `errors`。

---

## 模板管理 API

### `importTemplate(options)`

导入模板（会弹出文件选择对话框）。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| options | Object | 否 | 可选配置 |
| options.scope | `'global' \| 'chat'` | 否 | 导入作用域，默认 `global`。传入 `chat` 时会将模板仅注入到当前聊天 |

**返回值**: `Promise<boolean>`

---

### `exportTemplate(options)`

导出模板到文件。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| options | Object | 否 | 可选配置 |
| options.scope | `'global' \| 'chat'` | 否 | 导出作用域，默认 `global`。传入 `chat` 时导出当前聊天模板快照 |

**返回值**: `Promise<boolean>`

---

### `resetTemplate(options)`

重置模板为默认值。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| options | Object | 否 | 可选配置 |
| options.scope | `'global' \| 'chat'` | 否 | 重置作用域，默认 `global`。传入 `chat` 时仅重置当前聊天模板为默认模板 |

**返回值**: `Promise<boolean>`

---

### `resetAllDefaults()`

重置所有设置为默认值。

**返回值**: `Promise<boolean>`

---

### `overrideWithTemplate()`

用模板覆盖最新层数据。

**返回值**: `Promise<boolean>`

---

### `getTableTemplate()`

获取当前运行态实际使用的表格模板。

- 如果当前聊天存在聊天级模板覆写，则返回当前聊天模板
- 否则返回当前 profile 的全局模板

**返回值**: `Object | null` - 模板对象的深拷贝，如果未设置则返回 `null`

**示例**:
```javascript
const template = window.AutoCardUpdaterAPI.getTableTemplate();
if (template) {
    console.log("当前模板表格数量:", Object.keys(template).filter(k => k.startsWith('sheet_')).length);
}
```

---

### `getTemplatePresetNames()`

获取全局模板预设名称列表。

**返回值**: `Array<string>` - 全局模板预设名称数组

---

### `switchTemplatePreset(presetName, options)`

切换模板预设，可作用于全局或仅当前聊天。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| presetName | string | 是 | 要切换到的模板预设名称。传空字符串时表示切换到默认模板 |
| options | Object | 否 | 可选配置 |
| options.scope | `'global' \| 'chat'` | 否 | 切换作用域，默认 `global`。传入 `chat` 时仅影响当前聊天 |

**返回值**: `Promise<{success: boolean, scope: string, message: string}>`

**示例**:
```javascript
const api = window.AutoCardUpdaterAPI;

await api.switchTemplatePreset('标准模板', { scope: 'global' });
await api.switchTemplatePreset('任务模板', { scope: 'chat' });
```

---

### `injectTemplatePresetToCurrentChat(presetName)`

仅将模板预设注入到当前聊天，不修改全局当前模板预设。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| presetName | string | 是 | 要注入到当前聊天的模板预设名称。传空字符串时表示当前聊天恢复到默认模板快照 |

**返回值**: `Promise<{success: boolean, scope: string, message: string}>`

---

### `importTemplateFromData(templateData, options)`

通过前端直接导入表格模板（无需文件选择器）。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| templateData | Object \| string | 是 | 模板数据，可以是 JSON 对象或 JSON 字符串 |
| options | Object | 否 | 可选配置 |
| options.scope | `'global' \| 'chat'` | 否 | 导入作用域，默认 `global`。传入 `chat` 时仅写入当前聊天模板快照 |
| options.presetName | string | 否 | 模板名。优先级最高；`scope='global'` 时会尝试保存到全局模板预设库；`scope='chat'` 时作为当前聊天模板快照的标记名 |
| options.dataMode | `'replace' \| 'merge' \| 'seed'` | 否 | 模板携带数据的导入语义。默认按上下文推导：模板无数据 → `seed`；模板带数据且目标 runtime 为空（首次填表）→ `replace`；模板带数据且已有 runtime 数据 → `seed`（不静默覆盖） |
| options.conflictPolicy | `'keep-current' \| 'template-wins' \| 'reject'` | 否 | merge 冲突策略。默认 `keep-current`（保留当前运行时数据，不覆盖） |

**返回值**: `Promise<{success: boolean, message: string, scope?: string, presetName?: string, dataMode?: string, conflictPolicy?: string, runtimeReady?: boolean}>` - 导入结果

**dataMode 语义**:
- `replace`：模板数据作为目标表初始快照整体写入（仅当目标 runtime 为空或调用方显式声明时安全）。
- `merge`：按 DDL UNIQUE/主键业务键与既有行匹配；无唯一业务键的表会 fail-closed 阻止合并（改用 `replace`/`seed` 或为 DDL 添加 UNIQUE 约束）。
- `seed`：模板数据只进入 seedRows 作为初始化种子，不直接覆盖既有数据；与系统物化 seedRows 共用同一身份空间，避免重复 INSERT。

**返回值字段说明**:
- `dataMode`：实际生效的导入语义（调用方未显式指定时由兼容层推导并回填）。
- `conflictPolicy`：实际生效的冲突策略（默认 `keep-current`）。
- `runtimeReady`：聊天导入后 runtime（SQLite/V2 checkpoint）是否已同步；`false` 表示模板已保存但 runtime 重建失败，需检查 `warning`。
- `deduplication`：跨 content/seedRows 完全重复去重审计（content 优先）。数组元素为 `{ sheetKey, sheetName, removedCount, rowIds }`，仅在有去重发生时非空；无去重时为空数组。
- `saved`：是否已持久化。

**命名补充说明**:
- 如果调用方没有显式传入 `options.presetName`：
  - 文件导入场景会优先使用文件名作为模板预设名；
  - 如果连文件名也没有，则会回退使用当前角色卡卡名作为模板预设名；
  - 仅当 `scope='global'` 且前两者都拿不到时，才会继续使用系统生成的兜底名称。
- 通过 [`initGameSession()`](index.js:7774) 并配合 `options.injectTemplate = true` 注入模板时，也会复用同一套命名回退逻辑；如果调用方未提供 `options.templatePresetName`，则会优先尝试角色卡名称。

**模板数据结构要求**:
- 必须包含 `mate` 对象且 `mate.type` 为 `"chatSheets"`
- 必须包含至少一个 `sheet_*` 键
- 每个 sheet 必须包含 `name`, `content`, `sourceData` 字段
- 模板可携带数据行（`content` 首行之后的行，或 `seedRows`），携带的数据按 `dataMode` 语义处理

**跨池完全重复自动去重（导入候选）**:
- 同一张表内，`content` 数据行与 `seedRows` 行的规范化 `row_id` 相同、且完整行逐列完全相同（`row_id` 按既有 trim 规则比较，其余列严格相等，不做业务字段 trim/大小写折叠/null-空串互换）时，自动删除 `seedRows` 中的重复副本（content 优先），使导入在预检阶段即可继续，不再被误判为跨池身份冲突。
- 同 `row_id` 但任一业务字段不同、或同池内重复 `row_id`、或行宽/结构非法，仍按 fail-closed 阻断（`cross_pool_row_id_collision` / 结构错误）。
- 去重只作用于导入候选的深拷贝，不修改调用方输入对象；操作幂等，失败不触碰任何持久化状态。
- `replace`：去重后的候选作为完整初始快照，不把已删除的重复 seedRows 再次物化；`merge`：去重只清理模板候选内部副本，模板与 runtime 的业务键冲突仍按 `conflictPolicy` 处理；`seed`：去重只清理模板内部重复种子，剩余 seedRows 仍作为待初始化数据，不提前写入 runtime。
- 导入结果可通过 `deduplication` 字段追踪：每表列出被删除的 `row_id` 列表与删除数量（无去重时不产生该字段）。

**示例**:
```javascript
const template = {
    mate: { type: "chatSheets", version: 1 },
    sheet_0: {
        name: "角色状态",
        content: [["属性", "值"], ["生命值", "100"]],
        sourceData: { headers: ["属性", "值"] }
    }
};

const globalResult = await window.AutoCardUpdaterAPI.importTemplateFromData(template, {
    scope: 'global',
    presetName: '标准模板',
    dataMode: 'seed' // 全局导入默认只保存预设，携带数据仅作 seed 语义
});

const chatResult = await window.AutoCardUpdaterAPI.importTemplateFromData(template, {
    scope: 'chat',
    presetName: '任务专用模板',
    dataMode: 'replace', // 首次填表：模板数据作为初始快照
});

console.log(globalResult.message);
console.log(chatResult.message);
```

**merge 示例**（按业务键合并，冲突默认保留当前数据）:
```javascript
const mergeResult = await window.AutoCardUpdaterAPI.importTemplateFromData(template, {
    scope: 'chat',
    dataMode: 'merge',
    conflictPolicy: 'keep-current' // 或 'template-wins' / 'reject'
});
console.log(mergeResult.dataMode, mergeResult.conflictPolicy, mergeResult.runtimeReady);
```

---

## 前端导入 API（无需文件选择器）

### `importPlotPresetFromData(presetData, options)`

通过前端直接导入剧情推进预设（无需文件选择器）。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| presetData | Object \| string | 是 | 预设数据，可以是 JSON 对象或 JSON 字符串 |
| options.overwrite | boolean | 否 | 如果预设已存在，是否覆盖（默认 `false`，会自动重命名） |
| options.switchTo | boolean | 否 | 导入后是否立即切换到该预设（默认 `false`） |

**返回值**: `Promise<{success: boolean, message: string, presetName?: string}>` - 导入结果

**预设数据结构要求**:
- 必须包含 `name` 字段（预设名称）
- 其他字段参考 `getPlotPresetDetails()` 返回的对象结构

**示例**:
```javascript
const preset = {
    name: "战斗场景预设",
    promptGroup: [
        { role: "system", content: "你是战斗场景的规划师...", enabled: true }
    ],
    rateMain: 1.2,
    ratePersonal: 0.8,
    rateErotic: 0,
    rateCuckold: 0
};

// 导入并切换到该预设
const result = await window.AutoCardUpdaterAPI.importPlotPresetFromData(preset, {
    overwrite: false,
    switchTo: true
});

if (result.success) {
    console.log(`预设 "${result.presetName}" 导入成功`);
} else {
    console.error("导入失败:", result.message);
}
```

---

### `importPlotPresetsFromData(presetsArray, options)`

批量导入多个剧情推进预设。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| presetsArray | Array<Object \| string> | 是 | 预设数据数组 |
| options.overwrite | boolean | 否 | 如果预设已存在，是否覆盖（默认 `false`） |

**返回值**: `Promise<{success: boolean, message: string, imported: number, failed: number, details: Array}>` - 批量导入结果

**示例**:
```javascript
const presets = [
    { name: "战斗预设", promptGroup: [...], rateMain: 1.2 },
    { name: "日常预设", promptGroup: [...], rateMain: 1.0 },
    { name: "浪漫预设", promptGroup: [...], rateMain: 0.8 }
];

const result = await window.AutoCardUpdaterAPI.importPlotPresetsFromData(presets, { overwrite: false });
console.log(`批量导入完成：成功 ${result.imported} 个，失败 ${result.failed} 个`);

// 查看每个预设的导入结果
result.details.forEach((detail, index) => {
    console.log(`预设 ${index + 1}:`, detail.success ? `成功 (${detail.presetName})` : `失败 (${detail.message})`);
});
```

---

### `exportAllPlotPresets()`

导出所有剧情推进预设。

**返回值**: `Array<Object>` - 所有预设的深拷贝数组

**示例**:
```javascript
const allPresets = window.AutoCardUpdaterAPI.exportAllPlotPresets();
console.log(`共有 ${allPresets.length} 个预设`);

// 可以将预设保存为 JSON 文件
const jsonString = JSON.stringify(allPresets, null, 2);
console.log(jsonString);
```

---

## 原生 SQL 标识符解析

`executeSqlQuery`、`querySql` 和 `queryTableRows` 只在 SQLite 模式且当前 runtime 完整进入 `ready` 后发布到 `AutoCardUpdaterAPI`。原生模式、启动初始化、聊天切换及数据库重载期间，这三个属性为 `undefined`；外部调用方必须在每次查询前检查函数是否存在，并在暂不可用时稍后重试。

这些方法以及 `executeSql` 的只读分支会在 SQLite 执行前，将已知表的用户可见标识符重绑定为运行时物理标识符；查询返回值契约不变，解析或执行失败仍返回 `null`。

### 表名

只读 SQL 可以使用同一张表的运行时物理表名、原始 `CREATE TABLE` 表名、sheet 显示名、sheetKey 或 uid。若一个别名对应多张表，系统会移除该别名而不是猜测目标。

### 列名与安全边界

显式 DDL 的原始列名就是物理列名。fallback DDL 下，显示列名确定映射到运行时列名；原始 DDL 列名只有能与表头唯一对应时才映射，存在歧义或多个原始列竞争同一运行时列时保持原文，绝不按列序猜测。列名在单表查询、或可由 `tableAlias.column` 唯一归属的 JOIN 中会被重绑定；多表裸列存在歧义时保持原文。字符串字面量、`--`/`/* */` 注释、CTE 名、派生表别名以及显式或隐式的 SELECT 输出别名不会作为物理对象改写。`PRAGMA` 参数原样透传。

### `queryTableRows(options)` 的别名契约

`options.tableName`、`options.table` 或 `options.sheetKey` 支持物理表名、原始 DDL 表名、显示名、sheetKey 与 uid；`columns`、`where` 和 `orderBy` 的列名支持显示名、物理列名及无歧义的 fallback 原始 DDL 列名。表或列别名存在冲突时，方法返回 `null`，不会按表/列出现顺序选取目标。该方法仍使用绑定参数传递条件值，`limit`/`offset` 与排序方向白名单的既有约束不变。

### 失败诊断

已发布的只读 API 在解析或执行失败时仍返回 `null`。可调用 `getLastSqlApiError()` 获取最近一次只读失败的 `{ method, code, message, at }`；`code` 区分别名冲突、表不存在、列未解析、只读违规和其他 SQL 错误。运行时尚未发布时不会调用查询函数，因此也不会新增一次 `runtime_not_ready` 错误。只有本次 SQL 实际引用的表或列别名冲突才会归类为 `alias_conflict`；无关 schema 冲突不会掩盖实际的缺表或缺列错误。同步读取仅使用 runtime 已发布的 schema 快照；provider 发布前会验证 schema，未就绪 runtime 不会被读取路径懒初始化。

写入 SQL 仍只接受既有写路径支持的表名形态；不要把只读查询的扩展表名兼容性误当成写入契约。

---


## 其他功能 API

### `mergeSummaryNow()`

立即执行合并总结操作。

**返回值**: `Promise<boolean>`

---

## 表格锁定 API

> 说明：表格锁定数据按“当前聊天 + 数据隔离标识”分槽存储，外部调用等价于 UI 锁定/解锁行为。

### `getTableLockState(sheetKey)`

获取指定表格的锁定状态。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| sheetKey | string | 是 | 表格 key（如 `sheet_xxx`） |

**返回值**: `Object | null`

**返回结构**:
```javascript
{ rows: number[], cols: number[], cells: string[] }
```

---

### `setTableLockState(sheetKey, lockState, options)`

设置指定表格的锁定状态。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| sheetKey | string | 是 | 表格 key |
| lockState | Object | 是 | `{ rows, cols, cells }` |
| options.merge | boolean | 否 | `true` 为追加到现有锁定（默认 `false` 覆盖） |

**说明**:
- `rows`/`cols` 为索引数组
- `cells` 支持 `"row:col"` 或 `[row, col]`

**返回值**: `boolean`

---

### `clearTableLocks(sheetKey)`

清空指定表格的所有锁定。

**返回值**: `boolean`

---

### `lockTableRow(sheetKey, rowIndex, locked)`

锁定/解锁指定行。

**返回值**: `boolean`

---

### `lockTableCol(sheetKey, colIndex, locked)`

锁定/解锁指定列。

**返回值**: `boolean`

---

### `lockTableCell(sheetKey, rowIndex, colIndex, locked)`

锁定/解锁指定单元格。

**返回值**: `boolean`

---

### `toggleTableRowLock(sheetKey, rowIndex)`

切换指定行锁定状态。

**返回值**: `boolean`

---

### `toggleTableColLock(sheetKey, colIndex)`

切换指定列锁定状态。

**返回值**: `boolean`

---

### `toggleTableCellLock(sheetKey, rowIndex, colIndex)`

切换指定单元格锁定状态。

**返回值**: `boolean`

---

### `getSpecialIndexLockEnabled(sheetKey)`

获取“编码索引列特殊锁定”状态。

**返回值**: `boolean | null`

---

### `setSpecialIndexLockEnabled(sheetKey, enabled)`

设置“编码索引列特殊锁定”状态。

**返回值**: `boolean`

---

## 回调注册 API

### `registerTableUpdateCallback(callback)`

注册表格更新回调函数。当表格数据更新时，回调函数会被调用。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| callback | function | 是 | 回调函数，接收更新后的表格数据作为参数 |

**示例**:
```javascript
function onTableUpdate(tableData) {
    console.log("表格已更新:", tableData);
}
window.AutoCardUpdaterAPI.registerTableUpdateCallback(onTableUpdate);
```

---

### `unregisterTableUpdateCallback(callback)`

注销表格更新回调函数。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| callback | function | 是 | 之前注册的回调函数 |

**示例**:
```javascript
window.AutoCardUpdaterAPI.unregisterTableUpdateCallback(onTableUpdate);
```

---

### `registerTableFillStartCallback(callback)`

注册"填表开始"回调函数。当开始填表操作时，回调函数会被调用。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| callback | function | 是 | 回调函数（无参数） |

**示例**:
```javascript
function onFillStart() {
    console.log("开始填表...");
}
window.AutoCardUpdaterAPI.registerTableFillStartCallback(onFillStart);
```

---

## 完整调用示例

### 示例 1: 列出并切换预设

```javascript
// 获取 API
const api = window.AutoCardUpdaterAPI;

// 列出所有预设名称
const presetNames = api.getPlotPresetNames();
console.log("可用预设:", presetNames);

// 获取当前预设
const currentPreset = api.getCurrentPlotPreset();
console.log("当前预设:", currentPreset);

// 切换到新预设
if (presetNames.includes("战斗场景")) {
    const success = api.switchPlotPreset("战斗场景");
    console.log("切换结果:", success ? "成功" : "失败");
}
```

### 示例 2: 监听表格更新

```javascript
const api = window.AutoCardUpdaterAPI;

// 注册回调
const callback = (data) => {
    console.log("表格已更新，当前数据:", data);
    // 在这里处理更新后的数据
};

api.registerTableUpdateCallback(callback);

// 稍后注销回调
// api.unregisterTableUpdateCallback(callback);
```

### 示例 3: 创建预设选择 UI

```javascript
const api = window.AutoCardUpdaterAPI;

// 创建下拉选择器
function createPresetSelector() {
    const presets = api.getPlotPresetNames();
    const current = api.getCurrentPlotPreset();

    const select = document.createElement('select');
    select.innerHTML = presets.map(name =>
        `<option value="${name}" ${name === current ? 'selected' : ''}>${name}</option>`
    ).join('');

    select.addEventListener('change', (e) => {
        const success = api.switchPlotPreset(e.target.value);
        if (!success) {
            alert('切换预设失败');
            e.target.value = api.getCurrentPlotPreset();
        }
    });

    return select;
}
```

---

### 示例 4: 从外部导入模板和预设

```javascript
const api = window.AutoCardUpdaterAPI;

// 假设从服务器获取了模板和预设数据
async function loadFromServer() {
    // 将模板注入到当前聊天，不改动全局模板库
    const templateResponse = await fetch('/api/template.json');
    const templateData = await templateResponse.json();
    const templateResult = await api.importTemplateFromData(templateData, {
        scope: 'chat',
        presetName: '服务器下发模板'
    });
    console.log("模板注入当前聊天:", templateResult.message);

    // 如果你走的是角色卡开场页初始化链路，也可以这样显式指定模板预设名
    await api.initGameSession({ name: '示例角色' }, {
        injectTemplate: true,
        loadPreset: false,
        templateData,
        templatePresetName: '示例角色'
    });

    // 导入剧情推进预设库
    const presetResponse = await fetch('/api/presets.json');
    const presetsData = await presetResponse.json();
    const presetsResult = await api.importPlotPresetsFromData(presetsData);
    console.log(`预设导入: 成功 ${presetsResult.imported} 个`);
}
```

### 示例 5: 备份和恢复预设

```javascript
const api = window.AutoCardUpdaterAPI;

// 备份当前所有预设
function backupPresets() {
    const allPresets = api.exportAllPlotPresets();
    const backup = JSON.stringify(allPresets, null, 2);

    // 保存到 localStorage
    localStorage.setItem('plot_presets_backup', backup);
    console.log(`已备份 ${allPresets.length} 个预设`);
}

// 从备份恢复预设
async function restorePresets() {
    const backup = localStorage.getItem('plot_presets_backup');
    if (!backup) {
        console.log("未找到备份");
        return;
    }

    const presets = JSON.parse(backup);
    const result = await api.importPlotPresetsFromData(presets, { overwrite: true });
    console.log(`已恢复 ${result.imported} 个预设`);
}
```

---

## 更新配置参数 API

### `getUpdateConfigParams()`

获取更新配置参数（自动更新阈值、频率、批处理大小等）。

**返回值**: `Object` - 包含以下属性的对象

**返回结构**:
```javascript
{
    autoUpdateThreshold: 3,      // 自动更新阈值（消息层数）
    autoUpdateFrequency: 1,      // 自动更新频率（每N层更新一次）
    updateBatchSize: 2,          // 批处理大小（每批处理楼层数）
    autoUpdateTokenThreshold: 0  // Token阈值（0表示不限制）
}
```

**示例**:
```javascript
const config = window.AutoCardUpdaterAPI.getUpdateConfigParams();
console.log('当前阈值:', config.autoUpdateThreshold);
console.log('当前频率:', config.autoUpdateFrequency);
console.log('批处理大小:', config.updateBatchSize);
```

---

### `setUpdateConfigParams(params)`

设置更新配置参数。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| params | Object | 是 | 要更新的参数对象 |
| params.autoUpdateThreshold | number | 否 | 自动更新阈值（≥0） |
| params.autoUpdateFrequency | number | 否 | 自动更新频率（≥1） |
| params.updateBatchSize | number | 否 | 批处理大小（≥1） |
| params.autoUpdateTokenThreshold | number | 否 | Token阈值（≥0） |

**返回值**: `boolean` - 设置是否成功

**示例**:
```javascript
// 修改部分参数
const success = window.AutoCardUpdaterAPI.setUpdateConfigParams({
    autoUpdateThreshold: 5,
    updateBatchSize: 3
});
```

---

## 手动更新表选择 API

### `getManualSelectedTables()`

获取手动更新时选择的表格列表。

**返回值**: `Object` - 包含以下属性的对象

**返回结构**:
```javascript
{
    selectedTables: ['sheet_xxx', 'sheet_yyy'],  // 选中的表格 key 数组
    hasManualSelection: true                      // 是否用户显式选择过
}
```

**示例**:
```javascript
const selection = window.AutoCardUpdaterAPI.getManualSelectedTables();
console.log('已选择的表:', selection.selectedTables);
console.log('是否手动选择过:', selection.hasManualSelection);
```

---

### `setManualSelectedTables(sheetKeys)`

设置手动更新时选择的表格。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| sheetKeys | Array<string> | 是 | 要选择的表格 key 数组 |

**返回值**: `boolean` - 设置是否成功

**说明**:
- 无效的表格 key 会被自动过滤
- 设置后会自动将 `hasManualSelection` 标记为 `true`

**示例**:
```javascript
const success = window.AutoCardUpdaterAPI.setManualSelectedTables(['sheet_abc123', 'sheet_def456']);
```

---

### `clearManualSelectedTables()`

清除手动更新表选择（恢复全选状态）。

**返回值**: `boolean` - 清除是否成功

**示例**:
```javascript
window.AutoCardUpdaterAPI.clearManualSelectedTables();
```

---

## API 预设管理 API

> **安全收敛公告（v1.7）**：本章节所列全部方法已从公开 API 中弃用。
> 公开层不再允许外部读取、写入、删除或切换 API 预设（含 apiKey / apiConfig / tavernProfile 等敏感字段）。
> 请改用 [AI 调用 API](#ai-调用-api) 中的 `callAI(messages, options)` 受限代理接口发起 AI 请求，
> 并在 `options.presetName` 中指定要使用的预设名称。
> 预设的管理（创建、编辑、删除）请通过数据库插件内部设置面板操作。

### `getApiPresets()` [已弃用]

**状态**: 已弃用，始终返回空数组 `[]`。

**替代方案**: 使用 `callAI(messages, { presetName })` 发起 AI 请求。

### `getTableApiPreset()` / `setTableApiPreset()` / `getPlotApiPreset()` / `setPlotApiPreset()` / `saveApiPreset()` / `loadApiPreset()` / `deleteApiPreset()` [已弃用]

**状态**: 已弃用，始终返回 `false`（setter/loader/deleter）或 `''`（getter）。

**替代方案**: 通过插件内部设置面板管理预设；通过 `callAI(messages, { presetName, max_tokens })` 发起 AI 请求。

---

## AI 调用 API

### `callAI(messages, options)`

通过数据库插件内部配置发起受限 AI 代理请求。外部不可读取或覆盖 API 密钥、URL、请求头等敏感配置。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| messages | Array | 是 | 消息数组，格式: `[{role: 'system'\|'user'\|'assistant', content: '...'}]` |
| options.presetName | string | 否 | 指定要使用的 API 预设名称；不传则使用当前配置 |
| options.max_tokens / options.maxTokens | number \| string | 否 | 最大 token 数，默认使用预设配置或 4096；数字字符串会被规范化 |

**返回值**: `Promise<string|null>` - AI 返回的文本内容，失败返回 `null`

**安全约束（v1.7）**:
- `options` 中仅允许 `presetName`、`max_tokens`、`maxTokens` 三个字段。
- 严禁传入以下字段，否则请求会被拒绝并返回 `null`：
  `apiConfig`、`apiKey`、`url`、`requestHeaders`、`bodyParams`、`excludeBodyParams`、
  `tavernProfile`、`model`、`temperature`、`stream`。
- 外部无法通过 `callAI` 读取或修改任何 API 预设/配置内容。

**说明**:
- 请求由数据库插件内部根据 `presetName`（或当前配置）选择 API 模式与凭据，外部仅提供消息和可选的 token 上限。
- 错误与日志中不会出现 API 密钥、完整请求头或自定义 URL 等敏感信息。

**使用场景**:
- 第三方插件需要调用 AI 生成内容（如地图生成、剧情分析等），但不应接触用户的 API 凭据。
- 统一使用数据库插件的 API 配置，避免在各插件中重复配置和泄露密钥。

**示例**:
```javascript
// 检查 API 是否可用
if (window.AutoCardUpdaterAPI && typeof window.AutoCardUpdaterAPI.callAI === 'function') {
    const messages = [
        { role: 'system', content: '你是一个有帮助的助手。' },
        { role: 'user', content: '请生成一个奇幻场景的描述。' }
    ];

    // 使用指定预设
    const response = await window.AutoCardUpdaterAPI.callAI(messages, { presetName: '我的GPT预设', max_tokens: 2000 });

    // 使用当前配置（不传 presetName）
    const response2 = await window.AutoCardUpdaterAPI.callAI(messages, { maxTokens: '2000' });

    if (response) {
        console.log('AI 响应:', response);
    } else {
        console.error('AI 调用失败');
    }

    // 以下调用会被拒绝并返回 null：
    // const blocked = await window.AutoCardUpdaterAPI.callAI(messages, { apiKey: 'sk-xxx' });
    // const blocked2 = await window.AutoCardUpdaterAPI.callAI(messages, { model: 'gpt-5' });
}
```


---

### `getStoryContext(maxTurns)`

获取最近剧情上下文（从聊天记录，仅 AI 消息）。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| maxTurns | number | 否 | 最大回合数，默认 3 |

**返回值**: `string` - 剧情上下文文本（多条消息用 `\n\n` 分隔）

**说明**:
- 从最新的聊天记录向前遍历
- 只获取 AI 的回复消息（`is_user === false`）
- 返回的消息按时间顺序排列（旧消息在前）

**使用场景**:
- 获取最近的剧情内容用于上下文分析
- 为 AI 调用提供剧情背景

**示例**:
```javascript
// 获取最近 5 轮对话的剧情上下文
const context = window.AutoCardUpdaterAPI.getStoryContext(5);
console.log('最近剧情:', context);

// 配合 callAI 使用
const messages = [
    { role: 'system', content: '你是剧情分析助手。' },
    { role: 'user', content: `请分析以下剧情的发展趋势：\n\n${context}` }
];
const analysis = await window.AutoCardUpdaterAPI.callAI(messages);
```

---

## 格林推演 API

命名空间：`window.AutoCardUpdaterAPI.worldSimulation`。读取方法返回深拷贝，修改返回值不会影响插件数据；写入走与格林推演设置页相同的校验与保存流程。当前聊天还没有格林推演资料（未打开过格林推演页完成初始化）时，读取返回 `null`，`updateSettings` 抛出错误。

| 方法 | 说明 |
|------|------|
| `getSettings()` | 读取当前聊天的格林推演设置，没有资料时返回 `null` |
| `updateSettings(patch)` | 按顶层键合并补丁后保存，返回保存后的设置。嵌套对象（如 `dynamics`、`workflow`、`projection`）整体替换，需要传完整对象；校验不通过时抛出错误 |
| `getLedger()` | 读取账本（时序、局势刻度、伏线、人物、纪要、风声、场外信号等） |
| `getTask()` | 读取当前任务，没有任务时返回 `null` |
| `getUserRequirements()` | 读取用户要求 |
| `setUserRequirements(requirements)` | 修改用户要求，返回 `Promise` |
| `send(text)` | 给格林推演主 Agent 发送一条消息（等同在推演页对话框发送），返回 `Promise` |
| `resume()` | 继续已停止的任务，返回 `Promise` |
| `stop()` | 停止当前推演，返回 `Promise<boolean>` |
| `isRunning()` | 当前是否有推演在运行 |

**场外信号插入格式**：`settings.projection.template` 是写进正文的格式，`$WORLD_SIGNALS` 会替换成按【此地此刻】【风闻轶事】【世界暗流】分组的信号。模板必须恰好包含一次 `$WORLD_SIGNALS`、不超过 4000 字，且不能包含插件的起止注释标记（它们自动加在最外层）。插入正文后会自动重渲染该楼层。

```javascript
const sim = window.AutoCardUpdaterAPI.worldSimulation;
const settings = sim.getSettings();
if (settings) {
    // 关闭自动推演，并把插入格式换成折叠块
    await sim.updateSettings({
        autoTriggerEnabled: false,
        projection: { template: '<details><summary>与此同时</summary>\n$WORLD_SIGNALS\n</details>' },
    });
}
const ledger = sim.getLedger();
console.log(ledger?.guidance.signals);
```

---

## 智能续写 API

命名空间：`window.AutoCardUpdaterAPI.continuation`。读取返回深拷贝；写入走与智能续写页相同的保存流程（`orchestrator.replaceSettings`）。当前聊天还没有智能续写资料时，读取返回 `null`，`updateSettings` 抛出错误；任务运行中保存可能因忙碌被拒绝。

| 方法 | 说明 |
|------|------|
| `getSettings()` | 读取当前聊天的智能续写设置，没有资料时返回 `null` |
| `updateSettings(patch)` | 按顶层键合并补丁后保存，返回保存后的设置；嵌套对象整体替换 |
| `getEnvelope()` | 读取完整的续写资料（设置、当前任务等），没有资料时返回 `null` |
| `continueTask()` | 继续当前续写任务 |
| `stop()` | 停止正在进行的生成 |

```javascript
const cont = window.AutoCardUpdaterAPI.continuation;
await cont.updateSettings({ maxAutomaticStages: 5 });
```

---

## 功能开关 API（桌宠 / 气泡 / 功能页）

命名空间：`window.AutoCardUpdaterAPI.features`。开关的缺省值与仪表盘「高级设置」一致；修改桌宠与静默模式类开关后会立即通知桌宠和气泡刷新。用接口修改功能页开关后，已打开的界面需要重新打开才会更新显示。桌宠与气泡的图片、尺寸、配色、位置等外观见[桌宠与气泡外观 API](#桌宠与气泡外观-api)。

| 方法 | 说明 |
|------|------|
| `keys()` | 列出可调的开关键名 |
| `getAll()` | 读取全部开关当前值，返回 `{ 键名: boolean }` |
| `set(key, value)` | 修改一个开关，`value` 必须是 `true` 或 `false`；返回修改后的全部开关。键名不支持或值不是布尔时抛出错误 |

| 键名 | 含义 | 缺省 |
|------|------|------|
| `autoUpdateEnabled` | 自动填表 | 开 |
| `silentModeEnabled` | 静默模式（不弹通知气泡） | 关 |
| `desktopPetEnabled` | 桌宠 | 开 |
| `deskPetJokesEnabled` | 桌宠讲笑话 | 开 |
| `deskPetShowRealWork` | 桌宠与气泡显示真实任务进度 | 关 |
| `continuationPageEnabled` | 智能续写页 | 开 |
| `worldSimulationPageEnabled` | 格林推演总开关（含自动后台触发） | 关 |
| `externalImportPageEnabled` | 外部导入页 | 开 |

流式输出、内容替换、开发者选项、零 TK 占用这几项开关的联动逻辑在界面层，暂不通过 API 开放。

```javascript
const features = window.AutoCardUpdaterAPI.features;
console.log(features.getAll());
features.set('desktopPetEnabled', false);
features.set('silentModeEnabled', true);
```

---

## 桌宠与气泡外观 API

命名空间：`window.AutoCardUpdaterAPI.deskPet`（桌宠）与 `window.AutoCardUpdaterAPI.noticeBubble`（通知气泡）。显示桌宠、讲笑话、静默模式等开关仍在 [`features`](#功能开关-api桌宠--气泡--功能页)。

- **只存改过的项**：外观存在插件设置的 `deskPetAppearance`、`noticeBubbleAppearance` 两个字段里（随当前设置 profile），没改过的项一律跟随内置缺省值，缺省值与改造前写死的效果相同。
- **补丁语义**：`updateAppearance(patch)` 里对象逐层合并、数组整体替换，某项传 `null` 表示恢复缺省；未知键、类型或范围不对直接抛错，整个补丁都不保存。
- **立即生效**：保存成功后桌宠和气泡马上按新外观刷新，不用重开界面。设置还没加载完或写盘失败时抛错，内存里的值同时恢复原样。
- **读取**：每次返回新对象，改返回值不影响插件。已存数据里无法使用的项按缺省显示，可用 `getIssues()` 查看，下一次写入时丢弃。

两组共有的方法：

| 方法 | 说明 |
|------|------|
| `getAppearance()` | 读取生效的外观（缺省值叠加改过的项） |
| `getOverrides()` | 读取改过的项 |
| `getDefaults()` | 读取内置缺省值 |
| `getIssues()` | 列出已存数据里无法使用的项（字符串数组），正常时为空 |
| `describe()` | 列出全部字段：`path`、`label`、`type`、`default`，以及 `min` / `max` / `integer` / `zeroAllowed` / `values` / `maxItems` / `maxLength` 等取值范围 |
| `updateAppearance(patch)` | 校验后合并补丁并保存，返回生效的外观 |
| `resetAppearance(keys?)` | 恢复缺省：不传恢复全部；可传 `'images'`、`'images.idle'` 或 `['size', 'motion.snoreAfterMs']` 这样的路径。返回生效的外观 |

桌宠另有：

| 方法 | 说明 |
|------|------|
| `imageKeys()` | 列出 27 个图片键名（24 个动作 + 3 张贴边探头） |
| `getPosition()` | 读取保存的位置 `{ x, y, edge }`；没保存过返回 `null`（默认右下角） |
| `setPosition({ x, y, edge? })` | `x`、`y` 是 0~1 的比例（0 最左 / 最上，1 最右 / 最下），保留 4 位小数；`edge` 为 `left` / `right` / `top` / `bottom` 时吸附到该边（贴边的那一轴以 `edge` 为准），省略或 `null` 表示自由停放。返回保存的位置 |
| `resetPosition()` | 清除保存的位置，回到默认右下角，返回 `null` |

### 桌宠字段（`deskPet`）

| 字段 | 缺省 | 说明 |
|------|------|------|
| `images.<键名>` | `null` | 动作图片：`https://` / `http://` 链接、站内路径（如 `/user/images/pet.png`）或 `data:image/…`；`null` 为内置图。单张不超过 1 MiB 字符，全部合计不超过 4 MiB 字符（设置每次保存都整份写盘，大图请用链接） |
| `size.wide` / `size.narrow` | 88 / 64 | 宽屏 / 窄屏（视口宽 ≤640px）尺寸，32~256 px |
| `size.peekDepthRatio` / `size.peekOriginalDepthRatio` | 0.56 / 0.61 | 贴边缩进时露出部分占尺寸的比例（普通 / 稀有探头），0.2~1 |
| `motion.enabled` | `true` | 动效开关：`false` 时不播呼吸、摇摆等动效，也不散步打滚（动作帧照常切换） |
| `motion.idleActionMinMs` / `motion.idleActionSpreadMs` | 15000 / 5000 | 待机小动作的最短间隔与随机浮动（毫秒） |
| `motion.idleActionWeights.*` | 见说明 | 待机小动作的抽取权重，0 表示不做：`blink` 眨眼 16、`doubleBlink` 连眨 8、`lookAround` 张望 14、`walk` 散步 18、`roll` 打滚 10、`eat` 吃零食 14、`yawn` 打哈欠 10、`glance` 侧看 10 |
| `motion.snoreAfterMs` | 60000 | 无互动多久睡着（毫秒），0 表示不睡 |
| `motion.tuckDelayMs` | 4000 | 吸附到屏幕边后多久缩进去（毫秒），0 表示不自动缩进（推进墙里仍会立刻缩进） |
| `motion.peekRotateMs` / `motion.peekOriginalChance` | 30000 / 0.01 | 缩进期间重抽探头造型的间隔，与抽到稀有造型的概率（0~1） |
| `motion.waveCooldownMs` | 30000 | 鼠标靠近打招呼的冷却（毫秒） |
| `motion.reactionMs.*` | 见说明 | 互动反应时长（毫秒）：`shy` 1600、`tickle` 1600、`angry` 2200、`happy` 1100、`dizzy` 2400、`surprised` 1300、`wave` 1600、`huff` 1000、`pound` 1300、`knockdown` 2200 |
| `jokes.mode` | `'append'` | `append` 追加到内置 130 条语录之后；`replace` 只用自定义语录（自定义为空时仍用内置） |
| `jokes.heading` | `'你知道吗？'` | 语录气泡的标题，可留空 |
| `jokes.items` | `[]` | 自定义语录，最多 2000 条、每条 ≤600 字，支持换行 |
| `statusWords.mode` | `'append'` | 忙碌状态词（气泡显示「正在XX…」）的合成方式，同上；`replace` 时某组为空则该组仍用内置 |
| `statusWords.groups.*` | `[]` | 按功能分组：`table` 填表、`plan` 剧情规划、`polish` 正文优化、`continuation` 智能续写、`simulation` 格林推演、`import` 外部导入、`index` 交火 / 索引 / 召回、`skill` Skill 整理、`generic` 其他；每组 ≤200 个、每个 ≤20 字 |

图片键名：`idle` 待机、`blink` 眨眼、`look-left` / `look-right` 张望、`walk-a` / `walk-b` 散步两帧、`roll` 打滚、`eat-a` / `eat-b` 吃零食两帧、`yawn` 打哈欠、`snore` / `sit-snore` 睡觉、`working` 干活、`struggle` 被拎起来、`shy` 害羞、`tickle` 怕痒、`angry` 生气、`happy` 被摸、`dizzy` 晕、`surprised` 吓一跳、`wave` 打招呼、`huff` 哈气、`pound` 锤屏幕、`knockdown` 震倒；贴边探头 `peek`、`peek-original`（稀有）、`peek-sleepy`（睡着时）。

- 自定义图按桌宠框原尺寸、等比缩放显示，建议用透明底的方图。内置图的挣扎、吓一跳、倒地三帧带体型补偿放大，自定义图不套用。
- 探头图要求底边平切、头朝上，插件会按停靠边自动旋转；露出多少由 `size.peekDepthRatio` 决定。

### 气泡字段（`noticeBubble`）

| 字段 | 缺省 | 说明 |
|------|------|------|
| `colors.background` / `text` / `muted` / `border` | `#fffaf0` / `#3d3122` / `#7a6a52` / `#e9cf8a` | 底色、正文、次要文字（明细标题、关闭按钮）、边框与分隔线 |
| `colors.info` / `success` / `warning` / `error` | `#d4a93a` / `#6f9a4d` / `#d08a2c` / `#c2503a` | 各类提示的强调色（标题、按钮边框） |
| `colors.joke` / `jokeBackground` / `jokeHeading` | `#e6b93c` / `#fff6d8` / `#a47a12` | 语录气泡的强调色、底色、标题文字 |
| `colors.danger` / `dangerText` | `#c2503a` / `#a33d29` | 危险按钮（如「停止」）的边框与悬停底色、文字 |
| `fontSize` | 12 | 正文字号 10~24 px，标题与按钮随之缩放 |
| `fontFamily` | 系统字体栈 | CSS `font-family`，只能含文字、数字、空格、逗号、引号、点、下划线和连字符 |
| `borderRadius` | 12 | 圆角 0~32 px |
| `size.minWidth` / `maxWidth` / `dockedMaxWidth` | 200 / 400 / 360 | 最小宽度、贴桌宠时最大宽度、无桌宠停靠时最大宽度（px）；`minWidth` 不能大于后两者 |
| `size.detailMaxHeight` | 160 | 展开明细区的最大高度（px） |
| `anchor.gap` | 12 | 贴桌宠时与桌宠的间距（px） |
| `anchor.sides` | `['above', 'below', 'left', 'right']` | 贴桌宠时的方位优先顺序，放不下依次尝试；都放不下时用最后一个并夹进屏幕 |
| `dock.corner` | `'top-right'` | 没有桌宠时停靠的角落：`top-right` / `top-left` / `bottom-right` / `bottom-left` |
| `dock.offsetX` / `offsetY` | 18 / 62 | 停靠时距左右 / 上下边缘（px） |
| `dock.narrowOffsetY` | 58 | 窄屏（视口宽 ≤640px）停靠时距上下边缘（px）；窄屏时水平居中 |
| `carousel.slideMs` | 5000 | 每条停留时长（毫秒），1000~120000 |
| `carousel.slidesPerJoke` | 2 | 每播几条消息插一条语录，0 表示不插播 |
| `carousel.idleJokeMs` | 300000 | 空闲多久讲一条语录（毫秒），0 表示空闲时不讲 |

颜色支持 `#rgb` / `#rrggbb` / `#rrggbbaa`、`rgb()` / `rgba()`、`hsl()` / `hsla()` 和颜色名；为防止改写其它样式，不接受 `url()`、`var()`、分号等写法。

```javascript
const pet = window.AutoCardUpdaterAPI.deskPet;
const bubble = window.AutoCardUpdaterAPI.noticeBubble;

// 换两张动作图、放大一点、不睡觉，再追加一条语录
pet.updateAppearance({
    images: {
        idle: 'https://example.com/cat/idle.png',
        working: '/user/images/cat-working.gif',
    },
    size: { wide: 112 },
    motion: { snoreAfterMs: 0 },
    jokes: { items: ['猫为什么不用电脑？因为怕鼠标。'] },
});

// 放到左侧中间并贴边
pet.setPosition({ x: 0, y: 0.5, edge: 'left' });

// 深色气泡，没有桌宠时停在左下角，每条停 8 秒
bubble.updateAppearance({
    colors: { background: '#24262b', text: '#f1f1f1', muted: '#a0a4ad', border: '#3a3d44' },
    dock: { corner: 'bottom-left', offsetY: 24 },
    carousel: { slideMs: 8000 },
});

// 只恢复待机图；或恢复全部
pet.resetAppearance('images.idle');
bubble.resetAppearance();
```

---

## 注意事项

1. **API 可用性检查**: 在调用任何 API 方法前，请先检查 `window.AutoCardUpdaterAPI` 是否存在。

2. **异步方法**: 大多数方法返回 `Promise`，请使用 `async/await` 或 `.then()` 处理。

3. **数据安全**: `getPlotPresets()` 和 `getPlotPresetDetails()` 返回的是深拷贝，修改返回值不会影响原始数据。

4. **UI 同步**: `switchPlotPreset()` 与 `switchTemplatePreset()` 会自动同步设置面板的 UI（如果已打开）。

5. **错误处理**: 所有 API 方法都有内置错误处理，失败时会返回 `false` 或空值，不会抛出异常。

6. **前端导入 API**: `importTemplateFromData()` 和 `importPlotPresetFromData()` 返回包含 `success` 和 `message` 的对象，便于前端展示导入结果。

7. **数据隔离**: 切换预设后，`$6` 占位符会自动回溯查找匹配当前预设名称标签的历史数据，实现不同预设间的剧情规划隔离。

8. **模板作用域**: `importTemplate()`、`exportTemplate()`、`resetTemplate()`、`switchTemplatePreset()`、`importTemplateFromData()` 都支持 `options.scope`。`global` 作用于当前 profile 的全局模板；`chat` 仅作用于当前聊天模板快照，不会改动全局模板库。
9. **安全收敛 (v1.7)**: API 预设管理全部弃用，外部不可再通过 `getApiPresets` 等接口读取 apiKey / apiConfig 等敏感字段。请改用 `callAI(messages, { presetName, max_tokens })` 受限代理接口发起 AI 请求，外部仅提供消息和 token 上限，插件内部负责解析配置并代发请求。

10. **命名空间 API (v1.8 / v1.9)**: `worldSimulation`、`continuation`、`features`、`deskPet`、`noticeBubble` 这几组方法在数据不存在、参数不合法或保存失败时会抛出错误（不同于旧接口返回 `false`），请用 `try/catch` 处理。


---

## 版本历史

| 版本 | 更新内容 |
|------|----------|
| 1.0 | 初始 API：数据导入导出、设置管理、世界书操作 |
| 1.1 | 新增剧情推进预设管理 API：`getPlotPresets()`, `getPlotPresetNames()`, `getCurrentPlotPreset()`, `switchPlotPreset()`, `getPlotPresetDetails()` |
| 1.2 | 新增前端导入 API：`importTemplateFromData()`, `importPlotPresetFromData()`, `importPlotPresetsFromData()`, `getTableTemplate()`, `exportAllPlotPresets()` |
| 1.3 | 新增更新配置参数 API：`getUpdateConfigParams()`, `setUpdateConfigParams()`；新增手动更新表选择 API：`getManualSelectedTables()`, `setManualSelectedTables()`, `clearManualSelectedTables()`；新增 API 预设管理 API：`getApiPresets()`, `getTableApiPreset()`, `setTableApiPreset()`, `getPlotApiPreset()`, `setPlotApiPreset()`, `saveApiPreset()`, `loadApiPreset()`, `deleteApiPreset()` |
| 1.4 | 新增 AI 调用 API：`callAI(messages, options)` 使用数据库配置的 API 调用 AI；`getStoryContext(maxTurns)` 获取最近剧情上下文 |
| 1.5 | 补充模板双作用域相关文档：`importTemplate(options)`、`exportTemplate(options)`、`resetTemplate(options)`、`getTemplatePresetNames()`、`switchTemplatePreset()`、`injectTemplatePresetToCurrentChat()`、`importTemplateFromData(templateData, options)` |
| 1.6 | 新增外部导入 Headless API 与 Agent 世界书 API 文档：`importTxtTextAndSplit(text, options)`、结构化 `injectImportedSelected(options)`、`getAgentWorldbookControl()`、`setAgentWorldbookMode(mode, options)`、`runAgentWorldbookSkillify(options)` 及兼容别名 |
| 1.7 | **安全收敛**：弃用全部 API 预设管理公开接口（`getApiPresets / saveApiPreset / loadApiPreset / deleteApiPreset / getTableApiPreset / setTableApiPreset / getPlotApiPreset / setPlotApiPreset`）；`callAI` 升级为受限代理接口，仅允许 `presetName + max_tokens`，禁止外部传入 `apiConfig / apiKey / url / requestHeaders / bodyParams / model / temperature / stream` 等敏感字段 |
| 1.8 | 新增命名空间 API：`worldSimulation`（格林推演设置、账本、任务、用户要求的读写，发送 / 继续 / 停止）、`continuation`（智能续写设置读写、续跑与停止）、`features`（桌宠、静默模式、自动填表与功能页开关）；格林推演设置新增 `projection.template` 场外信号插入格式 |
| 1.9 | 新增桌宠与气泡外观 API：`deskPet`（动作图片、尺寸、动画节奏、语录与状态词、位置）、`noticeBubble`（配色、字号、字体、圆角、尺寸、摆放方位、停靠角落、轮播节奏），支持读取、按补丁修改、恢复缺省与字段说明 |


## 公开写入：可选前端回读等待

`executeSqlMutation`、`executeSqlBatch`、写入型 `executeSql`、对象参数形式的 `updateCell` / `updateRow` / `insertRow` / `deleteRow`，以及 `importTableAsJson` 的导入选项支持 `awaitFrontendReadback?: boolean`。

默认保留通知后800ms的回读窗口。只有显式传入布尔值 `false` 时不等待该固定窗口；数据提交、持久化、世界书／运行时刷新和更新通知照常执行，原有失败结果不变。它不等同于 `skipNotify` 或 `skipChatSave`。

```javascript
await api.executeSqlBatch({
  sql: 'UPDATE inventory SET quantity = 2 WHERE row_id = 1;',
  awaitFrontendReadback: false,
});
await api.updateCell({
  tableName: '背包物品表', rowIndex: 1, colIdentifier: '数量', value: 2,
  awaitFrontendReadback: false,
});
await api.importTableAsJson(jsonString, { awaitFrontendReadback: false });
```

适用于不依赖前端刷新完成、或自行处理刷新反馈的调用者。函数返回时界面可能尚未完成更新；依赖DOM内容、截图或交互动画完成的流程应保留默认行为或等待自身完成信号。固定窗口本身也不是所有前端已完成的确认机制。
