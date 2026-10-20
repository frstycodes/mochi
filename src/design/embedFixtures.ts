/** Agent-written widgets for the embed frame mockups: a small game and a list taller than the frame allows. */
export const TICTACTOE_WIDGET = `<style>
.g{display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 16px}
.t{font-size:20px;font-weight:650;letter-spacing:-0.02em}
.s{display:flex;gap:8px}.s div{min-width:72px;padding:6px 10px;border-radius:8px;background:var(--muted);text-align:center;font-size:12px;color:var(--muted-foreground)}
.s b{display:block;font-size:18px;color:var(--foreground)}
.b{display:grid;grid-template-columns:repeat(3,56px);gap:6px}
.b button{height:56px;border:0;border-radius:8px;background:var(--muted);color:var(--foreground);font:600 22px system-ui;cursor:pointer}
.b button:hover{background:color-mix(in oklab,var(--muted),var(--foreground) 8%)}
</style>
<div class="g"><div class="t">Tic, tac, together</div>
<div class="s"><div>Player X<b>0</b></div><div>Draws<b>0</b></div><div>Player O<b>0</b></div></div>
<div class="b">${Array.from({ length: 9 }, () => '<button></button>').join('')}</div>
<div style="font-size:12px;color:var(--muted-foreground)">Player X, you're up.</div></div>
<script>let x=true;document.querySelectorAll('.b button').forEach(b=>b.onclick=()=>{if(b.textContent)return;b.textContent=x?'X':'O';x=!x})</script>`;

const ROWS = ['api-gateway', 'auth', 'billing', 'search', 'notifications', 'media', 'ledger', 'webhooks', 'scheduler', 'exports', 'imports', 'audit', 'flags', 'sessions', 'reports', 'mailer', 'geo', 'pricing', 'inventory', 'checkout'];

export const TALL_WIDGET = `<style>
.l{display:flex;flex-direction:column;padding:8px 0}
.r{display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;font-size:12px}
.r span:last-child{margin-left:auto;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.d{width:6px;height:6px;border-radius:50%;background:var(--success)}
</style><div class="l">${ROWS.map((name, i) => `<div class="r"><span class="d"></span><span>${name}</span><span>p95 ${120 + ((i * 37) % 260)} ms</span></div>`).join('')}</div>`;

export const CODE_PREVIEW = `export function retryAfter(res: Response) {
  const header = res.headers.get('Retry-After');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}`;

/** What the reported widget did: drew its own bordered card inside the host's padded card. */
export const CARDED_TICTACTOE_WIDGET = `<div style="border:1px solid var(--border);border-radius:24px">${TICTACTOE_WIDGET}</div>`;
