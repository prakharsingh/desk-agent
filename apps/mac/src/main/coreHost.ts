// UtilityProcess entry point, forked by CoreSupervisor. run() reads
// DESK_AGENT_CONFIG_PATH from its own environment (set by the fork() call)
// and owns the entire core boot sequence itself.
//
// process.parentPort is Electron's UtilityProcess-side messaging handle
// (distinct from Node's own worker_threads.parentPort, which the core's OWN
// plugin workers use internally via workerEntry.ts -- unrelated channel).
// It's only ever defined when this file is actually running as a forked
// UtilityProcess, which is this file's entire purpose, so no guard/fallback
// is needed here the way run() itself stays transport-optional for its
// standalone `node` launch path.
import { run } from '@desk-agent/core';
import type { ControlTransport, ToApp, ToCore } from '@desk-agent/core';

const transport: ControlTransport = {
  postMessage: (msg: ToApp) => process.parentPort.postMessage(msg),
  onMessage: (handler: (msg: ToCore) => void) => {
    process.parentPort.on('message', (event) => handler(event.data as ToCore));
  },
};

run({ transport });
