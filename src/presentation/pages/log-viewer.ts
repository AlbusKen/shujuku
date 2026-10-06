/**
 * presentation/pages/log-viewer.ts
 * 日志查看器标签页 — 实时显示运行日志和报错日志
 *
 * 功能：
 * - 实时显示 logDebug_ACU / logWarn_ACU / logError_ACU 的输出
 * - 按级别（debug/warn/error）过滤
 * - 按模块标签过滤
 * - 关键词搜索
 * - 暂停/恢复实时更新
 * - 清空日志
 * - 导出日志
 */

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { jQuery_API_ACU } from '../dom-utils';
import { $popupInstance_ACU } from '../state/ui-refs';
import {
  type LogEntry,
  type LogLevel,
  getAllLogs,
  getKnownTags,
  clearLogs,
  subscribe,
  getLogCount,
  setDebugLogEnabled,
  isDebugLogEnabled,
  setApiLogEnabled,
  isApiLogEnabled,
} from '../../shared/log-buffer';

// ═══════════════════════════════════════════════════════════════
// 内部状态
// ═══════════════════════════════════════════════════════════════

/** 取消订阅函数（页面关闭时调用） */
let _unsubscribe: (() => void) | null = null;

/** 是否暂停实时更新 */
let _paused = false;

/** 暂停期间积累的日志（恢复时一次性渲染） */
let _pendingEntries: LogEntry[] = [];

/** 当前过滤条件 */
let _filterLevel: LogLevel | 'all' = 'all';
let _filterTag: string = 'all';
let _filterKeyword: string = '';

/** 是否自动滚动到顶部（最新日志在顶部） */
let _autoScroll = true;

/** 批量渲染缓冲（防止高频 DOM 操作） */
let _renderBuffer: LogEntry[] = [];
let _renderRAFId: number | null = null;

/** 日志 tab 是否当前可见（不可见时跳过 DOM 操作） */
let _tabVisible = false;

/** 不可见期间是否有新日志到达（切回时需要全量重绘） */
let _dirtyWhileHidden = false;

// ═══════════════════════════════════════════════════════════════
// HTML 生成
// ═══════════════════════════════════════════════════════════════

/**
 * 生成日志查看器标签页的 HTML 片段
 */
