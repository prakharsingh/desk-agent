import type { Widget } from '@desk-agent/protocol';

export type WidgetKind = 'system-stats' | 'weather' | 'broken';

const KNOWN_KINDS: WidgetKind[] = ['system-stats', 'weather'];

export function resolveWidgetKind(widget: Widget): WidgetKind {
  return (KNOWN_KINDS as string[]).includes(widget.type) ? (widget.type as WidgetKind) : 'broken';
}
