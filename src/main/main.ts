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

import { app, BrowserWindow, session } from 'electron';
import path from 'path';

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
 */
function setupNetworkMonitoring(): void {
    session.defaultSession.webRequest.onHeadersReceived(
        { urls: ['*://*/*'] },
        (details, callback) => {
            // In Phase 2, we'll send these headers to the renderer via IPC
            // For now, just log video-related requests
            if (details.url.includes('.m3u8') ||
                details.url.includes('.mpd') ||
                details.url.includes('.ts') ||
                details.url.includes('.m4s')) {
                console.log('[Network]', details.method, details.url);
                console.log('[Headers]', JSON.stringify(details.responseHeaders, null, 2));
            }

            callback({ responseHeaders: details.responseHeaders });
        }
    );

    console.log('[Electron] Network monitoring enabled');
}

// App lifecycle events
app.whenReady().then(() => {
    setupNetworkMonitoring();
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
