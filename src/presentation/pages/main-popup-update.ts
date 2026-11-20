// main-popup-update.ts
// 更新标签页 HTML生成
// 承接原status页的更新配置 + 原prompt页的更新任务提示词

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { DEFAULT_AUTO_UPDATE_FREQUENCY_ACU, DEFAULT_AUTO_UPDATE_THRESHOLD_ACU, DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU } from '../../shared/defaults';

/**
 * 生成更新标签页的 HTML 片段
 * 包含：基础设置、内容筛选、更新任务提示词
 */
export function generateUpdateTabHTML(): string {
    return `
                <div id="acu-tab-update" class="acu-tab-content">
                    <!-- A. 基础设置 -->
                    <div class="acu-card">
                        <h3>基础设置</h3>
                        <div class="acu-grid-2x2">
                            <div>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-auto-update-threshold">AI读取上下文层数:</label>
                                <div class="input-group">
                                    <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-auto-update-threshold" min="0" step="1" placeholder="${DEFAULT_AUTO_UPDATE_THRESHOLD_ACU}">
                                </div>
                            </div>
                            <div>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-auto-update-frequency">每N层自动更新一次:</label>
                                <div class="input-group">
                                    <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-auto-update-frequency" min="1" step="1" placeholder="${DEFAULT_AUTO_UPDATE_FREQUENCY_ACU}">
                                </div>
                            </div>
                            <div>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-update-batch-size">每批次更新楼层数:</label>
                                <div class="input-group">
                                    <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-update-batch-size" min="1" step="1" placeholder="2">
                                </div>
                            </div>
                            <div>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-max-concurrent-groups">最大并发数:</label>
                                <div class="input-group">
                                    <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-max-concurrent-groups" min="1" step="1" placeholder="1">
                                </div>
                            </div>
                            <div>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-skip-update-floors">保留X层楼不更新:</label>
                                <div class="input-group">
                                    <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-skip-update-floors" min="0" step="1" placeholder="0">
                                </div>
                            </div>
                            <div>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-retain-recent-layers">保留最近N个AI回复楼层数据:</label>
                                <div class="input-group">
                                    <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-retain-recent-layers" min="0" step="1" placeholder="空=全部保留">
                                </div>
                                <div class="notes" style="margin-top:4px;font-size:11px;opacity:0.7;">只按 AI 回复楼层计数；达到保留窗口并经过 20 个 AI 楼层缓冲后滚动建立边界 checkpoint，再清理旧数据</div>
                            </div>
                        </div>
                    </div>

                    <!-- B. 内容筛选 -->
                    <div class="acu-card">
                        <h3>内容筛选</h3>
                        <div class="acu-grid">
                            <div>
                            <label for="${SCRIPT_ID_PREFIX_ACU}-auto-update-token-threshold">剧情回复最小长度:</label>
                                <div class="input-group">
                                <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-auto-update-token-threshold" min="0" step="100" placeholder="${DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU}">
                                </div>
                                <small class="notes" style="font-size: 0.85em; color: #888;">批末剧情回复原始文本字符数（非 token）低于此值时跳过自动填表</small>
                            </div>
                            <div>
                            <label for="${SCRIPT_ID_PREFIX_ACU}-table-max-retries">填表自动重试次数:</label>
                                <div class="input-group">
                                <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-table-max-retries" min="1" max="10" step="1" value="3">
                                </div>
                                <small class="notes" style="font-size: 0.85em; color: #888;">错误或空回时自动重试的次数（默认3次）</small>
                            </div>
                        </div>
                        <p class="notes">当自动更新时，若上下文Token（约等于字符数）低于此值，则跳过本次更新。</p>

                        <hr>

                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <label style="white-space: nowrap; font-size: 0.9em;">正文标签提取规则:</label>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-table-context-extract-rules"></div>
                            <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-table-context-extract-add-rule" class="button" style="align-self: flex-start;">添加规则</button>
                            <small class="notes">每条规则填写开始词和结束词，仅提取最后一组匹配内容（不影响注入词规则）。</small>
                        </div>

                        <hr>

                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <label style="white-space: nowrap; font-size: 0.9em;">标签排除规则:</label>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-table-context-exclude-rules"></div>
                            <button type="button" id="${SCRIPT_ID_PREFIX_ACU}-table-context-exclude-add-rule" class="button" style="align-self: flex-start;">添加规则</button>
                            <small class="notes">每条规则填写开始词与结束词，仅移除最后一组匹配内容。</small>
                        </div>

                        <hr>

                        <div class="checkbox-group">
                            <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-tableedit-last-pair-only-checkbox">
                            <label for="${SCRIPT_ID_PREFIX_ACU}-tableedit-last-pair-only-checkbox">仅识别最后一对 &lt;tableEdit&gt; 标签（忽略前面的思维链/草稿）</label>
                        </div>
                    </div>

                    <!-- C. 更新任务提示词（原prompt页） -->
                    <div class="acu-card">
                        <h3>更新任务提示词</h3>
                        <p class="notes">数据库更新预设的任务指令。这些提示词在每次填表时发送给AI。</p>
                        <div id="${SCRIPT_ID_PREFIX_ACU}-prompt-constructor-area">
                            <div class="button-group" style="margin-bottom: 10px; justify-content: center;"><button class="${SCRIPT_ID_PREFIX_ACU}-add-prompt-segment-btn" data-position="top" title="在上方添加对话轮次">+</button></div>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-prompt-segments-container">
                                <!-- Segments will be dynamically inserted here -->
                            </div>
                            <div class="button-group" style="margin-top: 10px; justify-content: center;"><button class="${SCRIPT_ID_PREFIX_ACU}-add-prompt-segment-btn" data-position="bottom" title="在下方添加对话轮次">+</button></div>
                        </div>
                        <div class="button-group">
                            <button id="${SCRIPT_ID_PREFIX_ACU}-save-char-card-prompt" class="primary">保存</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-load-char-card-prompt-from-json">读取JSON模板</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-export-char-card-prompt-to-json">导出JSON模板</button>
                            <button id="${SCRIPT_ID_PREFIX_ACU}-reset-char-card-prompt">恢复默认</button>
                        </div>
                    </div>
                </div>`;
}
