# Team memory

This is the one subtree of `.agent/` that is not gitignored. Everything
else under `.agent/` — personal preferences, working state, the raw
episodic log, staged candidates, and the local semantic layer — lives on
one machine and never leaves it. Content placed here is committed and
shows up for every teammate who clones the repo.

## What belongs here

Durable, reviewed knowledge that the whole team should start every session
already knowing: architectural decisions, hard-won project constraints,
conventions that took a real incident to learn. The bar is "would a
teammate want this the moment they open this repo," not "did the dream
cycle stage it."

## What does not belong here

- Raw or staged candidates (`memory/candidates/`) — those are personal and
  unreviewed.
- The local semantic layer (`memory/semantic/LESSONS.md`,
  `DECISIONS.md`) — promote from there deliberately, by hand, once
  something is worth sharing. Don't mirror it wholesale.
- Anything with secrets, credentials, or machine-specific paths.

## How to add something

There is no automated promotion path yet — copy the specific note over by
hand and commit it like any other project file. If this fills up with
real content, a dedicated file per topic (e.g. `DECISIONS.md`) will make
more sense than one growing `README.md`.

## Known constraints

**Harness-native worktree tools (Claude Code's `EnterWorktree`/
`ExitWorktree`, and similarly any tool that shells out to `git worktree`
without this repo's PATH-scoped shim) bypass `.direnv-bin/git`'s merge
logic on BOTH sides of a worktree's lifecycle** — not just seeding on
`add`, but also merging gitignored agent-memory (`.agent/`,
`.superpowers/`, `docs/**/{plans,specs,enhancements}`) back into
canonical on `remove`. If you use one of these tools instead of a plain
shell `git worktree add`/`remove` (with the shim actually on `PATH` —
`direnv allow` once per checkout), verify seeding happened right after
entering (check `.agent/memory/working/` is non-empty), and manually
rsync gitignored memory back into canonical before removal, mirroring
`.direnv-bin/git`'s own `seed_agent`/`merge_agent` steps. Confirmed live
2026-07-13 on both sides in the same session.

**`gradlew app:installDebug`/`app:packageDebug` must be passed
`-PreactNativeDevServerPort=<port>` whenever Metro isn't running on the
default 8081** (e.g. because 8081 was already occupied by something
else). Without it, the installed debug APK silently bakes in the
default port, launches fine, connects its own WebSocket fine, and
renders a stale/wrong JS bundle with no visible error — nothing in
logcat flags it. Confirmed live 2026-07-13 while verifying UI changes
on a physical OnePlus 6T.
