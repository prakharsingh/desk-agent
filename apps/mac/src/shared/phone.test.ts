import { describe, it, expect } from 'vitest';
import type { StatusSnapshot } from '@desk-agent/core';
import { pairedPhoneName, phoneAppLabel } from './phone.js';

describe('pairedPhoneName', () => {
  it.each([
    [{ serial: 'abc123', model: 'OnePlus 6T' }, 'OnePlus 6T'],
    [{ serial: 'abc123', model: '  ' }, 'abc123'],
    [{ serial: 'abc123', model: null }, 'abc123'],
    [{ serial: null, model: null }, 'none'],
  ] as const)('%o -> "%s"', (device, expected) => {
    expect(pairedPhoneName(device as Pick<StatusSnapshot['device'], 'serial' | 'model'>)).toBe(expected);
  });
});

describe('phoneAppLabel', () => {
  it('reports connected when any WS client is attached', () => {
    expect(phoneAppLabel({ connected: 1 })).toBe('connected');
  });
  it('reports not connected at zero clients', () => {
    expect(phoneAppLabel({ connected: 0 })).toBe('not connected');
  });
});
