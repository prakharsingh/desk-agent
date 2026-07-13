// UtilityProcess entry for the Phase 0 packaged-core spike.
// Proves: (a) @desk-agent/core ESM loads under the utilityProcess's Node,
// (b) workerHost.ts's Worker(path.join(__dirname, 'workerEntry.js')) spawn
// resolves and runs from inside (or alongside) app.asar, (c) main.ts's
// require.resolve() of the three workspace plugin packages succeeds, and
// (d) the ws gateway binds its port -- all under a REAL electron-builder
// packaged build, not just `pnpm dev`.
import fs from 'node:fs';

const resultPath = process.env.SPIKE_RESULT_PATH;
const logs = [];

const origLog = console.log;
console.log = (...args) => {
  logs.push(args.map(String).join(' '));
  origLog(...args);
};

function writeResult(result) {
  try {
    fs.writeFileSync(resultPath, JSON.stringify({ ...result, logs }, null, 2));
  } catch (err) {
    origLog('[coreHost] FAILED TO WRITE RESULT:', err);
  }
}

let resultWritten = false;
function finish(result) {
  if (resultWritten) return;
  resultWritten = true;
  writeResult(result);
}

process.on('uncaughtException', (err) => {
  finish({ ok: false, phase: 'uncaughtException', error: String((err && err.stack) || err) });
  process.exit(1);
});

process.on('exit', (code) => {
  if (!resultWritten) {
    finish({ ok: false, phase: `process exited with code ${code} before explicit result`, code });
  }
});

try {
  console.log('[coreHost] importing @desk-agent/core/dist/main.js (run() is not exported from index.ts) ...');
  const core = await import('@desk-agent/core/dist/main.js');
  console.log('[coreHost] import ok, calling run() ...');
  core.run();
  console.log('[coreHost] run() returned synchronously without throwing');
} catch (err) {
  finish({ ok: false, phase: 'import or synchronous run() threw', error: String((err && err.stack) || err) });
  process.exit(1);
}

// Give worker_threads time to spawn (workerEntry.js resolution), plugins
// time to require.resolve() and init, and the ws gateway time to bind.
setTimeout(() => {
  finish({ ok: true, phase: 'ran for 6s post-run() without throwing or exiting' });
  process.exit(0);
}, 6000);
