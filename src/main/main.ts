/**
 * Electron Main Process
 * 
 * This is the entry point for the Electron app. It creates the main window
 * and loads the webapp (either from Vite dev server or built files).
 * 
 * Key features:
 * - Disables web security to bypass CORS restrictions
 * - Uses preload script for secure IPC communication
 * - Handles both development (Vite) and production modes
 */

// Suppress security warnings in development (we intentionally disable webSecurity for CORS bypass)
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

import { app, BrowserWindow, session, ipcMain } from 'electron';
import path from 'path';
import { readFileSync } from 'fs';
import { runTracerouteStreaming, extractHostnameFromUrl } from './TracerouteProvider.js';

// Read version from package.json
let appVersion = '';
try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    appVersion = pkg.version;
} catch (e) {
    console.error('[Electron] Failed to read app version:', e);
}

// __dirname is available in CommonJS (our tsconfig uses module: CommonJS)

/** Whether we're running in development mode */
const isDev = !app.isPackaged;

/** The dev server URL (Vite default) */
const DEV_SERVER_URL = 'http://localhost:5173';

/** Reference to the main window */
let mainWindow: BrowserWindow | null = null;

/**
 * Creates the main application window
 */
function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        minWidth: 1280,
        minHeight: 720,
        title: `o|i CDN Demo ${appVersion ? `(version ${appVersion})` : ''}`,
        webPreferences: {
            // Disable web security to bypass CORS restrictions
            // This is the main reason we're using Electron!
            webSecurity: false,

            // Use preload script for secure IPC
            preload: path.join(__dirname, 'preload.cjs'),

            // Enable Node.js integration in preload only (via contextBridge)
            nodeIntegration: false,
            contextIsolation: true,

            // Enable sandbox for security (preload still works)
            sandbox: false
        }
    });

    // Load the webapp
    if (isDev) {
        // Development: load from Vite dev server
        console.log('[Electron] Loading from Vite dev server:', DEV_SERVER_URL);
        mainWindow.loadURL(DEV_SERVER_URL);

        // Open DevTools in development
        mainWindow.webContents.openDevTools();

        // Clear session storage just once to fix "ignored permission" issues
        // This is a brute-force fix for the "permission blocked" error
        session.defaultSession.clearStorageData({ storages: ['localstorage', 'cookies', 'indexdb'] });
        console.log('[Electron] Cleared session storage to reset permissions');
    } else {
        // Production: load from built files
        const indexPath = path.join(__dirname, '../../app/app/dist/index.html');
        console.log('[Electron] Loading from built files:', indexPath);
        mainWindow.loadFile(indexPath);
    }

    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Log when page loads
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('[Electron] Page loaded successfully');
    });

    // Log navigation errors
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        console.error('[Electron] Failed to load:', errorCode, errorDescription);
    });
}

/**
 * Sets up HTTP header interception for network monitoring
 * This captures ALL headers (no CORS restrictions!)
 * Headers are sent to the renderer process via IPC for DeepPacketAnalyser
 */

// Store custom headers to inject into requests (set by renderer via IPC)
let customRequestHeaders: Record<string, string> = {};

