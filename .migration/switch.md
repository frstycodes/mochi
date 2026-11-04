# switch

2026-11-04, golden-pair merge (1 conflict resolved by hand). The file was pristine apart from paths, so it now matches the base golden.

## Changed

- `apps/desktop/src/components/ui/switch.tsx`: imports `@base-ui/react/switch`; props are now `SwitchPrimitive.Root.Props & { size }`. Classes already used `data-checked`/`data-unchecked`/`data-disabled`.
- Consumers: none needed changes. Single-arg `onCheckedChange` handlers stay compatible.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" switch.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

Nothing.

## Behavior changes

- The root is a `<span role="switch">` plus a hidden input, not a `<button>`. `onCheckedChange` gains `eventDetails`.

## Verify by hand

- Settings > Remote: toggle each switch with the mouse and with Space. The thumb slides, and a disabled switch is dimmed.
