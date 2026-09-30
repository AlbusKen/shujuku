/**
 * product-brand — 产品品牌的单一来源。
 * 版本号由 Rollup replace 在构建时从 package.json 注入（globalThis.__ACU_BUILD_VERSION__），
 * 未经构建的运行环境（如单元测试）回退为 'dev'，避免在源码中维护第二份版本号。
 */
export const ACU_PRODUCT_NAME_ACU = '龙血玄黄·数据库';
export const ACU_PRODUCT_SHORT_NAME_ACU = '奶·数据库';
/** 侧栏左上角、移动端抽屉与扩展菜单入口使用的展示名。 */
export const ACU_PRODUCT_DISPLAY_NAME_ACU = `${ACU_PRODUCT_SHORT_NAME_ACU} I`;
export const ACU_PRODUCT_VERSION_ACU: string = (globalThis as any).__ACU_BUILD_VERSION__ || 'dev';
