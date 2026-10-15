import type { Photo } from '../photo/photos';

const svg = (w: number, h: number, body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;

const DUNES = svg(
  1200,
  800,
  `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6c38b"/><stop offset="1" stop-color="#f08a5d"/></linearGradient></defs>
  <rect width="1200" height="800" fill="url(#s)"/><circle cx="820" cy="300" r="90" fill="#fff3d6"/>
  <path d="M0 520 Q300 400 620 520 T1200 480 V800 H0Z" fill="#d9774a"/><path d="M0 620 Q400 500 760 640 T1200 600 V800 H0Z" fill="#b85a35"/><path d="M0 720 Q500 640 1200 720 V800 H0Z" fill="#8e3f22"/>`,
);

const SCREENSHOT = svg(
  1440,
  900,
  `<rect width="1440" height="900" fill="#17181c"/><rect width="260" height="900" fill="#1f2026"/>
  ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="24" y="${80 + i * 44}" width="${160 + (i % 3) * 30}" height="14" rx="7" fill="#3a3c45"/>`).join('')}
  <rect x="300" y="40" width="420" height="22" rx="11" fill="#e7e8ee"/>
  ${[0, 1, 2, 3].map((i) => `<rect x="300" y="${110 + i * 34}" width="${780 - i * 90}" height="12" rx="6" fill="#4a4c57"/>`).join('')}
  <rect x="300" y="290" width="1100" height="420" rx="18" fill="#22242b" stroke="#33353e"/>
  <polyline points="340,640 480,560 620,600 760,470 900,520 1040,400 1180,430 1340,330" fill="none" stroke="#7cc4a3" stroke-width="6"/>
  <rect x="980" y="770" width="420" height="64" rx="32" fill="#2b2d35"/>`,
);

const FERN = svg(
  800,
  1000,
  `<rect width="800" height="1000" fill="#dfe9d8"/><path d="M400 980 C380 700 420 400 400 80" stroke="#3f6b3a" stroke-width="10" fill="none"/>
  ${Array.from({ length: 9 }, (_, i) => {
    const y = 160 + i * 90;
    const r = 200 - i * 12;
    return `<ellipse cx="${400 - r / 2}" cy="${y}" rx="${r / 2}" ry="26" fill="#5c8f4f" transform="rotate(-18 ${400 - r / 2} ${y})"/><ellipse cx="${400 + r / 2}" cy="${y}" rx="${r / 2}" ry="26" fill="#6fa35f" transform="rotate(18 ${400 + r / 2} ${y})"/>`;
  }).join('')}`,
);

const COAST = svg(
  1600,
  900,
  `<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd3e6"/><stop offset="1" stop-color="#2f7fa3"/></linearGradient></defs>
  <rect width="1600" height="900" fill="#e8f3f7"/><rect y="380" width="1600" height="520" fill="url(#w)"/><path d="M0 700 Q500 620 900 760 T1600 720 V900 H0Z" fill="#efd9a8"/>`,
);

const MOCHI = svg(
  1024,
  1024,
  `<defs><radialGradient id="b" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#f4e7ef"/><stop offset="1" stop-color="#d9bfd0"/></radialGradient></defs>
  <rect width="1024" height="1024" fill="#c9e4d2"/><ellipse cx="512" cy="790" rx="300" ry="40" fill="#000" opacity="0.12"/>
  <path d="M212 760 C212 420 340 260 512 260 C684 260 812 420 812 760 Z" fill="url(#b)"/>
  <circle cx="600" cy="520" r="34" fill="#2a2430"/><circle cx="612" cy="508" r="10" fill="#fff"/><ellipse cx="690" cy="600" rx="40" ry="20" fill="#f3a5b8" opacity="0.7"/>`,
);

export const DEMO_PHOTOS = {
  dunes: { src: DUNES, name: 'dunes.png' },
  screenshot: { src: SCREENSHOT, name: 'Screenshot 2026-10-15 at 14.32.png' },
  fern: { src: FERN, name: 'fern.jpg' },
  coast: { src: COAST, name: 'coast.webp' },
  mochi: { src: MOCHI, name: 'mochi-sticker.png' },
} satisfies Record<string, Photo>;

export const BROKEN_PHOTO: Photo = { src: 'mochi-missing://shot.png', name: '/tmp/playwright/shot-3.png' };
