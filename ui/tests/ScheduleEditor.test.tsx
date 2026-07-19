import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScheduleEditor } from '../src/components/ScheduleEditor';
import * as apiModule from '../src/lib/api';

describe('ScheduleEditor', () => {
  // RT-018: ScheduleEditor 5 rows + Save
  it('RT-018 renders 5 default rows and Save button', async () => {
    vi.spyOn(apiModule.api, 'getSchedule').mockResolvedValue([
      { time: '06:30', mode: 'day' },
      { time: '09:00', mode: 'day' },
      { time: '12:00', mode: 'noon' },
      { time: '15:00', mode: 'day' },
      { time: '18:00', mode: 'noon' },
    ]);
    render(<ScheduleEditor onChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('save-schedule')).toBeInTheDocument();
    });
    // 5 time inputs
    const timeInputs = screen.getAllByTestId(/^time-/);
    expect(timeInputs).toHaveLength(5);
    expect((timeInputs[0] as HTMLInputElement).value).toBe('06:30');
    expect((timeInputs[4] as HTMLInputElement).value).toBe('18:00');
  });

  it('Save button calls api.setSchedule with current entries', async () => {
    vi.spyOn(apiModule.api, 'getSchedule').mockResolvedValue([
      { time: '06:30', mode: 'day' },
      { time: '09:00', mode: 'day' },
      { time: '12:00', mode: 'noon' },
      { time: '15:00', mode: 'day' },
      { time: '18:00', mode: 'noon' },
    ]);
    const setSpy = vi
      .spyOn(apiModule.api, 'setSchedule')
      .mockResolvedValue('ok');
    const onChange = vi.fn();
    render(<ScheduleEditor onChange={onChange} />);
    await waitFor(() =>
      expect(screen.getByTestId('save-schedule')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('save-schedule'));
    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith([
        { time: '06:30', mode: 'day' },
        { time: '09:00', mode: 'day' },
        { time: '12:00', mode: 'noon' },
        { time: '15:00', mode: 'day' },
        { time: '18:00', mode: 'noon' },
      ]);
      expect(onChange).toHaveBeenCalled();
    });
  });

  it('+ Add row appends a new entry', async () => {
    vi.spyOn(apiModule.api, 'getSchedule').mockResolvedValue([
      { time: '06:30', mode: 'day' },
    ]);
    render(<ScheduleEditor onChange={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('+ Add row')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('+ Add row'));
    const rows = screen.getAllByTestId(/^time-/);
    expect(rows).toHaveLength(2);
  });
});