import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { reviewUpload, unpackUpload, UPLOAD_LIMITS } from './upload.ts';

const PLUGIN = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'review-kit', version: '1.2.0', description: 'Review helpers', author: { name: 'Sam' } }),
  'skills/triage/SKILL.md': '---\nname: triage\ndescription: Sort issues\n---\nSteps',
  'commands/ship.md': '---\ndescription: Ship it\n---\nShip',
  'agents/security.md': '---\nname: security\ndescription: Finds holes\n---\nLook',
  'hooks/hooks.json': JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}"/fmt.sh', args: ['--fix'] }] }] } }),
  'fmt.sh': '#!/bin/sh\nprettier --write "$1"',
  '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'npx', args: ['-y', 'pg-mcp'], env: { PGPASSWORD: 'x' } }, linear: { url: 'https://mcp.linear.app/mcp' } } }),
  'logo.png': '\x89PNG\0\0binary',
};

test('a .plugin zipped from inside the folder, and a .tgz of the folder itself, unpack and review the same', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mochi-upload-'));
  const dir = join(root, 'review-kit');
  for (const [path, text] of Object.entries(PLUGIN)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  execFileSync('zip', ['-qr', join(root, 'review-kit.plugin'), '.'], { cwd: dir });
  // Gzipped separately: bsdtar pads its own -z output, which a gzip stream reader rejects as trailing junk.
  const tgz = gzipSync(execFileSync('tar', ['-c', '-C', root, 'review-kit']));

  for (const bytes of [new Uint8Array(readFileSync(join(root, 'review-kit.plugin'))), new Uint8Array(tgz)]) {
    const unpacked = await unpackUpload(bytes);
    assert.deepEqual(unpacked.skipped, ['logo.png']);
    const { review } = reviewUpload('review-kit.plugin', bytes, unpacked, []);
    assert.equal(review.name, 'review-kit');
    assert.equal(review.version, '1.2.0');
    assert.equal(review.author, 'Sam');
    assert.deepEqual(review.skills.map((s) => s.name), ['triage', 'ship']);
    assert.deepEqual(review.agents.map((a) => a.name), ['security']);
    assert.deepEqual(review.hooks, [{ event: 'PostToolUse', matcher: 'Edit', condition: null, type: 'command', run: '"${CLAUDE_PLUGIN_ROOT}"/fmt.sh --fix' }]);
    assert.deepEqual(review.servers, [{ name: 'db', run: 'npx -y pg-mcp', env: ['PGPASSWORD'] }]);
    assert.deepEqual(review.remotes, [{ name: 'linear', url: 'https://mcp.linear.app/mcp' }]);
    assert.deepEqual(review.loads, { claude: '2 skills, 1 agent, 1 hook, 1 server', codex: '1 server' });
    assert.equal(review.sha256.length, 64);
    assert.equal(review.existing, null);
  }
});

test('paths that leave the plugin reject the whole file', async () => {
  const manifest = { path: '.claude-plugin/plugin.json', body: '{"name":"x"}' };
  await assert.rejects(unpackUpload(zip([manifest, { path: '../evil.sh', body: 'x' }])), /points outside the plugin/);
  await assert.rejects(unpackUpload(zip([manifest, { path: 'skills/../../evil.sh', body: 'x' }])), /points outside the plugin/);
  await assert.rejects(unpackUpload(zip([manifest, { path: '/etc/evil', body: 'x' }])), /absolute path/);
  await assert.rejects(unpackUpload(zip([manifest, { path: 'C:/evil', body: 'x' }])), /absolute path/);
  await assert.rejects(unpackUpload(zip([manifest, { path: 'skills\\..\\evil', body: 'x' }])), /won’t unpack/);
  await assert.rejects(unpackUpload(tar([manifest, { path: '../evil.sh', body: 'x' }])), /points outside the plugin/);
  await assert.rejects(unpackUpload(tar([manifest, { path: '/etc/evil', body: 'x' }])), /absolute path/);
});

