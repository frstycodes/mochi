import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { faviconFallback } from './favicon';

export function IconImage({ src, fallback, className }: { src: string; fallback?: ReactNode; className?: string }) {
  return <LoadedIcon key={src} src={src} fallback={fallback} className={className} />;
}

function LoadedIcon({ src: initialSrc, fallback, className }: { src: string; fallback?: ReactNode; className?: string }) {
  const [src, setSrc] = useState<string | null>(initialSrc);
  const [isLoaded, setLoaded] = useState(false);
  const fail = () => {
    setLoaded(false);
    setSrc(src && faviconFallback(src));
  };
  return (
    <span aria-hidden className={cn('relative flex shrink-0 items-center justify-center', className)}>
      {!isLoaded && fallback}
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            // Google's missing-site globe is 16px even when a larger icon was requested.
            if (src.startsWith('https://www.google.com/s2/favicons?') && e.currentTarget.naturalWidth <= 16) fail();
            else setLoaded(true);
          }}
          onError={fail}
          className={cn('absolute inset-0 size-full rounded-[inherit] object-contain', !isLoaded && 'opacity-0')}
        />
      )}
    </span>
  );
}