export function generateLogViewerTabHTML(): string {
  return `
    <div id="acu-tab-log-viewer">
      <div class="acu-card">
        <h3><i class="fa-solid fa-scroll" style="margin-right: 6px;"></i>运行日志</h3>
        <p class="notes" style="margin-bottom: 12px;">实时显示所有功能模块的运行日志和报错日志。</p>

        <!-- 过滤控件 -->
        <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center;">
          <!-- 级别过滤 -->
          <select id="${SCRIPT_ID_PREFIX_ACU}-log-level-filter" style="padding: 4px 8px; border: 1px solid var(--border-normal); border-radius: 4px; background: var(--input-background); color: var(--input-text-color); font-size: 0.85em;">
            <option value="all">全部级别</option>
            <option value="api">API 请求</option>
            <option value="debug">🔵 Debug</option>
            <option value="warn">🟡 Warn</option>
            <option value="error">🔴 Error</option>
          </select>

          <!-- 模块过滤 -->
          <select id="${SCRIPT_ID_PREFIX_ACU}-log-tag-filter" style="padding: 4px 8px; border: 1px solid var(--border-normal); border-radius: 4px; background: var(--input-background); color: var(--input-text-color); font-size: 0.85em; max-width: 200px;">
            <option value="all">全部模块</option>
          </select>

          <!-- 关键词搜索 -->
          <input id="${SCRIPT_ID_PREFIX_ACU}-log-search" type="text" placeholder="搜索日志..."
            style="flex: 1; min-width: 150px; padding: 4px 8px; border: 1px solid var(--border-normal); border-radius: 4px; background: var(--input-background); color: var(--input-text-color); font-size: 0.85em;" />
        </div>

        <!-- 操作按钮 -->
        <div style="display: flex; gap: 8px; margin-bottom: 12px; align-items: center;">
          <button id="${SCRIPT_ID_PREFIX_ACU}-log-pause" class="button" style="font-size: 0.85em; padding: 4px 10px;">
            <i class="fa-solid fa-pause"></i> 暂停
          </button>
          <button id="${SCRIPT_ID_PREFIX_ACU}-log-clear" class="button" style="font-size: 0.85em; padding: 4px 10px;">
            <i class="fa-solid fa-trash"></i> 清空
          </button>
          <button id="${SCRIPT_ID_PREFIX_ACU}-log-export" class="button" style="font-size: 0.85em; padding: 4px 10px;">
            <i class="fa-solid fa-download"></i> 导出
          </button>
          <label style="display: flex; align-items: center; gap: 4px; font-size: 0.85em; margin-left: auto; cursor: pointer;">
            <input id="${SCRIPT_ID_PREFIX_ACU}-log-autoscroll" type="checkbox" checked />
            自动滚动
          </label>
          <label style="display: flex; align-items: center; gap: 4px; font-size: 0.85em; cursor: pointer;" title="独立采集 API 请求与回复；分享日志前请检查隐私">
            <input id="${SCRIPT_ID_PREFIX_ACU}-log-api-toggle" type="checkbox" />
            API 请求
          </label>
          <label style="display: flex; align-items: center; gap: 4px; font-size: 0.85em; cursor: pointer;" title="开启后 Debug 级别日志会写入缓冲区（可能影响性能）">
            <input id="${SCRIPT_ID_PREFIX_ACU}-log-debug-toggle" type="checkbox" />
            采集Debug日志
          </label>
          <span id="${SCRIPT_ID_PREFIX_ACU}-log-count" class="notes" style="font-size: 0.8em;"></span>
        </div>

        <!-- 日志列表 -->
        <div id="${SCRIPT_ID_PREFIX_ACU}-log-list"
          style="border: 1px solid var(--border-normal); border-radius: 6px; background: #1a1a2e; min-height: 200px; max-height: 500px; overflow: auto; padding: 0; font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 0.82em; line-height: 1.6;">
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// 事件绑定
// ═══════════════════════════════════════════════════════════════

/**
 * 绑定日志查看器的所有事件
 */
export async function bindLogViewerEvents_ACU(): Promise<void> {
  if (!$popupInstance_ACU) return;

  const $logList = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-list`);
  const $levelFilter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-level-filter`);
  const $tagFilter = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-tag-filter`);
  const $searchInput = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-search`);
  const $pauseBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-pause`);
  const $clearBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-clear`);
  const $exportBtn = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-export`);
  const $autoScrollCheckbox = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-autoscroll`);
  const $debugToggle = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-debug-toggle`);
  const $apiToggle = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-api-toggle`);
  const $logCount = $popupInstance_ACU.find(`#${SCRIPT_ID_PREFIX_ACU}-log-count`);

  // 初始化 debug 开关状态
  $debugToggle.prop('checked', isDebugLogEnabled());
  $apiToggle.prop('checked', isApiLogEnabled());

  // 初始化 tab 可见性
  _tabVisible = false;
  _dirtyWhileHidden = true; // 首次打开时标记为脏，切到日志 tab 时再渲染

  // 订阅新日志
  if (_unsubscribe) _unsubscribe(); // 防止重复订阅
  _unsubscribe = subscribe((entry: LogEntry) => {
    // tab 不可见时跳过所有 DOM 操作，仅标记脏位
    if (!_tabVisible) {
      _dirtyWhileHidden = true;
      return;
    }
    if (_paused) {
      _pendingEntries.push(entry);
      updateLogCount($logCount);
      return;
    }
    // 批量渲染：收集到缓冲区，用 rAF 合并渲染
    _renderBuffer.push(entry);
    if (_renderRAFId === null) {
      _renderRAFId = requestAnimationFrame(() => {
        flushRenderBuffer($logList);
        updateLogCount($logCount);
        refreshTagFilter($tagFilter);
        _renderRAFId = null;
      });
    }
  });

  // tab 切换时的可见性管理
  // 日志查看器现在嵌入在"高级工具"tab的子tab中
  // 需要同时监听顶级tab切换和子tab切换
  if ($popupInstance_ACU) {
    // 检查日志子tab是否当前可见
    function isLogSubtabActive(): boolean {
      const $advancedActive = $popupInstance_ACU!.find('.acu-tab-button.active');
      const isAdvancedTab = $advancedActive.length && $advancedActive.data('tab') === 'advanced';
      if (!isAdvancedTab) return false;
      const $activeSubtab = $popupInstance_ACU!.find('#acu-tab-advanced .acu-subtab-button.active');
      return $activeSubtab.length && $activeSubtab.data('subtab') === 'advanced-log';
    }

    // 监听顶级tab切换
    $popupInstance_ACU.find('.acu-tab-button').on('click.acuLogViewer', function() {
      const wasVisible = _tabVisible;
      _tabVisible = isLogSubtabActive();
      if (_tabVisible && !wasVisible && _dirtyWhileHidden) {
        _dirtyWhileHidden = false;
        renderAllLogs($logList);
        updateLogCount($logCount);
        refreshTagFilter($tagFilter);
      }
    });
    // 监听子tab切换
    $popupInstance_ACU.find('.acu-subtab-button').on('click.acuLogViewer', function() {
      const wasVisible = _tabVisible;
      _tabVisible = isLogSubtabActive();
      if (_tabVisible && !wasVisible && _dirtyWhileHidden) {
        _dirtyWhileHidden = false;
        renderAllLogs($logList);
        updateLogCount($logCount);
        refreshTagFilter($tagFilter);
      }
    });
    // 初始检查
    if (isLogSubtabActive()) {
      _tabVisible = true;
      _dirtyWhileHidden = false;
      renderAllLogs($logList);
      updateLogCount($logCount);
      refreshTagFilter($tagFilter);
    }
  }

  // 级别过滤
  $levelFilter.on('change', function() {
    _filterLevel = jQuery_API_ACU(this).val() as LogLevel | 'all';
    renderAllLogs($logList);
  });

  // 模块过滤
  $tagFilter.on('change', function() {
    _filterTag = String(jQuery_API_ACU(this).val() || 'all');
    renderAllLogs($logList);
  });

  // 关键词搜索（防抖 300ms）
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  $searchInput.on('input', function() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _filterKeyword = String(jQuery_API_ACU($searchInput).val() || '').toLowerCase();
      renderAllLogs($logList);
    }, 300);
  });

  // 暂停/恢复
  $pauseBtn.on('click', function() {
    _paused = !_paused;
    if (_paused) {
      jQuery_API_ACU(this).html('<i class="fa-solid fa-play"></i> 恢复');
    } else {
      jQuery_API_ACU(this).html('<i class="fa-solid fa-pause"></i> 暂停');
      // 恢复时渲染暂停期间积累的日志（最新的插入到顶部）
      if (_pendingEntries.length > 0) {
        for (let i = _pendingEntries.length - 1; i >= 0; i--) {
          prependLogEntry($logList, _pendingEntries[i]);
        }
        _pendingEntries = [];
        scrollToTop($logList);
      }
    }
  });

  // 清空
  $clearBtn.on('click', function() {
    clearLogs();
    _pendingEntries = [];
    $logList.empty();
    updateLogCount($logCount);
  });

  // 导出
  $exportBtn.on('click', function() {
    exportLogs();
  });

  // 自动滚动
  $autoScrollCheckbox.on('change', function() {
    _autoScroll = jQuery_API_ACU(this).prop('checked');
  });

  // API 请求与 Debug 分开采集。
  $apiToggle.on('change', function() {
    setApiLogEnabled(!!jQuery_API_ACU(this).prop('checked'));
  });

  // Debug 日志采集开关
  $debugToggle.on('change', function() {
    const enabled = jQuery_API_ACU(this).prop('checked');
    setDebugLogEnabled(enabled);
  });
}

