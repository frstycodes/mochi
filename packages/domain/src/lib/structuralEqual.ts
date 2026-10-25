/** Structural equality for the plain objects and arrays in views and snapshots. */
export function structuralEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== 'object' ||
    a === null ||
    typeof b !== 'object' ||
    b === null
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false;
  const keys = Object.keys(a);
  const other = b as Record<string, unknown>;
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(other, key) &&
        structuralEqual((a as Record<string, unknown>)[key], other[key]),
    )
  );
}
