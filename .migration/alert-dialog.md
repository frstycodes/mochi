# alert-dialog

2026-11-04, golden-pair merge (radix-nova -> base-nova, hand-resolved). Migrated with the user's classes kept; `AlertDialogAction` no longer closes the dialog (flagged, not patched).

## Changed

- `apps/desktop/src/components/ui/alert-dialog.tsx`: import `@base-ui/react/alert-dialog`; `Overlay` -> `Backdrop`, `Content` -> `Popup`; `data-[state=*]` -> `data-open:` / `data-closed:` (keyframes kept, as in the golden). Kept the user's `bg-black/30`, `duration-200 ease-(--ease-out)`, `shadow-float`, `grid-cols-[minmax(0,1fr)]`, size widths and `sm:flex-wrap`. `AlertDialogCancel` is now `AlertDialogPrimitive.Close render={<Button variant size/>}`. `AlertDialogAction` is a plain `Button` (Base UI has no Action part), with the user's `variant="default"` / `size="default"` defaults kept.
- Consumer call sites: `src/git/useConfirm.tsx:42` and `src/remote/DeviceApproval.tsx:56` (`AlertDialogDescription asChild` + `<div>` -> `render={<div .../>}`), `src/design/sections/overlays.tsx` (AlertDialogTrigger).
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" alert-dialog.tsx` is empty.
- Typecheck: no errors in alert-dialog.tsx or its consumers.

## Left alone

- `src/settled/DeleteThreads.tsx`, `src/git/useConfirm.tsx`, `src/remote/DeviceApproval.tsx`: their Action handlers already clear the state that controls `open`, so they still close.

## Behavior changes

- FLAG: Radix `AlertDialog.Action` closed the dialog on click. The Base UI wrapper's Action is a plain button and does not. Affected call sites:
  - `src/git/MergeButton.tsx:273` ("Merge when ready") and `:277` ("Bypass checks and merge"): `onAutoMerge` / `onBypass` call `onMerge` but never `setAsking(null)`, so the bypass dialog stays open after you confirm.
  - `src/design/sections/overlays.tsx` ("Delete worktree" demo, uncontrolled): stays open after the click.
    Either fix restores the old behavior: compose `AlertDialogPrimitive.Close render={<Button/>}` inside `AlertDialogAction`, or clear the state in those handlers. Not applied.
- Radix focused Cancel on open; Base UI focuses the first tabbable element. In these footers that is Cancel anyway, because the footer is `flex-col-reverse` and Cancel comes first in the DOM.
- `onOpenChange` gains an `eventDetails` argument. Existing one-argument handlers are fine.

## Verify by hand

- In a PR with failing checks, press Merge, then "Bypass checks and merge": the dialog should close. It currently stays open (see flag).
- Delete a settled thread: Cancel keeps it, Delete removes it and the dialog closes. Esc behaves like Cancel.
- Pairing request (DeviceApproval): the pairing code renders inside the description, and "Let it join" closes the dialog.
