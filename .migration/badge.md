# badge

2026-11-04, golden-pair merge (2 conflicts resolved by hand). Migrated to `useRender` + `mergeProps`. The user's `tone` variant and its "tone replaces variant" logic survive.

## Changed

- `apps/desktop/src/components/ui/badge.tsx`: `Slot`/`asChild` -> `useRender({ defaultTagName: "span", render, props: mergeProps(...), state: { slot: "badge", variant, tone } })`. State becomes `data-slot`, `data-variant` (left out when `tone` is set) and `data-tone`; undefined state keys are skipped (`internals/getStateAttributesProps.js`). Props are now `useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>`.
- Consumers: none used `asChild` on Badge.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" badge.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- The `rounded-sm` base radius: the user's customization (the golden uses `rounded-4xl`).

## Behavior changes

None.

## Verify by hand

- A toned badge (e.g. a warning tone in settings) and a plain variant badge render with the same colors as before, in light and dark.
