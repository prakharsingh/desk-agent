import fs from 'node:fs';
const HB = '/tmp/spike-heartbeat.log';
fs.writeFileSync(HB, '');
const hb = (msg) => fs.appendFileSync(HB, `${Date.now()} ${msg}\n`);
hb('TOP-LEVEL SPIKE MAIN.JS EXECUTING');

import { app, utilityProcess } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
hb('IMPORTS DONE, electron version ' + process.versions.electron);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

hb('app.isReady() = ' + app.isReady());

app.disableHardwareAcceleration();
if (app.dock) app.dock.hide();
hb('disableHardwareAcceleration + dock.hide done');

app.on('ready', () => hb('legacy "ready" event fired'));

const resultPath = path.join(os.tmpdir(), 'desk-agent-spike-result.json');
const stdioPath = path.join(os.tmpdir(), 'desk-agent-spike-stdio.log');
try { fs.unlinkSync(resultPath); } catch {}
try { fs.unlinkSync(stdioPath); } catch {}

hb('registering whenReady().then()');
app.whenReady().then(() => {
  hb('whenReady RESOLVED');
  const configPath = path.join(os.tmpdir(), `spike-config-${Date.now()}.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    enabledPlugins: ['system-stats', 'weather', 'energy-saver'],
    weather: { location: 'Seattle' },
    presenceDebounceMs: 10000,
    wsPort: 8799,
  }));
  hb('config written, forking utilityProcess for ' + path.join(__dirname, 'coreHost.js'));

  const child = utilityProcess.fork(path.join(__dirname, 'coreHost.js'), [], {
    env: { ...process.env, DESK_AGENT_CONFIG_PATH: configPath, SPIKE_RESULT_PATH: resultPath },
    stdio: 'pipe',
  });
  hb('utilityProcess.fork() called, pid=' + child.pid);

  let out = `[spike] electron version: ${process.versions.electron}\n[spike] node version: ${process.versions.node}\n[spike] __dirname: ${__dirname}\n[spike] resourcesPath: ${process.resourcesPath}\n`;
  child.stdout?.on('data', (d) => { out += d.toString(); hb('child stdout chunk'); });
  child.stderr?.on('data', (d) => { out += d.toString(); hb('child stderr chunk'); });

  const finish = () => {
    fs.writeFileSync(stdioPath, out);
    hb('finish() called, wrote stdio log, quitting soon');
    setTimeout(() => app.quit(), 100);
  };

  child.on('spawn', () => hb('child spawn event'));
  child.on('exit', (code) => {
    hb('child exit event code=' + code);
    out += `\n[spike] utilityProcess exited with code ${code}\n`;
    finish();
  });
  child.on('error', (err) => hb('child error event: ' + String(err)));

  // Safety-net hard timeout in case the child hangs without exiting.
  setTimeout(() => {
    hb('hard timeout reached');
    out += '\n[spike] hard timeout reached, killing child\n';
    try { child.kill(); } catch {}
    finish();
  }, 8000);
}).catch((err) => {
  hb('whenReady REJECTED: ' + String((err && err.stack) || err));
});

app.on('window-all-closed', () => {
  hb('window-all-closed fired (ignored)');
});
app.on('will-quit', () => hb('will-quit fired'));
process.on('uncaughtException', (err) => hb('uncaughtException: ' + String((err && err.stack) || err)));
process.on('unhandledRejection', (err) => hb('unhandledRejection: ' + String((err && err.stack) || err)));
