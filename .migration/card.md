# card

2026-11-04, engine (no radix golden delta: stock radix-nova and base-nova card are identical and have no Slot). The user had added `asChild` via `Slot`. That customization is migrated to `render` with `useRender` + `mergeProps`.

## Changed

- `apps/desktop/src/components/ui/card.tsx`: `Card` takes `render` instead of `asChild` and uses `useRender` with `state: { slot: "card", size }`, so `data-slot`/`data-size` stay. Props are now `useRender.ComponentProps<"div"> & { size? }`. Every other export is unchanged.
- Consumers, `asChild` + child element -> `render={<el ... />}`, children moved up:
  - `src/settings/sections/access.tsx:121` (`<label htmlFor>`)
  - `src/settings/sections/appearance.tsx:178` (`<button>`; another agent had already rewritten `data-[state=open]` to `data-popup-open` here)
  - `src/secondOpinion/SecondOpinionRow.tsx:141` (`<section>`)
  - `src/rewind/CompareForks.tsx:110` (`<section>`)
  - `src/replay/ReplayView.tsx:244` (`<aside>`)
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" card.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- `src/SummaryPanel.tsx`: `AccordionItem render={<Card/>}` is the accordion family's.

## Behavior changes

None.

## Verify by hand

- Settings > Access: clicking anywhere on a level card selects its radio.
- Settings > Appearance: a theme card opens the picker and gets its open-state border.
- The second-opinion card, compare-forks cards and the replay files aside render as section/aside (check in devtools).
