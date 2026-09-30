#!/usr/bin/env node
/**
 * 将 userscript 产物同步到酒馆助手脚本 JSON 的 content 字段。
 * 默认使用根目录 index.js；可传入自定义脚本路径。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const sourcePath = resolve(ROOT, process.argv[2] || 'index.js');
const jsonPath = resolve(ROOT, process.argv[3] || '酒馆助手脚本-龙血玄黄·数据库.json');

function fail(message) {
  console.error(`[sync-userscript-json] ERROR: ${message}`);
  process.exit(1);
}

if (!existsSync(sourcePath)) {
  fail(`脚本源文件不存在: ${sourcePath}`);
}
if (!existsSync(jsonPath)) {
  fail(`目标 JSON 不存在: ${jsonPath}`);
}

const scriptContent = readFileSync(sourcePath, 'utf8');
let data;
try {
  data = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (error) {
  fail(`目标 JSON 解析失败: ${error?.message || String(error)}`);
}

if (!data || typeof data !== 'object' || Array.isArray(data)) {
  fail('目标 JSON 顶层不是对象');
}
if (data.type !== 'script') {
  fail(`目标 JSON type 不是 script: ${String(data.type)}`);
}

data.content = scriptContent;
writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

const size = (statSync(jsonPath).size / 1024).toFixed(1);
console.log(`[sync-userscript-json] ${sourcePath} -> ${jsonPath} (${size} KB)`);
