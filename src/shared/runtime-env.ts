/**
 * shared/runtime-env.ts — 运行时环境检测
 *
 * 检测当前脚本运行在哪种环境中：
 * - 油猴脚本模式（Userscript）：运行在酒馆助手创建的 iframe 中，window.parent 指向酒馆主窗口
 * - 酒馆插件模式（Extension）：运行在酒馆主窗口中，window 就是酒馆主窗口
 *
 * 所有需要区分环境的代码都应通过此模块的函数来判断，而非自行检测。
 */

/** 互斥检测全局标记键名 */
export const ACU_INSTANCE_FLAG = '__ACU_STAR_DB_III_LOADED__';

/**
 * 运行模式枚举
 */
export const enum RuntimeMode {
    /** 油猴脚本模式：运行在 iframe 中 */
    Userscript = 'userscript',
    /** 酒馆插件模式：运行在主窗口中 */
    Extension = 'extension',
}

/** 缓存检测结果，避免重复计算 */
let _cachedMode: RuntimeMode | null = null;

/**
 * 由插件入口在启动时调用，强制设置为插件模式。
 * 必须在任何其他模块访问 runtime-env 之前调用。
 */
export function _forceExtensionMode(): void {
    _cachedMode = RuntimeMode.Extension;
}

/**
 * 检测当前运行模式。
 *
 * 检测逻辑：
 * 1. 如果已被 _forceExtensionMode() 强制设置，直接返回 Extension
 * 2. 如果 window !== window.parent 且 window.parent 可访问，说明在 iframe 中 → Userscript
 * 3. 否则 → Extension（主窗口环境）
 */
export function detectRuntimeMode(): RuntimeMode {
    if (_cachedMode !== null) return _cachedMode;

    try {
        // 如果 window.parent 存在且不等于 window，说明在 iframe 中
        if (typeof window.parent !== 'undefined' && window.parent !== window) {
            // 尝试访问 parent 的属性，确认不是跨域 iframe
            void window.parent.document;
            _cachedMode = RuntimeMode.Userscript;
        } else {
            _cachedMode = RuntimeMode.Extension;
        }
    } catch (e) {
        // 跨域 iframe 访问 parent.document 会抛错，这种情况不太可能出现在酒馆环境
        // 保守地认为是油猴脚本模式
        _cachedMode = RuntimeMode.Userscript;
    }

    return _cachedMode;
}

/** 是否为油猴脚本模式 */
export function isUserscriptMode(): boolean {
    return detectRuntimeMode() === RuntimeMode.Userscript;
}

/** 是否为酒馆插件模式 */
export function isExtensionMode(): boolean {
    return detectRuntimeMode() === RuntimeMode.Extension;
}

/**
 * 获取酒馆主窗口引用。
 *
 * - 油猴脚本模式：返回 window.parent（酒馆主窗口）
 * - 插件模式：返回 window（自身就是主窗口）
 */
export function getHostWindow(): Window {
    if (typeof window === 'undefined') {
        return globalThis as any as Window;
    }
    if (isUserscriptMode()) {
        try {
            return window.parent || window;
        } catch (e) {
            return window;
        }
    }
    return window;
}

/**
 * 检查是否已有另一个实例在运行（互斥检测）。
 * 如果已有实例，返回 true（应跳过初始化）。
 * 如果没有，标记当前实例并返回 false。
 */
export function checkAndMarkInstance(): boolean {
    const hostWin = getHostWindow() as any;
    if (hostWin[ACU_INSTANCE_FLAG]) {
        console.warn('[龙血玄黄·数据库] 检测到另一个实例已在运行，跳过初始化。请勿同时安装油猴脚本和酒馆插件。');
        return true; // 已有实例
    }
    hostWin[ACU_INSTANCE_FLAG] = true;
    return false; // 首个实例
}
