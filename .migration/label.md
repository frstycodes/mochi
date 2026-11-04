# label

2026-11-04, golden-pair merge (1 conflict resolved by hand). Native `<label>`, no primitive.

## Changed

- `apps/desktop/src/components/ui/label.tsx`: `LabelPrimitive.Root` -> `<label>`, props `React.ComponentProps<"label">`. Classes are unchanged, and `select-none` covers Radix's double-click selection guard.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" label.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- The `peer-disabled:*` classes: kept per the golden. See behavior changes.

## Behavior changes

- `peer-disabled:cursor-not-allowed peer-disabled:opacity-50` no longer fires when the peer is a Base UI Checkbox/Switch/Radio. Those render a `<span data-disabled>`, not a `<button disabled>`. It still works next to native inputs. Flagged; the fix would be adding `peer-data-disabled:*`.

## Verify by hand

- A Label next to a disabled switch or checkbox: check whether the dimming is still wanted. It no longer applies.
- Clicking a Label with `htmlFor` still toggles its control.
