// Turns the single-file Vite build into an Artifact page body: the host wraps it in its own <html>/<head>/<body>.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const pick = (re) => html.match(re)?.[1] ?? '';
const title = pick(/(<title>[\s\S]*?<\/title>)/);
// Indexes, not a regex: inlined bundles (mermaid, KaTeX) carry literal "</head>" and "<body>" strings.
const bodyAt = html.lastIndexOf('<body>');
const head = html.slice(html.indexOf('<head>') + 6, html.lastIndexOf('</head>', bodyAt)).replace(/<meta[^>]*>|<title>[\s\S]*?<\/title>/g, '');
const body = html.slice(bodyAt + 6, html.lastIndexOf('</body>'));

mkdirSync('artifact', { recursive: true });
// Some dependencies ship a literal U+FFFD inside string and regex literals; the Artifact publisher rejects the raw character, the escape means the same thing to JS.
const page = `${title}\n${head.trim()}\n${body.trim()}\n`.replaceAll('\uFFFD', '\\uFFFD');
writeFileSync('artifact/harness.html', page);
console.log('artifact/harness.html', Math.round((title.length + head.length + body.length) / 1024), 'KB');
