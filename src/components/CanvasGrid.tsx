import { useRef, useEffect, useCallback, useState } from 'react';
import { useChartStore } from '../store/chartStore';
import type { Chart, Point, Rect } from '../types';
import {
  MAX_SELECTION_CELLS,
  blitRegion,
  clampRectToCanvas,
  extractRegion,
  fillRegion,
  selectionTooLarge,
} from '../utils/selection';

const BASE_CELL = 20;

export default function CanvasGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    tool,
    selectedColorIndex,
    scale,
    offset,
    mirrorAxis,
    isDragging,
    lastPanPoint,
    selection,
    isSelecting,
    showGrid,
    setScale,
    setOffset,
    setIsDragging,
    setLastPanPoint,
    setSelection,
    setIsSelecting,
    setSelectedColorIndex,
  } = useChartStore();

  // Use ref to access latest chart without causing re-renders
  const chartRef = useRef<Chart | null>(null);
  chartRef.current = useChartStore.getState().charts.find((c) => c.id === useChartStore.getState().currentChartId) ?? null;

  const drawingRef = useRef(false);
  const startCellRef = useRef<Point | null>(null);
  const previewRef = useRef<Rect | null>(null);
  const currentCellsRef = useRef<Uint16Array | null>(null);
  const rafRef = useRef<number>(0);
  const needsRedrawRef = useRef(true);
  // 选区移动状态：buf 为抠出的内容，原位置已清成底色，松手时按 (origX+dx, origY+dy) 贴回
  const moveRef = useRef<{
    buf: Uint16Array;
    w: number;
    h: number;
    origX: number;
    origY: number;
    startClientX: number;
    startClientY: number;
    dx: number;
    dy: number;
  } | null>(null);
  const [hoverInSel, setHoverInSel] = useState(false);

  // Keep latest values in refs for animation loop and event handlers
  const stateRef = useRef({ chart: chartRef.current, scale, offset, showGrid, selection, tool, selectedColorIndex, mirrorAxis });
  useEffect(() => {
    stateRef.current = { chart: chartRef.current, scale, offset, showGrid, selection, tool, selectedColorIndex, mirrorAxis };
    needsRedrawRef.current = true;
  }, [scale, offset, showGrid, selection, tool, selectedColorIndex, mirrorAxis]);

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

  const getCellFromEvent = useCallback(
    (e: React.MouseEvent | MouseEvent): Point | null => {
      const canvas = canvasRef.current;
      const st = stateRef.current;
      if (!canvas || !st.chart) return null;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / st.scale - st.offset.x;
      const y = (e.clientY - rect.top) / st.scale - st.offset.y;
      const cellSize = BASE_CELL;
      const col = Math.floor(x / cellSize);
      const row = Math.floor(y / cellSize);
      if (col < 0 || col >= st.chart.cols || row < 0 || row >= st.chart.rows) return null;
      return { x: col, y: row };
    },
    []
  );

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
        const color = palette[idx]?.hex ?? '#ffffff';
        ctx.fillStyle = color;
        ctx.fillRect(cIdx * cellSize, r * cellSize, cellSize, cellSize);
      }
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

    // Selection preview
    if (previewRef.current) {
      const pr = previewRef.current;
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(pr.x * cellSize, pr.y * cellSize, pr.w * cellSize, pr.h * cellSize);
      ctx.setLineDash([]);
    }

    // Selection rect
    if (st.selection) {
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.strokeRect(st.selection.x * cellSize, st.selection.y * cellSize, st.selection.w * cellSize, st.selection.h * cellSize);
    }

    // 移动中的浮动内容（原位置已清空，内容跟着鼠标走）
    const mv = moveRef.current;
    if (mv) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      for (let r = 0; r < mv.h; r++) {
        for (let cc = 0; cc < mv.w; cc++) {
          const tx = mv.origX + mv.dx + cc;
          const ty = mv.origY + mv.dy + r;
          if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
          ctx.fillStyle = palette[mv.buf[r * mv.w + cc]]?.hex ?? '#ffffff';
          ctx.fillRect(tx * cellSize, ty * cellSize, cellSize, cellSize);
        }
      }
      ctx.restore();
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

  const handleMouseDown = (e: React.MouseEvent) => {
    const c = stateRef.current.chart;
    if (!c) return;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsDragging(true);
      setLastPanPoint({ x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button === 2) {
      const cell = getCellFromEvent(e);
      if (cell) {
        const idx = c.cells[cell.y * c.cols + cell.x];
        const paletteIdx = c.palette.findIndex((_, i) => i === idx);
        if (paletteIdx >= 0) setSelectedColorIndex(paletteIdx);
      }
      return;
    }
    if (e.button !== 0) return;

    const cell = getCellFromEvent(e);
    if (!cell) return;

    if (tool === 'select') {
      const sel = selection;
      if (sel && cell.x >= sel.x && cell.x < sel.x + sel.w && cell.y >= sel.y && cell.y < sel.y + sel.h) {
        // 点在已有选区内 → 整块拖动
        if (selectionTooLarge(sel)) {
          useChartStore.getState().notify(
            `选区太大（${sel.w}×${sel.h}，共 ${sel.w * sel.h} 格），一次最多移动 ${MAX_SELECTION_CELLS} 格`,
            'warn'
          );
          return;
        }
        moveRef.current = {
          buf: extractRegion(c.cells, c.cols, sel),
          w: sel.w,
          h: sel.h,
          origX: sel.x,
          origY: sel.y,
          startClientX: e.clientX,
          startClientY: e.clientY,
          dx: 0,
          dy: 0,
        };
        // 原位置先清成底色，松手时再把内容贴到新位置
        const cleared = fillRegion(c.cells, c.cols, sel, 0);
        useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: cleared }));
        needsRedrawRef.current = true;
        return;
      }
      setIsSelecting(true);
      startCellRef.current = cell;
      setSelection(null);
      return;
    }

    drawingRef.current = true;
    startCellRef.current = cell;
    currentCellsRef.current = new Uint16Array(c.cells);

    if (tool === 'pencil' || tool === 'mirror') {
      const newCells = paintCell(c, cell.x, cell.y, selectedColorIndex);
      if (newCells) {
        useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
      }
    } else if (tool === 'bucket') {
      const newCells = fillBucket(c, cell.x, cell.y, selectedColorIndex);
      useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
      drawingRef.current = false;
    } else if (tool === 'line' || tool === 'rect') {
      previewRef.current = { x: cell.x, y: cell.y, w: 1, h: 1 };
      needsRedrawRef.current = true;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const c = stateRef.current.chart;
    if (!c) return;

    if (isDragging && lastPanPoint) {
      const dx = (e.clientX - lastPanPoint.x) / scale;
      const dy = (e.clientY - lastPanPoint.y) / scale;
      setOffset({ x: offset.x + dx, y: offset.y + dy });
      setLastPanPoint({ x: e.clientX, y: e.clientY });
      return;
    }

    // 选区移动中：用像素位移换算格数，鼠标移出画布也能继续拖
    const mv = moveRef.current;
    if (mv) {
      const cellPx = BASE_CELL * stateRef.current.scale;
      mv.dx = Math.round((e.clientX - mv.startClientX) / cellPx);
      mv.dy = Math.round((e.clientY - mv.startClientY) / cellPx);
      setSelection({ x: mv.origX + mv.dx, y: mv.origY + mv.dy, w: mv.w, h: mv.h });
      needsRedrawRef.current = true;
      return;
    }

    const cell = getCellFromEvent(e);
    if (!cell) {
      if (hoverInSel) setHoverInSel(false);
      return;
    }

    // 选择工具下指针悬停在选区内时显示移动光标
    if (tool === 'select' && selection) {
      const inside =
        cell.x >= selection.x && cell.x < selection.x + selection.w && cell.y >= selection.y && cell.y < selection.y + selection.h;
      if (inside !== hoverInSel) setHoverInSel(inside);
    } else if (hoverInSel) {
      setHoverInSel(false);
    }

    if (isSelecting && startCellRef.current) {
      const sc = startCellRef.current;
      const x = Math.min(sc.x, cell.x);
      const y = Math.min(sc.y, cell.y);
      const w = Math.abs(cell.x - sc.x) + 1;
      const h = Math.abs(cell.y - sc.y) + 1;
      setSelection({ x, y, w, h });
      return;
    }

    if (!drawingRef.current || !startCellRef.current) return;

    if (tool === 'pencil' || tool === 'mirror') {
      const newCells = paintCell(c, cell.x, cell.y, selectedColorIndex);
      if (newCells) {
        useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
      }
    } else if (tool === 'line') {
      previewRef.current = {
        x: Math.min(startCellRef.current.x, cell.x),
        y: Math.min(startCellRef.current.y, cell.y),
        w: Math.abs(cell.x - startCellRef.current.x) + 1,
        h: Math.abs(cell.y - startCellRef.current.y) + 1,
      };
      needsRedrawRef.current = true;
    } else if (tool === 'rect') {
      previewRef.current = {
        x: Math.min(startCellRef.current.x, cell.x),
        y: Math.min(startCellRef.current.y, cell.y),
        w: Math.abs(cell.x - startCellRef.current.x) + 1,
        h: Math.abs(cell.y - startCellRef.current.y) + 1,
      };
      needsRedrawRef.current = true;
    }
  };

  // 松手提交移动：越界部分裁掉并提示；完全移出画布则拦截并还原
  const commitMove = useCallback((e: { clientX: number; clientY: number }) => {
    const mv = moveRef.current;
    moveRef.current = null;
    const c = stateRef.current.chart;
    if (!mv || !c) return;
    const store = useChartStore.getState();
    const cellPx = BASE_CELL * stateRef.current.scale;
    const nx = mv.origX + Math.round((e.clientX - mv.startClientX) / cellPx);
    const ny = mv.origY + Math.round((e.clientY - mv.startClientY) / cellPx);

    const clamped = clampRectToCanvas({ x: nx, y: ny, w: mv.w, h: mv.h }, c.cols, c.rows);
    if (!clamped) {
      const restored = blitRegion(c.cells, c.cols, c.rows, mv.buf, mv.w, mv.h, mv.origX, mv.origY);
      store.updateChart(c.id, (ch) => ({ ...ch, cells: restored.cells }));
      setSelection({ x: mv.origX, y: mv.origY, w: mv.w, h: mv.h });
      store.notify('选区已完全移出画布，无法移动，已还原到原位置', 'warn');
      return;
    }
    const { cells, clipped } = blitRegion(c.cells, c.cols, c.rows, mv.buf, mv.w, mv.h, nx, ny);
    store.updateChart(c.id, (ch) => ({ ...ch, cells }));
    setSelection(clamped);
    if (clipped > 0) {
      store.notify(`已移动选区，画布外的 ${clipped} 格被裁掉`, 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只用到 ref 与稳定的 store action
  }, []);

  // 移动中即使在画布外（或其他按钮上）松开鼠标也要提交，否则已清空的原位置会丢内容
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      if (moveRef.current) commitMove(e);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [commitMove]);

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isDragging) {
      setIsDragging(false);
      setLastPanPoint(null);
      return;
    }
    if (moveRef.current) {
      commitMove(e);
      return;
    }
    if (isSelecting) {
      setIsSelecting(false);
      const sel = useChartStore.getState().selection;
      if (sel && selectionTooLarge(sel)) {
        setSelection(null);
        useChartStore.getState().notify(
          `选区太大（${sel.w}×${sel.h}，共 ${sel.w * sel.h} 格），一次最多 ${MAX_SELECTION_CELLS} 格，请缩小框选范围`,
          'warn'
        );
      }
      return;
    }
    const c = stateRef.current.chart;
    if (!drawingRef.current || !c || !startCellRef.current) return;

    const cell = getCellFromEvent(e);
    if (!cell) {
      drawingRef.current = false;
      startCellRef.current = null;
      previewRef.current = null;
      needsRedrawRef.current = true;
      return;
    }

    if (tool === 'line') {
      const newCells = drawLine(c, startCellRef.current.x, startCellRef.current.y, cell.x, cell.y, selectedColorIndex);
      useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
    } else if (tool === 'rect') {
      const newCells = drawRect(c, startCellRef.current.x, startCellRef.current.y, cell.x, cell.y, selectedColorIndex);
      useChartStore.getState().updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
    }

    drawingRef.current = false;
    startCellRef.current = null;
    previewRef.current = null;
    currentCellsRef.current = null;
    needsRedrawRef.current = true;
  };

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

  // Copy / Paste / Delete / Esc shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 输入框里不拦截按键（如重命名标题时的 Ctrl+C、Backspace）
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const store = useChartStore.getState();
      const st = stateRef.current;
      const c = st.chart;
      if (!c) return;

      if (e.key === 'Escape') {
        const mv = moveRef.current;
        if (mv) {
          // 取消移动：内容贴回原位置
          moveRef.current = null;
          const restored = blitRegion(c.cells, c.cols, c.rows, mv.buf, mv.w, mv.h, mv.origX, mv.origY);
          store.updateChart(c.id, (ch) => ({ ...ch, cells: restored.cells }));
          store.setSelection({ x: mv.origX, y: mv.origY, w: mv.w, h: mv.h });
          store.notify('已取消移动，选区还原到原位置');
        } else if (st.selection) {
          store.setSelection(null);
        }
        return;
      }

      // 移动过程中不响应其他快捷键，避免操作到半清空的数据
      if (moveRef.current) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selection) {
          e.preventDefault();
          store.clearSelectionToBackground();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (st.selection) {
          e.preventDefault();
          store.copySelection();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        const cb = store.clipboard;
        if (cb && st.selection) {
          e.preventDefault();
          const newCells = new Uint16Array(c.cells);
          for (let r = 0; r < cb.rows; r++) {
            for (let cc = 0; cc < cb.cols; cc++) {
              const tx = st.selection.x + cc;
              const ty = st.selection.y + r;
              if (tx >= 0 && tx < c.cols && ty >= 0 && ty < c.rows) {
                newCells[ty * c.cols + tx] = cb.cells[r * cb.cols + cc];
              }
            }
          }
          store.updateChart(c.id, (ch) => ({ ...ch, cells: newCells }));
        }
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
        cursor: isDragging
          ? 'grabbing'
          : tool === 'select' && selection && hoverInSel
            ? 'move'
            : tool === 'picker'
              ? 'crosshair'
              : 'default',
        background: '#f5f3ef',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}
