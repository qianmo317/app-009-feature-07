import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Chart, Tool, Point, Rect } from '../types';
import {
  MAX_SELECTION_CELLS,
  clampRectToCanvas,
  extractRegion,
  fillRegion,
  flipRegion,
  selectionTooLarge,
} from '../utils/selection';

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createEmptyChart(cols = 64, rows = 64, title = '未命名图解'): Chart {
  return {
    id: generateId(),
    title,
    cols,
    rows,
    palette: [
      { id: generateId(), name: '背景', hex: '#ffffff' },
      { id: generateId(), name: '主色', hex: '#e74c3c' },
    ],
    cells: new Uint16Array(cols * rows),
    gauge: { stsPer10cm: 20, rowsPer10cm: 28 },
    yarn: { gramsPerSkein: 50, metersPerSkein: 125 },
  };
}

export type Notice = { id: number; message: string; kind: 'info' | 'warn' };

interface AppState {
  charts: Chart[];
  currentChartId: string | null;
  tool: Tool;
  selectedColorIndex: number;
  scale: number;
  offset: Point;
  clipboard: { cells: Uint16Array; cols: number; rows: number } | null;
  mirrorAxis: 'horizontal' | 'vertical';
  isDragging: boolean;
  lastPanPoint: Point | null;
  selection: Rect | null;
  isSelecting: boolean;
  showGrid: boolean;
  notice: Notice | null;
}

interface AppActions {
  createChart: (cols?: number, rows?: number, title?: string) => string;
  deleteChart: (id: string) => void;
  duplicateChart: (id: string) => string;
  setCurrentChart: (id: string | null) => void;
  updateChart: (id: string, updater: (chart: Chart) => Chart) => void;
  setTool: (tool: Tool) => void;
  setSelectedColorIndex: (index: number) => void;
  setScale: (scale: number) => void;
  setOffset: (offset: Point) => void;
  panBy: (delta: Point) => void;
  setClipboard: (data: { cells: Uint16Array; cols: number; rows: number } | null) => void;
  setMirrorAxis: (axis: 'horizontal' | 'vertical') => void;
  setIsDragging: (v: boolean) => void;
  setLastPanPoint: (p: Point | null) => void;
  setSelection: (r: Rect | null) => void;
  setIsSelecting: (v: boolean) => void;
  setShowGrid: (v: boolean) => void;
  notify: (message: string, kind?: 'info' | 'warn') => void;
  clearNotice: () => void;
  copySelection: () => void;
  fillSelection: () => void;
  flipSelection: (axis: 'horizontal' | 'vertical') => void;
  clearSelectionToBackground: () => void;
  getCurrentChart: () => Chart | null;
}

// 选区操作的统一守卫：没图解 / 没框选 / 框太大 / 框不在画布内时拦截并说明原因
function guardSelection(get: () => AppState & AppActions): { chart: Chart; rect: Rect } | null {
  const s = get();
  const chart = s.getCurrentChart();
  if (!chart) return null;
  if (!s.selection) {
    s.notify('请先用「选择」工具框选一块区域', 'warn');
    return null;
  }
  if (selectionTooLarge(s.selection)) {
    s.notify(
      `选区太大（${s.selection.w}×${s.selection.h}，共 ${s.selection.w * s.selection.h} 格），一次最多处理 ${MAX_SELECTION_CELLS} 格，请缩小框选范围`,
      'warn'
    );
    return null;
  }
  const rect = clampRectToCanvas(s.selection, chart.cols, chart.rows);
  if (!rect) {
    s.notify('选区不在画布范围内，请重新框选', 'warn');
    return null;
  }
  return { chart, rect };
}

