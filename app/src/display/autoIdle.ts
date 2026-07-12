export function shouldAutoIdle(msSinceActivity: number, graceMs: number): boolean {
  return msSinceActivity >= graceMs;
}
