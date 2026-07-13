// Generic debounce, used to coalesce rapid config:set IPC calls (e.g. a user
// clicking a stepper's +/- repeatedly) into a single core restart instead of
// restarting -- and briefly dropping the phone's WS connection -- on every
// single click.
export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}
