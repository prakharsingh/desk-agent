import { createFrame, type Frame, type DisplayReason } from '@desk-agent/protocol';
import type { DisplaySize } from './display/displayFlow.js';

export function buildDisplayStartFrame(size: DisplaySize): Frame {
  const payload =
    size.dpi !== undefined
      ? { w: size.w, h: size.h, orientation: size.orientation, dpi: size.dpi }
      : { w: size.w, h: size.h, orientation: size.orientation };
  return createFrame('display.start', payload);
}

export function buildDisplayStopFrame(sessionId: string | null, reason?: DisplayReason): Frame {
  return createFrame('display.stop', reason !== undefined ? { sessionId, reason } : { sessionId });
}
