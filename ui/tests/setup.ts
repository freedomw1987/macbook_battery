// Test setup — register a tauri-invoke shim so components can
// render without the real Tauri runtime.
import '@testing-library/jest-dom/vitest';

// Map command name -> handler so individual tests can override.
type Handler = (...args: any[]) => any;
const handlers = new Map<string, Handler>();

export function __setHandler(cmd: string, handler: Handler) {
  handlers.set(cmd, handler);
}

export function __resetHandlers() {
  handlers.clear();
}

// Stub @tauri-apps/api/core invoke.
import { vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: any) => {
    const h = handlers.get(cmd);
    if (!h) throw new Error(`No test handler registered for ${cmd}`);
    return h(args);
  }),
}));