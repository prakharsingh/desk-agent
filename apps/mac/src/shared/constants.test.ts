import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_HEADER_DRAG_HEIGHT,
  CONTENT_HEADER_HEIGHT,
  TRAFFIC_LIGHT_POSITION,
  WINDOW_BACKGROUND_DARK,
  WINDOW_BACKGROUND_LIGHT,
  windowBackgroundColor,
} from './constants.js';

describe('window chrome constants', () => {
  it('sidebar drag band matches the 52pt content header', () => {
    expect(SIDEBAR_HEADER_DRAG_HEIGHT).toBe(52);
    expect(CONTENT_HEADER_HEIGHT).toBe(SIDEBAR_HEADER_DRAG_HEIGHT);
  });

  it('traffic lights sit inside the drag band (not overlapping the nav)', () => {
    expect(TRAFFIC_LIGHT_POSITION).toEqual({ x: 20, y: 20 });
    // ~12pt-tall buttons must end inside the band.
    expect(TRAFFIC_LIGHT_POSITION.y + 12).toBeLessThanOrEqual(SIDEBAR_HEADER_DRAG_HEIGHT);
  });
});

describe('windowBackgroundColor', () => {
  it('is fully transparent with the vibrant sidebar (an opaque color would cover the material)', () => {
    expect(windowBackgroundColor(true, true)).toBe('#00000000');
    expect(windowBackgroundColor(false, true)).toBe('#00000000');
  });

  it('follows the appearance when vibrancy is off (no-flash fallback)', () => {
    expect(windowBackgroundColor(true, false)).toBe(WINDOW_BACKGROUND_DARK);
    expect(windowBackgroundColor(false, false)).toBe(WINDOW_BACKGROUND_LIGHT);
    expect(WINDOW_BACKGROUND_DARK).toBe('#1c1c1e');
    expect(WINDOW_BACKGROUND_LIGHT).toBe('#f4f4f6');
  });
});
