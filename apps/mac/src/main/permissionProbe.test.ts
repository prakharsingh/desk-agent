import { describe, expect, it } from 'vitest';
import { describePermissionStatus } from './permissionProbe.js';

describe('describePermissionStatus', () => {
  it('formats version, Screen Recording status and Accessibility trust', () => {
    expect(describePermissionStatus('granted', false, '0.6.0')).toBe('v0.6.0 screen-recording=granted accessibility=false');
  });

  it('reports a fully granted app', () => {
    expect(describePermissionStatus('granted', true, '0.0.2')).toBe('v0.0.2 screen-recording=granted accessibility=true');
  });

  it('passes through not-determined / denied / restricted / unknown verbatim', () => {
    for (const s of ['not-determined', 'denied', 'restricted', 'unknown'] as const) {
      expect(describePermissionStatus(s, false, '1.2.3')).toBe(`v1.2.3 screen-recording=${s} accessibility=false`);
    }
  });
});
