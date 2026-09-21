/**
 * presentation/bootstrap/api-groups/worldbook-ai-api.ts
 * 世界书操作 + 正文优化 + AI 调用 API
 */

import { logDebug_ACU, logError_ACU } from '../../../shared/utils';
import { callAIWithPreset_ACU, isApiPresetUnresolvedError_ACU } from '../../../service/ai/api-call';
import { getChatArray_ACU } from '../../../service/chat/chat-service';
import { currentJsonTableData_ACU } from '../../../service/runtime/state-manager';
import { setZeroTkOccupyMode_ACU } from '../../../service/settings/settings-service';
import { deleteAllGeneratedEntries_ACU, updateReadableLorebookEntry_ACU } from '../../../service/worldbook/pipeline';
import { updateOutlineTableEntry_ACU } from '../../../service/worldbook/injection-engine';
import { formatJsonToReadable_ACU } from '../../../service/runtime/helpers-remaining';
import { cancelContentOptimization_ACU } from '../../../service/optimization/content-optimization';
import { reoptimizeMessage_ACU } from '../../components/optimization-ui';
import { refreshMergedDataAndNotifyWithUI_ACU } from '../../components/pipeline-ui-helpers';
import { showToastr_ACU } from '../../theme/toast';
import {
    getWorldbookEntrySkillMeta_ACU,
    listWorldbookSkillMetas_ACU,
} from '../../../service/agent/agent-worldbook-skill-meta';
import type { ApiGroupContext } from './callback-api';

declare const SillyTavern: any;

