// Press-feedback state machine for the Deck screen (spec: result feedback
// is ONLY the plugin's widget re-publish echoing the press seq; no result
// frame type exists). A press with no matching-seq ack within the timeout
// renders as an error -- this is what closes the silent-drop hole where
// workerHost.invokeAction discards presses at a crashed/backing-off plugin.
export const DECK_ACK_TIMEOUT_MS = 1500;

export interface InFlightPress {
  seq: number;
  buttonId: string;
  sentAt: number;
}

export interface DeckAck {
  seq: number;
  buttonId: string;
  state: 'pending' | 'ok' | 'error';
}

export type DeckPressState = 'idle' | 'pending' | 'ok' | 'error';

export function pressStateFor(
  buttonId: string,
  pressed: InFlightPress | null,
  lastPress: DeckAck | undefined,
  nowMs: number,
): DeckPressState {
  if (!pressed || pressed.buttonId !== buttonId) return 'idle';
  const ack = lastPress && lastPress.seq === pressed.seq ? lastPress : undefined;
  if (ack) return ack.state === 'pending' ? 'pending' : ack.state;
  return nowMs - pressed.sentAt > DECK_ACK_TIMEOUT_MS ? 'error' : 'pending';
}
