import { useEffect, useState } from 'react';
import type { StatusSnapshot, LogEntry } from '@desk-agent/core';

// Mirrors useConfig.ts's pattern: fetch-on-mount for immediate real data
// (status:getSnapshot/status:getLogs answer from the main process's cache,
// so this works even if the renderer mounts between the core's periodic
// pushes), then subscribe to live pushes for updates.
export function useStatus() {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  // When `snapshot` was received (Date.now()), not the core's own uptimeMs --
  // lets OverviewPane interpolate uptime locally between the core's 5s
  // snapshot pushes instead of the displayed clock jumping in 5-second steps.
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.deskAgent.getSnapshot().then((s) => {
      if (!cancelled) {
        setSnapshot(s);
        setSnapshotAt(Date.now());
      }
    });
    window.deskAgent.getLogs().then((l) => {
      if (!cancelled) setLogs(l);
    });
    const unsubscribe = window.deskAgent.onStatusMessage((msg) => {
      if (msg.kind === 'snapshot') {
        setSnapshot(msg.data);
        setSnapshotAt(Date.now());
      } else if (msg.kind === 'log') {
        setLogs((prev) => [...prev, msg.entry]);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { snapshot, snapshotAt, logs };
}
