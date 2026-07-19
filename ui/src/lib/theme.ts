// Theme detection — mirrors macOS system appearance by default.
// Users can override with `data-theme="dark"` or `data-theme="light"`
// on <html> (set programmatically via Settings in a future iteration).

export type Theme = 'auto' | 'light' | 'dark';

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

// React-side hook that listens to OS changes when in 'auto' mode.
export function subscribeSystemTheme(callback: (isDark: boolean) => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => callback(mq.matches);
  handler();
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}