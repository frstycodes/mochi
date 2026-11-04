# radio-group

2026-11-04, golden-pair merge (2 conflicts resolved by hand). Migrated: the group comes from `@base-ui/react/radio-group` (callable), items from `@base-ui/react/radio`. User customizations kept: the shared `RADIO_CLASS`, the `RadioDot` component, and the `RadioMark` export (used by `questionnaire.tsx`, same signature).

## Changed

- `apps/desktop/src/components/ui/radio-group.tsx`:
  - `RadioGroupPrimitive.Root` -> `RadioGroupPrimitive` (`RadioGroupPrimitive.Props`)
  - `Item`/`Indicator` -> `RadioPrimitive.Root`/`RadioPrimitive.Indicator` (`RadioPrimitive.Root.Props`)
  - `disabled:*` -> `data-disabled:*`, because the root is now a `<span>`
  - `RadioMark` emits `data-checked`/`data-unchecked` instead of `data-state`
- Consumers: no prop changes needed (no `orientation`/`loop` in use). `onValueChange` handlers take one argument and stay compatible.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" radio-group.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- `src/settings/sections/access.tsx` RadioGroup usage: the Card around it is covered in card.md.

## Behavior changes

- `orientation`/`loop`/`dir` no longer exist. Arrow keys move along both axes, and focus wrapping can't be configured.
- Items render `<span role="radio">` plus a hidden input. `onValueChange` gains `eventDetails`.

## Verify by hand

- Settings > Access: arrow keys move between the three levels, and the selected card highlights.
- Questionnaire single-choice: the `RadioMark` dot shows on the chosen option.
