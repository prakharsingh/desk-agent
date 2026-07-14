# Desk Agent — design-review fixes

Drop-in replacements. Paths mirror the repo, so copy the tree over `desk-agent/`
(each file lands at its existing location). No new dependencies; no API changes.

## Files changed

- `app/src/display/systemFormat.ts` — **new helpers** `loadColor()` and `formatBattery()`.
- `app/src/display/AppShell.tsx`
- `app/src/display/HomeScreen.tsx`
- `app/src/display/screens/SystemDetail.tsx`
- `app/src/display/screens/NowPlayingDetail.tsx`

## What each fix does

1. **Home ghost text / afterimage bleed** — added `overflow:'hidden'` to the
   root and body in `AppShell`, so the OLED pixel-shift transform can no longer
   leave a drifted copy of scrolled content painting past the viewport edges.

2. **Chin Light not full-bleed (top bar + right gutter)** — in `AppShell` the
   Header is now hidden on the `light` screen (as it already was for `idle`),
   and the pixel-shift transform is pinned to `{0,0}` while the light screen is
   showing. The solid fill now runs edge-to-edge, top to bottom, with no dark
   sliver. (Skipping drift here is safe: the screen is bright and time-boxed to
   30 min.)

3. **RAM/CPU look alarming or broken** — `loadColor()` tints a bar + its
   sparkline amber (`warn`) at ≥90%, so a sustained ~99% RAM reads as an
   intentional "running hot" state instead of the same neutral colour as idle.
   Amber, not red — elevated utilisation is a normal steady state, not a fault.
   Applied in both `HomeScreen` and `SystemDetail`.

4. **Now Playing empty state** — the home tile no longer shows the raw
   `"unavailable"` wire sentinel (which truncated mid-word); it shows `Idle`.
   The detail screen gets a composed, vertically-centred empty state
   (`NOTHING PLAYING · Music.app · idle`) instead of `"unavailable"` + a dash
   floating at the top of a black void.

5. **Battery "N/A"** — `formatBattery()` maps the docked-phone `N/A`/`—`
   sentinels to `AC · DOCKED`, so a permanently-powered device doesn't read
   like a failed sensor. Real percentages pass through untouched.

## Notes / not changed

- The RAM **sparkline flatline** reflects real data: RAM genuinely sits pinned
  near 99%, and the sparkline auto-scales to the window's min/max, so a nearly
  constant series flattens (honest behaviour). The amber tint is the fix for
  perception; the shape is truthful.
- Clock/System detail negative space was left as intentional calm space rather
  than padded with fabricated rows — the codebase's honest-placeholder rule
  means we don't invent disk/network/etc. metrics that aren't on the wire.
