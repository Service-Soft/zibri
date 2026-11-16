import { readdirSync, readFileSync } from 'node:fs';

/**
 * The kinds of thread a process of node runs, which its CPU time is told apart by.
 */
export type ThreadKind = 'main' | 'v8' | 'pool' | 'other';

/**
 * The CPU time each kind of thread of a process spent, in milliseconds.
 */
export type ThreadCpu = Record<ThreadKind, number>;

/**
 * What some work returned, and what each kind of thread spent while it ran.
 */
export type ThreadCpuMeasurement<T> = {
    /**
     * What the work returned.
     */
    result: T,
    /**
     * The CPU time by kind, in milliseconds, undefined on a system other than Linux.
     */
    cpu: ThreadCpu | undefined
};

/**
 * What one line of `/proc/<pid>/task/<tid>/stat` says of a thread.
 */
type ThreadStat = {
    /**
     * The name of the thread, as the kernel keeps it: at most 15 characters.
     */
    name: string,
    /**
     * Its CPU time, user and kernel together, in milliseconds.
     */
    cpuMs: number
};

/**
 * How many clock ticks the kernel counts a second in: USER_HZ, which Linux keeps at 100 for what it reports to
 * processes, whatever the kernel ticks at itself.
 */
const TICKS_PER_SECOND: number = 100;

// the fields after the name, counted from the state as the first: the ticks in user mode are the 14th field of the
// line, the ticks in the kernel the 15th
const USER_TICKS_INDEX: number = 11;
const KERNEL_TICKS_INDEX: number = 12;

/**
 * Reads the CPU time of the threads of this process by their kind, which node itself does not tell apart: the
 * collector's helpers and the thread pool hashing, compressing and reading files are all one process to it.
 *
 * Linux only, through `/proc`. Another system has no such files, and is answered with undefined.
 */
export abstract class ThreadCpuUtilities {
    /**
     * Runs work, and measures what each kind of thread of this process spent while it ran: the work's own and
     * whatever else the process did meanwhile, such as a timer of a server it started.
     * @param work - The work.
     * @param platform - The system the process runs on.
     * @returns What the work returned, and the CPU time by kind, undefined on a system other than Linux.
     */
    static async measure<T>(work: () => Promise<T>, platform: NodeJS.Platform = process.platform): Promise<ThreadCpuMeasurement<T>> {
        const before: ThreadCpu | undefined = this.findThreadCpu(platform);
        const result: T = await work();
        const after: ThreadCpu | undefined = this.findThreadCpu(platform);
        return { result, cpu: before == undefined || after == undefined ? undefined : this.resolveDifference(before, after) };
    }

    /**
     * The CPU time by kind of thread, as a report prints it beside the CPU time of the process.
     * @param cpu - The CPU time by kind.
     * @returns The text, such as `(main 1420, v8 2910, pool 1250, other 0)`.
     */
    static format(cpu: ThreadCpu): string {
        return `(main ${cpu.main.toFixed(0)}, v8 ${cpu.v8.toFixed(0)}, pool ${cpu.pool.toFixed(0)}, other ${cpu.other.toFixed(0)})`;
    }

    /**
     * The CPU time the threads of this process spent so far, by their kind.
     * @param platform - The system the process runs on.
     * @returns The CPU time, or undefined on a system other than Linux, or one whose `/proc` cannot be read.
     */
    static findThreadCpu(platform: NodeJS.Platform = process.platform): ThreadCpu | undefined {
        if (platform !== 'linux') {
            return undefined;
        }
        const cpu: ThreadCpu = { main: 0, v8: 0, pool: 0, other: 0 };
        let threadIds: string[];
        try {
            threadIds = readdirSync('/proc/self/task');
        }
        catch {
            return undefined;
        }
        for (const threadId of threadIds) {
            let line: string;
            try {
                line = readFileSync(`/proc/self/task/${threadId}/stat`, 'utf8');
            }
            catch {
                // a thread that ended while the others were read
                continue;
            }
            const stat: ThreadStat | undefined = this.parseStat(line);
            if (stat != undefined) {
                // the main thread by its id rather than its name, which follows the title of the process
                cpu[threadId === String(process.pid) ? 'main' : this.resolveKind(stat.name)] += stat.cpuMs;
            }
        }
        return cpu;
    }

    /**
     * What each kind of thread spent between two readings.
     * @param from - The earlier reading.
     * @param to - The later reading.
     * @returns The CPU time between them, by kind. A thread that ended in between takes its time with it.
     */
    static resolveDifference(from: ThreadCpu, to: ThreadCpu): ThreadCpu {
        return {
            main: Math.max(0, to.main - from.main),
            v8: Math.max(0, to.v8 - from.v8),
            pool: Math.max(0, to.pool - from.pool),
            other: Math.max(0, to.other - from.other)
        };
    }

    /**
     * Reads one line of a thread's `stat`.
     * @param line - The line.
     * @returns The thread's name and CPU time, or undefined for a line of another shape.
     */
    static parseStat(line: string): ThreadStat | undefined {
        // the name is in parentheses, and can hold spaces and parentheses itself: the last one closes it
        const open: number = line.indexOf('(');
        const close: number = line.lastIndexOf(')');
        if (open < 0 || close < open) {
            return undefined;
        }
        const fields: string[] = line.slice(close + 2).trim()
            .split(' ');
        const ticks: number = Number(fields[USER_TICKS_INDEX]) + Number(fields[KERNEL_TICKS_INDEX]);
        return Number.isFinite(ticks)
            ? { name: line.slice(open + 1, close), cpuMs: (ticks * 1000) / TICKS_PER_SECOND }
            : undefined;
    }

    /**
     * The kind of a thread other than the main one, by the name node and V8 give it.
     * @param name - The name.
     * @returns Its kind.
     */
    private static resolveKind(name: string): ThreadKind {
        // node 26 and later name the threads it starts itself `node-V8Worker` or `node-MainThread`
        const unprefixed: string = name.startsWith('node-') ? name.slice('node-'.length) : name;
        // V8's platform workers, `V8Worker` or `V8 DefaultWorker` cut to 15 characters by the release of node: the
        // collector's concurrent and parallel phases, and the optimizing compiler
        if (unprefixed.startsWith('V8')) {
            return 'v8';
        }
        // libuv's pool: files, zlib, crypto
        return unprefixed.startsWith('libuv-worker') ? 'pool' : 'other';
    }
}