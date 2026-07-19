import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PowerGuardPanel } from '../src/components/PowerGuardPanel';
import * as apiModule from '../src/lib/api';

const sampleStatus = {
  installed: true,
  plist_present: true,
  watchdog_plist_present: true,
  caffeinate_pid: null,
  pmset: {
    sleep: '0',
    displaysleep: '0',
    powernap: '1',
    halfdim: '0',
    acwake: '1',
    proximitywake: '1',
    tcpkeepalive: '1',
  },
  drift_detected: false,
};

describe('PowerGuardPanel', () => {
  // RT-019: PowerGuardPanel Install/Uninstall/Reapply
  it('RT-019 shows installed status + pmset values', () => {
    render(<PowerGuardPanel status={sampleStatus} onRefresh={vi.fn()} />);
    expect(screen.getByText('installed')).toBeInTheDocument();
    expect(screen.getByText('in spec')).toBeInTheDocument();
    const pre = screen.getByTestId('pmset-values');
    expect(pre.textContent).toMatch(/sleep\s+=\s+0/);
    expect(pre.textContent).toMatch(/displaysleep\s+=\s+0/);
  });

  it('shows drift warning when drift_detected true', () => {
    render(
      <PowerGuardPanel
        status={{ ...sampleStatus, drift_detected: true }}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('drift')).toBeInTheDocument();
  });

  it('Install button calls powerGuardInstall', async () => {
    const spy = vi
      .spyOn(apiModule.api, 'powerGuardInstall')
      .mockResolvedValue('installed');
    render(<PowerGuardPanel status={sampleStatus} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pg-install'));
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
      expect(screen.getByTestId('pg-info').textContent).toMatch(/installed/);
    });
    spy.mockRestore();
  });

  it('Uninstall button calls powerGuardUninstall', async () => {
    const spy = vi
      .spyOn(apiModule.api, 'powerGuardUninstall')
      .mockResolvedValue('removed');
    render(<PowerGuardPanel status={sampleStatus} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pg-uninstall'));
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
    });
    spy.mockRestore();
  });

  it('Reapply button calls getPowerGuardReapply', async () => {
    const spy = vi
      .spyOn(apiModule.api, 'getPowerGuardReapply')
      .mockResolvedValue('reapplied');
    render(<PowerGuardPanel status={sampleStatus} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pg-reapply'));
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
    });
    spy.mockRestore();
  });
});