#!/usr/bin/env node
// Dev-only stand-in for the phone's video socket (Contract D). No dependencies.
//
//   node test-client.mjs --port 8788 --token T --session S [--w 2340 --h 1080] [--out out.h264]
//        [--bad-token] [--stop-keepalive-after SEC] [--pause-at SEC --resume-at SEC]
//
// Sends `hello`, keepalives every 1000 ms (also while paused), acks every video frame (cumulative),
// writes the Annex-B stream (config + video) to --out, prints
// `frames=N keyframes=K configs=C bytes=B` once per second and any `end` reason.
import net from 'node:net';
import fs from 'node:fs';

const KIND_VIDEO = 0x01;
const KIND_JSON = 0x02;
const MAX_FRAME_LEN = 8_388_608;

function parseArgs(argv) {
  const opts = { port: 8788, w: 2340, h: 1080, badToken: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--port': opts.port = Number(next()); break;
      case '--token': opts.token = next(); break;
      case '--session': opts.session = next(); break;
      case '--w': opts.w = Number(next()); break;
      case '--h': opts.h = Number(next()); break;
      case '--out': opts.out = next(); break;
      case '--bad-token': opts.badToken = true; break;
      case '--stop-keepalive-after': opts.stopKeepaliveAfter = Number(next()); break;
      case '--pause-at': opts.pauseAt = Number(next()); break;
      case '--resume-at': opts.resumeAt = Number(next()); break;
      default: throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!opts.token || !opts.session) throw new Error('--token and --session are required');
  return opts;
}

function jsonFrame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(5);
  head.writeUInt32BE(body.length + 1, 0);
  head[4] = KIND_JSON;
  return Buffer.concat([head, body]);
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(`test-client: ${e.message}`);
  process.exit(2);
}

const out = opts.out ? fs.createWriteStream(opts.out) : null;
const stats = { frames: 0, keyframes: 0, configs: 0, bytes: 0 };
let lastSeq = 0n;
let keepaliveOn = true;
let buf = Buffer.alloc(0);
const timers = [];
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1);

const sock = net.connect({ host: '127.0.0.1', port: opts.port }, () => {
  sock.setNoDelay(true);
  console.log(`[${elapsed()}s] connected to 127.0.0.1:${opts.port}`);
  sock.write(jsonFrame({
    t: 'hello', v: 1,
    token: opts.badToken ? `${opts.token}-wrong` : opts.token,
    sessionId: opts.session,
    surfaceW: opts.w, surfaceH: opts.h,
    orientation: opts.w >= opts.h ? 'landscape' : 'portrait',
    codecs: ['h264'], maxW: 4096, maxH: 4096, trackpad: false,
  }));
  timers.push(setInterval(() => { if (keepaliveOn) send({ t: 'keepalive' }); }, 1000));
  timers.push(setInterval(printStats, 1000));
  if (opts.stopKeepaliveAfter !== undefined) {
    timers.push(setTimeout(() => {
      keepaliveOn = false;
      console.log(`[${elapsed()}s] keepalive stopped`);
    }, opts.stopKeepaliveAfter * 1000));
  }
  if (opts.pauseAt !== undefined) {
    timers.push(setTimeout(() => { console.log(`[${elapsed()}s] pause`); send({ t: 'pause' }); }, opts.pauseAt * 1000));
  }
  if (opts.resumeAt !== undefined) {
    timers.push(setTimeout(() => { console.log(`[${elapsed()}s] resume`); send({ t: 'resume' }); }, opts.resumeAt * 1000));
  }
});

function send(obj) {
  if (!sock.destroyed) sock.write(jsonFrame(obj));
}

function printStats() {
  console.log(`frames=${stats.frames} keyframes=${stats.keyframes} configs=${stats.configs} bytes=${stats.bytes}`);
}

function onVideo(body) {
  if (body.length < 9) throw new Error(`truncated VIDEO frame (${body.length + 1} bytes)`);
  const flags = body[0];
  const seq = body.readBigUInt64BE(1);
  const payload = body.subarray(9);
  stats.bytes += payload.length;
  if (out) out.write(payload);
  if (flags & 0x02) {
    stats.configs += 1;   // SPS+PPS, seq 0, never acked
    return;
  }
  stats.frames += 1;
  if (flags & 0x01) stats.keyframes += 1;
  if (seq > lastSeq) lastSeq = seq;
  send({ t: 'ack', seq: Number(lastSeq) });
}

function onJson(body) {
  const msg = JSON.parse(body.toString('utf8'));
  switch (msg.t) {
    case 'keepalive': break;
    case 'end': console.log(`[${elapsed()}s] end reason=${msg.reason}`); break;
    default: console.log(`[${elapsed()}s] ${JSON.stringify(msg)}`);
  }
}

sock.on('data', (chunk) => {
  buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
  try {
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (len < 1 || len > MAX_FRAME_LEN) throw new Error(`bad frame length ${len}`);
      if (buf.length < 4 + len) break;
      const kind = buf[4];
      const body = buf.subarray(5, 4 + len);
      buf = buf.subarray(4 + len);
      if (kind === KIND_VIDEO) onVideo(body);
      else if (kind === KIND_JSON) onJson(body);
      else throw new Error(`unknown kind 0x${kind.toString(16)}`);
    }
  } catch (e) {
    console.error(`test-client: protocol error: ${e.message}`);
    sock.destroy();
  }
});

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  for (const t of timers) { clearInterval(t); clearTimeout(t); }
  printStats();
  if (out) out.end(() => process.exit(code)); else process.exit(code);
}

sock.on('error', (e) => { console.error(`test-client: ${e.message}`); finish(1); });
sock.on('close', () => { console.log(`[${elapsed()}s] closed`); finish(0); });
process.on('SIGINT', () => { sock.destroy(); });
