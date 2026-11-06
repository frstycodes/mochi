import { MochiMark } from '../ui';

/** `#splash`: index.html's launch splash held on screen, styled by the `.splash` rules in its <head>. */
export function SplashPage() {
  return (
    <div className="splash" role="status" aria-label="Loading Mochi">
      <MochiMark className="text-inherit" />
    </div>
  );
}
