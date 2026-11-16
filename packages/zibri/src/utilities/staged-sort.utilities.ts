import { Cipheriv, createCipheriv, createDecipheriv, Decipheriv, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';

import { FsPath, FsUtilities } from './fs.utilities';
import { JsonUtilities } from './json.utilities';
import { StagedSortLimits } from './staged-sort-limits.model';
import { UUIDUtilities } from './uuid.utilities';

/**
 * What a run is encrypted with: a stream cipher, under a key and an IV of its own per run.
 */
const RUN_CIPHER: string = 'aes-256-ctr';
const RUN_KEY_BYTES: number = 32;
const RUN_IV_BYTES: number = 16;

/**
 * What a string of a name takes beside its characters, counted towards the bytes of a run.
 */
const NAME_OVERHEAD_BYTES: number = 64;

/**
 * How much a sort holds at once unless told otherwise: runs of 4 MiB, merged 64 at a time, so that a merge
 * holds 64 files open and a buffer of each, however many names there are.
 */
const DEFAULT_LIMITS: StagedSortLimits = { runBytes: 4 * 1024 * 1024, maxRunsMerged: 64 };

/**
 * How much of a run file is read at once while the runs are merged, of each of them.
 */
const RUN_READ_BYTES: number = 64 * 1024;

/**
 * A run of sorted names written to disk, encrypted under a key only this process holds.
 */
type StagedRun = {
    /**
     * Where the run is written.
     */
    path: FsPath,
    /**
     * The key the run is encrypted under.
     */
    key: Buffer,
    /**
     * The IV the run is encrypted with.
     */
    iv: Buffer
};

/**
 * The next name of a run being merged, and the rest of the run.
 */
type RunHead = {
    /**
     * The next name of the run.
     */
    name: string,
    /**
     * The names of the run after it.
     */
    rest: AsyncIterator<string>
};

/**
 * Sorts more names than are held at once, in runs on the instance's own disk.
 */
export abstract class StagedSortUtilities {
    /**
     * Sorts names, each once, holding about `runBytes` of them at a time. Fewer than that are sorted in
     * memory and never written; more are written in sorted runs, each encrypted under a key of its own that
     * only this process holds, and merged, at most `maxRunsMerged` at once. The runs are deleted however the
     * sort ends.
     * @param pages - The names, in pages, in any order and possibly twice.
     * @param folder - Where the runs are written, on this instance's disk.
     * @param pageSize - How many names each page handed back holds, the last one fewer.
     * @param limits - How much the sort holds at once. Runs of 4 MiB merged 64 at a time by default.
     * @yields The names in order of their UTF-16 code units, each once, in pages.
     */
    static async* sortNames(
        pages: AsyncIterable<string[]>,
        folder: FsPath,
        pageSize: number,
        limits: StagedSortLimits = DEFAULT_LIMITS
    ): AsyncGenerator<string[]> {
        const sortId: string = UUIDUtilities.generate();
        let written: number = 0;
        const resolveRunName: () => string = () => `${sortId}-${written++}`;
        // every run on the disk, until it is merged into another one or the sort ends
        const runs: StagedRun[] = [];
        try {
            let held: string[] = [];
            let heldBytes: number = 0;
            for await (const page of pages) {
                for (const name of page) {
                    held.push(name);
                    heldBytes += name.length + NAME_OVERHEAD_BYTES;
                }
                if (heldBytes >= limits.runBytes) {
                    runs.push(await this.writeRun(held.sort((a, b) => this.compare(a, b)), folder, resolveRunName()));
                    held = [];
                    heldBytes = 0;
                }
            }
            held.sort((a, b) => this.compare(a, b));
            if (!runs.length) {
                yield* this.paginate(this.distinct(Readable.from(held)), pageSize);
                return;
            }
            if (held.length) {
                runs.push(await this.writeRun(held, folder, resolveRunName()));
            }
            held = [];
            // the oldest runs first, each merged run after the others, so that every pass merges runs of
            // about one size and each name is rewritten once a pass
            while (runs.length > limits.maxRunsMerged) {
                const merging: StagedRun[] = runs.slice(0, limits.maxRunsMerged);
                const merged: StagedRun = await this.writeRun(this.distinct(this.merge(merging)), folder, resolveRunName());
                runs.splice(0, merging.length);
                runs.push(merged);
                await Promise.all(merging.map(async run => await FsUtilities.rm(run.path)));
            }
            yield* this.paginate(this.distinct(this.merge(runs)), pageSize);
        }
        finally {
            await Promise.all(runs.map(async run => await FsUtilities.rm(run.path)));
        }
    }

    private static compare(a: string, b: string): number {
        if (a < b) {
            return -1;
        }
        return a > b ? 1 : 0;
    }

    private static async writeRun(sorted: Iterable<string> | AsyncIterable<string>, folder: FsPath, name: string): Promise<StagedRun> {
        await FsUtilities.mkdir(folder);
        const run: StagedRun = {
            path: FsUtilities.getPath(folder, `sorted-names-${name}`),
            key: randomBytes(RUN_KEY_BYTES),
            iv: randomBytes(RUN_IV_BYTES)
        };
        // a name a line, as json: a name may hold a line break, and json writes it as two characters
        const lines: Readable = Readable.from((async function* toLines(): AsyncGenerator<string> {
            for await (const entry of sorted) {
                yield `${JsonUtilities.stringify(entry)}\n`;
            }
        })());
        // encrypted: a name can hold what a row holds, such as a unique email address, which this disk
        // never holds readably
        const cipher: Cipheriv = createCipheriv(RUN_CIPHER, run.key, run.iv);
        try {
            await pipeline(lines, cipher, FsUtilities.createWriteStream(run.path));
        }
        catch (error) {
            // not yet among the runs the sort deletes when it ends
            await FsUtilities.rm(run.path);
            throw error;
        }
        return run;
    }

    private static async* readRun(run: StagedRun): AsyncGenerator<string> {
        const decoder: StringDecoder = new StringDecoder('utf8');
        let rest: string = '';
        // deciphered piece by piece here rather than piped, so that a read failing fails the sort
        const decipher: Decipheriv = createDecipheriv(RUN_CIPHER, run.key, run.iv);
        for await (const piece of FsUtilities.createReadStream(run.path, { highWaterMark: RUN_READ_BYTES })) {
            rest += decoder.write(decipher.update(Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece))));
            const lines: string[] = rest.split('\n');
            rest = lines.pop() ?? '';
            for (const line of lines) {
                yield JsonUtilities.parse<string>(line);
            }
        }
        rest += decoder.write(decipher.final()) + decoder.end();
        if (rest) {
            yield JsonUtilities.parse<string>(rest);
        }
    }

    /**
     * Merges sorted runs into one sorted sequence, reading a little of each at a time.
     * @param runs - The runs.
     * @yields Every name of every run, in order.
     */
    private static async* merge(runs: StagedRun[]): AsyncGenerator<string> {
        // a heap of the next name of each run, so that a merge of many runs is no slower per name than of a few
        const heap: RunHead[] = [];
        for (const run of runs) {
            const rest: AsyncIterator<string> = this.readRun(run)[Symbol.asyncIterator]();
            const first: IteratorResult<string> = await rest.next();
            if (first.done !== true) {
                this.push(heap, { name: first.value, rest });
            }
        }
        for (let head: RunHead | undefined = this.pop(heap); head != undefined; head = this.pop(heap)) {
            yield head.name;
            const next: IteratorResult<string> = await head.rest.next();
            if (next.done !== true) {
                this.push(heap, { name: next.value, rest: head.rest });
            }
        }
    }

    private static push(heap: RunHead[], head: RunHead): void {
        heap.push(head);
        for (let i: number = heap.length - 1; i > 0;) {
            const parent: number = Math.floor((i - 1) / 2);
            if (this.compareHeads(heap, i, parent) >= 0) {
                return;
            }
            this.swap(heap, i, parent);
            i = parent;
        }
    }

    private static pop(heap: RunHead[]): RunHead | undefined {
        const top: RunHead | undefined = heap[0];
        const last: RunHead | undefined = heap.pop();
        if (top == undefined || last == undefined || !heap.length) {
            return top;
        }
        heap[0] = last;
        for (let i: number = 0; ;) {
            const left: number = (2 * i) + 1;
            const right: number = left + 1;
            let smallest: number = i;
            if (left < heap.length && this.compareHeads(heap, left, smallest) < 0) {
                smallest = left;
            }
            if (right < heap.length && this.compareHeads(heap, right, smallest) < 0) {
                smallest = right;
            }
            if (smallest === i) {
                return top;
            }
            this.swap(heap, i, smallest);
            i = smallest;
        }
    }

    private static compareHeads(heap: RunHead[], a: number, b: number): number {
        return this.compare(heap[a]?.name ?? '', heap[b]?.name ?? '');
    }

    private static swap(heap: RunHead[], a: number, b: number): void {
        const first: RunHead | undefined = heap[a];
        const second: RunHead | undefined = heap[b];
        if (first != undefined && second != undefined) {
            heap[a] = second;
            heap[b] = first;
        }
    }

    private static async* distinct(names: AsyncIterable<unknown>): AsyncGenerator<string> {
        let last: string | undefined;
        for await (const name of names) {
            const value: string = String(name);
            if (value !== last) {
                yield value;
                last = value;
            }
        }
    }

    private static async* paginate(names: AsyncIterable<string>, pageSize: number): AsyncGenerator<string[]> {
        let page: string[] = [];
        for await (const name of names) {
            page.push(name);
            if (page.length >= pageSize) {
                yield page;
                page = [];
            }
        }
        if (page.length) {
            yield page;
        }
    }
}