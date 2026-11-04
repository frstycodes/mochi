# item

2026-11-04, golden-pair merge (1 conflict resolved by hand). The file was pristine apart from import paths, so it now matches the base golden.

## Changed

- `apps/desktop/src/components/ui/item.tsx`: `Item` uses `useRender` + `mergeProps`, with `state: { slot: "item", variant, size }` (the same `data-*` attributes as before). Every other export is unchanged.
- `src/pane/NoPanes.tsx:81` and `:123`: `<Item asChild><button .../></Item>` -> `<Item render={<button ... />}>`, children moved up.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" item.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- `ItemSeparator` wraps the project Separator (migrated separately).

## Behavior changes

None.

## Verify by hand

- Close every pane: the "Running" port tiles and "Recent files" rows are buttons. Click and keyboard-activate both, and check the hover background.
