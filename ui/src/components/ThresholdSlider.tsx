interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  testId?: string;
}

// Generic horizontal slider for picking a battery % value.
// Emits onChange on each input. The numeric input is also visible
// alongside the slider so the value is precise and accessible.
export function ThresholdSlider({
  label,
  value,
  min = 1,
  max = 100,
  step = 1,
  onChange,
  testId = 'threshold-slider',
}: Props) {
  return (
    <div className="threshold-slider">
      <div className="threshold-slider-label">
        <span>{label}</span>
        <span className="threshold-slider-label-value" data-testid={`${testId}-value`}>
          {value}%
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        data-testid={testId}
      />
      <div className="threshold-slider-label">
        <span>{min}%</span>
        <span>{max}%</span>
      </div>
    </div>
  );
}