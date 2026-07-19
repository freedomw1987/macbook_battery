import { useEffect, useState } from 'react';
import { api, ScheduleEntry } from '../lib/api';
import { Thresholds } from '../lib/api';
import { ThresholdSlider } from './ThresholdSlider';

interface Props {
  thresholds: Thresholds;
  onApply: () => void;
}

const DEFAULT_ENTRIES: ScheduleEntry[] = [
  { time: '06:30', mode: 'day' },
  { time: '09:00', mode: 'day' },
  { time: '12:00', mode: 'noon' },
  { time: '15:00', mode: 'day' },
  { time: '18:00', mode: 'noon' },
];

// Local mutable copy of Thresholds (kept separate from props so the
// UI doesn't flash back to the server value on every keypress).
interface DraftThresholds {
  day_upper: number;
  day_lower: number;
  noon_upper: number;
  noon_lower: number;
  noon_charge_back_to: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function nextChargeBack(lower: number): number {
  // hysteresis: charge_back_to = lower + 3 (matches apply.sh default)
  return clamp(lower + 3, lower + 1, 100);
}

export function SchedulePage({ thresholds, onApply }: Props) {
  // Schedule rows
  const [entries, setEntries] = useState<ScheduleEntry[]>(DEFAULT_ENTRIES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Threshold draft (UI sliders)
  const [draft, setDraft] = useState<DraftThresholds>({
    day_upper: thresholds.day_upper,
    day_lower: thresholds.day_lower,
    noon_upper: thresholds.noon_upper,
    noon_lower: thresholds.noon_lower,
    noon_charge_back_to: thresholds.noon_charge_back_to,
  });

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

  useEffect(() => {
    // Keep draft in sync with server-provided thresholds (e.g. on reload).
    setDraft({
      day_upper: thresholds.day_upper,
      day_lower: thresholds.day_lower,
      noon_upper: thresholds.noon_upper,
      noon_lower: thresholds.noon_lower,
      noon_charge_back_to: thresholds.noon_charge_back_to,
    });
  }, [thresholds]);

  const updateEntry = (idx: number, patch: Partial<ScheduleEntry>) => {
    setEntries((cur) => cur.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
    setSavedMsg(null);
  };
  const addEntry = () =>
    setEntries((cur) => [...cur, { time: '00:00', mode: 'day' }]);
  const removeEntry = (idx: number) =>
    setEntries((cur) => cur.filter((_, i) => i !== idx));

  // Threshold handlers — clamp to keep lower <= upper invariant.
  const setDayUpper = (v: number) => {
    const next = clamp(v, draft.day_lower, 100);
    setDraft((d) => ({ ...d, day_upper: next }));
  };
  const setNoonUpper = (v: number) => {
    const next = clamp(v, draft.noon_lower + 1, 100);
    setDraft((d) => ({ ...d, noon_upper: next }));
  };
  const setNoonLower = (v: number) => {
    const clampedLower = clamp(v, 1, draft.noon_upper - 1);
    const nextCb = nextChargeBack(clampedLower);
    setDraft((d) => ({
      ...d,
      noon_lower: clampedLower,
      noon_charge_back_to: nextCb,
    }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      // 1. Persist + apply thresholds (this re-applies current mode
      // with new bounds so hold-loop picks them up immediately).
      const thresholdResult = await api.setThresholds({
        day_upper: draft.day_upper,
        day_lower: draft.day_upper, // cap-mode uses upper as the single bound
        noon_upper: draft.noon_upper,
        noon_lower: draft.noon_lower,
        noon_charge_back_to: draft.noon_charge_back_to,
      });
      // 2. Persist + reload schedule.
      const scheduleResult = await api.setSchedule(entries);
      setSavedMsg(
        `Thresholds: ${thresholdResult}\n\nSchedule: ${scheduleResult}`,
      );
      onApply();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="card">Loading…</div>;
  }

  return (
    <>
      <h1 className="page-header">Schedule &amp; Thresholds</h1>
      <p className="page-subtitle">
        Decide when each mode runs and how full the battery is allowed to get.
      </p>

      <div className="card">
        <h2 className="card-title">Day mode — charging cap</h2>
        <ThresholdSlider
          label="Charging stops at"
          value={draft.day_upper}
          onChange={setDayUpper}
          testId="slider-day-upper"
        />
      </div>

      <div className="card">
        <h2 className="card-title">Noon mode — forced-discharge band</h2>
        <div className="two-col">
          <div>
            <div className="threshold-group">
              <div className="threshold-group-title">Upper (discharge stops)</div>
              <ThresholdSlider
                label="Cap"
                value={draft.noon_upper}
                onChange={setNoonUpper}
                testId="slider-noon-upper"
              />
            </div>
          </div>
          <div>
            <div className="threshold-group">
              <div className="threshold-group-title">Lower (charging resumes)</div>
              <ThresholdSlider
                label="Floor"
                value={draft.noon_lower}
                onChange={setNoonLower}
                testId="slider-noon-lower"
              />
            </div>
          </div>
        </div>
        <div className="kv-row">
          <span className="key">Charge-back-to (hysteresis)</span>
          <span className="val" data-testid="charge-back-to-value">
            {draft.noon_charge_back_to}%
          </span>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Time slots</h2>
        {entries.map((entry, idx) => (
          <div key={idx} className="schedule-row" data-testid={`row-${idx}`}>
            <input
              data-testid={`time-${idx}`}
              type="time"
              value={entry.time}
              onChange={(e) => updateEntry(idx, { time: e.target.value })}
            />
            <select
              data-testid={`mode-${idx}`}
              value={entry.mode}
              onChange={(e) =>
                updateEntry(idx, { mode: e.target.value as 'day' | 'noon' })
              }
            >
              <option value="day">day</option>
              <option value="noon">noon</option>
            </select>
            <span className="muted">{entry.mode === 'day' ? `cap ${draft.day_upper}%` : `${draft.noon_lower}-${draft.noon_upper}%`}</span>
            <button
              type="button"
              className="secondary"
              data-testid={`remove-${idx}`}
              onClick={() => removeEntry(idx)}
              disabled={entries.length <= 1}
            >
              ×
            </button>
          </div>
        ))}
        <div className="button-row" style={{ marginTop: 12 }}>
          <button type="button" className="secondary" onClick={addEntry}>
            + Add row
          </button>
          <button
            type="button"
            data-testid="save-schedule"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save & reload launchd'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {savedMsg && <pre data-testid="schedule-saved-msg">{savedMsg}</pre>}
      </div>
    </>
  );
}