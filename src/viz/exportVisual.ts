const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'];

/** Serializes a live <svg> with computed paint inlined: Tailwind classes and CSS variables don't survive outside the app. */
export function serializeSvg(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const live = [svg, ...svg.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  live.forEach((el, i) => {
    const css = getComputedStyle(el);
    const style = STYLE_PROPS.map((p) => `${p}:${css.getPropertyValue(p)}`).join(';');
    copies[i].setAttribute('style', style);
    copies[i].removeAttribute('class');
  });
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(width)));
  clone.setAttribute('height', String(Math.round(height)));
  return new XMLSerializer().serializeToString(clone);
}

/** Paints an SVG document onto a canvas behind the current page background. An <img> never runs the SVG's scripts. */
export async function svgToPng(source: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, img.naturalWidth * scale);
    canvas.height = Math.max(1, img.naturalHeight * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resolves var(--token) references in agent-written SVG so the file looks the same outside the app. */
export function withThemeVars(source: string) {
  const css = getComputedStyle(document.documentElement);
  return source.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (match, name: string, fallback?: string) => css.getPropertyValue(name).trim() || fallback?.trim() || match);
}

export function download(name: string, data: Blob | string, type = 'text/plain') {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoking in the same task can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
