import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThresholdSlider } from '../src/components/ThresholdSlider';

describe('ThresholdSlider', () => {
  it('RT-020 renders current value as %', () => {
    render(
      <ThresholdSlider label="Cap" value={75} onChange={() => {}} />,
    );
    expect(screen.getByTestId('threshold-slider-value').textContent).toBe('75%');
    expect(screen.getByText('Cap')).toBeInTheDocument();
  });

  it('calls onChange with numeric value when slider moves', () => {
    const onChange = vi.fn();
    render(<ThresholdSlider label="Cap" value={50} onChange={onChange} />);
    const slider = screen.getByTestId('threshold-slider');
    fireEvent.change(slider, { target: { value: '60' } });
    expect(onChange).toHaveBeenCalledWith(60);
  });

  it('honours min/max', () => {
    render(
      <ThresholdSlider label="Cap" value={50} min={20} max={90} onChange={() => {}} />,
    );
    const slider = screen.getByTestId('threshold-slider');
    expect(slider.getAttribute('min')).toBe('20');
    expect(slider.getAttribute('max')).toBe('90');
  });
});