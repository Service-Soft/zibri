import { createHash, Hash } from 'node:crypto';
import { Readable } from 'node:stream';

/**
 * One row of a {@link SeededTable}.
 */
export type SeededRow = {
    /**
     * The row's id, unique in its table.
     */
    id: number,
    /**
     * How often the row was written, starting at 1.
     */
    version: number,
    /**
     * The row's content.
     */
    text: string
};

/**
 * What a table holds, in brief: two tables holding the same rows have the same fingerprint.
 */
export type SeededFingerprint = {
    /**
     * How many rows it holds.
     */
    rows: number,
    /**
     * The sha256 over its rows, in the order of their ids.
     */
    sha256: string
};

/**
 * What one {@link SeededTable.applyChanges} changed, for writing the same changes into a data source.
 */
export type SeededChanges = {
    /**
     * Every row that was added or whose content changed, as it is now.
     */
    written: SeededRow[],
    /**
     * The ids of the rows that were removed.
     */
    deletedIds: number[]
};

/**
 * How a {@link SeededTable} changes between two backups, each as a share of the rows it holds.
 */
export type ChangeProfile = {
    /**
     * Rows whose content changes in place.
     */
    updatedShare: number,
    /**
     * Rows that are removed.
     */
    deletedShare: number,
    /**
     * Rows that are added, at the end.
     */
    insertedShare: number,
    /**
     * Rows that move to another place in the table, the way rows move in a database's file after
     * updates and a vacuum.
     */
    movedShare: number
};

/**
 * Bytes a row takes on average. A row is between half and one and a half times this long.
 */
export const AVERAGE_ROW_BYTES: number = 1024;

/**
 * How many distinct words the text of the rows is written with, so that the data compresses roughly
 * the way text in a database does rather than not at all.
 */
const VOCABULARY_SIZE: number = 2048;

/**
 * How much is handed to the stream at once.
 */
const BATCH_BYTES: number = 64 * 1024;

const SYLLABLES: string[] = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'to', 've', 'zi', 'pa', 'qu', 'dor', 'fen', 'gal', 'hix', 'jun'];

/**
 * A pseudo random sequence of 32 bit numbers that is the same for the same seed, on every machine
 * (mulberry32).
 * @param seed - The seed.
 * @returns The next number of the sequence, each time it is called.
 */
function createRandom(seed: number): () => number {
    let state: number = seed >>> 0;
    return () => {
        state = (state + 0x6D_2B_79_F5) >>> 0;
        let t: number = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (t ^ (t >>> 14)) >>> 0;
    };
}

/**
 * Mixes numbers into one seed.
 * @param values - The numbers.
 * @returns The seed.
 */
function mixSeed(...values: number[]): number {
    let hash: number = 0x81_1C_9D_C5;
    for (const value of values) {
        hash = Math.imul(hash ^ value, 0x01_00_01_93);
    }
    return hash >>> 0;
}

/**
 * Table-shaped data that is the same for the same seed, for measuring backups without a database.
 *
 * Each row is its id, its version and a line of words, written the way a dump writes a row. Only the
 * id, the version and the order of the rows are kept, never their content, which is rebuilt from the
 * seed each time the table is read. That keeps what the table holds in memory small beside what a
 * backup of it moves.
 */
export class SeededTable {
    /**
     * The version of each row by its id, 0 for a row that was deleted.
     */
    private versions: Uint32Array;

    /**
     * The ids of the rows in the order they are read.
     */
    private order: Uint32Array;

    /**
     * How many entries of `order` are in use.
     */
    private length: number;

    private readonly vocabulary: string[];

    /**
     * Creates the table, with as many rows as make up about the bytes asked for.
     * @param seed - What the content of every row is derived from.
     * @param bytes - About how large the table is to begin with.
     * @param capacityShare - How much larger it may grow through inserts, as a share of its rows.
     */
    constructor(private readonly seed: number, bytes: number, capacityShare: number) {
        const rows: number = Math.max(1, Math.round(bytes / AVERAGE_ROW_BYTES));
        const capacity: number = rows + Math.ceil(rows * capacityShare);
        this.versions = new Uint32Array(capacity).fill(0);
        this.order = new Uint32Array(capacity);
        for (let id: number = 0; id < rows; id++) {
            this.versions[id] = 1;
            this.order[id] = id;
        }
        this.length = rows;
        this.vocabulary = SeededTable.resolveVocabulary(seed);
    }

    /**
     * Reads every row that was not deleted, in the table's order.
     * @returns The rows, as the bytes a dump of them would be.
     */
    read(): Readable {
        // eslint-disable-next-line typescript/no-this-alias
        const table: SeededTable = this;
        return Readable.from((function* readRows(): Generator<Buffer> {
            let batch: string[] = [];
            let batchLength: number = 0;
            for (const row of table.resolveRows()) {
                const line: string = SeededTable.formatRow(row);
                batch.push(line);
                batchLength += line.length;
                if (batchLength >= BATCH_BYTES) {
                    yield Buffer.from(batch.join(''), 'latin1');
                    batch = [];
                    batchLength = 0;
                }
            }
            if (batch.length) {
                yield Buffer.from(batch.join(''), 'latin1');
            }
        })());
    }

