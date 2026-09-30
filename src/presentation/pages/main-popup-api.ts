// main-popup-api.ts
// API标签页（API & 连接）HTML生成

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';

/**
 * 生成 API 标签页的 HTML 片段
 */
export function generateApiTabHTML(): string {
    return `
                <div id="acu-tab-api" class="acu-tab-content">
                     <div class="acu-card">
                        <h3>API设置</h3>
                        <div class="qrf_settings_block_radio">
                            <label>API模式:</label>
                            <div class="qrf_radio_group">
                                <input type="radio" id="${SCRIPT_ID_PREFIX_ACU}-api-mode-custom" name="${SCRIPT_ID_PREFIX_ACU}-api-mode" value="custom" checked>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-mode-custom">自定义API</label>
                                <input type="radio" id="${SCRIPT_ID_PREFIX_ACU}-api-mode-tavern" name="${SCRIPT_ID_PREFIX_ACU}-api-mode" value="tavern">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-mode-tavern">使用酒馆连接预设</label>
                            </div>
                        </div>

                        <div id="${SCRIPT_ID_PREFIX_ACU}-tavern-api-profile-block" style="display: none; margin-top: 12px;">
                            <label for="${SCRIPT_ID_PREFIX_ACU}-tavern-api-profile-select">酒馆连接预设:</label>
                             <div class="input-group">
                                <select id="${SCRIPT_ID_PREFIX_ACU}-tavern-api-profile-select"></select>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-refresh-tavern-api-profiles" title="刷新预设列表">刷新</button>
                            </div>
                            <small class="notes">选择一个你在酒馆主设置中已经配置好的连接预设。</small>
                        </div>

                        <div id="${SCRIPT_ID_PREFIX_ACU}-custom-api-settings-block" style="margin-top: 12px;">
                             <div class="checkbox-group">
                                <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-use-main-api-checkbox">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-use-main-api-checkbox">使用主API (直接使用酒馆当前API和模型)</label>
                            </div>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-custom-api-fields">
                                <p class="notes" style="color: var(--acu-warning);"><b>安全提示:</b> API密钥将保存在浏览器本地存储中。</p>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-url">API基础URL:</label>
                                <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-api-url">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-key">API密钥(可选):</label>
                                <input type="password" id="${SCRIPT_ID_PREFIX_ACU}-api-key">
                                <div class="acu-grid" style="margin-top: 10px;">
                                    <div>
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-max-tokens">最大Tokens:</label>
                                        <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-max-tokens" min="1" step="1" placeholder="120000">
                                    </div>
                                    <div>
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-temperature">温度:</label>
                                        <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-temperature" min="0" max="2" step="0.05" placeholder="0.9">
                                    </div>
                                </div>
                                <div class="button-group" style="margin-top: 10px;">
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-load-models">加载模型列表</button>
                                </div>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-model-input" style="margin-top: 10px;">模型名称 (手动输入):</label>
                                <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-api-model-input" class="text_pole" placeholder="输入模型名称或从下方选择">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-model-select" style="margin-top: 8px;">或从列表选择:</label>
                                <select id="${SCRIPT_ID_PREFIX_ACU}-api-model-select" class="text_pole">
                                    <option value="">-- 请先加载模型列表 --</option>
                                </select>
                                <div style="margin-top: 12px;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-api-body-params">附加 Body 参数 (JSON):</label>
                                    <textarea id="${SCRIPT_ID_PREFIX_ACU}-api-body-params" rows="3" placeholder='{"top_p": 0.9, "frequency_penalty": 0.5}' style="width: 100%; resize: vertical; font-family: monospace;"></textarea>
                                    <small class="notes">JSON 格式，会合并到请求 body 中（覆盖同名字段）。留空不附加。</small>
                                </div>
                                <div style="margin-top: 8px;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-api-exclude-body-params">排除 Body 参数:</label>
                                    <textarea id="${SCRIPT_ID_PREFIX_ACU}-api-exclude-body-params" rows="2" placeholder='["stream", "top_p"]' style="width: 100%; resize: vertical; font-family: monospace;"></textarea>
                                    <small class="notes">JSON 数组格式，列出的字段会从请求 body 中移除。留空不排除。</small>
                                </div>
                                <div style="margin-top: 8px;">
                                    <label for="${SCRIPT_ID_PREFIX_ACU}-api-request-headers">附加请求头 (JSON):</label>
                                    <textarea id="${SCRIPT_ID_PREFIX_ACU}-api-request-headers" rows="2" placeholder='{"X-Custom-Header": "value"}' style="width: 100%; resize: vertical; font-family: monospace;"></textarea>
                                    <small class="notes">JSON 格式，会合并到请求 headers 中。留空不附加。</small>
                                </div>
                            </div>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-api-status" class="notes" style="margin-top:12px;">状态: 未配置</div>
                            <div class="button-group">
                                <button id="${SCRIPT_ID_PREFIX_ACU}-save-config" class="primary">保存API</button>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-clear-config">清除API</button>
                            </div>
                            
                            <!-- API预设管理 -->
                            <div class="acu-divider-dashed" style="margin: 16px 0 12px 0;"></div>
                            <label class="acu-label">API预设管理</label>
                            <div class="acu-row" style="margin-bottom: 8px;">
                                <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-api-preset-name" placeholder="预设名称" style="flex: 1;">
                                <button id="${SCRIPT_ID_PREFIX_ACU}-save-api-preset" class="primary">保存为预设</button>
                            </div>
                            <div class="acu-row">
                                <select id="${SCRIPT_ID_PREFIX_ACU}-api-preset-select" style="flex: 1;">
                                    <option value="">-- 选择预设 --</option>
                                </select>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-load-api-preset">加载</button>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-delete-api-preset" style="background: var(--acu-danger); color: white; border-color: var(--acu-danger);">删除</button>
                            </div>
                            <small class="notes">保存当前API配置为预设，可在填表和剧情推进中分别选用。</small>
                        </div>
                     </div>
                 </div>`;
}
