import { pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from '@jest/globals';

import { ThreadCpu, ThreadCpuUtilities } from './thread-cpu.utilities';

const pbkdf2Async: (password: string, salt: string, iterations: number, length: number, digest: string) => Promise<Buffer> = promisify(pbkdf2);

/**
 * How long the work of each case keeps its thread busy, many clock ticks of 10 ms.
 */
const BUSY_MS: number = 300;

/**
 * How many threads libuv's pool has unless it is told otherwise.
 */
const POOL_THREADS: number = 4;

/**
 * Keeps every thread of libuv's pool busy deriving a key, which is where pbkdf2 runs.
 *
 * All of them at once rather than one: whatever else the process does on its main thread meanwhile, a collection
 * after the suites that ran in it before among it, is counted for the main thread as well. One thread of the pool
 * working for 270 ms was outweighed by 340 ms of that, and the pool was taken for the idle one.
 * @param iterations - How many iterations each derivation takes.
 */
async function keepPoolBusy(iterations: number): Promise<void> {
    await Promise.all(Array.from({ length: POOL_THREADS }, async () => await pbkdf2Async('password', 'salt', iterations, 64, 'sha512')));
}

describe('ThreadCpuUtilities', () => {
    it('reads the name and the CPU time of a thread from its stat, a name holding spaces and parentheses among them', () => {
        // 250 ticks in user mode and 50 in the kernel, of 10 ms each
        const line: string = '4242 (V8 (a) Worker) S 1 0 0 0 -1 4194304 498 294 0 2 250 50 0 0 20 0 1 0 137585066 9961472 1228';

        expect(ThreadCpuUtilities.parseStat(line)).toEqual({ name: 'V8 (a) Worker', cpuMs: 3000 });
        expect(ThreadCpuUtilities.parseStat('not a stat line')).toBeUndefined();
    });

    // what V8 does beside the main thread, the collector's helpers among it, is the share of the CPU that tells a
    // phase holding many buffers from one doing the work itself
    (process.platform === 'linux' ? it : it.skip)('counts what the collector\'s helpers spend as V8\'s', () => {
        const before: ThreadCpu | undefined = ThreadCpuUtilities.findThreadCpu();
        const busyUntil: number = performance.now() + BUSY_MS;
        let held: Buffer[] = [];
        while (performance.now() < busyUntil) {
            held.push(Buffer.alloc(1024));
            if (held.length > 100_000) {
                held = [];
            }
        }
        const after: ThreadCpu | undefined = ThreadCpuUtilities.findThreadCpu();
        if (before == undefined || after == undefined) {
            throw new Error('/proc/self/task could not be read');
        }

        expect(ThreadCpuUtilities.resolveDifference(before, after).v8).toBeGreaterThan(0);
    });

    it('reads nothing on a system other than Linux, which has no /proc to read', async () => {
        expect(ThreadCpuUtilities.findThreadCpu('darwin')).toBeUndefined();
        expect(ThreadCpuUtilities.findThreadCpu('win32')).toBeUndefined();
        // and runs the work all the same, handing back what it returned
        expect(await ThreadCpuUtilities.measure(async () => await Promise.resolve(42), 'darwin')).toEqual({ result: 42, cpu: undefined });
    });

    it('prints the CPU time by kind of thread in whole milliseconds', () => {
        expect(ThreadCpuUtilities.format({ main: 1420.4, v8: 2910, pool: 1250.6, other: 0 })).toBe('(main 1420, v8 2910, pool 1251, other 0)');
    });

    // the way a test drills into some work: what it returned, and what each kind of thread spent meanwhile
    (process.platform === 'linux' ? it : it.skip)('measures what a piece of work spends on each kind of thread', async () => {
        const { result, cpu } = await ThreadCpuUtilities.measure(async () => {
            await keepPoolBusy(300_000);
            return 'derived';
        });

        expect(result).toBe('derived');
        expect(cpu?.pool).toBeGreaterThanOrEqual(BUSY_MS / 4);
        expect(cpu?.main).toBeLessThan(cpu?.pool ?? 0);
    });

    // the threads of a process are read from /proc, which only Linux has: on another system the case would read nothing
    (process.platform === 'linux' ? it : it.skip)('counts what the main thread spends as the main thread\'s, and what the pool spends as the pool\'s', async () => {
        const before: ThreadCpu | undefined = ThreadCpuUtilities.findThreadCpu();
        const busyUntil: number = performance.now() + BUSY_MS;
        while (performance.now() < busyUntil) {
            // the main thread working
        }
        const afterMain: ThreadCpu | undefined = ThreadCpuUtilities.findThreadCpu();
        // pbkdf2 runs on libuv's pool, long enough for many ticks
        const poolUntil: number = performance.now() + BUSY_MS;
        while (performance.now() < poolUntil) {
            await keepPoolBusy(100_000);
        }
        const afterPool: ThreadCpu | undefined = ThreadCpuUtilities.findThreadCpu();
        if (before == undefined || afterMain == undefined || afterPool == undefined) {
            throw new Error('/proc/self/task could not be read');
        }

        const main: ThreadCpu = ThreadCpuUtilities.resolveDifference(before, afterMain);
        const pool: ThreadCpu = ThreadCpuUtilities.resolveDifference(afterMain, afterPool);
        expect(main.main).toBeGreaterThanOrEqual(BUSY_MS / 2);
        expect(main.pool).toBeLessThan(BUSY_MS / 4);
        expect(pool.pool).toBeGreaterThanOrEqual(BUSY_MS / 2);
        expect(pool.main).toBeLessThan(pool.pool / 2);
    });
});