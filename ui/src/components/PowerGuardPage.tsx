import { useState } from 'react';
import { api, PowerGuardStatus } from '../lib/api';

interface Props {
  status: PowerGuardStatus | null;
  onRefresh: () => void;
}

// Power-Guard page: install status + pmset -c settings (with drift
// detection) + install/uninstall/reapply buttons. Mirrors the prior
// PowerGuardPanel but with more breathing room and a richer pmset view.
export function PowerGuardPage({ status, onRefresh }: Props) {
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
      <>
        <h1 className="page-header">Power-Guard</h1>
        <div className="card">Loading…</div>
      </>
    );
  }

  return (
    <>
      <h1 className="page-header">Power-Guard</h1>
      <p className="page-subtitle">
        Keeps external USB-C monitor alive in clamshell mode and warns you
        before the session freezes when you unplug.
      </p>

      <div className="card">
        <h2 className="card-title">Status</h2>
        <div className="kv-row">
          <span className="key">Install state</span>
          <span className="val">
            {status.installed ? (
              <span className="status-pill status-ok">installed</span>
            ) : (
              <span className="status-pill status-bad">not installed</span>
            )}
          </span>
        </div>
        <div className="kv-row">
          <span className="key">Clamshell guard plist</span>
          <span className="val">{status.plist_present ? 'yes' : 'no'}</span>
        </div>
        <div className="kv-row">
          <span className="key">Watchdog plist</span>
          <span className="val">{status.watchdog_plist_present ? 'yes' : 'no'}</span>
        </div>
        <div className="kv-row">
          <span className="key">caffeinate pid</span>
          <span className="val">{status.caffeinate_pid ?? '—'}</span>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">
          pmset -c settings{' '}
          {status.drift_detected ? (
            <span className="status-pill status-warn" style={{ marginLeft: 8 }}>
              drift detected
            </span>
          ) : (
            <span className="status-pill status-ok" style={{ marginLeft: 8 }}>
              in spec
            </span>
          )}
        </h2>
        <div data-testid="pmset-values">
          {Object.entries(status.pmset)
            .filter(([_, v]) => v !== null)
            .map(([k, v]) => (
              <div className="kv-row" key={k}>
                <span className="key">{k}</span>
                <span className="val">{v}</span>
              </div>
            ))}
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Actions</h2>
        <div className="button-row">
          <button
            type="button"
            data-testid="pg-install"
            onClick={() => run(() => api.powerGuardInstall(), 'install')}
            disabled={busy !== null}
          >
            {busy === 'install' ? 'Installing…' : 'Install'}
          </button>
          <button
            type="button"
            className="secondary"
            data-testid="pg-uninstall"
            onClick={() => run(() => api.powerGuardUninstall(), 'uninstall')}
            disabled={busy !== null}
          >
            {busy === 'uninstall' ? 'Uninstalling…' : 'Uninstall'}
          </button>
          <button
            type="button"
            className="secondary"
            data-testid="pg-reapply"
            onClick={() => run(() => api.getPowerGuardReapply(), 'reapply')}
            disabled={busy !== null}
          >
            {busy === 'reapply' ? 'Reapplying…' : 'Reapply pmset -c'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {info && <pre data-testid="pg-info">{info}</pre>}
      </div>
    </>
  );
}