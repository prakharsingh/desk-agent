// Uppercase small-caps section header used above every bordered card group
// (SYSTEM STATUS / CONNECTION / RULES / etc) -- was independently
// reimplemented in six different pane files before being extracted here.
export function GroupLabel({ children }: { children: string }) {
  return <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', letterSpacing: 0.2, paddingLeft: 2 }}>{children}</span>;
}
