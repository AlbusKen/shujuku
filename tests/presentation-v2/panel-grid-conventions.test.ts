import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const panelGridPages = [
  'AdvancedToolsPage.vue',
  'ApiPage.vue',
  'BasicConfigPage.vue',
  'ContentReplacePage.vue',
  'ContinuationPage.vue',
  'DataMgmtPage.vue',
  'DashboardPage.vue',
  'DeveloperPage.vue',
  'FormFillPage.vue',
  'ImportPage.vue',
  'PlotPage.vue',
  'TablePage.vue',
  'VectorIndexPage.vue',
  'WorldSimulationPage.vue',
];

function readPage(fileName: string): string {
  return readFileSync(join(process.cwd(), 'src/presentation-v2/pages', fileName), 'utf8');
}

describe('功能页面板分栏规范', () => {
  it.each(panelGridPages)('%s 使用 AcuPanelGrid 承载统一左右分栏骨架', (fileName) => {
    expect(readPage(fileName)).toContain('AcuPanelGrid');
  });

  it('单主面板页面保留右列空占位', () => {
    expect(readPage('ApiPage.vue')).toContain('aria-hidden="true"');
    expect(readPage('AgentPage.vue')).toContain('aria-hidden="true"');
  });

  it('页面样式不再手写加权 fr 分栏', () => {
    const weightedFr = /grid-template-columns:.*(?:\d+\.\d+|[2-9]\d*)fr/;

    for (const fileName of panelGridPages) {
      expect(readPage(fileName), fileName).not.toMatch(weightedFr);
    }
  });
});
