import { describe, it, expect } from 'vitest';
import { resolveWidgetKind } from './renderWidget.js';

describe('resolveWidgetKind', () => {
  it('resolves system-stats and weather to their known kinds', () => {
    expect(resolveWidgetKind({ type: 'system-stats', props: {} })).toBe('system-stats');
    expect(resolveWidgetKind({ type: 'weather', props: {} })).toBe('weather');
  });

  it('falls back to "broken" for an unrecognized widget type', () => {
    expect(resolveWidgetKind({ type: 'something-new', props: {} })).toBe('broken');
  });
});
