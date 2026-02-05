/**
 * TracerouteProvider - Native traceroute execution for Electron main process
 * 
 * Runs platform-native traceroute commands and parses results into structured data.
 * Exposes results to renderer via IPC.
 * 
 * Supports two modes:
 * - Batch: runTraceroute() - waits for completion, returns all hops
 * - Streaming: runTracerouteStreaming() - emits hops as discovered
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Singleton traceroute process tracking
let activeTracerouteProcess: any = null;

/**
 * Stop any active traceroute process
 */
export function stopActiveTraceroute(): void {
    if (activeTracerouteProcess) {
        console.log('[TracerouteProvider] Killing active traceroute process...');
        activeTracerouteProcess.kill();
        activeTracerouteProcess = null;
    }
}

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
 * IPv4 example: " 1  192.168.1.1 (192.168.1.1)  3.123 ms  2.456 ms  1.789 ms"
 * IPv6 example: " 1  hostname.example.com  7.736 ms  5.309 ms  6.890 ms"
 * IPv6 bare:    " 9  2001:730:2300::5474:80a1  36.030 ms  140.830 ms  34.598 ms"
 * IPv6 dashed:  " 2  2a02-1811-d34-2d00-66fd-96ff-fe79-a484.ip6.access.telenet.be  7.889 ms ..."
 */
