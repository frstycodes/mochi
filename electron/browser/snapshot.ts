// Run in an isolated world of the page (`AGENT_WORLD`): the page can't see the refs or the elements they point at.
// SNAPSHOT_SCRIPT returns `{ text, refs }`: an indented role/name tree like Playwright's aria snapshot, `[ref=eN]` on
// interactive elements. Refs live in that world's `__mochiRefs` until the next snapshot or navigation.

const MAX_CHARS = 40_000;

export const SNAPSHOT_SCRIPT = `(() => {
  const refs = new Map();
  globalThis.__mochiRefs = refs;
  const meta = {};
  const lines = [];
  let size = 0;
  let n = 0;
  const LANDMARKS = { nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary', form: 'form', dialog: 'dialog', ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row', td: 'cell', th: 'columnheader', summary: 'button', option: 'option', img: 'img', select: 'combobox', textarea: 'textbox', button: 'button' };
  const INTERACTIVE = new Set(['link', 'button', 'checkbox', 'radio', 'slider', 'textbox', 'searchbox', 'combobox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'treeitem']);
  const FROM_CONTENT = new Set(['link', 'button', 'heading', 'option', 'menuitem', 'tab', 'treeitem', 'cell', 'columnheader']);
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(' ')[0];
    const tag = el.localName;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'input') {
      if (type === 'hidden') return null;
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'range') return 'slider';
      return type === 'search' ? 'searchbox' : 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (el.isContentEditable && el.parentElement && !el.parentElement.isContentEditable) return 'textbox';
    return LANDMARKS[tag] || null;
  };
  const isHidden = (el) => {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  };
  const clip = (t) => (t.length > 100 ? t.slice(0, 99) + '…' : t);
  const squash = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const nameOf = (el, role) => {
    const label = el.getAttribute('aria-label');
    if (label) return squash(label);
    const by = el.getAttribute('aria-labelledby');
    if (by) return squash(by.split(' ').map((id) => document.getElementById(id)?.innerText || '').join(' '));
    if (el.labels && el.labels.length) return squash(el.labels[0].innerText);
    if (el.localName === 'input' && ['button', 'submit', 'reset'].includes(el.type)) return squash(el.value || el.type);
    const alt = el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder');
    if (alt) return squash(alt);
    return FROM_CONTENT.has(role) ? squash(el.innerText) : '';
  };
  const push = (line) => {
    if (size > ${MAX_CHARS}) return;
    size += line.length + 1;
    lines.push(size > ${MAX_CHARS} ? '- … (page truncated)' : line);
  };
  const walk = (node, depth) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const text = squash(child.textContent);
        if (text) push('  '.repeat(depth) + '- text: ' + JSON.stringify(clip(text)));
        continue;
      }
      if (child.nodeType !== 1 || ['script', 'style', 'noscript', 'template', 'svg', 'iframe'].includes(child.localName) || isHidden(child)) continue;
      const role = roleOf(child);
      if (!role) {
        walk(child.shadowRoot || child, depth);
        continue;
      }
      const name = nameOf(child, role);
      let line = '  '.repeat(depth) + '- ' + role + (name ? ' ' + JSON.stringify(clip(name)) : '');
      if (role === 'heading') line += ' [level=' + (Number(child.localName[1]) || child.getAttribute('aria-level') || 2) + ']';
      if (child.checked || child.getAttribute('aria-checked') === 'true') line += ' [checked]';
      if (child.disabled || child.getAttribute('aria-disabled') === 'true') line += ' [disabled]';
      if (INTERACTIVE.has(role)) {
        const ref = 'e' + ++n;
        refs.set(ref, child);
        const form = child.form || child.closest('form');
        const type = (child.getAttribute('type') || '').toLowerCase();
        meta[ref] = { role, name, isSubmit: !!form && (type === 'submit' || type === 'image' || (child.localName === 'button' && !type)), isPassword: type === 'password' };
        line += ' [ref=' + ref + ']';
      }
      if ((role === 'textbox' || role === 'searchbox' || role === 'combobox') && 'value' in child && child.value) line += ': ' + JSON.stringify(clip(child.type === 'password' ? '••••' : child.value));
      push(line);
      if (!(FROM_CONTENT.has(role) && name) && role !== 'textbox' && role !== 'combobox') walk(child.shadowRoot || child, depth + 1);
    }
  };
  walk(document.body || document.documentElement, 0);
  return { text: lines.join('\\n') || '- (empty page)', refs: meta };
})()`;

