// Turns the single-file Vite build into an Artifact page body: the host wraps it in its own <html>/<head>/<body>.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const pick = (re) => html.match(re)?.[1] ?? '';
const title = pick(/(<title>[\s\S]*?<\/title>)/);
const head = pick(/<head>([\s\S]*)<\/head>/).replace(/<meta[^>]*>|<title>[\s\S]*?<\/title>/g, '');
const body = pick(/<body>([\s\S]*)<\/body>/);

mkdirSync('artifact', { recursive: true });
// Some dependencies ship a literal U+FFFD inside string and regex literals; the Artifact publisher rejects the raw character, the escape means the same thing to JS.
const page = `${title}\n${head.trim()}\n${body.trim()}\n`.replaceAll('\uFFFD', '\\uFFFD');
writeFileSync('artifact/harness.html', page);
console.log('artifact/harness.html', Math.round((title.length + head.length + body.length) / 1024), 'KB');
