import { useState } from 'react';
import type { StatusSnapshot } from '@desk-agent/core';
import { Switch } from '../ui/Switch.js';
import { GroupLabel } from '../ui/GroupLabel.js';
import { PushButton } from '../ui/PushButton.js';
import { accent, monoFontFamily, textColor } from '../theme.js';

// v1 scope, locked: read-only rule cards + engine pause/resume + per-rule
// enable/disable. No condition/action editing -- AutomationRule.condition is
// a non-serializable closure (packages/core/src/entrypoint.ts), and rule
// authoring was explicitly deferred per the Phase 0 control-channel
// contract's locked scope.

// `color` is the text color; `tint` (defaults to it) seeds the translucent
// background/border via color-mix so CSS-var tokens work too.
function RuleBadge({ text, color, tint = color }: { text: string; color: string; tint?: string }) {
  return (
    <span
      style={{
        fontFamily: monoFontFamily,
        fontSize: 11,
        padding: '3px 8px',
        borderRadius: 5,
        background: `color-mix(in srgb, ${tint} 13%, transparent)`,
        color,
        border: `0.5px solid color-mix(in srgb, ${tint} 33%, transparent)`,
      }}
    >
      {text}
    </span>
  );
}

const ENGINE_KEY = 'engine';

export function AutomationPane({ snapshot }: { snapshot: StatusSnapshot | null }) {
  // Keyed by 'engine' or a rule id -- tracks which specific toggle has an
  // in-flight IPC call, so toggling one rule only disables/dims that row
  // instead of freezing every other switch in the pane for the duration.
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());

  if (!snapshot) return <p>Waiting for the core to report in…</p>;

  async function withPending(key: string, action: () => Promise<void>) {
    setPendingKeys((prev) => new Set(prev).add(key));
    try {
      await action();
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const setEngineEnabled = (enabled: boolean) => withPending(ENGINE_KEY, () => window.deskAgent.setAutomationEnabled(enabled));
  const setRuleEnabled = (ruleId: string, enabled: boolean) => withPending(ruleId, () => window.deskAgent.setRuleEnabled(ruleId, enabled));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--group)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Automation engine</span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Event → condition → debounced action</span>
        </div>
        <Switch label="Automation engine" checked={snapshot.automation.enabled} onChange={setEngineEnabled} disabled={pendingKeys.has(ENGINE_KEY)} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text3)', paddingLeft: 2, lineHeight: 1.5 }}>
        These toggles take effect immediately — but every rule below only fires from real presence-sensor events sent
        by a docked, camera-active phone. With no phone reporting presence right now, nothing will visibly happen.
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>
            <GroupLabel>Rules</GroupLabel>
          </span>
          {/* Rule authoring is explicitly out of v1 scope (see top-of-file
              comment) -- no rule editor exists, so "Add Rule" is a real but
              disabled button with a "Coming soon" tooltip rather than
              text that merely looks clickable. */}
          <PushButton disabled title="Coming soon">
            + Add Rule
          </PushButton>
        </div>
        {snapshot.automation.rules.length === 0 && <p style={{ opacity: 0.6, fontSize: 13 }}>No rules configured.</p>}
        {snapshot.automation.rules.map((rule) => (
          <div
            key={rule.id}
            style={{
              background: 'var(--group)',
              border: '0.5px solid var(--border)',
              borderRadius: 10,
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              opacity: rule.enabled ? 1 : 0.5,
            }}
          >
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <RuleBadge text={rule.eventName} color={accent.cyan} />
              <span style={{ color: 'var(--text3)', fontSize: 13 }}>→</span>
              <RuleBadge text={rule.actionLabel} color={textColor('green')} tint="var(--green-fill)" />
              <span style={{ fontFamily: monoFontFamily, fontSize: 11, color: 'var(--text3)' }}>debounce {rule.debounceMs / 1000}s</span>
            </div>
            <Switch label={`Rule ${rule.eventName} → ${rule.actionLabel}`} checked={rule.enabled} onChange={(enabled) => setRuleEnabled(rule.id, enabled)} disabled={pendingKeys.has(rule.id)} />
          </div>
        ))}
      </div>
      {pendingKeys.size > 0 && <p style={{ fontSize: 12, opacity: 0.5 }}>Applying…</p>}
    </div>
  );
}
