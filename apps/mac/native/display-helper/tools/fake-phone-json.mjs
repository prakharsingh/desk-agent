#!/usr/bin/env node
// Dev-only stand-in for the phone's JSON WebSocket side of the extended display (Contract A). Node 22+, no
// dependencies (uses the global WebSocket).
//
//   node fake-phone-json.mjs [--w 2340 --h 1080 --orientation landscape] [--dpi 402] [--url ws://127.0.0.1:8787]
//
// Sends `hello`, then `display.start {w,h,orientation}`; prints every `display.session`. When the socket closes
// (e.g. a core restart) it reconnects every second and re-sends only `hello`, keeping the session id it saw (core
// re-announces the session after hello). Type `stop` + Enter to send `display.stop` (the last session id it saw,
// else null) and keep watching; Ctrl-C sends `display.stop` and exits. A stop requested while disconnected is sent
// right after the next hello. The token never crosses this socket: in dev, run Desk Agent with
// DESK_AGENT_DISPLAY_DEV_TOKEN_FILE=/tmp/da-token and pass that to test-client.mjs.

import readline from 'node:readline';

if (typeof WebSocket !== 'function') {
  console.error('fake-phone-json: needs Node 22+ (global WebSocket)');
  process.exit(2);
}

// Contract A: w/h integers in 320..8192; dpi a positive number up to 1000 (fractional xdpi is fine).
function surfaceDim(flag, raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 320 || n > 8192) throw new Error(`${flag} must be an integer in 320..8192, got "${raw}"`);
  return n;
}

function dpiValue(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new Error(`--dpi must be a positive number up to 1000, got "${raw}"`);
  return n;
}

function parseArgs(argv) {
  const opts = { url: 'ws://127.0.0.1:8787', w: 2340, h: 1080, orientation: 'landscape' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--url': opts.url = next(); break;
      case '--w': opts.w = surfaceDim('--w', next()); break;
      case '--h': opts.h = surfaceDim('--h', next()); break;
      case '--orientation': opts.orientation = next(); break;
      case '--dpi': opts.dpi = dpiValue(next()); break;
      default: throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!['portrait', 'landscape'].includes(opts.orientation)) throw new Error('--orientation must be portrait or landscape');
  return opts;
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`fake-phone-json: ${err.message}`);
  process.exit(2);
}
let seq = 0;
const frame = (type, payload) => JSON.stringify({ v: 1, type, id: `fake-${process.pid}-${++seq}`, ts: Date.now(), payload });

const RECONNECT_MS = 1000;
let sessionId = null;
let ws = null;
let started = false; // display.start goes out once, on the first connection only
let everConnected = false;
let pendingStop = false;
let exiting = false;

function sendStop() {
  ws.send(frame('display.stop', { sessionId, reason: 'user-exit' }));
  console.log(`display.stop sessionId ${sessionId ?? 'null'}`);
}

function connect() {
  const sock = new WebSocket(opts.url);
  ws = sock;
  sock.addEventListener('open', () => {
    everConnected = true;
    sock.send(frame('hello', { clientVersion: 'fake-phone-json' }));
    if (!started) {
      started = true;
      const start = { w: opts.w, h: opts.h, orientation: opts.orientation, ...(opts.dpi ? { dpi: opts.dpi } : {}) };
      sock.send(frame('display.start', start));
      console.log(`display.start ${start.w}x${start.h} ${start.orientation}`);
    } else {
      console.log(`reconnected (sessionId ${sessionId ?? 'null'})`);
    }
    if (pendingStop) {
      pendingStop = false;
      sendStop();
    }
  });

  sock.addEventListener('message', (ev) => {
    let f;
    try {
      f = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (f.type === 'heartbeat') {
      sock.send(frame('heartbeat', {}));
    } else if (f.type === 'display.session') {
      const p = f.payload ?? {};
      if (p.sessionId) sessionId = p.sessionId;
      const parts = [`display.session ${p.state}`, `sessionId ${p.sessionId ?? 'null'}`];
      if (p.videoPort !== undefined) parts.push(`videoPort ${p.videoPort}`);
      if (p.reason !== undefined) parts.push(`reason ${p.reason}`);
      console.log(parts.join(' '));
    }
  });

  // An 'error' is always followed by 'close'; reconnecting happens there.
  sock.addEventListener('error', () => {
    if (!everConnected) console.error(`fake-phone-json: could not talk to ${opts.url} (is Desk Agent running?); retrying`);
  });

  sock.addEventListener('close', (ev) => {
    if (exiting || ws !== sock) return;
    if (everConnected) console.log(`socket closed (${ev.code}); reconnecting in ${RECONNECT_MS}ms`);
    setTimeout(connect, RECONNECT_MS);
  });
}

function requestStop() {
  if (ws && ws.readyState === WebSocket.OPEN) sendStop();
  else {
    pendingStop = true;
    console.log('not connected: display.stop will be sent after reconnecting');
  }
}

connect();

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const cmd = line.trim();
  if (cmd === 'stop') requestStop();
  else if (cmd) console.log(`unknown command "${cmd}" (try: stop)`);
});

process.on('SIGINT', () => {
  exiting = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendStop();
    // Let the frame flush before closing.
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 200);
  } else {
    process.exit(0);
  }
});
