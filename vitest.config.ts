import { defineConfig } from 'vitest/config';
import path from 'path';
import vuePlugin from 'unplugin-vue/vite';

/**
 * SillyTavern 宿主模块在生产环境通过 rollup external 标记不打包，
 * 但 vitest 走 vite 解析时找不到对应文件。为这两个相对路径提供空模块占位，
 * 避免 service / data 层 transitive 导入触发 import 解析失败。
 */
function stubHostModules() {
  const HOST_PATHS = new Set(['./script.js', './scripts/extensions.js']);
  return {
    name: 'acu-v2-stub-host-modules',
    enforce: 'pre' as const,
    resolveId(source: string) {
      if (HOST_PATHS.has(source)) return `\0acu-v2-host-stub:${source}`;
      return null;
    },
    load(id: string) {
      if (id.startsWith('\0acu-v2-host-stub:')) {
        return 'export default {};';
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    stubHostModules(),
    vuePlugin({
      isProduction: true,
      root: process.cwd(),
      sourceMap: false,
      inlineTemplate: false,
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@data': path.resolve(__dirname, 'src/data'),
      '@service': path.resolve(__dirname, 'src/service'),
      '@presentation': path.resolve(__dirname, 'src/presentation'),
      '@presentation-v2': path.resolve(__dirname, 'src/presentation-v2'),
      // 构建期由 rollup replace 注入；vitest 直接解析到 wasm 引擎（测试通过 mock 替换）
      '__ACU_SQLITE_ENGINE_IMPORT__': 'sql.js/dist/sql-wasm.js',
    },
  },
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 15000,
    // 全量套件按文件隔离（forks 池），文件级并行不会引入跨文件状态污染。
    // 8 worker 已复现 vitest onTaskUpdate RPC 超时；4 worker 已完整通过 373 files / 7937 tests。
    // 因此默认采用 4 worker；资源受限环境可用 `--maxWorkers=1` 降级串行。
    maxWorkers: 4,
    fileParallelism: true,
    maxConcurrency: 1,
    typecheck: {
      tsconfig: './tsconfig.json',
    },
  },
});
