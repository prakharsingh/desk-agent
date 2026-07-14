# What & why

<!-- Especially the WHY for anything touching presence detection — the
     reasoning behind a threshold or fail-safe direction matters more than
     the diff. See CONTRIBUTING.md. -->

## Checklist

- [ ] Tests written first; new behavior has a failing-then-passing test
- [ ] `pnpm build && pnpm test` clean (there is no CI — this local run is the gate)
- [ ] `cd apps/android && pnpm test:components` clean, if `apps/android/` `.tsx` was touched
- [ ] Conventional-commit style messages (`feat:`, `fix:`, `docs:`, …)

## Extra-scrutiny surfaces (delete if untouched)

- [ ] `presenceEngine.ts` — reasoning for the change explained above
- [ ] `packages/protocol/src/schema.ts` — additive only, or breaking change called out explicitly
- [ ] `EXEC_ALLOWLIST` / plugin capability surface — new entries justified + tested

## Hardware verification

<!-- If this touches camera, tunnel, wake, or OEM-kill behavior: what did you
     verify on a real device (which device?), and what remains unverified?
     "Not hardware-verified" is an acceptable answer if stated. -->