test('links pointing outside reject the file; ones inside become copies', async () => {
  const manifest = { path: '.claude-plugin/plugin.json', body: '{"name":"x"}' };
  await assert.rejects(unpackUpload(zip([manifest, { path: 'skills/a/SKILL.md', body: '../../../../etc/passwd', symlink: true }])), /outside the plugin/);
  await assert.rejects(unpackUpload(tar([manifest, { path: 'passwd', link: '/etc/passwd', type: '2' }])), /outside the plugin/);
  await assert.rejects(unpackUpload(tar([manifest, { path: 'skills/a', link: '../../x', type: '2' }])), /outside the plugin/);
  await assert.rejects(unpackUpload(tar([manifest, { path: 'b', link: '../x', type: '1' }])), /outside the plugin/);
  const inside = await unpackUpload(zip([manifest, { path: 'real.md', body: 'hello' }, { path: 'docs/alias.md', body: '../real.md', symlink: true }]));
  assert.equal(inside.files.get('docs/alias.md'), 'hello');
});

test('size and count caps, and files that are not plugin archives', async () => {
  const many = Array.from({ length: UPLOAD_LIMITS.files + 1 }, (_, i) => ({ path: `f${i}.md`, body: '' }));
  await assert.rejects(unpackUpload(zip(many)), /over 2000 files/);
  await assert.rejects(unpackUpload(new Uint8Array(UPLOAD_LIMITS.archiveBytes + 1)), /over 20 MB/);
  await assert.rejects(unpackUpload(new TextEncoder().encode('just text')), /Not a plugin archive/);
});

test('a missing or broken manifest says what a plugin needs', async () => {
  const review = async (entries: ZipEntry[]) => {
    const bytes = zip(entries);
    return reviewUpload('x.zip', bytes, await unpackUpload(bytes), []);
  };
  await assert.rejects(review([{ path: 'skills/a/SKILL.md', body: '---\nname: a\n---\nA' }]), /No plugin manifest: a plugin has \.claude-plugin\/plugin\.json/);
  await assert.rejects(review([{ path: '.claude-plugin/marketplace.json', body: '{}' }]), /This is a marketplace/);
  await assert.rejects(review([{ path: '.claude-plugin/plugin.json', body: '{name' }]), /isn't valid JSON/);
  await assert.rejects(review([{ path: '.claude-plugin/plugin.json', body: '{}' }]), /has no name/);
  await assert.rejects(review([{ path: '.claude-plugin/plugin.json', body: '{"name":"empty"}' }]), /no skills, commands, agents, hooks or MCP servers/);
  await assert.rejects(review([{ path: '.claude-plugin/plugin.json', body: '{"name":"mochi"}' }, { path: 'skills/a/SKILL.md', body: 'A' }]), /name Mochi gives its own skills/);
  // Codex's portable layout: a root plugin.json; a plugin Codex can't load anything from says so.
  const codex = await review([{ path: 'plugin.json', body: '{"name":"figma"}' }, { path: 'skills/a/SKILL.md', body: 'A' }]);
  assert.deepEqual(codex.review.loads, { claude: '1 skill', codex: null });
});

type ZipEntry = { path: string; body: string; symlink?: boolean };

// Stored (uncompressed) entries, which the reader takes like deflated ones; a symlink is a Unix entry holding its target.
function zip(entries: ZipEntry[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { path, body, symlink } of entries) {
    const name = Buffer.from(path);
    const data = Buffer.from(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

// ustar headers written by hand, since tar itself won't archive ../ or absolute names as given.
function tar(entries: ({ path: string; body: string } | { path: string; link: string; type: '1' | '2' })[]) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from('body' in entry ? entry.body : '');
    const header = Buffer.alloc(512);
    header.write(entry.path, 0);
    header.write('0000644\0', 100);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('        ', 148);
    header.write('body' in entry ? '0' : entry.type, 156);
    if ('link' in entry) header.write(entry.link, 157);
    header.write('ustar\x0000', 257);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return new Uint8Array(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
