import type { ActivityEntry, Thread } from '../model.ts';

// GAP: demo-only. One settled thread whose messages exercise every inline visual, so the prototype shows them without an agent.
export function vizGalleryThread(): Thread {
  const s = 820;
  return {
    id: 'viz',
    spaceId: 'latitude',
    repo: { project: 'latitude', branch: 'feat/chat-visuals' },
    title: 'Chat visuals gallery',
    goal: 'Show every inline visual an agent can emit.',
    providers: ['claude'],
    status: 'settled',
    line: 3,
    startedAt: s,
    revisions: [{ n: 1, at: s, label: 'Goal set', by: 'you' }],
    steps: [],
    activity: GALLERY.map((entry, i) => ({ ...entry, at: s + i })),
    prs: [],
    sources: [],
    context: { used: 24_000, max: 200_000 },
  };
}

const fence = (lang: string, body: string, meta = '') => `\`\`\`${lang}${meta ? ` ${meta}` : ''}\n${body}\n\`\`\``;

const LATENCY = {
  type: 'line',
  title: 'p95 latency by plan tier (ms)',
  x: 'day',
  data: [
    { day: 'Mon', Free: 182, Pro: 141, Enterprise: 96 },
    { day: 'Tue', Free: 176, Pro: 138, Enterprise: 92 },
    { day: 'Wed', Free: 201, Pro: 150, Enterprise: 99 },
    { day: 'Thu', Free: 168, Pro: 132, Enterprise: 90 },
    { day: 'Fri', Free: 159, Pro: 127, Enterprise: 88 },
    { day: 'Sat', Free: 144, Pro: 119, Enterprise: 84 },
    { day: 'Sun', Free: 139, Pro: 116, Enterprise: 83 },
  ],
};

const REJECTIONS = {
  type: 'bar',
  title: '429s per hour after rollout',
  x: 'hour',
  series: ['Free', 'Pro'],
  data: ['09', '10', '11', '12', '13', '14'].map((hour, i) => ({ hour: `${hour}:00`, Free: [42, 61, 55, 38, 47, 30][i], Pro: [6, 9, 4, 3, 7, 2][i] })),
};

const PLAN_MIX = {
  type: 'pie',
  title: 'Keys by plan',
  x: 'plan',
  data: [
    { plan: 'Free', keys: 6120 },
    { plan: 'Pro', keys: 2840 },
    { plan: 'Team', keys: 910 },
    { plan: 'Enterprise', keys: 130 },
  ],
};

const WIDGET = `<style>
  .row{display:flex;gap:8px;flex-wrap:wrap;padding:4px 2px}
  button{font:inherit;color:var(--foreground);background:transparent;border:1px solid var(--border);border-radius:999px;padding:4px 12px;cursor:pointer}
  button:hover{background:color-mix(in oklab,var(--foreground) 6%,transparent)}
  output{display:block;color:var(--muted-foreground);font-size:12px;margin-top:6px}
  .bar{height:6px;border-radius:3px;background:var(--chart-1);transition:width .2s}
</style>
<div class="row">
  <button data-tier="Free">Free · 60/min</button>
  <button data-tier="Pro">Pro · 600/min</button>
  <button data-tier="Enterprise">Enterprise · custom</button>
</div>
<div class="bar" style="width:10%"></div>
<output>Click a tier to preview headroom; double-click to ask Claude to load-test it.</output>
<script>
  const limits = { Free: 10, Pro: 60, Enterprise: 100 };
  for (const b of document.querySelectorAll('button')) {
    b.onclick = () => { document.querySelector('.bar').style.width = limits[b.dataset.tier] + '%'; document.querySelector('output').textContent = b.dataset.tier + ' selected.'; };
    b.ondblclick = () => sendPrompt('Load-test the ' + b.dataset.tier + ' tier at 2x its limit');
  }
</script>`;

const BUCKET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 120" width="360" height="120" font-family="system-ui" font-size="11">
  <rect x="20" y="20" width="80" height="80" rx="10" fill="none" stroke="var(--muted-foreground)" stroke-width="2"/>
  <rect x="22" y="52" width="76" height="46" rx="8" fill="var(--chart-3)" opacity="0.35"/>
  <text x="60" y="114" text-anchor="middle" fill="var(--muted-foreground)">bucket (B = 60)</text>
  <path d="M110 60 H200" stroke="var(--chart-1)" stroke-width="2" marker-end="url(#a)"/>
  <text x="155" y="52" text-anchor="middle" fill="var(--foreground)">take 1 token</text>
  <rect x="210" y="40" width="120" height="40" rx="10" fill="none" stroke="var(--chart-1)" stroke-width="2"/>
  <text x="270" y="64" text-anchor="middle" fill="var(--foreground)">request</text>
  <path d="M60 4 V18" stroke="var(--chart-3)" stroke-width="2" marker-end="url(#b)"/>
  <text x="70" y="12" fill="var(--muted-foreground)">refill r = 1/s</text>
  <defs>
    <marker id="a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="var(--chart-1)"/></marker>
    <marker id="b" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="var(--chart-3)"/></marker>
  </defs>
