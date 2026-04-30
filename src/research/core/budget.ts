type BudgetCfg = {
  max_new_urls: number;
  max_total_bytes: number;
  max_llm_cost_usd: number;
};

export class Budget {
  private urls = 0;
  private bytes = 0;
  private cost = 0;
  private byModel: Record<string, number> = {};

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

  tryAddCost(model: string, usd: number): boolean {
    if (this.cost + usd > this.cfg.max_llm_cost_usd) return false;
    this.cost += usd;
    this.byModel[model] = (this.byModel[model] ?? 0) + usd;
    return true;
  }

  report(): {
    urls: number;
    bytes: number;
    cost_usd_total: number;
    cost_usd_by_model: Record<string, number>;
  } {
    return {
      urls: this.urls,
      bytes: this.bytes,
      cost_usd_total: this.cost,
      cost_usd_by_model: { ...this.byModel },
    };
  }
}
