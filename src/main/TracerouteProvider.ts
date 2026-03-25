/**
 * TracerouteProvider - Native traceroute execution for Electron main process
 *
 * Batch mode only (runTraceroute). Streaming is handled by the utility process
 * worker (traceroute-worker.ts) which sends hops directly to the renderer via
 * a MessagePort, bypassing the main process on the hot path.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { parseTracerouteOutput, TracerouteHop, TracerouteResult } from './tracerouteParser.js';

export type { TracerouteHop, TracerouteResult };

const execAsync = promisify(exec);

/**
 * Executes a full traceroute to a target host and returns the complete result.
 *
 * Batch operation — waits for the native command to finish.
 * For real-time hop updates use the utility-process worker via runTracerouteWorker().
 *
 * @param target - Hostname or IP to trace.
 * @param maxHops - Maximum number of hops (default: 30).
 * @param timeout - Timeout per hop in seconds (default: 2).
 */
export async function runTraceroute(
    target: string,
    maxHops: number = 30,
    timeout: number = 2
): Promise<TracerouteResult> {
    const timestamp = Date.now();
    const isIPv6 = target.includes(':');
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin' || platform === 'linux') {
        command = isIPv6
            ? `traceroute6 -I -m ${maxHops} -w ${timeout} ${target}`
            : `traceroute  -I -m ${maxHops} -w ${timeout} ${target}`;
    } else if (platform === 'win32') {
        command = `tracert -h ${maxHops} -w ${timeout * 1000} ${target}`;
    } else {
        return { target, hops: [], timestamp, complete: false, error: `Unsupported platform: ${platform}` };
    }

    try {
        const { stdout, stderr } = await execAsync(command, {
            timeout: (maxHops * timeout + 10) * 1000,
            maxBuffer: 1024 * 1024
        });
        if (stderr && !stdout) console.warn('[TracerouteProvider] stderr:', stderr);
        return { target, hops: parseTracerouteOutput(stdout), timestamp, complete: true };
    } catch (error: any) {
        const output = error.stdout || error.stderr || '';
        if (output) {
            const hops = parseTracerouteOutput(output);
            if (hops.length > 0) {
                return { target, hops, timestamp, complete: false, error: error.message };
            }
        }
        return { target, hops: [], timestamp, complete: false, error: error.message };
    }
}

/**
 * Extract hostname from URL for traceroute
 */
export function extractHostnameFromUrl(url: string): string | null {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}
