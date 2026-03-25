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

import { app, BrowserWindow, session, ipcMain, MessageChannelMain, utilityProcess, shell, Menu, dialog } from 'electron';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { extractHostnameFromUrl } from './TracerouteProvider.js';
import electronLog from 'electron-log/main';
import { createLogger } from './logger.js';
import { setupAutoUpdater, installUpdate, checkForUpdates, simulateUpdate } from './AutoUpdater.js';

// Catch any unhandled errors before createLogger() is called.
// electron-log writes to the OS log directory without explicit init.
process.on('uncaughtException', (err) => {
    electronLog.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
    electronLog.error('[unhandledRejection]', reason);
});

// Delay logger initialization until app is essentially ready
let logger: ReturnType<typeof createLogger>;

/**
 * Robustly find the package.json file across dev and production environments.
 * 
 * Electron apps can be started from different paths (e.g., via 'electron-builder', 
 * 'npm run dev', or a standalone DMG/App bundle). This function searches 
 * common locations for package.json to resolve the app version without throwing 
 * ENOENT errors that could crash the splash screen.
 * 
 * @returns An object containing the app version string
 */
function findPackageJson(): { version: string } {
    const searchPaths = [
        path.join(app.getAppPath(), 'package.json'),
        path.join(process.cwd(), 'package.json'),
        path.join(__dirname, '..', '..', 'package.json'),
        path.join(__dirname, '..', 'package.json'),
    ];

    for (const p of searchPaths) {
        try {
            if (existsSync(p)) {
                return JSON.parse(readFileSync(p, 'utf8'));
            }
        } catch (e) {
            // Continue searching
        }
    }

    // logger.warn('Could not find package.json via standard search paths. Using fallback version.');
    return { version: '0.0.0-unknown' };
}
// App version will be resolved in app.whenReady
let appVersion = '';

// __dirname is available in CommonJS (our tsconfig uses module: CommonJS)

/** Whether we're running in development mode (controls DevTools + load source, NOT logging — see logger.ts) */
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
        width: 1800,
        height: 1200,
        minWidth: 1280,
        minHeight: 720,
        title: `oi-Lab ${appVersion ? `(version ${appVersion})` : ''}`,
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
        logger.info('Loading from Vite dev server:', DEV_SERVER_URL);
        mainWindow.loadURL(DEV_SERVER_URL);

        // Open DevTools in development
        mainWindow.webContents.openDevTools();

        // Clear session storage just once to fix "ignored permission" issues
        // This is a brute-force fix for the "permission blocked" error
        session.defaultSession.clearStorageData({ storages: ['localstorage', 'cookies', 'indexdb'] });
        logger.info('Cleared session storage to reset permissions');
    } else {
        // Production: load from built files
        const indexPath = path.join(app.getAppPath(), 'app/app/dist/index.html');
        logger.info('Loading from built files:', indexPath);
        mainWindow.loadFile(indexPath);
    }

    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Log when page loads
    mainWindow.webContents.on('did-finish-load', () => {
        logger.info('Page loaded successfully');
    });

    // Log navigation errors
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        logger.error('Failed to load:', errorCode, errorDescription);
    });

    // Open external http(s) links in the system browser
    // (e.g. target="_blank" links like Sonic Rocket footer & CDN Calculator toolbox)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });
}

/**
 * Sets up HTTP header interception for network monitoring.
 * 
 * This is a core feature of the Electron wrapper. By using Electron's 
 * session.webRequest API, we can bypass browser CORS restrictions and 
 * capture ALL HTTP headers from video segment requests. 
 * 
 * Flow:
 * 1. Intercept request start for TTFB calculation.
 * 2. Inject custom headers (provided by renderer) into outgoing requests.
 * 3. Intercept response headers, flatten them, and send to renderer via IPC.
 * 4. Resolve the server IP from completed requests for topology mapping.
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
                    if (details.url.includes('.m3u8')) {
                        logger.log(`Injected headers for ${details.url.substring(0, 60)}...`);
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

                // Debug log
                const cdn = flatHeaders['x-cdn'] || flatHeaders['server'] || 'unknown';
                logger.log(`${details.method} ${details.url.substring(0, 80)}... (CDN: ${cdn}, TTFB: ${ttfb}ms)`);

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

                // Debug log for manifests
                const isManifest = details.url.includes('.m3u8') || details.url.includes('.mpd');
                if (isManifest) {
                    logger.log(`Server IP: ${ip} for ${hostname}`);
                }
            }
        }
    );

    logger.info('Network monitoring enabled - headers will be sent to renderer');
}

/**
 * Track resolved IPs to avoid spamming the renderer with the same event
 * This is module-scoped so it can be cleared via IPC
 */
