import type { Chart, Rect } from '../types';

/** 一次选区操作允许处理的最大格数（防御性上限，正常画布不会超过） */
export const MAX_REGION_CELLS = 1_000_000;

/** 背景/底色在调色板中的固定索引 */
export const BG_INDEX = 0;

export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** 校验选区是否完整落在画布内，不合法时返回原因 */
export function invalidRectReason(chart: Chart, r: Rect | null): string | null {
  if (!r) return '还没有框选任何区域';
  if (r.w <= 0 || r.h <= 0) return '选区无效，请重新框选';
  if (r.w * r.h > MAX_REGION_CELLS) return `选区过大（${r.w * r.h} 格），超过一次操作的上限`;
  if (r.x < 0 || r.y < 0 || r.x + r.w > chart.cols || r.y + r.h > chart.rows) {
    return '选区超出了画布范围';
  }
  return null;
}

function copyRegion(cells: Uint16Array, cols: number, r: Rect): Uint16Array {
  const buf = new Uint16Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      buf[y * r.w + x] = cells[(r.y + y) * cols + (r.x + x)];
    }
  }
  return buf;
}

function withRegion(chart: Chart, r: Rect, write: (buf: Uint16Array) => void): Uint16Array {
  const next = new Uint16Array(chart.cells);
  const buf = copyRegion(next, chart.cols, r);
  write(buf);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      next[(r.y + y) * chart.cols + (r.x + x)] = buf[y * r.w + x];
    }
  }
  return next;
}

/** 把选区一次填成指定颜色 */
export function fillRegion(chart: Chart, r: Rect, colorIdx: number): Uint16Array {
  if (colorIdx < 0 || colorIdx >= chart.palette.length) {
    throw new Error('颜色不在调色板中');
  }
  return withRegion(chart, r, (buf) => buf.fill(colorIdx));
}

/** 把选区整块清成底色 */
export function clearRegion(chart: Chart, r: Rect): Uint16Array {
  return withRegion(chart, r, (buf) => buf.fill(BG_INDEX));
}

/**
 * 翻转选区。
 * horizontal = 左右翻转（镜像竖轴），vertical = 上下翻转（镜像横轴）。
 * 两种翻转都不改变选区外接矩形的宽高与位置，框的范围保持不变。
 */
export function flipRegion(chart: Chart, r: Rect, axis: 'horizontal' | 'vertical'): Uint16Array {
  return withRegion(chart, r, (buf) => {
    const { w, h } = r;
    const original = new Uint16Array(buf);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = axis === 'horizontal' ? w - 1 - x : x;
        const sy = axis === 'vertical' ? h - 1 - y : y;
        buf[y * w + x] = original[sy * w + sx];
      }
    }
  });
}

export interface MoveResult {
  cells: Uint16Array;
  /** 移动后实际落位的选区（已裁掉到画布外的部分） */
  destRect: Rect;
  /** 被裁掉的格数 */
  discarded: number;
}

/**
 * 把选区整块挪到偏移 (dx, dy) 的新位置。
 * - 源区域整块清成底色，块内容按快照写入新位置（支持源/目标重叠的自移动）
 * - 落到画布外的格子裁掉，destRect 收窄为实际落位范围
 * - 整块都在画布外时拦截，返回 error
 */
export function moveRegion(chart: Chart, r: Rect, dx: number, dy: number): MoveResult | { error: string } {
  const { cols, rows, cells } = chart;
  const dst: Rect = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };

  const ix0 = Math.max(0, dst.x);
  const iy0 = Math.max(0, dst.y);
  const ix1 = Math.min(cols - 1, dst.x + dst.w - 1);
  const iy1 = Math.min(rows - 1, dst.y + dst.h - 1);
  if (ix0 > ix1 || iy0 > iy1) {
    return { error: '整块都挪到画布外了，没有格子能落下，已退回原位' };
  }

  const block = copyRegion(cells, cols, r);
  const next = new Uint16Array(cells);

  // 源区域整块清空
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      next[y * cols + x] = BG_INDEX;
    }
  }

  // 只写入与画布相交的部分，其余裁掉
  let placed = 0;
  for (let y = iy0; y <= iy1; y++) {
    for (let x = ix0; x <= ix1; x++) {
      next[y * cols + x] = block[(y - dst.y) * r.w + (x - dst.x)];
      placed++;
    }
  }

  return {
    cells: next,
    destRect: { x: ix0, y: iy0, w: ix1 - ix0 + 1, h: iy1 - iy0 + 1 },
    discarded: r.w * r.h - placed,
  };
}
