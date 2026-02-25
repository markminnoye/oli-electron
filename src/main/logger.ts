// debug is a runtime dependency (bundled by electron-builder, ~7KB).
// In production the instances stay disabled so the overhead is negligible.
import debug from 'debug';
import { app } from 'electron';

/**
 * ANSI 256-color palette for Electron main-process namespaces.
 * All dark greens — visually distinct from the webapp's palette in DevTools/terminal.
 *
 * Preview: https://robotmoon.com/256-colors/
 *   22 = very dark green   #005f00
 *   28 = dark green        #008700
 *   34 = medium green      #00af00
 */
const NAMESPACE_COLORS: Record<string, number> = {
    'Electron': 28, // dark green
    'Network':  34, // medium green
    'Preload':  22, // very dark green
};

/**
 * Creates a namespaced logger for main-process modules.
 * Mirrors the API of app/app/src/utils/logger.ts for the Node.js side.
 *
 * - log()   gated by the `debug` package — controlled via DEBUG=oli:* env var.
 *           Enabled automatically in dev (app.isPackaged = false).
 * - info()  always on — lifecycle/startup events worth seeing in any environment.
 * - warn()  always fires
 * - error() always fires
 *
 * Terminal — silence or filter namespaces:
 *   DEBUG=oli:*            → all on
 *   DEBUG=oli:Electron     → only Electron namespace
 *   DEBUG=oli:*,-oli:Network → all except Network
 *   DEBUG=                 → all off
 */
export function createLogger(namespace: string) {
    const d = debug(`oli:${namespace}`);

    // Apply dark green ANSI 256-color; falls back to debug's auto-assign if unknown
    (d as any).color = NAMESPACE_COLORS[namespace] ?? 28;

    return {
        log:   (...args: unknown[]) => d(args.map(String).join(' ')),
        info:  (...args: unknown[]) => console.log(`[${namespace}]`, ...args),
        warn:  (...args: unknown[]) => console.warn(`[${namespace}]`, ...args),
        error: (...args: unknown[]) => console.error(`[${namespace}]`, ...args),
    };
}

// Default: enable all oli:* logs in dev, same pattern as the webapp's localStorage.debug = 'oli:*'
if (!app.isPackaged && !process.env.DEBUG) {
    debug.enable('oli:*');
}
