import type { LogLevel } from '@desk-agent/plugin-sdk';

export interface AutomationRule {
  id: string;
  eventName: string;
  condition: (data: Record<string, unknown>) => boolean;
  debounceMs: number;
  action: { pluginId: string; action: string; args?: Record<string, unknown> };
}

// Display-only view of a rule for the state-surface (Automation pane, Phase
// 3 v1 = read + per-rule enable/disable, per the locked scope in
// docs/superpowers/specs/2026-07-13-phase0-control-channel-contract.md). No
// `condition`/`action` here -- condition is a non-serializable closure and
// editing either is explicitly out of scope for v1.
export interface AutomationRuleView {
  id: string;
  eventName: string;
  actionLabel: string;
  debounceMs: number;
  enabled: boolean;
}

export interface ActionInvoker {
  invoke(pluginId: string, action: string, args?: Record<string, unknown>): void;
}

export class AutomationEngine {
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private enabled = true;
  private disabledRuleIds = new Set<string>();

  constructor(
    private rules: AutomationRule[],
    private invoker: ActionInvoker,
    private log: (level: LogLevel, message: string) => void,
  ) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      for (const timer of this.debounceTimers.values()) clearTimeout(timer);
      this.debounceTimers.clear();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getRules(): AutomationRuleView[] {
    return this.rules.map((rule) => ({
      id: rule.id,
      eventName: rule.eventName,
      actionLabel: `${rule.action.pluginId} · ${rule.action.action}`,
      debounceMs: rule.debounceMs,
      enabled: !this.disabledRuleIds.has(rule.id),
    }));
  }

  setRuleEnabled(id: string, enabled: boolean) {
    if (enabled) {
      this.disabledRuleIds.delete(id);
      return;
    }
    this.disabledRuleIds.add(id);
    // Cancel a debounce already armed by an evaluation that ran before this
    // call -- otherwise a rule disabled mid-debounce still fires once.
    const existing = this.debounceTimers.get(id);
    if (existing) {
      clearTimeout(existing);
      this.debounceTimers.delete(id);
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
    if (this.disabledRuleIds.has(rule.id)) return;
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
