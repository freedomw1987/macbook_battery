interface Props {
  active: 'dashboard' | 'schedule' | 'power-guard';
  onChange: (id: 'dashboard' | 'schedule' | 'power-guard') => void;
}

const ICONS: Record<Props['active'], JSX.Element> = {
  dashboard: (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  ),
  schedule: (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  ),
  'power-guard': (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 L4 6 V12 C4 17 7 21 12 22 C17 21 20 17 20 12 V6 Z" />
    </svg>
  ),
};

const LABELS: Record<Props['active'], string> = {
  dashboard: 'Dashboard',
  schedule: 'Schedule',
  'power-guard': 'Power-Guard',
};

export function Sidebar({ active, onChange }: Props) {
  const items: Props['active'][] = ['dashboard', 'schedule', 'power-guard'];
  return (
    <nav className="sidebar" data-testid="sidebar">
      <div className="sidebar-header">MacBook Power Tools</div>
      {items.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`sidebar-${id}`}
          className={`sidebar-item ${active === id ? 'active' : ''}`}
          onClick={() => onChange(id)}
        >
          {ICONS[id]}
          {LABELS[id]}
        </button>
      ))}
    </nav>
  );
}