# Desk Agent OS Wiki

An old Android phone, docked next to a Mac, becomes a live desk dashboard and
an honest presence sensor that auto-sleeps the display when you're genuinely
away — no camera footage ever leaves the phone.

Start with the [README](https://github.com/prakharsingh/desk-agent#readme)
and [SETUP.md](https://github.com/prakharsingh/desk-agent/blob/main/SETUP.md)
in the main repo for install/run instructions. Contributors should start at
[docs/ONBOARDING.md](https://github.com/prakharsingh/desk-agent/blob/main/docs/ONBOARDING.md)
— a guided codebase tour. This wiki covers the deeper "why" that doesn't
belong in day-to-day docs.

## Pages

- **[Architecture](Architecture)** — the two-runtime design, the honest-signal
  protocol, and why fusion/hysteresis lives on the Mac, not the phone.
- **[Roadmap](Roadmap)** — the full multi-slice vision and what's shipped vs.
  planned.
- **[Hardware](Hardware)** — the specific devices this has been built and
  tested against, and why camera/thermal/OS-survival behavior is
  device-specific.
- **[Protocol Reference](Protocol-Reference)** — the wire message schema.
- **[Troubleshooting](Troubleshooting)** — common failure modes and fixes.

## Versioning

Releases are tagged `vMAJOR.MINOR.PATCH`; each roadmap "slice" ships as a
minor version. See [CHANGELOG.md](https://github.com/prakharsingh/desk-agent/blob/main/CHANGELOG.md)
in the main repo for what shipped in each release.
