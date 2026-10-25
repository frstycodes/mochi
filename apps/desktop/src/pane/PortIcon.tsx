import { Globe } from '@/icons';

/** A globe with a green dot cut into its corner: the port is listening. */
export function PortIcon() {
  return (
    <span className="relative flex" aria-hidden>
      <Globe className="size-4 text-muted-foreground [mask-image:radial-gradient(circle_at_14px_14px,transparent_4.5px,black_5px)]" />
      <span className="absolute -right-px -bottom-px size-1.5 rounded-full bg-success" />
    </span>
  );
}
