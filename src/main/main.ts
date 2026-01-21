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
import { runTraceroute, extractHostnameFromUrl } from './TracerouteProvider.js';

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
        title: 'o|i CDN Demo',
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
function setupNetworkMonitoring(): void {
    // Track request start times for TTFB calculation
    const requestStartTimes = new Map<string, number>();

    // Capture request start time
    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['*://*/*'] },
        (details, callback) => {
            // Only track video-related requests
            if (isVideoRequest(details.url)) {
                requestStartTimes.set(details.resourceType + details.url, Date.now());
            }
            callback({});
        }
    );

    // Capture response headers and send to renderer
    session.defaultSession.webRequest.onHeadersReceived(
        { urls: ['*://*/*'] },
        (details, callback) => {
            // Only process video-related requests
            if (isVideoRequest(details.url)) {
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
            }

            callback({ responseHeaders: details.responseHeaders });
        }
    );

    console.log('[Electron] Network monitoring enabled - headers will be sent to renderer');
}

/**
 * Check if a URL is a video-related request (manifest or segment)
 */
function isVideoRequest(url: string): boolean {
    return url.includes('.m3u8') ||
        url.includes('.mpd') ||
        url.includes('.ts') ||
        url.includes('.m4s') ||
        url.includes('.m4v') ||
        url.includes('.mp4') ||
        url.includes('.cmfv') ||
        url.includes('.cmfa') ||
        url.includes('segment') ||
        url.includes('chunk');
}

/**
 * Sets up IPC handlers for renderer requests
 */
function setupIpcHandlers(): void {
    // Handle traceroute requests
    ipcMain.on('run-traceroute', async (event, host: string) => {
        console.log(`[Electron] Traceroute requested for: ${host}`);

        // Extract hostname if URL was passed
        const target = host.includes('://') ? extractHostnameFromUrl(host) : host;

        if (!target) {
            console.error('[Electron] Invalid traceroute target:', host);
            return;
        }

        try {
            const result = await runTraceroute(target, 20, 2);

            // Send result to renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('traceroute-result', result);
            }
        } catch (error: any) {
            console.error('[Electron] Traceroute failed:', error.message);
        }
    });

    console.log('[Electron] IPC handlers registered');
}

// App lifecycle events
app.whenReady().then(() => {
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
