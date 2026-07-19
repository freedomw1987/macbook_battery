import { useState } from 'react';
import { api } from '../lib/api';

interface Props {
  currentMode: string | null;
  onChange: () => void;
}

export function ModeSwitcher({ currentMode, onChange }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (mode: 'day' | 'noon' | 'reset') => {
    setBusy(mode);
    setError(null);
    try {
      await api.setMode(mode);
      onChange();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <h2>Quick Mode</h2>
      <div className="row">
        <button
          data-testid="btn-day"
          onClick={() => apply('day')}
          disabled={busy !== null}
          className={currentMode === 'day' ? '' : 'secondary'}
        >
          {busy === 'day' ? 'Applying…' : 'Day (cap 80)'}
        </button>
        <button
          data-testid="btn-noon"
          onClick={() => apply('noon')}
          disabled={busy !== null}
          className={currentMode === 'noon' ? '' : 'secondary'}
        >
          {busy === 'noon' ? 'Applying…' : 'Noon (hold 50)'}
        </button>
        <button
          data-testid="btn-reset"
          onClick={() => apply('reset')}
          disabled={busy !== null}
          className="secondary"
        >
          {busy === 'reset' ? 'Applying…' : 'Reset'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}