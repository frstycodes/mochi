# tabs

2026-11-04, golden-pair merge with the customized wrapper hand-replayed (motion `layoutId` chip and underline, `useReducedMotionConfig`, line variant). Migrated. The indicator behaviour is kept, and the activation delta is flagged.

## Changed

- `apps/desktop/src/components/ui/tabs.tsx`:
  - Import `@base-ui/react/tabs`.
  - `Trigger` -> `Tab`, `Content` -> `Panel`, prop types -> `TabsPrimitive.<Part>.Props`.
  - `@radix-ui/react-use-controllable-state` replaced by local `useState` plus a controlled/uncontrolled merge. It forwards `(value, eventDetails)` to `onValueChange` and keeps the `defaultValue ?? ""` default, so as before no tab is active unless one is given. The primitive is always controlled, so Base UI's automatic fallback to the first tab never runs.
  - `TabsContext.value` widened to `TabsPrimitive.Tab.Value`.
  - Added the golden `aria-disabled:pointer-events-none aria-disabled:opacity-50` beside `disabled:*`.
  - The motion indicator is driven by context `isActive`, not data attributes, so it works unchanged. `data-active:` classes match Base UI's `data-active`.
- Consumers: no call site used `asChild`, `activationMode`, `forceMount` or `dir`. `onValueChange` handlers in `settings/sections/harnesses.tsx`, `appearance.tsx`, `library/LibraryPage.tsx`, `AddSkillsDialog.tsx`, `usage/UsagePage.tsx` and `design/sections/native-items.tsx` typecheck as is (`value` is `any`). None of them were edited.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" tabs.tsx` is empty. Typecheck is clean.

## Left alone

- The base golden's `after:` underline and `data-active:bg-background` chip classes were not adopted. The user's motion `SegmentChip` and underline `layoutId` replace them.
- `TabsPrimitive.Indicator` was not adopted, for the same reason.

## Behavior changes

- FLAGGED, not patched: activation is now MANUAL. Radix activated a tab on arrow-key focus; Base UI's `List.activateOnFocus` defaults to `false`, so arrows move focus and Enter or Space selects. To restore it, pass `activateOnFocus` to `TabsList` (or default it in the wrapper).
- Hidden panels carry `data-hidden` instead of `data-state="inactive"`. No consumer styled panel state.

## Verify by hand

- Settings > Appearance themes tabs, Harnesses, Library and Usage range: click between tabs. The chip or underline slides, and with reduced motion on it jumps.
- Keyboard: focus a tab list and press the arrows. Focus moves but selection does not until Enter or Space (the flagged delta).
- Controlled tabs (Usage range) still drive and reflect external state.
