/**
 * presentation/bootstrap/api-registry.ts — AutoCardUpdaterAPI 对外 API 注册
 *
 * 从 src/core/03_runtime_api.js 整体迁移，按领域拆分为 9 个分组文件。
 * 本文件负责：import 所有分组 → 合并方法 → 挂载到全局对象。
 */

import { topLevelWindow_ACU } from '../../shared/env';
import { createCallbackApi, type ApiGroupContext } from './api-groups/callback-api';
import { createCoreDataApi } from './api-groups/core-data-api';
import { createTableCrudApi } from './api-groups/table-crud-api';
import { createTableLockApi } from './api-groups/table-lock-api';
import { createTemplatePresetApi } from './api-groups/template-preset-api';
import { createPlotPresetApi } from './api-groups/plot-preset-api';
import { createDataAdminApi } from './api-groups/data-admin-api';
import { createSettingsConfigApi } from './api-groups/settings-config-api';
import { createWorldbookAiApi } from './api-groups/worldbook-ai-api';
import { createAgentWorldbookApi } from './api-groups/agent-worldbook-api';
import { createSqlApi, installRuntimeGatedSqlReadApi_ACU } from './api-groups/sql-api';
import { createPerformanceDiagnosticsApi } from './api-groups/performance-diagnostics-api';
import { createZeroLayerExitApi_ACU } from './api-groups/zero-layer-api';

// --- 共享状态（回调数组） ---
const tableUpdateCallbacks: Function[] = [];
const tableFillStartCallbacks: Function[] = [];

// --- 共享上下文（延迟引用，解决 this 互调） ---
let apiRef: any = null;
const ctx: ApiGroupContext = {
    tableUpdateCallbacks,
    tableFillStartCallbacks,
    getApi: () => apiRef,
};

const sqlApi = createSqlApi(ctx);

// --- 组装所有领域 API ---
const api = Object.assign(
    {},
    createCallbackApi(ctx),
    createCoreDataApi(ctx),
    createTableCrudApi(ctx),
    createTableLockApi(ctx),
    createTemplatePresetApi(ctx),
    createPlotPresetApi(ctx),
    createDataAdminApi(ctx),
    createSettingsConfigApi(ctx),
    createWorldbookAiApi(ctx),
    createAgentWorldbookApi(ctx),
    createPerformanceDiagnosticsApi(),
    createZeroLayerExitApi_ACU(),
    sqlApi,
);

// SQL 同步读取只能在 SQLite runtime 完整发布后对外可见。
// getter 会在聊天切换/重载窗口自动隐藏，避免第三方脚本把“函数存在”误判为“运行时可查询”。
installRuntimeGatedSqlReadApi_ACU(api, sqlApi);

// 将最终组装的 api 赋给 apiRef，使 ctx.getApi() 返回完整对象
apiRef = api;

// --- 挂载到全局 ---
(topLevelWindow_ACU as any).AutoCardUpdaterAPI = api;
