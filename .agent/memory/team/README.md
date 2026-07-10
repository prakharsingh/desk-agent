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
