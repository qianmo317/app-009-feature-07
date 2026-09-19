import { useChartStore } from '../store/chartStore';

export default function Toasts() {
  const toasts = useChartStore((s) => s.toasts);
  const dismissToast = useChartStore((s) => s.dismissToast);

  return (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 6, zIndex: 30, pointerEvents: 'none' }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismissToast(t.id)}
          style={{
            pointerEvents: 'auto',
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 12,
            cursor: 'pointer',
            color: '#fff',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            background: t.kind === 'warn' ? '#c0392b' : '#2c3e50',
          }}
        >
          {t.kind === 'warn' ? '⛔ ' : 'ℹ️ '}
          {t.text}
        </div>
      ))}
    </div>
  );
}
