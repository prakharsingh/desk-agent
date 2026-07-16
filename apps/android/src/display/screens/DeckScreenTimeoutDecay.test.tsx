import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { DeckScreen } from './DeckScreen.js';
import { theme } from '../theme.js';
import type { DeckButtonView } from '../widgetReaders.js';

// Kept in its own file (rather than folded into DeckScreen.test.tsx) because
// this is the one DeckScreen test that needs fake timers to deterministically
// advance past the 1500ms ack deadline and the 600ms decay without a real
// ~2.2s wait. This RN/React-test-renderer/Jest combination only tolerates a
// single render() under fake timers per test *file* (each Jest test file gets
// its own fresh environment/module registry) -- mixing it into the same file
// as DeckScreen's other (real-timer) render() calls reliably breaks later
// renders in that file, so it's isolated here instead.

// Same recursive style search used by Card.test.tsx / HomeScreen.test.tsx /
// DeckScreen.test.tsx.
function hasStyledNode(node: any, prop: string, value: unknown): boolean {
  if (!node) return false;
  const styles = Array.isArray(node.props?.style) ? node.props.style.flat(Infinity) : [node.props?.style];
  if (styles.some((s: any) => s && s[prop] === value)) return true;
  const children = node.children;
  if (Array.isArray(children)) {
    return children.some((c: any) => hasStyledNode(c, prop, value));
  }
  return false;
}

const BUTTONS: DeckButtonView[] = [
  { id: 'focus', label: 'Focus', glyph: '◐', kind: 'shortcut' },
  { id: 'figma', label: 'Figma', glyph: '◆', kind: 'open' },
  { id: 'sleep', label: 'Sleep', glyph: '☾', kind: 'builtin', pluginId: 'energy-saver', action: 'sleep' },
];

describe('DeckScreen timeout decay', () => {
  it('decays a never-acked press from the error treatment back to idle', async () => {
    const onPressButton = jest.fn().mockReturnValue(1);
    const { toJSON, unmount } = await render(
      <DeckScreen buttons={BUTTONS} onPressButton={onPressButton} onBack={() => {}} />,
    );

    jest.useFakeTimers();
    try {
      // No lastPress passed at all -- this press never gets an ack, so it
      // must flip to the error treatment at the ack deadline and then decay
      // back to idle on its own instead of staying wedged in error.
      // fireEvent is async (it wraps the handler call in act()) -- it must
      // be awaited so the press state actually commits before we advance
      // timers and inspect the tree.
      await fireEvent(screen.getByText('FOCUS'), 'pressIn');

      await act(() => { jest.advanceTimersByTime(1600); });
      expect(hasStyledNode(toJSON(), 'borderColor', theme.colors.alert)).toBe(true);

      await act(() => { jest.advanceTimersByTime(700); });
      expect(hasStyledNode(toJSON(), 'borderColor', theme.colors.alert)).toBe(false);
    } finally {
      await unmount();
      jest.useRealTimers();
    }
  });
});
