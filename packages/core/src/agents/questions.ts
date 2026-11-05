/** An option field kept by index, only when at least one option has it: `{}` otherwise, so most questions stay as they were. */
export function perOption<K extends string>(
  values: (string | undefined)[],
  key: K,
): { [P in K]?: string[] } {
  return values.some((v) => !!v?.trim())
    ? ({ [key]: values.map((v) => v ?? '') } as { [P in K]?: string[] })
    : {};
}