</svg>`;

const SCREENSHOT = `data:image/svg+xml;base64,${btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="640" height="400"><rect width="320" height="200" fill="#f7f8fa"/><rect x="16" y="16" width="96" height="10" rx="3" fill="#1d1f24"/><rect x="248" y="14" width="56" height="14" rx="7" fill="#1d1f24"/>${[30, 36, 34, 44, 41, 52, 50, 58, 62, 70, 66, 78]
    .map((h, i) => `<rect x="${20 + i * 24}" y="${170 - h * 1.6}" width="16" height="${h * 1.6}" rx="3" fill="#2a78d6" opacity="${0.5 + i * 0.04}"/>`)
    .join('')}<rect x="16" y="176" width="288" height="1" fill="#e3e5ea"/></svg>`,
)}`;

const GALLERY: Omit<ActivityEntry, 'at'>[] = [
  { who: 'you', kind: 'message', text: 'Before we ship rate limits, show me what you can draw inline in the chat.' },
  {
    who: 'claude',
    kind: 'message',
    text: [
      'The limiter is a token bucket. Each key refills at rate $$r$$ up to capacity $$B$$:',
      '',
      '$$\ntokens_{t} = \\min\\left(B,\\; tokens_{t-1} + r\\,\\Delta t\\right)\n$$',
      '',
      fence('mermaid', 'flowchart LR\n  req[Request] --> key{API key?}\n  key -- no --> r401[401]\n  key -- yes --> bucket[Take token]\n  bucket -- empty --> r429[429 + Retry-After]\n  bucket -- ok --> handler[Route handler]'),
      '',
      fence('ts', "export async function take(key: string, plan: Plan) {\n  const bucket = await redis().then((r) => tokenBucket(r, key, LIMITS[plan]));\n  return bucket.take(1);\n}"),
      '',
      'CJK wraps and emphasises correctly too: **日本語の文章**も、中文的**标点**也可以。',
    ].join('\n'),
  },
  {
    who: 'claude',
    kind: 'message',
    text: ['Latency held steady per tier through the week:', '', fence('chart', JSON.stringify(LATENCY, null, 2)), '', 'Most 429s land on Free keys:', '', fence('chart', JSON.stringify(REJECTIONS, null, 2)), '', fence('chart', JSON.stringify(PLAN_MIX, null, 2))].join('\n'),
  },
  {
    who: 'claude',
    kind: 'message',
    text: [
      'Top keys by rejected calls today (click a header to sort):',
      '',
      '| Key | Plan | Calls | Rejected | p95 |',
      '|---|---|---:|---:|---:|',
      '| `key_9f2a` | Free | 12,480 | 1,204 | 182ms |',
      '| `key_31cd` | Pro | 96,310 | 88 | 141ms |',
      '| `key_7be0` | Free | 4,920 | 731 | 210ms |',
      '| `key_e115` | Enterprise | 310,200 | 0 | 96ms |',
      '| `key_0a7c` | Team | 41,005 | 12 | 133ms |',
    ].join('\n'),
  },
  {
    who: 'claude',
    kind: 'message',
    text: ['Pick a tier to preview its headroom; double-click one and I will load-test it:', '', fence('html', WIDGET, 'title="Tier picker"'), '', 'How the bucket works:', '', fence('svg', BUCKET_SVG, 'title="Token bucket"')].join('\n'),
  },
  { who: 'claude', kind: 'message', text: `Here is the usage page before and after the change. Click one to page through both; drag one into the composer to attach it.\n\n![Usage page before](${SCREENSHOT})\n\n![API usage page](${SCREENSHOT})` },
  {
    who: 'claude',
    kind: 'message',
    text: [
      'Where the rate limiting thread stands:',
      '',
      fence('harness-burnup', '{ "thread": "rl" }'),
      '',
      'And how it lines up with the threads around it:',
      '',
      fence('harness-metro', '{ "threads": ["rl", "adm", "e2e"] }'),
      '',
      fence('harness-diff', JSON.stringify({ title: 'Rate limiting so far', files: [{ path: 'packages/cache/redis.ts', added: 38, removed: 0 }, { path: 'packages/cache/token-bucket.ts', added: 64, removed: 0 }, { path: 'apps/api/middleware/rate-limit.ts', added: 41, removed: 7 }, { path: 'docs/api/limits.md', added: 22, removed: 3 }] }, null, 2)),
    ].join('\n'),
  },
  {
    who: 'claude',
    kind: 'message',
    text: ['A fence that fails to parse shows its source instead of a broken frame:', '', fence('chart', '{ "type": "bar", "x": "day", "data": [{ "day": "Mon", "calls": "twelve" }] }'), '', 'And one still streaming:', '', '```chart\n{ "type": "area", "x": "day", "data": [{ "day": "Mon", "calls": 3'].join('\n'),
  },
];
