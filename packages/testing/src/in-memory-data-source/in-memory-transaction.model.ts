import { InternalError, LoggerInterface, Transaction, TransactionAlreadyFinishedError } from 'zibri';

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
 * A transaction left idle is rolled back the way a valkey one is, once it wrote or work waits for its
 * end: the overlay holds nothing anybody else waits on, but the work does - a lease held until the
 * transaction ends is renewed until it does.
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

    private readonly committedWork: (() => Promise<void>)[] = [];

    private readonly finishedWork: ((committed: boolean) => Promise<void>)[] = [];

    /**
     * Rolls the transaction back once nothing has happened on it for long enough.
     */
    private idleTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly store: InMemoryStore,
        private readonly idleTimeoutInMs: number,
        private readonly logger: LoggerInterface
    ) {}

    /**
     * Restarts the idle countdown, because something just happened on this transaction.
     */
    private touch(): void {
        if (!this.idleTimeoutInMs) {
            return;
        }
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => void this.abandon(), this.idleTimeoutInMs);
        // a transaction waiting to be given up on is not a reason to keep the process alive
        this.idleTimer.unref();
    }

    /**
     * Gives up on a transaction nothing has come back to, and reports it.
     */
    private async abandon(): Promise<void> {
        if (this.finished) {
            return;
        }
        this.logger.error(new InternalError(
            `A transaction was left open for ${this.idleTimeoutInMs}ms without being committed or rolled back.`
            + ' It has been rolled back.'
        ));
        try {
            await this.rollback();
        }
        catch (error) {
            // runs on a timer rather than under a caller, so there is nowhere to throw to
            this.logger.error(error instanceof Error ? error : new InternalError(String(error)));
        }
    }

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
        this.touch();
        this.overlayOf(tableName).set(id, row);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    deleteRow(tableName: string, id: string): void {
        this.assertOpen();
        this.touch();
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
        this.touch();
        this.joinOverlay.set(key, new Set(members));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    nextSequenceValue(tableName: string): number {
        return this.store.nextSequenceValue(tableName);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async commit(): Promise<void> {
        this.assertOpen();
        clearTimeout(this.idleTimer);
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
        await this.runFinishedWork(true);
        for (const work of this.committedWork.splice(0)) {
            await work();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterCommit(work: () => Promise<void>): void {
        this.committedWork.push(work);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterFinish(work: (committed: boolean) => Promise<void>): void {
        this.finishedWork.push(work);
        this.touch();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async rollback(): Promise<void> {
        clearTimeout(this.idleTimer);
        this.finished = true;
        this.committedWork.length = 0;
        this.discard();
        await this.runFinishedWork(false);
    }

    /**
     * Runs the work waiting for the end of the transaction.
     * @param committed - Whether the transaction was committed.
     */
    private async runFinishedWork(committed: boolean): Promise<void> {
        // spliced, so a second rollback does not run it again
        for (const work of this.finishedWork.splice(0)) {
            await work(committed);
        }
    }

    private discard(): void {
        this.rowOverlay.clear();
        this.joinOverlay.clear();
    }
}