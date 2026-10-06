/**
 * service/runtime/template-vars/if-block-parser.ts
 * if 块递归解析器 + 辅助函数（getLatestAIMessageContent / getLatestUserMessageContent / composeSeedMatchContent）
 * 从 helpers-template-vars.ts 拆出
 */
import { logWarn_ACU } from '../../../shared/utils';
import { settings_ACU, currentJsonTableData_ACU } from '../state-manager';
import { getChatArray_ACU } from '../../../data/gateways/chat-gateway';
import { evaluateCellExpression_ACU } from './cell-utils';
import { evaluateSeedExpression_ACU, evaluateCondExpression_ACU } from './seed-condition';
import { evaluateDbCondition, evaluateSqlCondition, replaceVarReferences } from './sql-query-var';
import { getCurrentFlightModeState_ACU } from '../../flight-mode/flight-mode-state';
import { projectFlightModeHiddenChronicleRows_ACU } from '../../flight-mode/flight-mode-hidden-rows';

  /**
   * 解析条件模板（支持 else 和嵌套）
   * 递归解析 <if ...>...</if> 结构，支持 <else> 分支和嵌套条件
   */
  export function parseIfBlockRecursive_ACU(content: string, context: any, depth = 0) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }
    
    const maxDepth = settings_ACU?.promptTemplateSettings?.maxNestingDepth || 10;
    if (depth > maxDepth) {
      logWarn_ACU(`[条件模板] 超过最大嵌套深度 ${maxDepth}，停止解析`);
      return content;
    }
    
    let effectiveContext = context;
    const flightMode = getCurrentFlightModeState_ACU();
    if (flightMode.enabled && flightMode.hiddenRowIds.length > 0 && context?.allTablesJson) {
      try {
        effectiveContext = {
          ...context,
          allTablesJson: projectFlightModeHiddenChronicleRows_ACU(context.allTablesJson, flightMode),
        };
      } catch (error) {
        // 条件模板解析必须保守退化：投影异常时仍按原始表格求值。
        logWarn_ACU('[FlightMode] if 块纪要隐藏行投影失败，已回退为未过滤数据。', error);
      }
    }

    const result = parseIfBlocksInContent_ACU(content, effectiveContext, depth);
    
    return result;
  }

  /**
   * 解析内容中的所有 if 块（支持嵌套）
   */
  export function parseIfBlocksInContent_ACU(content: string, context: any, depth: number) {
    let result = '';
    let currentIndex = 0;
    
    while (currentIndex < content.length) {
      const ifStartMatch = content.slice(currentIndex).match(/<if\s+(seed|cell|cond|db|sql)\s*=\s*"([^"]*)"\s*>/i);
      
      if (!ifStartMatch) {
        result += content.slice(currentIndex);
        break;
      }
      
      const ifStartIndex = currentIndex + ifStartMatch.index;
      result += content.slice(currentIndex, ifStartIndex);
      
      const ifBlock = parseSingleIfBlock_ACU(
        content,
        ifStartIndex,
        ifStartMatch[1],
        ifStartMatch[2],
        context,
        depth
      );
      
      if (ifBlock) {
        result += ifBlock.content;
        currentIndex = ifBlock.endIndex;
      } else {
        result += ifStartMatch[0];
        currentIndex = ifStartIndex + ifStartMatch[0].length;
      }
    }
    
    return result;
  }

  /**
   * 解析单个 if 块（包括 else 分支和嵌套）
   */
  function parseSingleIfBlock_ACU(content: string, startIndex: number, type: string, expression: string, context: any, depth: number) {
    const ifStartMatch = content.slice(startIndex).match(/<if\s+(?:seed|cell|cond|db|sql)\s*=\s*"[^"]*"\s*>/i);
    if (!ifStartMatch) return null;
    
    const ifStartTagEnd = startIndex + ifStartMatch[0].length;
    
    let nestingLevel = 1;
    let currentIndex = ifStartTagEnd;
    
    while (currentIndex < content.length && nestingLevel > 0) {
      const remainingContent = content.slice(currentIndex);
      
      const nestedIfMatch = remainingContent.match(/<if\s+(?:seed|cell|cond|db|sql)\s*=\s*"[^"]*"\s*>/i);
      const endIfMatch = remainingContent.match(/<\/if>/i);
      const elseMatch = remainingContent.match(/<else>/i);
      
      const positions = [];
      if (nestedIfMatch) positions.push({ type: 'if', index: currentIndex + nestedIfMatch.index, length: nestedIfMatch[0].length });
      if (endIfMatch) positions.push({ type: 'endif', index: currentIndex + endIfMatch.index, length: endIfMatch[0].length });
      if (elseMatch && nestingLevel === 1) positions.push({ type: 'else', index: currentIndex + elseMatch.index, length: elseMatch[0].length });
      
      if (positions.length === 0) {
        return null;
      }
      
      positions.sort((a, b) => a.index - b.index);
      const nearest = positions[0];
      
      if (nearest.type === 'if') {
        nestingLevel++;
        currentIndex = nearest.index + nearest.length;
      } else if (nearest.type === 'endif') {
        nestingLevel--;
        if (nestingLevel === 0) {
          const ifBody = content.slice(ifStartTagEnd, nearest.index);
          const endIndex = nearest.index + nearest.length;
          
          let ifContent, elseContent;
          const elseTagMatch = ifBody.match(/<else>/i);
          if (elseTagMatch && elseTagMatch.index !== undefined) {
            ifContent = ifBody.slice(0, elseTagMatch.index);
            elseContent = ifBody.slice(elseTagMatch.index + elseTagMatch[0].length);
          } else {
            ifContent = ifBody;
            elseContent = '';
          }
          
          let conditionMet = false;
          const typeLower = type.toLowerCase();
          
          if (typeLower === 'seed') {
            conditionMet = evaluateSeedExpression_ACU(expression, context.seedContent || '', context.plotContent || '');
          } else if (typeLower === 'cell') {
            conditionMet = evaluateCellExpression_ACU(expression, context.allTablesJson);
          } else if (typeLower === 'cond') {
            conditionMet = evaluateCondExpression_ACU(expression, context);
          } else if (typeLower === 'db') {
            conditionMet = evaluateDbCondition(expression);
          } else if (typeLower === 'sql') {
            conditionMet = evaluateSqlCondition(expression);
          }
          
          const selectedContent = conditionMet ? ifContent : elseContent;
          // 选中分支内容先替换 $v: 变量引用，再递归解析嵌套 <if>
          const withVarsReplaced = replaceVarReferences(selectedContent);
          const processedContent = parseIfBlocksInContent_ACU(withVarsReplaced, context, depth + 1);
          
          return { content: processedContent, endIndex };
        } else {
          currentIndex = nearest.index + nearest.length;
        }
      } else if (nearest.type === 'else') {
        currentIndex = nearest.index + nearest.length;
      }
    }
    
    return null;
  }

  /**
   * 获取最新一条AI消息的正文内容，用于条件模板的 seed 关键词检测
   */
  export function getLatestAIMessageContent_ACU(chatSnapshot?: readonly Record<string, unknown>[]) {
    const chat = chatSnapshot ?? getChatArray_ACU();
    if (!chat || chat.length === 0) {
      return '';
    }

    for (let i = chat.length - 1; i >= 0; i--) {
      const message = chat[i];
      if (message && !message.is_user) {
        return typeof message.mes === 'string' ? message.mes : '';
      }
    }

    return '';
  }

  /**
   * 获取最新一条用户消息的正文。seed 必须能匹配上轮用户输入里的关键词。
   */
  export function getLatestUserMessageContent_ACU(chatSnapshot?: readonly Record<string, unknown>[]) {
    const chat = chatSnapshot ?? getChatArray_ACU();
    if (!chat || chat.length === 0) {
      return '';
    }

    for (let i = chat.length - 1; i >= 0; i--) {
      const message = chat[i];
      if (message && message.is_user) {
        return typeof message.mes === 'string' ? message.mes : '';
      }
    }

    return '';
  }

  /**
   * seed 检索文本：最新用户输入 + 最新 AI 回复。plotContent（$6）由求值函数另行拼接。
   */
  export function composeSeedMatchContent_ACU(userContent: string, aiContent: string) {
    const parts = [userContent, aiContent]
      .filter((part) => typeof part === 'string' && part);
    return parts.join('\n');
  }
