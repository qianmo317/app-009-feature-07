import { useRef, useEffect, useCallback } from 'react';
import { useChartStore } from '../store/chartStore';
import type { Chart, Point, Rect } from '../types';
import { moveRegion, clearRegion, pointInRect, invalidRectReason } from '../utils/selection';

const BASE_CELL = 20;

type Mode = 'idle' | 'drawing' | 'selecting' | 'moving' | 'panning';

interface MoveGhost {
  origin: Rect;
  anchor: Point;
  dx: number;
  dy: number;
  block: Uint16Array;
}

export default function CanvasGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    tool,
    selectedColorIndex,
    scale,
    offset,
    mirrorAxis,
    showGrid,
    setScale,
    setOffset,
    setIsDragging,
    setLastPanPoint,
    setSelection,
    setIsSelecting,
    setClipboard,
    setSelectedColorIndex,
  } = useChartStore();

  // Use ref to access latest chart without causing re-renders
  const chartRef = useRef<Chart | null>(null);
  chartRef.current = useChartStore.getState().charts.find((c) => c.id === useChartStore.getState().currentChartId) ?? null;

  const modeRef = useRef<Mode>('idle');
  const startCellRef = useRef<Point | null>(null);
  const previewRef = useRef<Rect | null>(null);
  const currentCellsRef = useRef<Uint16Array | null>(null);
  const moveGhostRef = useRef<MoveGhost | null>(null);
  const edgeWarnedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const needsRedrawRef = useRef(true);

  // Keep latest values in refs for animation loop
  const stateRef = useRef({ chart: chartRef.current, scale, offset, showGrid, tool, selectedColorIndex, mirrorAxis });
  useEffect(() => {
    stateRef.current = { chart: chartRef.current, scale, offset, showGrid, tool, selectedColorIndex, mirrorAxis };
    needsRedrawRef.current = true;
  }, [scale, offset, showGrid, tool, selectedColorIndex, mirrorAxis]);

  // Subscribe to store changes for redraw without re-render
  useEffect(() => {
    const unsub = useChartStore.subscribe(() => {
      const newChart = useChartStore.getState().charts.find((c) => c.id === useChartStore.getState().currentChartId) ?? null;
      chartRef.current = newChart;
      stateRef.current.chart = newChart;
      needsRedrawRef.current = true;
    });
    return unsub;
  }, []);

  // 切换图解时清掉选区与拖动残留
  const currentChartId = useChartStore((s) => s.currentChartId);
  useEffect(() => {
    moveGhostRef.current = null;
    modeRef.current = 'idle';
    setSelection(null);
  }, [currentChartId, setSelection]);

  /** 未裁剪的格子坐标，拖到画布外时仍可取得（用于块移动） */
  const getRawCellFromEvent = useCallback((e: MouseEvent): Point | null => {
    const canvas = canvasRef.current;
    const st = stateRef.current;
    if (!canvas || !st.chart) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / st.scale - st.offset.x;
    const y = (e.clientY - rect.top) / st.scale - st.offset.y;
    return { x: Math.floor(x / BASE_CELL), y: Math.floor(y / BASE_CELL) };
  }, []);

  /** 裁剪在画布内的格子坐标，越界返回 null（用于绘制与框选起点） */
  const getCellFromEvent = useCallback((e: MouseEvent): Point | null => {
    const st = stateRef.current;
    const cell = getRawCellFromEvent(e);
    if (!cell || !st.chart) return null;
    if (cell.x < 0 || cell.x >= st.chart.cols || cell.y < 0 || cell.y >= st.chart.rows) return null;
    return cell;
  }, [getRawCellFromEvent]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const st = stateRef.current;
    const c = st.chart;
    if (!c) return;

    const w = container.clientWidth;
    const h = container.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d')!;

    ctx.save();
    ctx.setTransform(st.scale, 0, 0, st.scale, st.offset.x * st.scale, st.offset.y * st.scale);

    const cellSize = BASE_CELL;
    const { cols, rows, palette, cells } = c;

    // Background
    ctx.fillStyle = '#faf8f5';
    ctx.fillRect(-st.offset.x, -st.offset.y, w / st.scale, h / st.scale);

    // Determine visible range
    const startCol = Math.max(0, Math.floor(-st.offset.x / cellSize));
    const startRow = Math.max(0, Math.floor(-st.offset.y / cellSize));
    const endCol = Math.min(cols, Math.ceil((w / st.scale - st.offset.x) / cellSize));
    const endRow = Math.min(rows, Math.ceil((h / st.scale - st.offset.y) / cellSize));

    // Cells
    for (let r = startRow; r < endRow; r++) {
      for (let cIdx = startCol; cIdx < endCol; cIdx++) {
        const idx = cells[r * cols + cIdx];
        ctx.fillStyle = palette[idx]?.hex ?? '#ffffff';
        ctx.fillRect(cIdx * cellSize, r * cellSize, cellSize, cellSize);
      }
    }

    const ghost = moveGhostRef.current;

    // 整块拖动时，源区域先盖成“已搬走”的底色观感
    if (ghost) {
      const o = ghost.origin;
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = palette[0]?.hex ?? '#ffffff';
      ctx.fillRect(o.x * cellSize, o.y * cellSize, o.w * cellSize, o.h * cellSize);
      ctx.restore();
    }

    // Grid
    if (st.showGrid) {
      ctx.strokeStyle = '#e0dcd5';
      ctx.lineWidth = 0.5;
      for (let r = startRow; r <= endRow; r++) {
        const y = r * cellSize;
        ctx.beginPath();
        ctx.moveTo(startCol * cellSize, y);
        ctx.lineTo(endCol * cellSize, y);
        ctx.stroke();
      }
      for (let cIdx = startCol; cIdx <= endCol; cIdx++) {
        const x = cIdx * cellSize;
        ctx.beginPath();
        ctx.moveTo(x, startRow * cellSize);
        ctx.lineTo(x, endRow * cellSize);
        ctx.stroke();
      }

      ctx.strokeStyle = '#c0bab0';
      ctx.lineWidth = 1;
      for (let r = Math.ceil(startRow / 10) * 10; r <= endRow; r += 10) {
        const y = r * cellSize;
        ctx.beginPath();
        ctx.moveTo(startCol * cellSize, y);
        ctx.lineTo(endCol * cellSize, y);
        ctx.stroke();
      }
      for (let cIdx = Math.ceil(startCol / 10) * 10; cIdx <= endCol; cIdx += 10) {
        const x = cIdx * cellSize;
        ctx.beginPath();
        ctx.moveTo(x, startRow * cellSize);
        ctx.lineTo(x, endRow * cellSize);
        ctx.stroke();
      }
    }

    // Shape preview (line / rect)
    if (previewRef.current) {
      const pr = previewRef.current;
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(pr.x * cellSize, pr.y * cellSize, pr.w * cellSize, pr.h * cellSize);
      ctx.setLineDash([]);
    }

    if (ghost) {
      const o = ghost.origin;
      const dstX = o.x + ghost.dx;
      const dstY = o.y + ghost.dy;

      // 源区域虚线灰框
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(o.x * cellSize, o.y * cellSize, o.w * cellSize, o.h * cellSize);
      ctx.setLineDash([]);

      // 目标位置：只画与画布相交的格（落在外面的格子被裁掉）
      const ix0 = Math.max(0, dstX);
      const iy0 = Math.max(0, dstY);
      const ix1 = Math.min(cols - 1, dstX + o.w - 1);
      const iy1 = Math.min(rows - 1, dstY + o.h - 1);
      const canPlace = ix0 <= ix1 && iy0 <= iy1;

      if (canPlace) {
        ctx.save();
        ctx.globalAlpha = 0.95;
        for (let y = iy0; y <= iy1; y++) {
          for (let x = ix0; x <= ix1; x++) {
            const idx = ghost.block[(y - dstY) * o.w + (x - dstX)];
            ctx.fillStyle = palette[idx]?.hex ?? '#ffffff';
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          }
        }
        ctx.restore();
      }

      // 目标外接框：能落下蓝色，整块越界红色
      ctx.strokeStyle = canPlace ? '#27ae60' : '#e74c3c';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(dstX * cellSize, dstY * cellSize, o.w * cellSize, o.h * cellSize);
      ctx.setLineDash([]);
    } else {
      // Selection rect
      const sel = useChartStore.getState().selection;
      if (sel) {
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 2;
        ctx.strokeRect(sel.x * cellSize, sel.y * cellSize, sel.w * cellSize, sel.h * cellSize);
      }
    }

    ctx.restore();
  }, []);

  // Animation loop
  useEffect(() => {
    const loop = () => {
      if (needsRedrawRef.current) {
        needsRedrawRef.current = false;
        draw();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  useEffect(() => {
    const handleResize = () => { needsRedrawRef.current = true; };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const paintCell = (c: Chart, col: number, row: number, colorIdx: number) => {
    const idx = row * c.cols + col;
    if (idx < 0 || idx >= c.cells.length) return;
    const newCells = new Uint16Array(c.cells);
    newCells[idx] = colorIdx;

    if (tool === 'mirror') {
      if (mirrorAxis === 'vertical') {
        const mx = c.cols - 1 - col;
        const midx = row * c.cols + mx;
        if (midx >= 0 && midx < newCells.length) newCells[midx] = colorIdx;
      } else {
        const my = c.rows - 1 - row;
        const midx = my * c.cols + col;
        if (midx >= 0 && midx < newCells.length) newCells[midx] = colorIdx;
      }
    }

    return newCells;
  };

  const fillBucket = (c: Chart, startCol: number, startRow: number, colorIdx: number) => {
    const targetColor = c.cells[startRow * c.cols + startCol];
    if (targetColor === colorIdx) return c.cells;
    const newCells = new Uint16Array(c.cells);
    const stack: [number, number][] = [[startCol, startRow]];
    const visited = new Uint8Array(c.cols * c.rows);

    while (stack.length) {
      const [cc, r] = stack.pop()!;
      const idx = r * c.cols + cc;
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (newCells[idx] !== targetColor) continue;
      newCells[idx] = colorIdx;

      if (cc > 0) stack.push([cc - 1, r]);
      if (cc < c.cols - 1) stack.push([cc + 1, r]);
      if (r > 0) stack.push([cc, r - 1]);
      if (r < c.rows - 1) stack.push([cc, r + 1]);
    }
    return newCells;
  };

  const drawLine = (c: Chart, x0: number, y0: number, x1: number, y1: number, colorIdx: number) => {
    const newCells = currentCellsRef.current ? new Uint16Array(currentCellsRef.current) : new Uint16Array(c.cells);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;

    while (true) {
      const idx = y * c.cols + x;
      if (idx >= 0 && idx < newCells.length) newCells[idx] = colorIdx;
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return newCells;
  };

  const drawRect = (c: Chart, x0: number, y0: number, x1: number, y1: number, colorIdx: number) => {
    const newCells = currentCellsRef.current ? new Uint16Array(currentCellsRef.current) : new Uint16Array(c.cells);
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * c.cols + x;
        if (idx >= 0 && idx < newCells.length) newCells[idx] = colorIdx;
      }
    }
    return newCells;
  };

  const beginBlockMove = (c: Chart, sel: Rect, cell: Point) => {
    const block = new Uint16Array(sel.w * sel.h);
    for (let y = 0; y < sel.h; y++) {
      for (let x = 0; x < sel.w; x++) {
        block[y * sel.w + x] = c.cells[(sel.y + y) * c.cols + (sel.x + x)];
      }
    }
    moveGhostRef.current = { origin: { ...sel }, anchor: cell, dx: 0, dy: 0, block };
    modeRef.current = 'moving';
    needsRedrawRef.current = true;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const store = useChartStore.getState();
    const c = stateRef.current.chart;
    if (!c) return;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsDragging(true);
      setLastPanPoint({ x: e.clientX, y: e.clientY });
      modeRef.current = 'panning';
      return;
    }
    if (e.button === 2) {
      const cell = getCellFromEvent(e.nativeEvent);
      if (cell) {
        const idx = c.cells[cell.y * c.cols + cell.x];
        if (idx >= 0 && idx < c.palette.length) setSelectedColorIndex(idx);
      }
      return;
    }
    if (e.button !== 0) return;

    const cell = getCellFromEvent(e.nativeEvent);
    if (!cell) return;

    const currentTool = stateRef.current.tool;

    if (currentTool === 'select') {
      const sel = store.selection;
      if (sel && pointInRect(cell.x, cell.y, sel)) {
        // 按在选区内：整块拖走
        beginBlockMove(c, sel, cell);
      } else {
        // 按在选区外：重新框选（手一抖框错了直接重框，不必先取消）
        modeRef.current = 'selecting';
        setIsSelecting(true);
        startCellRef.current = cell;
        edgeWarnedRef.current = false;
        setSelection(null);
      }
      return;
    }

    modeRef.current = 'drawing';
    startCellRef.current = cell;
    currentCellsRef.current = new Uint16Array(c.cells);

    if (currentTool === 'pencil' || currentTool === 'mirror') {
      const newCells = paintCell(c, cell.x, cell.y, stateRef.current.selectedColorIndex);
      if (newCells) {
        useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
      }
    } else if (currentTool === 'bucket') {
      const newCells = fillBucket(c, cell.x, cell.y, stateRef.current.selectedColorIndex);
      useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
      modeRef.current = 'idle';
    } else if (currentTool === 'line' || currentTool === 'rect') {
      previewRef.current = { x: cell.x, y: cell.y, w: 1, h: 1 };
      needsRedrawRef.current = true;
    }
  };

  /** 窗口级事件：拖到画布外（甚至离开 canvas）也能持续跟手 */
  useEffect(() => {
    const updateCursor = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const st = stateRef.current;
      let cursor = 'default';
      if (useChartStore.getState().isDragging) cursor = 'grabbing';
      else if (moveGhostRef.current) cursor = 'grabbing';
      else if (st.tool === 'select') {
        const cell = getRawCellFromEvent(e);
        const sel = useChartStore.getState().selection;
        cursor = cell && sel && pointInRect(cell.x, cell.y, sel) ? 'move' : 'crosshair';
      } else {
        cursor = 'crosshair';
      }
      canvas.style.cursor = cursor;
    };

    const onMove = (e: MouseEvent) => {
      const store = useChartStore.getState();
      const c = stateRef.current.chart;
      if (!c) return;

      if (store.isDragging && store.lastPanPoint) {
        const dx = (e.clientX - store.lastPanPoint.x) / store.scale;
        const dy = (e.clientY - store.lastPanPoint.y) / store.scale;
        setOffset({ x: store.offset.x + dx, y: store.offset.y + dy });
        setLastPanPoint({ x: e.clientX, y: e.clientY });
        return;
      }

      if (modeRef.current === 'selecting' && startCellRef.current) {
        const raw = getRawCellFromEvent(e);
        if (!raw) return;
        const sc = startCellRef.current;
        const ex = Math.max(0, Math.min(c.cols - 1, raw.x));
        const ey = Math.max(0, Math.min(c.rows - 1, raw.y));
        if ((raw.x < 0 || raw.x >= c.cols || raw.y < 0 || raw.y >= c.rows) && !edgeWarnedRef.current) {
          edgeWarnedRef.current = true;
          store.notify('选区不能超出画布，已贴边框选', 'warn');
        }
        setSelection({
          x: Math.min(sc.x, ex),
          y: Math.min(sc.y, ey),
          w: Math.abs(ex - sc.x) + 1,
          h: Math.abs(ey - sc.y) + 1,
        });
        return;
      }

      if (modeRef.current === 'moving' && moveGhostRef.current) {
        const raw = getRawCellFromEvent(e);
        if (!raw) return;
        const g = moveGhostRef.current;
        g.dx = raw.x - g.anchor.x;
        g.dy = raw.y - g.anchor.y;
        needsRedrawRef.current = true;
        return;
      }

      if (modeRef.current !== 'drawing' || !startCellRef.current) {
        updateCursor(e);
        return;
      }

      const cell = getCellFromEvent(e);
      if (!cell) return;
      const currentTool = stateRef.current.tool;

      if (currentTool === 'pencil' || currentTool === 'mirror') {
        const newCells = paintCell(c, cell.x, cell.y, stateRef.current.selectedColorIndex);
        if (newCells) {
          useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
        }
      } else if (currentTool === 'line' || currentTool === 'rect') {
        previewRef.current = {
          x: Math.min(startCellRef.current.x, cell.x),
          y: Math.min(startCellRef.current.y, cell.y),
          w: Math.abs(cell.x - startCellRef.current.x) + 1,
          h: Math.abs(cell.y - startCellRef.current.y) + 1,
        };
        needsRedrawRef.current = true;
      }
    };

    const onUp = (e: MouseEvent) => {
      const store = useChartStore.getState();
      if (store.isDragging) {
        setIsDragging(false);
        setLastPanPoint(null);
        modeRef.current = 'idle';
        return;
      }

      if (modeRef.current === 'selecting') {
        modeRef.current = 'idle';
        setIsSelecting(false);
        return;
      }

      if (modeRef.current === 'moving') {
        const g = moveGhostRef.current;
        const c = stateRef.current.chart;
        modeRef.current = 'idle';
        moveGhostRef.current = null;
        if (!c || !g) {
          needsRedrawRef.current = true;
          return;
        }
        if (g.dx === 0 && g.dy === 0) {
          needsRedrawRef.current = true;
          return;
        }
        const result = moveRegion(c, g.origin, g.dx, g.dy);
        if ('error' in result) {
          store.notify(result.error, 'warn');
        } else {
          useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: result.cells }));
          setSelection(result.destRect);
          if (result.discarded > 0) {
            store.notify(`已挪到新位置，画布外 ${result.discarded} 格被裁掉`, 'warn');
          }
        }
        needsRedrawRef.current = true;
        return;
      }

      if (modeRef.current !== 'drawing') return;
      const c = stateRef.current.chart;
      if (!c || !startCellRef.current) {
        modeRef.current = 'idle';
        return;
      }

      const cell = getCellFromEvent(e);
      const currentTool = stateRef.current.tool;
      if (cell && currentTool === 'line') {
        const newCells = drawLine(c, startCellRef.current.x, startCellRef.current.y, cell.x, cell.y, stateRef.current.selectedColorIndex);
        useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
      } else if (cell && currentTool === 'rect') {
        const newCells = drawRect(c, startCellRef.current.x, startCellRef.current.y, cell.x, cell.y, stateRef.current.selectedColorIndex);
        useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
      }

      modeRef.current = 'idle';
      startCellRef.current = null;
      previewRef.current = null;
      currentCellsRef.current = null;
      needsRedrawRef.current = true;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [getCellFromEvent, getRawCellFromEvent, setIsDragging, setIsSelecting, setLastPanPoint, setOffset, setSelection]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setScale(scale * delta);
    } else {
      setOffset({ x: offset.x - e.deltaX / scale, y: offset.y - e.deltaY / scale });
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // 键盘：复制/粘贴、方向键整块微移、Delete 清底色、Esc 取消框选
  useEffect(() => {
    const isEditable = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

    const nudge = (c: Chart, sel: Rect, dx: number, dy: number) => {
      const result = moveRegion(c, sel, dx, dy);
      const store = useChartStore.getState();
      if ('error' in result) {
        store.notify(result.error, 'warn');
        return;
      }
      store.updateChart(c.id, (ch) => ({ ...ch, cells: result.cells }));
      store.setSelection(result.destRect);
      if (result.discarded > 0) {
        store.notify(`画布外 ${result.discarded} 格被裁掉，已经挪不动了`, 'warn');
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const store = useChartStore.getState();
      const c = store.getCurrentChart();
      if (!c) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (store.selection) {
          const s = store.selection;
          const buf = new Uint16Array(s.w * s.h);
          for (let r = 0; r < s.h; r++) {
            for (let cc = 0; cc < s.w; cc++) {
              buf[r * s.w + cc] = c.cells[(s.y + r) * c.cols + (s.x + cc)];
            }
          }
          setClipboard({ cells: buf, cols: s.w, rows: s.h });
          store.notify('已复制选区');
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        const cb = store.clipboard;
        if (cb && store.selection) {
          const newCells = new Uint16Array(c.cells);
          for (let r = 0; r < cb.rows; r++) {
            for (let cc = 0; cc < cb.cols; cc++) {
              const tx = store.selection.x + cc;
              const ty = store.selection.y + r;
              if (tx < c.cols && ty < c.rows) {
                newCells[ty * c.cols + tx] = cb.cells[r * cb.cols + cc];
              }
            }
          }
          store.updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
        }
        return;
      }

      const sel = store.selection;
      if (store.tool !== 'select' || !sel) return;

      if (e.key === 'Escape') {
        setSelection(null);
        moveGhostRef.current = null;
        needsRedrawRef.current = true;
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const reason = invalidRectReason(c, sel);
        if (reason) {
          store.notify(reason, 'warn');
          return;
        }
        store.updateChart(c.id, (ch) => ({ ...ch, cells: clearRegion(ch, sel) }));
        store.notify('选区已整块清成底色');
        return;
      }

      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(c, sel, -step, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(c, sel, step, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(c, sel, 0, -step); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(c, sel, 0, step); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setClipboard, setSelection]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
        background: '#f5f3ef',
        userSelect: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}
