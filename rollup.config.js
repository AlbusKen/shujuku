/**
 * rollup.config.js - dual entry modular build.
 *
 * Build targets:
 * 1. Userscript: IIFE + UserScript banner -> dist/index.bundle.js
 * 2. SillyTavern extension: ESM -> dist/extension/index.js
 */
import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import vuePlugin from 'unplugin-vue/rollup';
import sfcStyleInjector from './src/presentation-v2/build/rollup-sfc-style-injector.js';
import vueScriptTranspiler from './src/presentation-v2/build/rollup-vue-script-transpiler.js';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ACU_SQLITE_ENGINE, SQL_WASM_IMPORT_ID, SQL_WASM_BASE64, SQL_WASM_BASE64_GLOBAL, copySqlWasmTo } from './scripts/sql-wasm-assets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUILD_MODE = process.env.BUILD_MODE || 'userscript';
const PACKAGE_VERSION = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version;
const ACU_BUILD_VERSION = process.env.ACU_BUILD_VERSION || PACKAGE_VERSION;

const USER_SCRIPT_BANNER = `// ==UserScript==
// @name         SP·数据库 IX
// @namespace    http://tampermonkey.net/
// @version      ${ACU_BUILD_VERSION}
// @description  SillyTavern 数据库自动更新与交火模式索引管理脚本。
// @author       Cline (AI Assisted)
// @match        */*
// @grant        none
// @注释掉的require  https://code.jquery.com/jquery-3.7.1.min.js
// @注释掉的require  https://cdnjs.cloudflare.com/ajax/libs/toastr.js/latest/toastr.min.js
// ==/UserScript==`;

const nodeBuiltinsShim = {
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
};

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
  // 常量为单行超长字符串，JSON.stringify 保证转义正确；preventAssignment 避免被当成赋值误替换。
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

const sharedPlugins = [
  nodeBuiltinsShim,
  createVuePlugin(),
  vueScriptTranspiler(),
  sfcStyleInjector(),
  nodeResolve({
    browser: true,
    preferBuiltins: false,
    extensions: ['.mjs', '.js', '.json', '.ts', '.vue'],
  }),
  commonjs(),
];

function createTsPlugin() {
  return typescript({
    tsconfig: './tsconfig.json',
    compilerOptions: {
      noEmit: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      outDir: 'dist',
    },
    include: ['src/**/*.ts', 'src/**/*.js'],
  });
}

const sharedOnWarn = (warning, warn) => {
  if (warning.code === 'THIS_IS_UNDEFINED') return;
  if (warning.code === 'CIRCULAR_DEPENDENCY') return;
  warn(warning);
};

const userscriptConfig = {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.bundle.js',
    format: 'iife',
    banner: USER_SCRIPT_BANNER,
    sourcemap: false,
  },
  treeshake: false,
  plugins: [
    ...sharedPlugins,
    createTsPlugin(),
    createReplacePlugin(),
    {
      name: 'sync-userscript-artifacts',
      writeBundle() {
        const distBundle = join(__dirname, 'dist', 'index.bundle.js');
        const rootIndex = join(__dirname, 'index.js');

        if (!existsSync(distBundle)) {
          throw new Error(`userscript 构建产物缺失: ${distBundle}`);
        }

        copyFileSync(distBundle, rootIndex);

        // wasm 已 base64 内联进产物（SQL_WASM_BASE64），无需再复制独立 wasm 文件；
        // asm 模式 copySqlWasmTo 内部跳过。保留调用以统一构建语义。
        copySqlWasmTo(join(__dirname, 'dist'));
      },
    },
  ],
  external: [
    './script.js',
    './scripts/extensions.js',
  ],
  onwarn: sharedOnWarn,
};

const extensionConfig = {
  input: 'src/entry-extension.ts',
  output: {
    file: 'dist/extension/index.js',
    format: 'es',
    sourcemap: false,
  },
  treeshake: false,
  plugins: [
    ...sharedPlugins,
    createTsPlugin(),
    createReplacePlugin(),
    {
      name: 'sync-extension-artifacts',
      writeBundle() {
        const distExtensionDir = join(__dirname, 'dist', 'extension');
        const distIndex = join(distExtensionDir, 'index.js');
        const distManifest = join(distExtensionDir, 'manifest.json');
        const rootManifest = join(__dirname, 'manifest.json');

        mkdirSync(distExtensionDir, { recursive: true });

        if (!existsSync(distIndex)) {
          throw new Error(`extension 构建产物缺失: ${distIndex}`);
        }

        if (!existsSync(rootManifest)) {
          throw new Error(`根目录 manifest.json 缺失: ${rootManifest}`);
        }

        copyFileSync(rootManifest, distManifest);

        if (!existsSync(distManifest)) {
          throw new Error(`extension manifest 复制失败: ${distManifest}`);
        }

        copyFileSync(distManifest, rootManifest);

        // 复制 sql.js wasm 到 dist/extension/（随 manifest.json 一起发布）
        copySqlWasmTo(distExtensionDir);
      },
    },
  ],
  external: [
    './script.js',
    './scripts/extensions.js',
  ],
  onwarn: sharedOnWarn,
};

let configs;
switch (BUILD_MODE) {
  case 'extension':
    configs = extensionConfig;
    break;
  case 'all':
    configs = [userscriptConfig, extensionConfig];
    break;
  case 'concat':
    configs = userscriptConfig;
    break;
  case 'userscript':
  default:
    configs = userscriptConfig;
    break;
}

export default configs;
