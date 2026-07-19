import { useState } from 'react';
import { api, PowerGuardStatus } from '../lib/api';

interface Props {
  status: PowerGuardStatus | null;
  onRefresh: () => void;
}

export function PowerGuardPanel({ status, onRefresh }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (action: () => Promise<string>, label: string) => {
    setBusy(label);
    setError(null);
    setInfo(null);
    try {
      const result = await action();
      setInfo(result);
      onRefresh();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!status) {
    return (
      <div className="card">
        <h2>Power-Guard</h2>
        <div className="muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Power-Guard</h2>
      <div className="row">
        <span className="muted">Status:</span>
        {status.installed ? (
          <span className="status-pill status-ok">installed</span>
        ) : (
          <span className="status-pill status-bad">not installed</span>
        )}
        {status.caffeinate_pid && (
          <span className="muted">caffeinate pid={status.caffeinate_pid}</span>
        )}
      </div>

      <div className="row">
        <span className="muted">pmset -c:</span>
        {status.drift_detected ? (
          <span className="status-pill status-warn">drift</span>
        ) : (
          <span className="status-pill status-ok">in spec</span>
        )}
      </div>
      <pre data-testid="pmset-values">
{Object.entries(status.pmset)
  .filter(([_, v]) => v !== null)
  .map(([k, v]) => `  ${k.padEnd(16)} = ${v}`)
  .join('\n')}
      </pre>

      <div className="row">
        <button
          data-testid="pg-install"
          onClick={() => run(() => api.powerGuardInstall(), 'install')}
          disabled={busy !== null}
        >
          {busy === 'install' ? 'Installing…' : 'Install'}
        </button>
        <button
          data-testid="pg-uninstall"
          className="secondary"
          onClick={() => run(() => api.powerGuardUninstall(), 'uninstall')}
          disabled={busy !== null}
        >
          {busy === 'uninstall' ? 'Uninstalling…' : 'Uninstall'}
        </button>
        <button
          data-testid="pg-reapply"
          className="secondary"
          onClick={() => run(() => api.getPowerGuardReapply(), 'reapply')}
          disabled={busy !== null}
        >
          {busy === 'reapply' ? 'Reapplying…' : 'Reapply pmset -c'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {info && <pre data-testid="pg-info">{info}</pre>}
    </div>
  );
}