// main-popup-table.ts
// 表格标签页 HTML生成
// 聚合：表格模板预设（来自data页） + 世界书注入（来自worldbook页） + 表格工具入口

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU } from '../../shared/template-preset-utils';

/**
 * 生成表格标签页的 HTML 片段
 * 包含：模板预设（全局/当前聊天双作用域）、世界书注入设置、表格工具入口
 */
export function generateTableTabHTML(): string {
    return `
                <div id="acu-tab-table" class="acu-tab-content">
                    <!-- A. 表格模板预设 -->
                    <div class="acu-card">
                        <h3>表格模板预设</h3>
                        <div class="acu-template-presets" style="background: var(--acu-bg-2); padding: 12px; border-radius: 8px;">
                            <div class="acu-data-template-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; align-items: start;">
                                <div style="padding: 16px; background: var(--acu-bg-1); border-radius: 8px; border: 1px solid var(--acu-border); display: flex; flex-direction: column; gap: 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                                        <div>
                                            <div style="font-weight: 600; color: var(--acu-text-1);">全局正在使用</div>
                                            <small id="${SCRIPT_ID_PREFIX_ACU}-template-global-scope-status" class="notes">新聊天会默认继承这里的表格模板</small>
                                        </div>
                                        <span style="padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--accent-primary) 12%, transparent); color: var(--accent-primary); font-size: 12px; font-weight: 600;">全局</span>
                                    </div>
                                    <div class="qrf_settings_block" style="margin-bottom: 0;">
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-template-preset-select" style="font-weight: 500;">全局模板预设</label>
                                        <select id="${SCRIPT_ID_PREFIX_ACU}-template-preset-select" class="text_pole" style="width: 100%; margin-top: 5px;">
                                            <option value="${DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU}">默认预设</option>
                                        </select>
                                    </div>
                                    <div class="acu-template-preset-toolbar" style="display: flex; flex-direction: column; gap: 10px;">
                                        <div class="acu-template-preset-left">
                                            <button id="${SCRIPT_ID_PREFIX_ACU}-import-template" class="acu-mini-btn" title="导入模板到全局模板库，并切换为当前全局模板；已有当前聊天本地预设的聊天不会被自动清除。">
                                                <i class="fa-solid fa-file-import"></i><span>导入</span>
                                            </button>
                                            <button id="${SCRIPT_ID_PREFIX_ACU}-export-template" class="acu-mini-btn" title="导出当前全局模板（优先导出当前选中的全局预设）">
                                                <i class="fa-solid fa-file-export"></i><span>导出</span>
                                            </button>
                                            <button id="${SCRIPT_ID_PREFIX_ACU}-reset-template" class="acu-mini-btn" title="恢复全局默认模板；未做本地保存或导入的聊天会继续跟随全局模板。">
                                                <i class="fa-solid fa-undo"></i><span>恢复默认</span>
                                            </button>
                                        </div>
                                        <div class="acu-template-preset-actions">
                                            <button id="${SCRIPT_ID_PREFIX_ACU}-template-preset-saveas" class="acu-mini-btn" title="将当前运行中的模板另存为新的全局预设">
                                                <i class="fa-solid fa-copy"></i><span>另存为</span>
                                            </button>
                                            <button id="${SCRIPT_ID_PREFIX_ACU}-template-preset-rename" class="acu-mini-btn" title="重命名当前选中的全局预设">
                                                <i class="fa-solid fa-i-cursor"></i><span>重命名</span>
                                            </button>
                                            <button id="${SCRIPT_ID_PREFIX_ACU}-template-preset-delete" class="acu-mini-btn danger" title="删除当前选中的全局预设">
                                                <i class="fa-solid fa-trash"></i><span>删除</span>
                                            </button>
                                        </div>
                                    </div>
                                    <small class="notes">这里仅做全局模板预设库管理（导入 / 导出 / 另存为 / 重命名 / 删除）；需要覆盖保存全局模板时，请使用可视化编辑器顶部的"保存到全局"。</small>
                                </div>
                                <div style="padding: 16px; background: var(--acu-bg-1); border-radius: 8px; border: 1px solid var(--acu-border); display: flex; flex-direction: column; gap: 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                                        <div>
                                            <div style="font-weight: 600; color: var(--acu-text-1);">当前聊天正在使用</div>
                                            <small id="${SCRIPT_ID_PREFIX_ACU}-template-chat-scope-status" class="notes">未做聊天级保存时，这里会直接跟随全局模板</small>
                                        </div>
                                        <span style="padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--acu-success) 14%, transparent); color: var(--acu-success); font-size: 12px; font-weight: 600;">聊天</span>
                                    </div>
                                    <div class="qrf_settings_block" style="margin-bottom: 0;">
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-template-chat-preset-select" style="font-weight: 500;">当前聊天模板预设</label>
                                        <select id="${SCRIPT_ID_PREFIX_ACU}-template-chat-preset-select" class="text_pole" style="width: 100%; margin-top: 5px;">
                                            <option value="${DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU}">默认预设</option>
                                        </select>
                                    </div>
                                    <div class="acu-template-preset-actions">
                                        <button id="${SCRIPT_ID_PREFIX_ACU}-template-chat-import-preset" class="acu-mini-btn" title="导入模板到当前聊天预设列表；同名预设会直接覆盖">
                                            <i class="fa-solid fa-file-import"></i><span>导入到当前聊天</span>
                                        </button>
                                        <button id="${SCRIPT_ID_PREFIX_ACU}-template-chat-export-preset" class="acu-mini-btn" title="导出当前聊天正在使用的模板预设">
                                            <i class="fa-solid fa-download"></i><span>导出当前聊天</span>
                                        </button>
                                    </div>
                                    <input type="file" id="${SCRIPT_ID_PREFIX_ACU}-template-chat-preset-file-input" style="display: none;" accept=".json">
                                    <small id="${SCRIPT_ID_PREFIX_ACU}-template-chat-origin-status" class="notes">这里仅做当前聊天模板预设的导入 / 导出；需要覆盖保存时，请在可视化编辑器中使用"保存到当前聊天"或"保存到全局"。</small>
                                </div>
                            </div>
                        </div>
                        <p class="notes" style="margin-top: 10px;">模板预设分为全局和当前聊天两个作用域。新聊天默认继承全局模板，也可为每个聊天单独配置。</p>
                    </div>

                    <!-- B. 世界书注入（从原worldbook页迁入，不含0TK） -->
                    <div class="acu-card">
                        <h3>世界书注入</h3>
                        <p class="notes">配置数据库条目注入到哪个世界书，以及AI读取上下文时使用哪些世界书。</p>
                        <div>
                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target">数据注入目标:</label>
                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target-filter" placeholder="筛选世界书..." style="width: 100%; margin: 6px 0 8px 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--acu-border-2); background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                            <div class="input-group">
                                <select id="${SCRIPT_ID_PREFIX_ACU}-worldbook-injection-target" style="width: 100%;"></select>
                            </div>
                            <small class="notes">选择数据库条目（如全局、人物、大纲等）将被创建或更新到哪个世界书里。</small>
                        </div>
                        <hr>
                         <div class="qrf_settings_block_radio">
                            <label>世界书来源 (用于AI读取上下文):</label>
                            <div class="qrf_radio_group">
                                <input type="radio" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-source-character" name="${SCRIPT_ID_PREFIX_ACU}-worldbook-source" value="character" checked>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-source-character">角色卡绑定</label>
                                <input type="radio" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-source-manual" name="${SCRIPT_ID_PREFIX_ACU}-worldbook-source" value="manual">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-source-manual">手动选择</label>
                            </div>
                        </div>
                        <div id="${SCRIPT_ID_PREFIX_ACU}-worldbook-manual-select-block" style="display: none; margin-top: 10px;">
                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-select">选择世界书 (可多选):</label>
                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-select-filter" placeholder="筛选世界书..." style="width: 100%; margin: 6px 0 8px 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--acu-border-2); background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                            <div class="input-group">
                                <div id="${SCRIPT_ID_PREFIX_ACU}-worldbook-select" class="qrf_worldbook_list"></div>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-refresh-worldbooks" title="刷新世界书列表">刷新</button>
                            </div>
                        </div>
                        <div style="margin-top: 15px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                <label style="margin-bottom: 0;">启用的世界书条目:</label>
                                <div class="button-group" style="margin: 0;">
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-worldbook-select-all" class="button" style="padding: 2px 8px; font-size: 0.8em;">全选</button>
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-worldbook-deselect-all" class="button" style="padding: 2px 8px; font-size: 0.8em;">全不选</button>
                                </div>
                            </div>
                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-entry-filter" placeholder="筛选条目/世界书..." style="width: 100%; margin: 6px 0 8px 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--acu-border-2); background: var(--acu-control-bg, var(--acu-bg-1)); color: var(--acu-control-text, var(--acu-text-1));">
                            <div id="${SCRIPT_ID_PREFIX_ACU}-worldbook-entry-list" class="qrf_worldbook_entry_list">
                                <!-- 条目将动态加载于此 -->
                            </div>
                        </div>
                        <hr>
                        <div style="margin-top: 15px; padding: 12px; border: 1px solid var(--acu-border-2); border-radius: 8px; background: var(--acu-bg-2);">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
                                <div style="flex: 1 1 280px; min-width: 240px;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-summary-vector-index-mode-enabled" style="font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                        <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-summary-vector-index-mode-enabled" style="width: 14px; height: 14px; cursor: pointer;">
                                        <span>启用向量混合增强交火方案</span>
                                    </label>
                                    <small class="notes">开启后会随纪要表更新自动累积外置向量索引；聊天记录只保存 manifest，向量分片写入 /user/files。下方配置 Embedding、Rerank 与召回参数。</small>
                                </div>
                                <label id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-enabled-toggle-row" style="display: none; align-items: center; gap: 8px; margin: 0; white-space: nowrap;">
                                    <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-enabled">
                                    <span>启用向量记忆</span>
                                </label>
                            </div>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-config-block" style="display: none; margin-top: 12px;">
                                <div class="acu-section" style="margin-bottom: 12px;">
                                    <div class="acu-section-title">交火模式纪要索引参数</div>
                                    <div class="acu-grid-auto">
                                        <input type="hidden" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-threshold">
                                        <input type="hidden" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-archive-trigger-count">
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-summary-index-keyword-min-rows">发送前交火触发阈值</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-summary-index-keyword-min-rows" min="1" step="1" placeholder="100">
                                            <small class="notes">纪要表有效行数达到该值后，发送前会生成关键词并召回概要列 chunk；未达到时保留原概要索引流程。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-topk">最终覆盖 TopK</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-topk" min="1" step="1" placeholder="10">
                                            <small class="notes">Rerank 后选中的纪要数量上限；写入原概要索引条目时会重新按纪要表原始顺序排列。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-min-score">Embedding 预筛最小分数</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-min-score" min="0" max="1" step="0.01" placeholder="0.40">
                                            <small class="notes">发送前先用 query embedding 对纪要 chunk 预筛；Rerank 只会处理通过预筛的候选。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-recall-candidate-limit">预筛候选上限</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-recall-candidate-limit" min="1" step="1" placeholder="1000">
                                            <small class="notes">Embedding 本地预筛后保留的候选数量，也是 Rerank 的最大输入数；不能小于 TopK。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-recent-fixed-inject-count">最近固定注入条数</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-recent-fixed-inject-count" min="0" step="1" placeholder="50">
                                            <small class="notes">最近 X 条纪要固定注入，不参与排序；X 计入触发阈值但不计入 TopK。例如阈值200、X=50，则最近50条固定注入，较早的行参与向量召回。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rolling-delta-enabled" style="display: flex; align-items: center; gap: 8px; cursor: not-allowed;">
                                                <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rolling-delta-enabled" disabled style="width: 14px; height: 14px; cursor: not-allowed;">
                                                <span>滚动增量写入暂不可用</span>
                                            </label>
                                            <small class="notes">因 V2 不可变发布生命周期要求而暂停。历史配置即使开启，归档仍会安全地写入 V2 单文件快照。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rolling-delta-fold-threshold">滚动增量折叠阈值 K</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rolling-delta-fold-threshold" min="1" step="1" placeholder="15" disabled>
                                            <small class="notes">仅保留历史配置兼容；滚动增量恢复 V2 安全发布语义前不生效。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-namespace">索引命名空间前缀</label>
                                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-namespace" placeholder="chat">
                                            <small class="notes">用于区分不同聊天的外置索引缓存；会与当前聊天标识拼接。</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="acu-section" style="margin-bottom: 12px;">
                                    <div class="acu-section-title">Embedding 设置</div>
                                    <div class="acu-grid-auto">
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-embedding-endpoint">Embedding Endpoint</label>
                                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-embedding-endpoint" placeholder="https://example.com/embeddings">
                                            <small class="notes">默认保持留空，避免把特定服务地址硬编码进全局默认配置。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-embedding-model">Embedding Model</label>
                                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-embedding-model" placeholder="text-embedding-3-large">
                                            <small class="notes">默认保持留空；由助手自行填写实际使用的 embedding 模型。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-embedding-api-key">Embedding API Key</label>
                                            <input type="password" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-embedding-api-key" placeholder="留空表示不附带 Authorization">
                                            <small class="notes">敏感信息不写入默认值；需要时再单独配置。</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="acu-section" style="margin-bottom: 12px;">
                                    <div class="acu-section-title">Rerank 设置（可选）</div>
                                    <div class="acu-grid-auto">
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-endpoint">Rerank Endpoint</label>
                                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-endpoint" placeholder="https://example.com/rerank">
                                            <small class="notes">留空则不启用真实 Rerank；仅使用 embedding 预筛 + 本地启发式排序。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-model">Rerank Model</label>
                                            <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-model" placeholder="bge-reranker-v2-m3">
                                            <small class="notes">必须与 Endpoint 同时填写；填写后会对预筛候选做真实重排。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-api-key">Rerank API Key</label>
                                            <input type="password" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-api-key" placeholder="留空表示不附带 Authorization">
                                            <small class="notes">可与 Embedding 使用不同鉴权；若服务不需要鉴权可留空。</small>
                                        </div>
                                        <div class="acu-col-sm" style="grid-column: 1 / -1;">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-instruction">Rerank Instruction（重排指令）</label>
                                            <textarea id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-instruction" rows="3" placeholder="可选：传递给 Rerank API 的 instruction / query 参数，用于引导重排方向。留空则不附带。" style="width: 100%; resize: vertical;"></textarea>
                                            <small class="notes">部分 Rerank 模型支持 instruction 参数（如 bge-reranker-v2-m3）；填写后会作为 query/instruction 字段发送。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-batch-size">Rerank 每批条数</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-rerank-batch-size" min="10" max="500" step="10" placeholder="300">
                                            <small class="notes">候选超过该数时分批并行请求再合并分数；服务商单请求通常限 500 条以内。Rerank 的 document 为纪要正文，候选行不多于 TopK 时自动跳过。</small>
                                        </div>

                                    </div>
                                    <small class="notes" style="display: block; margin-top: 8px;">启用真实 Rerank 后，Embedding 仍负责召回预筛，TopK 仍控制最终注入数量；这三者不是互相替代关系。</small>
                                </div>
                                <div class="acu-section" style="margin-bottom: 12px;">
                                    <div class="acu-section-title">外置索引写入参数</div>
                                    <div class="acu-grid-auto">
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-chunk-chronicle-by-sentence" style="display: flex; align-items: center; gap: 6px;">
                                                <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-chunk-chronicle-by-sentence">
                                                按句切分纪要正文
                                            </label>
                                            <small class="notes">默认关闭：每行一个向量（概览 + 纪要正文整体）。开启后按下方句数切分正文，召回更细但分片成倍增加；改动后需重建索引。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-overview-sentence-limit">分块句数</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-overview-sentence-limit" min="1" step="1" placeholder="2">
                                            <small class="notes">仅在开启按句切分时生效。数值越小召回越精细，但外置分片数量会增加。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-archive-max-concurrency">每批归档行数</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-archive-max-concurrency" min="1" step="1" placeholder="30">
                                            <small class="notes">填表保存完成后会立即归档；多条新增/变更纪要按该数量拆分 embedding 批次。</small>
                                        </div>
                                    </div>
                                    <input type="hidden" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-archive-batch-size">
                                    <input type="hidden" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-archive-without-summary">
                                </div>
                                <div class="acu-section" style="margin-bottom: 0;">
                                    <div class="acu-section-title">关键词生成</div>
                                    <div class="acu-grid-auto">
                                        <div class="acu-col-sm" style="grid-column: 1 / -1;">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-generation-enabled" style="display: flex; align-items: center; gap: 6px;">
                                                <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-generation-enabled" checked>
                                                发送前用 AI 补充检索关键词
                                            </label>
                                            <small class="notes">默认开启。关闭后不再调用关键词 AI，只用用户输入本身做召回，省一次 LLM 往返。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-api-preset">关键词 API 预设</label>
                                            <select id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-api-preset" class="text_pole" style="width: 100%;">
                                                <option value="">使用当前API配置</option>
                                            </select>
                                            <small class="notes">仅用于发送前“关键词生成”阶段；留空则使用当前主 API 配置。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-context-pair-count">关键词上下文读取层数</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-context-pair-count" min="1" step="1" placeholder="1">
                                            <small class="notes">关键词生成时读取的最近对话层数；1 层 = 1 条 AI 回复 + 其上方 1 条用户输入，不再截断。</small>
                                        </div>
                                        <div class="acu-col-sm">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-generation-max-attempts">关键词生成最大尝试次数</label>
                                            <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-generation-max-attempts" min="1" step="1" placeholder="3">
                                            <small class="notes">关键词生成失败时会回退到用户输入本身参与召回，不阻断原始发送。</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="acu-section" style="margin-bottom: 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                                        <div class="acu-section-title" style="margin-bottom: 0;">关键词生成提示词</div>
                                        <div style="display: flex; gap: 6px;">
                                            <button id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-prompt-reset" class="acu-btn-small" style="font-size: 12px;">重置为默认</button>
                                            <button id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-prompt-add" class="acu-btn-small" style="font-size: 12px;">添加段落</button>
                                        </div>
                                    </div>
                                    <small class="notes" style="margin-bottom: 8px; display: block;">可用占位符：$RECENT_CONTEXT（最近上下文）、$USER_INPUT（当前用户输入）。</small>
                                    <div id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-keyword-prompt-group" style="display: flex; flex-direction: column; gap: 8px;"></div>
                                </div>
                                <div id="${SCRIPT_ID_PREFIX_ACU}-worldbook-vector-memory-summary-prompt-group" style="display: none;"></div>
                                <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 6px;">
                                    <small class="notes">交火模式发送前会依次执行：关键词生成（可关闭）→ 用户输入与关键词合并 embedding → "概览 + 纪要正文"向量与 BM25 混合召回 → 可选 Rerank（按纪要正文分批精排）→ 按纪要表原顺序覆盖原概要索引条目。</small>
                                    <small class="notes">IndexedDB 只作为可丢弃缓存；权威向量分片保存在 /user/files，聊天记录只保存 manifest，不再把完整向量塞进聊天记录。</small>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- C. 表格工具入口 -->
                    <div class="acu-card">
                        <h3>表格工具</h3>
                        <div class="button-group" style="margin-top: 0; display: flex; flex-direction: column; gap: 10px;">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-open-new-visualizer" class="primary acu-btn-medium" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;">
                                <i class="fa-solid fa-table-columns"></i> 打开可视化表格编辑器
                            </button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-build-vector-index-now" class="acu-btn-medium" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;">
                                <i class="fa-solid fa-brain"></i> 立即构建交火纪要索引
                            </button>
                        </div>
                        <p class="notes" style="text-align: center; margin-top: 10px;">点击上方按钮打开全新的可视化界面，支持直接编辑数据、修改表头及更新参数。</p>
                        <p class="notes" style="text-align: center; margin-top: 6px;">“立即构建交火纪要索引”会把当前纪要表生成外置向量索引文件；后续纪要增删改会同步更新对应索引分片。</p>
                    </div>
                </div>`;
}
