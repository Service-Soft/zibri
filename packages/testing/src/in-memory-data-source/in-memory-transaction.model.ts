import { InternalError, LoggerInterface, Transaction, TransactionAlreadyFinishedError } from 'zibri';

import { InMemoryScope, InMemoryStore, StoredRow, StoredRowChange } from './in-memory-store';

/**
 * A transaction of an in memory data source.
 *
 * Buffers every write in an overlay and applies the whole overlay to the store on commit, which is
 * the same shape the valkey transaction has. Reads go through the overlay first, so a transaction
 * sees its own writes before it commits, and a rollback is the overlay being dropped.
 *
 * A row that was stored before the transaction wrote it gets what the transaction changed on it, done
 * again to the row as it is on commit: the columns it wrote, and the amounts it added. Another writer
 * may have changed the row meanwhile, and a store holding a row until the transaction writing it
 * ends applies an update to the row as it is then. A row deleted meanwhile stays deleted.
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

    /**
     * How each row of the overlay is applied on commit, by table name and then by id: what the
     * transaction changed on a row that was stored before, or `whole` for a row it created, deleted,
     * or wrote without saying what changed, which is written as the overlay holds it.
     */
    private readonly rowChanges: Map<string, Map<string, StoredRowChange[] | 'whole'>> = new Map();

    private readonly joinOverlay: Map<string, Set<string>> = new Map();

    private finished: boolean = false;

    private readonly committedWork: (() => Promise<void>)[] = [];

    private readonly finishedWork: ((committed: boolean) => Promise<void>)[] = [];

    /**
     * What has to hold against the rows committed meanwhile before this transaction may commit, by
     * table and id so a row written twice is checked once.
     */
    private readonly commitChecks: Map<string, () => void> = new Map();

    /**
     * Rolls the transaction back once nothing has happened on it for long enough.
     */
    private idleTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly store: InMemoryStore,
        private readonly idleTimeoutInMs: number,
        private readonly logger: LoggerInterface
    ) {
        // idle from its start, as on postgres: a transaction that never does anything is ended too
        this.touch();
    }

    /**
     * Whether the transaction was started on the given store, which is the one data source it belongs to.
     * @param store - The store of a data source.
     * @returns True for the store of the data source that started it.
     */
    isStartedOn(store: InMemoryStore): boolean {
        return this.store === store;
    }

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
    writeRow(tableName: string, id: string, row: StoredRow, change?: StoredRowChange): void {
        this.assertOpen();
        this.touch();
        const changes: Map<string, StoredRowChange[] | 'whole'> = this.changesOf(tableName);
        const recorded: StoredRowChange[] | 'whole' | undefined = changes.get(id);
        // read before the overlay holds the row: a row nothing stored yet is one this creates
        changes.set(
            id,
            change == undefined || recorded === 'whole' || (recorded == undefined && this.readRow(tableName, id) == undefined)
                ? 'whole'
                : [...recorded ?? [], change]
        );
        this.overlayOf(tableName).set(id, row);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    deleteRow(tableName: string, id: string): void {
        this.assertOpen();
        this.touch();
        this.changesOf(tableName).set(id, 'whole');
        this.overlayOf(tableName).set(id, undefined);
    }

    /**
     * The changes of one table, created on first use.
     * @param tableName - The table being written.
     * @returns How each row of that table is applied on commit.
     */
    private changesOf(tableName: string): Map<string, StoredRowChange[] | 'whole'> {
        const existing: Map<string, StoredRowChange[] | 'whole'> | undefined = this.rowChanges.get(tableName);
        if (existing) {
            return existing;
        }
        const created: Map<string, StoredRowChange[] | 'whole'> = new Map();
        this.rowChanges.set(tableName, created);
        return created;
    }

    /**
     * Does one change of this transaction again to a row.
     * @param row - The row as it is.
     * @param change - What the transaction did to the row as it read it.
     * @returns The row with the change done to it.
     */
    private applyChange(row: StoredRow, change: StoredRowChange): StoredRow {
        const res: StoredRow = { ...row, ...change.fields };
        for (const [key, amount] of Object.entries(change.increments)) {
            // added to what is there now rather than to what the transaction read: an amount another
            // writer added meanwhile stays. Nothing stored counts as 0, as it does for an increment
            const raw: string | undefined = row[key];
            const stored: unknown = raw == undefined ? undefined : JSON.parse(raw);
            res[key] = JSON.stringify((typeof stored === 'number' ? stored : 0) + amount);
        }
        return res;
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
    joinKeys(prefix: string): string[] {
        const buffered: string[] = [...this.joinOverlay.keys()].filter(key => key.startsWith(prefix));
        return [...new Set([...this.store.joinKeys(prefix), ...buffered])];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    nextSequenceValue(tableName: string): number {
        return this.store.nextSequenceValue(tableName);
    }

    /**
     * Runs a check once more right before this transaction commits, where it reads the rows other
     * transactions committed since it ran. A check that throws refuses the commit and leaves the
     * transaction open to be rolled back, the way a store refuses the second of two transactions
     * writing one unique value.
     * @param key - What the check is about, so that the same one registered twice runs once.
     * @param check - The check.
     */
    checkBeforeCommit(key: string, check: () => void): void {
        this.commitChecks.set(key, check);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async commit(): Promise<void> {
        this.assertOpen();
        for (const check of this.commitChecks.values()) {
            check();
        }
        clearTimeout(this.idleTimer);
        this.finished = true;

        for (const [tableName, rows] of this.rowOverlay) {
            for (const [id, row] of rows) {
                if (row == undefined) {
                    this.store.deleteRow(tableName, id);
                    continue;
                }
                const changes: StoredRowChange[] | 'whole' | undefined = this.rowChanges.get(tableName)?.get(id);
                if (changes == undefined || changes === 'whole') {
                    this.store.writeRow(tableName, id, row);
                    continue;
                }
                // the row this transaction read is not necessarily the row there is now, and writing
                // back the one it read would undo what other writers committed to it
                const current: StoredRow | undefined = this.store.readRow(tableName, id);
                if (current != undefined) {
                    this.store.writeRow(tableName, id, changes.reduce((res, change) => this.applyChange(res, change), current));
                }
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
        this.rowChanges.clear();
        this.joinOverlay.clear();
        this.commitChecks.clear();
    }
}