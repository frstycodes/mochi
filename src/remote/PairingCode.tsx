/** The six digits both screens show while pairing, big enough to compare across a room. */
export function PairingCode({ code }: { code: string }) {
  return <p className="rounded-lg border px-3 py-2 text-center type-display tabular-nums tracking-widest text-foreground">{code}</p>;
}
