import { app, protocol } from 'electron';

const SCHEME = 'mochi-widget';

// Each kind's ceiling: the document written in can narrow it with its own <meta> policy, never widen it.
const POLICIES: Record<string, string> = {
  widget:
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:",
  // MCP apps load their own bundles and call their own APIs; withCsp narrows this to the domains each app declares.
  'mcp-app':
    "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src https: wss:; frame-src https:",
};

// The parent posts the frame's HTML once; document.write keeps this Document, so the header policy above stays bound to it.
const SHELL = `<!doctype html><meta charset="utf-8"><script>
addEventListener('message', (e) => {
  if (e.source !== parent || typeof e.data?.frameHtml !== 'string') return;
  document.open();
  document.write(e.data.frameHtml);
  document.close();
});
</script>`;

/**
 * Widgets and MCP app views get a real document of their own, with a CSP response header. srcdoc, data: and blob: frames
 * would inherit the app's policy, whose script-src allows only the app bundle.
 */
export function serveFrames() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true } },
  ]);
  void app.whenReady().then(() =>
    protocol.handle(SCHEME, (request) => {
      const policy = POLICIES[new URL(request.url).hostname];
      if (!policy) return new Response(null, { status: 404 });
      return new Response(SHELL, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': policy,
        },
      });
    }),
  );
}
