import { useChartStore } from '../store/chartStore';
import { clearRegion, fillRegion, flipRegion, invalidRectReason } from '../utils/selection';

const btnStyle = (danger = false): React.CSSProperties => ({
  padding: '4px 10px',
  fontSize: 12,
  borderRadius: 4,
  border: `1px solid ${danger ? '#e74c3c' : '#bdc3c7'}`,
  background: '#fff',
  color: danger ? '#c0392b' : '#333',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

export default function SelectionToolbar() {
  const tool = useChartStore((s) => s.tool);
  const selection = useChartStore((s) => s.selection);
  const chart = useChartStore((s) => s.getCurrentChart());
  const selectedColorIndex = useChartStore((s) => s.selectedColorIndex);
  const updateChart = useChartStore((s) => s.updateChart);
  const setSelection = useChartStore((s) => s.setSelection);
  const notify = useChartStore((s) => s.notify);

  if (tool !== 'select' || !selection || !chart) return null;

  const guard = (fn: () => string | null) => {
    const reason = invalidRectReason(chart, selection);
    if (reason) {
      notify(reason, 'warn');
      return;
    }
    try {
      const msg = fn();
      if (msg) notify(msg);
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败', 'warn');
    }
  };

  const swatch = chart.palette[selectedColorIndex]?.hex ?? '#888';

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #d8d3ca',
        borderRadius: 8,
        boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
        fontSize: 12,
      }}
    >
      <span style={{ color: '#888' }}>
        选区 {selection.w}×{selection.h}
      </span>
      <span style={{ width: 1, height: 18, background: '#e0dcd5' }} />
      <button
        title="把框住的整块一次填成当前颜色"
        style={btnStyle()}
        onClick={() =>
          guard(() => {
            updateChart(chart.id, (ch) => ({ ...ch, cells: fillRegion(ch, selection, selectedColorIndex) }));
            return `已整块填为当前色（${selection.w * selection.h} 格）`;
          })
        }
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, background: swatch, border: '1px solid #999', borderRadius: 2, display: 'inline-block' }} />
          填当前色
        </span>
      </button>
      <button
        title="把框住的整块左右翻转（镜像竖轴）"
        style={btnStyle()}
        onClick={() =>
          guard(() => {
            updateChart(chart.id, (ch) => ({ ...ch, cells: flipRegion(ch, selection, 'horizontal') }));
            return '已左右翻转';
          })
        }
      >
        ↔ 左右翻
      </button>
      <button
        title="把框住的整块上下翻转（镜像横轴）"
        style={btnStyle()}
        onClick={() =>
          guard(() => {
            updateChart(chart.id, (ch) => ({ ...ch, cells: flipRegion(ch, selection, 'vertical') }));
            return '已上下翻转';
          })
        }
      >
        ↕ 上下翻
      </button>
      <button
        title="把框住的整块清成底色（Delete）"
        style={btnStyle(true)}
        onClick={() =>
          guard(() => {
            updateChart(chart.id, (ch) => ({ ...ch, cells: clearRegion(ch, selection) }));
            return '已清成底色';
          })
        }
      >
        清底色
      </button>
      <span style={{ width: 1, height: 18, background: '#e0dcd5' }} />
      <button title="取消框选（Esc）；在选区内按住可直接拖动整块" style={btnStyle()} onClick={() => setSelection(null)}>
        ✕
      </button>
    </div>
  );
}
