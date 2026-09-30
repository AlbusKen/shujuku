/**
 * src/index.ts — 应用真入口
 *
 * 按层级顺序导入所有模块，Rollup 基于此构建模块图。
 * 输出格式为 IIFE（油猴环境要求），所有模块代码合并到同一个闭包作用域。
 */

// ═══════════════════════════════════════════════════════════════
// 运行时环境检测（必须最先导入）
// ═══════════════════════════════════════════════════════════════
import { checkAndMarkInstance } from './shared/runtime-env';

// ═══════════════════════════════════════════════════════════════
// shared 层
// ═══════════════════════════════════════════════════════════════
import './shared/constants';
import './shared/env';
import './shared/utils';
import './shared/json-helpers';
import './shared/html-helpers';
import './shared/text-optimization';

// ═══════════════════════════════════════════════════════════════
// data 层
// ═══════════════════════════════════════════════════════════════
import './shared/data-constants';
import './shared/idb-import-temp';
import './data/storage/tavern-storage';
import './data/storage/chat-history';
import './shared/defaults';
import './shared/defaults-json.js';
import './data/storage/config-storage';
import './data/repositories/profile-repo';
import './data/repositories/isolation-repo';

// ═══════════════════════════════════════════════════════════════
// service 层
// ═══════════════════════════════════════════════════════════════
import './service/settings/settings-service';
import './service/ai/api-call';
import './service/ai/prompt-builder';
import './service/worldbook/pipeline';
import './service/worldbook/injection-engine';
import './service/summary/merge-logic';
import './service/runtime/state-manager';
import './service/runtime/helpers-remaining';
import './service/template/chat-scope';
import './service/optimization/content-optimization';

// ═══════════════════════════════════════════════════════════════
// presentation 层
// ═══════════════════════════════════════════════════════════════
import './presentation/triggers/update-process';
import './presentation/triggers/import-process';
import './presentation/bootstrap/init';
import './presentation/bootstrap/api-registry';
import './presentation/window/window-system';
import './presentation/window/window-styles';
import './presentation/theme/toast';
import './presentation/components/table-selector';
import './presentation/components/plot-editors';
import './presentation/components/status-display';
import './presentation/components/template-preset-ui';
import './presentation/components/optimization-ui';
import './presentation/components/worldbook-selector';
import './presentation/components/update-status-display';
import './presentation/components/import-status-ui';
import './presentation/triggers/update-trigger';
import './presentation/triggers/data-admin-ui';
import './presentation/triggers/settings-ui-sync';

// ═══════════════════════════════════════════════════════════════
// 启动入口（油猴脚本模式）
// ═══════════════════════════════════════════════════════════════
import { mainInitialize_ACU } from './presentation/bootstrap/init';
import { bootstrapAcuV2 } from './presentation-v2/bootstrap';

// jQuery ready 回调
declare const $: any;
$(function() {
    // 互斥检测：如果已有实例（插件或另一个油猴脚本）在运行，跳过初始化
    if (checkAndMarkInstance()) {
        console.warn('[龙血玄黄·数据库] 油猴脚本检测到已有实例运行，跳过初始化。');
        return;
    }
    console.log('ACU_INIT_DEBUG: Document is ready, attempting to initialize ACU script (Userscript mode).');
    mainInitialize_ACU();
    bootstrapAcuV2();
});
