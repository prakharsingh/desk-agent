import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { DeckScreen } from './DeckScreen.js';
import { theme } from '../theme.js';
import type { DeckButtonView } from '../widgetReaders.js';

// Same recursive style search used by Card.test.tsx / HomeScreen.test.tsx.
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

describe('DeckScreen', () => {
  it('renders one button per configured entry', async () => {
    await render(<DeckScreen buttons={BUTTONS} onPressButton={() => null} onBack={() => {}} />);
    expect(screen.getByText('FOCUS')).toBeTruthy();
    expect(screen.getByText('FIGMA')).toBeTruthy();
    expect(screen.getByText('SLEEP')).toBeTruthy();
  });

  it('invokes onPressButton with the pressed button on pressIn', async () => {
    const onPressButton = jest.fn().mockReturnValue(1);
    await render(<DeckScreen buttons={BUTTONS} onPressButton={onPressButton} onBack={() => {}} />);
    fireEvent(screen.getByText('FOCUS'), 'pressIn');
    expect(onPressButton).toHaveBeenCalledTimes(1);
    expect(onPressButton).toHaveBeenCalledWith(BUTTONS[0]);
  });

  it('shows the honest empty-state copy when there are no buttons configured', async () => {
    await render(<DeckScreen buttons={[]} onPressButton={() => null} onBack={() => {}} />);
    expect(screen.getByText('NO BUTTONS CONFIGURED — ADD deck.buttons IN config.json')).toBeTruthy();
  });

  it('applies the alert border treatment for a matching-seq error ack', async () => {
    const onPressButton = jest.fn().mockReturnValue(5);
    const { rerender, toJSON, unmount } = await render(
      <DeckScreen buttons={BUTTONS} onPressButton={onPressButton} onBack={() => {}} />,
    );
    // Press first so the component records the in-flight seq=5 press --
    // pressStateFor only resolves ok/error once there's a matching in-flight
    // press to match the ack's seq against (see deckPress.ts).
    fireEvent(screen.getByText('FOCUS'), 'pressIn');
    await rerender(
      <DeckScreen
        buttons={BUTTONS}
        onPressButton={onPressButton}
        onBack={() => {}}
        lastPress={{ seq: 5, buttonId: 'focus', state: 'error' }}
      />,
    );
    expect(hasStyledNode(toJSON(), 'borderColor', theme.colors.alert)).toBe(true);
    // The ack-driven decay effect schedules a real setTimeout (OK_BLIP_MS) to
    // clear the pressed state back to idle; unmount explicitly so its
    // cleanup clears that timer now instead of leaving it to fire ~600ms
    // later against a torn-down tree, which previously left Jest's process
    // unable to exit cleanly at the end of the run.
    await unmount();
  });
});
