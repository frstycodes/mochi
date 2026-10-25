// Stands in for `shiki/wasm` (aliased in vite.config.ts): @pierre/diffs only loads it for preferredHighlighter 'shiki-wasm',
// which this app never sets, and the single-file build would otherwise inline ~600 KB of WebAssembly.
export default undefined;
