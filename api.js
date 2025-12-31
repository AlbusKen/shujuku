// api.js
// [重构] 核心API模块，支持“自定义API”和“酒馆预设”两种模式
import { getRequestHeaders } from '/script.js';
import { getContext } from '/scripts/extensions.js';

const extensionName = 'quick-response-force';

/**
 * 统一处理和规范化API响应数据。
 */
function normalizeApiResponse(responseData) {
  let data = responseData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.error(`[${extensionName}] API响应JSON解析失败:`, e);
      return { error: { message: 'Invalid JSON response' } };
    }
  }

  if (data && data.choices && data.choices[0]) {
    return { content: data.choices[0].message?.content?.trim() };
  }
  if (data && data.content) {
    return { content: data.content.trim() };
  }
  if (data && data.models) {
    return { data: data.models };
  }
  if (data && data.data) {
    return { data: data.data };
  }
  if (data && data.error) {
    return { error: data.error };
  }
  return data;
}

/**
 * 主API调用入口，根据设置选择不同的模式
 */
export async function callInterceptionApi(messages, apiSettings, abortSignal = null) {
  // messages 已经在 index.js 中构建完成，直接使用
  // apiSettings 包含API连接配置

  let result;
  try {
    if (apiSettings.apiMode === 'tavern') {
      const profileId = apiSettings.tavernProfile;
      if (!profileId) {
        throw new Error('未选择酒馆连接预设。');
      }

      let originalProfile = '';
      let responsePromise;
      try {
        originalProfile = await window.TavernHelper.triggerSlash('/profile');
        const context = getContext();
        const targetProfile = context.extensionSettings?.connectionManager?.profiles?.find(p => p.id === profileId);

        if (!targetProfile) {
          throw new Error(`无法找到ID为 "${profileId}" 的连接预设。`);
        }

        const targetProfileName = targetProfile.name;
        const currentProfile = await window.TavernHelper.triggerSlash('/profile');

        if (currentProfile !== targetProfileName) {
          const escapedProfileName = targetProfileName.replace(/"/g, '\\"');
          await window.TavernHelper.triggerSlash(`/profile await=true "${escapedProfileName}"`);
        }

        console.log(`[${extensionName}] 通过酒馆连接预设 "${targetProfileName}" 发送请求...`);
        responsePromise = context.ConnectionManagerRequestService.sendRequest(
          profileId,
          messages,
          apiSettings.maxTokens,
          // note: sendRequest signature might not strictly support signal, but if it does later:
          // abortSignal
        );
      } finally {
        // 无论成功或失败，都切换回原始预设
        const currentProfileAfterCall = await window.TavernHelper.triggerSlash('/profile');
        if (originalProfile && originalProfile !== currentProfileAfterCall) {
          const escapedOriginalProfile = originalProfile.replace(/"/g, '\\"');
          await window.TavernHelper.triggerSlash(`/profile await=true "${escapedOriginalProfile}"`);
          console.log(`[${extensionName}] 已恢复原酒馆连接预设: "${originalProfile}"`);
        }
      }
      result = await responsePromise;
    } else {
      // 模式B: 自定义API模式 (包含 useMainApi 逻辑)
      if (apiSettings.useMainApi) {
        // 子模式 B1: 使用主API
        console.log(`[${extensionName}] 通过酒馆主API发送请求...`);
        if (typeof TavernHelper.generateRaw !== 'function') {
          throw new Error('TavernHelper.generateRaw 函数不存在。请检查酒馆版本。');
        }
        const response = await TavernHelper.generateRaw({
          ordered_prompts: messages,
          should_stream: false,
        });
        if (typeof response !== 'string') {
          throw new Error('主API调用未返回预期的文本响应。');
        }
        return response.trim();
      } else {
        // 子模式 B2: 使用独立配置的API (通过后端代理)
        if (!apiSettings.apiUrl || !apiSettings.model) {
          throw new Error('自定义API的URL或模型未配置。');
        }
        console.log(`[${extensionName}] 通过SillyTavern后端代理发送请求...`);
        const requestBody = {
          messages,
          model: apiSettings.model,
          max_tokens: apiSettings.maxTokens,
          temperature: apiSettings.temperature,
          top_p: apiSettings.topP,
          presence_penalty: apiSettings.presencePenalty,
          frequency_penalty: apiSettings.frequencyPenalty,
          stream: false,
          chat_completion_source: 'custom',
          group_names: [],
          include_reasoning: false,
          reasoning_effort: 'medium',
          enable_web_search: false,
          request_images: false,
          custom_prompt_post_processing: 'strict',
          reverse_proxy: apiSettings.apiUrl,
          proxy_password: '',
          custom_url: apiSettings.apiUrl,
          custom_include_headers: apiSettings.apiKey ? `Authorization: Bearer ${apiSettings.apiKey}` : '',
        };
        const response = await fetch('/api/backends/chat-completions/generate', {
          method: 'POST',
          headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: abortSignal,
        });

        if (!response.ok) {
          const errTxt = await response.text();
          throw new Error(`API请求失败: ${response.status} ${errTxt}`);
        }

        const data = await response.json();
        result = normalizeApiResponse(data);
      }
    }

    if (result && result.content) {
      return result.content;
    }

    const errorMessage = result?.error?.message || JSON.stringify(result);
    throw new Error(`API调用返回无效响应: ${errorMessage}`);
  } catch (error) {
    // 用户中止属于正常流程，不弹错误 toast
    if (error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted')) {
      console.log(`[${extensionName}] API调用被用户中止。`);
      return null;
    }
    console.error(`[${extensionName}] API调用失败:`, error);
    toastr.error(`API调用失败: ${error.message}`, '错误');
    return null;
  }
}

/**
 * 获取模型列表
 */
export async function fetchModels(apiSettings) {
  const { apiUrl, apiKey, useMainApi } = apiSettings;

  if (useMainApi) {
    toastr.info('正在使用主API，模型与酒馆主设置同步。', '提示');
    return [];
  }
  if (!apiUrl) {
    toastr.error('API URL 未配置，无法获取模型列表。', '配置错误');
    return null;
  }

  try {
    const response = await fetch('/api/backends/chat-completions/status', {
      method: 'POST',
      headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_completion_source: 'custom',
        reverse_proxy: apiUrl,
        proxy_password: '',
        custom_url: apiUrl,
        custom_include_headers: apiKey ? `Authorization: Bearer ${apiKey}` : '',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API状态检查失败: ${response.status} ${errorText}`);
    }

    const rawResponse = await response.json();
    const result = normalizeApiResponse(rawResponse);
    const models = result.data || [];

    if (result.error || !Array.isArray(models)) {
      const errorMessage = result.error?.message || 'API未返回有效的模型列表数组。';
      throw new Error(errorMessage);
    }

    const sortedModels = models.map(m => m.id || m).sort((a, b) => a.localeCompare(b));
    toastr.success(`成功获取 ${sortedModels.length} 个模型`, '操作成功');
    return sortedModels;
  } catch (error) {
    console.error(`[${extensionName}] 获取模型列表时发生错误:`, error);
    toastr.error(`获取模型列表失败: ${error.message}`, 'API错误');
    return null;
  }
}

/**
 * 测试API连接
 */
export async function testApiConnection(apiSettings) {
  console.log(`[${extensionName}] 开始API连接测试...`);
  const { apiUrl, apiKey, model, useMainApi, apiMode, tavernProfile } = apiSettings;

  try {
    if (apiMode === 'tavern') {
      if (!tavernProfile) {
        throw new Error('请选择一个酒馆连接预设用于测试。');
      }
      let originalProfile = '';
      try {
        originalProfile = await window.TavernHelper.triggerSlash('/profile');
        const context = getContext();
        const profile = context.extensionSettings?.connectionManager?.profiles?.find(p => p.id === tavernProfile);
        if (!profile) {
          throw new Error(`无法找到ID为 "${tavernProfile}" 的连接预设。`);
        }
        const targetProfileName = profile.name;
        const currentProfile = await window.TavernHelper.triggerSlash('/profile');
        if (currentProfile !== targetProfileName) {
          const escapedProfileName = targetProfileName.replace(/"/g, '\\"');
          await window.TavernHelper.triggerSlash(`/profile await=true "${escapedProfileName}"`);
        }
        // 切换成功即可认为连接正常
        toastr.success(`测试成功！已成功切换到预设 "${profile.name}"。`, 'API连接正常');
        return true;
      } finally {
        const currentProfileAfterCall = await window.TavernHelper.triggerSlash('/profile');
        if (originalProfile && originalProfile !== currentProfileAfterCall) {
          const escapedOriginalProfile = originalProfile.replace(/"/g, '\\"');
          await window.TavernHelper.triggerSlash(`/profile await=true "${escapedOriginalProfile}"`);
          console.log(`[${extensionName}] 已恢复原酒馆连接预设: "${originalProfile}"`);
        }
      }
    } else {
      // custom mode
      if (useMainApi) {
        toastr.success('连接成功！正在使用酒馆主API。', 'API连接正常');
        return true;
      }

      if (!apiUrl || !model) {
        throw new Error('请先填写 API URL 并选择一个模型用于测试。');
      }

      const testMessages = [{ role: 'user', content: 'Say "Hi"' }];
      const requestBody = {
        messages: testMessages,
        model: model.replace(/^models\//, ''),
        max_tokens: 5,
        temperature: 0.1,
        stream: false,
        chat_completion_source: 'custom',
        group_names: [],
        include_reasoning: false,
        reasoning_effort: 'medium',
        enable_web_search: false,
        request_images: false,
        custom_prompt_post_processing: 'strict',
        reverse_proxy: apiUrl,
        proxy_password: '',
        custom_url: apiUrl,
        custom_include_headers: apiKey ? `Authorization: Bearer ${apiKey}` : '',
      };

      const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`API请求失败: ${response.status} ${errTxt}`);
      }

      const data = await response.json();
      const result = normalizeApiResponse(data);

      if (result.error) {
        throw new Error(result.error.message || JSON.stringify(result.error));
      }

      if (result.content !== undefined) {
        toastr.success(`测试成功！API返回: "${result.content}"`, 'API连接正常');
        return true;
      } else {
        throw new Error('API响应中未找到有效内容。');
      }
    }
  } catch (error) {
    console.error(`[${extensionName}] API连接测试失败:`, error);
    toastr.error(`测试失败: ${error.message}`, 'API连接失败');
    return false;
  }
}
