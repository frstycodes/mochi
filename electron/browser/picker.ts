// Runs in an isolated world of the page. Resolves with the clicked element, or null on Escape / cancel.
// The overlay is removed two frames before resolving so the element screenshot doesn't include it.
export const PICK_SCRIPT = `new Promise((resolve) => {
  window.__harnessPickCancel?.();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:3px;transition:all 60ms linear;display:none';
  document.documentElement.appendChild(box);
  const selector = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 5; node = node.parentElement) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      const tag = node.localName;
      const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.localName === tag) : [];
      parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(node) + 1) + ')' : tag);
    }
    return parts.join(' > ');
  };
  const move = (e) => {
    const r = e.target.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const finish = (value) => {
    removeEventListener('pointermove', move, true);
    removeEventListener('click', click, true);
    removeEventListener('pointerdown', stop, true);
    removeEventListener('mousedown', stop, true);
    removeEventListener('keydown', key, true);
    box.remove();
    delete window.__harnessPickCancel;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)));
  };
  const click = (e) => {
    stop(e);
    const el = e.target;
    const r = el.getBoundingClientRect();
    finish({ selector: selector(el), html: el.outerHTML.slice(0, 2000), rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
  };
  const key = (e) => e.key === 'Escape' && (stop(e), finish(null));
  addEventListener('pointermove', move, true);
  addEventListener('pointerdown', stop, true);
  addEventListener('mousedown', stop, true);
  addEventListener('click', click, true);
  addEventListener('keydown', key, true);
  window.__harnessPickCancel = () => finish(null);
})`;

export const CANCEL_PICK_SCRIPT = 'window.__harnessPickCancel?.()';
