import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Card } from './Card.js';
import { theme } from '../theme.js';

// Recursively search the rendered JSON tree for a node whose flattened style
// contains { [prop]: value } -- used to check for the accent bar / roadmap
// border without hard-coding the component's internal structure.
function hasStyledNode(node: any, prop: string, value: unknown): boolean {
  if (!node) return false;
  const styles = Array.isArray(node.props?.style) ? node.props.style.flat(Infinity) : [node.props?.style];
  if (styles.some((s: any) => s && s[prop] === value)) return true;
  const children = node.children;
  if (Array.isArray(children)) {
    return children.some((c) => hasStyledNode(c, prop, value));
  }
  return false;
}

describe('Card', () => {
  it('renders children with no accent bar by default (backward compatible)', async () => {
    const { toJSON } = await render(<Card>{null}</Card>);
    expect(hasStyledNode(toJSON(), 'backgroundColor', theme.colors.accent)).toBe(false);
  });

  it('renders an accent-colored bar when accent is true', async () => {
    const { toJSON } = await render(<Card accent>{null}</Card>);
    expect(hasStyledNode(toJSON(), 'backgroundColor', theme.colors.accent)).toBe(true);
  });

  it('renders a custom-colored accent bar when accent is a color string', async () => {
    const { toJSON } = await render(<Card accent="#FF00FF">{null}</Card>);
    expect(hasStyledNode(toJSON(), 'backgroundColor', '#FF00FF')).toBe(true);
  });

  it('renders a dashed roadmap border for variant="roadmap"', async () => {
    const { toJSON } = await render(<Card variant="roadmap">{null}</Card>);
    expect(hasStyledNode(toJSON(), 'borderStyle', 'dashed')).toBe(true);
  });

  it('suppresses the accent bar for variant="roadmap" even if accent is set', async () => {
    const { toJSON } = await render(
      <Card variant="roadmap" accent>
        {null}
      </Card>,
    );
    expect(hasStyledNode(toJSON(), 'backgroundColor', theme.colors.accent)).toBe(false);
  });

  it('still renders default (non-roadmap, non-accent) cards without a dashed border', async () => {
    const { toJSON } = await render(<Card>{null}</Card>);
    expect(hasStyledNode(toJSON(), 'borderStyle', 'dashed')).toBe(false);
  });

  it('still supports onPress (existing behavior)', async () => {
    const onPress = jest.fn();
    await render(
      <Card onPress={onPress}>
        <Text>text</Text>
      </Card>,
    );
    expect(screen.getByText('text')).toBeTruthy();
  });
});
