# select

2026-11-04, golden pair (stock radix-nova / base-nova) with the user's customizations replayed by hand. Verdict: migrated to `@base-ui/react/select`; typecheck clean for the wrapper and every consumer touched.

## Changed

- `apps/desktop/src/components/ui/select.tsx`: `Select = SelectPrimitive.Root` (bare re-export, golden). Content is `Portal > Positioner (isolate z-50) > Popup > ScrollUpArrow / List (p-1.5) / ScrollDownArrow`, forwarding `align`/`alignOffset`/`side`/`sideOffset`/`alignItemWithTrigger`. The user's radix defaults are preserved: `position="popper"` becomes `alignItemWithTrigger = false`, `align = "start"`, and the old `translate-y-1` side nudge becomes `sideOffset = 4`. Label -> `GroupLabel`, Viewport -> List, ScrollUp/DownButton -> ScrollUp/DownArrow, Icon `asChild` -> `render`. Item anatomy: ItemText first, then ItemIndicator rendered into the user's `right-2.5` span. Kept: `animate-pop`, `shadow-overlay`, trigger classes (`data-[size=sm]:rounded-md`), `p-1.5`, `mx-2 my-1.5` separator, `@/icons`. Removed the unused `React` import.
- Width (user request): Popup is `w-(--anchor-width) min-w-44`. It still matches the trigger, with an 11rem floor (was `min-w-36`).
- Consumers. Base UI `Select.Value` renders the raw value unless Root gets `items` or Value gets a children function (verified in `select/value/SelectValue.d.ts`), so every `<SelectValue />` here would have shown ids:
  - `settings/parts.tsx` SettingsSelect: `items={options}`. Its doc comment now says Base UI.
  - `usage/UsagePage.tsx`, `remote/MachineSettings.tsx` (label keeps the DeviceIcon), `browser/Toolbar.tsx` (`DEVICE_ITEMS`, `DPR_ITEMS` constants), `design/sections/inputs.tsx`: `items`.
  - `pane/SimulatorTab.tsx`: SelectValue children function rendering a new `SimulatorLabel` (family icon and name; Radix showed the item's own content with the runtime hidden via `in-data-[slot=select-trigger]:hidden`). Removed `position="popper" align="start"`, which are now the wrapper defaults.
- `onValueChange` widened to `value | null`: each call site guards `v !== null` (SimulatorTab, SettingsSelect, UsagePage, MachineSettings, Toolbar x2).
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" src/components/ui/select.tsx` returns nothing.
- Checks run: `pnpm exec tsc -b` (no errors in my files), `vp lint` (exit 0), and `vp fmt` on touched files.

## Left alone

- `components/ai-elements/prompt-input.tsx` `PromptInputSelect*`: pass-through wrappers with no app callers. They compile, but would show raw values if someone used them without `items`.
- No consumer sets a SelectContent width narrower than the floor.

## Behavior changes

- `SelectItem` ItemText renders a `div`, not a `span`, so the user's `*:[span]:last:*` item classes no longer match. ItemText carries `flex gap-2` itself instead.
- The device-mode select in the browser toolbar has no item for `responsive`. If it is ever shown in that mode, Base UI displays the raw value, where Radix showed nothing. Not verified whether that state can be reached.
- Base UI Select is modal by default (scroll lock and outside-pointer blocking), similar to Radix.

## Verify by hand

- Settings > any SettingsSelect, Usage "Which folders count", Settings computer picker, browser device/DPR bar, and the Simulator picker: each trigger shows the label (not the id), the popup opens below at the trigger's width (at least 11rem), the checkmark shows on the selected item, and typeahead and arrow keys work.
- Simulator picker: groups show their iPhone/iPad labels, and the trigger shows icon and name without the runtime.
- Check light and dark.
