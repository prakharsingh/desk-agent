import { useCallback, useEffect, useState } from 'react';
import type { Config } from '@desk-agent/config-schema';

// Renderer-side validation isn't needed here: window.deskAgent.setConfig
// round-trips through the main process's configStore.writeConfig, which
// validates against the real ConfigSchema before ever touching disk and
// rejects (never partially applies) an invalid write. This hook only needs
// the type, not the runtime schema.
export function useConfig() {
  const [config, setConfigState] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.deskAgent.getConfig().then((c) => {
      if (!cancelled) setConfigState(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistic: applies `next` to local state immediately (so a toggle/
  // stepper feels instant), then persists. On rejection, reverts to the
  // last-known-good config from the failed write's error path so the UI
  // never keeps showing a value that was never actually saved.
  const updateConfig = useCallback(async (next: Config) => {
    const previous = config;
    setConfigState(next);
    setSaving(true);
    setError(null);
    try {
      const written = await window.deskAgent.setConfig(next);
      setConfigState(written);
    } catch (err) {
      setConfigState(previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [config]);

  return { config, saving, error, updateConfig };
}