function setupNetworkMonitoring(): void {
    // Track request start times for TTFB calculation
    const requestStartTimes = new Map<string, number>();

    // Capture request start time
    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['*://*/*'] },
        (details, callback) => {
            // Only track video-related requests
            if (isVideoRequest(details.url, details.resourceType)) {
                requestStartTimes.set(details.resourceType + details.url, Date.now());
            }
            callback({});
        }
    );

    // Inject custom headers into video requests
    session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ['*://*/*'] },
        (details, callback) => {
            let requestHeaders = { ...details.requestHeaders };

            // Bypass local cache for video requests
            if (isVideoRequest(details.url, details.resourceType)) {
                requestHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                requestHeaders['Pragma'] = 'no-cache';
                requestHeaders['Expires'] = '0';

                // Also inject custom headers if any are set
                if (Object.keys(customRequestHeaders).length > 0 && !details.url.includes('.dcsm')) {
                    for (const [key, value] of Object.entries(customRequestHeaders)) {
                        requestHeaders[key] = value;
                    }
                    if (isDev && details.url.includes('.m3u8')) {
                        console.log(`[Network] Injected headers for ${details.url.substring(0, 60)}...`);
                    }
                }
            }

            callback({ requestHeaders });
        }
    );

    // Capture response headers and send to renderer
    session.defaultSession.webRequest.onHeadersReceived(
        { urls: ['*://*/*'] },
        (details, callback) => {
            // Only process video-related requests
            if (isVideoRequest(details.url, details.resourceType)) {
                const requestKey = details.resourceType + details.url;
                const startTime = requestStartTimes.get(requestKey);
                const ttfb = startTime ? Date.now() - startTime : 0;

                // Clean up the start time
                requestStartTimes.delete(requestKey);

                // Flatten headers from Record<string, string[]> to Record<string, string>
                const flatHeaders: Record<string, string> = {};
                if (details.responseHeaders) {
                    for (const [key, values] of Object.entries(details.responseHeaders)) {
                        flatHeaders[key.toLowerCase()] = Array.isArray(values) ? values[0] : values;
                    }
                }

                // Send to renderer via IPC
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('http-headers', {
                        url: details.url,
                        headers: flatHeaders,
                        statusCode: details.statusCode,
                        ttfb: ttfb,
                        timestamp: Date.now(),
                        method: details.method,
                        resourceType: details.resourceType
                    });
                }

                // Debug log for development
                if (isDev) {
                    const cdn = flatHeaders['x-cdn'] || flatHeaders['server'] || 'unknown';
                    console.log(`[Network] ${details.method} ${details.url.substring(0, 80)}... (CDN: ${cdn}, TTFB: ${ttfb}ms)`);
                }

                // Prevent local caching of video assets by overriding response headers
                if (details.responseHeaders) {
                    details.responseHeaders['Cache-Control'] = ['no-cache, no-store, must-revalidate'];
                    details.responseHeaders['Pragma'] = ['no-cache'];
                    details.responseHeaders['Expires'] = ['0'];
                }
            }

            callback({ responseHeaders: details.responseHeaders });
        }
    );

    // Capture server IP from completed requests
    // onCompleted has access to the remote IP address
    session.defaultSession.webRequest.onCompleted(
        { urls: ['*://*/*'] },
        (details) => {
            // Cast to include ip property (exists at runtime but not in types)
            const detailsWithIp = details as typeof details & { ip?: string };

            // Only process video-related requests (manifests especially)
            if (isVideoRequest(details.url, details.resourceType) && detailsWithIp.ip) {
                const ip = detailsWithIp.ip;

                // Only send once per IP to avoid renderer resets
                if (detectedIps.has(ip)) return;
                detectedIps.add(ip);

                // Extract hostname from URL
                let hostname: string | null = null;
                try {
                    hostname = new URL(details.url).hostname;
                } catch { /* ignore */ }

                // Send server IP to renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('server-ip-resolved', {
                        url: details.url,
                        hostname: hostname,
                        ip: ip,
                        fromCache: details.fromCache,
                        timestamp: Date.now()
                    });
                }

                // Debug log for manifests in development
                const isManifest = details.url.includes('.m3u8') || details.url.includes('.mpd');
                if (isDev && isManifest) {
                    console.log(`[Network] Server IP: ${ip} for ${hostname}`);
                }
            }
        }
    );

    console.log('[Electron] Network monitoring enabled - headers will be sent to renderer');
}

/**
 * Track resolved IPs to avoid spamming the renderer with the same event
 * This is module-scoped so it can be cleared via IPC
 */
const detectedIps = new Set<string>();

/**
 * Check if a URL is a video-related request (manifest or segment)
 * Excludes localhost requests to avoid metrics noise from dev server
 */
