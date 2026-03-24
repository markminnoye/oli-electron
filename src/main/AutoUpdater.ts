/**
 * Auto-updater module for Electron
 *
 * Uses electron-updater to check for, download, and install updates from GitHub Releases.
 * IPC events pushed to renderer:
 *   update:checking   — started a check
 *   update:available  — update found, download starting automatically
 *   update:progress   — download progress
 *   update:downloaded — downloaded and ready to install
 *   update:error      — something went wrong
 */

import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { createLogger } from './logger.js';

const log = createLogger('AutoUpdater');

/** How long to wait after startup before the first update check (ms) */
const INITIAL_CHECK_DELAY_MS = 3_000;

/** How often to check for updates — every 4 hours */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;

let mainWindowGetter: () => BrowserWindow | null;

/**
 * Configures electron-updater and starts the update check cycle.
 *
 * @param getMainWindow - Returns the current main BrowserWindow (or null if closed)
 */
export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
    mainWindowGetter = getMainWindow;

    // Silent background download; user decides when to restart
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;

    // Suppress electron-updater's own logger; we handle it via createLogger
    autoUpdater.logger = null;

    function send(channel: string, payload?: unknown): void {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    }

    autoUpdater.on('checking-for-update', () => {
        log.log('Checking for update...');
        send('update:checking');
    });

    autoUpdater.on('update-available', (info) => {
        log.info(`Update available: v${info.version}`);
        send('update:available', {
            version: info.version,
            releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
        });
    });

    autoUpdater.on('update-not-available', (info) => {
        log.log(`Already up to date (v${info.version})`);
    });

    autoUpdater.on('download-progress', (progress) => {
        log.log(`Download: ${progress.percent.toFixed(1)}% at ${(progress.bytesPerSecond / 1024).toFixed(0)} KB/s`);
        send('update:progress', {
            percent: progress.percent,
            transferred: progress.transferred,
            total: progress.total,
            bytesPerSecond: progress.bytesPerSecond,
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        log.info(`Update downloaded: v${info.version} — ready to install`);
        send('update:downloaded', { version: info.version });
    });

    autoUpdater.on('error', (err) => {
        log.error('Update error:', err.message);
        send('update:error', { message: err.message });
    });

    // Initial check after a short delay to let the app finish loading
    if (app.isPackaged) {
        setTimeout(() => {
            autoUpdater.checkForUpdates().catch((err) => {
                log.error('checkForUpdates failed:', err.message);
            });
        }, INITIAL_CHECK_DELAY_MS);

        // Recurring checks
        setInterval(() => {
            autoUpdater.checkForUpdates().catch((err) => {
                log.error('checkForUpdates failed:', err.message);
            });
        }, CHECK_INTERVAL_MS);

        log.info('Auto-updater configured — first check in 3s, then every 4h');
    } else {
        log.info('Auto-updater configured in dummy mode (dev)');
    }
}

/**
 * Checks for updates.
 * @param manual Whether this check was triggered manually by the user.
 */
export async function checkForUpdates(manual: boolean = false): Promise<void> {
    if (app.isPackaged || manual) {
        log.log(`Checking for updates (manual: ${manual})...`);
        try {
            await autoUpdater.checkForUpdatesAndNotify();
        } catch (err: any) {
            log.error('checkForUpdates failed:', err.message);
        }
    } else {
        log.log('Skipping update check in development mode');
    }
}

/**
 * Simulates an update flow for development/demonstration.
 */
export function simulateUpdate(): void {
    log.log('Simulating update flow...');
    const win = mainWindowGetter && mainWindowGetter();
    if (!win || win.isDestroyed()) return;

    const send = (channel: string, payload?: unknown) => win.webContents.send(channel, payload);

    // 1. Notify checking
    send('update:checking');

    setTimeout(() => {
        // 2. Notify update available
        send('update:available', {
            version: '2.0.0-mock',
            releaseDate: new Date().toISOString()
        });

        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                
                // 3. Notify download complete
                send('update:downloaded', {
                    version: '2.0.0-mock'
                });
            } else {
                // 4. Notify progress
                send('update:progress', {
                    percent: progress,
                    bytesPerSecond: 1024 * 512, // 512 KB/s
                    total: 100 * 1024 * 1024,
                    transferred: (progress / 100) * 100 * 1024 * 1024
                });
            }
        }, 500);
    }, 1500);
}

/**
 * Quits the app and installs the downloaded update.
 * Called via IPC from the renderer when the user clicks "Restart & Install".
 */
export function installUpdate(): void {
    log.info('Installing update and restarting...');
    setImmediate(() => autoUpdater.quitAndInstall());
}
