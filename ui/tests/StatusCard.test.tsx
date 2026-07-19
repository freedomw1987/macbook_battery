import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusCard } from '../src/components/StatusCard';
import { Status } from '../src/lib/api';

describe('StatusCard', () => {
  beforeEach(() => {
    // No-op setup; tests render directly.
  });

  // RT-016: React StatusCard renders %
  it('RT-016 renders battery percentage', () => {
    const status: Status = {
      pct: 73,
      charging: true,
      ac_attached: true,
      mode: 'day',
      hold_loop_active: true,
      hold_loop_pid: 1234,
    };
    render(<StatusCard status={status} />);
    expect(screen.getByText('73%')).toBeInTheDocument();
    expect(screen.getByText('charging')).toBeInTheDocument();
    expect(screen.getByText('day')).toBeInTheDocument();
  });

  it('shows discharging pill when not charging', () => {
    const status: Status = {
      pct: 49,
      charging: false,
      ac_attached: true,
      mode: 'noon',
      hold_loop_active: true,
      hold_loop_pid: 5678,
    };
    render(<StatusCard status={status} />);
    expect(screen.getByText('discharging')).toBeInTheDocument();
    expect(screen.getByText('49%')).toBeInTheDocument();
  });

  it('shows loading when status is null', () => {
    render(<StatusCard status={null} />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it('shows error when error prop set', () => {
    render(<StatusCard status={null} error="IPC bridge down" />);
    expect(screen.getByText('IPC bridge down')).toBeInTheDocument();
  });
});