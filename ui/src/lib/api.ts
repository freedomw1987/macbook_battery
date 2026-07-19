// Thin wrappers around Tauri invoke() — keeps every component from
// having to know the exact command names.

import { invoke } from '@tauri-apps/api/core';

export interface Status {
  pct: number | null;
  charging: boolean;
  ac_attached: boolean;
  mode: 'day' | 'noon' | 'none' | string;
  hold_loop_active: boolean;
  hold_loop_pid: number | null;
}

export interface ScheduleEntry {
  time: string;
  mode: 'day' | 'noon';
}

export interface PmsetSettings {
  sleep: string | null;
  displaysleep: string | null;
  powernap: string | null;
  halfdim: string | null;
  acwake: string | null;
  proximitywake: string | null;
  tcpkeepalive: string | null;
}

export interface PowerGuardStatus {
  installed: boolean;
  plist_present: boolean;
  watchdog_plist_present: boolean;
  caffeinate_pid: number | null;
  pmset: PmsetSettings;
  drift_detected: boolean;
}

export interface Thresholds {
  day_upper: number;
  day_lower: number;
  noon_upper: number;
  noon_lower: number;
  noon_charge_back_to: number;
}

export const api = {
  getStatus: () => invoke<Status>('get_status'),
  setMode: (mode: 'day' | 'noon' | 'reset') =>
    invoke<string>('set_mode', { mode }),
  getSchedule: () => invoke<ScheduleEntry[]>('get_schedule'),
  setSchedule: (entries: ScheduleEntry[]) =>
    invoke<string>('set_schedule', { entries }),
  getThresholds: () => invoke<Thresholds>('get_thresholds'),
  setThresholds: (t: Thresholds) => invoke<string>('set_thresholds', { t }),
  getPowerGuardStatus: () => invoke<PowerGuardStatus>('get_power_guard_status'),
  getPowerGuardReapply: () =>
    invoke<string>('get_power_guard_reapply'),
  powerGuardInstall: () =>
    invoke<string>('power_guard_install'),
  powerGuardUninstall: () =>
    invoke<string>('power_guard_uninstall'),
};

// Mock for unit tests — set in tests/setup.ts
export const __setMockInvoke = (mock: typeof invoke | null) => {
  if (mock) {
    (globalThis as any).__TAURI_INVOKE__ = mock;
  }
};