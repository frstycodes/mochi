/** Multi-selection over an ordered list of ids, like Finder: a plain click sets the anchor, Shift extends from it, mod toggles one. */
export interface Selection {
  ids: string[];
  anchor: string | undefined;
}

/** Shift-click: everything between the anchor and `id`, both included, in list order. No anchor selects just `id`. */
export function selectRange(order: string[], anchor: string | undefined, id: string): string[] {
  const from = anchor === undefined ? -1 : order.indexOf(anchor);
  const to = order.indexOf(id);
  if (to < 0) return [];
  if (from < 0) return [id];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Mod-click: adds or removes `id`. Starting from nothing, the anchor (the open thread) counts as already selected. */
export function toggleSelected(order: string[], { ids, anchor }: Selection, id: string): Selection {
  const base = ids.length > 0 ? ids : anchor !== undefined && order.includes(anchor) ? [anchor] : [];
  const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
  return { ids: order.filter((x) => next.includes(x)), anchor: id };
}

/** Shift ↑/↓ from the focused row: moves focus one row and selects from the anchor to it. Null at either end. */
export function extendSelection(order: string[], { anchor }: Selection, focusId: string, step: 1 | -1) {
  const to = order[order.indexOf(focusId) + step];
  if (to === undefined || !order.includes(focusId)) return null;
  const from = anchor ?? focusId;
  return { selection: { ids: selectRange(order, from, to), anchor: from }, focusId: to };
}
