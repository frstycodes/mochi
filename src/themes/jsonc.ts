/** JSON with comments and trailing commas, as VS Code reads theme files. Throws like `JSON.parse` on anything else. */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      out += text.slice(start, ++i);
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return JSON.parse(removeTrailingCommas(out));
}

function removeTrailingCommas(json: string) {
  let out = '';
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') {
      const start = i++;
      while (i < json.length && json[i] !== '"') i += json[i] === '\\' ? 2 : 1;
      out += json.slice(start, i + 1);
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (/\s/.test(json[j] ?? '')) j++;
      if (json[j] === '}' || json[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}
