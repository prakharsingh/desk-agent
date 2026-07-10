import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;

export const WidgetSchema = z.object({
  type: z.string().min(1),
  props: z.record(z.unknown()),
});
export type Widget = z.infer<typeof WidgetSchema>;

export const WidgetEntrySchema = z.object({
  widgetId: z.string().min(1),
  widget: WidgetSchema,
});
export type WidgetEntry = z.infer<typeof WidgetEntrySchema>;

export const HelloPayloadSchema = z.object({ clientVersion: z.string() });
export type HelloPayload = z.infer<typeof HelloPayloadSchema>;

export const HeartbeatPayloadSchema = z.object({});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

export const WidgetUpdatePayloadSchema = z.object({
  widgets: z.array(WidgetEntrySchema),
});
export type WidgetUpdatePayload = z.infer<typeof WidgetUpdatePayloadSchema>;

export const ActionInvokePayloadSchema = z.object({
  pluginId: z.string().min(1),
  action: z.string().min(1),
  args: z.record(z.unknown()).optional(),
});
export type ActionInvokePayload = z.infer<typeof ActionInvokePayloadSchema>;

export const EventPublishPayloadSchema = z.object({
  eventName: z.string().min(1),
  data: z.record(z.unknown()),
});
export type EventPublishPayload = z.infer<typeof EventPublishPayloadSchema>;

const versionLiteral = z.literal(PROTOCOL_VERSION);

export const FrameSchema = z.discriminatedUnion('type', [
  z.object({ v: versionLiteral, type: z.literal('hello'), id: z.string(), ts: z.number(), payload: HelloPayloadSchema }),
  z.object({ v: versionLiteral, type: z.literal('heartbeat'), id: z.string(), ts: z.number(), payload: HeartbeatPayloadSchema }),
  z.object({ v: versionLiteral, type: z.literal('widget.update'), id: z.string(), ts: z.number(), payload: WidgetUpdatePayloadSchema }),
  z.object({ v: versionLiteral, type: z.literal('action.invoke'), id: z.string(), ts: z.number(), payload: ActionInvokePayloadSchema }),
  z.object({ v: versionLiteral, type: z.literal('event.publish'), id: z.string(), ts: z.number(), payload: EventPublishPayloadSchema }),
]);
export type Frame = z.infer<typeof FrameSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function toResult<T>(result: z.SafeParseReturnType<unknown, T>): ParseResult<T> {
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.message };
}

export function parseFrame(raw: unknown): ParseResult<Frame> {
  return toResult(FrameSchema.safeParse(raw));
}

export function parseWidget(raw: unknown): ParseResult<Widget> {
  return toResult(WidgetSchema.safeParse(raw));
}

export function parseEventPublishPayload(raw: unknown): ParseResult<EventPublishPayload> {
  return toResult(EventPublishPayloadSchema.safeParse(raw));
}

type PayloadOf<T extends Frame['type']> = Extract<Frame, { type: T }>['payload'];

// Not a real UUID: React Native's Hermes engine has no global `crypto`
// (unlike Node, where every other package in this repo runs), so this
// avoids requiring a native crypto polyfill just for a frame-tracing id.
// FrameSchema only requires `id` to be a non-empty string.
function generateFrameId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createFrame<T extends Frame['type']>(type: T, payload: PayloadOf<T>): Frame {
  return { v: PROTOCOL_VERSION, type, id: generateFrameId(), ts: Date.now(), payload } as Frame;
}