    /**
     * Builds every row that was not deleted, in the table's order, one at a time.
     * @yields Each row.
     */
    * resolveRows(): Generator<SeededRow> {
        for (let position: number = 0; position < this.length; position++) {
            const id: number = this.order[position] ?? 0;
            const version: number = this.versions[id] ?? 0;
            if (version !== 0) {
                yield this.resolveRow(id, version);
            }
        }
    }

    /**
     * What the table holds: the same as {@link SeededTable.resolveFingerprintOf} gives for the same
     * rows read from anywhere else.
     * @returns The fingerprint.
     */
    resolveFingerprint(): SeededFingerprint {
        const hash: Hash = createHash('sha256');
        let rows: number = 0;
        for (const [id, version] of this.versions.entries()) {
            if (version !== 0) {
                hash.update(SeededTable.formatRow(this.resolveRow(id, version)), 'latin1');
                rows++;
            }
        }
        return { rows, sha256: hash.digest('hex') };
    }

    /**
     * Changes the table the way a day of use changes a database between two backups.
     * @param profile - How much changes.
     * @param round - Which change this is, so that each one changes other rows.
     * @returns What changed.
     */
    applyChanges(profile: ChangeProfile, round: number): SeededChanges {
        const random: () => number = createRandom(mixSeed(this.seed, round, 0xC4_A9_6E));
        const live: number = this.length;
        const pick: () => number = () => this.order[random() % this.length] ?? 0;
        const written: Set<number> = new Set();
        const deleted: Set<number> = new Set();

        for (let i: number = 0; i < Math.round(live * profile.updatedShare); i++) {
            const id: number = pick();
            if (this.versions[id] !== 0) {
                this.versions[id] = (this.versions[id] ?? 0) + 1;
                written.add(id);
            }
        }
        for (let i: number = 0; i < Math.round(live * profile.deletedShare); i++) {
            const id: number = pick();
            if (this.versions[id] !== 0) {
                this.versions[id] = 0;
                written.delete(id);
                deleted.add(id);
            }
        }
        const inserted: number = Math.min(Math.round(live * profile.insertedShare), this.order.length - this.length);
        for (let i: number = 0; i < inserted; i++) {
            // ids follow on from the highest, which is the length before any of them was added
            const id: number = this.length;
            this.versions[id] = 1;
            this.order[this.length] = id;
            this.length++;
            written.add(id);
        }
        for (let i: number = 0; i < Math.round(live * profile.movedShare); i++) {
            const from: number = random() % this.length;
            const to: number = random() % this.length;
            const moved: number = this.order[from] ?? 0;
            this.order[from] = this.order[to] ?? 0;
            this.order[to] = moved;
        }
        return {
            written: [...written].map(id => this.resolveRow(id, this.versions[id] ?? 0)),
            deletedIds: [...deleted]
        };
    }

    /**
     * Builds one row from the seed, its id and its version.
     * @param id - The row.
     * @param version - Its version.
     * @returns The row.
     */
    private resolveRow(id: number, version: number): SeededRow {
        const random: () => number = createRandom(mixSeed(this.seed, id, version));
        const targetLength: number = (AVERAGE_ROW_BYTES / 2) + (random() % AVERAGE_ROW_BYTES);
        const words: string[] = [];
        let length: number = 0;
        while (length < targetLength) {
            const word: string = this.vocabulary[random() % this.vocabulary.length] ?? '';
            words.push(word);
            length += word.length + 1;
        }
        return { id, version, text: words.join(' ') };
    }

    /**
     * The hash {@link SeededTable.resolveFingerprint} gives, over rows read from somewhere else.
     * @param rows - The rows, in the order of their ids.
     * @returns The fingerprint.
     */
    static async resolveFingerprintOf(rows: AsyncIterable<SeededRow>): Promise<SeededFingerprint> {
        const hash: Hash = createHash('sha256');
        let count: number = 0;
        for await (const row of rows) {
            hash.update(SeededTable.formatRow(row), 'latin1');
            count++;
        }
        return { rows: count, sha256: hash.digest('hex') };
    }

    /**
     * Writes a row the way a dump writes one.
     * @param row - The row.
     * @returns The line, ending in a line break.
     */
    private static formatRow(row: SeededRow): string {
        return `${row.id}\t${row.version}\t${row.text}\n`;
    }

    /**
     * Builds the words of the rows from the seed.
     * @param seed - The seed.
     * @returns The words.
     */
    private static resolveVocabulary(seed: number): string[] {
        const random: () => number = createRandom(mixSeed(seed, 0x57_0B_D5));
        return Array.from({ length: VOCABULARY_SIZE }, () => {
            const syllables: number = 1 + (random() % 4);
            return Array.from({ length: syllables }, () => SYLLABLES[random() % SYLLABLES.length] ?? '').join('');
        });
    }
}