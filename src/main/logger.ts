import debug from 'debug';
import { app } from 'electron';
import electronLog from 'electron-log';
import * as path from 'path';

// Configure electron-log

if (!app?.isPackaged && electronLog.transports.file) {
    // In dev, log to local logs directory for easier access
    electronLog.transports.file.resolvePathFn = () => path.join(process.cwd(), 'logs/main.log');
}

// Log formatting for file/console (guards needed: preload context has no file transport)
if (electronLog.transports.console) {
    electronLog.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';
}
if (electronLog.transports.file) {
    electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
}

/**
 * Creates a namespaced logger for main-process modules.
 * This logger provides unified output to both the console (for development) 
 * and persistent log files (for standalone/production debugging).
 * 
 * It uses 'debug' for namespaced console output and 'electron-log' 
 * for file-based persistence.
 * 
 * @param namespace The module name or category (e.g., 'main', 'traceroute')
 * @returns An object with log, info, warn, and error methods
 */
export function createLogger(namespace: string) {
    const d = debug(`oli:${namespace}`);
    
    // Default enable in dev for easier developer visibility
    if ((!app || !app.isPackaged) && !process.env.DEBUG) {
        debug.enable('oli:*');
    }

    return {
        /**
         * Low-level debug log. Only visible when DEBUG env var is set 
         * or when in development mode.
         */
        log:   (...args: unknown[]) => {
            const msg = args.map(String).join(' ');
            d(msg);
            electronLog.debug(`[${namespace}] ${msg}`);
        },
        /**
         * Standard informational log. Visible in console and saved to file.
         */
        info:  (...args: unknown[]) => {
            console.log(`[${namespace}]`, ...args);
            electronLog.info(`[${namespace}]`, ...args);
        },
        /**
         * Warning log for non-critical issues that should be investigated.
         */
        warn:  (...args: unknown[]) => {
            console.warn(`[${namespace}]`, ...args);
            electronLog.warn(`[${namespace}]`, ...args);
        },
        /**
         * Error log for critical failures. Includes stack traces if available.
         */
        error: (...args: unknown[]) => {
            console.error(`[${namespace}]`, ...args);
            electronLog.error(`[${namespace}]`, ...args);
        },
    };
}
