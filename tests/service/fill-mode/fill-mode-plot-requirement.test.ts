import { describe, expect, it } from 'vitest';

import {
  isPlotRequiredForFillMode_ACU,
} from '../../../src/service/fill-mode/fill-mode-gate';

describe('fill mode plot requirement', () => {
  it('requires plot for LLM recall even when the legacy plot setting is off', () => {
    expect(isPlotRequiredForFillMode_ACU('chat', 'llm', false)).toBe(true);
  });

  it('requires plot for crossfire even when the legacy plot setting is off', () => {
    expect(isPlotRequiredForFillMode_ACU('chat', 'crossfire', false)).toBe(true);
  });

  it('does not require plot for classic or vector modes even when the legacy setting is on', () => {
    expect(isPlotRequiredForFillMode_ACU('chat', 'classic', true)).toBe(false);
    expect(isPlotRequiredForFillMode_ACU('chat', 'vector', true)).toBe(false);
  });

  it('keeps the legacy plot setting for chats that have no recorded fill mode', () => {
    expect(isPlotRequiredForFillMode_ACU('default', 'classic', true)).toBe(true);
    expect(isPlotRequiredForFillMode_ACU('default', 'classic', false)).toBe(false);
  });
});
