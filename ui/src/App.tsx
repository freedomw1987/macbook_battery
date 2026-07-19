import { useEffect, useState, useCallback } from 'react';
import {
  api,
  Status,
  PowerGuardStatus,
  Thresholds,
} from './lib/api';
import { applyTheme, subscribeSystemTheme } from './lib/theme';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './components/DashboardPage';
import { SchedulePage } from './components/SchedulePage';
import { PowerGuardPage } from './components/PowerGuardPage';

const REFRESH_INTERVAL_MS = 5000;
type Tab = 'dashboard' | 'schedule' | 'power-guard';

export default function App() {
  const [active, setActive] = useState<Tab>('dashboard');
  const [status, setStatus] = useState<Status | null>(null);
  const [pgStatus, setPgStatus] = useState<PowerGuardStatus | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after any user action to trigger immediate refresh.
  const [refreshTick, setRefreshTick] = useState(0);

  // Auto theme: defaults to OS appearance, follow changes.
  useEffect(() => {
    applyTheme('auto');
    return subscribeSystemTheme(() => applyTheme('auto'));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, p, t] = await Promise.all([
        api.getStatus(),
        api.getPowerGuardStatus(),
        api.getThresholds(),
      ]);
      setStatus(s);
      setPgStatus(p);
      setThresholds(t);
      setError(null);
    } catch (e: any) {
      setError(String(e));
    }
  }, []);

  // Initial + polling refresh
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh, refreshTick]);

  const triggerRefresh = () => setRefreshTick((n) => n + 1);

  return (
    <div className="app-shell">
      <Sidebar active={active} onChange={setActive} />
      <main className="main-area">
        {active === 'dashboard' && (
          <DashboardPage
            status={status}
            error={error}
            onApply={triggerRefresh}
          />
        )}
        {active === 'schedule' && (
          <SchedulePage
            thresholds={
              thresholds ?? {
                day_upper: 80,
                day_lower: 80,
                noon_upper: 80,
                noon_lower: 50,
                noon_charge_back_to: 53,
              }
            }
            onApply={triggerRefresh}
          />
        )}
        {active === 'power-guard' && (
          <PowerGuardPage status={pgStatus} onRefresh={refresh} />
        )}
      </main>
    </div>
  );
}