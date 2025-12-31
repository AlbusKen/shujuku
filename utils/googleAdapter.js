// utils/googleAdapter.js
// Google API适配器模块
const extensionName = 'quick-response-force';

/**
 * 构建Google API请求
 * @param {Array} messages - 消息数组
 * @param {object} apiSettings - API设置
 * @returns {object} - Google API请求对象
 */
export function buildGoogleRequest(messages, apiSettings) {
  const contents = messages.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));

  return {
    contents,
    safetySettings: [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE',
      },
    ],
    generationConfig: {
      temperature: apiSettings.temperature,
      topP: apiSettings.top_p,
      candidateCount: 1,
      maxOutputTokens: apiSettings.max_tokens,
    },
  };
}

/**
 * 解析Google API响应
 * @param {object} response - Google API响应
 * @returns {object} - 标准化的响应对象
 */
export function parseGoogleResponse(response) {
  try {
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        return { content: candidate.content.parts[0].text };
      }
    }

    if (response.error) {
      return { error: response.error };
    }

    return { error: { message: '无法解析Google API响应' } };
  } catch (error) {
    console.error(`[${extensionName}] 解析Google API响应时出错:`, error);
    return { error: { message: '解析Google API响应失败' } };
  }
}
