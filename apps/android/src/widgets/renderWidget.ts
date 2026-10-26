import type { Widget } from '@desk-agent/protocol';

export type WidgetKind = 'system-stats' | 'weather' | 'deck' | 'broken';

const KNOWN_KINDS: WidgetKind[] = ['system-stats', 'weather', 'deck'];

export function resolveWidgetKind(widget: Widget): WidgetKind {
  return (KNOWN_KINDS as string[]).includes(widget.type) ? (widget.type as WidgetKind) : 'broken';
}
