export interface Device {
  id: string;
  label: string;
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
}

export const RESPONSIVE = 'responsive';

export const DEVICES = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, dpr: 2, mobile: true },
  { id: 'iphone-16', label: 'iPhone 16', width: 393, height: 852, dpr: 3, mobile: true },
  { id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max', width: 440, height: 956, dpr: 3, mobile: true },
  { id: 'pixel-9', label: 'Pixel 9', width: 412, height: 915, dpr: 2.625, mobile: true },
  { id: 'ipad-mini', label: 'iPad mini', width: 744, height: 1133, dpr: 2, mobile: true },
  { id: 'ipad-pro', label: 'iPad Pro 13″', width: 1032, height: 1376, dpr: 2, mobile: true },
  { id: 'laptop', label: 'Laptop', width: 1440, height: 900, dpr: 2, mobile: false },
] satisfies Device[];

/**
 * Where a device-sized page sits inside the pane: centred, scaled down to fit (never up), rotated by swapping sides.
 * The native view gets `width × height`; the page keeps a `cssWidth × cssHeight` viewport drawn at `scale`.
 */
export function fitDevice(frame: { width: number; height: number }, device: { width: number; height: number }, isRotated: boolean, padding = 16) {
  const w = isRotated ? device.height : device.width;
  const h = isRotated ? device.width : device.height;
  const scale = Math.min(1, (frame.width - padding * 2) / w, (frame.height - padding * 2) / h);
  const width = Math.max(0, w * scale);
  const height = Math.max(0, h * scale);
  return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height, scale: Math.max(scale, 0.05), cssWidth: w, cssHeight: h };
}
