/**
 * Electron Preload Script
 * 
 * This script runs in the renderer process but has access to Node.js APIs.
 * It uses contextBridge to safely expose Electron functionality to the webapp.
 * 
 * The webapp can access these APIs via `window.electronAPI`.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * API exposed to the renderer process
 */
const electronAPI = {
    /**
     * Check if we're running in Electron
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
     * Subscribe to traceroute results
     * @param callback - Function called with traceroute hops
     * @returns Cleanup function to unsubscribe
     */
    onTracerouteResult: (callback: (hops: Array<{
        hop: number;
        hostname: string;
        ip: string;
        rtt: number;
    }>) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
        ipcRenderer.on('traceroute-result', handler);
        return () => ipcRenderer.removeListener('traceroute-result', handler);
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
    }
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for the renderer
declare global {
    interface Window {
        electronAPI: typeof electronAPI;
    }
}

console.log('[Preload] Electron API exposed to renderer');
