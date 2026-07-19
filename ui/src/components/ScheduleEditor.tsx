import { useState, useEffect } from 'react';
import { api, ScheduleEntry } from '../lib/api';

interface Props {
  onChange: () => void;
}

const DEFAULT_ENTRIES: ScheduleEntry[] = [
  { time: '06:30', mode: 'day' },
  { time: '09:00', mode: 'day' },
  { time: '12:00', mode: 'noon' },
  { time: '15:00', mode: 'day' },
  { time: '18:00', mode: 'noon' },
];

export function ScheduleEditor({ onChange }: Props) {
  const [entries, setEntries] = useState<ScheduleEntry[]>(DEFAULT_ENTRIES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSchedule()
      .then((loaded) => {
        if (loaded.length > 0) setEntries(loaded);
        setLoading(false);
      })
      .catch((e) => {
        setError(`load failed: ${e}`);
        setLoading(false);
      });
  }, []);

  const update = (idx: number, patch: Partial<ScheduleEntry>) => {
    setEntries((cur) =>
      cur.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    );
    setSavedMsg(null);
  };

  const add = () => {
    setEntries((cur) => [...cur, { time: '00:00', mode: 'day' }]);
  };

  const remove = (idx: number) => {
    setEntries((cur) => cur.filter((_, i) => i !== idx));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const result = await api.setSchedule(entries);
      setSavedMsg(result);
      onChange();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <h2>Schedule</h2>
        <div className="muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Schedule</h2>
      {entries.map((entry, idx) => (
        <div key={idx} className="row" data-testid={`row-${idx}`}>
          <input
            data-testid={`time-${idx}`}
            type="time"
            value={entry.time}
            onChange={(e) => update(idx, { time: e.target.value })}
          />
          <select
            data-testid={`mode-${idx}`}
            value={entry.mode}
            onChange={(e) =>
              update(idx, { mode: e.target.value as 'day' | 'noon' })
            }
          >
            <option value="day">day (cap 80)</option>
            <option value="noon">noon (hold 50)</option>
          </select>
          <button
            className="secondary"
            data-testid={`remove-${idx}`}
            onClick={() => remove(idx)}
            disabled={entries.length <= 1}
          >
            ×
          </button>
        </div>
      ))}
      <div className="row">
        <button className="secondary" onClick={add}>
          + Add row
        </button>
        <button
          data-testid="save-schedule"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save & reload launchd'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {savedMsg && (
        <pre data-testid="schedule-saved-msg">{savedMsg}</pre>
      )}
    </div>
  );
}