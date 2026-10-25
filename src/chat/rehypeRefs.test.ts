import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  rehypeRefs,
  rehypeRelativeLinks,
  rehypeSlashTokens,
} from './rehypeRefs.ts';

const text = (value: string) => ({ type: 'text', value });
const el = (tagName: string, ...children: unknown[]) => ({
  type: 'element',
  tagName,
  properties: {},
  children,
});

test('refs and paths in paragraphs become links; headings, code and links are left alone', () => {
  const tree = {
    type: 'root',
    children: [
      el('h2', text('#2 Release notes for #45')),
      el(
        'p',
        text('Merged #45, see src/a.ts:3 and '),
        el('code', text('#46')),
        text(' '),
        el('a', text('#47')),
      ),
    ],
  };
  rehypeRefs()(tree as never);
  assert.deepEqual(
    tree.children[0],
    el('h2', text('#2 Release notes for #45')),
  );
  assert.deepEqual(tree.children[1].children, [
    text('Merged '),
    {
      type: 'element',
      tagName: 'a',
      properties: { href: '#45', dataRef: '/#45' },
      children: [text('#45')],
    },
    text(', see '),
    {
      type: 'element',
      tagName: 'a',
      properties: { href: 'src/a.ts:3', dataPath: 'src/a.ts:3' },
      children: [text('src/a.ts:3')],
    },
    text(' and '),
    el('code', text('#46')),
    text(' '),
    el('a', text('#47')),
  ]);
});

test('bare relative link targets get ./ so harden keeps them; URLs, roots and anchors are untouched', () => {
  const link = (href: string) => ({
    type: 'element',
    tagName: 'a',
    properties: { href },
    children: [],
  });
  const tree = {
    type: 'root',
    children: [
      el(
        'p',
        link('src/a.ts'),
        link('https://x.dev'),
        link('/abs/a.ts'),
        link('../a.ts'),
        link('#top'),
        link('mailto:a@b.c'),
      ),
    ],
  };
  rehypeRelativeLinks()(tree as never);
  assert.deepEqual(
    tree.children[0].children.map(
      (a) => (a as { properties: { href: string } }).properties.href,
    ),
    [
      './src/a.ts',
      'https://x.dev',
      '/abs/a.ts',
      '../a.ts',
      '#top',
      'mailto:a@b.c',
    ],
  );
});

test('known /names in prose turn into coloured spans; unknown names, links and code stay as they are', () => {
  const tree = {
    type: 'root',
    children: [
      el(
        'p',
        text('/ui on '),
        el('a', text('/ui')),
        text(' then /nope and a/ui, /run'),
      ),
      el('p', el('code', text('/ui'))),
    ],
  };
  rehypeSlashTokens(['ui', 'run'])(tree as never);
  const span = (value: string) => ({
    type: 'element',
    tagName: 'span',
    properties: { className: ['text-info'] },
    children: [text(value)],
  });
  assert.deepEqual(tree.children[0].children, [
    span('/ui'),
    text(' on '),
    el('a', text('/ui')),
    text(' then /nope and a/ui, '),
    span('/run'),
  ]);
  assert.deepEqual(tree.children[1], el('p', el('code', text('/ui'))));
});
