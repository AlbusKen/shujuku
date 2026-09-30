import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import vuePlugin from 'unplugin-vue/rollup';
import sfcStyleInjector from './src/presentation-v2/build/rollup-sfc-style-injector.js';
import vueScriptTranspiler from './src/presentation-v2/build/rollup-vue-script-transpiler.js';
import inlineImageAssets from './src/presentation-v2/build/rollup-inline-image-assets.js';
import { copyFileSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ACU_SQLITE_ENGINE, SQL_WASM_IMPORT_ID, SQL_WASM_BASE64, SQL_WASM_BASE64_GLOBAL, copySqlWasmTo } from './scripts/sql-wasm-assets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_VERSION = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version;
const ACU_BUILD_VERSION = process.env.ACU_BUILD_VERSION || PACKAGE_VERSION;

function createTsPlugin() {
  return typescript({
    tsconfig: './tsconfig.json',
    compilerOptions: {
      noEmit: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      outDir: 'dist/plus-assistantembedded',
    },
    include: ['src/**/*.ts', 'src/**/*.js'],
  });
}

function createVuePlugin() {
  return vuePlugin({
    isProduction: true,
    root: process.cwd(),
    sourceMap: false,
    inlineTemplate: false,
  });
}

function createReplacePlugin() {
  // wasm 引擎：把 sql-wasm.wasm 的 base64 内联进产物（源码读 globalThis.__ACU_SQLITE_WASM_BASE64__）。
  const sqlWasmBase64Value = SQL_WASM_BASE64
    ? `${SQL_WASM_BASE64_GLOBAL} = ${JSON.stringify(SQL_WASM_BASE64)};`
    : `${SQL_WASM_BASE64_GLOBAL} = '';`;
  return replace({
    preventAssignment: true,
    values: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'globalThis.__ACU_BUILD_VERSION__': JSON.stringify(ACU_BUILD_VERSION),
      'globalThis.__ACU_SQLITE_ENGINE__': JSON.stringify(ACU_SQLITE_ENGINE),
      [SQL_WASM_BASE64_GLOBAL]: sqlWasmBase64Value,
      '__ACU_SQLITE_ENGINE_IMPORT__': SQL_WASM_IMPORT_ID,
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
  });
}

const config = {
  input: 'src/entry-extension-plus-assistantembedded.ts',
  output: {
    file: 'dist/plus-assistantembedded/index.js',
    format: 'es',
    sourcemap: false,
  },
  treeshake: false,
  plugins: [
    {
      name: 'node-builtins-shim',
      resolveId(source) {
        if (source === 'fs' || source === 'node:fs') {
          return { id: '\0shim:fs', moduleSideEffects: false };
        }
        if (source === 'crypto' || source === 'node:crypto') {
          return { id: '\0shim:crypto', moduleSideEffects: false };
        }
        return null;
      },
      load(id) {
        if (id === '\0shim:fs') {
          return 'export default {}; export const readFileSync = () => null;';
        }
        if (id === '\0shim:crypto') {
          return 'export default {}; export const randomFillSync = (buf) => { for(let i=0;i<buf.length;i++) buf[i]=Math.random()*256|0; return buf; };';
        }
        return null;
      },
    },
    createVuePlugin(),
    vueScriptTranspiler(),
    sfcStyleInjector(),
    inlineImageAssets(),
    nodeResolve({
      browser: true,
      preferBuiltins: false,
      extensions: ['.mjs', '.js', '.json', '.ts', '.vue'],
    }),
    commonjs(),
    createTsPlugin(),
    createReplacePlugin(),
    {
      name: 'copy-plus-assistantembedded-manifest',
      writeBundle() {
        try {
          mkdirSync(join(__dirname, 'dist', 'plus-assistantembedded'), { recursive: true });
          copyFileSync(
            join(__dirname, 'manifest.plus-assistantembedded.json'),
            join(__dirname, 'dist', 'plus-assistantembedded', 'manifest.json'),
          );
        } catch (e) {
          console.warn('复制 plus-assistantembedded manifest 失败:', e.message);
        }
        // wasm 已 base64 内联进产物；asm 模式 copySqlWasmTo 内部跳过。保留调用统一语义。
        copySqlWasmTo(join(__dirname, 'dist', 'plus-assistantembedded'));
      },
    },
  ],
  external: [
    './script.js',
    './scripts/extensions.js',
  ],
  onwarn(warning, warn) {
    if (warning.code === 'THIS_IS_UNDEFINED') return;
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  },
};

export default config;
