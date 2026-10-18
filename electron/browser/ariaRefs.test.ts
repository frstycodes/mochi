import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentSnapshot, ariaSelector } from './ariaRefs.ts';

// Captured from page.ariaSnapshot({ mode: 'ai' }) on scripts/fixtures/browser-smoke.html, with an iframe and a quoted name added.
const SNAPSHOT = `- generic [active] [ref=e1]:
  - iframe [ref=e2]:
    - generic [active] [ref=f1e1]:
      - button "In frame" [ref=f1e2]
  - 'button "x: y" [ref=e3]'
  - heading "Browser smoke" [level=1] [ref=e4]
  - generic [ref=e9]:
    - text: Name
    - textbox "Name" [ref=e10]: Ada
  - generic [ref=e11]:
    - text: Password
    - textbox "Password" [ref=e12]
  - combobox "Fruit" [ref=e14]:
    - option "Apple" [selected]
  - button "Upload" [ref=e16]
  - button "Sign in" [ref=e17]
  - status
  - generic [ref=e19]: Drag me
  - link "Download file" [ref=e22] [cursor=pointer]:
    - /url: /download
  - 'button "it''s \\"quoted\\"" [ref=e30]'`;

test('pulls role, name and ref out of every ref line, prefixed with the generation', () => {
  const { refs } = agentSnapshot(SNAPSHOT, 3);
  assert.deepEqual(refs, [
    { ref: 'g3-e1', role: 'generic', name: '' },
    { ref: 'g3-e2', role: 'iframe', name: '' },
    { ref: 'g3-f1e1', role: 'generic', name: '' },
    { ref: 'g3-f1e2', role: 'button', name: 'In frame' },
    { ref: 'g3-e3', role: 'button', name: 'x: y' },
    { ref: 'g3-e4', role: 'heading', name: 'Browser smoke' },
    { ref: 'g3-e9', role: 'generic', name: '' },
    { ref: 'g3-e10', role: 'textbox', name: 'Name' },
    { ref: 'g3-e11', role: 'generic', name: '' },
    { ref: 'g3-e12', role: 'textbox', name: 'Password' },
    { ref: 'g3-e14', role: 'combobox', name: 'Fruit' },
    { ref: 'g3-e16', role: 'button', name: 'Upload' },
    { ref: 'g3-e17', role: 'button', name: 'Sign in' },
    { ref: 'g3-e19', role: 'generic', name: '' },
    { ref: 'g3-e22', role: 'link', name: 'Download file' },
    { ref: 'g3-e30', role: 'button', name: 'it\'s "quoted"' },
  ]);
});

test('rewrites only the ref attribute and keeps the rest of each line', () => {
  const lines = agentSnapshot(SNAPSHOT, 3).text.split('\n');
  assert.equal(lines[4], `  - 'button "x: y" [ref=g3-e3]'`);
  assert.equal(lines[8], '    - textbox "Name" [ref=g3-e10]: Ada');
  assert.equal(lines[17], '  - generic [ref=g3-e19]: Drag me');
  assert.equal(lines[18], '  - link "Download file" [ref=g3-e22] [cursor=pointer]:');
  assert.equal(lines[19], '    - /url: /download');
});

test('a ref in a text value is not a ref', () => {
  assert.deepEqual(agentSnapshot('- text: see [ref=e5]', 1), { text: '- text: see [ref=e5]', refs: [] });
});

test('cuts a long page at a line and keeps only the refs it shows', () => {
  const yaml = Array.from({ length: 5000 }, (_, i) => `- button "Button number ${i}" [ref=e${i}]`).join('\n');
  const { text, refs } = agentSnapshot(yaml, 1);
  assert.ok(text.length <= 40_100);
  assert.equal(text.split('\n').at(-1), '- … (page truncated)');
  assert.equal(refs.length, text.split('\n').length - 1);
});

test('maps an agent ref back to its aria-ref selector only for the current generation', () => {
  assert.equal(ariaSelector('g3-e12', 3), 'aria-ref=e12');
  assert.equal(ariaSelector('g3-f1e2', 3), 'aria-ref=f1e2');
  assert.equal(ariaSelector('g2-e12', 3), null);
  assert.equal(ariaSelector('g31-e12', 3), null);
  assert.equal(ariaSelector('e12', 3), null);
});

test('hides client secrets from the snapshot text and ref names, keeping the refs', () => {
  const yaml = ['- textbox "Client secret" [ref=e1]: GOCSPX-FxS67JACQ3V8Bftlr0MIzCo', '- generic [ref=e2]: 7575573b1c2a4400de6115a61b557acc', '- button "Copy 7575573b1c2a4400de6115a61b557acc" [ref=e3]', '- generic [ref=e4]: 8325458480016.12371342152640'].join('\n');
  const { text, refs } = agentSnapshot(yaml, 1);
  assert.doesNotMatch(text, /GOCSPX|7575573b/);
  assert.match(text, /8325458480016\.12371342152640/, 'a client ID stays');
  assert.deepEqual(refs.map((r) => r.ref), ['g1-e1', 'g1-e2', 'g1-e3', 'g1-e4']);
  assert.equal(refs[2].name, 'Copy [secret hidden by Mochi]');
});