export function createWorldbookAiApi(_ctx: ApiGroupContext): Record<string, Function> {
    return {
        // 即时同步世界书注入条目
        syncWorldbookEntries: async function({ createIfNeeded = true } = {}) {
            try {
                await updateReadableLorebookEntry_ACU(!!createIfNeeded, false);
                return true;
            } catch (e) {
                logError_ACU('syncWorldbookEntries failed:', e);
                return false;
            }
        },

        // 强制刷新数据并重新注入世界书
        refreshDataAndWorldbook: async function() {
            try {
                await refreshMergedDataAndNotifyWithUI_ACU();
                logDebug_ACU('refreshDataAndWorldbook: Data refreshed and worldbook updated successfully.');
                return true;
            } catch (e) {
                logError_ACU('refreshDataAndWorldbook failed:', e);
                return false;
            }
        },

        reoptimizeMessage: async function(messageIndex: any) {
            try {
                return await reoptimizeMessage_ACU(messageIndex);
            } catch (e) {
                logError_ACU('reoptimizeMessage failed:', e);
                return false;
            }
        },

        cancelContentOptimization: function(reason: any) {
            try {
                const result = cancelContentOptimization_ACU(reason);
                if (result.cancelled) showToastr_ACU('warning', result.reason);
                return result.cancelled;
            } catch (e) {
                logError_ACU('cancelContentOptimization failed:', e);
                return false;
            }
        },

        // 删除注入条目
        deleteInjectedEntries: async function() {
            try {
                await deleteAllGeneratedEntries_ACU();
                return true;
            } catch (e) {
                logError_ACU('deleteInjectedEntries failed:', e);
                return false;
            }
        },

        // 设置 OutlineTable 条目启用状态
        setOutlineEntryEnabled: async function(enabled: any) {
            try {
                const isEnabled = !!enabled;
                setZeroTkOccupyMode_ACU(!isEnabled);
                if (currentJsonTableData_ACU) {
                    const { outlineTable } = formatJsonToReadable_ACU(currentJsonTableData_ACU);
                    await updateOutlineTableEntry_ACU(outlineTable, false);
                }
                return true;
            } catch (e) {
                logError_ACU('setOutlineEntryEnabled failed:', e);
                return false;
            }
        },

        // 设置 0TK占用模式
        setZeroTkOccupyMode: async function(modeEnabled: any) {
            try {
                setZeroTkOccupyMode_ACU(!!modeEnabled);
                if (currentJsonTableData_ACU) {
                    const { outlineTable } = formatJsonToReadable_ACU(currentJsonTableData_ACU);
                    await updateOutlineTableEntry_ACU(outlineTable, false);
                }
                return true;
            } catch (e) {
                logError_ACU('setZeroTkOccupyMode failed:', e);
                return false;
            }
        },

        // 读取指定世界书条目的 Skill 元数据。Skill 存在世界书 comment block 中，外部插件不需要解析内部格式。
        getWorldbookEntrySkillMeta: async function(bookName: any, uid: any) {
            try {
                const normalizedBookName = String(bookName || '').trim();
                if (!normalizedBookName || uid === null || uid === undefined || uid === '') return null;
                return await getWorldbookEntrySkillMeta_ACU(normalizedBookName, uid);
            } catch (e) {
                logError_ACU('getWorldbookEntrySkillMeta failed:', e);
                return null;
            }
        },

        // 批量列出世界书中已保存的 Skill 元数据，便于用户分享世界书后由插件读取。
        listWorldbookSkillMetas: async function(bookNames: any = []) {
            try {
                const names = Array.isArray(bookNames)
                    ? bookNames
                    : String(bookNames || '')
                        .split(/[,，\n]/)
                        .map(name => name.trim())
                        .filter(Boolean);
                return await listWorldbookSkillMetas_ACU(names);
            } catch (e) {
                logError_ACU('listWorldbookSkillMetas failed:', e);
                return [];
            }
        },

        // AI 调用
        callAI: async function(messages: any[], options: any = {}) {
            try {
                if (!Array.isArray(messages) || messages.length === 0) {
                    logError_ACU('callAI: messages must be a non-empty array');
                    return null;
                }

                // 白名单：仅允许 presetName / max_tokens / maxTokens
                const presetName = typeof options.presetName === 'string' ? options.presetName.trim() : '';
                const maxTokensOverride = (options.max_tokens !== undefined || options.maxTokens !== undefined)
                    ? Number(options.max_tokens ?? options.maxTokens)
                    : undefined;

                // 拒绝危险字段：不允许外部传入 apiConfig/apiKey/url/requestHeaders 等
                const forbiddenKeys = ['apiConfig', 'apiKey', 'url', 'requestHeaders', 'bodyParams', 'excludeBodyParams', 'tavernProfile', 'model', 'temperature', 'stream'];
                const passedKeys = Object.keys(options).filter(k => k !== 'presetName' && k !== 'max_tokens' && k !== 'maxTokens');
                const hasForbidden = passedKeys.some(k => forbiddenKeys.includes(k));
                if (hasForbidden) {
                    logError_ACU('callAI: options 包含禁止的配置字段，已拒绝');
                    return null;
                }

                // 委托给 service 层统一入口
                return await callAIWithPreset_ACU(messages, presetName, maxTokensOverride);
            } catch (e) {
                if (isApiPresetUnresolvedError_ACU(e)) throw e;
                // 不打印原始错误对象以避免泄露上游响应正文
                logError_ACU('[callAI] 调用失败，已返回 null');
                return null;
            }
        },

        // 获取最近剧情上下文
        getStoryContext: function(maxTurns = 3) {
            try {
                const chat = getChatArray_ACU();
                if (!Array.isArray(chat) || chat.length === 0) {
                    return '';
                }

                const aiMessages = [];
                let turnCount = 0;

                for (let i = chat.length - 1; i >= 0 && turnCount < maxTurns; i--) {
                    const msg = chat[i];
                    if (msg && !msg.is_user && msg.mes) {
                        aiMessages.unshift(msg.mes);
                        turnCount++;
                    }
                }

                return aiMessages.join('\n\n');
            } catch (e) {
                logError_ACU('getStoryContext failed:', e);
                return '';
            }
        },
    };
}
