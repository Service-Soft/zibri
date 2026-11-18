import { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import v8 from 'node:v8';

import { LivePhaseMeasurement, PhaseMeasurement } from './backup-measurement.model';
import { ThreadCpu, ThreadCpuUtilities } from '../thread-cpu.utilities';

/**
 * How a phase is read right after a collection.
 */
type LiveReading = {
    /**
     * How often, in milliseconds.
     */
    intervalInMs: number,
    /**
     * What the phase is called in the names of its heap snapshots.
     */
    name: string
};

/**
 * How much more a phase has to hold than at its last heap snapshot to be written again: often enough
 * to end within this of its peak, rarely enough that writing them, seconds each, stays a part of it.
 */
const HEAP_SNAPSHOT_STEP_BYTES: number = 16 * 1024 * 1024;

/**
 * How often memory is read while a phase runs. Often enough to find a peak that lasts as long as one
 * chunk takes to pass through.
 */
const MEMORY_INTERVAL_IN_MS: number = 10;

/**
 * The shortest a live phase runs between two readings, and so the shortest interval of one. Every
 * reading collects, which takes milliseconds itself.
 */
export const MIN_LIVE_INTERVAL_IN_MS: number = 10;

/**
 * How often the staging folder is measured, which walks it.
 */
const STAGING_INTERVAL_IN_MS: number = 50;

/**
 * Reads what a phase of a measured process costs while it runs: memory above where it started, the
 * most the staging folder holds, the time it takes and the CPU it spends.
 */
export class PhaseSampler {
    private memoryTimer: NodeJS.Timeout | undefined;
    private liveMemoryTimer: NodeJS.Timeout | undefined;
    private live: LiveReading | undefined;
    private peakLiveHeldBytes: number = 0;
    private heapSnapshotHeldBytes: number = 0;
    private liveReadings: number = 0;
    private stagingTimer: NodeJS.Timeout | undefined;
    private startedAt: number = 0;
    private startCpu: NodeJS.CpuUsage = process.cpuUsage();
    private startMainThreadCpu: NodeJS.CpuUsage = process.threadCpuUsage();
    private startThreadCpu: ThreadCpu | undefined;
    private start: NodeJS.MemoryUsage = process.memoryUsage();
    private peak: NodeJS.MemoryUsage = process.memoryUsage();
    private peakStagingBytes: number = 0;
    private measuringStaging: boolean = false;

    /**
     * Creates a sampler, which samples nothing until a phase starts.
     * @param stagingFolder - The folder a backup stages its data in.
     * @param heapSnapshotFolder - Where a phase read right after a collection writes a heap snapshot at
     * its start and near its peak, for `scripts/summarize-heap-growth.mjs`, or undefined for nowhere.
     */
    constructor(private readonly stagingFolder: string, private readonly heapSnapshotFolder: string | undefined) {}

    /**
     * Starts measuring a phase, from what the process holds now.
     * @param live - How memory is also read right after a collection, or undefined for never. The
     * collections it forces make the phase's durations, and the peaks of the other readings, no
     * measure of anything.
     */
    begin(live: LiveReading | undefined): void {
        // what earlier phases left for the collector is not this phase's cost
        PhaseSampler.collect();
        this.start = process.memoryUsage();
        this.peak = { ...this.start };
        this.live = live;
        this.peakLiveHeldBytes = PhaseSampler.resolveHeldBytes(this.start);
        this.heapSnapshotHeldBytes = this.peakLiveHeldBytes;
        this.liveReadings = 0;
        this.writeHeapSnapshot('start');
        this.peakStagingBytes = 0;
        this.startCpu = process.cpuUsage();
        this.startMainThreadCpu = process.threadCpuUsage();
        this.startThreadCpu = ThreadCpuUtilities.findThreadCpu();
        this.startedAt = performance.now();
        this.memoryTimer = setInterval(() => this.readMemory(), MEMORY_INTERVAL_IN_MS);
        // the peak of the other readings counts what the collector had not come for yet, which grows
        // with how long a phase runs rather than with what it holds: a backup of ten times the data
        // read as twice the memory, while what it held after a collection stayed the same
        if (live != undefined) {
            this.liveMemoryTimer = setTimeout(() => this.readLiveMemory(), live.intervalInMs);
        }
        this.stagingTimer = setInterval(() => void this.readStaging(), STAGING_INTERVAL_IN_MS);
    }

    /**
     * Ends the phase.
     * @returns What it cost.
     */
    async end(): Promise<PhaseMeasurement> {
        const durationMs: number = performance.now() - this.startedAt;
        clearInterval(this.memoryTimer);
        clearTimeout(this.liveMemoryTimer);
        clearInterval(this.stagingTimer);
        this.readMemory();
        await this.readStaging();
        const cpu: NodeJS.CpuUsage = process.cpuUsage(this.startCpu);
        // the sampler runs on the thread the application runs on, so this is that thread's
        const mainThreadCpu: NodeJS.CpuUsage = process.threadCpuUsage(this.startMainThreadCpu);
        const threadCpu: ThreadCpu | undefined = ThreadCpuUtilities.findThreadCpu();
        const cpuByThreadMs: ThreadCpu | undefined = this.startThreadCpu == undefined || threadCpu == undefined
            ? undefined
            : ThreadCpuUtilities.resolveDifference(this.startThreadCpu, threadCpu);
        const cpuMainThreadMs: number = (mainThreadCpu.user + mainThreadCpu.system) / 1000;
        const live: LivePhaseMeasurement | undefined = this.live == undefined
            ? undefined
            : {
                intervalInMs: this.live.intervalInMs,
                readings: this.liveReadings,
                peakHeldGrowthBytes: Math.max(0, this.peakLiveHeldBytes - PhaseSampler.resolveHeldBytes(this.start))
            };
        return {
            durationMs,
            peakRssGrowthBytes: Math.max(0, this.peak.rss - this.start.rss),
            peakHeapGrowthBytes: Math.max(0, this.peak.heapUsed - this.start.heapUsed),
            peakExternalGrowthBytes: Math.max(0, this.peak.external - this.start.external),
            peakStagingBytes: this.peakStagingBytes,
            cpuUserMs: cpu.user / 1000,
            cpuSystemMs: cpu.system / 1000,
            cpuMainThreadMs,
            cpuByThreadMs,
            // what is compared with the release: V8's threads collect what the whole process holds, and whether a
            // collection falls into a phase, and how much of the two this sampler forces before one runs on into
            // it, is no cost of the phase. The same restore of 10 MB spent 50 ms on them one time and 200 the
            // next, and a garbage collection of 13 ms more on them than on its own thread.
            // The main thread as node reads it, to the microsecond wherever the kernel tells the others in ticks
            cpuWithoutV8Ms: cpuByThreadMs == undefined ? undefined : cpuMainThreadMs + cpuByThreadMs.pool + cpuByThreadMs.other,
            live
        };
    }

    private readLiveMemory(): void {
        const readingStartedAt: number = performance.now();
        PhaseSampler.collect();
        const held: number = PhaseSampler.resolveHeldBytes(process.memoryUsage());
        this.peakLiveHeldBytes = Math.max(this.peakLiveHeldBytes, held);
        this.liveReadings++;
        if (held >= this.heapSnapshotHeldBytes + HEAP_SNAPSHOT_STEP_BYTES) {
            this.heapSnapshotHeldBytes = held;
            this.writeHeapSnapshot('peak');
        }
        // the interval counted from the start of this reading, so its collections are a part of it: a
        // phase waiting on another process, as a backup waits on postgres, runs on while they block, and
        // an interval waited after them read a backup of 257 ms 4 times rather than 10. Never shorter
        // than the minimum: readings fired back to back left a phase of 150 ms no time to run, read 465 times
        if (this.live != undefined) {
            const live: LiveReading = this.live;
            const waitMs: number = Math.max(MIN_LIVE_INTERVAL_IN_MS, live.intervalInMs - (performance.now() - readingStartedAt));
            this.liveMemoryTimer = setTimeout(() => this.readLiveMemory(), waitMs);
        }
    }

    /**
     * Writes a heap snapshot of the live phase, when snapshots are asked for, over the one of the same
     * kind before it.
     * @param kind - `'start'` for its start, `'peak'` for the most it held so far.
     */
    private writeHeapSnapshot(kind: 'start' | 'peak'): void {
        if (this.heapSnapshotFolder == undefined || this.live == undefined) {
            return;
        }
        v8.writeHeapSnapshot(path.join(this.heapSnapshotFolder, `${this.live.name.replaceAll(/[^\w]+/g, '-')}-${kind}.heapsnapshot`));
    }

    private readMemory(): void {
        const now: NodeJS.MemoryUsage = process.memoryUsage();
        this.peak = {
            rss: Math.max(this.peak.rss, now.rss),
            heapTotal: Math.max(this.peak.heapTotal, now.heapTotal),
            heapUsed: Math.max(this.peak.heapUsed, now.heapUsed),
            external: Math.max(this.peak.external, now.external),
            arrayBuffers: Math.max(this.peak.arrayBuffers, now.arrayBuffers)
        };
    }

    private async readStaging(): Promise<void> {
        // one walk at a time: a slow disk would otherwise pile walks up and measure itself
        if (this.measuringStaging) {
            return;
        }
        this.measuringStaging = true;
        try {
            this.peakStagingBytes = Math.max(this.peakStagingBytes, await PhaseSampler.resolveFolderBytes(this.stagingFolder));
        }
        finally {
            this.measuringStaging = false;
        }
    }

    /**
     * Collects everything the process no longer holds, buffers included. The measured process runs
     * with --expose-gc.
     */
    private static collect(): void {
        // twice: the buffers a collection finds dead are freed after it, on a thread of their own, and
        // read right after one still count. The second collection first finishes freeing them. Read
        // after one, an S3 restore held +26 MiB that its heap snapshot did not have
        globalThis.gc?.();
        globalThis.gc?.();
    }

    /**
     * What the process holds on to of what it allocated itself: its heap and the buffers outside it.
     * Unlike the rss, without what the allocator was given back and keeps rather than returning, and
     * without what native code allocates by itself.
     * @param memory - A reading.
     * @returns The bytes.
     */
    private static resolveHeldBytes(memory: NodeJS.MemoryUsage): number {
        // the larger of the two rather than external alone, which holds the buffers as long as an
        // ArrayBuffer of javascript owns them: a Blob takes the copies of its chunks over from theirs,
        // and only arrayBuffers, what node's allocator handed out, still counts what it holds
        return memory.heapUsed + Math.max(memory.external, memory.arrayBuffers);
    }

    /**
     * Adds up the sizes of the files below a folder, skipping those removed while it walks.
     * @param folder - The folder.
     * @returns The bytes it holds, 0 when it does not exist.
     */
    static async resolveFolderBytes(folder: string): Promise<number> {
        let entries: Dirent[];
        try {
            entries = await readdir(folder, { withFileTypes: true });
        }
        catch {
            return 0;
        }
        const sizes: number[] = await Promise.all(entries.map(async entry => {
            const entryPath: string = path.join(folder, entry.name);
            if (entry.isDirectory()) {
                return await PhaseSampler.resolveFolderBytes(entryPath);
            }
            try {
                return (await stat(entryPath)).size;
            }
            catch {
                return 0;
            }
        }));
        return sizes.reduce((sum, size) => sum + size, 0);
    }
}