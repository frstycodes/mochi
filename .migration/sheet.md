# sheet

2026-11-04, golden-pair merge (radix-nova -> base-nova, hand-resolved). Migrated; slide/fade moved from keyframes to Base UI starting/ending-style transitions, with the user's timing kept.

## Changed

- `apps/desktop/src/components/ui/sheet.tsx`: import `@base-ui/react/dialog`; `Overlay` -> `Backdrop`, `Content` -> `Popup`; Close `asChild` -> `render={<Button .../>}`. The animation is rewritten per the golden: `data-starting-style:opacity-0 data-ending-style:opacity-0`, plus a per-`data-[side=*]` `translate-*-[±2.5rem]` on both styles (the same distance as the old `slide-*-10`). The user's `transition duration-200 ease-(--ease-drawer)` and 150ms close (`data-closed:duration-150`) are kept, and the backdrop keeps `bg-black/30` with the same easing. No `shadow-lg` was added (the user had removed it).
- Consumers (`asChild` -> `render`): `src/replay/ReplayView.tsx:663`, `src/design/sections/overlays.tsx` (SheetTrigger).
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" sheet.tsx` is empty.
- Typecheck: no errors in sheet.tsx or its consumers.

## Left alone

- `src/components/ui/drawer.tsx`: vaul, not radix.

## Behavior changes

- The enter/exit is now a CSS transition rather than a keyframe animation. Interrupting it mid-flight (re-opening while closing) reverses smoothly instead of restarting. Durations and easing are unchanged.

## Verify by hand

- Replay view: open the sheet. It slides 2.5rem in from the right over 200ms with a fade, and closing takes 150ms. Check light and dark.
- Design page sheet: Esc and the X both close it, and focus returns to the trigger.
