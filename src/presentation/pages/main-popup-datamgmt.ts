// main-popup-datamgmt.ts
// 数据管理标签页 HTML生成
// 承接原data页的数据隔离、删除清理、备份恢复、Medusa合并

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';

/**
 * 生成数据管理标签页的 HTML 片段
 * 包含：数据隔离、删除与清理、备份与恢复、纪要合并(Medusa)
 */
export function generateDataMgmtTabHTML(): string {
    return `
                <div id="acu-tab-datamgmt" class="acu-tab-content">
                    <!-- A. 数据隔离（已退役：留空即默认槽 ''，新功能禁止再按 isolationKey 真值做门禁） -->
                    <div class="acu-card">
                        <h3>数据隔离 <span style="font-size: 0.75em; font-weight: 400; color: var(--acu-text-3);">（已退役）</span></h3>
                        <p class="notes">标签隔离已停用。留空使用默认数据槽。请勿再为新功能依赖隔离码；空标识是合法默认槽，不是“没有数据”。</p>
                        <div class="setting-item" style="margin-bottom: 15px; border-bottom: 1px dashed var(--acu-border-2); padding-bottom: 15px;">
                            <div id="${SCRIPT_ID_PREFIX_ACU}-data-isolation-input-area" style="margin-top: 10px;">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-data-isolation-code">标识代码:</label>
                                <div class="acu-data-isolation-row" style="display: flex; gap: 10px; margin-top: 5px; align-items: flex-start;">
                                    <div id="${SCRIPT_ID_PREFIX_ACU}-data-isolation-combo" style="position: relative; flex-grow: 1; display: flex; align-items: center;">
                                        <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-data-isolation-code" placeholder="输入标识代码 (留空则不隔离)" style="flex-grow: 1; padding-right: 36px;">
                                        <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-data-isolation-history-toggle" title="历史标识代码" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); border: 1px solid var(--acu-border-2); background: var(--acu-bg-1); color: var(--acu-text-1); padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 12px; line-height: 1;">▼</button>
                                        <ul id="${SCRIPT_ID_PREFIX_ACU}-data-isolation-history-list" style="display: none; position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: var(--acu-bg-0); border: 1px solid var(--acu-border-2); border-radius: 6px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18); list-style: none; margin: 0; padding: 6px 0; max-height: 220px; overflow-y: auto; z-index: 9999;"></ul>
                                    </div>
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-data-isolation-save" class="primary" style="white-space: nowrap;">保存并应用</button>
                                </div>
                                <p class="notes" style="margin-top: 5px;">输入代码并点击保存后，将重新载入对应的本地数据。</p>
                            </div>
                            <div style="margin-top: 10px; text-align: right;">
                        <button id="${SCRIPT_ID_PREFIX_ACU}-data-isolation-delete-entries" class="btn-danger" style="padding: 5px 10px; border-radius: 4px; font-size: 0.9em;">删除当前标识的注入条目</button>
                            </div>
                        </div>
                    </div>

                    <!-- B. 备份与恢复 -->
                    <div class="acu-card">
                        <h3>备份与恢复</h3>
                        <p class="notes">导入/导出当前对话的数据库，或管理全局模板。</p>
                        <div class="button-group acu-data-mgmt-buttons">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-import-combined-settings" class="primary">合并导入(模板+指令)</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-export-combined-settings" class="primary">合并导出(模板+指令)</button>
                        </div>
                        <hr style="border-color: var(--acu-border-2); margin: 15px 0;">
                        <div class="button-group acu-data-mgmt-buttons">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-export-json-data">导出JSON数据</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-reset-all-defaults" class="btn-warning">恢复默认模板及提示词</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-override-with-template" class="btn-danger">模板覆盖最新层数据</button>
                        </div>
                    </div>

                    <!-- C. 删除与清理 -->
                    <div class="acu-card">
                        <h3>删除与清理</h3>
                        <!-- 楼层范围选择 -->
                        <div style="background: var(--acu-bg-2); padding: 12px; border-radius: 6px; margin-bottom: 10px;">
                            <h4 style="margin: 0 0 8px 0; font-size: 0.9em; color: var(--acu-text-1); font-weight: 500;">删除范围设置</h4>
                            <div class="acu-grid">
                                <div>
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-delete-start-floor" style="font-weight: 500; font-size: 0.85em;">起始AI楼层:</label>
                                    <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-delete-start-floor" min="1" value="1" placeholder="1" style="width: 100%; padding: 4px 8px; border: 1px solid var(--acu-border-2); border-radius: 4px; background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                                </div>
                                <div>
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-delete-end-floor" style="font-weight: 500; font-size: 0.85em;">终止AI楼层:</label>
                                    <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-delete-end-floor" min="1" placeholder="留空删除到最后" style="width: 100%; padding: 4px 8px; border: 1px solid var(--acu-border-2); border-radius: 4px; background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                                </div>
                            </div>
                            <div style="margin-top: 6px; font-size: 0.8em; color: var(--acu-text-3);">
                                默认全选所有AI楼层，可设置范围精确删除（只计算AI回复）。楼层范围同时作用于两个删除按钮；「删除所有本地数据」仅在范围覆盖全部 AI 楼层时执行完全清空。
                            </div>
                        </div>

                        <div class="button-group acu-data-mgmt-buttons">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-delete-current-local-data" class="btn-warning">删除当前标识本地数据</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-delete-all-local-data" class="btn-danger">删除所有本地数据 (慎用)</button>
                        </div>
                    </div>

                    <!-- D. 交火模式索引管理 -->
                    <div class="acu-card">
                        <h3>交火模式索引管理</h3>
                        <p class="notes">聊天记录只保存轻量 manifest；向量分片保存在 /user/files，IndexedDB 只作为可丢弃临时缓存。</p>
                        <div id="${SCRIPT_ID_PREFIX_ACU}-vector-index-stats" style="background: var(--acu-bg-2); padding: 12px; border-radius: 6px; margin-bottom: 10px; font-size: 0.9em; line-height: 1.7;">
                            <div>状态：<span data-acu-vector-index-field="status">未加载</span></div>
                            <div>索引ID：<span data-acu-vector-index-field="indexId">-</span></div>
                            <div>后端：<span data-acu-vector-index-field="backend">-</span></div>
                            <div>行 / 块：<span data-acu-vector-index-field="rowsChunks">0 / 0</span></div>
                            <div>Base / Delta 分片：<span data-acu-vector-index-field="shards">0 / 0</span></div>
                            <div>Tombstone 行 / 块：<span data-acu-vector-index-field="tombstones">0 / 0</span></div>
                            <div>当前外置快照体积：<span data-acu-vector-index-field="externalBytes">0 B</span></div>
                            <div>当前索引临时缓存体积：<span data-acu-vector-index-field="cacheBytes">0 B</span></div>
                            <div>防抖归档队列：<span data-acu-vector-index-field="flushQueue">0 pending / 0 failed</span></div>
                            <div>防抖归档错误：<span data-acu-vector-index-field="flushError">-</span></div>
                            <div>更新时间：<span data-acu-vector-index-field="updatedAt">-</span></div>
                        </div>
                        <div class="button-group acu-data-mgmt-buttons">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-vector-index-refresh">刷新索引状态</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-vector-index-migrate-legacy">非破坏迁移旧索引</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-vector-index-clear-cache" class="btn-warning">清空临时缓存</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-vector-index-delete-current" class="btn-danger">删除当前交火索引</button>
                        </div>
                    </div>

                </div>`;
}
