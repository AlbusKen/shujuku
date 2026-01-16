# 神·数据库（shujuku）外部 API 调用文档

本文档详细说明了 `神·数据库` 插件对外暴露的 API 接口，供其他插件或扩展调用。

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
- [设置与更新 API](#设置与更新-api)
- [世界书操作 API](#世界书操作-api)
- [TXT导入链路 API](#txt导入链路-api)
- [表格锁定 API](#表格锁定-api)
- [回调注册 API](#回调注册-api)

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

### `importTableAsJson(jsonString)`

导入并覆盖当前表格数据。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| jsonString | string | 是 | JSON 格式的表格数据字符串 |

**返回值**: `Promise<boolean>` - 导入是否成功

**示例**:
```javascript
const jsonData = '{"mate": {...}, "sheet_0": {...}}';
const success = await window.AutoCardUpdaterAPI.importTableAsJson(jsonData);
```

---

### `exportJsonData()`

导出当前 JSON 数据到文件（会弹出保存对话框）。

**返回值**: `Promise<boolean>`

---

### `importCombinedSettings()`

导入组合设置（会弹出文件选择对话框）。

**返回值**: `Promise<boolean>`

---

### `exportCombinedSettings()`

导出组合设置到文件（会弹出保存对话框）。

**返回值**: `Promise<boolean>`

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

### `deleteInjectedEntries()`

删除当前注入目标世界书里的"本插件生成条目"。

**返回值**: `Promise<boolean>`

---

## TXT导入链路 API

### `importTxtAndSplit()`

导入 TXT 文件并分割。

**返回值**: `Promise<boolean>`

---

### `injectImportedSelected()`

注入选中的导入内容。

**返回值**: `Promise<boolean>`

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

### `clearImportCache(clearAll)`

清除导入缓存（localStorage）。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| clearAll | boolean | 否 | 是否清除全部，默认 `true` |

**返回值**: `Promise<boolean>`

---

## 模板管理 API

### `importTemplate()`

导入模板（会弹出文件选择对话框）。

**返回值**: `Promise<boolean>`

---

### `exportTemplate()`

导出模板到文件。

**返回值**: `Promise<boolean>`

---

### `resetTemplate()`

重置模板为默认值。

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

获取当前使用的表格模板。

**返回值**: `Object | null` - 模板对象的深拷贝，如果未设置则返回 `null`

**示例**:
```javascript
const template = window.AutoCardUpdaterAPI.getTableTemplate();
if (template) {
    console.log("当前模板表格数量:", Object.keys(template).filter(k => k.startsWith('sheet_')).length);
}
```

---

### `importTemplateFromData(templateData)`

通过前端直接导入表格模板（无需文件选择器）。

**参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| templateData | Object \| string | 是 | 模板数据，可以是 JSON 对象或 JSON 字符串 |

**返回值**: `Promise<{success: boolean, message: string}>` - 导入结果

**模板数据结构要求**:
- 必须包含 `mate` 对象且 `mate.type` 为 `"chatSheets"`
- 必须包含至少一个 `sheet_*` 键
- 每个 sheet 必须包含 `name`, `content`, `sourceData` 字段

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

const result = await window.AutoCardUpdaterAPI.importTemplateFromData(template);
if (result.success) {
    console.log("模板导入成功:", result.message);
} else {
    console.error("模板导入失败:", result.message);
}
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
    // 导入模板
    const templateResponse = await fetch('/api/template.json');
    const templateData = await templateResponse.json();
    const templateResult = await api.importTemplateFromData(templateData);
    console.log("模板导入:", templateResult.message);
    
    // 导入预设
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

## 注意事项

1. **API 可用性检查**: 在调用任何 API 方法前，请先检查 `window.AutoCardUpdaterAPI` 是否存在。

2. **异步方法**: 大多数方法返回 `Promise`，请使用 `async/await` 或 `.then()` 处理。

3. **数据安全**: `getPlotPresets()` 和 `getPlotPresetDetails()` 返回的是深拷贝，修改返回值不会影响原始数据。

4. **UI 同步**: `switchPlotPreset()` 会自动同步设置面板的 UI（如果已打开）。

5. **错误处理**: 所有 API 方法都有内置错误处理，失败时会返回 `false` 或空值，不会抛出异常。

6. **前端导入 API**: `importTemplateFromData()` 和 `importPlotPresetFromData()` 返回包含 `success` 和 `message` 的对象，便于前端展示导入结果。

7. **数据隔离**: 切换预设后，`$6` 占位符会自动回溯查找匹配当前预设名称标签的历史数据，实现不同预设间的剧情规划隔离。

---

## 版本历史

| 版本 | 更新内容 |
|------|----------|
| 1.0 | 初始 API：数据导入导出、设置管理、世界书操作 |
| 1.1 | 新增剧情推进预设管理 API：`getPlotPresets()`, `getPlotPresetNames()`, `getCurrentPlotPreset()`, `switchPlotPreset()`, `getPlotPresetDetails()` |
| 1.2 | 新增前端导入 API：`importTemplateFromData()`, `importPlotPresetFromData()`, `importPlotPresetsFromData()`, `getTableTemplate()`, `exportAllPlotPresets()` |