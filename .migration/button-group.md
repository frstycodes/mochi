# button-group

2026-11-04, golden-pair merge (1 conflict resolved by hand). The file was pristine apart from paths, so it now matches the base golden.

## Changed

- `apps/desktop/src/components/ui/button-group.tsx`: `ButtonGroupText` `asChild` -> `render` via `useRender` + `mergeProps`, with `state: { slot: "button-group-text" }`. Took the base golden's orientation classes as they are: rounding keyed on `[data-slot]` siblings (`*:data-slot:rounded-r-none`, `[&>[data-slot]~[data-slot]]:rounded-l-none border-l-0`) instead of `:first-child`/`:last-child`, and `group/button-group` dropped (grep: no `*/button-group` group variant is used anywhere).
- Consumers: none used `ButtonGroupText asChild`.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" button-group.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- `ButtonGroupSeparator`: unchanged, wraps the migrated Separator.

## Behavior changes

- `ButtonGroupText` now has `data-slot="button-group-text"`, so it takes part in the group's rounding and border collapse. Before, `:first-child`/`:last-child` rounded it.
- Rounding now skips children without a `data-slot` (e.g. hidden inputs that Base UI renders as siblings), where it used to count every child.

## Verify by hand

- Merge button (`git/MergeButton.tsx`), the message actions group, and the Add skills / Connect dialog groups: the outer corners are round, the inner joins are square, and there are no double borders. Check light and dark.
