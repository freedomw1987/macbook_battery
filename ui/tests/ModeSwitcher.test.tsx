import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModeSwitcher } from '../src/components/ModeSwitcher';

// Component imports invoke via Tauri; we rely on the tests/setup.ts
// shim but for these component tests we mock setMode via the api
// module directly.
import * as apiModule from '../src/lib/api';

describe('ModeSwitcher', () => {
  // RT-017: ModeSwitcher buttons trigger IPC
  it('RT-017 day button calls api.setMode("day")', async () => {
    const spy = vi.spyOn(apiModule.api, 'setMode').mockResolvedValue('ok');
    const onChange = vi.fn();
    render(<ModeSwitcher currentMode="day" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('btn-day'));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('day');
      expect(onChange).toHaveBeenCalled();
    });
    spy.mockRestore();
  });

  it('noon button calls setMode("noon")', async () => {
    const spy = vi.spyOn(apiModule.api, 'setMode').mockResolvedValue('ok');
    const onChange = vi.fn();
    render(<ModeSwitcher currentMode="noon" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('btn-noon'));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('noon');
    });
    spy.mockRestore();
  });

  it('reset button calls setMode("reset")', async () => {
    const spy = vi.spyOn(apiModule.api, 'setMode').mockResolvedValue('ok');
    render(<ModeSwitcher currentMode="day" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('btn-reset'));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('reset');
    });
    spy.mockRestore();
  });

  it('shows error when setMode rejects', async () => {
    const spy = vi
      .spyOn(apiModule.api, 'setMode')
      .mockRejectedValue(new Error('boom'));
    render(<ModeSwitcher currentMode="day" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('btn-day'));
    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
    spy.mockRestore();
  });
});