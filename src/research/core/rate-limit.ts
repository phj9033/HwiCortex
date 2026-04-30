export class DomainRateLimiter {
  private last: Map<string, number> = new Map();
  constructor(private qps: number) {}

  async acquire(host: string): Promise<void> {
    const minGap = 1000 / Math.max(this.qps, 0.001);
    const now = Date.now();
    const last = this.last.get(host) ?? 0;
    const wait = Math.max(0, last + minGap - now);
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    this.last.set(host, Date.now());
  }
}