const detectedIps = new Set<string>();

/**
 * Determines if a request should be monitored based on its URL and type.
 * 
 * Filters out localhost noise (Vite/dev server) and focuses on HLS/DASH 
 * patterns (.m3u8, .mpd, .ts, etc.). This ensures the DeepPacketAnalyser 
 * only receives relevant video traffic.
 * 
 * @param url Request URL
 * @param resourceType Electron resource type (e.g., 'xhr', 'fetch')
 * @returns true if the request is video-related
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
 * Registers all Inter-Process Communication (IPC) handlers.
 * 
 * These handlers allow the renderer (React app) to communicate with the 
 * Node.js main process for native operations like traceroute, header 
 * injection, and update management.
 */
/**
 * Returns true when the IPC sender is the app's own renderer.
 * Rejects requests from any injected iframe or third-party content.
 */
function isFromApp(event: Electron.IpcMainInvokeEvent): boolean {
    const url = event.senderFrame?.url ?? '';
    return url.startsWith('file://') || url.startsWith('http://localhost:');
}

function setupIpcHandlers(): void {
    // Traceroute: fork a utility process, create a MessageChannelMain so hops
    // stream directly from the worker to the renderer preload — no main relay.
    ipcMain.on('run-traceroute', (_event, host: string) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        logger.info(`Traceroute requested for: ${host}`);
        const target = host.includes('://') ? extractHostnameFromUrl(host) : host;
        if (!target) { logger.error('Invalid traceroute target:', host); return; }

        const { port1, port2 } = new MessageChannelMain();

        // port1 → renderer preload (receives hop/result messages directly)
        mainWindow.webContents.postMessage('traceroute-port', null, [port1]);

        // port2 → utility process (sends hop/result messages directly to renderer)
        const worker = utilityProcess.fork(
            path.join(__dirname, 'traceroute-worker.js')
        );
        worker.postMessage({ cmd: 'traceroute', target, maxHops: 20, timeout: 2 }, [port2]);
        worker.on('exit', (code) => {
            logger.info(`Traceroute worker exited (code: ${code})`);
        });
    });

    // Handle custom header injection requests
    // This allows the renderer to specify headers to inject into video requests
    ipcMain.on('set-custom-headers', (event, headers: Record<string, string>) => {
        customRequestHeaders = headers || {};
        logger.info('Custom headers updated:', Object.keys(customRequestHeaders));
    });

    // Handle clear custom headers
    ipcMain.on('clear-custom-headers', () => {
        customRequestHeaders = {};
        logger.info('Custom headers cleared');
    });

    // Handle network cache reset
    ipcMain.on('network:reset-cache', () => {
        detectedIps.clear();
        logger.info('Network IP cache cleared');
    });

    // Return public IP via ipify
    ipcMain.handle('get-public-ip', async (event) => {
        if (!isFromApp(event)) throw new Error('Unauthorized sender');
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json() as { ip: string };
            return data.ip;
        } catch (error) {
            logger.error('Failed to get public IP:', error);
            return null;
        }
    });

    // Geolocation is handled by the renderer's GeoLocationService via navigator.geolocation
    // (granted by setupPermissions). Return null to signal the renderer to use its own flow.
    ipcMain.handle('get-geolocation', async (event) => {
        if (!isFromApp(event)) throw new Error('Unauthorized sender');
        return null;
    });

    // Trigger update installation when renderer user clicks "Restart & Install"
    ipcMain.on('update:check', () => {
        checkForUpdates(true);
    });

    ipcMain.on('update:simulate', () => {
        simulateUpdate();
    });

    ipcMain.on('update:install', () => {
        installUpdate();
    });

    // Renderer log relay — writes renderer warn/error to electron-log file
    ipcMain.on('log:relay', (_event, entry: { level: 'warn' | 'error'; namespace: string; args: unknown[] }) => {
        const rendererLog = createLogger(`Renderer:${entry.namespace}`);
        if (entry.level === 'warn') rendererLog.warn(...entry.args);
        else rendererLog.error(...entry.args);
    });

    logger.info('IPC handlers registered');
}

