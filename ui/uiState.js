// 快速响应部队 - UI状态管理
// 由Cline移植并重构

import { extension_settings } from '/scripts/extensions.js';
import { extensionName } from '../utils/settings.js';

/**
 * 将存储中的设置值更新到UI元素上。
 */
export function updateUI() {
    const settings = extension_settings[extensionName];

    // 开关
    $('#qrf_enabled').prop('checked', settings.enabled);
    $('#qrf_optimization_enabled').prop('checked', settings.optimizationEnabled);

    // 文本输入框
    $('#qrf_optimization_target_tag').val(settings.optimizationTargetTag);
    $('#qrf_api_url').val(settings.apiUrl);
    $('#qrf_api_key').val(settings.apiKey);
    $('#qrf_model').val(settings.model);
    
    // 滑块和对应的数值显示
    const sliders = {
        '#qrf_max_tokens': '#qrf_max_tokens_value',
        '#qrf_temperature': '#qrf_temperature_value',
        '#qrf_context_messages': '#qrf_context_messages_value',
    };

    for (const sliderId in sliders) {
        const valueDisplayId = sliders[sliderId];
        const settingKey = sliderId.replace('#qrf_', ''); // e.g., '#qrf_max_tokens' -> 'max_tokens'
        const value = settings[settingKey];

        $(sliderId).val(value);
        $(valueDisplayId).text(value);
    }

    // 提示词文本域
    $('#qrf_main_prompt').val(settings.mainPrompt);
    $('#qrf_system_prompt').val(settings.systemPrompt);
    
    console.log(`[${extensionName}] UI已根据当前设置更新。`);
}
