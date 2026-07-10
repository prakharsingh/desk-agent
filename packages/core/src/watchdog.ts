export class Watchdog {
  private timer?: NodeJS.Timeout;
  private firedThisSilence = false;

  constructor(private timeoutMs: number, private onMissed: () => void) {}

  start() {
    this.arm();
  }

  stop() {
    clearTimeout(this.timer);
  }

  pulse() {
    this.firedThisSilence = false;
    this.arm();
  }

  private arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.firedThisSilence) {
        this.firedThisSilence = true;
        this.onMissed();
      }
    }, this.timeoutMs);
  }
}
