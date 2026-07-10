export interface AutomationRule {
  id: string;
  eventName: string;
  condition: (data: Record<string, unknown>) => boolean;
  debounceMs: number;
  action: { pluginId: string; action: string; args?: Record<string, unknown> };
}

export interface ActionInvoker {
  invoke(pluginId: string, action: string, args?: Record<string, unknown>): void;
}

export class AutomationEngine {
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private enabled = true;

  constructor(
    private rules: AutomationRule[],
    private invoker: ActionInvoker,
    private log: (level: string, message: string) => void,
  ) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      for (const timer of this.debounceTimers.values()) clearTimeout(timer);
      this.debounceTimers.clear();
    }
  }

  handleEvent(eventName: string, data: Record<string, unknown>) {
    if (!this.enabled) return;
    for (const rule of this.rules) {
      if (rule.eventName !== eventName) continue;
      this.evaluateRule(rule, data);
    }
  }

  private evaluateRule(rule: AutomationRule, data: Record<string, unknown>) {
    try {
      const conditionHolds = rule.condition(data);
      if (!conditionHolds) {
        const existing = this.debounceTimers.get(rule.id);
        if (existing) {
          clearTimeout(existing);
          this.debounceTimers.delete(rule.id);
        }
        return;
      }
      if (this.debounceTimers.has(rule.id)) return;
      const timer = setTimeout(() => {
        this.debounceTimers.delete(rule.id);
        try {
          this.invoker.invoke(rule.action.pluginId, rule.action.action, rule.action.args);
        } catch (err) {
          this.log('error', `rule ${rule.id} action invocation failed: ${String(err)}`);
        }
      }, rule.debounceMs);
      this.debounceTimers.set(rule.id, timer);
    } catch (err) {
      this.log('error', `rule ${rule.id} condition evaluation failed: ${String(err)}`);
    }
  }
}
