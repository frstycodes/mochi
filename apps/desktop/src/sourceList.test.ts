import { describe, expect, it } from 'vite-plus/test';
import { nextRow } from './sourceList';

describe('nextRow', () => {
  it('steps with the arrows and jumps with Home and End', () => {
    expect(nextRow('ArrowDown', 1, 4)).toBe(2);
    expect(nextRow('ArrowUp', 1, 4)).toBe(0);
    expect(nextRow('Home', 2, 4)).toBe(0);
    expect(nextRow('End', 0, 4)).toBe(3);
  });

  it('stops at the ends instead of wrapping', () => {
    expect(nextRow('ArrowDown', 3, 4)).toBeUndefined();
    expect(nextRow('ArrowUp', 0, 4)).toBeUndefined();
  });

  it('ignores other keys and empty lists', () => {
    expect(nextRow('Enter', 1, 4)).toBeUndefined();
    expect(nextRow('Home', -1, 0)).toBeUndefined();
  });
});
