import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { FileHandle, open } from 'node:fs/promises';
import path from 'node:path';

import { PerfControl } from './perf-control.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { PromiseUtilities } from '../../utilities/promise.utilities';

/**
 * How to fork a node process, under `perf` or as it is.
 */
export type PerfFork = {
    /**
     * The program `fork` starts: `perf`, or node itself.
     */
    execPath: string,
    /**
     * What it is started with before the module: the arguments of `perf` and node, or those of node alone.
     */
    execArgv: string[]
};

/**
 * What a process is recorded with, which `scripts/profile-benchmarks.mjs` reads as well, as it starts jest under `perf`.
 */
type PerfRecordOptions = {
    /**
     * What `perf record` is started with, beside its control and its file:
     * - `-e cpu-clock:u`: the clock of the time each thread spends on a cpu, in user space. The counters of the cpu
     * itself, which perf takes otherwise, are refused at a perf_event_paranoid of 2 on many machines.
     * - `--call-graph fp --user-callchains`: the callers of each sample, in user space alone, since the part of a
     * stack in the kernel is refused there as well.
     * - `-F 499`: samples a second of each thread, odd so as not to sample in step with a timer of the process.
     * - `--no-buildid`: collecting the build ids of every library took longer than a process may take to exit.
     * - `-m 64`: buffers of 64 pages, half of what a user may lock for perf on a cpu by default, so that a process a
     * recorded jest forks is recorded by a perf of its own at the same time.
     * - `-D -1`: recording nothing until the process says so.
     */
    perf: string[],
    /**
     * What node is started with: the names of the functions V8 compiled, in `perf-<pid>.map` in `{folder}`, and the
     * log of V8 they turn on, in `{file}.v8.log`, rather than in the folder the process runs in.
     */
    node: string[]
};

/**
 * The environment variable a process started under `perf` finds its control in, for {@link PerfRecordingUtilities.recordIfAsked}.
 */
export const PERF_CONTROL_ENV: string = 'ZIBRI_BENCHMARK_PERF_CONTROL';

const PERF_RECORD_OPTIONS: PerfRecordOptions = JsonUtilities.parse<PerfRecordOptions>(
    readFileSync(path.join(__dirname, 'perf-record-options.json'), 'utf8')
);

/**
 * How long `perf` may take to answer a command before the recording counts as failed.
 */
const ANSWER_WITHIN_MS: number = 10_000;

/**
 * Records what every thread of a process runs while some work runs, with `perf`: the collector's helpers and the
 * thread pool included, which a cpu profile of node does not see, and their native code.
 *
 * `perf` starts the process itself, recording nothing, and records while the process says so through the FIFOs of
 * its control. Started by `perf` rather than attached to, since attaching needs a kernel letting one process trace
 * another that is not its child, which most do not.
 *
 * Linux only, with `perf` installed. A `perf_event_paranoid` of 2, the default of most distributions, records the
 * process in user space, which is where node, V8, zstd and OpenSSL run.
 */
export abstract class PerfRecordingUtilities {
    /**
     * Creates the FIFOs `perf` is controlled through, which it reads its commands from and answers on.
     * @param file - Where the recording is to be written, beside which the FIFOs are created.
     * @param platform - The system the process runs on.
     * @returns The control.
     * @throws When the system is not Linux.
     */
    static createControl(file: string, platform: NodeJS.Platform = process.platform): PerfControl {
        this.validatePlatform(platform);
        const control: PerfControl = { file, commands: `${file}.control`, answers: `${file}.answers` };
        execFileSync('mkfifo', [control.commands, control.answers]);
        return control;
    }

    /**
     * How to fork a node process under `perf`, for `fork` of `node:child_process`: `perf` as the program it starts,
     * which starts node with the given arguments and hands the channel to the parent down to it. With a control, node
     * also writes the names of the functions V8 compiled, which `perf report` reads from `perf-<pid>.map` in /tmp,
     * beside the recording, and its own log, which those turn on, beside it as well rather than into the folder the
     * process runs in.
     * @param control - The control of the recording, or undefined to fork node as it is.
     * @param nodeArgs - What node is started with.
     * @returns The `execPath` and `execArgv` to fork with.
     */
    static resolveFork(control: PerfControl | undefined, nodeArgs: string[]): PerfFork {
        if (control == undefined) {
            return { execPath: process.execPath, execArgv: nodeArgs };
        }
        const [execPath, perfArgs]: [string, string[]] = this.resolveCommand(control);
        const nodeOptions: string[] = PERF_RECORD_OPTIONS.node.map(option => option
            .replace('{folder}', path.dirname(control.file))
            .replace('{file}', control.file));
        return { execPath, execArgv: [...perfArgs, process.execPath, ...nodeArgs, ...nodeOptions] };
    }

    /**
     * The command that starts a program under `perf`, recording nothing until it is told to.
     * @param control - Where it records, and the FIFOs it is controlled through.
     * @returns The command and its arguments before the program's: `perf record … --`.
     */
    static resolveCommand(control: PerfControl): [string, string[]] {
        const args: string[] = [
            'record',
            ...PERF_RECORD_OPTIONS.perf,
            '--control',
            `fifo:${control.commands},${control.answers}`,
            '-o',
            control.file,
            '--'
        ];
        return ['perf', args];
    }

    /**
     * Records some work of a process started under `perf` by `scripts/profile-benchmarks.mjs`, which names its control
     * in {@link PERF_CONTROL_ENV}, and runs it as it is in any other process: what a suite measuring in the process of
     * jest wraps around what it wants recorded.
     * @param work - The work.
     * @returns What the work returned.
     */
    static async recordIfAsked<T>(work: () => Promise<T>): Promise<T> {
        const named: string | undefined = process.env[PERF_CONTROL_ENV];
        return named == undefined || named === '' ? await work() : await this.record(JsonUtilities.parse<PerfControl>(named), work);
    }

    /**
     * Records the process this runs in while some work runs. The process was started by {@link resolveCommand}.
     * @param control - The control of the `perf` that started the process.
     * @param work - The work.
     * @returns What the work returned.
     * @throws When `perf` does not answer.
     */
    static async record<T>(control: PerfControl, work: () => Promise<T>): Promise<T> {
        // perf holds both open from its start, so neither open waits for it
        const commands: FileHandle = await open(control.commands, 'w');
        const answers: FileHandle = await open(control.answers, 'r');
        try {
            await this.command(commands, answers, 'enable');
            try {
                return await work();
            }
            finally {
                await this.command(commands, answers, 'disable');
            }
        }
        finally {
            await commands.close();
            await answers.close();
        }
    }

    /**
     * Sends `perf` a command, and waits for it to answer that it carried it out.
     * @param commands - What it reads its commands from.
     * @param answers - What it answers on.
     * @param command - The command, such as `enable`.
     * @throws When it does not answer in time.
     */
    private static async command(commands: FileHandle, answers: FileHandle, command: string): Promise<void> {
        await commands.write(`${command}\n`);
        const answer: Buffer = Buffer.alloc(16);
        await PromiseUtilities.withTimeout(async () => {
            let read: string = '';
            while (!read.includes('ack')) {
                const { bytesRead } = await answers.read(answer, 0, answer.length, null);
                if (bytesRead === 0) {
                    throw new Error(`perf stopped answering after "${command}".`);
                }
                read += answer.subarray(0, bytesRead).toString();
            }
        }, ANSWER_WITHIN_MS);
    }

    private static validatePlatform(platform: NodeJS.Platform): void {
        if (platform !== 'linux') {
            throw new Error(`perf records on Linux only, not on ${platform}.`);
        }
    }
}