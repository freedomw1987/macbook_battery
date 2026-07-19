// RT-009~015: IPC contract — verify the api.ts module exposes the
// expected invoke names. These are static checks (not running the
// Rust backend) because in CI we don't have the Tauri runtime.

import { describe, it, expect } from 'vitest';
import * as apiModule from '../src/lib/api';

describe('api module — IPC contract', () => {
  it('RT-009 exposes get_status', () => {
    expect(typeof apiModule.api.getStatus).toBe('function');
  });
  it('RT-010 exposes set_mode', () => {
    expect(typeof apiModule.api.setMode).toBe('function');
  });
  it('RT-011 exposes get_schedule', () => {
    expect(typeof apiModule.api.getSchedule).toBe('function');
  });
  it('RT-012 exposes set_schedule', () => {
    expect(typeof apiModule.api.setSchedule).toBe('function');
  });
  it('RT-013 exposes get_power_guard_status', () => {
    expect(typeof apiModule.api.getPowerGuardStatus).toBe('function');
  });
  it('RT-014 exposes power_guard_install / power_guard_uninstall', () => {
    expect(typeof apiModule.api.powerGuardInstall).toBe('function');
    expect(typeof apiModule.api.powerGuardUninstall).toBe('function');
  });
  it('RT-015 exposes get_power_guard_reapply', () => {
    expect(typeof apiModule.api.getPowerGuardReapply).toBe('function');
  });
});