function isVideoRequest(url: string, resourceType?: string): boolean {
    // Exclude localhost/127.0.0.1 requests (dev server, Vite, etc.)
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
        return false;
    }

    // Exclude the Vercel app domain itself and analytics
    // if (url.includes('vercel.app') || url.includes('vercel-insights')) {
    //     return false;
    // }

    // Check for video manifest or segment patterns
    const isVideoPattern =
        url.includes('.m3u8') ||
        url.includes('.mpd') ||
        url.includes('.ts') ||
        url.includes('.m4s') ||
        url.includes('.m4v') ||
        url.includes('.mp4') ||
        url.includes('.cmfv') ||
        url.includes('.cmfa');

    if (!isVideoPattern) return false;

    // For server-ip-resolved events (traceroute triggers), we only want to 
    // trigger for manifests or media segments, not for every script/asset 
    // that might match "segment" or "chunk" in its name.
    if (resourceType) {
        // Only allow XHR/Fetch/Media/Other (for stream types)
        const allowedTypes = ['xhr', 'fetch', 'media', 'other'];
        if (!allowedTypes.includes(resourceType)) return false;
    }

    return true;
}

/**
 * Sets up IPC handlers for renderer requests
 */
function setupIpcHandlers(): void {
    // Handle traceroute requests - now uses streaming for real-time hop updates
    ipcMain.on('run-traceroute', (event, host: string) => {
        console.log(`[Electron] Traceroute requested for: ${host}`);

        // Extract hostname if URL was passed
        const target = host.includes('://') ? extractHostnameFromUrl(host) : host;

        if (!target) {
            console.error('[Electron] Invalid traceroute target:', host);
            return;
        }

        // Use streaming traceroute for real-time hop updates
        runTracerouteStreaming(
            target,
            // onHop: Send each hop as it's discovered
            (hop) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('traceroute-hop', hop);
                }
            },
            // onComplete: Send final result
            (result) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('traceroute-result', result);
                }
            },
            20, // maxHops
            2   // timeout per hop
        );
    });

    // Handle custom header injection requests
    // This allows the renderer to specify headers to inject into video requests
    ipcMain.on('set-custom-headers', (event, headers: Record<string, string>) => {
        customRequestHeaders = headers || {};
        console.log('[Electron] Custom headers updated:', Object.keys(customRequestHeaders));
    });

    // Handle clear custom headers
    ipcMain.on('clear-custom-headers', () => {
        customRequestHeaders = {};
        console.log('[Electron] Custom headers cleared');
    });

    // Handle network cache reset
    ipcMain.on('network:reset-cache', () => {
        detectedIps.clear();
        console.log('[Electron] Network IP cache cleared');
    });

    // Return public IP via ipify
    ipcMain.handle('get-public-ip', async () => {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json() as { ip: string };
            return data.ip;
        } catch (error) {
            console.error('[Electron] Failed to get public IP:', error);
            return null;
        }
    });

    // Geolocation is handled by the renderer's GeoLocationService via navigator.geolocation
    // (granted by setupPermissions). Return null to signal the renderer to use its own flow.
    ipcMain.handle('get-geolocation', async () => {
        return null;
    });

    console.log('[Electron] IPC handlers registered');
}

// App lifecycle events
app.whenReady().then(() => {
    setupPermissions();
    setupNetworkMonitoring();
    setupIpcHandlers();
    createWindow();

    // macOS: re-create window when dock icon is clicked
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

/**
 * Setup permission handlers for web APIs
 * This enables HTML5 Geolocation API (navigator.geolocation) in the renderer process
 */
function setupPermissions(): void {
    // Handle permission requests from the renderer process
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = [
            'geolocation',  // Enable navigator.geolocation
            'media',        // Enable camera/mic if needed
        ];

        if (allowedPermissions.includes(permission)) {
            console.log(`[Electron] Granting permission: ${permission}`);
            callback(true);
        } else {
            console.log(`[Electron] Denying permission: ${permission}`);
            callback(false);
        }
    });

    // Also handle permission checks (for APIs that check before requesting)
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        const allowedPermissions = ['geolocation', 'media'];
        return allowedPermissions.includes(permission);
    });

    console.log('[Electron] Permission handlers configured (geolocation enabled)');
}

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Security: prevent new window creation
app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });
});
