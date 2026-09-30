import { readFileSync } from 'fs';

/**
 * Rollup 插件：把 png/jpg 以 base64 data URL 内联进产物，userscript 与扩展构建共用。
 */
export default function inlineImageAssets() {
  return {
    name: 'acu-inline-image-assets',
    load(id) {
      if (!/\.(png|jpe?g)$/i.test(id)) return null;
      const mime = /\.png$/i.test(id) ? 'image/png' : 'image/jpeg';
      const base64 = readFileSync(id).toString('base64');
      return `export default ${JSON.stringify(`data:${mime};base64,${base64}`)};`;
    },
  };
}
