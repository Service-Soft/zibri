import { ChildProcess, fork, ForkOptions } from 'node:child_process';

import { resolveTypeScriptForkOptions } from 'zibri-testing';

import { ValKeyServerMeasurement } from './backup-measurement.model';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { JsonUtilities } from '../../../utilities/json.utilities';

/**
 * The environment variable the probe process reads the {@link ValKeyProbeAddress} of its server from.
 */
export const VALKEY_PROBE_ADDRESS_ENV: string = 'ZIBRI_VALKEY_PROBE_ADDRESS';

/**
 * Where the server a probe asks is.
 */
export type ValKeyProbeAddress = {
    host: string,
    port: number
};

/**
 * What the measured process tells a probe: that a phase begins, or that it ended.
 */
export type ValKeyProbeCommand = {
    kind: 'begin' | 'end'
};

/**
 * What a probe tells the measured process: that it is connected, that a phase is begun once it read the
 * memory the server uses at its start, what the server did during a phase that ended, or why it stopped.
 */
export type ValKeyProbeMessage = {
    kind: 'ready' | 'begun'
} | {
    kind: 'report',
    report: ValKeyServerMeasurement
} | {
    kind: 'error',
    error: string
};

const probeEntryPath: FsPath = FsUtilities.getPath(__dirname, 'val-key-server-probe.entry.ts');

/**
 * Whether a message of a probe is one of its messages.
 * @param message - The message.
 * @returns Whether it is.
 */
function isProbeMessage(message: unknown): message is ValKeyProbeMessage {
    return typeof message === 'object' && message != undefined && 'kind' in message;
}

/**
 * A client of a Valkey server of its own, in a process of its own, asking the server for its memory every
 * few milliseconds: what another client waits for while a backup or a restore runs, and the most memory
 * the server uses for it. Neither what the measured process holds nor how long its event loop is busy is
 * part of either.
 */
export class ValKeyServerProbe {
    private constructor(private readonly child: ChildProcess) {}

    /**
     * Starts a probe of a server, connected once this returns.
     * @param address - Where the server is.
     * @returns The probe.
     */
    static async start(address: ValKeyProbeAddress): Promise<ValKeyServerProbe> {
        const { execArgv, env }: Required<Pick<ForkOptions, 'execArgv' | 'env'>> = resolveTypeScriptForkOptions(
            'The Valkey probe of the backup benchmark'
        );
        const probe: ValKeyServerProbe = new ValKeyServerProbe(fork(probeEntryPath, [], {
            cwd: process.cwd(),
            execArgv,
            stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
            env: { ...env, [VALKEY_PROBE_ADDRESS_ENV]: JsonUtilities.stringify(address) }
        }));
        try {
            await probe.receive('ready');
        }
        catch (error) {
            probe.stop();
            throw error;
        }
        return probe;
    }

    /**
     * What several servers did during the phase that ended: the slowest answer of any, and the memory
     * they used added up.
     * @param reports - What each did.
     * @returns What they did, undefined for no server.
     */
    static resolveCombined(reports: ValKeyServerMeasurement[]): ValKeyServerMeasurement | undefined {
        if (!reports.length) {
            return undefined;
        }
        return {
            slowestAnswerMs: Math.max(...reports.map(r => r.slowestAnswerMs)),
            answers: Math.min(...reports.map(r => r.answers)),
            peakUsedMemoryGrowthBytes: reports.reduce((sum, r) => sum + r.peakUsedMemoryGrowthBytes, 0)
        };
    }

    /**
     * Begins a phase, once the probe read what the server uses at its start.
     */
    async begin(): Promise<void> {
        const begun: Promise<ValKeyProbeMessage> = this.receive('begun');
        this.send({ kind: 'begin' });
        await begun;
    }

    /**
     * Ends the phase.
     * @returns What the server did during it.
     */
    async end(): Promise<ValKeyServerMeasurement> {
        const reported: Promise<ValKeyProbeMessage> = this.receive('report');
        this.send({ kind: 'end' });
        const message: ValKeyProbeMessage = await reported;
        if (message.kind !== 'report') {
            throw new Error(`The Valkey probe sent ${JsonUtilities.stringify(message)} for a report.`);
        }
        return message.report;
    }

    /**
     * Stops the probe.
     */
    stop(): void {
        this.child.kill();
    }

    private send(command: ValKeyProbeCommand): void {
        // a probe that is gone fails the receive waiting for its answer, which names how it exited: the
        // callback keeps the failed send from being thrown as an error event nobody listens to
        this.child.send(command, () => undefined);
    }

    private async receive(kind: ValKeyProbeMessage['kind']): Promise<ValKeyProbeMessage> {
        // a probe that died between two phases sends nothing more, and exits no more either
        if (this.child.exitCode != undefined || this.child.signalCode != undefined) {
            throw new Error(`The Valkey probe exited with ${this.child.exitCode ?? this.child.signalCode} before it sent "${kind}".`);
        }
        return await new Promise<ValKeyProbeMessage>((resolve, reject) => {
            const onExit: (code: number | null) => void = code => reject(new Error(`The Valkey probe exited with ${code}.`));
            this.child.once('exit', onExit);
            this.child.once('message', message => {
                this.child.off('exit', onExit);
                if (!isProbeMessage(message) || message.kind === 'error' || message.kind !== kind) {
                    reject(new Error(`The Valkey probe sent ${JsonUtilities.stringify(message)}, waited for "${kind}".`));
                    return;
                }
                resolve(message);
            });
        });
    }
}