import { describe, it, expect } from 'vitest';
import { pressStateFor, DECK_ACK_TIMEOUT_MS } from './deckPress.js';

const pressed = { seq: 5, buttonId: 'focus', sentAt: 1000 };

describe('pressStateFor', () => {
  it('is idle with no in-flight press', () => {
    expect(pressStateFor('focus', null, undefined, 1000)).toBe('idle');
  });
  it('is pending after send, before ack, before timeout', () => {
    expect(pressStateFor('focus', pressed, undefined, 1400)).toBe('pending');
    expect(pressStateFor('focus', pressed, { seq: 4, buttonId: 'focus', state: 'ok' }, 1400)).toBe('pending'); // stale seq ignored
  });
  it('resolves ok/error from a matching-seq ack', () => {
    expect(pressStateFor('focus', pressed, { seq: 5, buttonId: 'focus', state: 'ok' }, 1400)).toBe('ok');
    expect(pressStateFor('focus', pressed, { seq: 5, buttonId: 'focus', state: 'error' }, 1400)).toBe('error');
    expect(pressStateFor('focus', pressed, { seq: 5, buttonId: 'focus', state: 'pending' }, 1400)).toBe('pending');
  });
  it('times out to error when no ack echoes the seq in 1.5s', () => {
    expect(pressStateFor('focus', pressed, undefined, 1000 + DECK_ACK_TIMEOUT_MS + 1)).toBe('error');
  });
  it('other buttons stay idle while one press is in flight', () => {
    expect(pressStateFor('figma', pressed, undefined, 1400)).toBe('idle');
  });
});
