# separator

2026-11-04, golden-pair merge (1 conflict resolved by hand). The file was pristine apart from paths, so it now matches the base golden (callable `SeparatorPrimitive`).

## Changed

- `apps/desktop/src/components/ui/separator.tsx`: imports `@base-ui/react/separator`; props are now `SeparatorPrimitive.Props`; the `decorative = true` default and prop are removed. The `data-horizontal`/`data-vertical` classes still match (`data-orientation` is emitted, and shadcn's `tailwind.css` maps the variants).
- Consumers: no `decorative` prop anywhere.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" separator.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- `ItemSeparator`, `ButtonGroupSeparator`, and other wrappers composing Separator: unchanged.

## Behavior changes

- Every Separator is now semantic (`role="separator"`). The old wrapper defaulted to `decorative`, which Radix rendered as `role="none"`, so screen readers now announce separators that were hidden before. Flagged. For a purely visual rule, use `aria-hidden` or a plain div.

## Verify by hand

- Separators in menus, items and button groups look the same, horizontal and vertical.
- With VoiceOver, check whether the extra "separator" announcements are acceptable.
