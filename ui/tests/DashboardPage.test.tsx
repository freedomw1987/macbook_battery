import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DashboardPage } from '../src/components/DashboardPage';
import { Status } from '../src/lib/api';
import * as apiModule from '../src/lib/api';

describe('DashboardPage', () => {
  it('RT-022 renders battery % and mode', () => {
    const status: Status = {
      pct: 60,
      charging: true,
      ac_attached: true,
      mode: 'day',
      hold_loop_active: true,
      hold_loop_pid: 1234,
    };
    render(<DashboardPage status={status} error={null} onApply={vi.fn()} />);
    expect(screen.getByTestId('status-pct').textContent).toBe('60%');
    expect(screen.getByText('day mode')).toBeInTheDocument();
    expect(screen.getByText('charging')).toBeInTheDocument();
  });

  it('shows "?" when status null', () => {
    render(<DashboardPage status={null} error={null} onApply={vi.fn()} />);
    expect(screen.getByTestId('status-pct').textContent).toBe('?%');
  });

  it('shows error banner when error prop set', () => {
    render(
      <DashboardPage status={null} error="bridge down" onApply={vi.fn()} />,
    );
    expect(screen.getByText('bridge down')).toBeInTheDocument();
  });

  it('day button calls setMode("day")', async () => {
    const spy = vi.spyOn(apiModule.api, 'setMode').mockResolvedValue('ok');
    const onApply = vi.fn();
    render(
      <DashboardPage
        status={{
          pct: 50,
          charging: true,
          ac_attached: true,
          mode: 'noon',
          hold_loop_active: true,
          hold_loop_pid: 1,
        }}
        error={null}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByTestId('btn-day'));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('day');
      expect(onApply).toHaveBeenCalled();
    });
  });
});