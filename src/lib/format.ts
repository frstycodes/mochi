const PLURAL = new Intl.PluralRules('en');

export function plural(n: number, one: string, other: string) {
  return PLURAL.select(n) === 'one' ? one : other;
}

export const TOKENS = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const BYTE_LABELS = ['B', 'kB', 'MB', 'GB'];
const BYTE_NUMBER = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

export function formatBytes(bytes: number) {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_LABELS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${BYTE_NUMBER.format(value)} ${BYTE_LABELS[unit]}`;
}
