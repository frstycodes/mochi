# toggle

2026-11-04, golden-pair merge (1 conflict resolved by hand). Migrated to the callable `@base-ui/react/toggle`. User customizations kept: the `outline` pressed styling and the `sm` size.

## Changed

- `apps/desktop/src/components/ui/toggle.tsx`: `TogglePrimitive.Root` -> `TogglePrimitive` (`TogglePrimitive.Props`). `data-[state=on]:*` -> `data-pressed:*` in the base class and the outline variant. The golden keeps the dead `data-[state=on]`; I rewrote it so the user's outline-pressed look still applies.
- `src/settings/CatalogRow.tsx:300`: `WARNING_TOGGLE` `data-[state=on]:*` -> `data-pressed:*` (applied to SettingsChoice toggle items).
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" toggle.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- The `aria-pressed:bg-muted` class: still valid.

## Behavior changes

- `onPressedChange` gains `eventDetails`.

## Verify by hand

- Any outline toggle group (settings choices): the pressed item shows the foreground border and text. Warning-tone options show the warning tint when pressed. Check light and dark.