/** `ref`'s element scrolled into view: its centre in CSS px of the viewport, or a reason it can't be used. */
export const locateScript = (ref: string) => `(() => {
  const el = globalThis.__mochiRefs?.get(${JSON.stringify(ref)});
  if (!el || !el.isConnected) return { error: 'No element ${ref.replace(/[^\w-]/g, '')} on the page now; take a new browser_snapshot' };
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { error: 'That element has no size on screen; take a new browser_snapshot' };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, isHidden: document.visibilityState === 'hidden' };
})()`;

export const clickScript = (ref: string) => `(() => {
  const el = globalThis.__mochiRefs?.get(${JSON.stringify(ref)});
  if (!el || !el.isConnected) return { error: 'No element ${ref.replace(/[^\w-]/g, '')} on the page now; take a new browser_snapshot' };
  el.focus?.();
  el.click();
  return {};
})()`;

/** Focuses `ref` and selects what's in it, so inserted text replaces it. A `<select>` takes the option whose label or value matches instead. */
export const focusScript = (ref: string, text: string) => `(() => {
  const el = globalThis.__mochiRefs?.get(${JSON.stringify(ref)});
  if (!el || !el.isConnected) return { error: 'No element ${ref.replace(/[^\w-]/g, '')} on the page now; take a new browser_snapshot' };
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus();
  if (el.localName === 'select') {
    const want = ${JSON.stringify(text)};
    const option = [...el.options].find((o) => o.label === want || o.value === want);
    if (!option) return { error: 'No option ' + JSON.stringify(want) + ' in that list' };
    el.value = option.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { isSelect: true };
  }
  if (typeof el.select === 'function') el.select();
  else if (el.isContentEditable) getSelection().selectAllChildren(el);
  else return { error: 'That element takes no text' };
  return { isSelect: false };
})()`;

export const scrollScript = (ref: string | undefined, dx: number, dy: number) => `(() => {
  const el = ${ref ? `globalThis.__mochiRefs?.get(${JSON.stringify(ref)})` : 'null'};
  ${ref ? `if (!el || !el.isConnected) return { error: 'No element ${ref.replace(/[^\w-]/g, '')} on the page now; take a new browser_snapshot' };` : ''}
  const target = el || document.scrollingElement || document.documentElement;
  target.scrollBy({ left: ${dx}, top: ${dy}, behavior: 'instant' });
  return { x: Math.round(target.scrollLeft), y: Math.round(target.scrollTop), maxY: Math.round(target.scrollHeight - target.clientHeight) };
})()`;

const missing = (ref: string) => `if (!el || !el.isConnected) return { error: 'No element ${ref.replace(/[^\w-]/g, '')} on the page now; take a new browser_snapshot' };`;

/** A hidden page has no pointer, so hover fires the events a pointer would; `:hover` styles can't be faked. */
export const hoverScript = (ref: string) => `(() => {
  const el = globalThis.__mochiRefs?.get(${JSON.stringify(ref)});
  ${missing(ref)}
  for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) el.dispatchEvent(new MouseEvent(type, { bubbles: !type.endsWith('enter'), composed: true }));
  return {};
})()`;

/** Tags `ref`'s element so CDP can find it by selector (`DOM.setFileInputFiles` needs a node id). Only a file input qualifies. */
export const markScript = (ref: string, mark: string) => `(() => {
  const el = globalThis.__mochiRefs?.get(${JSON.stringify(ref)});
  ${missing(ref)}
  if (el.localName !== 'input' || el.type !== 'file') return { error: 'That element is not a file input; browser_snapshot shows them as button or textbox with type file nearby' };
  el.setAttribute('data-mochi-upload', ${JSON.stringify(mark)});
  return {};
})()`;
