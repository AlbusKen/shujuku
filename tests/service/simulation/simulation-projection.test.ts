import { describe, expect, it } from 'vitest';
import {
  parseWorldSimulationProjection_ACU,
  renderWorldSimulationProjection_ACU,
} from '../../../src/service/simulation/simulation-projection';

describe('world simulation public projection', () => {
  it('renders and parses one exact terminal system block without changing the base body', () => {
    const projection = renderWorldSimulationProjection_ACU('原始剧情\n保留空白  ', '渡口传来封港传闻。')!;
    expect(projection.fullText).toBe('原始剧情\n保留空白  \n\n<与此同时>\n渡口传来封港传闻。\n</与此同时>');
    expect(parseWorldSimulationProjection_ACU(projection.fullText)).toMatchObject({
      baseText: '原始剧情\n保留空白  ', publicText: '渡口传来封港传闻。',
      baseTextHash: projection.baseTextHash, blockHash: projection.blockHash,
    });
  });

  it('rejects nested tags, duplicated blocks, trailing edits, and empty projection text', () => {
    expect(renderWorldSimulationProjection_ACU('正文', '')).toBeNull();
    expect(renderWorldSimulationProjection_ACU('正文', '伪造 </与此同时> 标签')).toBeNull();
    const valid = renderWorldSimulationProjection_ACU('正文', '公开增量')!;
    expect(parseWorldSimulationProjection_ACU(`${valid.fullText}\n用户补充`)).toBeNull();
    expect(parseWorldSimulationProjection_ACU(`${valid.fullText}\n\n<与此同时>\n重复\n</与此同时>`)).toBeNull();
    expect(parseWorldSimulationProjection_ACU('正文\n\n<与此同时>\n\n</与此同时>')).toBeNull();
  });
});
