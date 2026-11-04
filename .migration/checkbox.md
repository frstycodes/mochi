# checkbox

2026-11-04, golden-pair merge (1 conflict resolved by hand). Migrated. User customizations kept: the shared `CHECKBOX_CLASS`/`CHECKBOX_INDICATOR_CLASS`, the always-mounted indicator with its shrink/blur transition, the `@/icons` Check, and the `CheckboxMark` export (used by `questionnaire.tsx`, same signature).

## Changed

- `apps/desktop/src/components/ui/checkbox.tsx`:
  - imports `@base-ui/react/checkbox`; props are now `CheckboxPrimitive.Root.Props`
  - Indicator `forceMount` -> `keepMounted`
  - indicator `data-[state=unchecked]:*` -> `data-unchecked:*` (Base sets `data-unchecked` on a kept-mounted indicator: `checkbox/utils/getCheckboxStateAttributesMapping.js`)
  - root `disabled:*` -> `data-disabled:*`, because the root is now a `<span>` (class-mapping rule)
  - `CheckboxMark` emits `data-checked`/`data-unchecked` presence attributes instead of `data-state`
- `src/library/AddSkillsDialog.tsx:295`: `checked={all || (some && 'indeterminate')}` -> `checked={isAllPicked} indeterminate={!isAllPicked && !!picked.length}`.
- `src/settled/SettledView.tsx:96`: `checked={page.allState}` -> `checked={page.allState === true} indeterminate={page.allState === 'indeterminate'}`. The hook's tri-state shape is unchanged.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" checkbox.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in these files. The one remaining project error is `src/components/ui/command.tsx(62,9)` (Dialog children type, dialog family).

## Left alone

- The many `onCheckedChange` single-arg handlers: still type-safe with the extra `eventDetails` arg.

## Behavior changes

- The root renders `<span role="checkbox">` plus a hidden `<input>`, not a `<button>`. `id` goes to the hidden input, so `<label htmlFor>` still works.
- `onCheckedChange` is `(checked: boolean, eventDetails)` and never passes `'indeterminate'`.
- The indeterminate state shows `data-indeterminate`, and the indicator stays visible with the check icon, the same as with Radix.

## Verify by hand

- Add skills dialog: pick some skills, then all. The header checkbox goes empty -> mixed -> checked, and the check animates in and out (shrink and blur).
- Settled view: the select-all checkbox shows the mixed state, and clicking it toggles all.
- Questionnaire (multi-choice): the `CheckboxMark` check animates in and out.
- A disabled checkbox is dimmed.
