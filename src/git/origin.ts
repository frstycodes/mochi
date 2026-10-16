/**
 * A project's identity across computers: its git remote with scheme, user, port and `.git` stripped and the host lowercased,
 * so `git@github.com:Foo/Bar.git` and `https://GitHub.com/Foo/Bar` both read `github.com/Foo/Bar`. Null for anything that
 * isn't a network remote (local paths, `file://`, `ext::`). The path keeps its case: only some hosts ignore it.
 */
export function normalizeOrigin(url: string): string | null {
  const remote = splitRemote(url.trim());
  if (!remote) return null;
  const path = remote.path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return `${remote.host.toLowerCase()}/${path}`;
}

/** A URL Mochi will hand to `git clone`: a network remote, nothing git could read as an option or a helper command. */
export function isCloneUrl(url: string) {
  return !/[\s\0]/.test(url) && !url.startsWith('-') && normalizeOrigin(url) !== null;
}

/** The folder a clone of `origin` lands in: its last path part. */
export function repoName(origin: string) {
  return origin.slice(origin.lastIndexOf('/') + 1);
}

const SCHEMES = ['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'];
const HOST = /^[\w.-]+$/;

function splitRemote(url: string) {
  if (url.includes('://')) {
    try {
      const parsed = new URL(url);
      if (!SCHEMES.includes(parsed.protocol) || !HOST.test(parsed.hostname)) return null;
      return { host: parsed.hostname, path: decodeURIComponent(parsed.pathname) };
    } catch {
      return null;
    }
  }
  // scp-style `user@host:path`. A one-letter host is a Windows drive (`C:\…`), and `:/` or `::` (git's `ext::` transport) after it isn't scp syntax.
  const scp = url.match(/^(?:[^@/\\]+@)?([^:/\\]{2,}):(?![/:])([^\\]+)$/);
  return scp && HOST.test(scp[1]) ? { host: scp[1], path: scp[2] } : null;
}
