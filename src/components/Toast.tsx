import { useEffect } from 'react';
import { useChartStore } from '../store/chartStore';

export default function Toast() {
  const notice = useChartStore((s) => s.notice);
  const clearNotice = useChartStore((s) => s.clearNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearNotice, 2600);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  if (!notice) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 52,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        padding: '8px 16px',
        borderRadius: 6,
        fontSize: 13,
        color: '#fff',
        background: notice.kind === 'warn' ? '#e67e22' : '#3498db',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {notice.message}
    </div>
  );
}
