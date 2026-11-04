# hand-rolled

2026-11-04, transformation engine (overlays.md, dialog section). Orbit, FileViewer and PhotoViewer moved from radix `Dialog` to `@base-ui/react/dialog`.

## Changed

- `apps/desktop/src/files/FileViewer.tsx`:
  - Import `@base-ui/react/dialog`; `Overlay` -> `Backdrop`, `Content` -> `Popup`.
  - `data-[state=open|closed]:` -> `data-open:` / `data-closed:` on both (the keyframe animate-in/out idiom is kept, as in the migrated shadcn dialog).
  - `onOpenAutoFocus={e => (e.preventDefault(), focus self)}` -> `ref={popup}` + `initialFocus={popup}` (`useRef` added).
  - `aria-describedby={undefined}` dropped. It only silenced Radix's missing-Description warning; Base UI sets the attribute only when a Description exists.
- `apps/desktop/src/photo/PhotoViewer.tsx`: same changes, with the same `initialFocus` ref. The comment no longer says "Radix".
- `apps/desktop/src/Orbit.tsx`: `Portal forceMount` -> `Portal keepMounted`; `Content asChild forceMount aria-describedby={undefined}` + `<motion.div>` -> `Popup render={<motion.div .../>}` inside the same `AnimatePresence` conditional (Base UI's documented motion pattern).
- `DialogPrimitive.Close render={<Button/>}` in FileViewer and PhotoViewer was already in render form on disk; left as is.
- Leftover scan: `grep -n "radix-ui\|@radix-ui"` on all three files is empty. Typecheck is clean for all three.

## Left alone

- `FileViewer.tsx:~176`: a ToggleGroup call site (`value` / `onValueChange` arrays) belongs to the toggle-group family. It typechecked clean on the last run, so its owner presumably fixed it.
- `TooltipIconButton` / `Button` usage: other families.

## Behavior changes

- Base UI modal dialogs dismiss on outside press by default, as Radix did. Orbit is full-screen, so this is unchanged in practice.
- Orbit: Base UI's default initial focus (first tabbable, else popup) matches Radix's default. Not verified in the browser: the Orbit gesture needs a long-press drag.
- Base UI Portal renders a wrapper `<div>`; Radix Portal rendered none. All three popups are `position: fixed`, so layout is unaffected.

## Verify by hand

- Open a file from chat: the viewer fades and zooms in. Focus is on the dialog, not the first header button (no tooltip pops). Left/Right step files, Esc closes, and the fade-out plays.
- Open an image: same checks. Backdrop click closes, but a click on the image does not. While zoomed, a drag pans without closing.
- Orbit: invoke it, move toward a destination and release. The scrim fades in and out, and Esc cancels.
