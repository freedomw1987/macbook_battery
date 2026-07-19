import { Status } from '../lib/api';

interface Props {
  status: Status | null;
  error?: string | null;
}

export function StatusCard({ status, error }: Props) {
  if (error) {
    return (
      <div className="card">
        <h2>Status</h2>
        <div className="error">{error}</div>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="card">
        <h2>Status</h2>
        <div className="muted">Loading…</div>
      </div>
    );
  }
  const chargePill = status.charging
    ? { cls: 'status-ok', label: 'charging' }
    : { cls: 'status-warn', label: 'discharging' };

  return (
    <div className="card">
      <h2>Status</h2>
      <div className="row">
        <span style={{ fontSize: '24px', fontWeight: 600 }}>
          {status.pct ?? '?'}%
        </span>
        <span className={`status-pill ${chargePill.cls}`}>{chargePill.label}</span>
        {status.ac_attached && <span className="muted">AC attached</span>}
      </div>
      <div className="row">
        <span className="muted">Mode:</span>
        <code>{status.mode}</code>
        {status.hold_loop_active && (
          <span className="muted">
            (hold-loop{status.hold_loop_pid ? ` pid=${status.hold_loop_pid}` : ''})
          </span>
        )}
      </div>
    </div>
  );
}