// Sentence-case section header used above every bordered card group
// ("System status" / "Connection" / "Rules" / etc), matching macOS System
// Settings' group headings: 13px semibold primary text, 6px above the group
// (callers' section stacks use gap: 6).
export function GroupLabel({ children }: { children: string }) {
  return <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', paddingLeft: 2 }}>{children}</span>;
}