/**
 * Configures the native macOS About panel with version details.
 * Must be called after appVersion is resolved.
 */
function setupAboutPanel(): void {
    app.setAboutPanelOptions({
        applicationName: 'oi-Lab',
        applicationVersion: appVersion,
        copyright: 'Copyright © 2026 Sonic Rocket',
        credits: [
            `Electron: ${process.versions.electron}`,
            `Chromium: ${process.versions.chrome}`,
            `Node.js: ${process.versions.node}`,
        ].join('\n'),
    });
}

/**
 * Builds the native application menu.
 *
 * Preserves macOS default menus (Edit, View, Window) so that standard
 * keyboard shortcuts (Cmd+C, Cmd+Z, etc.) continue to work. On macOS,
 * "About oi-Lab" lives in the app menu (standard placement); the Help
 * menu is kept so macOS adds its built-in search field.
 */
function setupMenu(): void {
    const template: Electron.MenuItemConstructorOptions[] = [
        // macOS: first menu item is the app name menu
        ...(process.platform === 'darwin' ? [{
            label: app.name,
            submenu: [
                { role: 'about' as const },
                {
                    label: 'Check for Updates\u2026',
                    click: () => checkForUpdates(true),
                },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const },
            ]
        }] : []),
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' as const },
                { role: 'redo' as const },
                { type: 'separator' as const },
                { role: 'cut' as const },
                { role: 'copy' as const },
                { role: 'paste' as const },
                { role: 'selectAll' as const },
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' as const },
                { role: 'toggleDevTools' as const },
                { type: 'separator' as const },
                { role: 'resetZoom' as const },
                { role: 'zoomIn' as const },
                { role: 'zoomOut' as const },
                { type: 'separator' as const },
                { role: 'togglefullscreen' as const },
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' as const },
                { role: 'zoom' as const },
                ...(process.platform === 'darwin' ? [{ role: 'front' as const }] : []),
            ]
        },
        {
            role: 'help' as const,
            submenu: [],
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// App lifecycle events
app.whenReady().then(() => {
    // Initialize logger after app is ready
    logger = createLogger('Electron');

    logger.info('App starting up...');

    // Read version from package.json (now that logger is available)
    try {
        const packageJson = findPackageJson();
        appVersion = packageJson.version;
        logger.info(`oi-Lab starting (version: ${appVersion})...`);
    } catch (e) {
        logger.error('Failed to read app version:', e);
    }

    setupAboutPanel();
    setupMenu();

    logger.info('Checkpoint: before setupPermissions');
    setupPermissions();
    logger.info('Checkpoint: after setupPermissions');

    logger.info('Checkpoint: before setupNetworkMonitoring');
    setupNetworkMonitoring();
    logger.info('Checkpoint: after setupNetworkMonitoring');

    logger.info('Checkpoint: before setupIpcHandlers');
    setupIpcHandlers();
    logger.info('Checkpoint: after setupIpcHandlers');

    logger.info('Checkpoint: before createWindow');
    createWindow();
    logger.info('Checkpoint: after createWindow');

    // Setup auto-updater (no-op in dev)
    logger.info('Checkpoint: before setupAutoUpdater');
    setupAutoUpdater(() => mainWindow);
    logger.info('Checkpoint: after setupAutoUpdater');

    // macOS: re-create window when dock icon is clicked
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

/**
 * Configures application-level permission handlers.
 * 
 * This centrally manages which web APIs the renderer is allowed to access.
 * Crucially, this enables the navigator.geolocation API which is used by 
 * the app's topology services.
 */
function setupPermissions(): void {
    // Handle permission requests from the renderer process
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = [
            'geolocation',  // Enable navigator.geolocation
            'media',        // Enable camera/mic if needed
        ];

        if (allowedPermissions.includes(permission)) {
            logger.info(`Granting permission: ${permission}`);
            callback(true);
        } else {
            logger.info(`Denying permission: ${permission}`);
            callback(false);
        }
    });

    // Also handle permission checks (for APIs that check before requesting)
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        const allowedPermissions = ['geolocation', 'media'];
        return allowedPermissions.includes(permission);
    });

    logger.info('Permission handlers configured (geolocation enabled)');
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
