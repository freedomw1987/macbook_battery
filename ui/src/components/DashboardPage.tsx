import { useState } from 'react';
import { api, Status } from '../lib/api';
import { BatteryIcon } from './BatteryIcon';
import { ModeBadge } from './ModeBadge';

interface Props {
  status: Status | null;
  error: string | null;
  onApply: () => void;
}

// Quick-mode buttons (Day / Noon / Reset). Each invokes apply.sh via
// the Rust IPC bridge and then refreshes via onApply().
export function DashboardPage({ status, error, onApply }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const apply = async (mode: 'day' | 'noon' | 'reset') => {
    setBusy(mode);
    setOpError(null);
    try {
      await api.setMode(mode);
      onApply();
    } catch (e: any) {
      setOpError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h1 className="page-header">Dashboard</h1>
      <p className="page-subtitle">Live battery status and quick controls.</p>

      {error && <div className="card error">{error}</div>}

      <div className="card status-card" data-testid="status-card">
        <div className="battery-icon-wrap">
          <BatteryIcon status={status} />
        </div>
        <div className="status-meta">
          <div className="status-pct" data-testid="status-pct">
            {status?.pct ?? '?'}%
          </div>
          <div className="status-mode-row">
            <ModeBadge mode={status?.mode ?? null} />
            {status?.charging && <span className="status-pill status-ok">charging</span>}
            {!status?.charging && status?.ac_attached && (
              <span className="status-pill status-warn">plugged in</span>
            )}
            {!status?.ac_attached && <span className="muted">on battery</span>}
            {status?.hold_loop_active && (
              <span className="muted">
                hold-loop{status.hold_loop_pid ? ` pid=${status.hold_loop_pid}` : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Quick mode switch</h2>
        <div className="button-row">
          <button
            type="button"
            data-testid="btn-day"
            onClick={() => apply('day')}
            disabled={busy !== null}
            className={status?.mode === 'day' ? '' : 'secondary'}
          >
            {busy === 'day' ? 'Applying…' : 'Day'}
          </button>
          <button
            type="button"
            data-testid="btn-noon"
            onClick={() => apply('noon')}
            disabled={busy !== null}
            className={status?.mode === 'noon' ? '' : 'secondary'}
          >
            {busy === 'noon' ? 'Applying…' : 'Noon'}
          </button>
          <button
            type="button"
            data-testid="btn-reset"
            onClick={() => apply('reset')}
            disabled={busy !== null}
            className="secondary"
          >
            {busy === 'reset' ? 'Applying…' : 'Reset'}
          </button>
        </div>
        {opError && <div className="error">{opError}</div>}
      </div>
    </>
  );
}