import type { Rect } from '../types';

// 选区一次最多处理的格数，超过则拦截并提示
export const MAX_SELECTION_CELLS = 256 * 256; // 65536

export function selectionTooLarge(r: Rect): boolean {
  return r.w * r.h > MAX_SELECTION_CELLS;
}

// 把矩形钳制到画布范围内，完全不在画布内时返回 null
export function clampRectToCanvas(r: Rect, cols: number, rows: number): Rect | null {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const x2 = Math.min(cols, r.x + r.w);
  const y2 = Math.min(rows, r.y + r.h);
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

// 从 cells 中抠出 rect 区域（rect 必须已在画布内）
export function extractRegion(cells: Uint16Array, cols: number, r: Rect): Uint16Array {
  const buf = new Uint16Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      buf[y * r.w + x] = cells[(r.y + y) * cols + (r.x + x)];
    }
  }
  return buf;
}

// 把 rect 区域填成 colorIdx，返回新 cells
export function fillRegion(cells: Uint16Array, cols: number, r: Rect, colorIdx: number): Uint16Array {
  const next = new Uint16Array(cells);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      next[(r.y + y) * cols + (r.x + x)] = colorIdx;
    }
  }
  return next;
}

// 把 buf 贴到 (destX, destY)，画布外部分裁掉，返回新 cells 与裁剪统计
export function blitRegion(
  cells: Uint16Array,
  cols: number,
  rows: number,
  buf: Uint16Array,
  bufW: number,
  bufH: number,
  destX: number,
  destY: number
): { cells: Uint16Array; written: number; clipped: number } {
  const next = new Uint16Array(cells);
  let written = 0;
  for (let y = 0; y < bufH; y++) {
    for (let x = 0; x < bufW; x++) {
      const tx = destX + x;
      const ty = destY + y;
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
      next[ty * cols + tx] = buf[y * bufW + x];
      written++;
    }
  }
  return { cells: next, written, clipped: bufW * bufH - written };
}

// 在 rect 范围内原地翻转：'horizontal' = 左右翻转，'vertical' = 上下翻转
export function flipRegion(
  cells: Uint16Array,
  cols: number,
  r: Rect,
  axis: 'horizontal' | 'vertical'
): Uint16Array {
  const next = new Uint16Array(cells);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const sx = axis === 'horizontal' ? r.x + (r.w - 1 - x) : r.x + x;
      const sy = axis === 'vertical' ? r.y + (r.h - 1 - y) : r.y + y;
      next[(r.y + y) * cols + (r.x + x)] = cells[sy * cols + sx];
    }
  }
  return next;
}