// ═══════════════════════════════════════════════════════════════
// 渲染函数
// ═══════════════════════════════════════════════════════════════

/** 级别对应的颜色和图标 */
const LEVEL_STYLES: Record<LogLevel, { color: string; icon: string; bg: string }> = {
  api:   { color: '#a6e3a1', icon: '', bg: 'transparent' },
  debug: { color: '#89b4fa', icon: '🔵', bg: 'transparent' },
  warn:  { color: '#f9e2af', icon: '🟡', bg: 'rgba(249, 226, 175, 0.05)' },
  error: { color: '#f38ba8', icon: '🔴', bg: 'rgba(243, 139, 168, 0.08)' },
};

/**
 * 判断日志条目是否匹配当前过滤条件
 */
function matchesFilter(entry: LogEntry): boolean {
  if (_filterLevel !== 'all' && entry.level !== _filterLevel) return false;
  if (_filterTag !== 'all' && entry.tag !== _filterTag) return false;
  if (_filterKeyword && !entry.message.toLowerCase().includes(_filterKeyword)) return false;
  return true;
}

/**
 * 渲染单条日志为 HTML
 */
function renderLogEntryHTML(entry: LogEntry): string {
  const style = LEVEL_STYLES[entry.level];
  const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const ms = String(entry.timestamp % 1000).padStart(3, '0');
  const timeStr = `${time}.${ms}`;
  const levelBadge = `<span style="color: ${style.color}; font-weight: 600; min-width: 42px; display: inline-block;">${entry.level.toUpperCase()}</span>`;
  const tagBadge = entry.tag !== '未分类'
    ? `<span style="color: #cba6f7; background: rgba(203, 166, 247, 0.1); padding: 0 4px; border-radius: 3px; font-size: 0.9em;">${escapeHtml_ACU(entry.tag)}</span>`
    : '';
  const message = escapeHtml_ACU(entry.message);

  return `<div style="padding: 2px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); background: ${style.bg}; display: flex; gap: 8px; align-items: flex-start; word-break: break-all;" data-log-id="${entry.id}" data-log-level="${entry.level}" data-log-tag="${escapeHtml_ACU(entry.tag)}"><span style="color: #6c7086; white-space: nowrap; flex-shrink: 0;">${timeStr}</span>${levelBadge}${tagBadge}<span style="color: #cdd6f4; flex: 1;">${message}</span></div>`;
}

