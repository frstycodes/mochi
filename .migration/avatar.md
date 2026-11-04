# avatar

2026-11-04, golden-pair merge (1 conflict resolved by hand). The file was pristine apart from paths, so it now matches the base golden.

## Changed

- `apps/desktop/src/components/ui/avatar.tsx`: imports `@base-ui/react/avatar`; props are now `AvatarPrimitive.Root|Image|Fallback.Props`. `AvatarBadge`/`AvatarGroup`/`AvatarGroupCount` are unchanged.
- Consumers: no `delayMs` or `asChild` anywhere.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" avatar.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

Nothing.

## Behavior changes

None.

## Verify by hand

- An avatar with a broken image URL falls back to initials, and one with a valid image shows the image.