function parseTracerouteOutput(output: string): TracerouteHop[] {
    const hops: TracerouteHop[] = [];
    const lines = output.split('\n');

    // Regex patterns
    const IPv4_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;
    const IPv6_PATTERN = /^[0-9a-fA-F:]+:[0-9a-fA-F:]+$/;
    // Pattern for dashed IPv6 in hostname (e.g., 2a02-1811-d34-2d00-66fd-96ff-fe79-a484)
    const DASHED_IPv6_PATTERN = /^([0-9a-fA-F]+-[0-9a-fA-F-]+)/;

    for (const line of lines) {
        // Skip header and empty lines
        if (!line.trim() || line.includes('traceroute to') || line.includes('traceroute6 to')) continue;

        // Match hop number at start
        const hopMatch = line.match(/^\s*(\d+)\s+/);
        if (!hopMatch) continue;

        const hopNum = parseInt(hopMatch[1], 10);

        // Check for timeout (* * *)
        // Still include in results to preserve hop position
        if (line.includes('* * *')) {
            hops.push({
                hop: hopNum,
                ip: null,
                hostname: null,
                rtt: null
            });
            continue;
        }

        // Get the rest of the line after the hop number
        const restOfLine = line.substring(hopMatch[0].length);

        // Split by whitespace
        const parts = restOfLine.trim().split(/\s+/);
        if (parts.length < 2) continue;

        let hostname: string | null = null;
        let ip: string | null = null;
        let rtt: number | null = null;

        // First part is either hostname or IP
        const firstPart = parts[0];

        // Check for IPv4 format: hostname (ip) or just ip
        const ipv4ParenMatch = restOfLine.match(/(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)/);
        if (ipv4ParenMatch) {
            hostname = ipv4ParenMatch[1];
            ip = ipv4ParenMatch[2];
        } else if (IPv4_PATTERN.test(firstPart)) {
            // Bare IPv4
            ip = firstPart;
        } else if (IPv6_PATTERN.test(firstPart)) {
            // Bare IPv6 address (e.g., 2001:730:2300::5474:80a1)
            ip = firstPart;
        } else {
            // Could be a hostname, possibly with embedded dashed IPv6
            hostname = firstPart;

            // Try to extract IPv6 from dashed hostname format
            // Examples:
            //   2a02-1811-d34-2d00-66fd-96ff-fe79-a484.ip6.access.telenet.be
            //   unifi (local router, no IP)
            const dashedMatch = hostname.match(DASHED_IPv6_PATTERN);
            if (dashedMatch) {
                const dashedPart = dashedMatch[1];
                // Count segments - valid IPv6 should have 7 dashes (8 segments) for full address
                // or fewer for compressed addresses
                const segments = dashedPart.split('-');
                if (segments.length >= 4 && segments.every(s => /^[0-9a-fA-F]{1,4}$/.test(s))) {
                    // Convert dashes to colons for proper IPv6 format
                    ip = segments.join(':');
                }
            }
        }

        // Extract RTT (first "X.XXX ms" found)
        const rttMatch = restOfLine.match(/(\d+\.?\d*)\s*ms/);
        if (rttMatch) {
            rtt = parseFloat(rttMatch[1]);
        }

        // Always add the hop to preserve position in trace
        hops.push({
            hop: hopNum,
            ip,
            hostname: hostname !== ip ? hostname : null,
            rtt
        });
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

    // Detect if target is IPv6
    const isIPv6 = target.includes(':');

    // Determine platform-specific command
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin' || platform === 'linux') {
        // macOS and Linux: use 'traceroute6' for IPv6, 'traceroute' for IPv4
        // -I flag uses ICMP ECHO instead of UDP - better firewall penetration
        if (isIPv6) {
            command = `traceroute6 -I -m ${maxHops} -w ${timeout} ${target}`;
        } else {
            command = `traceroute -I -m ${maxHops} -w ${timeout} ${target}`;
        }
    } else if (platform === 'win32') {
        // Windows uses 'tracert' for both (auto-detects IPv6)
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
        console.log(`[TracerouteProvider] Parsed hops:`, JSON.stringify(hops, null, 2));

        return {
            target,
            hops,
            timestamp,
            complete: true
        };

    } catch (error: any) {
        console.error('[TracerouteProvider] Error:', error.message);

        // traceroute6 may return non-zero exit code but still have valid output
        // Check both stdout and stderr for usable traceroute data
        const output = error.stdout || error.stderr || '';

        if (output) {
            console.log('[TracerouteProvider] Attempting to parse partial output:', output.substring(0, 200));
            const hops = parseTracerouteOutput(output);

            if (hops.length > 0) {
                console.log(`[TracerouteProvider] Recovered ${hops.length} hops from error output`);
                console.log(`[TracerouteProvider] Parsed hops:`, JSON.stringify(hops, null, 2));

                return {
                    target,
                    hops,
                    timestamp,
                    complete: false,
                    error: error.message
                };
            }
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
 * Parse a single line of traceroute output
 * Returns a hop if the line contains valid hop data, null otherwise
 */
function parseTracerouteLine(line: string): TracerouteHop | null {
    // Skip header and empty lines
    if (!line.trim() || line.includes('traceroute to') || line.includes('traceroute6 to')) {
        return null;
    }

    // Match hop number at start
    const hopMatch = line.match(/^\s*(\d+)\s+/);
    if (!hopMatch) return null;

    const hopNum = parseInt(hopMatch[1], 10);

    // Check for timeout (* * *)
    if (line.includes('* * *')) {
        return {
            hop: hopNum,
            ip: null,
            hostname: null,
            rtt: null
        };
    }

    // Get the rest of the line after the hop number
    const restOfLine = line.substring(hopMatch[0].length);

    // Split by whitespace
    const parts = restOfLine.trim().split(/\s+/);
    if (parts.length < 2) return null;

    let hostname: string | null = null;
    let ip: string | null = null;
    let rtt: number | null = null;

    const IPv4_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;
    const IPv6_PATTERN = /^[0-9a-fA-F:]+:[0-9a-fA-F:]+$/;
    const DASHED_IPv6_PATTERN = /^([0-9a-fA-F]+-[0-9a-fA-F-]+)/;

    const firstPart = parts[0];

    // Check for IPv4 format: hostname (ip) or just ip
    const ipv4ParenMatch = restOfLine.match(/(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)/);
    if (ipv4ParenMatch) {
        hostname = ipv4ParenMatch[1];
        ip = ipv4ParenMatch[2];
    } else if (IPv4_PATTERN.test(firstPart)) {
        ip = firstPart;
    } else if (IPv6_PATTERN.test(firstPart)) {
        ip = firstPart;
    } else {
        hostname = firstPart;
        const dashedMatch = hostname.match(DASHED_IPv6_PATTERN);
        if (dashedMatch) {
            const segments = dashedMatch[1].split('-');
            if (segments.length >= 4 && segments.every(s => /^[0-9a-fA-F]{1,4}$/.test(s))) {
                ip = segments.join(':');
            }
        }
    }

    // Extract RTT
    const rttMatch = restOfLine.match(/(\d+\.?\d*)\s*ms/);
    if (rttMatch) {
        rtt = parseFloat(rttMatch[1]);
    }

    return {
        hop: hopNum,
        ip,
        hostname: hostname !== ip ? hostname : null,
        rtt
    };
}

/**
 * Run traceroute with streaming output - emits each hop as it's discovered
 * 
 * @param target - Hostname or IP to trace
 * @param onHop - Callback for each discovered hop
 * @param onComplete - Callback when traceroute completes
 * @param maxHops - Maximum number of hops (default: 20)
 * @param timeout - Timeout per hop in seconds (default: 2)
 */
export function runTracerouteStreaming(
    target: string,
    onHop: (hop: TracerouteHop) => void,
    onComplete: (result: TracerouteResult) => void,
    maxHops: number = 20,
    timeout: number = 2
): void {
    const timestamp = Date.now();
    const hops: TracerouteHop[] = [];

    // Detect if target is IPv6
    const isIPv6 = target.includes(':');

    // Determine command and args
    const platform = process.platform;
    let command: string;
    let args: string[];

    if (platform === 'darwin' || platform === 'linux') {
        // -n: Don't resolve hostnames (faster, we geolocate by IP anyway)
        // -q 1: Single query per hop (faster, default is 3)
        // -I: ICMP ECHO instead of UDP (better firewall penetration)
        if (isIPv6) {
            command = 'traceroute6';
            args = ['-n', '-q', '1', '-I', '-m', String(maxHops), '-w', String(timeout), target];
        } else {
            command = 'traceroute';
            args = ['-n', '-q', '1', '-I', '-m', String(maxHops), '-w', String(timeout), target];
        }
    } else if (platform === 'win32') {
        // Windows tracert: -d = no DNS, no equivalent for single query
        command = 'tracert';
        args = ['-d', '-h', String(maxHops), '-w', String(timeout * 1000), target];
    } else {
        onComplete({
            target,
            hops: [],
            timestamp,
            complete: false,
            error: `Unsupported platform: ${platform}`
        });
        return;
    }

    console.log(`[TracerouteProvider] Streaming: ${command} ${args.join(' ')}`);

    // Kill any existing traceroute before starting a new one
    stopActiveTraceroute();

    const child = spawn(command, args);
    activeTracerouteProcess = child;
    let buffer = '';

    child.stdout.on('data', (data: Buffer) => {
        const rawChunk = data.toString();
        console.log(`[TracerouteProvider] Raw stdout chunk:\n${rawChunk}`);
        buffer += rawChunk;

        // Process complete lines
        const lines = buffer.split('\n');
        // Keep incomplete last line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
            console.log(`[TracerouteProvider] Parsing line: "${line}"`);
            const hop = parseTracerouteLine(line);
            if (hop) {
                hops.push(hop);
                console.log(`[TracerouteProvider] Hop ${hop.hop}: ${hop.ip || hop.hostname || '*'} (rtt: ${hop.rtt}ms)`);
                onHop(hop);
            }
        }
    });

    child.stderr.on('data', (data: Buffer) => {
        // Some traceroute implementations output to stderr
        const output = data.toString();
        const lines = output.split('\n');
        for (const line of lines) {
            const hop = parseTracerouteLine(line);
            if (hop) {
                hops.push(hop);
                console.log(`[TracerouteProvider] Hop ${hop.hop}: ${hop.ip || hop.hostname || '*'}`);
                onHop(hop);
            }
        }
    });

    child.on('close', (code) => {
        // Process any remaining buffer
        if (buffer.trim()) {
            const hop = parseTracerouteLine(buffer);
            if (hop) {
                hops.push(hop);
                onHop(hop);
            }
        }

        console.log(`[TracerouteProvider] Streaming complete: ${hops.length} hops (exit code: ${code})`);

        onComplete({
            target,
            hops,
            timestamp,
            complete: code === 0 || hops.length > 0
        });
    });

    child.on('error', (error) => {
        console.error('[TracerouteProvider] Spawn error:', error.message);
        onComplete({
            target,
            hops,
            timestamp,
            complete: false,
            error: error.message
        });
    });
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
