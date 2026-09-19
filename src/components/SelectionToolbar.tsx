import { useChartStore } from '../store/chartStore';

const btnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #bdc3c7',
  background: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export default function SelectionToolbar() {
  const selection = useChartStore((s) => s.selection);
  const fillSelection = useChartStore((s) => s.fillSelection);
  const flipSelection = useChartStore((s) => s.flipSelection);
  const clearSelectionToBackground = useChartStore((s) => s.clearSelectionToBackground);
  const copySelection = useChartStore((s) => s.copySelection);
  const setSelection = useChartStore((s) => s.setSelection);

  if (!selection) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: '#fff',
        border: '1px solid #e0dcd5',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}
    >
      <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>
        选区 {selection.w}×{selection.h} · 选择工具下框内拖拽可移动
      </span>
      <button style={btnStyle} title="把选区一次填成当前色" onClick={fillSelection}>
        🎨 填充当前色
      </button>
      <button style={btnStyle} title="选区内容左右翻转" onClick={() => flipSelection('horizontal')}>
        ⇋ 左右翻转
      </button>
      <button style={btnStyle} title="选区内容上下翻转" onClick={() => flipSelection('vertical')}>
        ⇵ 上下翻转
      </button>
      <button style={btnStyle} title="把选区清成底色 (Delete)" onClick={clearSelectionToBackground}>
        🧽 清成底色
      </button>
      <button style={btnStyle} title="复制选区 (Ctrl+C)" onClick={copySelection}>
        📋 复制
      </button>
      <button style={btnStyle} title="取消选区 (Esc)" onClick={() => setSelection(null)}>
        ✕
      </button>
    </div>
  );
}