/**
 * 渲染所有日志（全量重绘，用于过滤条件变化时）
 * 最新日志显示在最上面（倒序）
 */
function renderAllLogs($logList: any): void {
  const allLogs = getAllLogs();
  const filtered = allLogs.filter(matchesFilter);
  // 倒序：最新的在最上面
  const reversed = filtered.slice().reverse();
  const html = reversed.map(renderLogEntryHTML).join('');
  $logList.html(html);
  scrollToTop($logList);
}

/**
 * 在列表顶部插入单条日志（增量渲染，最新在最上面）
 */
function prependLogEntry($logList: any, entry: LogEntry): void {
  if (!matchesFilter(entry)) return;
  const html = renderLogEntryHTML(entry);
  $logList.prepend(html);
}

/**
 * 刷新渲染缓冲区（批量插入到顶部）
 */
function flushRenderBuffer($logList: any): void {
  if (_renderBuffer.length === 0) return;
  const entries = _renderBuffer.splice(0);
  // 新日志插入到顶部，最新的排最前
  let html = '';
  for (let i = entries.length - 1; i >= 0; i--) {
    if (matchesFilter(entries[i])) {
      html += renderLogEntryHTML(entries[i]);
    }
  }
  if (html) {
    $logList.prepend(html);
    scrollToTop($logList);
  }
}

/**
 * 滚动到顶部（最新日志在顶部）
 */
function scrollToTop($logList: any): void {
  if (!_autoScroll) return;
  const el = $logList[0];
  if (el) {
    el.scrollTop = 0;
  }
}

/**
 * 更新日志计数显示
 */
function updateLogCount($logCount: any): void {
  const total = getLogCount();
  const pending = _pendingEntries.length;
  const text = _paused && pending > 0
    ? `共 ${total} 条（${pending} 条待显示）`
    : `共 ${total} 条`;
  $logCount.text(text);
}

/**
 * 刷新模块标签过滤器的选项
 */
function refreshTagFilter($tagFilter: any): void {
  const tags = getKnownTags();
  const currentVal = String($tagFilter.val() || 'all');
  let options = '<option value="all">全部模块</option>';
  for (const tag of tags) {
    const selected = tag === currentVal ? ' selected' : '';
    options += `<option value="${escapeHtml_ACU(tag)}"${selected}>${escapeHtml_ACU(tag)}</option>`;
  }
  $tagFilter.html(options);
  // 恢复之前的选择
  if (currentVal !== 'all' && tags.includes(currentVal)) {
    $tagFilter.val(currentVal);
  }
}

/**
 * 导出日志为 JSON 文件
 */
function exportLogs(): void {
  const allLogs = getAllLogs();
  const filtered = allLogs.filter(matchesFilter);
  const exportData = filtered.map(entry => ({
    time: new Date(entry.timestamp).toISOString(),
    level: entry.level,
    tag: entry.tag,
    message: entry.message,
  }));

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `acu-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// 清理函数（弹窗关闭时调用）
// ═══════════════════════════════════════════════════════════════

/**
 * 清理日志查看器资源（取消订阅、清空缓冲区）
 * 必须在弹窗关闭时调用，否则订阅者回调会持续操作已销毁的 DOM
 */
export function cleanupLogViewer_ACU(): void {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  if (_renderRAFId !== null) {
    cancelAnimationFrame(_renderRAFId);
    _renderRAFId = null;
  }
  _renderBuffer = [];
  _pendingEntries = [];
  _tabVisible = false;
  _dirtyWhileHidden = false;
  _paused = false;
}
