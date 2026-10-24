import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { parseToml, removeTomlTables, setTomlKey } from './toml.ts';

test('header offsets ignore strings, comments, nested arrays and inline tables while preserving unrelated text', () => {
  const prefix = `# [comment]\r\ntext = """\r\n[fake]\r\n"""\r\nliteral = '''\n[[also.fake]]\n'''\narrays = [\n [1, 2],\n [3],\n]\ninline = { list = ["[fake]"] }\n`;
  const server = `[mcp_servers."a.b"] # [comment]\r\ncommand = "old"\r\n`;
  const suffix = `[[skills.config]]\npath = '/tmp/a'\n[[skills.config]]\npath = '/tmp/b'`;
  const text = prefix + server + suffix;
  const { doc, tables } = parseToml(text);
  assert.equal(doc.text, '[fake]\r\n');
  assert.deepEqual(doc.arrays, [[1, 2], [3]]);
  assert.deepEqual(tables.map(({ path, isArray }) => [path, isArray]), [[['mcp_servers', 'a.b'], false], [['skills', 'config'], true], [['skills', 'config'], true]]);
  assert.equal(tables[0].start, prefix.length);
  assert.equal(text.slice(tables[0].bodyStart, tables[0].end), 'command = "old"\r\n');
  assert.equal(removeTomlTables(text, [tables[0]]).text, prefix + suffix);
  assert.equal(setTomlKey(text, tables[0], 'command', 'new'), text.replace('command = "old"', 'command = "new"'));
  assert.throws(() => parseToml('key = 1\nkey = 2'), /config.toml line 2:/);
});
