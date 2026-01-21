/**
 * TracerouteProvider - Native traceroute execution for Electron main process
 * 
 * Runs platform-native traceroute commands and parses results into structured data.
 * Exposes results to renderer via IPC.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TracerouteHop {
    hop: number;
    ip: string | null;
    hostname: string | null;
    rtt: number | null; // milliseconds
    location?: string;
}

export interface TracerouteResult {
    target: string;
    hops: TracerouteHop[];
    timestamp: number;
    complete: boolean;
    error?: string;
}

/**
 * Parse traceroute output (macOS/Linux format)
 * Example line: " 1  192.168.1.1 (192.168.1.1)  3.123 ms  2.456 ms  1.789 ms"
 */
function parseTracerouteOutput(output: string): TracerouteHop[] {
    const hops: TracerouteHop[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
        // Skip header and empty lines
        if (!line.trim() || line.includes('traceroute to')) continue;

        // Match hop number at start
        const hopMatch = line.match(/^\s*(\d+)\s+/);
        if (!hopMatch) continue;

        const hopNum = parseInt(hopMatch[1], 10);

        // Check for timeout (* * *)
        if (line.includes('* * *')) {
            hops.push({
                hop: hopNum,
                ip: null,
                hostname: null,
                rtt: null
            });
            continue;
        }

        // Parse IP/hostname and RTT
        // Match patterns like: hostname (ip) rtt ms
        // Or just: ip rtt ms
        const ipMatch = line.match(/(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)|(\d+\.\d+\.\d+\.\d+)/);
        const rttMatch = line.match(/(\d+\.?\d*)\s*ms/);

        if (ipMatch) {
            const hostname = ipMatch[1] || null;
            const ip = ipMatch[2] || ipMatch[3] || null;
            const rtt = rttMatch ? parseFloat(rttMatch[1]) : null;

            hops.push({
                hop: hopNum,
                ip,
                hostname: hostname !== ip ? hostname : null,
                rtt
            });
        }
    }

    return hops;
}

/**
 * Run traceroute to a target host
 * @param target - Hostname or IP to trace
 * @param maxHops - Maximum number of hops (default: 30)
 * @param timeout - Timeout per hop in seconds (default: 2)
 */
export async function runTraceroute(
    target: string,
    maxHops: number = 30,
    timeout: number = 2
): Promise<TracerouteResult> {
    const timestamp = Date.now();

    // Determine platform-specific command
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin' || platform === 'linux') {
        // macOS and Linux use 'traceroute'
        command = `traceroute -m ${maxHops} -w ${timeout} ${target}`;
    } else if (platform === 'win32') {
        // Windows uses 'tracert'
        command = `tracert -h ${maxHops} -w ${timeout * 1000} ${target}`;
    } else {
        return {
            target,
            hops: [],
            timestamp,
            complete: false,
            error: `Unsupported platform: ${platform}`
        };
    }

    try {
        console.log(`[TracerouteProvider] Running: ${command}`);

        // Traceroute can take a while, set generous timeout
        const { stdout, stderr } = await execAsync(command, {
            timeout: (maxHops * timeout + 10) * 1000,
            maxBuffer: 1024 * 1024
        });

        if (stderr && !stdout) {
            console.warn('[TracerouteProvider] stderr:', stderr);
        }

        const hops = parseTracerouteOutput(stdout);

        console.log(`[TracerouteProvider] Traced ${target}: ${hops.length} hops`);

        return {
            target,
            hops,
            timestamp,
            complete: true
        };

    } catch (error: any) {
        console.error('[TracerouteProvider] Error:', error.message);

        // Some output may still be available even if command "failed"
        if (error.stdout) {
            const hops = parseTracerouteOutput(error.stdout);
            return {
                target,
                hops,
                timestamp,
                complete: false,
                error: error.message
            };
        }

        return {
            target,
            hops: [],
            timestamp,
            complete: false,
            error: error.message
        };
    }
}

/**
 * Extract hostname from URL for traceroute
 */
export function extractHostnameFromUrl(url: string): string | null {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return null;
    }
}
