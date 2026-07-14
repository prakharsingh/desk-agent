# How to add a widget

A widget is data published by a Mac-side plugin and rendered by the phone
from its own fixed set of renderers. Plugins never ship UI code — they
publish declarative `{ type, props }` objects; the phone decides how (and
whether) to draw them. Adding a widget therefore touches up to four places:

```
plugin (publishes)  →  protocol (catalog)  →  config-schema (visibility default)  →  phone app (renders)
```

## 1. Publish the data (Mac side)

Your plugin calls `ctx.publishWidget(widgetId, { type, props })` whenever the
data changes, and returns the same current state from `getWidgets()` (that's
what answers the phone's `hello` snapshot on every connect — cached state,
never placeholders). See [writing-a-plugin.md](writing-a-plugin.md).

Keep `props` honest and flat: the phone's readers are defensive (missing
fields render as `—`), and the display deliberately never fabricates data
the wire didn't carry — e.g. Now Playing shows no artist because no artist
crosses the wire. Follow that: if you don't have a value, omit it; don't
invent it.

## 2. Add the tile to the catalog (protocol)

`WIDGET_IDS` in `packages/protocol/src/schema.ts` is the single source of
truth for Home-screen tiles (`clock`, `system`, `weather`, `presence`,
`playing`, `light`). Add your id there. That automatically:

- includes it in `visibleWidgets`' default (the config-schema seeds from
  `WIDGET_IDS`), and
- makes it toggleable from the Mac app's Widgets pane.

Adding a widget id/type is **additive** — do not bump `PROTOCOL_VERSION`.

## 3. Render it (phone side)

In `apps/android/src/`:

1. **Reader** — add a `read<YourWidget>()` to
   `apps/android/src/display/widgetReaders.ts`: pull typed values out of
   `widget.props` defensively (`null`/`—` on anything missing). Write its
   Vitest test first; the existing readers show the pattern, including
   details like "an absent weather widget is treated as stale" — never claim
   LIVE for data you don't have.
2. **Renderer resolution** — add your `widget.type` to `KNOWN_KINDS` in
   `apps/android/src/widgets/renderWidget.ts` so it stops resolving to `'broken'`.
3. **Home card** — add a card in `apps/android/src/display/HomeScreen.tsx`, gated by
   `isVisible('<your-id>')` like the existing cards, using the `ui/`
   primitives (`Card`, `Badge`, `IconChip`, `Sparkline`, …) and the shared
   `theme.ts` — don't invent new colors/spacing.
4. **Detail screen (optional)** — if the card should tap through, add a
   screen under `apps/android/src/display/screens/`, a `Screen` union member +
   transitions in `screens.ts`, and the switch case in `AppShell.tsx`.

Testing split (see `AGENTS.md`): pure logic (readers, formatters,
geometry) → `.ts` + Vitest; genuinely view-level behavior (conditional
rendering, tap wiring) → `.tsx` + Jest in `apps/android/` (`pnpm test:components`,
and remember `render()`/`fireEvent.press()` are async there).

## 4. Verify end to end

```bash
pnpm build && pnpm test        # Vitest green
cd apps/android && pnpm test:components # Jest green
pnpm android                   # on-device: card renders with live values,
                               # toggles off from the Mac Widgets pane,
                               # unknown data degrades to — not garbage
```

There's no CI — the local runs plus an on-device check are the gate. If the
widget involves new hardware-dependent behavior, add a line to SETUP.md's
manual E2E checklist.
