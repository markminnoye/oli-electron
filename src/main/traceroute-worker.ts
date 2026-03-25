/**
 * Traceroute Utility Process Worker
 *
 * Runs in an isolated Electron utility process (utilityProcess.fork).
 * Receives a traceroute request + a MessagePort from the main process,
 * then streams hop-by-hop results directly to the renderer via that port —
 * with no main-process relay on the hot path.
 *
 * Message protocol (from main process):
 *   { cmd: 'traceroute', target: string, maxHops: number, timeout: number }
 *   + one transferred MessagePort (event.ports[0])
 *
 * Messages sent on the port to the renderer preload:
 *   { type: 'hop',    hop:    TracerouteHop    }
 *   { type: 'result', result: TracerouteResult }
 */

import { spawn } from 'child_process';
import { parseTracerouteLine, TracerouteHop, TracerouteResult } from './tracerouteParser.js';

// Singleton so a second request cancels the previous traceroute
let activeProcess: ReturnType<typeof spawn> | null = null;

function stopActive(): void {
    if (activeProcess) {
        activeProcess.kill();
        activeProcess = null;
    }
}

function runStreaming(
    target: string,
    maxHops: number,
    timeout: number,
    onHop: (hop: TracerouteHop) => void,
    onComplete: (result: TracerouteResult) => void
): void {
    const timestamp = Date.now();
    const hops: TracerouteHop[] = [];
    const isIPv6 = target.includes(':');
    const platform = process.platform;

    let command: string;
    let args: string[];

    if (platform === 'darwin' || platform === 'linux') {
        command = isIPv6 ? 'traceroute6' : 'traceroute';
        args = ['-n', '-q', '1', '-I', '-m', String(maxHops), '-w', String(timeout), target];
    } else if (platform === 'win32') {
        command = 'tracert';
        args = ['-d', '-h', String(maxHops), '-w', String(timeout * 1000), target];
    } else {
        onComplete({ target, hops: [], timestamp, complete: false, error: `Unsupported platform: ${platform}` });
        return;
    }

    stopActive();

    const child = spawn(command, args);
    activeProcess = child;
    let buffer = '';

    child.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            const hop = parseTracerouteLine(line);
            if (hop) { hops.push(hop); onHop(hop); }
        }
    });

    child.stderr.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n')) {
            const hop = parseTracerouteLine(line);
            if (hop) { hops.push(hop); onHop(hop); }
        }
    });

    child.on('close', (code) => {
        if (buffer.trim()) {
            const hop = parseTracerouteLine(buffer);
            if (hop) { hops.push(hop); onHop(hop); }
        }
        onComplete({ target, hops, timestamp, complete: code === 0 || hops.length > 0 });
        activeProcess = null;
    });

    child.on('error', (error) => {
        onComplete({ target, hops, timestamp, complete: false, error: error.message });
        activeProcess = null;
    });
}

// ── Entry point ──────────────────────────────────────────────────────────────

process.parentPort.on('message', (event) => {
    const { cmd, target, maxHops, timeout } = event.data as {
        cmd: string;
        target: string;
        maxHops: number;
        timeout: number;
    };

    if (cmd !== 'traceroute') return;

    const port = event.ports[0];
    if (!port) {
        process.parentPort.postMessage({ error: 'No MessagePort received' });
        return;
    }

    port.start();

    runStreaming(
        target,
        maxHops ?? 20,
        timeout ?? 2,
        (hop) => port.postMessage({ type: 'hop', hop }),
        (result) => port.postMessage({ type: 'result', result })
    );
});
