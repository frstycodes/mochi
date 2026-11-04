# dialog

2026-11-04, golden-pair merge (radix-nova -> base-nova, conflicts hand-resolved against overlays.md). Migrated with the user's customizations kept; one type error left in `command.tsx` (cmdk wrapper, not mine to edit).

## Changed

- `apps/desktop/src/components/ui/dialog.tsx`: import `@base-ui/react/dialog`; prop types to `DialogPrimitive.<Part>.Props`; `Overlay` -> `Backdrop`, `Content` -> `Popup` (centered, no Positioner); both `Close` buttons `asChild` -> `render={<Button .../>}`. Kept the user's `bg-black/30`, `duration-200 ease-(--ease-out)`, `shadow-float`, `overlayClassName` prop, `@/icons` X icon and `font-heading`. Changed `data-[state=open|closed]:` to `data-open:` / `data-closed:`, keeping the tw-animate keyframes, the same way the base-nova golden does.
- Consumer call sites (`asChild` -> `render`): `src/design/sections/overlays.tsx` (DialogTrigger), `src/git/SwitchBranchDialog.tsx` (DialogClose), `src/files/FileViewer.tsx:188` and `src/photo/PhotoViewer.tsx:253` (`DialogPrimitive.Close`). The rest of FileViewer, PhotoViewer and `src/Orbit.tsx` (Root/Popup/`initialFocus`/`keepMounted`) was already on Base UI from a concurrent edit when I got there. I reviewed it but did not write it.
- Leftover scan: `grep -n "radix-ui\|@radix-ui\|<<<<<<<\|>>>>>>>" dialog.tsx` is empty.
- Typecheck: `pnpm exec tsc -b` shows no errors in dialog.tsx or in the consumers above.

## Left alone

- `src/components/ui/command.tsx` (cmdk wrapper, hard rule). It now fails at `command.tsx(62,9): error TS2322: Type 'PayloadChildRenderFunction<unknown> | ReactNode' is not assignable to type 'ReactNode'.` The cause: `CommandDialog` types its props as `React.ComponentProps<typeof Dialog>`, and Base UI's `Dialog.Root` `children` may be a payload render function. Fix for its owner: `Omit<React.ComponentProps<typeof Dialog>, "children"> & { children?: React.ReactNode }`.
- `src/components/ui/drawer.tsx`: vaul, not radix.
- `src/routes/nav.ts:98` and `src/index.css:540` select `[role=dialog]`. Base UI dialog popups still carry that role, so nothing changes.

## Behavior changes

- `onOpenChange` now gets `(open, eventDetails)`. Every consumer passes a one-argument handler, so this is type-safe.
- Base UI focuses the first tabbable element on open (the same as Radix). FileViewer and PhotoViewer move initial focus to the popup through `initialFocus={popup}`.

## Verify by hand

- Open the design page dialog, then press Esc: focus goes back to "Edit" (or whichever trigger opened it). Do it again and close with the X: same result.
- Open the file viewer: the header tooltip does not pop, the arrow keys step through files, Esc closes it.
- Command palette (Cmd+K): opens and closes instantly with no fade (`animate-none!` on the overlay and content).
