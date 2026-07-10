import { parseEventPublishPayload, type EventPublishPayload } from '@desk-agent/protocol';

export type EventBusListener = (payload: EventPublishPayload) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventBusListener>>();

  subscribe(eventName: string, listener: EventBusListener): () => void {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
    this.listeners.get(eventName)!.add(listener);
    return () => {
      this.listeners.get(eventName)?.delete(listener);
    };
  }

  publish(raw: unknown): { accepted: boolean; error?: string } {
    const result = parseEventPublishPayload(raw);
    if (!result.ok) return { accepted: false, error: result.error };
    const payload = result.value;
    for (const listener of this.listeners.get(payload.eventName) ?? []) listener(payload);
    for (const listener of this.listeners.get('*') ?? []) listener(payload);
    return { accepted: true };
  }
}
