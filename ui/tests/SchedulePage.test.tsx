import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SchedulePage } from '../src/components/SchedulePage';
import { Thresholds } from '../src/lib/api';

// Mock the api module so SchedulePage can import it without Tauri runtime.
import * as apiModule from '../src/lib/api';

const baseThresholds: Thresholds = {
  day_upper: 80,
  day_lower: 80,
  noon_upper: 80,
  noon_lower: 50,
  noon_charge_back_to: 53,
};

describe('SchedulePage', () => {
  beforeEach(() => {
    vi.spyOn(apiModule.api, 'getSchedule').mockResolvedValue([
      { time: '06:30', mode: 'day' },
      { time: '12:00', mode: 'noon' },
    ]);
    vi.spyOn(apiModule.api, 'setSchedule').mockResolvedValue('ok');
    vi.spyOn(apiModule.api, 'setThresholds').mockResolvedValue('ok');
  });

  it('RT-021 renders day/noon threshold sliders', async () => {
    render(<SchedulePage thresholds={baseThresholds} onApply={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('slider-day-upper')).toBeInTheDocument();
      expect(screen.getByTestId('slider-noon-upper')).toBeInTheDocument();
      expect(screen.getByTestId('slider-noon-lower')).toBeInTheDocument();
    });
    expect(screen.getByTestId('slider-day-upper-value').textContent).toBe('80%');
    expect(screen.getByTestId('slider-noon-lower-value').textContent).toBe('50%');
  });

  it('day-upper slider change updates value (clamped)', async () => {
    render(<SchedulePage thresholds={baseThresholds} onApply={vi.fn()} />);
    await waitFor(() => screen.getByTestId('slider-day-upper'));
    const slider = screen.getByTestId('slider-day-upper');
    fireEvent.change(slider, { target: { value: '90' } });
    expect(screen.getByTestId('slider-day-upper-value').textContent).toBe('90%');
  });

  it('noon-lower slider clamps when set above upper', async () => {
    render(
      <SchedulePage
        thresholds={{ ...baseThresholds, noon_upper: 70 }}
        onApply={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByTestId('slider-noon-lower'));
    const slider = screen.getByTestId('slider-noon-lower');
    fireEvent.change(slider, { target: { value: '80' } }); // > upper=70
    // Should clamp to upper - 1 = 69
    expect(screen.getByTestId('slider-noon-lower-value').textContent).toBe('69%');
  });

  it('Save button calls setThresholds then setSchedule', async () => {
    render(<SchedulePage thresholds={baseThresholds} onApply={vi.fn()} />);
    await waitFor(() => screen.getByTestId('save-schedule'));
    const saveSpy = vi.spyOn(apiModule.api, 'setSchedule');
    const threshSpy = vi.spyOn(apiModule.api, 'setThresholds');
    fireEvent.click(screen.getByTestId('save-schedule'));
    await waitFor(() => {
      expect(threshSpy).toHaveBeenCalled();
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  it('shows error message when setThresholds rejects', async () => {
    vi.spyOn(apiModule.api, 'setThresholds').mockRejectedValueOnce(
      new Error('bad bounds'),
    );
    render(<SchedulePage thresholds={baseThresholds} onApply={vi.fn()} />);
    await waitFor(() => screen.getByTestId('save-schedule'));
    fireEvent.click(screen.getByTestId('save-schedule'));
    await waitFor(() => {
      expect(screen.getByText(/bad bounds/)).toBeInTheDocument();
    });
  });
});