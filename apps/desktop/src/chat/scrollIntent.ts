// Mostly-horizontal wheels (a code block scrolled sideways on a trackpad) carry a little vertical noise; that isn't scrolling the chat up.
export const isWheelUp = ({
  deltaX,
  deltaY,
}: Pick<WheelEvent, 'deltaX' | 'deltaY'>) =>
  deltaY < 0 && Math.abs(deltaY) >= Math.abs(deltaX);

export const isKeyUp = ({
  key,
  shiftKey,
  metaKey,
}: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey'>) =>
  key === 'PageUp' ||
  key === 'Home' ||
  (key === 'ArrowUp' && !shiftKey) ||
  (key === ' ' && shiftKey && !metaKey);
