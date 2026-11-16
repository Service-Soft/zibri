// The process a probe of a Valkey server runs in, forked by a backup measurement (ValKeyServerProbe). It
// asks the server for its memory every few milliseconds, over a connection of its own, and reports
// between a begin and an end what the slowest answer took and the most memory the server used.
import { connect, Socket } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';

import { ValKeyServerMeasurement } from './backup-measurement.model';
import { VALKEY_PROBE_ADDRESS_ENV, ValKeyProbeAddress, ValKeyProbeCommand, ValKeyProbeMessage } from './val-key-server-probe.model';
import { JsonUtilities } from '../../../utilities/json.utilities';

/**
 * How long the probe waits between an answer and its next question: often enough to tell a pause of the
 * server from a slow answer, seldom enough to add nothing the server notices.
 */
const INTERVAL_IN_MS: number = 10;

/**
 * How long the probe waits before asking again a server busy running a script, which answers anybody
 * else that it is busy rather than what was asked.
 */
const BUSY_RETRY_IN_MS: number = 1;

/**
 * One connection to the server, asking one question at a time.
 */
class ProbeConnection {
    private received: Buffer = Buffer.alloc(0);

    private onReceived: (() => void) | undefined;

    constructor(private readonly socket: Socket) {
        socket.on('data', chunk => {
            this.received = Buffer.concat([this.received, chunk]);
            this.onReceived?.();
        });
    }

    /**
     * Asks the server for the memory it uses, again as long as it answers that it is busy.
     * @returns Its `used_memory`, in bytes.
     */
    async resolveUsedMemory(): Promise<number> {
        for (;;) {
            this.socket.write('*2\r\n$4\r\nINFO\r\n$6\r\nmemory\r\n');
            const reply: string | 'busy' = await this.receiveBulk();
            if (reply !== 'busy') {
                const usedMemory: string | undefined = /^used_memory:(\d+)\r?$/m.exec(reply)?.[1];
                if (usedMemory == undefined) {
                    throw new Error(`The server answered INFO memory without used_memory: ${reply.slice(0, 200)}`);
                }
                return Number(usedMemory);
            }
            await wait(BUSY_RETRY_IN_MS);
        }
    }

    private async receiveBulk(): Promise<string | 'busy'> {
        for (;;) {
            const reply: string | 'busy' | undefined = this.takeBulk();
            if (reply != undefined) {
                return reply;
            }
            // set before anything else can run, so data arriving next always finds it
            await new Promise<void>(resolve => {
                this.onReceived = resolve;
            });
        }
    }

    /**
     * Takes one reply off what was received, once all of it arrived.
     * @returns The bulk string, 'busy' when the server is busy running a script, undefined while the
     * reply has not arrived whole.
     * @throws When the server answered anything else.
     */
    private takeBulk(): string | 'busy' | undefined {
        const headerEnd: number = this.received.indexOf('\r\n');
        if (headerEnd < 0) {
            return undefined;
        }
        const header: string = this.received.subarray(0, headerEnd).toString();
        if (header.startsWith('-BUSY')) {
            this.received = this.received.subarray(headerEnd + 2);
            return 'busy';
        }
        if (!header.startsWith('$')) {
            throw new Error(`The server answered ${header}, not a bulk string.`);
        }
        const length: number = Number(header.slice(1));
        const end: number = headerEnd + 2 + length + 2;
        if (this.received.length < end) {
            return undefined;
        }
        const reply: string = this.received.subarray(headerEnd + 2, headerEnd + 2 + length).toString();
        this.received = this.received.subarray(end);
        return reply;
    }
}

/**
 * What the probe read of the phase running, if one is.
 */
type ProbedPhase = {
    /**
     * What the server used when it began, undefined until it was read.
     */
    startUsedMemory: number | undefined,
    peakUsedMemory: number,
    slowestAnswerMs: number,
    answers: number,
    /**
     * Whether the phase ended, so that the next answer is its last.
     */
    ended: boolean
};

function send(message: ValKeyProbeMessage): void {
    process.send?.(message);
}

/**
 * Connects to the server.
 * @param address - Where it is.
 * @returns The connection.
 */
async function open(address: ValKeyProbeAddress): Promise<ProbeConnection> {
    const socket: Socket = connect({ host: address.host, port: address.port });
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
    });
    // nothing is kept back to send a question with the next one
    socket.setNoDelay(true);
    return new ProbeConnection(socket);
}

/**
 * Reads the server until the measured process lets go of the probe.
 */
async function main(): Promise<void> {
    const raw: string | undefined = process.env[VALKEY_PROBE_ADDRESS_ENV];
    if (raw == undefined) {
        throw new Error(`${VALKEY_PROBE_ADDRESS_ENV} is not set: this runs in a process a backup measurement forks.`);
    }
    const connection: ProbeConnection = await open(JsonUtilities.parse<ValKeyProbeAddress>(raw));
    let phase: ProbedPhase | undefined;
    process.on('message', (command: ValKeyProbeCommand) => {
        if (command.kind === 'begin') {
            phase = { startUsedMemory: undefined, peakUsedMemory: 0, slowestAnswerMs: 0, answers: 0, ended: false };
            return;
        }
        if (phase != undefined) {
            phase.ended = true;
        }
    });
    process.once('disconnect', () => process.exit(0));
    send({ kind: 'ready' });

    for (;;) {
        const askedAt: number = performance.now();
        const usedMemory: number = await connection.resolveUsedMemory();
        const answeredInMs: number = performance.now() - askedAt;
        if (phase != undefined) {
            if (phase.startUsedMemory == undefined) {
                phase.startUsedMemory = usedMemory;
                send({ kind: 'begun' });
            }
            else {
                phase.answers++;
                phase.slowestAnswerMs = Math.max(phase.slowestAnswerMs, answeredInMs);
                phase.peakUsedMemory = Math.max(phase.peakUsedMemory, usedMemory);
            }
            if (phase.ended) {
                const report: ValKeyServerMeasurement = {
                    slowestAnswerMs: phase.slowestAnswerMs,
                    answers: phase.answers,
                    peakUsedMemoryGrowthBytes: Math.max(0, phase.peakUsedMemory - phase.startUsedMemory)
                };
                phase = undefined;
                send({ kind: 'report', report });
            }
        }
        await wait(INTERVAL_IN_MS);
    }
}

void (async () => {
    try {
        await main();
    }
    catch (error) {
        send({ kind: 'error', error: error instanceof Error ? error.stack ?? error.message : String(error) });
        process.exit(1);
    }
})();