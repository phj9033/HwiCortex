type BudgetCfg = {
  max_new_urls: number;
  max_total_bytes: number;
};

export class Budget {
  private urls = 0;
  private bytes = 0;

  constructor(private cfg: BudgetCfg) {}

  tryAddUrl(): boolean {
    if (this.urls >= this.cfg.max_new_urls) return false;
    this.urls += 1;
    return true;
  }

  tryAddBytes(n: number): boolean {
    if (this.bytes + n > this.cfg.max_total_bytes) return false;
    this.bytes += n;
    return true;
  }

  report(): { urls: number; bytes: number } {
    return { urls: this.urls, bytes: this.bytes };
  }
}
