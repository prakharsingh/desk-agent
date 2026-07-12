import { describe, it, expect } from 'vitest';
import { theme } from './theme.js';

describe('theme', () => {
  it('defines the full color palette used by the design', () => {
    const keys = ['bg', 'bgAlt', 'accent', 'text', 'textDim', 'textFaint', 'textFainter', 'warn', 'alert', 'ram', 'border', 'borderDim'];
    for (const k of keys) expect(theme.colors[k as keyof typeof theme.colors]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('defines font family names for each weight bundled', () => {
    expect(theme.font.regular).toBe('IBMPlexMono-Regular');
    expect(theme.font.medium).toBe('IBMPlexMono-Medium');
    expect(theme.font.semibold).toBe('IBMPlexMono-SemiBold');
    expect(theme.font.bold).toBe('IBMPlexMono-Bold');
  });

  it('defines spacing and radii as positive numbers', () => {
    expect(theme.spacing.sm).toBeGreaterThan(0);
    expect(theme.spacing.md).toBeGreaterThan(theme.spacing.sm);
    expect(theme.radii.card).toBeGreaterThan(0);
  });

  it('defines rgba surface/derived tokens for chips, badges, and charts', () => {
    const keys = [
      'chipBg', 'chipBgDim',
      'warnBg', 'warnBorder',
      'accentBg', 'accentBorder',
      'gridLine',
    ];
    for (const k of keys) {
      expect(theme.colors[k as keyof typeof theme.colors]).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/);
    }
  });

  it('defines solid roadmap-card surface tokens', () => {
    expect(theme.colors.roadmapBg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(theme.colors.roadmapBorder).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/);
  });

  it('defines a chip radius smaller than the card radius', () => {
    expect(theme.radii.chip).toBeGreaterThan(0);
    expect(theme.radii.chip).toBeLessThanOrEqual(theme.radii.card);
  });
});
