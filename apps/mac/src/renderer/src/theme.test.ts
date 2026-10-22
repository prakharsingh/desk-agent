import { describe, expect, it } from 'vitest';
import {
  ACCENT_FILL,
  ACCENT_TEXT,
  ACCENT_TONES,
  contrastRatio,
  darkTheme,
  fillColor,
  lightTheme,
  resolveTheme,
  textColor,
} from './theme.js';
import { WINDOW_BACKGROUND_DARK, WINDOW_BACKGROUND_LIGHT } from '../../shared/constants.js';

describe('resolveTheme (follows the macOS appearance)', () => {
  it('dark appearance -> dark tokens + dark color-scheme', () => {
    expect(resolveTheme(true)).toEqual({ vars: darkTheme, colorScheme: 'dark' });
  });
  it('light appearance -> light tokens + light color-scheme', () => {
    expect(resolveTheme(false)).toEqual({ vars: lightTheme, colorScheme: 'light' });
  });
  it('--content matches the native window fallback color per appearance (no-flash)', () => {
    expect(darkTheme['--content']).toBe(WINDOW_BACKGROUND_DARK);
    expect(lightTheme['--content']).toBe(WINDOW_BACKGROUND_LIGHT);
  });
  it('both themes define the same token names', () => {
    expect(Object.keys(lightTheme).sort()).toEqual(Object.keys(darkTheme).sort());
  });
});

describe('accent tokens (split text vs fill)', () => {
  it('pins the reviewed per-appearance values', () => {
    expect(ACCENT_TEXT.light).toEqual({ green: '#1F7A34', blue: '#0066CC', amber: '#C93400', red: '#D70015' });
    expect(ACCENT_FILL.light).toEqual({ green: '#34C759', blue: '#007AFF', amber: '#FF9500', red: '#FF3B30' });
    // Dark text: Apple's accessible variants for blue/red (the system fills
    // only clear 3:1 on --group); green/amber fills already pass, reused as-is.
    expect(ACCENT_TEXT.dark).toEqual({ green: '#30D158', blue: '#409CFF', amber: '#FF9F0A', red: '#FF6961' });
    expect(ACCENT_FILL.dark).toEqual({ green: '#30D158', blue: '#0A84FF', amber: '#FF9F0A', red: '#FF453A' });
  });

  it('exposes every tone as CSS vars on both themes', () => {
    for (const tone of ACCENT_TONES) {
      expect(darkTheme[`--${tone}-text`]).toBe(ACCENT_TEXT.dark[tone]);
      expect(darkTheme[`--${tone}-fill`]).toBe(ACCENT_FILL.dark[tone]);
      expect(lightTheme[`--${tone}-text`]).toBe(ACCENT_TEXT.light[tone]);
      expect(lightTheme[`--${tone}-fill`]).toBe(ACCENT_FILL.light[tone]);
    }
    expect(textColor('green')).toBe('var(--green-text)');
    expect(fillColor('red')).toBe('var(--red-fill)');
  });

  it.each(ACCENT_TONES)('light %s TEXT meets WCAG AA (4.5:1) on group and content surfaces', (tone) => {
    expect(contrastRatio(ACCENT_TEXT.light[tone], lightTheme['--group'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ACCENT_TEXT.light[tone], lightTheme['--content'])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(ACCENT_TONES)('dark %s TEXT meets WCAG AA (4.5:1) on group and content surfaces', (tone) => {
    expect(contrastRatio(ACCENT_TEXT.dark[tone], darkTheme['--group'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ACCENT_TEXT.dark[tone], darkTheme['--content'])).toBeGreaterThanOrEqual(4.5);
  });

  // Every text token (neutral + accent), in both appearances, against every
  // surface text sits on -- no known gaps left.
  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ] as const)('%s: every text token meets AA on --group and --content', (_mode, theme) => {
    const textTokens = Object.keys(theme).filter((k) => /^--(text\d?|[a-z]+-text)$/.test(k));
    expect(textTokens.length).toBe(3 + ACCENT_TONES.length);
    for (const token of textTokens) {
      for (const surface of ['--group', '--content']) {
        expect({ token, surface, ratio: contrastRatio(theme[token], theme[surface]) >= 4.5 }).toEqual({ token, surface, ratio: true });
      }
    }
  });
});

describe('tertiary text contrast', () => {
  it('pins the raised --text3 values', () => {
    expect(darkTheme['--text3']).toBe('#98989D');
    expect(lightTheme['--text3']).toBe('#6e6e73');
  });
  it('dark --text3 meets AA on group and content', () => {
    expect(contrastRatio(darkTheme['--text3'], darkTheme['--group'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkTheme['--text3'], darkTheme['--content'])).toBeGreaterThanOrEqual(4.5);
  });
  it('light --text3 meets AA on group and content', () => {
    expect(contrastRatio(lightTheme['--text3'], lightTheme['--group'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightTheme['--text3'], lightTheme['--content'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('contrastRatio', () => {
  it('black on white is 21:1 and is symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  it('rejects non-hex input', () => {
    expect(() => contrastRatio('red', '#fff')).toThrow();
  });
});
