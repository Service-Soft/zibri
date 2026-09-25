import { Transaction, TransactionAlreadyFinishedError } from 'zibri';

import { InMemoryScope, InMemoryStore, StoredRow } from './in-memory-store';

/**
 * A transaction of an in memory data source.
 *
 * Buffers every write in an overlay and applies the whole overlay to the store on commit, which is
 * the same shape the valkey transaction has. Reads go through the overlay first, so a transaction
 * sees its own writes before it commits, and a rollback is the overlay being dropped.
 *
 * ## What it does not do
 * Readers outside the transaction are not blocked, and they see the state from before the commit,
 * because nothing is applied until then. That is the same difference the valkey transaction carries
 * and it is worth knowing when a test asserts on what a concurrent reader observes.
 *
 * `idleTimeoutInMs` is ignored rather than unimplemented. A real transaction is given one because it
 * holds a connection out of a fixed pool and a grant on every row it wrote, so one that is never
 * finished takes those away from everybody else. This one holds neither: an overlay nobody commits
 * is unreachable memory and nothing else waits on it.
 */
export class InMemoryTransaction implements Transaction, InMemoryScope {

    /**
     * The rows written inside this transaction, by table name and then by id.
     *
     * An entry holding undefined is a row this transaction deleted, which is not the same as a row
     * it has not touched - so the presence of the key is what is asked, never its value.
     */
    private readonly rowOverlay: Map<string, Map<string, StoredRow | undefined>> = new Map();

    private readonly joinOverlay: Map<string, Set<string>> = new Map();

    private finished: boolean = false;

    constructor(private readonly store: InMemoryStore) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isFinished(): boolean {
        return this.finished;
    }

    /**
     * The overlay of one table, created on first use.
     * @param tableName - The table being written.
     * @returns The buffered rows of that table.
     */
    private overlayOf(tableName: string): Map<string, StoredRow | undefined> {
        const existing: Map<string, StoredRow | undefined> | undefined = this.rowOverlay.get(tableName);
        if (existing) {
            return existing;
        }
        const created: Map<string, StoredRow | undefined> = new Map();
        this.rowOverlay.set(tableName, created);
        return created;
    }

    /**
     * Refuses a write on a transaction that has already ended.
     * @throws When the transaction has been committed or rolled back.
     */
    private assertOpen(): void {
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    readRow(tableName: string, id: string): StoredRow | undefined {
        const overlay: Map<string, StoredRow | undefined> | undefined = this.rowOverlay.get(tableName);
        if (overlay == undefined) {
            return this.store.readRow(tableName, id);
        }
        // the presence of the key rather than its value: an entry holding undefined is a row this
        // transaction deleted, which has to read as gone rather than as untouched
        return overlay.has(id) ? overlay.get(id) : this.store.readRow(tableName, id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    ids(tableName: string): string[] {
        const res: Set<string> = new Set(this.store.ids(tableName));
        for (const [id, row] of this.rowOverlay.get(tableName) ?? []) {
            if (row == undefined) {
                res.delete(id);
                continue;
            }
            res.add(id);
        }
        return [...res];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    writeRow(tableName: string, id: string, row: StoredRow): void {
        this.assertOpen();
        this.overlayOf(tableName).set(id, row);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    deleteRow(tableName: string, id: string): void {
        this.assertOpen();
        this.overlayOf(tableName).set(id, undefined);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    readJoin(key: string): Set<string> {
        const buffered: Set<string> | undefined = this.joinOverlay.get(key);
        return buffered ? new Set(buffered) : this.store.readJoin(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    writeJoin(key: string, members: Set<string>): void {
        this.assertOpen();
        this.joinOverlay.set(key, new Set(members));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    nextSequenceValue(tableName: string): number {
        return this.store.nextSequenceValue(tableName);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async commit(): Promise<void> {
        this.assertOpen();
        this.finished = true;

        for (const [tableName, rows] of this.rowOverlay) {
            for (const [id, row] of rows) {
                if (row == undefined) {
                    this.store.deleteRow(tableName, id);
                    continue;
                }
                this.store.writeRow(tableName, id, row);
            }
        }
        for (const [key, members] of this.joinOverlay) {
            this.store.writeJoin(key, members);
        }
        this.discard();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async rollback(): Promise<void> {
        this.finished = true;
        this.discard();
    }

    private discard(): void {
        this.rowOverlay.clear();
        this.joinOverlay.clear();
    }
}