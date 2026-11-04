# progress

2026-11-04, golden-pair merge (2 conflicts resolved by hand). Migrated to the base golden anatomy `Root > Track > Indicator`, plus new `ProgressTrack`, `ProgressIndicator`, `ProgressLabel` and `ProgressValue` exports. User customization kept: the indicator color reads `var(--progress-color, var(--primary))`.

## Changed

- `apps/desktop/src/components/ui/progress.tsx`: replaced with the base golden. The manual `translateX` is gone, because Base sets the indicator's inline `width: N%` (`progress/indicator/ProgressIndicator.js:33`). The root class is now `flex flex-wrap gap-3`, and the old root classes moved to `ProgressTrack`.
- Consumers: `className` on `Progress` now lands on the root, not the bar, so track overrides were re-targeted:
  - `src/ContextRing.tsx:132` and `src/usage/LimitBars.tsx:50`: `bg-muted-foreground/20` -> `*:data-[slot=progress-track]:bg-muted-foreground/20`
  - `src/components/ai-elements/context.tsx:182`: removed `className="bg-muted"`, which equals the track default and would otherwise paint a square-cornered root behind the rounded track
  - `--progress-color` inline styles on the root still cascade to the indicator
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" progress.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

Nothing.

## Behavior changes

- The fill animates `width` instead of `transform`, through the same `transition-all`.
- `data-state`/`data-value`/`data-max` became `data-progressing`/`data-complete`/`data-indeterminate`. No consumer read them.

## Verify by hand

- Context ring popover and Usage limit bars: the bar track is the faint muted tone with rounded ends, the fill color follows the tone (ok/warn/danger), and it animates when the value changes. Check light and dark.
