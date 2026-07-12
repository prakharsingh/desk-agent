import { describe, it, expect } from 'vitest';
import { renderedLightColor } from './lightColor.js';

describe('renderedLightColor', () => {
  it('returns pure white at full brightness for the white preset', () => {
    expect(renderedLightColor('white', 1)).toBe('#ffffff');
  });

  it('returns a warm amber tone at full brightness for the sunlight preset', () => {
    // Base sunlight tone: #ffb347 (warm amber). At brightness 1, unchanged.
    expect(renderedLightColor('sunlight', 1)).toBe('#ffb347');
  });

  it('blends toward black as brightness decreases (white preset)', () => {
    // At 50% brightness, each channel is halved: 0xff * 0.5 = 0x80 (rounded)
    expect(renderedLightColor('white', 0.5)).toBe('#808080');
  });

  it('blends toward black as brightness decreases (sunlight preset)', () => {
    // 0xff*0.5=0x80, 0xb3*0.5=0x5a (rounded from 89.5), 0x47*0.5=0x24 (rounded from 35.5)
    expect(renderedLightColor('sunlight', 0.5)).toBe('#805a24');
  });

  it('returns black at zero brightness regardless of preset', () => {
    expect(renderedLightColor('white', 0)).toBe('#000000');
    expect(renderedLightColor('sunlight', 0)).toBe('#000000');
  });

  it('clamps brightness above 1 to 1', () => {
    expect(renderedLightColor('white', 1.5)).toBe('#ffffff');
  });

  it('clamps brightness below 0 to 0', () => {
    expect(renderedLightColor('white', -0.5)).toBe('#000000');
  });
});
