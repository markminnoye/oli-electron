/**
 * Electron Preload Script
 * 
 * This script runs in the renderer process but has access to Node.js APIs.
 * It uses contextBridge to safely expose Electron functionality to the webapp.
 * 
 * The webapp can access these APIs via `window.electronAPI`.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { createLogger } from './logger.js';

const preloadLog = createLogger('Preload');

// ── Traceroute listener sets ─────────────────────────────────────────────────
// Callbacks registered by the webapp via onTracerouteHop / onTracerouteResult.
// Populated from a MessagePort so hops travel directly from the utility process
// worker to here, with no main-process relay on the hot path.

type HopData = { hop: number; hostname: string | null; ip: string | null; rtt: number | null };
type HopCallback = (hop: HopData) => void;
type ResultCallback = (result: { target: string; hops: HopData[]; timestamp: number; complete: boolean }) => void;

const tracerouteHopListeners = new Set<HopCallback>();
const tracerouteResultListeners = new Set<ResultCallback>();

// Main process sends a new MessagePort each time a traceroute starts.
// The port is the direct channel from the utility process worker.
ipcRenderer.on('traceroute-port', (event) => {
    const port = event.ports[0];
    if (!port) return;
    port.start();
    port.onmessage = (e: MessageEvent) => {
        const { type, hop, result } = e.data ?? {};
        if (type === 'hop')    tracerouteHopListeners.forEach(fn => fn(hop));
        if (type === 'result') tracerouteResultListeners.forEach(fn => fn(result));
    };
});

// ── Exposed API ──────────────────────────────────────────────────────────────

/**
 * Securely exposed API via Electron Context Bridge.
 * Accessible in the renderer process via `window.electronAPI`.
 */
const electronAPI = {
    /**
     * Constant flag indicating the app is running within an Electron environment.
     * Used by the shared webapp to enable desktop-specific features.
     */
    isElectron: true,

    /**
     * Get the platform (darwin, win32, linux)
     */
    platform: process.platform,

    /**
     * Subscribe to HTTP headers captured by the main process
     * @param callback - Function called with header data
     * @returns Cleanup function to unsubscribe
     */
    onHttpHeaders: (callback: (data: {
        url: string;
        headers: Record<string, string[]>;
        statusCode: number;
    }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
        ipcRenderer.on('http-headers', handler);
        return () => ipcRenderer.removeListener('http-headers', handler);
    },

    /**
     * Subscribe to server IP resolution events
     * @param callback - Function called with server IP data
     * @returns Cleanup function to unsubscribe
     */
    onServerIpResolved: (callback: (data: {
        url: string;
        hostname: string | null;
        ip: string;
        fromCache: boolean;
        timestamp: number;
    }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
        ipcRenderer.on('server-ip-resolved', handler);
        return () => ipcRenderer.removeListener('server-ip-resolved', handler);
    },

    /**
     * Subscribe to individual traceroute hops (real-time streaming).
     * Hops arrive via a MessagePort transferred from the utility process worker,
     * bypassing the main process for lower latency.
     * @returns Cleanup function to unsubscribe
     */
    onTracerouteHop: (callback: (hop: {
        hop: number;
        hostname: string | null;
        ip: string | null;
        rtt: number | null;
    }) => void) => {
        tracerouteHopListeners.add(callback);
        return () => tracerouteHopListeners.delete(callback);
    },

    /**
     * Subscribe to traceroute completion (full result).
     * @returns Cleanup function to unsubscribe
     */
    onTracerouteResult: (callback: (result: {
        target: string;
        hops: Array<{
            hop: number;
            hostname: string | null;
            ip: string | null;
            rtt: number | null;
        }>;
        timestamp: number;
        complete: boolean;
    }) => void) => {
        tracerouteResultListeners.add(callback);
        return () => tracerouteResultListeners.delete(callback);
    },

    /**
     * Request a traceroute to a host
     * @param host - Hostname or IP to trace
     */
    runTraceroute: (host: string) => {
        ipcRenderer.send('run-traceroute', host);
    },

    /**
     * Get the public IP address
     * @returns Promise resolving to public IP
     */
    getPublicIP: (): Promise<string> => {
        return ipcRenderer.invoke('get-public-ip');
    },

    /**
     * Get system geolocation (if available)
     * @returns Promise resolving to coordinates
     */
    getGeolocation: (): Promise<{ lat: number; lon: number; accuracy: number } | null> => {
        return ipcRenderer.invoke('get-geolocation');
    },

    /**
     * Set custom headers to inject into video requests
     * @param headers - Object with header name -> value pairs
     */
    setCustomHeaders: (headers: Record<string, string>) => {
        ipcRenderer.send('set-custom-headers', headers);
    },

    /**
     * Clear all custom headers
     */
    clearCustomHeaders: () => {
        ipcRenderer.send('clear-custom-headers');
    },

    /**
     * Sends an IPC message to the main process to clear its internal hostname-to-IP detection cache.
     * Useful when switching streams or encountering stale network paths.
     */
    resetNetworkCache: () => {
        ipcRenderer.send('network:reset-cache');
    },

    // ── Auto-updater ──────────────────────────────────────────────────────────

    onUpdateChecking: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('update:checking', handler);
        return () => ipcRenderer.removeListener('update:checking', handler);
    },

    onUpdateAvailable: (callback: (info: { version: string }) => void) => {
        const handler = (_event: any, info: { version: string }) => callback(info);
        ipcRenderer.on('update:available', handler);
        return () => ipcRenderer.removeListener('update:available', handler);
    },

    onUpdateNotAvailable: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('update:not-available', handler);
        return () => ipcRenderer.removeListener('update:not-available', handler);
    },

    onUpdateProgress: (callback: (progress: { percent: number; bytesPerSecond: number }) => void) => {
        const handler = (_event: any, progress: { percent: number; bytesPerSecond: number }) => callback(progress);
        ipcRenderer.on('update:progress', handler);
        return () => ipcRenderer.removeListener('update:progress', handler);
    },

    onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
        const handler = (_event: any, info: { version: string }) => callback(info);
        ipcRenderer.on('update:downloaded', handler);
        return () => ipcRenderer.removeListener('update:downloaded', handler);
    },

    onUpdateError: (callback: (error: { message: string }) => void) => {
        const handler = (_event: any, error: { message: string }) => callback(error);
        ipcRenderer.on('update:error', handler);
        return () => ipcRenderer.removeListener('update:error', handler);
    },

    /**
     * Trigger installation of a downloaded update (quits and relaunches)
     */
    checkForUpdates: () => ipcRenderer.send('update:check'),
    simulateUpdate: () => ipcRenderer.send('update:simulate'),
    installUpdate: () => {
        ipcRenderer.send('update:install');
    },

    /**
     * Relay a renderer-side log entry to the main process for file persistence.
     * Only warn/error levels are relayed to avoid excessive log volume.
     */
    log: (entry: { level: 'warn' | 'error'; namespace: string; args: unknown[] }) => {
        try {
            ipcRenderer.send('log:relay', entry);
        } catch {
            // Silently ignore — e.g. if args contain non-cloneable values
        }
    },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

preloadLog.info('Electron API exposed to renderer');
