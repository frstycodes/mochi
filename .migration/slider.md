# slider

2026-11-04, golden-pair merge (2 conflicts resolved by hand). Migrated to `Root > Control > Track > Indicator` plus Thumbs, with `thumbAlignment="edge"` (golden). User customizations kept: the 16px thumb and `aria-label` forwarded to each thumb (Base forwards it to the thumb's `<input type="range">`, `slider/thumb/SliderThumb.js:246`).

## Changed

- `apps/desktop/src/components/ui/slider.tsx`:
  - imports `@base-ui/react/slider`; `Range` -> `Indicator`; the new `Control` part carries the old root layout classes, and the root gets `data-horizontal:w-full data-vertical:h-full`
  - thumb `disabled:*` -> `data-disabled:*` (the thumb is a `<div>`)
  - the thumb comment no longer mentions Radix
  - deviation from the golden: the wrapper is generic, `Slider<Value extends number | readonly number[]>(props: SliderPrimitive.Root.Props<Value>)`, so `onValueChange` gets `number[]` when `value` is an array. Existing `([v]: number[]) => ...` / `setValue` handlers then type-check without casts.
- Consumers: `src/design/DesignPage.tsx:~1565` and `src/design/sections/inputs.tsx:~413` needed no edits. There is no `onValueCommit`, `inverted` or `minStepsBetweenThumbs` anywhere.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" slider.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- Thumbs get no `index` prop (golden). It only matters for SSR of range sliders.

## Behavior changes

- `onValueChange` gains `eventDetails`.
- `thumbAlignment="edge"`: the thumb stays inside the track at min and max.
- The commit callback is now `onValueCommitted`, and it does not fire when the value is unchanged (unused here).

## Verify by hand

- Design page > Slider: drag, click the track, and use the arrow keys. The value label updates, and the thumb stays inside the track at 1 and 12.
- Design page toast "Slow motion" slider: dragging changes `--toast-slowmo`.
