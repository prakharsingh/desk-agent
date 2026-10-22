import { useEffect, useState } from 'react';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Tracks the macOS appearance. main sets nativeTheme.themeSource = 'system',
 * so prefers-color-scheme mirrors System Settings > Appearance and fires a
 * change event when the user (or Auto) switches it.
 */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/**
 * Whether the settings window is the key window -- drives the sidebar's
 * selection style (accent when focused, neutral gray when not), like native
 * macOS source lists.
 */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    setFocused(document.hasFocus());
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return focused;
}