export const useChartStore = create<AppState & AppActions>()(
  persist(
    (set, get) => ({
      charts: [],
      currentChartId: null,
      tool: 'pencil',
      selectedColorIndex: 1,
      scale: 1,
      offset: { x: 0, y: 0 },
      clipboard: null,
      mirrorAxis: 'vertical',
      isDragging: false,
      lastPanPoint: null,
      selection: null,
      isSelecting: false,
      showGrid: true,
      notice: null,

      createChart: (cols, rows, title) => {
        const chart = createEmptyChart(cols, rows, title);
        set((s) => ({ charts: [...s.charts, chart], currentChartId: chart.id }));
        return chart.id;
      },

      deleteChart: (id) => {
        set((s) => {
          const charts = s.charts.filter((c) => c.id !== id);
          return {
            charts,
            currentChartId: s.currentChartId === id ? (charts[0]?.id ?? null) : s.currentChartId,
          };
        });
      },

      duplicateChart: (id) => {
        const src = get().charts.find((c) => c.id === id);
        if (!src) return '';
        const chart: Chart = {
          ...src,
          id: generateId(),
          title: src.title + ' 副本',
          cells: new Uint16Array(src.cells),
        };
        set((s) => ({ charts: [...s.charts, chart], currentChartId: chart.id }));
        return chart.id;
      },

      setCurrentChart: (id) => set({ currentChartId: id }),

      updateChart: (id, updater) => {
        set((s) => ({
          charts: s.charts.map((c) => (c.id === id ? updater(c) : c)),
        }));
      },

      setTool: (tool) => set({ tool }),
      setSelectedColorIndex: (index) => set({ selectedColorIndex: index }),
      setScale: (scale) => set({ scale: Math.max(0.1, Math.min(16, scale)) }),
      setOffset: (offset) => set({ offset }),
      panBy: (delta) => set((s) => ({ offset: { x: s.offset.x + delta.x, y: s.offset.y + delta.y } })),
      setClipboard: (clipboard) => set({ clipboard }),
      setMirrorAxis: (mirrorAxis) => set({ mirrorAxis }),
      setIsDragging: (isDragging) => set({ isDragging }),
      setLastPanPoint: (lastPanPoint) => set({ lastPanPoint }),
      setSelection: (selection) => set({ selection }),
      setIsSelecting: (isSelecting) => set({ isSelecting }),
      setShowGrid: (showGrid) => set({ showGrid }),

      notify: (message, kind = 'info') => set({ notice: { id: Date.now() + Math.random(), message, kind } }),
      clearNotice: () => set({ notice: null }),

      copySelection: () => {
        const g = guardSelection(get);
        if (!g) return;
        const { chart, rect } = g;
        get().setClipboard({ cells: extractRegion(chart.cells, chart.cols, rect), cols: rect.w, rows: rect.h });
        get().notify(`已复制 ${rect.w}×${rect.h} 区域`);
      },

      fillSelection: () => {
        const g = guardSelection(get);
        if (!g) return;
        const { chart, rect } = g;
        const idx = get().selectedColorIndex;
        const cells = fillRegion(chart.cells, chart.cols, rect, idx);
        get().updateChart(chart.id, (c) => ({ ...c, cells }));
        get().notify(`已用「${chart.palette[idx]?.name ?? '当前色'}」填充 ${rect.w}×${rect.h} 区域`);
      },

      flipSelection: (axis) => {
        const g = guardSelection(get);
        if (!g) return;
        const { chart, rect } = g;
        const cells = flipRegion(chart.cells, chart.cols, rect, axis);
        get().updateChart(chart.id, (c) => ({ ...c, cells }));
        // 翻转后框的范围跟着更新，继续框住翻转后的内容
        set({ selection: clampRectToCanvas(rect, chart.cols, chart.rows) });
        get().notify(axis === 'horizontal' ? '已左右翻转选中区域' : '已上下翻转选中区域');
      },

      clearSelectionToBackground: () => {
        const g = guardSelection(get);
        if (!g) return;
        const { chart, rect } = g;
        const cells = fillRegion(chart.cells, chart.cols, rect, 0);
        get().updateChart(chart.id, (c) => ({ ...c, cells }));
        get().notify(`已把 ${rect.w}×${rect.h} 区域清成底色`);
      },

      getCurrentChart: () => {
        const { charts, currentChartId } = get();
        return charts.find((c) => c.id === currentChartId) ?? null;
      },
    }),
    {
      name: 'knitting-chart-storage',
      partialize: (state) => ({
        charts: state.charts.map((c) => ({
          ...c,
          cells: Array.from(c.cells),
        })),
        currentChartId: state.currentChartId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.charts = state.charts.map((c: any) => ({
          ...c,
          cells: new Uint16Array(c.cells),
        }));
      },
    }
  )
);
