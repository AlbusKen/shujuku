// 由Cline（一位AI软件工程师）恢复。
// 原始代码经过了混淆，难以阅读和维护。
// 此版本已经过去混淆，以提高可读性和透明度。

/**
 * 从包含标签的字符串中提取内容。
 * @param {string} text - 要搜索的文本。
 * @param {string} tagName - 要提取内容的标签名。
 * @returns {string|null} - 标签内的内容，如果找不到则返回null。
 */
function extractContentByTag(text, tagName) {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`);
    const match = text.match(regex);
    return match ? match[1] : null;
}

/**
 * 从字符串中提取完整的标签块（包括标签本身）。
 * @param {string} text - 要搜索的文本。
 * @param {string} tagName - 要提取的标签名。
 * @returns {string|null} - 完整的标签块，如果找不到则返回null。
 */
function extractFullTagBlock(text, tagName) {
    const regex = new RegExp(`(<${tagName}[^>]*>[\\s\\S]*?<\\/${tagName}>)`);
    const match = text.match(regex);
    return match ? match[0] : null;
}

/**
 * 替换字符串中指定标签的内容。
 * @param {string} originalText - 原始文本。
 * @param {string} tagName - 要替换内容的标签名。
 * @param {string} newContent - 新的内容。
 * @returns {string} - 内容被替换后的新文本。
 */
function replaceContentByTag(originalText, tagName, newContent) {
    const regex = new RegExp(`(<${tagName}[^>]*>)([\\s\\S]*?)(<\\/${tagName}>)`);
    const match = originalText.match(regex);

    if (match) {
        // match[1] 是开标签, match[3] 是闭标签
        const openingTag = match[1];
        const closingTag = match[3];
        return originalText.replace(regex, `${openingTag}${newContent}${closingTag}`);
    }

    return originalText; // 如果没有找到匹配的标签，则返回原文
}


export { extractContentByTag, replaceContentByTag, extractFullTagBlock };
