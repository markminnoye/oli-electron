/**
 * Shared traceroute data types and line-parsing logic.
 *
 * Extracted here so both TracerouteProvider (main process) and
 * traceroute-worker (utility process) can import without duplication.
 */

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

// ── Regex constants ──────────────────────────────────────────────────────────

const IPv4_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;
const IPv6_PATTERN = /^[0-9a-fA-F:]+:[0-9a-fA-F:]+$/;
/** Dashed IPv6 embedded in a hostname, e.g. 2a02-1811-d34-2d00-66fd-96ff-fe79-a484 */
const DASHED_IPv6_PATTERN = /^([0-9a-fA-F]+-[0-9a-fA-F-]+)/;

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractHopFields(restOfLine: string): Pick<TracerouteHop, 'ip' | 'hostname' | 'rtt'> {
    const parts = restOfLine.trim().split(/\s+/);
    if (parts.length < 2) return { ip: null, hostname: null, rtt: null };

    let hostname: string | null = null;
    let ip: string | null = null;

    const firstPart = parts[0];
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

    const rttMatch = restOfLine.match(/(\d+\.?\d*)\s*ms/);
    const rtt = rttMatch ? parseFloat(rttMatch[1]) : null;

    return { ip, hostname: hostname !== ip ? hostname : null, rtt };
}

/**
 * Parse a single line of traceroute output.
 * Returns a TracerouteHop if the line contains valid hop data, null otherwise.
 */
export function parseTracerouteLine(line: string): TracerouteHop | null {
    if (!line.trim() || line.includes('traceroute to') || line.includes('traceroute6 to')) {
        return null;
    }

    const hopMatch = line.match(/^\s*(\d+)\s+/);
    if (!hopMatch) return null;

    const hopNum = parseInt(hopMatch[1], 10);

    if (line.includes('* * *')) {
        return { hop: hopNum, ip: null, hostname: null, rtt: null };
    }

    const restOfLine = line.substring(hopMatch[0].length);
    const fields = extractHopFields(restOfLine);

    return { hop: hopNum, ...fields };
}

/**
 * Parse complete traceroute output (batch mode).
 */
export function parseTracerouteOutput(output: string): TracerouteHop[] {
    const hops: TracerouteHop[] = [];
    for (const line of output.split('\n')) {
        const hop = parseTracerouteLine(line);
        if (hop) hops.push(hop);
    }
    return hops;
}
