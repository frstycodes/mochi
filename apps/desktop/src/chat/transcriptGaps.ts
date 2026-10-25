export interface Span {
  top: number;
  bottom: number;
}

export interface TranscriptGaps {
  /** Pixels of the visible list above the first rendered row: the "empty top half" bug. */
  above: number;
  /** Pixels of the visible list below the last rendered row. */
  below: number;
  /** Index pairs of rendered rows whose spacing isn't the row gap. */
  seams: [number, number][];
  /** Largest distance between where the virtualizer places a row and where it renders: a stale `scrollMargin` shows up here first. */
  drift: number;
}

/**
 * Where the rendered window fails to cover what's on screen. `rows` are the mounted rows' rendered boxes, `expected` the virtualizer's
 * starts for the same rows, and `view` the part of the list inside the scroller, all in the scroller's content coordinates.
 */
export function transcriptGaps(
  rows: Span[],
  expected: number[],
  view: Span,
  gap: number,
): TranscriptGaps {
  const empty = { above: 0, below: 0, seams: [], drift: 0 };
  if (rows.length === 0 || view.bottom <= view.top) return empty;
  const seams = rows
    .slice(1)
    .flatMap((row, i): [number, number][] =>
      Math.abs(row.top - rows[i].bottom - gap) > 1 ? [[i, i + 1]] : [],
    );
  return {
    above: Math.max(0, Math.min(rows[0].top, view.bottom) - view.top),
    below: Math.max(0, view.bottom - Math.max(rows.at(-1)!.bottom, view.top)),
    seams,
    drift: Math.max(...rows.map((row, i) => Math.abs(row.top - expected[i]))),
  };
}

// Drift alone isn't a gap: rows re-measured mid-resize drift for a frame and still cover the view.
export function hasGaps({ above, below, seams }: TranscriptGaps) {
  return above > 1 || below > 1 || seams.length > 0;
}
