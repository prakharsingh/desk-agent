import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deviceCardTitle } from './deviceCard.js';
import { DeviceGlyph } from '../ui/DeviceGlyph.js';

describe('deviceCardTitle', () => {
  it("uses the phone's real model name when the core has resolved it", () => {
    expect(deviceCardTitle({ serial: '78f2af2a', model: 'OnePlus 6T' })).toBe('OnePlus 6T');
  });

  it('falls back to "Android phone" while the model is unknown (null)', () => {
    expect(deviceCardTitle({ serial: '78f2af2a', model: null })).toBe('Android phone');
  });

  it('treats a blank model as unknown', () => {
    expect(deviceCardTitle({ serial: '78f2af2a', model: '   ' })).toBe('Android phone');
  });

  it('says no device is paired when there is no serial', () => {
    expect(deviceCardTitle({ serial: null, model: null })).toBe('No device paired');
  });
});

describe('DeviceGlyph', () => {
  const markup = renderToStaticMarkup(createElement(DeviceGlyph, { size: 56 }));

  it('strokes with currentColor so it follows the theme text token', () => {
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).not.toMatch(/stroke="#/);
  });

  it('is decorative (hidden from assistive tech) and sized as requested', () => {
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('width="56"');
    expect(markup).toContain('height="56"');
  });

  it('masks the phone behind the box (box occludes phone) with a per-instance mask id', () => {
    const id = /<mask id="([^"]+)"/.exec(markup)?.[1];
    expect(id).toBeTruthy();
    expect(markup).toContain(`mask="url(#${id})"`);
  });

  it('has no status dot of its own (the old design put one mid-phone)', () => {
    expect(markup).not.toContain('<circle');
  });
});
