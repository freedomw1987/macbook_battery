interface Props {
  mode: string | null;
}

// Big pill showing current mode. day=green, noon=orange, else grey.
export function ModeBadge({ mode }: Props) {
  if (!mode || mode === 'none') {
    return <span className="mode-badge">idle</span>;
  }
  if (mode === 'day') {
    return <span className="mode-badge day">day mode</span>;
  }
  if (mode === 'noon') {
    return <span className="mode-badge noon">noon mode</span>;
  }
  return <span className="mode-badge">{mode}</span>;
}